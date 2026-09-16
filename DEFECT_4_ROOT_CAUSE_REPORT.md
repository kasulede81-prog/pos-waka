# DEFECT #4 ROOT-CAUSE REPORT

Shop: `2df4b0c8-8b30-489a-8167-41de2549041f` ("N & C trading center") · Business date under test: `2026-09-16`
No new financial transactions (sales, returns, voids, credit) were created during this investigation. No shop reset, emergency close, button bypass, forced React state mutation, or database mutation was used at any point.

## Reproduction

**Symptom (as originally reported in Phase 13):** the Day-Close wizard's final step ("Manager review") showed a fully-passing preflight checklist and a green "Business ready to close" banner, yet the "Confirm & Close Day" button stayed disabled with no error message and no way to proceed through the normal UI.

**How it actually reproduces:** the disabling condition is not a defect in the checklist/banner computation — it is a *stuck* `submitting` flag left over from an earlier click that never returned:

1. `EndOfDayClosingWizard.tsx`'s `onConfirmClose` sets `submitting = true`, then `await`s `submitClose()` → `recordDayClose()` in the store.
2. `recordDayClose` (`usePosStore.ts:8181`) re-validates its own preflight by calling `runDayCloseEnforcementPreflight` (`= runDayClosePreflight`, `dayCloseEnforcement.ts:516`), which — when the device is online — `await`s `syncShopWithCloud({ pull: true })` (`dayCloseEnforcement.ts:527-528`) before evaluating the snapshot.
3. This shop had a **long-outstanding, never-yet-acknowledged `force_full_resync_at` signal** (timestamp `2026-09-15T20:59:30.748706+00:00`), dating from earlier admin-reset testing in this engagement. Every time anything actually awaited a full `syncShopWithCloud()` to completion, that pull chain fell into an infinite loop (see **Root cause** below) and never resolved.
4. Because the promise chain inside `try` never settles (it doesn't throw — it just never returns), the `finally { setSubmitting(false) }` in `onConfirmClose` never runs. `submitting` stays `true` in React state for the remainder of that session.
5. On every subsequent render, `primaryDisabled` (`EndOfDayClosingWizard.tsx:149-154`) evaluates `Boolean(activeCloseToday) || submitting || ...` → `true` → the button renders **permanently disabled**, even on a fresh visit to step 6, even though the checklist/banner look perfectly healthy.
6. The checklist and "Business ready to close" banner look healthy regardless, because they're populated by a *separate*, fast, **local-only** snapshot (`refreshPreflightQuick` → `evaluateDayClosePreflightSync`, `useEndOfDayCloseSession.ts:178-202`) that never touches the network — so it keeps rendering a correct, green result even while the network-dependent submit path is permanently wedged.

This is exactly what makes the two states look contradictory: the checklist is genuinely healthy (it never depended on the hung call), but the button is genuinely stuck disabled (it depends on a `submitting` flag that a hung promise can never clear).

## Exact blocking condition

| Condition | Current value (before fix) | Expected value | Actually blocking? | Source |
|---|---|---|---|---|
| `preflight.canClose` | `true` | `true` | No — healthy | [dayCloseEnforcement.ts:458](src/lib/dayCloseEnforcement.ts:458) `buildDayClosePreflightSnapshot` |
| `preflight.blockReasons` | `[]` | `[]` | No — healthy | same |
| "Business ready to close" banner | shown | shown | No — correctly reflects local-only snapshot | [useEndOfDayCloseSession.ts:178-202](src/hooks/useEndOfDayCloseSession.ts:178) `refreshPreflightQuick` |
| `preflight.requiresSyncOverride` | `false` | `false` | No | [dayCloseEnforcement.ts:351,456](src/lib/dayCloseEnforcement.ts:351) |
| `canSubmitNormal` | `true` (once `preflight` is set) | `true` | No — formula itself correct | [useEndOfDayCloseSession.ts:323-326](src/hooks/useEndOfDayCloseSession.ts:323) |
| `submitting` (React state) | **stuck `true`** | `false` when idle | **YES — this is the actual blocking term** | [EndOfDayClosingWizard.tsx:145-155](src/components/eod/EndOfDayClosingWizard.tsx:145) `primaryDisabled` |
| `runDayCloseEnforcementPreflight`'s `await syncShopWithCloud({pull:true})` | **never resolves** | resolves in seconds | YES — root cause of `submitting` getting stuck | [dayCloseEnforcement.ts:527-528](src/lib/dayCloseEnforcement.ts:527) |
| `applyAdminForceFullResync` reentrant call for the shop's outstanding signal | **recurses forever** | returns `false` immediately on reentry | YES — the actual hang mechanism | [shopRecoverySignals.ts:252-315](src/lib/shopRecoverySignals.ts:252) (pre-fix) |

`preflight`/checklist state and button-disabled state are computed from **different sources**, exactly as hypothesized: the checklist comes from a synchronous, network-free snapshot; the button's `disabled` prop is additionally gated by a `submitting` flag whose only path back to `false` runs through a network call that could hang forever.

## Root cause

Two independent, compounding concurrency bugs in `applyAdminForceFullResync` (`src/lib/shopRecoverySignals.ts`), reached from `runDayClosePreflight`'s `syncShopWithCloud({ pull: true })` call via this chain:

```
dayCloseEnforcement.ts:528  syncShopWithCloud({ pull: true })
  → cloudSync.ts  syncShopWithCloudInner → runCloudPullBundle (withPullSyncMutex)
      → pullCloudAndMergeIntoStore (cloudSync.ts:4389)
          … merges cloud data into the store …
          → cloudSync.ts:4666-4669  scheduleShopRecovery("background_sync")
              → shopRecoveryOrchestration.ts:19  scheduleShopRecovery
                  → scheduleShopSecurityPinRecovery + scheduleStaffCredentialRecovery
                      → shopSecurityPinRecovery.ts:178 → ensureShopSecurityPinRecovery
                          → shopRecoverySignals.ts:478  applyShopRecoverySignalsForShop
                              → shopRecoverySignals.ts:505  applyAdminForceFullResync(shopId, "2026-09-15T20:59:30…", …)
                                  ← SAME outstanding, unacknowledged signal
```

**Root Cause #1 — infinite mutual recursion.** `applyAdminForceFullResync` only marks a `force_full_resync_at` signal "applied" (`writeAppliedForceResyncAt`) **after** the pull it guards returns. But `pullCloudAndMergeIntoStore`'s own trailing call (`cloudSync.ts:4666-4669`) re-enters the exact same function, for the exact same unacknowledged signal, **before** that ack write has ever had a chance to run. With no reentrancy guard, this is unbounded recursion by construction: the outer pull can't finish because it's waiting on an inner call that's waiting on a pull that's waiting on itself — forever, for as long as the signal stays unacknowledged (which it can never become, since the only place that acknowledges it is on a return path that never arrives).

**Root Cause #2 — the one caller with no mutual exclusion.** `pullCloudAndMergeIntoStore` has no concurrency protection of its own. Every other real caller (the periodic incremental pull, `syncShopWithCloud`'s own full pull) goes through `withPullSyncMutex` in `cloudSync.ts`. `applyAdminForceFullResync`'s direct call bypassed that mutex entirely, so — independent of bug #1 — it could run fully concurrently with a genuinely separate top-level pull already in flight (e.g. a boot-time `app_launch` check racing a periodic `safety_poll` pull), both mutating the same Zustand store at once. Live-tested: applying Fix #1 alone still hung for 3+ minutes on this shop for this reason.

This specific shop's `force_full_resync_at` signal had been outstanding since before this testing session began (residue from earlier admin-reset testing in this engagement). The bug had almost certainly been silently firing on every background sync cycle for hours — invisible because nothing else in the app actually awaited a full pull-mutex-chain to completion, until the Day-Close wizard's own preflight/submission became the first caller to do so.

## Files/functions involved

| File | Function | Role |
|---|---|---|
| [src/lib/shopRecoverySignals.ts:252-315](src/lib/shopRecoverySignals.ts:252) | `applyAdminForceFullResync` | **Root cause — both fixes applied here** |
| [src/offline/cloudSync.ts:4389](src/offline/cloudSync.ts:4389), [:4666-4669](src/offline/cloudSync.ts:4666) | `pullCloudAndMergeIntoStore` | Merges cloud pull into store; its trailing `scheduleShopRecovery` call is the reentry trigger |
| [src/lib/shopRecoveryOrchestration.ts:19](src/lib/shopRecoveryOrchestration.ts:19) | `scheduleShopRecovery` | Fans out to PIN + staff-credential recovery |
| [src/lib/shopRecoverySignals.ts:478,482-505](src/lib/shopRecoverySignals.ts:478) | `applyShopRecoverySignalsForShop` | Re-enters `applyAdminForceFullResync` for the same signal |
| [src/lib/dayCloseEnforcement.ts:516-539](src/lib/dayCloseEnforcement.ts:516) | `runDayClosePreflight` | First caller in the app to actually `await` a full `syncShopWithCloud()` to completion — where the hang first became externally visible |
| [src/store/usePosStore.ts:8143,8181](src/store/usePosStore.ts:8143) | `recordDayClose` | Re-runs the same preflight (and thus the same hang) at submit time |
| [src/components/eod/EndOfDayClosingWizard.tsx:145-155](src/components/eod/EndOfDayClosingWizard.tsx:145) | `primaryDisabled` / `onConfirmClose` | Where the hang surfaces as a permanently-disabled button (`submitting` never resets) |
| [src/hooks/useEndOfDayCloseSession.ts:178-228](src/hooks/useEndOfDayCloseSession.ts:178) | `refreshPreflightQuick` vs. `refreshPreflightWithSync` | The two independent snapshot sources that explained why checklist and button state diverged |

## Fix

Both fixes are localized to `applyAdminForceFullResync` in `src/lib/shopRecoverySignals.ts`; no changes to validation, permission, or day-close protection logic anywhere else.

**Fix #1 — reentrancy guard** (closes Root Cause #1):
```ts
const forceFullResyncInFlight = new Set<string>();

export async function applyAdminForceFullResync(
  shopId: string,
  signalAt: string,
  reason?: string,
): Promise<boolean> {
  const lastApplied = readAppliedForceResyncAt(shopId);
  if (lastApplied === signalAt) return false;
  if (forceFullResyncInFlight.has(shopId)) return false;
  forceFullResyncInFlight.add(shopId);
  try {
    /* ... */
  } finally {
    forceFullResyncInFlight.delete(shopId);
  }
}
```
A reentrant call for the same shop while a resync is already in flight now returns `false` immediately instead of recursing.

**Fix #2 — route through the shared pull mutex** (closes Root Cause #2):
```ts
const { pullCloudAndMergeIntoStore } = await import("../offline/cloudSync");
const { withPullSyncMutex } = await import("./globalSyncMutex");
const merged = await withPullSyncMutex("hydrateAccountFromCloud", () =>
  pullCloudAndMergeIntoStore({
    forceFull: true,
    pullReason: reason ?? "admin_shop_reset_signal",
  }),
);
if (!merged) return false;
writeAppliedForceResyncAt(shopId, signalAt);
```
Reuses the existing `"hydrateAccountFromCloud"` pull kind (already used for full-hydration at login) so this pull *queues* behind any pull already in flight instead of racing it. Safe to add here specifically because Fix #1 already guarantees this function never tries to re-acquire the mutex from within its own nested reentrant call. The signal is still only marked "applied" on a **successful** merge — a failed pull (network error, org-check failure, etc.) leaves it outstanding so the next boot/flush retries, preserving the existing fail-safe behavior.

Both fixes were committed and pushed: [`1e30ac8`](https://github.com/kasulede81-prog/pos-waka/commit/1e30ac8) on `waka/historical-financial-correction` (on top of the earlier `ae1faef`, which already contained the defensive `try/catch/finally` around `onConfirmClose` that stops an *uncaught exception* from leaving the button stuck — a related but distinct hardening, since this bug's hang never actually threw).

## Regression tests

Added to `src/lib/shopRecoverySignals.test.ts` — a test that simulates `pullCloudAndMergeIntoStore`'s real trailing `scheduleShopRecovery` call re-entering `applyAdminForceFullResync` for the same shop/signal before the outer call's dedupe flag is written:

- **Verified to FAIL without the fix**, via `git stash` on `shopRecoverySignals.ts` alone: `expected true to be false` — confirming it genuinely detects the reentrancy bug, not a false positive.
- **Passes with the fix**: the reentrant call returns `false` immediately, `pullCloudAndMergeIntoStore` is called exactly once, and the outer call still succeeds and writes the dedupe flag.

Re-run fresh for this report:
- Targeted: `src/lib/shopRecoverySignals.test.ts` — **27/27 passed**.
- Broader sweep: `src/offline/**`, `src/lib/organizationDeletionState.test.ts`, `src/lib/globalSyncMutex.test.ts` — **79/79 passed**.
- `npx tsc --noEmit` — clean, zero errors.
- `npx eslint` on both changed files — clean, zero output. (The repo-wide `npm run lint` fails on an unrelated, pre-existing issue — a vendored `lovable-import/lovable-ui/eslint.config.js` subproject missing `eslint-plugin-prettier` — confirmed to fail identically with these changes stashed out, i.e. predates this work.)
- `npm run build` — succeeded (`✓ built in 27.32s`); only pre-existing `INEFFECTIVE_DYNAMIC_IMPORT` rollup warnings across the wider codebase, no errors.

No new test was added at the `useEndOfDayCloseSession`/`EndOfDayClosingWizard` component level specifically proving "preflight passes + button enabled," because that logic (`canSubmitNormal`, `buildDayClosePreflightSnapshot`) was never itself defective — it's already covered by existing passing tests (e.g. `src/lib/dayCloseEnforcement.test.ts:112,153` assert `canClose === true` under healthy conditions) and was independently reconfirmed live (see next section). The actual regression coverage needed was for the async hang, which the new test targets directly.

## UI verification

Performed end-to-end in the real browser UI against the live dev server and Supabase project, with both fixes in place, no bypass of any kind:

1. Confirmed `globalSyncMutex`'s `pullDepth` correctly cycles `0 → 1 → 0` within seconds during normal background sync — no longer sticking at `1`.
2. Unlocked Back Office with the real owner PIN.
3. Opened "Close day" → stepped through all 6 wizard steps normally (Start closing → Business health check → Cash reconciliation → Shift & day summary → Reports preview → Manager review), clicking "Continue" at each step exactly as a real operator would.
4. At every step, the preflight checklist showed all items passing and the figures matched the previously-reconciled totals for this shop/day: **UGX 39,500 sales / 13 transactions / UGX 43,700 drawer (expected = counted, variance +0, within ±10,000 tolerance)**.
5. At step 6, verified via `disabled`/`aria-disabled` inspection that "Confirm & Close Day" was genuinely enabled (`disabled: false`) before clicking.
6. Clicked "Confirm & Close Day" (no JS force-click, no state mutation) — the wizard returned to step 1 within ~4 seconds showing **"Day closed successfully. Good night!"** and **"This business day is already closed."**
7. Past closes count went from `0` to `1`, showing `2026-09-16 · UGX 43,700 / 43,700`, estimated profit `UGX 8,783`.
8. Performed a **full page reload** (fresh navigation, no re-login needed — session persisted): dashboard loaded cleanly, September profit still showed `UGX 8,783`.
9. Re-unlocked Back Office and reopened "Close day": confirmed **"This business day is already closed"** persisted, with the identical Past closes entry, after the full reload — proving server-side persistence, not just in-memory state.

## Database verification

Queried `shop_day_closes` directly in Supabase (project `ljaedextsenbkxzzgxcg`):

```
id:          35180b5a-08c4-409d-88b3-f520b7b3bf3c
shop_id:     2df4b0c8-8b30-489a-8167-41de2549041f
date_key:    2026-09-16
created_at:  2026-09-16 13:48:30.678+00
isEmergency: false        ← normal close, NOT an emergency-close bypass
```

Payload (financial snapshot):

| Field | Value |
|---|---|
| totalSalesUgx | 39,500 |
| transactionCount | 13 |
| expectedCashUgx | 43,700 |
| countedCashUgx | 43,700 |
| differenceUgx / varianceUgx | 0 |
| totalDebtUgx | 5,800 |
| openingFloatUgx | 5,000 |
| cashSalesUgx | 33,700 |
| cashRefundsUgx / refundsUgx | 0 / 2,000 |
| debtCollectedUgx | 5,000 |
| profitEstimateUgx | 8,783 |
| closedByLabel / closedByUserId | Nakayiza Catherine / `141f3da5-9e58-46ed-8fdd-3bbe8fd6e09e` |

Also confirmed the previously-stuck `force_full_resync_at` signal is now recorded as applied on this device (`waka.recovery.forceFullResyncApplied.v1::2df4b0c8-8b30-489a-8167-41de2549041f = 2026-09-15T20:59:30.748706+00:00`), i.e. the fixed code path resolved the outstanding signal cleanly on this run instead of hanging — it will not retrigger the recursion again for this signal.

## Post-close financial reconciliation

No financial numbers changed unexpectedly as a result of the close. Every figure in the persisted `shop_day_closes` row matches the figures independently established and reconciled across all earlier Financial Transaction Laboratory phases for this shop/day:

- Sales: UGX 39,500 / 13 transactions — unchanged.
- Drawer: expected UGX 43,700 = counted UGX 43,700, variance UGX 0 — unchanged.
- Debt: UGX 5,800 total, UGX 5,000 collected — unchanged.
- Refunds: UGX 2,000 — unchanged.
- Opening float: UGX 5,000 — unchanged.
- Estimated profit: UGX 8,783 (newly computed at close, consistent with dashboard's "September profit" both before and after the close, and after the full reload).

No sales, returns, voids, or credit transactions were created at any point during this investigation, per the standing constraint.

## Remaining issues

- **Repo-wide `npm run lint` is broken independent of this work** — a vendored `lovable-import/lovable-ui` subproject's `eslint.config.js` imports `eslint-plugin-prettier`, which is not installed. Confirmed pre-existing (fails identically with these changes stashed out). Out of scope for this defect; flagged for separate cleanup.
- No dedicated component-level automated test exercises the full `EndOfDayClosingWizard` → `useEndOfDayCloseSession` → store submission path end-to-end (only unit tests at the `shopRecoverySignals`/`dayCloseEnforcement` layers, plus this session's live manual UI verification). If a fully automated E2E regression for the wizard is wanted going forward, that would be a separate, larger addition (would need to mock Supabase, the sync mutex, and the recovery-signal chain together).
- The underlying `force_full_resync_at` signal mechanism can still, in principle, leave a **different** shop in the same stuck state if a future admin-reset signal is issued while both this reentrancy guard and the mutex are bypassed by some other not-yet-audited caller — the fix closes the two call paths that were proven to cause this specific hang, but `pullCloudAndMergeIntoStore` callers beyond `applyAdminForceFullResync` were not individually re-audited in this pass (they were already routed through `withPullSyncMutex` and were not implicated in this defect).

## Certification

**Financial Correctness: GREEN** — reconfirmed. No financial figures changed unexpectedly through this investigation or the completed close.

**Operational Readiness: GREEN** — Defect #4 is resolved. The Day-Close wizard's "Confirm & Close Day" button now enables correctly and the close completes and persists through the normal UI workflow, verified end-to-end: UI → day-close action → server RPC → persisted `shop_day_closes` row → fresh reload → reports, all confirmed consistent.

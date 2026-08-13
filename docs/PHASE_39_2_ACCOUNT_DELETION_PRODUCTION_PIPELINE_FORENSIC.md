# Phase 39.2 — Account Deletion Production Pipeline Forensic Certification

**Date:** 2026-08-13  
**Mode:** READ-ONLY forensic audit — **no source, migration, deploy, or data changes**  
**Production:** `ljaedextsenbkxzzgxcg` / `pos.waka.ug`  
**Prerequisite:** Phase 39.0 / 39.1

---

## Executive verdict

### **NO-GO**

The deletion **pipeline exists in production** (Edge Function ACTIVE, migration 112 RPCs present). It is **not safe to treat as owner-ready**.

Confirmed from this audit:

1. The owner deletion page exposes a developer **Self delete health** panel to every owner.
2. User-facing errors are the raw `npm run supabase:deploy:admin` instruction. That string is generated in the **client**, not by a missing function.
3. Production **does** have `owner-permanently-delete-account` deployed (`ACTIVE`, `verify_jwt=true`, version 7). Hypothesis “Edge Function missing” is **false**.
4. The health panel’s “Edge function: OK” / “Database RPC: OK” **does not prove** that a real delete can succeed. The probe never runs the delete RPC.
5. SQL verification counts **auth users before they are deleted**, so a completed execute path is structured to fail `all_passed` and skip `auth.admin.deleteUser` unless something else short-circuits first.

Do **not** implement repairs in this phase.

---

## Confirmed root causes

### RC-1 — Developer diagnostics on the owner page (P0 UX / information leak)

`AccountDeletionPage` always renders `SelfDeleteHealthPanel` for owners. Copy is explicitly diagnostic (“route access, database RPC, and edge function readiness”). Same panel also exists on Settings diagnostics (appropriate). It is **not** gated to Internal Admin or `import.meta.env.DEV`.

**Evidence:** `src/pages/AccountDeletionPage.tsx` (renders panel unconditionally after owner gate) · `src/components/settings/SelfDeleteHealthPanel.tsx` · `src/lib/i18n.ts` keys `selfDeleteHealth*`.

Live screenshot (13 Aug 2026, `pos.waka.ug`) matches this UI.

### RC-2 — Client maps many failures to an Edge deploy instruction (P0 UX / security)

Exact production string:

> Deploy Supabase edge function "owner-permanently-delete-account" (run: npm run supabase:deploy:admin), then retry.

**Source:** `edgeNotDeployedMessage()` in `src/lib/supabaseEdgeInvoke.ts`.  
**Rendered by:** `AccountDeletionPage` `setError(result.message)` — no sanitization.

Classifier is overly broad:

- JSON `message`/`error` containing substring `"not found"` (includes **`shop_not_found`**)
- Transport `error.message` containing `"Failed to send"`, `"not found"`, or `"404"`
- Thrown errors containing `"Failed to send"` or `"fetch"`
- RPC/Postgres details such as `"Could not find the function"`

So a **deployed** function that returns `shop_not_found`, or a gateway/network `Failed to send a request to the Edge Function`, is shown as “function not deployed.”

**Evidence:** `src/lib/supabaseEdgeInvoke.ts` `isNotFoundBody` + error branch; `src/lib/ownerAccountDeletion.ts` `invokeOwnerDeleteEdge` passes `r.message` through; live screenshot after clicking Delete organization.

### RC-3 — Health checks are the wrong signal for delete readiness (P0 reliability)

| Probe | What it actually tests |
|-------|------------------------|
| Route access | `actor.role === "owner"` |
| Database RPC | `owner_self_delete_health_probe()` from **migration 111** — always `{ ok: true }` if that probe exists. Does **not** call delete. |
| Edge function | `POST { probe: true }` — Edge returns `{ ok: true, probe: true }` **before** `getUser` / RPC / auth delete |
| Re-auth | sessionStorage TTL or `last_sign_in_at` |
| Device cleanup | `rpc.ok` from the 111 probe |

Live screenshot: all of those green **and** delete still showed RC-2. That pair is explained by RC-2 + RC-3, not by a missing Edge Function.

### RC-4 — Execute-time verification includes auth rows that have not been deleted yet (P0 data / completeness)

Production `hard_delete_verification_report` includes `owner_auth_account` and `staff_auth_accounts` from `auth.users`. `certified_hard_delete_organization_execute` requires `all_passed` **before** the Edge Function calls `auth.admin.deleteUser`.

If execute runs to completion, auth users still exist → `all_passed` is false → SQL returns `verification_failed` **after** `DELETE FROM organizations` (function returns JSON, does not `RAISE`, so the transaction **commits**) → Edge skips auth deletion and reports `partial`.

**Evidence:** repo `supabase/migrations/112_certified_hard_delete.sql`; live `pg_get_functiondef` flag `verification_includes_auth_counts=true`; `supabase/functions/_shared/certifiedHardDelete.ts` only deletes auth after `execute` returns `ok`.

This screenshot did **not** show the partial-failure UI, so **this attempt likely never completed execute**. RC-4 is a pipeline defect for attempts that *do* reach execute.

---

## Edge Function hypotheses (section 3)

Production CLI `supabase functions list` (2026-08-13, read-only):

| slug | status | version | verify_jwt |
|------|--------|---------|------------|
| `owner-permanently-delete-account` | **ACTIVE** | 7 | **true** |
| `admin-permanently-delete-shop-account` | ACTIVE | 11 | true |

Repo path: `supabase/functions/owner-permanently-delete-account/index.ts`  
Frontend invoke name: `"owner-permanently-delete-account"` — **match**.  
`supabase/config.toml` `[functions.owner-permanently-delete-account] verify_jwt = true`.  
Deploy script: `package.json` `supabase:deploy:admin` includes this function **and** is the correct script name.

| Hypothesis | Verdict |
|------------|---------|
| **A** Function missing from production | **FALSE** — listed ACTIVE |
| **B** Readiness check wrong | **TRUE** — probe ≠ delete; 111 probe always ok |
| **C** Deployment/config wrong | **Not the screenshot cause** — name, JWT pin, and script are consistent |
| **D** Frontend calling wrong name | **FALSE** |
| **E** Function deployed, another dependency failing, client mislabels it | **TRUE** for the screenshot |

---

## P0 / P1 / P2 / P3 findings

### P0

1. Owner-facing Self delete health diagnostics (RC-1).
2. Deploy-instruction error leak (RC-2).
3. Health OK ≠ deletable (RC-3).
4. Auth counted in SQL verification before auth delete; execute can commit org wipe and skip auth delete (RC-4).

### P1

5. UI accepts organization name as confirmation; SQL only accepts `DELETE PERMANENTLY` or **shop** name (`112` lines 443–451 vs `matchesOwnerDeletionConfirmText`). Typing the org name can fail after the UI already accepted it (not this screenshot — user typed `DELETE PERMANENTLY`).
6. `sales.shop_id` is `ON DELETE RESTRICT`; execute deletes sales then org. Other `RESTRICT` FKs (`enterprise_stock_transfers.from_shop_id/to_shop_id`, hospitality ticket `sale_id`) are **not** explicitly purged — org delete can throw `delete_failed` on shops that use those features.
7. Verification report does not count expenses, drawer/EOD, members, `shop_ai_settings`, payments, AI usage logs, etc. Cascade may still remove them; they are **unverified**.
8. `CREATE OR REPLACE` in 112 added a **second overload** `(text, text)`. Production still has the 111 `(text)` overload. Not the screenshot cause (Edge always sends `p_phase`).

### P2

9. Pending deletion marker is set **before** the cloud call (`markOwnerDeletionInProgress`). Phase 39.1 clears it on non-partial failure; a crash/navigation mid-request can leave the device blocked.
10. Local wipe runs only after `result.ok`. Partial cloud success escalates marker to `deleted` **without** wipe (intentional 39.1) — device blocked, data still on device.
11. Capacitor Preferences wipe was already a 39.0 residual — not re-litigated as new.

### P3

12. Probe endpoint returns OK with only a Bearer-shaped JWT at the gateway; it does not prove service-role or RPC execute works.
13. CORS `Access-Control-Allow-Origin: *` on the Edge Function (existing pattern).

---

## Exact files

| Role | Path | Symbol |
|------|------|--------|
| Route | `src/App.tsx` | `office/account/delete` |
| Owner gate | `src/components/OwnerProtectedRoute.tsx` | `OwnerProtectedRoute` |
| Page | `src/pages/AccountDeletionPage.tsx` | `AccountDeletionPage`, `runDelete` |
| Health UI | `src/components/settings/SelfDeleteHealthPanel.tsx` | `SelfDeleteHealthPanel` |
| Health logic | `src/lib/selfDeleteHealth.ts` | `probeOwnerSelfDeleteRpc`, `probeOwnerSelfDeleteEdge` |
| Delete client | `src/lib/ownerAccountDeletion.ts` | `ownerPermanentlyDeleteOwnAccount`, `finalizeOwnerAccountDeletionLocally` |
| Invoke / leak | `src/lib/supabaseEdgeInvoke.ts` | `edgeNotDeployedMessage`, `invokeSupabaseEdgeFunction` |
| Reauth | `src/lib/ownerDeleteReauth.ts` | `assertRecentOwnerDeleteReauth` (5 min) |
| Local lock | `src/lib/organizationDeletionState.ts` | `markOrganizationDeleted`, pending/deleted markers |
| Partial | `src/lib/ownerDeletePartialFailure.ts` | `writeOwnerDeletePartialFailure` |
| Confirm UI | `src/lib/ownerDeletionBlastRadius.ts` | `matchesOwnerDeletionConfirmText` |
| Edge | `supabase/functions/owner-permanently-delete-account/index.ts` | `Deno.serve` |
| Shared delete | `supabase/functions/_shared/certifiedHardDelete.ts` | `runCertifiedHardDelete`, `revokeAndDeleteAuthUsers` |
| SQL | `supabase/migrations/110_*.sql`, `111_*.sql`, `112_certified_hard_delete.sql` | `owner_permanently_delete_own_account`, `certified_hard_delete_organization_execute` |
| Deploy | `package.json` `supabase:deploy:admin` | includes owner function |
| JWT pin | `supabase/config.toml` | `[functions.owner-permanently-delete-account] verify_jwt = true` |
| Diagnostics (ok) | `src/pages/SettingsDiagnosticsPage.tsx` | also mounts health panel |

---

## Actual deletion architecture

```text
/office/account/delete
  OwnerProtectedRoute (owner + supabase)
        ↓
  SelfDeleteHealthPanel  ← owner-visible diagnostics (wrong surface)
        ↓
  ack + typed phrase + window.confirm
        ↓
  password / Google reauth (client 5 min) + Edge last_sign_in_at 5 min
        ↓
  markOwnerDeletionInProgress (local pending)     ← before cloud
        ↓
  invoke owner-permanently-delete-account
        ├─ probe:true → {ok, probe} (health only)
        ├─ retry_auth → orphan check + auth.admin.deleteUser
        └─ confirmation →
              RPC prepare (list user/shop ids)
              staff signOut
              RPC execute:
                revoke devices
                delete support/audit/referrals/agents/profiles/sales
                DELETE organizations  → shops CASCADE
                verification (includes auth.users)  ← RC-4
              if execute.ok:
                auth.admin.deleteUser (all ids)
                hard_delete_merge_auth_verification
        ↓
  if ok → wipeAccountNamespace + mark deleted + signOut → /login
  if partial → escalate pending→deleted, keep local data, retry UI
  if other fail → clear pending, show result.message (may be RC-2 leak)
```

### Organization dependency (execute + CASCADE)

```text
organizations
 ├── shops (ON DELETE CASCADE)
 │    ├── products, inventory, customers, expenses, snapshots, devices, …
 │    ├── sales (ON DELETE RESTRICT — deleted explicitly first)
 │    └── enterprise_stock_transfers (RESTRICT — not explicitly deleted)
 ├── organization_members, subscriptions (typically CASCADE)
 └── settings / AI rows (mostly CASCADE; not all verified)
auth.users  ← NOT in SQL; Edge service-role only, after execute.ok
```

---

## Pipeline step map

| Step | Implementation | Production-safe? |
|------|----------------|------------------|
| Open page | `AccountDeletionPage` + `OwnerProtectedRoute` | Owner-only; diagnostics leaked |
| Authorization | `user_is_shop_owner` inside SECURITY DEFINER RPC; Edge `getUser` | Yes for owner; org picked as **first owner membership**, not client shop_id |
| Reauth | Client sessionStorage + `signInWithPassword` / Google; Edge `last_sign_in_at` ≤ 5 min | Dual gate; client marker is forgeable, Edge gate is real |
| Confirmation | UI: phrase / shop / **org name**; SQL: phrase / **shop name only** | Mismatch (P1) |
| Readiness | 111 probe + Edge `probe:true` | Insufficient (RC-3) |
| Edge Function | Deployed ACTIVE v7 | Yes present |
| Hard-delete RPC | `owner_permanently_delete_own_account(text, text)` exists | Yes present; verification logic unsafe (RC-4) |
| Auth users | `admin.auth.admin.deleteUser` after execute.ok | Skipped if execute.ok is false |
| Verify | Count list in 112; `all_passed` iff every listed count is 0 | Incomplete table coverage; auth timing bug |
| Local cleanup | Only on `result.ok` | Does not wipe on failed cloud (good) |
| Logout | `finalizeOwnerAccountDeletionLocally` then `onSignOut` | Only on success |

Retry: `retry_auth` requires `owner_self_delete_orphan_auth_status.orphan_auth`. If org still exists, retry is rejected (`retry_not_applicable`). Idempotent auth delete: `getUserById` after delete; already-missing users count as remaining=0. Failed `deleteUser` is collected; retry can continue.

---

## Production readiness

### Verified (this audit)

- Edge `owner-permanently-delete-account` **ACTIVE**, JWT on, name matches client.
- RPCs `owner_permanently_delete_own_account` (both overloads), `owner_self_delete_health_probe`, `certified_hard_delete_organization_execute`, verification + merge exist and are SECURITY DEFINER.
- `sales_shop_id_fkey` delete action is restrict (`confdeltype=r`).
- Verification function body still includes auth counts.
- `npm run supabase:deploy:admin` is the correct deploy command and lists this function.
- Deletion implementation is **committed** on `main` (not sitting uncommitted). Uncommitted files are only `supabase/.temp/*`.

### Code-present but not production-verified

- A live destructive delete of a throwaway org (must not be done in this audit).
- Whether `Failed to send` vs `shop_not_found` caused **this** screenshot (no Edge request log in this environment).
- Whether hospitality / stock-transfer RESTRICT would block this specific shop.

### Not verified

- Dashboard Edge request logs for the 13 Aug attempt.
- Completeness of CASCADE for every table created after 112.
- Android/iOS Capacitor Preferences after wipe.

**Production deployment state of the Edge Function: VERIFIED (ACTIVE).**  
**Production success of a full owner delete: NOT VERIFIED** (no destructive test).

---

## User-facing problems

1. **Developer diagnostics** appear to normal owners on `/office/account/delete`. Checks should remain, but on Internal Admin / diagnostics only. Owner page should show READY / UNAVAILABLE.
2. **Deploy instruction** appears because the client invents it. Owners should see a safe “not deleted, try later / contact support” message. **Do not implement in this phase.**
3. **Whether deletion actually works:** the function and RPCs are deployed. The screenshot failure is **not** “function missing.” A full success path is **not certified** because of RC-4 and because this attempt did not reach the partial or success UI.

---

## Data safety

> Is there any realistic path where the user believes deletion succeeded while organization data remains?

**Local false success:** Unlikely. `finishSuccess` / wipe / logout run only if `result.ok`. This screenshot was a **failed** attempt; the form remained. Phase 39.1 clears pending on non-partial failure.

> Is there a realistic path where cloud data is gone while the user can still log in?

**Yes (RC-4):** execute can commit `DELETE FROM organizations` then return `verification_failed`; Edge does not delete auth users; UI shows partial recovery, not success. Org data may already be gone.

> This screenshot specifically?

Partial UI was not shown → **no evidence** this attempt wiped the org. **NOT VERIFIED** without logs.

---

## Security review (static)

| Check | Result |
|-------|--------|
| Owner-only page | Yes (`OwnerProtectedRoute` + page redirect) |
| Server owner check | Yes (`user_is_shop_owner`); shop chosen from **auth.uid()** membership, not body `shop_id` |
| Client cannot pick another org | Full delete body is `{ confirmation }`; shop_id only on retry |
| Service-role | Edge only; not shipped to client |
| Internal admin blocked from self-delete | RPC `cannot_delete_internal_admin` |
| Replay/retry | Retry requires orphan_auth; otherwise `retry_not_applicable` |
| Sensitive error leakage | **Confirmed** (RC-2) |
| Developer commands to users | **Confirmed** (`npm run supabase:deploy:admin`) |
| Client reauth marker forgeable | Yes (sessionStorage); Edge still requires fresh `last_sign_in_at` |

No production attacks were performed.

---

## Test audit

| Tests | What they prove |
|-------|-----------------|
| `ownerAccountDeletion.pending.test.ts` | Pending marker clear vs escalate |
| `organizationDeletionState.test.ts` | Local markers / switch block |
| `ownerDeletionBlastRadius.test.ts` | Confirm phrase matching |
| `accountDataWipe.test.ts` | Local namespace wipe |
| `enterpriseLogout.test.ts` | Logout helper |

**Not proven:** real Edge availability, real 112 execute, `auth.admin.deleteUser`, complete org erasure, `supabaseEdgeInvoke` misclassification, staging/production delete, RC-4.

Safe tests were not re-run as a gate; they do not cover the screenshot.

---

## Failure matrix

| Failure | Current behavior | Data risk | User sees | Correct future behavior |
|---------|------------------|-----------|-----------|-------------------------|
| Edge Function missing | Invoke → RC-2 deploy string | None | Deploy npm command | Safe unavailable message; ops alert |
| Function present, `shop_not_found` / `"not found"` | **Same deploy string** | None | Deploy npm command | Map to “couldn’t complete; not deleted” |
| Gateway `Failed to send` / fetch | Same deploy string | Unknown if execute started | Deploy npm command | Timeout/unavailable; do not claim missing function |
| RPC / FK failure | `delete_failed` + sqlerrm if it reaches the page | Partial possible if SQL committed | Sometimes raw SQL; sometimes RC-2 | Rollback + safe message |
| Owner auth delete failure | `auth_delete_failed` partial (only if execute.ok) | Org gone, login remains | Partial retry UI | Support path + retry auth |
| Staff auth delete failure | Same | Staff logins remain | Partial retry UI | Retry remaining ids |
| Verification failure (RC-4) | execute commits org delete; auth skipped | **High** | Partial UI | Verify DB without auth; delete auth; then verify auth |
| Network timeout | Client timeout **or** Failed to send → RC-2 | Unknown | Timeout or deploy string | “Not deleted; retry”; do not wipe local |
| Re-auth expired | Edge 401 `reauth_required` (if not misclassified) | None | Reauth prompt or RC-2 | Reauth prompt only |
| Local cleanup failure | Wipe errors swallowed; still signOut on success | Local remnants after cloud ok | Login | Best-effort wipe; still block namespace |
| Retry after partial | Requires orphan_auth | Can finish logins | Retry button | Keep; never wipe local until auth+verify ok |

---

## IDE / git

- `main` at `008cf6c` (Ask WAKA) on top of `8040578` (account-deletion consent / login UX).
- Hard-delete landed earlier (`eb41fba`, `28332d5`, …).
- Working tree: only `supabase/.temp/*` dirty. **Not** an uncommitted deletion implementation.

---

## Recommended next phase

### Phase 39.3 — Production Deletion Reliability + User Experience Repair

Necessary. Scope (do not start here):

1. Move Self delete health off the owner delete page; owner sees READY / UNAVAILABLE only.
2. Stop rendering `edgeNotDeployedMessage` to owners; classify `shop_not_found` / `"not found"` / `Failed to send` separately; safe copy + support.
3. Fix verification order: DB counts without auth → auth.admin.deleteUser → auth counts.
4. Align UI vs SQL confirmation (org name).
5. Explicitly delete or CASCADE-fix RESTRICT children (sales already handled; stock transfers / kitchen tickets not).
6. Tighten health probe to call prepare-equivalent or two-arg RPC existence, not 111 stub.
7. Staging throwaway-org erasure test before calling production owner-ready.

**Do not expand this into a generic security audit.** The screenshot is explained by RC-1 + RC-2 + RC-3 with production evidence that the Edge Function **is deployed**.

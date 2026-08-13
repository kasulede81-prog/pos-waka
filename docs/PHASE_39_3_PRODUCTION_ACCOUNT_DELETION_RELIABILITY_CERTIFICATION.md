# Phase 39.3 — Production Account Deletion Reliability Certification

**Date:** 2026-08-13  
**Prerequisite:** Phase 39.2 — **NO-GO**  
**Mode:** Scoped repair of the existing deletion engine. No auth rebuild. No POS engine changes.  
**Production deploy:** not performed in this phase.

---

## Executive verdict

### **CONDITIONAL GO**

The owner-facing deletion path is repaired **in the repository**. Hard-stop UX leaks from 39.2 are gone in code. Database verification no longer requires `auth.users` to be empty before Edge auth deletion.

This is **not** an unconditional production GO:

- Migration `148_owner_self_delete_reliability.sql` is **not applied** to production.
- Edge Function `owner-permanently-delete-account` source changed (probe after `getUser`; idempotent already-gone auth users) and is **not redeployed**.
- No destructive throwaway-org erasure test was run on staging or production.

Do **not** treat live `pos.waka.ug` as owner-ready until 148 is applied, the Edge Function is redeployed, and a staging throwaway-org test passes.

---

## Fixed (Phase 39.2 findings)

| 39.2 ID | Finding | 39.3 repair |
|---------|---------|-------------|
| RC-1 P0 | `SelfDeleteHealthPanel` on owner delete page | Removed from `AccountDeletionPage`. Kept on `SettingsDiagnosticsPage`. |
| RC-2 P0 | `npm run supabase:deploy:admin` shown to owners | Classifier no longer maps `shop_not_found` / `Failed to send` / generic 404 to “function missing”. Owner page never renders `result.message` raw. |
| RC-3 P0 | Health OK ≠ deletable | Owner page shows READY/UNAVAILABLE only. Probe still non-destructive; RPC probe now checks two-arg RPC + execute function existence. Edge probe runs after `getUser`. |
| RC-4 P0 | SQL `all_passed` counted `auth.users` before Edge delete | `hard_delete_verification_report` is database-only (`scope: database`). Auth counts applied in `hard_delete_merge_auth_verification` after `auth.admin.deleteUser`. |
| P1 | UI accepted org name; SQL accepted shop name | Shared contract: `DELETE PERMANENTLY` or exact organization name (`owner_deletion_confirmation_matches` + `matchesOwnerDeletionConfirmText`). |
| P1 | RESTRICT FKs could block org delete | Execute now deletes `table_sessions` then `sales`, then `enterprise_stock_transfers`, then `organizations`. Kitchen tickets cascade from table sessions. |
| P2 | Pending marker could trap a device | Failure still clears pending. Stale pending (>15 min) expires without marking `deleted`. Cloud org present still clears the marker. |
| P2 | Developer-tool owner page | Owner page is a consent + confirm + reauth flow. Partial page no longer shows `HardDeleteReportPanel`. |

---

## Preserved

- `OwnerProtectedRoute` and owner-only route `/office/account/delete`
- Supabase authentication (`signInWithPassword` / Google reauth)
- 5-minute re-authentication (`ownerDeleteReauth` + Edge `last_sign_in_at`)
- Edge Function slug `owner-permanently-delete-account`
- RPC `owner_permanently_delete_own_account` / `certified_hard_delete_organization_execute`
- Partial auth retry (`retry_auth` + `owner_self_delete_orphan_auth_status`)
- Local deletion-state architecture (`pending` / `deleted` / wipe)
- `performEnterpriseLogout` / `finalizeOwnerAccountDeletionLocally` / `/login`
- Organization-level deletion semantics (first owner membership, not client `shop_id`)

Not changed: Sell, Checkout, inventory, payments, barcode, `useAuth`, `resolveStartupSession`.

---

## Actual deletion sequence (after 148 + Edge deploy)

```text
Owner /office/account/delete
  ↓ OwnerProtectedRoute
  ↓ READY / UNAVAILABLE (no diagnostics)
  ↓ ack + DELETE PERMANENTLY | exact org name
  ↓ password / Google reauth (5 min)
  ↓ mark pending (local)
  ↓ owner-permanently-delete-account
        prepare RPC
        staff signOut
        execute RPC:
          purge support/audit/referrals/agents/profiles
          delete table_sessions (hospitality RESTRICT)
          delete sales
          delete enterprise_stock_transfers (shop RESTRICT)
          DELETE organizations
          database verification (no auth.users)
        if execute.ok:
          auth.admin.deleteUser (already-gone = success)
          merge auth verification
  ↓ ok: local wipe + enterprise logout + /login
  ↓ partial (org gone, auth leftover): retry cleanup UI
  ↓ other fail: clear pending, safe owner message
```

---

## Verification

```text
Build:
  tsc -b          PASS
  vite production PASS (3.88s)

Focused tests:
  8 files / 43 tests PASS
  (classifier, verification order, confirmation, surfaces,
   pending/TTL, partial recovery)

Full tests:
  363 files PASS, 1 FAIL unrelated
  1956 passed / 4 skipped
  FAIL: src/lib/pharmacyPatientProfile.test.ts
        computes age from DOB (expected 26, received 25)
        Date-bound pharmacy helper — not part of deletion changes.
```

Focused tests were run with `vitest --pool=forks` because the default threads pool hung in this environment.

---

## Production verification

| Item | Status |
|------|--------|
| Classifier + owner UX in repository | **Verified in repository** |
| Confirmation contract (UI + SQL 148) | **Verified in repository** |
| DB vs auth verification split in 148 | **Verified in repository** |
| Edge Function ACTIVE v7 (from 39.2) | **Verified in deployed configuration** (pre-39.3 source) |
| Migration 148 on production | **NOT verified** — not applied |
| Redeployed Edge Function with 39.3 source | **NOT verified** — not deployed |
| Throwaway-org staging erasure | **NOT verified by destructive staging test** |
| Live owner delete on pos.waka.ug | **NOT verified** |

**Production deployment state of migration 148: NOT VERIFIED.**  
**Production success of a full owner delete: NOT VERIFIED.**

---

## Hard-stop checklist (repo)

| Condition | Repo status |
|-----------|-------------|
| Owner can still see Self delete health | **Cleared** — not mounted on delete page |
| Owner can still see `npm run supabase:deploy:admin` | **Cleared** — sanitized; classifier narrowed |
| `shop_not_found` classified as Edge missing | **Cleared** |
| DB verification requires auth users deleted first | **Cleared in 148** (must be applied) |
| Org delete can silently succeed while auth skipped | **Cleared** — `result.ok` only after DB + auth; auth skip is PARTIAL |
| Confirmation contract inconsistent | **Cleared** — phrase or org name both sides |
| Network failure marks organization deleted | **Cleared** — pending cleared; not `deleted` |
| Raw SQL/Supabase/internal errors to owners | **Cleared** on owner page |

Until 148 + Edge are on production, live behavior can still follow the 39.2 verification-order bug.

---

## Recommended production follow-through (not this phase)

1. Apply `supabase/migrations/148_owner_self_delete_reliability.sql` to staging, then production.
2. Redeploy `owner-permanently-delete-account` (`npm run supabase:deploy:admin`).
3. Staging throwaway-org erasure: confirm DB gone, auth gone, local wipe, login blocked, retry of already-deleted auth users.
4. Only then call production owner-ready.

---

## Exact files

| Path | Change |
|------|--------|
| `src/pages/AccountDeletionPage.tsx` | Owner UX; no health panel; i18n errors |
| `src/pages/SettingsDiagnosticsPage.tsx` | Unchanged — still hosts diagnostics |
| `src/lib/supabaseEdgeInvoke.ts` | Gateway-missing vs network vs app `*_not_found` |
| `src/lib/ai/aiErrors.ts` | `classifyInvokeMessage` no longer matches generic `not found`/`404` |
| `src/lib/ownerDeletionErrors.ts` | Owner-safe kinds + leak sanitizer |
| `src/lib/ownerAccountDeletion.ts` | Sanitize; partial only when Edge `partial` |
| `src/lib/ownerDeletionBlastRadius.ts` | Confirm phrase or org name |
| `src/lib/hardDeleteVerification.ts` | DB vs auth count helpers |
| `src/lib/organizationDeletionState.ts` | 15-minute pending TTL |
| `src/lib/selfDeleteHealth.ts` | `ownerDeleteReadinessFromSnapshot` |
| `supabase/migrations/148_owner_self_delete_reliability.sql` | Verify order, confirm, RESTRICT deletes, probe |
| `supabase/functions/_shared/certifiedHardDelete.ts` | Auth-gone idempotency; partial iff org gone |
| `supabase/functions/owner-permanently-delete-account/index.ts` | Probe after `getUser` |
| `src/lib/i18n.ts` | Safe owner copy (en + lg) |

# Phase 39.4 — Production Account Deletion Deployment & Destructive Certification

**Date:** 2026-08-13  
**Prerequisite:** Phase 39.3 — CONDITIONAL GO  
**Mode:** Controlled deployment + verification  
**Production:** `ljaedextsenbkxzzgxcg`  
**Staging:** `wdirxwvbgsfzbdurmkbf`

No POS, checkout, sync, reporting, or auth-architecture changes. No production organization was deleted.

---

# PHASE 39.4 RESULT

## Executive verdict

### **CONDITIONAL GO**

Migration 148 and `owner-permanently-delete-account` are on **staging and production**. A dedicated staging throwaway organization was created and fully erased through the owner Edge Function. Database rows, owner/staff auth users, and post-delete login are certified on staging.

This is not an unconditional GO for a live `pos.waka.ug` owner click-through:

- Staging cert used the same Edge + RPC path, not a browser session of `/office/account/delete`.
- Local namespace wipe / enterprise logout / `/login` redirect are certified in repository tests and code, not a live device session.
- No destructive production deletion was executed (by design).

Do not run owner delete against a real production shop.

---

## Deployment

| Item | Result |
|------|--------|
| Staging migration 148 | **PASS** |
| Staging Edge Function | **PASS** — ACTIVE, `verify_jwt=true` |
| Production migration 148 | **PASS** — recorded as `148` / `owner_self_delete_reliability` |
| Production Edge Function | **PASS** — ACTIVE, `verify_jwt=true`, **version 8** (was v7) |

Staging functions verified after 148:

- `owner_permanently_delete_own_account` (text + text,text) — SECURITY DEFINER
- `certified_hard_delete_organization_execute` — SECURITY DEFINER; deletes `table_sessions` then sales then transfers
- `hard_delete_verification_report` — SECURITY DEFINER
- `hard_delete_merge_auth_verification` — SECURITY DEFINER
- Confirmation: `DELETE PERMANENTLY` or exact org name
- One leftover one-arg `owner_permanently_delete_own_account(text)` overload remains for compatibility (not conflicting)

Ask WAKA staging shop `STG-01` was left intact.

---

## Staging deletion

Throwaway org `phase394-f0e11953` / shop `P394F0E1` (owner + staff + product, customer, sale, payment, expense, drawer movement, day close, device).

| Check | Result |
|------|--------|
| Organization deletion | **PASS** |
| Business data cleanup | **PASS** — orgs/shops/products/sales/customers/expenses/drawer/day closes/devices/members all 0 |
| Auth cleanup | **PASS** — owner and staff `404` |
| Local wipe | **PASS** in repository (`finalizeOwnerAccountDeletionLocally` + pending tests). Not a live browser session. |
| Login block | **PASS** — password grant after delete returns 400, no access token |

Edge probe: unauthenticated `401`; authenticated `{ ok: true, probe: true }` after `getUser()`.

---

## Failure tests

| Case | Result |
|------|--------|
| A. Network interruption | **PASS** — dead host; org still present; no false success |
| B. Expired reauthentication | **PASS** — `last_sign_in_at` aged 20 minutes → `reauth_required`; org not deleted |
| C. Already deleted auth user | **PASS** — second admin delete is 404 / user-not-found (treated as gone) |
| D. Partial cleanup | **PASS** in repository (`ownerDeletionPartial.test.ts`). Live partial was not forced after the HTTP 200 success path was repaired. |

---

## Security

- Owner-only RPC (`user_is_shop_owner` + first owner membership). Internal admins still blocked.
- Owner page still has no `SelfDeleteHealthPanel` / `HardDeleteReportPanel` / deploy-command leaks (surface tests PASS).
- Owner-facing errors stay READY / unavailable / safe i18n copy.
- Network and expired-reauth paths did not delete the org (no false success).

---

## Deploy-blocking Edge fix (required for cert)

Staging first full-delete attempts erased the org/auth but returned raw HTTP 500 because:

`userClient.rpc(...).catch is not a function`

on `owner_self_delete_auth_audit` after success.

Minimal fix (no UX/auth redesign):

- `try/await/catch` around audit RPCs
- `try/catch` around merge verification after auth delete
- top-level handler catch so unhandled errors return JSON, not a blank 500

Redeployed to staging (cert then **PASS**) and production v8.

---

## Remaining risks

1. Live owner UI session (READY banner → confirm → reauth → wipe → `/login`) was not clicked in a browser.
2. Production destructive delete was not run and must not be run on a real shop.
3. `admin-permanently-delete-shop-account` was not redeployed in this phase (still v11).
4. One-arg `owner_permanently_delete_own_account(text)` overload still exists beside the two-arg 148 function.

---

## Preserved

- Close Day / POS / checkout / sync / reporting untouched
- No production customer data deleted
- CLI link restored to production `ljaedextsenbkxzzgxcg`

## Exact files

| Path | Role |
|------|------|
| `supabase/migrations/148_owner_self_delete_reliability.sql` | Applied staging + production |
| `supabase/functions/owner-permanently-delete-account/index.ts` | Probe after getUser; audit try/catch |
| `supabase/functions/_shared/certifiedHardDelete.ts` | Auth-gone idempotency; merge try/catch |
| `scripts/staging/phase_39_4_throwaway_delete.py` | Staging-only throwaway cert (refuses production) |

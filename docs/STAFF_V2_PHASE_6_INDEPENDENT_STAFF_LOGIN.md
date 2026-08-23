# STAFF V2 — PHASE 6: INDEPENDENT STAFF LOGIN + SESSION HYDRATION

**Mode:** Implementation complete.  
**Date:** 2026-08-23  
**Live:** `ljaedextsenbkxzzgxcg` — 158–161 applied. 151–157 unapplied.

---

## Verdict

**PHASE 6 COMPLETE — Auth staff can operate on their own JWT and ledger.**

PIN / `signInStaff` / `staff:` / seller attribution frozen and unchanged.

---

## What changed

1. **`hydrateStaffAuthWorkspace`** — force-pulls cloud state into `sb:<staffUUID>` without owner onboarding gates.
2. **`useAuth.ensureWorkspaceForSession`** — after invite accept or non-owner `shop_members`, hydrate and never call owner bootstrap/repair.
3. **`StaffAcceptPage` / `ownerWorkspaceOnSignIn`** — hydrate immediately after accept.
4. **`OnboardingRouteGate`** — loads `shop_members` role; non-owners skip owner wizard.
5. **Device pending copy** — staff told account waits for owner approval (approval not bypassed).
6. **Login UX** — email/password for invited workers; PIN panel labeled shared-terminal only.

---

## Frozen

- `sessionActor.ts` `staff:` prefix  
- `signInStaff` JWT sign-out  
- `cloudSync` created_by / sold_by_user_id  
- `rowToSale`, dashboards, filters  
- Migrations 158–161  

---

## STOP

Do not start Phase 7 (seller validation) until approved.

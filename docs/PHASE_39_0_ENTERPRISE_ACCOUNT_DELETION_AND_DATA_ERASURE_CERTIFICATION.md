# Phase 39.0 — Enterprise Account Deletion & Data Erasure Certification

**Date:** 2026-08-11  
**Mode:** READ-ONLY forensic audit (no source / migration / data changes)  
**Production target:** WAKA POS — Web + Android + iOS/Capacitor  
**Shipped code reference:** `main` at audit time (includes certified hard-delete path)

---

## Executive verdict

### **CONDITIONAL GO**

WAKA has a **real, certified server-side hard-delete pipeline** for owner self-delete and internal-admin permanent delete. It is **not** “logout” and **not** “clear Zustand only.”

The path is:

```text
AccountDeletionPage (/office/account/delete)
  → ack + typed confirm + window.confirm
  → password / Google reauth (5 min)
  → edge owner-permanently-delete-account
  → SQL prepare + certified_hard_delete_organization_execute
  → auth.admin.deleteUser (owner + staff)
  → verification report (all counts must be 0)
  → wipeAccountNamespace + mark deleted
  → performEnterpriseLogout → /login
```

**CONDITIONAL GO** because:

1. Live Supabase erasure against a controlled test org was **not** executed in this audit (**NOT VERIFIED** end-to-end in production).  
2. UI copy understates blast radius (org / all shops / staff logins / subscriptions).  
3. A few local/offline edge cases remain (pending marker on failed attempt; Capacitor Preferences not wiped).

**No P0** found in repository forensics (wrong-user delete bypass, local-only fake success, or missing backend authorization gate).  
**Do not implement fixes in this phase** — audit only.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| Owner self-delete UI + edge + SQL | Live destructive test against real shops |
| Admin permanent delete (same pipeline) | Changing policies / migrations |
| Local wipe / sync block / logout | Archive-only local wipe (`ArchiveDataPage`) |
| Role access | Soft-delete product features |

---

## User journey

### How a normal owner finds it

| Entry | Path | Gate |
|-------|------|------|
| Account page rose card | `/office/account` → `/office/account/delete` | `actor.role === "owner"` + Supabase configured |
| AppShell user menu | `userMenuDeleteAccount` → delete route | Owner + Supabase + **not** staff session |
| Direct URL | `/office/account/delete` | `OwnerProtectedRoute` |

### Role matrix

| Role | Can open Account? | Can delete? |
|------|-------------------|-------------|
| Owner | Yes (`settings.view`) | **Yes** |
| Manager / Supervisor | Yes if `settings.view` | **No** → redirected to `/office/account` |
| Staff / Cashier | Typically no settings | **No** |
| Waka super_admin | Internal admin console | Separate admin panel → same org hard-delete |

---

## UI findings (what the page actually says)

Source: `AccountDeletionPage.tsx` + `i18n` keys `accountDeletion*`.

| Topic | What UI says today |
|-------|--------------------|
| Title | “Delete account permanently” |
| Subtitle | “Remove your **shop**, all business data, and login from Waka cloud.” |
| Irreversible | “permanent and cannot be undone” |
| Lists | Sales/receipts; products/stock; customers/debts/suppliers; cloud backups/sync; login; devices disconnected |
| Re-register | Same email can register again after completion |
| Staff logins | **Not mentioned** |
| All shops / whole organization | **Not mentioned** (copy says “shop”) |
| Subscriptions / billing / Vision | **Not mentioned** |
| What is retained | Implies nothing retained; no legal retention caveat |

Destructive styling is clear (rose danger zone, large rose submit). Loading/disabled when busy or backend health fails. Mobile layout is a single scrollable form (observed previously on Simulator Danger Zone).

---

## Confirmation safety

| Step | Present? |
|------|----------|
| Checkbox acknowledgement | ✅ |
| Typed `DELETE PERMANENTLY` or exact shop name | ✅ |
| `window.confirm` final warning | ✅ |
| Password and/or Google reauth (5 min) | ✅ |
| Busy disable on submit | ✅ |
| Backend health gate (RPC + edge) | ✅ |
| PIN gate | ❌ not used |
| Double-submit lock beyond `busy` | Partial — relies on `busy` state |

Strength: appropriate for irreversible delete **if** copy matches blast radius.  
Gap: shop-name confirm can feel like “this shop only” while backend deletes the **organization**.

---

## Authentication / re-authentication

| Layer | Behavior |
|-------|----------|
| Client | `ownerDeleteReauth.ts` — password `signInWithPassword` or Google id-token; `sessionStorage` marker TTL **5 minutes**; also accepts recent `last_sign_in_at` |
| Client assert | `assertRecentOwnerDeleteReauth` before edge invoke |
| Server | Edge checks session recently reauthenticated (`last_sign_in_at` ≤ 5 min) |
| PIN | Not accepted as delete credential |
| Staff session | Menu entry hidden when `staffSession` active |

**Not P0:** server rechecks reauth; frontend marker alone is insufficient.  
**P2:** reauth marker lives in `sessionStorage` (tab-scoped); acceptable with server gate.

---

## Backend deletion findings (MOST IMPORTANT)

### Authoritative units

| Unit | Behavior |
|------|----------|
| Delete unit | **Organization** (`delete from public.organizations`) |
| Shops | Cascaded via `shops.organization_id → organizations ON DELETE CASCADE` |
| Owner path | Edge `owner-permanently-delete-account` → RPCs from migration **112** |
| Admin path | Edge `admin-permanently-delete-shop-account` → **same** `certified_hard_delete_organization_execute` |
| Auth users | After DB execute: `auth.admin.deleteUser` for **all org user ids** (owner + staff) |
| Soft delete? | **No** — hard delete + verification |
| Local-only delete? | **No** for success path — local wipe only after `result.ok` |

### Execute sequence (SQL `certified_hard_delete_organization_execute`)

1. Collect org shop ids + user ids  
2. Audit “started” (then later shop audit rows are wiped)  
3. Revoke `shop_devices`  
4. Delete support requests, audit logs  
5. Release shop numbers  
6. Delete agent referrals / marketing agents / profiles  
7. Explicit `delete from sales` for org shops  
8. `delete from organizations` (cascades shops + dependents)  
9. `hard_delete_verification_report` — **all counts must be 0** or `verification_failed`

### Verification counts (must be zero)

organizations, shops, products, sales, customers, suppliers, purchases, shifts, inventory_counts, stock_movements, cloud_snapshots, devices, **subscriptions**, audit_logs, support_requests, owner_auth_account, staff_auth_accounts

### Live production erasure

**NOT VERIFIED — requires controlled test against Supabase.**  
Repository proves the intended pipeline; this audit did not run a real delete.

---

## Business ownership findings

| Question | Answer from code |
|----------|------------------|
| Delete account = delete user only? | **No** |
| Delete entire shop/business? | **Yes — entire organization** (all shops under it) |
| Ownership transfer? | **No** |
| Block delete while owning business? | **No** — owning the business **is** the delete target |
| Orphaned shop? | Designed **not** to — org delete + verification |
| Staff memberships | Staff auth users collected and deleted |
| Multi-shop org | All shops under org removed |

Critical product truth: Owner self-delete is **business closure**, not personal-profile removal while keeping the shop.

---

## Data deletion matrix

| Data | Current behavior | Verified? | Risk |
|------|------------------|-----------|------|
| Auth user (owner) | Hard delete via `auth.admin.deleteUser` | Code ✅ / Live ❌ | Partial auth failure handled |
| Auth users (staff) | Same | Code ✅ / Live ❌ | UI does not warn |
| Profile | Explicit delete then org cascade | Code ✅ / Live ❌ | Low |
| Organization | Hard delete | Code ✅ / Live ❌ | Low |
| Shops | Cascade from org | Code ✅ / Live ❌ | UI says “shop” singular |
| Staff rows / devices | Devices revoked; shop cascade | Code ✅ / Live ❌ | Low |
| Products / inventory | Cascade; verification counts | Code ✅ / Live ❌ | Low |
| Sales / receipts | Explicit sales delete + cascade | Code ✅ / Live ❌ | No retention hold |
| Ledger / cash / shifts | Cascade via shop; shifts in verification | Code ✅ / Live ❌ | Financial retention policy unclear |
| Customers / suppliers | Verification counts | Code ✅ / Live ❌ | Low |
| Audit logs | Explicit delete | Code ✅ / Live ❌ | Erased (no long-term retain) |
| Subscriptions | Org cascade; verification requires 0 | Code ✅ / Live ❌ | Billing provider side **NOT VERIFIED** |
| Vision settings | `shop_vision_settings.shop_id ON DELETE CASCADE` | Cascade ✅ / Live ❌ | Not named in UI |
| Cloud snapshots | Verification count | Code ✅ / Live ❌ | Low |
| Local Zustand / IndexedDB | `wipeAccountNamespace` + IDB wipe + syncQueue clear | Code ✅ | Capacitor Prefs gap |
| Sync queue | Cleared in IDB namespace wipe | Code ✅ | Pending marker on failed attempt |
| Capacitor Preferences | **Not wiped** | Code ✅ | P3 residual prefs |

Legend: Code ✅ = repository path found; Live ❌ = no controlled Supabase erase run in this audit.

---

## Local / offline cleanup

| Mechanism | Behavior |
|-----------|----------|
| Pre-flight | `markOwnerDeletionInProgress` → pending deletion marker (blocks sync) |
| Success | `finalizeOwnerAccountDeletionLocally` → mark deleted + `wipeAccountNamespace` + `supabase.auth.signOut` |
| Logout | `onSignOut` → `performEnterpriseLogout` → `/login` |
| Sync after wipe | `assertOrganizationOperationsAllowed` / wipe markers block ops |
| Offline delete request | Requires edge/network; submit disabled if health not ok — **no offline “deleted” claim** |
| Failed delete after pending mark | Marker not cleared in `runDelete` failure path; may clear later via `refreshOrganizationDeletionState` if org still exists | **P2** |
| Other devices | Not wiped remotely beyond device revoke + auth delete; other devices discover org absence on refresh | Expected |

**Critical safety:** Success UI / local wipe only runs when `result.ok` is true — does **not** claim success on local-only clear after server failure. Partial auth failure shows dedicated retry UI.

---

## Subscription / entitlements

| Item | Behavior |
|------|----------|
| `subscriptions` rows | Expected removed with org; verification requires count 0 |
| External payment provider (Stripe/etc.) | **NOT VERIFIED** from this audit |
| Vision entitlement | Shop-scoped settings cascade with shop |
| Recreate account | UI promises same email can re-register after full success |

---

## Security findings

| ID | Sev | Finding |
|----|-----|---------|
| — | P0 | **None identified** in code forensics |
| AD-1 | **P1** | UI understates blast radius: deletes **organization + all shops + staff auth users**, while copy emphasizes “your shop” and omits staff/subscription/Vision |
| AD-2 | **P1** | Informed-consent gap for **staff login destruction** (backend deletes staff auth users; UI silent) |
| AD-3 | **P2** | Failed delete leaves **pending** deletion marker until cloud refresh reconciles — temporary local lock |
| AD-4 | **P2** | Financial/audit hard erase with **no retention/hold explanation** in UI (may be policy-sensitive) |
| AD-5 | **P2** | External billing cancellation **NOT VERIFIED** |
| AD-6 | **P3** | Capacitor Preferences not included in wipe |
| AD-7 | **P3** | Relies on `window.confirm` (WebView-dependent UX) |
| AD-8 | **P3** | Discoverability: Owner-only; Managers/Staff correctly blocked but may not know only Owner can close business |

Authorization: owner edge uses owner JWT + RPC; admin edge uses internal super_admin. Frontend role checks are not the only gate.

---

## Mobile findings

| Aspect | Assessment |
|--------|------------|
| Shared WebView implementation | ✅ same React page |
| Portrait form | Scrollable danger zone + ≥48px controls |
| Keyboard / password field | Present for email identities |
| Safe areas | Depends on settings chrome; not a dedicated sheet |
| Android / iOS lab | **OPEN** for full device matrix |
| Prior Simulator sighting | Danger Zone form observed earlier in M1.4-R2-R1 session (not re-run here) |

---

## Accessibility

| Check | Assessment |
|-------|------------|
| Labels on inputs | Present |
| Checkbox label | `WakaCheckbox` labeled |
| Destructive button name | Clear (“Permanently delete my account”) |
| Heading structure | Header component title |
| Focus trap / modal | Uses `window.confirm`, not an app modal trap |
| Screen reader consequence list | List present; missing staff/org scope |

---

## Score

| Dimension | Score | Notes |
|-----------|------:|-------|
| Account deletion UI | **7.0** | Strong danger styling; incomplete consequence copy |
| Confirmation safety | **8.5** | Ack + type + confirm + reauth |
| Authentication | **8.5** | Client + server 5‑min reauth |
| Backend deletion | **9.0** | Certified execute + verification report |
| Business ownership | **7.5** | Correct as business closure; poorly explained |
| Data integrity | **8.5** | Verification gate; live unproven |
| Financial records | **7.0** | Hard erased; retention policy undocumented |
| Local cleanup | **8.0** | Strong wipe; prefs/pending gaps |
| Offline behavior | **8.5** | No fake offline success |
| Subscription cleanup | **7.0** | DB path yes; billing provider unknown |
| Security | **8.5** | No P0 found; consent gaps |
| Error handling | **8.5** | Partial auth retry path |
| Mobile UX | **7.5** | Shared; lab OPEN |
| Accessibility | **7.0** | Adequate; confirm dialog weak |
| **OVERALL** | **8.0 / 10** | |

---

## Exact files / functions

| Layer | Path | Symbols |
|-------|------|---------|
| UI | `src/pages/AccountDeletionPage.tsx` | `runDelete`, `verifyIdentity`, `finishSuccess` |
| Account entry | `src/pages/AccountPage.tsx` | delete card |
| Menu | `src/components/layout/AppShell.tsx` | `userMenuDeleteAccount` |
| Route | `src/App.tsx` | `office/account/delete` + `OwnerProtectedRoute` |
| Client API | `src/lib/ownerAccountDeletion.ts` | `ownerPermanentlyDeleteOwnAccount`, `finalizeOwnerAccountDeletionLocally` |
| Reauth | `src/lib/ownerDeleteReauth.ts` | password / Google / TTL |
| Local wipe | `src/lib/accountDataWipe.ts`, `src/offline/localDb.ts` | `wipeAccountNamespace`, `wipeIndexedDbNamespace` |
| Lock | `src/lib/organizationDeletionState.ts` | markers / `assertOrganizationOperationsAllowed` |
| Logout | `src/lib/auth/enterpriseLogout.ts` | `performEnterpriseLogout` |
| Edge | `supabase/functions/owner-permanently-delete-account/index.ts` | |
| Edge | `supabase/functions/admin-permanently-delete-shop-account/index.ts` | |
| Shared | `supabase/functions/_shared/certifiedHardDelete.ts` | `runCertifiedHardDelete` |
| SQL | `supabase/migrations/112_certified_hard_delete.sql` | `certified_hard_delete_organization_execute`, verification |
| Admin UI | `src/components/internal-admin/AdminPermanentDeletePanel.tsx` | |
| Health | `src/lib/selfDeleteHealth.ts`, `SelfDeleteHealthPanel.tsx` | |

---

## Verification limitations

1. No controlled live delete against Supabase in this audit.  
2. No proof of external billing provider cancellation.  
3. Android + iOS full interaction lab not re-run here.  
4. Cascade coverage for every table relies on FK design + verification subset — exotic tables outside the report are **NOT VERIFIED** individually.  
5. Multi-device residual cache behavior not lab-tested.

---

## Recommended next implementation phase (do not start here)

### **Phase 39.1 — Account Deletion Consent & Blast-Radius Clarity** (presentation + safety copy)

Scoped, non-engine:

1. Explicitly state: deletes **entire organization / all shops**, **all staff logins**, **subscriptions**, devices, and business data.  
2. Clarify irreversible / no ownership transfer.  
3. On failed cloud delete, clear or reconcile **pending** marker immediately in UI path.  
4. Optional: mention Vision / billing cancellation status once billing path verified.  
5. Controlled **staging erase test** checklist → then re-certify toward GO.

Do **not** weaken confirmation or remove server reauth.

---

## Final rule reminder

> Do not fix anything in this phase.  
> Audit first.

**Verdict: CONDITIONAL GO** — certified hard-delete architecture is real and serious; consent clarity + live staging verification remain before production **GO**.

---

*End of Phase 39.0 — read-only certification. No source code was modified.*

---

### Phase 39.1 — Consent & Deletion Safety Repair

**Date:** 2026-08-11  
**Mode:** Scoped implementation (deletion engine preserved)  
**Prerequisite:** Phase 39.0 audit

#### Changes

| 39.0 finding | Repair |
|--------------|--------|
| P1 misleading “shop” scope | Organization-level titles, body, submit label (**Delete organization**), Account card + user menu |
| P1 staff auth undisclosed | Explicit blast-radius warning + list item that staff logins are deleted |
| P2 pending marker after failure | `clearOwnerDeletionPendingOnFailure()` on non-partial failure; escalate pending → deleted on partial cloud success |
| P2 billing unverified | Honest billing note; **no** “subscription cancelled” claim; org subscription **records** listed as removed with org |

#### Blast-radius presentation

`loadOwnerDeletionBlastRadius` loads real organization name, shop count, and distinct non-owner membership user ids when cloud data is available. If unavailable, generic accurate wording is shown (no invented counts).

#### Retry / ordering preserved

- Server-first: wipe + enterprise logout only after `result.ok`
- Typed confirm + password/Google reauth unchanged in strength
- SQL 112 / edge / `auth.admin.deleteUser` / verification **untouched**

#### Billing

**BILLING CANCELLATION — NOT VERIFIED**

- WAKA stores org `subscriptions` rows (removed by org hard-delete + verification).
- `subscriptionEngine.cancel` exists for admin/status flows; **owner delete edge does not call external Flutterwave/Stripe cancellation**.
- UI states WAKA does not claim external provider cancellation; support contact for residual charges.

#### Files changed

- `src/pages/AccountDeletionPage.tsx`
- `src/lib/ownerAccountDeletion.ts`
- `src/lib/ownerDeletionBlastRadius.ts` (+ test)
- `src/lib/ownerAccountDeletion.pending.test.ts`
- `src/lib/i18n.ts` (en + lg)

#### Files intentionally untouched

- `supabase/migrations/112_certified_hard_delete.sql`
- Edge `owner-permanently-delete-account` / `certifiedHardDelete.ts`
- POS Sell / Checkout / Inventory / Vision / Cash Drawer / EOD

#### Remaining verification

1. Controlled **staging** organization erase test (not production customers).  
2. External billing provider cancellation integration (future phase if product requires).  
3. Android + iOS visual pass of revised warning form.

#### Phase 39.1 verdict

**CONDITIONAL GO** — consent + pending-marker safety fixed; engine intact; live staging erase + external billing still open.

*End of Phase 39.1 notes.*

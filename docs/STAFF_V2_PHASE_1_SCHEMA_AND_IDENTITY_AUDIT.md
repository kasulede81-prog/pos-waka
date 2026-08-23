# STAFF V2 — PHASE 1 SCHEMA AND IDENTITY AUDIT

**Scope:** Existing identity tables, `shop_members`, `shop_pos_staff`, auth paths, invitation readiness, sales identity contract, multi-shop, PIN/shared terminal, RLS.  
**Mode:** Static compatibility audit for a future Staff Identity V2. No implementation.  
**Date:** 2026-08-23  
**Repo:** pos-waka (`main`)

Legend:

- **EVIDENCE** — proven from current repository files.
- **INFERENCE** — logically follows from evidence; needs a live shop to confirm frequency/impact.
- **RECOMMENDATION** — architecture advice only. Do not treat as implemented.

Related prior audit: `docs/STAFF_ARCHITECTURE_FORENSIC_AUDIT.md` (staff sales attribution rewrite). This document does not repeat that forensic work except where it constrains V2.

---

# 1. Executive Verdict

**B. FOUNDATIONS CAN BE REUSED WITH CONTROLLED EXTENSIONS**

WAKA already has the correct *shape* for Staff V2:

```
auth.users.id  →  shop_members (shop_id, user_id, role)  →  shop-scoped RLS
```

That membership table already exists, already has `UNIQUE(shop_id, user_id)`, already allows one auth user on many shops, and already gates sales/inventory RPCs via `auth.uid()` helpers.

What does **not** exist — and what currently breaks staff sales — is the *identity contract* used by POS staff:

- Cashiers are **not** `auth.users`.
- They live in `preferences.staffAccounts` + `public.shop_pos_staff`.
- Session actors are `staff:<id>`.
- Cloud `sales.created_by` can only store `auth.users.id`.
- Sync therefore rewrites the seller to the owner.

**Do not replace `shop_members`.**  
**Do not treat `shop_pos_staff` as the long-term identity.**  
**Do not start invitation/email onboarding until the membership + sales seller contract is specified.**

Staff V2 can be built on the existing schema if Phase 2+ add (later, not now):

1. A way for a staff person to become an `auth.users` row.
2. A `shop_members` row for that user on the target shop.
3. A sales field that means “commercial seller” and is allowed to be that user’s UUID.
4. PIN as local verification of that same user, not a second identity.

---

# 2. Current Identity Diagram

**EVIDENCE — actual architecture today, not the proposed V2.**

```
                         auth.users
                              │ id
                              ▼
                         public.profiles
                         (1:1, PK = auth.users.id)
                         + primary_shop_id
                              │
              ┌───────────────┴────────────────┐
              ▼                                ▼
     organization_members                 shop_members
     (org_id, user_id, role)              (shop_id, user_id, role)
     UNIQUE(org, user)                    UNIQUE(shop, user)
     roles: owner/admin/                  roles: owner/manager/cashier/
            billing/staff                        stock_keeper/waiter/viewer
              │                                │
              ▼                                ▼
        organizations ──────── shops ──────── shop-scoped business tables
                         shop_id               sales, products, inventory, …

SEPARATE IDENTITY SYSTEM (not linked to auth.users):

        preferences.staffAccounts (IndexedDB / Zustand)
                    │ client id (StaffAccount.id)
                    ▼
              public.shop_pos_staff
              PK = shop_pos_staff.id
              client_id = local staff id
              NO user_id column
                    │
                    ▼
              SessionActor.userId = "staff:" + staffId
                    │
                    ▼
              Sale.soldByUserId  (local)
                    │
                    ▼  isUuid()?  NO
              sales.created_by = owner auth.uid()   ← rewrite

DEVICES (shop-scoped, not people):

        shop_devices
        current_staff_client_id  → shop_pos_staff.client_id
        shop_security_credentials.pin_hash  (shop / back-office PIN, not staff)

NO shop invitation table.
NO shop_members.status.
NO shop_pos_staff → auth.users FK.
```

Three concurrent identity planes:

| Plane | Canonical key | Cloud auth? | Used for sales attribution today |
|-------|---------------|-------------|----------------------------------|
| Supabase Auth + `shop_members` | `auth.users.id` UUID | Yes | Owner / any UUID `soldByUserId` |
| PIN staff (`shop_pos_staff` + local cache) | `staff:<uuid>` | No (PIN login signs out Auth) | Local only; rewritten on push |
| Local/dev email | `local:<email>` | No | Local only; rewritten on push |

---

# 3. shop_members Verdict

**Verdict: B. REUSE WITH CONTROLLED EXTENSION**

Not A (reuse as-is): missing invitation, status, seller onboarding, and several POS roles.  
Not C (replace): the table already is `auth.users → shop` with the uniqueness V2 needs.

## 3.1 Current schema

**EVIDENCE** — created in `supabase/migrations/003_organizations_and_shops.sql`.

| Item | Value |
|------|--------|
| Table | `public.shop_members` |
| PK | `id uuid` default `gen_random_uuid()` |
| FKs | `shop_id → shops(id)` ON DELETE CASCADE; `user_id → auth.users(id)` ON DELETE CASCADE |
| Shop/org | Shop-scoped. Shop belongs to `organizations` via `shops.organization_id`. |
| Auth relationship | **Yes. Direct `user_id` FK to `auth.users`.** |
| Role field | `role text not null default 'cashier'` |
| Status field | **None.** No `active` / `invited` / `suspended` / `removed`. |
| Unique | `UNIQUE (shop_id, user_id)` — constraint name used later as `shop_members_shop_id_user_id_key` (`117_fix_bootstrap_owner_workspace_ambiguity.sql`) |
| Extra unique | Partial unique index `shop_members_one_owner_per_shop` on `(shop_id) WHERE role = 'owner'` (`095_identity_trust_hardening.sql`) |
| Indexes | `shop_members_user_idx (user_id)`, `shop_members_shop_idx (shop_id)` |
| Other columns | `created_at` only |

Role check evolution (**EVIDENCE**):

| Migration | Allowed roles |
|-----------|----------------|
| `003` | `manager`, `cashier`, `viewer` |
| `013` / `015` | `owner`, `manager`, `cashier`, `stock_keeper`, `viewer` |
| `072_hospitality_mode.sql` (**current**) | `owner`, `manager`, `cashier`, `stock_keeper`, `waiter`, `viewer` |

**EVIDENCE:** `shop_members` cannot store `supervisor`, `kitchen`, or `bar`. Those exist on `shop_pos_staff` (`123_shop_staff_device_architecture_phase1.sql`) and in client `UserRole` (`src/lib/permissions.ts`).

## 3.2 RLS

**EVIDENCE** — `supabase/migrations/008_row_level_security.sql`:

| Policy | Command | Rule |
|--------|---------|------|
| `shop_members_select` | SELECT | `user_can_access_shop(shop_id)` |
| `shop_members_write` | INSERT | `user_can_manage_shop(shop_id)` |
| `shop_members_update` | UPDATE | `user_can_manage_shop(shop_id)` |
| `shop_members_delete` | DELETE | `user_can_manage_shop(shop_id)` |

`user_can_access_shop` (`007_functions_and_triggers.sql`): shop membership **or** org `owner`/`admin`.

`user_can_manage_shop` (**current**, `029_shop_owner_manage_shop_rls.sql`): shop `owner`/`manager` **or** org `owner`/`admin`.

**EVIDENCE answers:**

1. **Does it connect `auth.users.id` → shop?** Yes.
2. **Can one auth user belong to multiple shops?** Yes. Uniqueness is per `(shop_id, user_id)`, not per user globally. `list_user_shops()` already aggregates all memberships (`095`).
3. **UNIQUE(shop_id, user_id)?** Yes.
4. **Roles:** single text column. No permissions column on `shop_members`.
5. **Permissions:** not stored on membership. Client derives from `UserRole` + optional `preferences.customStaffRoles` for PIN staff. Cloud RPCs check membership role via helpers, not a permission JSON.
6. **Statuses:** none. Soft-remove today = DELETE the row (or never create one). PIN staff “inactive” lives on `shop_pos_staff.is_active`, not here.
7. **Can an owner add a membership today?**  
   - **Via RLS:** yes, if they pass `user_can_manage_shop` they may INSERT.  
   - **Via product UI / dedicated RPC:** **no Staff V2 add-member RPC exists.** Frontend never inserts `shop_members` except indirectly through owner bootstrap RPCs. Staff UI writes `shop_pos_staff` (`src/lib/shopStaffCloud.ts`).
8. **Can an ordinary authenticated user insert themselves into an existing shop?**  
   **No via RLS** — they do not have `user_can_manage_shop` on that shop.  
   **Yes via `bootstrap_owner_workspace`** — but that creates **their own** org/shop as owner, it does not join someone else’s shop (`014` and later replacements).
9. **Privilege escalation controls:**  
   - Single-owner trigger `trg_shop_members_enforce_single_owner` (`095`, idempotent fix `118`).  
   - Role check constraint.  
   - Manage policies require owner/manager.  
   - **Gap (EVIDENCE):** a shop **manager** can INSERT/UPDATE `shop_members` through RLS and change another member’s role (except becoming a second owner). There is no WITH CHECK that prevents a manager from promoting a cashier to manager.
10. **Does RLS enforce membership correctly for data access?** For shop-scoped tables, yes — `user_can_access_shop` / `user_is_cashier_or_above` / `user_is_shop_owner`. Org owners can see all shops in the org without a per-shop row.
11. **RPCs that create/change memberships:** only owner-workspace bootstrap / repair paths insert `shop_members` (always `role = 'owner'` for `auth.uid()`). Examples: `014`, `017`, `030`, `031`, `036`, `044`, `049`, `056`, `078`, `095` repair, `114`, `117`, `134`. There is **no** `shop_add_member` / `shop_accept_invitation` RPC.
12. **Already used by:**
    - **Sales authorization:** `shop_push_sale_complete` requires `user_is_cashier_or_above` (`063`).
    - **Inventory authorization:** movement RLS and stock RPCs use the same helpers (`008`, `082`, `109`).
    - **Staff management (PIN staff):** `shop_pos_staff_*` RPCs require `user_can_access_shop` / owner / manager — i.e. a `shop_members` (or org admin) principal, not the PIN staff row.
    - **Dashboard / role:** `fetchShopMemberRoleForUser` (`src/lib/shopMemberRole.ts`) reads `shop_members.role` for the **primary** shop only. `resolveAuthRole` fail-closes to `waiter` if missing (`src/lib/permissions.ts`).
13. **Structural blockers for canonical membership?** None that require replacing the table. Gaps are missing columns (status, invited_by), missing roles vs POS, missing invitation RPC, and the fact that cashiers are not members today.

## 3.3 Frontend readers/writers

| File | Access |
|------|--------|
| `src/lib/shopMemberRole.ts` | SELECT role for primary shop |
| `src/lib/fetchShopSubscription.ts` | SELECT to resolve primary shop |
| `src/lib/primaryShop.ts` | RPC `list_user_shops` / `set_user_primary_shop` |
| `src/lib/businessProfile.ts` | SELECT |
| `src/lib/ai/businessSetupAi.ts` | SELECT |
| `src/lib/ownerDeletionBlastRadius.ts` | SELECT user_ids |
| `src/components/settings/PrimaryShopSelector.tsx` | shop switcher for users who already have multiple memberships |
| `src/lib/enterprise/organizationContext.ts` | lists shops for enterprise branch count |

No client INSERT into `shop_members` for staff.

---

# 4. shop_pos_staff Verdict

**Future role: shop-scoped staff profile + PIN / shared-terminal verification. Not the canonical user identity.**

**EVIDENCE:** created in `095_identity_trust_hardening.sql`. Extended in `123` (email, lockout, extra roles) and `126` (security window fields). Version log in `125` (`shop_pos_staff_revisions`).

## 4.1 Does every row correspond to an auth.users user?

**No. There is no `user_id` column and no FK to `auth.users`.**

Identity systems that exist today: **three** (Auth membership, PIN staff, local email). See §2.

## 4.2 Field classification

| Field | What it is today | V2 class |
|-------|------------------|----------|
| `id` | Cloud row PK; sometimes sent as staff id | **LEGACY** as person identity; **KEEP** as profile row PK |
| `shop_id` | Employment / shop binding | **KEEP** |
| `client_id` | Local `StaffAccount.id` / device cache key | **KEEP** (sync). Not an auth id. |
| `name` | Display / employment profile | **KEEP** / later **MIGRATE** toward `profiles.full_name` when linked |
| `username` | PIN login identifier | **KEEP** for shared terminal |
| `email` | Optional profile (`123`) | **KEEP** as invite/login hint; not proof of Auth account |
| `phone_e164` | Profile | **KEEP** |
| `role` | PIN staff role (includes supervisor/kitchen/bar) | **DERIVE** from `shop_members.role` once linked; until then **KEEP** |
| `permissions` jsonb | Cached custom permissions | **DERIVE** from role + shop custom roles |
| `pin_hash` / `password_hash` | PIN / password auth | **KEEP** as local verification secrets |
| `is_active` / `deleted_at` | Employment status | **MIGRATE** toward membership status; **KEEP** until then |
| `last_login_*`, `failed_*`, `locked_until`, `failures_in_window`, `pin_changed_at`, `password_changed_at` | PIN security | **KEEP** |
| `last_device_fingerprint` | Device binding | **KEEP** (terminal), not identity |
| `created_at` / `updated_at` | Sync metadata | **KEEP** |

## 4.3 Answers

1. **Auth user per row?** No.
2. **How many identity systems?** Three (Auth/`shop_members`, PIN/`shop_pos_staff`, local email).
3. **Can it become a profile extension linked to `user_id`?** **Yes, safely as an additive nullable `user_id`.** Do not change `id` meaning in the same step.
4. **What breaks if `shop_pos_staff.id` stops being the primary staff identity?**  
   **EVIDENCE — high blast radius:**
   - `resolveSessionActor` → `staff:${staffId}` (`src/lib/sessionActor.ts`)
   - `finalizeDraftSale` `soldByUserId` (`src/store/usePosStore.ts`)
   - Cashier filters exact-match `staff:` (`src/lib/homeVisibility.ts`, `src/lib/todaySalesSummary.ts`, `src/pages/ReceiptsPage.tsx`, `src/pages/PosPage.tsx`)
   - `waiterAttribution.ts` strips `staff:` prefix
   - `soldByLabels.ts` maps `staff:${s.id}`
   - Offline cache keyed by `client_id` (`src/lib/staffCacheSync.ts`, `src/lib/staffOfflineAuth.ts`)
   - `shop_devices.current_staff_client_id`
   - Tests throughout `src/lib/*staff*`
5. **Still valuable after Auth onboarding:** name, username, PIN hashes, lockout, shop binding, client_id, device last-login, active/deleted.
6. **Duplicates `shop_members`:** `shop_id`, `role` (and loosely “is this person on this shop”).
7. **Migrate later to a staff profile table:** display name, phone, email, custom permissions cache, employment notes. Or keep `shop_pos_staff` as that table once `user_id` exists.
8. **Needed for PIN / shared terminal:** `pin_hash`, `username`, lockout fields, `shop_id`, `client_id`, `is_active`.

RPCs (**EVIDENCE**): `shop_pos_staff_list`, `_upsert`, `_delete`, `_set_active`, `_unlock`, `_import_local`, `_record_login`, `_record_security_event`, `_version`, `_download`. Client: `src/lib/shopStaffCloud.ts`, `src/lib/staffCacheSync.ts`.

**Do not delete this table.** It is the only cloud store for PIN staff and the only path that currently onboards cashiers.

---

# 5. Authentication Matrix

| Login path | Canonical identity today | ID format | Cloud auth? | Shop resolved? | Role source | Production use |
|------------|--------------------------|-----------|-------------|----------------|-------------|----------------|
| Owner email/password | `auth.users.id` | UUID | Yes | Primary shop via `shop_members` / `primary_shop_id` | `shop_members.role` else fail-closed `waiter` | Yes — owners |
| Google / Apple native | `auth.users.id` | UUID | Yes | Same | Same | Yes if flag on |
| Staff PIN login | PIN staff row | `staff:<staffId>` | **No** — `signInStaff` **signs out** Supabase (`useAuth.ts`) | Cached `accountKey` of **owner shop namespace** (`sb:<ownerUserId>`) | Staff row / cache | Yes — cashiers |
| Owner lock-screen switch user | PIN staff while owner Auth remains | `staff:<activeStaffId>` | Owner JWT still present | Owner primary shop | `StaffAccount.role` | Yes |
| Local mode (no Supabase) | Email string | `local:<email>` | No | None (local shop) | Forced **owner** (`resolveAuthRole`) | Dev / no-config |
| Offline Auth session restore | Last `auth.users.id` | UUID | When session valid | Primary shop when online | `shop_members` when fetch works | Yes |
| Staff session restore | Persisted PIN session | `staff:<id>` | No | Cached owner key | Persisted role | Yes |
| Logout | Clears Auth + staff + local | — | Session destroyed | Account key nulled | — | Yes |
| Session refresh | Same Auth user | UUID | Yes | Unchanged | Unchanged | Yes |
| Dev role simulator | Owner only | Owner UUID | Yes | Owner shop | Preference override | Dev only |

## Where `staff:<id>` is created / persisted / used

| Step | File / symbol | Status |
|------|----------------|--------|
| Created | `src/lib/sessionActor.ts` `resolveSessionActor` — PIN session **or** `preferences.activeStaffId` | **EVIDENCE** |
| Persisted session | `src/lib/staffOfflineAuth.ts` `waka.staff.session.v1` (`staffId` raw, not prefixed) | **EVIDENCE** |
| Enters sale | `usePosStore.finalizeDraftSale` → `soldByUserId` | **EVIDENCE** |
| Auth UUID substituted | `cloudSync.buildSalePushPayload` / `buildPendingSalePushPayload`: if not UUID, `ctx.userId` | **EVIDENCE** |
| Owner fallback | Same (`ctx.userId` from `supabase.auth.getSession()`) | **EVIDENCE** |
| Null identity | `soldByUserId: sessionActor?.userId ?? null` | **EVIDENCE** |
| PIN login signs out cloud | `useAuth.signInStaff` → `supabase.auth.signOut()` + `mode: "local"` | **EVIDENCE** |

**INFERENCE:** A dedicated cashier tablet using only PIN never has a JWT, so `resolveShopCtx()` is null and the sale never uploads until an owner session exists on that device.

---

# 6. Invitation Readiness

## What exists

| Capability | Status | Evidence |
|------------|--------|----------|
| Shop invitation table | **Missing** | No `shop_invitations` / `invitations` create in migrations |
| Invite tokens / URLs for shops | **Missing** | — |
| `inviteUserByEmail` in production app | **Missing** | Not used in `src/` |
| Supabase Auth email hook | **Present** | `supabase/functions/auth-send-email` + `authHookDispatch.ts` |
| Resend | **Present** | `EmailService.ts`, `resendApiKey()` |
| Auth email types handled | signup verify, password reset, welcome, generic **invite** / **magiclink** / email change | `authHookDispatch.ts` |
| Auth callback accepts `invite` / `magiclink` | **Present** | `src/lib/authCallbackSession.ts` |
| Password reset | **Present** | `useAuth.requestPasswordReset` → `resetPasswordForEmail` |
| Email verification | **Present** | `auth_user_email_verified`, `require_verified_email_for_cloud` (`095`) |
| Account recovery | Shop/owner recovery, not staff invite | `046_shop_account_recovery.sql`, `src/lib/shopRecoverySignals.ts` |
| Delivery log | `email_delivery_log` (`115`) | Service-role only |
| `organization_members.invited_by` | Column exists (`003`) | **Not used** for shop staff onboarding |

## Two layers (must stay separate)

**EVIDENCE + RECOMMENDATION**

1. **Supabase Auth invitation / account creation** — creates or recovers an `auth.users` row (password, Google, magic link). The hook already has an `invite` email template, but the product does not call Auth invite for staff.
2. **WAKA shop membership invitation** — grants a specific `shop_id` + `role` to an existing `auth.users.id`. This table/RPC **does not exist**.

Relying only on Auth invite is the weaker fit for this repo:

- Auth invite is account-scoped, not shop-scoped.
- A person may already have a WAKA owner account and later become cashier at another shop.
- `UNIQUE(shop_id, user_id)` is the right join key; Auth invite cannot express “cashier at Shop B”.
- Bootstrap RPCs always make the caller **owner of a new shop**, which is the opposite of joining.

**RECOMMENDATION — future flow (do not implement):**

```
Shop invitation row (token, shop_id, role, email, invited_by, expires)
        ↓
User opens link
        ↓
If not authenticated → existing Auth register / sign-in / Google
        ↓
Authenticated user accepts
        ↓
Security-definer RPC:
  verify token
  insert shop_members (shop_id, auth.uid(), role)
  optionally link shop_pos_staff.user_id
  consume token
```

Auth invite may still be used as a **delivery convenience** for brand-new emails. It must not be the membership authority.

---

# 7. Sales Identity Contract

## Current contract

| Item | Evidence |
|------|----------|
| Cloud PK | `sales.id uuid` (`005_customers_and_sales.sql`) |
| Shop relationship | `sales.shop_id uuid not null → shops(id)` |
| `created_by` | `uuid references auth.users(id)` **nullable** |
| Local seller | `Sale.soldByUserId?: string \| null` (`src/types.ts`) — comment says “staff who completed the sale” |
| Local `shopId` on `Sale` | **Absent.** Shop is resolved at sync via `resolveShopCtx()` |
| Cloud shop id | Required on every sale row and on `shop_push_sale_complete(p_shop_id)` |
| Push mapping | `created_by = isUuid(soldByUserId) ? soldByUserId : ctx.userId` (`cloudSync.ts` ~729) |
| RPC write | `coalesce(payload.created_by::uuid, auth.uid())` (`063`) |
| Pull mapping | `soldByUserId = row.created_by` (`cloudSync.ts` `rowToSale`) |

**What `created_by` means today:**

| Layer | Meaning |
|-------|---------|
| Local intent | Commercial seller (`SessionActor`) |
| Cloud column + FK | Must be an `auth.users` id |
| After PIN staff sync | **Authenticated principal that wrote the row** (owner JWT) |
| After owner sale | Both (same UUID) |

**EVIDENCE:** one field already has two meanings. That is the current architecture failure.

## Option comparison (recommendation only)

| | Option A: `created_by` = seller Auth UUID | Option B: writer + seller columns | Option C: keep `created_by`, add seller later |
|--|--|--|--|
| Compatibility | Breaks current remap; PIN sales cannot write until staff are Auth users | Clean semantics; requires dual writes | **Highest** — old clients keep working |
| RLS | Seller UUID must be a member **or** writer remains `auth.uid()` | RLS stays on writer/`auth.uid()` | Unchanged |
| Offline sync | Cannot store `staff:` in `created_by` | Writer = device JWT; seller = staff UUID when known | Same as today until clients learn the new column |
| Shared terminal | Writer (terminal owner JWT) ≠ seller — **A collapses them again** | Correct | Correct once column exists |
| Auditability | Weak on shared devices | Strong | Strong after backfill |
| Migration risk | High | Medium | **Lowest** |

**RECOMMENDATION: Option C as the first schema move, Option B as the long-term meaning.**

- Keep `sales.created_by` = **audit writer / sync principal** (`auth.uid()` of the session that committed the row).
- Add (later) `sales.sold_by_user_id` = **commercial seller** (`auth.users.id` of the cashier).
- Do **not** make `created_by` mean seller. That repeats the shared-terminal bug as soon as PIN terminals keep an owner JWT.

Until staff have Auth accounts, `sold_by_user_id` stays null and local `soldByUserId` may still be `staff:…`. Filters must not assume one format.

---

# 8. Auth UUID Migration Impact

Systems that eventually must speak `auth.users.id` for a cashier (not `staff:`):

| Area | Files / symbols | Why |
|------|-----------------|-----|
| Session actor | `src/lib/sessionActor.ts` | Today prefixes PIN ids |
| Checkout | `usePosStore.finalizeDraftSale` | Writes `soldByUserId` |
| Cloud push/pull | `src/offline/cloudSync.ts` `buildSalePushPayload`, `rowToSale`, `mergeSaleFromCloudPull` | UUID gate + owner fallback |
| Cashier Home / POS today / Receipts | `homeVisibility.ts`, `todaySalesSummary.ts`, `PosPage.tsx`, `ReceiptsPage.tsx` | Exact `===` on `staff:` |
| Labels / waiters | `soldByLabels.ts`, `waiterAttribution.ts` | Prefix parse |
| Command center grouping | owner command-center builders | Groups raw `soldByUserId` |
| Staff login | `useAuth.signInStaff`, `staffOfflineAuth.ts`, `staffAuthentication.ts` | Signs out Auth; uses owner `accountKey` |
| Switch user | `staffSwitchUser.ts`, `preferences.activeStaffId` | Same `staff:` actor |
| Offline cache | `staffCacheSync.ts`, `offlineStaffCache` | `client_id` keyed |
| Devices | `shop_devices.current_staff_client_id` | Client id, not Auth |
| Cloud staff CRUD | `shopStaffCloud.ts`, `shop_pos_staff_*` | No `user_id` |
| Role resolution | `shopMemberRole.ts`, `permissions.ts` | Only works for Auth members |
| Account partition | `src/offline/accountScope.ts` `sb:<authUserId>` | PIN staff reuse **owner** key |
| Local `Sale` type | `src/types.ts` | No `shopId`; seller is a free string |

**Do not migrate these in one step.** Phase 2 below is only a reversible schema foothold.

---

# 9. Multi-Shop Readiness

**Schema: yes. Product runtime: not safely.**

**EVIDENCE that one Auth user can belong to many shops:**

- `UNIQUE (shop_id, user_id)` not `UNIQUE (user_id)`
- `list_user_shops()` returns all memberships
- `profiles.primary_shop_id` + `set_user_primary_shop`
- `PrimaryShopSelector` UI exists
- Enterprise context counts shops in the org (`organizationContext.ts`)

**EVIDENCE that the POS does not treat shop as a first-class session field:**

| Concern | Current behavior |
|---------|------------------|
| SessionActor | `{ userId, role, permissions }` — **no shopId, no membershipId** (`sessionActor.ts`) |
| Active shop | `resolvePrimaryOrganizationForUser` prefers `primary_shop_id`, else first **owner** membership, else first manager, else first row (`fetchShopSubscription.ts`) |
| Sync | `resolveShopCtx()` uses that primary shop only (`cloudSync.ts`) |
| Account key | `sb:<auth.users.id>` — **user-scoped, not shop-scoped** (`accountScope.ts`) |
| Local `Sale` | No `shopId` |
| PIN staff | Reuses **owner** account key; one local ledger per owner user |
| RLS | Correctly shop-scoped **if** the JWT is used and `p_shop_id` is the intended shop |
| Org owner access | `user_can_access_shop` grants **all shops in the org** to org owner/admin |

**What must change later for:**

```
SessionActor { userId, shopId, membershipId, role, permissions }
```

**RECOMMENDATION (not implement):**

- Resolve shop from membership + explicit active shop, not “first owner row”.
- Partition offline data by `sb:<userId>::shop:<shopId>` **or** keep user key but tag every sale with `shopId`.
- Stop assuming one shop per Auth user in `resolveShopCtx`.
- PIN terminal: terminal has `shopId`; actor has `userId`.

**INFERENCE:** putting a cashier Auth user on Shop A and Shop B today would sync that user’s device to **one** primary shop ledger and could mix or hide the other shop’s data.

Also: `shop_members` allows different roles per shop (Cashier A / Manager B / Owner C) **in the database**. The client only loads one role (primary shop).

---

# 10. Shared Terminal / PIN Readiness

Two PIN systems already exist:

| System | Table | Purpose |
|--------|-------|---------|
| Staff PIN | `shop_pos_staff.pin_hash` | Identify which cashier is selling |
| Shop / back-office PIN | `shop_security_credentials.pin_hash` (`140`) | Owner settings lock, not seller identity |

PIN login today **is** a second identity system:

```
PIN success → staffSession → mode "local" → sign out Auth → actor staff:<id>
```

**RECOMMENDATION — evolve PIN to verification, do not remove it:**

**A. Personal device (V2)**  
Staff signs in with their own Auth account. `SessionActor.userId = auth.uid()`. `shop_members` supplies shop + role. PIN optional as device lock.

**B. Shared POS terminal (V2)**  
Terminal holds shop (and likely an owner/device JWT for sync). Staff identifies + enters PIN. PIN checks `shop_pos_staff` (or future `staff_profile`) **for that shop**. Attribution uses **`staff_profile.user_id` (auth UUID)**, not `staff:<rowId>`.

Data eventually required (analysis only, not final SQL):

- `shop_pos_staff.user_id` (or renamed profile) → `auth.users`
- `shop_id`
- `pin_hash` + lockout fields (already present)
- `shop_members` row for the same `(shop_id, user_id)` so RLS matches the seller

Until `user_id` is populated, PIN must keep working as today.

---

# 11. RLS and Security Findings

| ID | Sev | Finding | Evidence |
|----|-----|---------|----------|
| S1 | **P0** | PIN staff are not members; cloud sale write uses owner JWT; `created_by` cannot store `staff:`. Financial attribution is not enforceable as “this cashier”. | `005` FK; `cloudSync.ts`; `063`; forensic audit |
| S2 | **P1** | PIN login **destroys** the Auth session (`signInStaff` signs out). Cloud authorization is then impossible on that device. | `useAuth.ts` |
| S3 | **P1** | `shop_members` INSERT/UPDATE allowed for any shop manager via RLS. No invitation token. A manager can add arbitrary `user_id`s or promote roles (except second owner). No product UI today — latent API capability. | `008` policies; no accept RPC |
| S4 | **P1** | Org `owner`/`admin` can `user_can_access_shop` on **every** shop in the org, including sales. Intended for multi-shop orgs; dangerous if org membership is broader than expected. | `007` `user_can_access_shop` |
| S5 | **P2** | `user_is_cashier_or_above` includes `viewer` (`076`). Viewers can pass sale/inventory “cashier or above” checks. | `076_scale_hardening.sql` |
| S6 | **P2** | Role vocab mismatch: membership vs PIN staff vs client (`supervisor`/`kitchen`/`bar` cannot live on `shop_members`). | `072` vs `123` vs `permissions.ts` |
| S7 | **P2** | `profiles.role` defaults to `owner` (`014`) and is a second role column unrelated to shop membership. | `014_signup_owner_workspace_bootstrap.sql` |
| S8 | **SAFE** | Ordinary users cannot RLS-insert themselves into another shop. | `shop_members_write` + `user_can_manage_shop` |
| S9 | **SAFE** | Second shop owner rejected by trigger + unique index. | `095` / `118` |
| S10 | **SAFE** | Staff V2 invitation acceptance **must** be a security-definer RPC (not client INSERT), matching `shop_pos_staff_*` and `bootstrap_owner_workspace` patterns. | Existing RPC style |
| S11 | **SAFE** (current) | Cashier Auth user (if one existed with only `cashier` membership) could not grant themselves owner via trigger; they also fail `user_can_manage_shop` so they cannot UPDATE their row. | `029` + `095` |

**Can a cashier read another shop’s data?**  
Only if they have a `shop_members` row there, or they are org owner/admin, or they are Waka internal staff (`020` sales select). A PIN cashier with no JWT reads only local IndexedDB.

**Can a user grant themselves a role?**  
Owner/manager can change roles via RLS. Cashier cannot. Bootstrap forces **owner** on a **new** shop.

**Can an owner safely invite staff today?**  
They can create **PIN staff** via `shop_pos_staff_upsert`. They **cannot** invite an Auth user onto `shop_members` through a supported product flow.

---

# 12. Recommended Staff V2 Foundation

**RECOMMENDATION only. No implementation.**

```
auth.users                  one human, one login
    │
profiles                    display / contact / primary_shop_id
    │
shop_members                CANONICAL membership
    │  (shop_id, user_id, role, future status)
    │
    ├── personal device: SessionActor.userId = auth.uid()
    │                    SessionActor.shopId = active membership
    │
    └── shared terminal:  PIN verifies shop_pos_staff
                          shop_pos_staff.user_id = auth.uid()
                          sale.sold_by_user_id = that UUID
                          sale.created_by = device/session writer UUID

shop_pos_staff              PROFILE + PIN (extension of membership)
                            never the sales identity

shop_invitations            (future) shop-scoped invite, not Auth-only invite

sales                       shop_id required
                            created_by = writer
                            sold_by_user_id = seller (future)
```

Reuse:

- `shop_members` + existing RLS helpers
- `profiles` 1:1 Auth
- `list_user_shops` / `primary_shop_id` (then make SessionActor shop-aware)
- Resend + Auth hook for **account** emails
- `shop_pos_staff` PIN + lockout
- `shop_push_sale_complete` pattern (security definer, membership-gated)

Extend later (not now):

- `shop_members.status`, `invited_by`, maybe align roles with POS
- `shop_pos_staff.user_id`
- `sales.sold_by_user_id`
- `shop_invitations` + `shop_accept_invitation`
- Stop signing out Auth on PIN **or** keep device JWT and treat PIN as switch-user only

Do **not** make `shop_pos_staff.id` or `staff:` the V2 identity.

---

# 13. Phase 2 Proposal

**One narrow, reversible step. Do not implement Staff V2, invitations, or login changes in Phase 2.**

### GOAL

Add **unused nullable link columns** so Auth UUIDs *can* be stored without changing runtime behavior:

1. `public.shop_pos_staff.user_id uuid NULL references auth.users(id) on delete set null`
2. `public.sales.sold_by_user_id uuid NULL references auth.users(id) on delete set null`

No client writes. No filter changes. No PIN changes. No invitation table. No RLS policy edits.

### FILES / SYSTEMS AFFECTED

- One new migration only (when Phase 2 is approved).
- Types/docs comments optional.
- **Forbidden in Phase 2:** `cloudSync.ts` remap, `sessionActor.ts`, `useAuth.signInStaff`, dashboard filters, `shop_members` RPC.

### RISK

Low if columns stay unused. Unique `(shop_id, user_id)` on `shop_pos_staff` should **not** be added in Phase 2 (PIN-only rows have null `user_id`; unique would be premature).

### BACKWARD COMPATIBILITY

Old clients ignore unknown columns. `created_by` remap stays exactly as it is. PIN staff keep working.

### VALIDATION

- Migration applies on staging.
- Existing `shop_push_sale_complete` still succeeds.
- PIN login + owner sync still remaps as today (known broken attribution — unchanged on purpose).
- `shop_pos_staff_list` still returns current JSON (new column omitted until a later RPC change).

### ROLLBACK

Drop the two unused columns, or leave them unused. No data backfill in Phase 2.

### WHY THIS IS THE RIGHT NEXT STEP

Invitation email and Auth onboarding will fail again if there is still nowhere legal to put a cashier’s `auth.users.id` on a sale and on a staff profile. Phase 2 creates those columns **without** switching identity. Phase 3 (later, separate approval) can be observe-only write of `sold_by_user_id` when the actor is already a UUID.

**STOP.** Wait for approval before any migration or code change.

---

# Quality gate

- No application source was modified.
- No migration was created or modified.
- No SQL was applied.
- No Supabase data was touched.
- The only new file from this phase is `docs/STAFF_V2_PHASE_1_SCHEMA_AND_IDENTITY_AUDIT.md`.

Items marked **INFERENCE** (PIN-only device upload frequency; manager RLS abuse in the wild; multi-shop data mixing if a user already has two memberships) require a runtime reproduction and are not claimed as observed production incidents.

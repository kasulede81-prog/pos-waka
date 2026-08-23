# STAFF V2 — PHASE 0: REAL CLOUD STAFF ARCHITECTURE AUDIT

**Mode:** Architecture + forensic audit only. No implementation.  
**Date:** 2026-08-23  
**Repo:** pos-waka  
**Live project (already applied 158 + 159):** `ljaedextsenbkxzzgxcg` (`Waka-pos`)

Legend: **EVIDENCE** · **INFERENCE** · **RECOMMENDATION**

Related prior work (this document is the design restart; it does not re-apply 158/159):

- `docs/STAFF_ARCHITECTURE_FORENSIC_AUDIT.md` — why PIN sales vanish after pull
- `docs/STAFF_V2_PHASE_1_SCHEMA_AND_IDENTITY_AUDIT.md` — schema compatibility (written before `user_id` / `sold_by_user_id` existed)
- `docs/STAFF_V2_PHASE_3_SALES_IDENTITY_AUDIT.md` — observe-only dual-write

Migrations **151–157** remain unapplied and are out of scope.

---

## A. Executive verdict

**READY FOR REAL STAFF V2 DESIGN**

The current PIN plane is **not** a cloud staff account and cannot be patched into one. That is proven. The cloud foundations we need already exist and should be reused, not replaced:

```
auth.users  →  shop_members  →  shop_pos_staff (employment / PIN profile)
```

What is missing is the **product path** that creates a second Auth user, inserts `shop_members`, links `shop_pos_staff.user_id`, and keeps a real JWT on the device that sells.

Not “ARCHITECTURAL BLOCKERS FOUND”: the blockers are implementation gaps (no invite RPC, PIN login signs out Auth, `SessionActor` has no `shopId`, Phase 3 does not membership-check sellers). They are designable.

Not “CURRENT MODEL REQUIRES REPLACEMENT”: do **not** replace `shop_members`, `auth.users`, sales RPCs, or `shop_pos_staff`. Replace only the **PIN-as-cloud-principal** contract (`staff:<id>` as if it were `auth.uid()`).

---

## B. Current architecture diagram

**EVIDENCE — what the code does today.**

```
                         auth.users
                              │
                    ┌─────────┴──────────┐
                    ▼                    ▼
               public.profiles     organization_members
               primary_shop_id     (org owner/admin/billing/staff)
                    │
                    ▼
               shop_members
               UNIQUE(shop_id, user_id)
               roles: owner/manager/cashier/stock_keeper/waiter/viewer
               one owner per shop (095/118)
                    │
                    │  RLS + RPC: user_can_access_shop /
                    │  user_is_cashier_or_above(auth.uid())
                    ▼
        shops / sales / products / inventory
        sales.created_by     = cloud writer (auth.users)
        sales.sold_by_user_id = Auth UUID or NULL (Phase 3)

SEPARATE PLANE (not Auth):

   preferences.staffAccounts (IndexedDB)
              │ client id
              ▼
        shop_pos_staff
        PK = shop_pos_staff.id
        client_id = local staff id
        user_id uuid NULL → auth.users  (158; unused by clients)
        pin_hash / lockout / role / permissions
              │
              ▼
        SessionActor.userId = "staff:" + staffId
              │
              ▼
        Sale.soldByUserId (local string)
              │
              ├─ dedicated PIN login → supabase.auth.signOut()
              │                       resolveShopCtx() = null → no push
              │
              └─ owner still signed in + switch-user
                                    resolveShopCtx() = owner JWT
                                    created_by = owner
                                    sold_by_user_id = NULL
                                    pull: soldByUserId ← created_by (owner)
                                    cashier filter: === "staff:<id>" → miss
```

Devices (`shop_devices`) are **fingerprints on a shop**, not people. JWT is always a person (`auth.users.id`). `current_staff_client_id` is a PIN `client_id`.

---

## C. Root cause of the staff sales failure

A switched PIN staff account never became a cloud user. Four facts, in order:

### C1. Local actor is a prefixed string

**EVIDENCE** `resolveSessionActor` (`src/lib/sessionActor.ts`):

- Dedicated PIN `staffSession` → `userId = "staff:" + staffId` (early return).
- Owner + `preferences.activeStaffId` → same prefix, even if `user.id` is a real Auth UUID.

`staff:<id>` is **never** an Auth UUID. `isUuid()` in `cloudSync.ts` is an RFC-4122 check only; the prefix fails it.

### C2. Checkout writes that string onto the sale

**EVIDENCE** `finalizeDraftSale` and pending-sale builders (`usePosStore.ts`) set `soldByUserId: sessionActor?.userId`.

### C3. Cloud cannot store it as seller or writer

**EVIDENCE** `sales.created_by` is `uuid references auth.users` (`005_customers_and_sales.sql`).

Phase 3 (`cloudSync.ts` + `159`):

```
created_by      = isUuid(soldByUserId) ? soldByUserId : ctx.userId
sold_by_user_id = isUuid(soldByUserId) ? soldByUserId : null
```

PIN → `created_by` = **whoever still has the JWT** (usually the owner) · `sold_by_user_id` = **NULL**.

`staff_v2_observe_sold_by_user_id` only accepts a string that parses as UUID **and** exists in `auth.users`. It never reads `shop_pos_staff`. It never uses `auth.uid()` as a fallback seller.

### C4. Dedicated PIN login deletes the JWT

**EVIDENCE** `useAuth.signInStaff` (`src/hooks/useAuth.ts` ~950–957):

1. `authenticateStaffLogin` → `authenticateOfflineStaff` (IndexedDB / PIN hash).
2. `applyAccountSwitchSync(owner accountKey)` — staff reuse `sb:<ownerId>`.
3. `setSession(null)`.
4. `supabase.auth.signOut()`.
5. `effectiveMode = "local"`.

`resolveShopCtx()` requires `getSession().user` + verified email + a `shop_members` row (`cloudSync.ts`). After sign-out it returns **null**. Pushes no-op. Sales stay `pendingSync` on that device.

**Two PIN paths (do not collapse them):**

| Path | Auth session | Sync | Cloud seller |
|------|--------------|------|--------------|
| Dedicated staff login (`signInStaff`) | **Destroyed** | **Cannot push** | No cloud row until someone with a JWT later uploads from the same local ledger |
| Owner still signed in + lock-screen switch (`activeStaffId`) | **Kept** | Push as owner | `created_by` = owner · `sold_by` = NULL |

### C5. Pull + filters finish the disappearance

**EVIDENCE** `rowToSale` still maps `soldByUserId` from `created_by`, **not** `sold_by_user_id`. Merge can prefer remote metadata. Cashier Home / POS today / Receipts filter `soldByUserId === actor.userId` (`staff:<id>`). After pull, equality fails.

**Classification:** deliberate offline-first PIN plane (`signOut`, owner `accountKey`, `staff:` prefix) **plus** an incomplete Staff V2 migration (158/159 unused for PIN). Not a one-line bug.

---

## 1. Owner authentication (call chain)

```
LoginPage.onLogin
  → useAuth.signIn
      → supabase.auth.signInWithPassword({ email, password })
      → applyAccountSwitchSync(computeAccountKey({ mode: "supabase", userId, email }))
      → setSession(signedIn)
      → ensureOwnerWorkspaceIfNeeded(session)          [ownerWorkspaceOnSignIn.ts]
          → resolvePrimaryOrganizationForUser(uid)     [fetchShopSubscription.ts]
          → if none: bootstrapOwnerWorkspace            [workspaceBootstrap.ts]
              → RPC bootstrap_owner_workspace           [117]
                  inserts shop_members (shop_id, auth.uid(), 'owner')
                  inserts organization_members owner
                  sets profiles.primary_shop_id
```

Google: `signInWithGoogle` / native OAuth / `signInWithIdToken` → same workspace ensure.

**Session storage / restore**

**EVIDENCE** `src/lib/supabase.ts`: `persistSession: true`, `autoRefreshToken: true`, `storage: window.localStorage`, PKCE.

Startup (`useAuth`): `resolveStartupSession(() => client.auth.getSession())` → `applySupabaseSession` → `onAuthStateChange`. Visibility / Capacitor resume call `scheduleOwnerSessionRefresh`.

`auth.uid()` on the server **is** `session.user.id` when a JWT is present.

**SessionActor vs Auth**

`AppShell` → `resolveSessionActor({ user, shopMemberRole, staffSession, preferences })`.

- Owner, no switch: `userId = user.id` (Auth UUID).
- `shopMemberRole` from `fetchShopMemberRoleForUser` → `shop_members.role` on the **primary** shop.

**Active shop**

```
resolveShopCtx
  → getSession()
  → isSupabaseEmailVerified
  → resolvePrimaryOrganizationForUser
      1. profiles.primary_shop_id if also in shop_members
      2. else first shop_members row: owner, then manager, then earliest
  → { shopId, userId }
```

`SessionActor` has **no `shopId`**. One Auth user on two shops syncs only the primary shop (`accountScope`: `sb:<userId>`).

**Authorization**

Shop access: `user_can_access_shop` = `shop_members` **or** org `owner`/`admin`.  
Sale RPCs: `user_is_cashier_or_above` (includes **viewer**, plus org manage-shop).  
Owner-only: `user_is_shop_owner` (devices, PIN sync, delete).

---

## 2. Current PIN staff architecture

```
Owner logged in
  → AppShell prepareSwitchUserLock / LoginPage staff view
  → PIN (EnterprisePinPad)
  PATH A — dedicated login:
      signInStaff → authenticateStaffLogin → authenticateOfflineStaff
      → signOut Auth → staffSession → SessionActor staff:<id>
      → finalizeDraftSale soldByUserId = staff:<id>
      → queueRemote pending_sales
      → resolveShopCtx = null
      → RPC never called
  PATH B — switch user while owner JWT remains:
      verifyLockScreenPin → performStaffSwitch → activeStaffId
      → SessionActor staff:<id>
      → same sale + queue
      → resolveShopCtx = owner
      → shop_push_sale_complete
          authorized as owner (user_is_cashier_or_above)
          created_by = owner
          sold_by_user_id = NULL
```

**EVIDENCE answers**

| Question | Answer |
|----------|--------|
| Does `signInStaff` sign out Supabase? | **Yes.** |
| Does any Auth session remain after dedicated PIN login? | **No** (client session cleared + `signOut`). Switch-user path **keeps** owner JWT. |
| `SessionActor.userId` | Always `staff:<staffId>` when staff is active. |
| Is `staff:<id>` ever an Auth UUID? | **No.** |
| Can a staff sale reliably sync? | Only if a **JWT still exists** (path B), and then the cloud row is the **owner’s** sale. Path A cannot sync until an owner (or other member) JWT returns on that device. |
| Design class | Deliberate local-only PIN + incomplete V2 foothold. |

Owner must sign in once on a device before PIN login can find a cached shop (`authenticateOfflineStaff`: business not found otherwise).

---

## 3. `shop_pos_staff` data model

**What it is today:** a **shop-scoped employment / PIN profile**, not an Auth identity.

**EVIDENCE — columns (095 + 123 + 126 + 158):**  
`id`, `shop_id`, `client_id`, `name`, `username`, `role`, `pin_hash`, `password_hash`, `phone_e164`, `email`, `permissions`, `is_active`, `deleted_at`, lockout fields, login telemetry, **`user_id` (nullable FK `auth.users` ON DELETE SET NULL)**.

**Creation:** `addStaffAccount` → `createStaffInCloudFirst` → `shop_pos_staff_upsert`. Local `id` = `client_id`. No `user_id` in `staffToCloudJson` or the upsert RPC.

**PIN:** Argon2id (`staffSecret.ts`); verify `staffSecretMatchesAsync`; lockout via `shop_pos_staff_record_login`.

**Duplicates:** unique **active username per shop**. Upsert dedupes `(shop_id, client_id)`. Multiple rows per shop are intended (many cashiers). `user_id` has **no unique constraint** (partial non-unique index only).

**Roles:** PIN roles include supervisor / kitchen / bar (`123`). `shop_members` does **not**. Permissions live in JSONB + local custom roles.

**Reads/writes:** `shopStaffCloud.ts` (`list` / `upsert` / `delete` / `import` / `record_login` / `unlock`), `staffCacheSync.ts`, `staffSyncQueue.ts`. **Zero client writes to `user_id`.**

**Owner/shop:** staff belong to a shop, not to `auth.users`. Owner relationship is “this shop’s PIN roster,” enforced by owner JWT on staff RPCs.

**What it should be in Staff V2:** keep it as the **employment + PIN + lockout + device-facing profile**. Canonical membership stays `shop_members`. `user_id` becomes the link to the human’s Auth account **after invite/upgrade**. Until linked, the row remains legacy PIN-only.

---

## 4. `shop_members` architecture

**Verdict: this is the foundation. Use:**

```
auth.users  →  shop_members  →  shop_pos_staff
```

**Why this order**

1. Cloud RPCs already authenticate `auth.uid()` and authorize via `shop_members` (`user_is_cashier_or_above` on `shop_push_sale_complete` / pending / stock / purchases).
2. `UNIQUE(shop_id, user_id)` is the correct multi-shop key. One human, many shops, one role per shop.
3. RLS on sales is shop-scoped through those helpers (`008`).
4. A non-owner who **is** in `shop_members` can already push sales and sync **if** they have their own JWT. The server is ready; the product never creates those rows.
5. `shop_pos_staff` cannot authorize RPCs today (no JWT). Putting membership only there would require rewriting every RPC.

**Do not invert** to `auth.users → shop_pos_staff → shop_members`. PIN profile is optional (personal-device cashier may never use PIN). Membership is mandatory for cloud writes.

**Schema (003 + 013 + 072 + 095):**  
`id`, `shop_id`, `user_id`, `role`, `created_at`. No status, invited_by, or email. One owner per shop.

**RLS (008):** select if `user_can_access_shop`; write if `user_can_manage_shop`. **Latent:** a manager can INSERT another `user_id` with no invite token. **Product:** no UI and no add-member RPC. Client never inserts.

**Creation:** only `bootstrap_owner_workspace` / repair / owner self-provision / one-time org-owner backfill (`027`). Always `auth.uid()` as **owner**.

**Client shop resolution ignores org-only membership.** Org owner/admin can still pass many RPCs via `user_can_manage_shop` without a `shop_members` row.

---

## 5. Existing invitation infrastructure

**No shop invitation table. No invite token. No pending membership. No accept RPC. No `inviteUserByEmail` in `src/`.**

| Reusable | What it actually does |
|----------|------------------------|
| `auth-send-email` + Resend + `dispatchAuthHookEmail` | Auth lifecycle email (signup, recovery, **Auth `invite` action**) |
| Auth `invite` template | Creates/confirms an **Auth user** only. No `shop_id`, no role |
| `authCallbackSession.ts` | Can complete OTP type `"invite"` into a session |
| `organization_members.invited_by` | Column exists; unused for shop staff |
| `bootstrap_owner_workspace` | Pattern for security-definer membership insert |
| `shop_pos_staff_upsert` | Pattern for owner-gated staff writes |
| Marketing “invite staff” copy | Not an implementation |

**RECOMMENDATION:** reuse Auth email + callback. Add a **new** shop-scoped invite (table or token + security-definer accept RPC) that inserts `shop_members` and optionally sets `shop_pos_staff.user_id`. Do not treat Auth `invite` alone as shop onboarding.

---

## 6. Real sales identity model

```
SessionActor.userId
  → Sale.soldByUserId
  → buildSalePushPayload / buildPendingSalePushPayload
  → shop_push_sale_complete / shop_push_pending_sale
  → sales.created_by / sales.sold_by_user_id
  → rowToSale (soldByUserId ← created_by only)
  → mergeSaleFromCloudPull
  → homeVisibility / todaySalesSummary / ReceiptsPage
```

### Four identities (keep them separate)

| Identity | Today | End-state meaning |
|----------|-------|-------------------|
| **AUTHENTICATED CLOUD WRITER** | JWT `auth.uid()`; also `created_by` when local seller is not a UUID | The Auth user whose session performed the cloud write. **Keep `created_by` as this.** |
| **COMMERCIAL SELLER** | Local `soldByUserId`; cloud `sold_by_user_id` only if already an Auth UUID | The Auth user who sold. **`sales.sold_by_user_id`.** Must be a `shop_members` user on that shop (Phase 7). |
| **LOCAL LEGACY PIN IDENTITY** | `staff:<shop_pos_staff.id or client_id>` | Temporary local key until the row is linked. Must not be stored in UUID columns. |
| **SHOP MEMBERSHIP IDENTITY** | `shop_members (shop_id, user_id, role)` | Authorization: who may sync this shop. Not a sale column. |

Pull and dashboards still treat **writer** as **seller**. That is why Phase 3 is observe-only and filters stay frozen until Phase 10.

---

## 7. Multi-device requirements

Target:

```
Owner phone · Cashier A tablet · Cashier B desktop
each independently logged in · Shop A only · real seller · no owner JWT on cashier devices
```

| Blocker | Evidence |
|---------|----------|
| No Auth account for cashiers | Staff create path never calls Auth invite / signUp for the staff person |
| No `shop_members` insert for non-owners | Bootstrap-only owner rows |
| `shop_pos_staff.user_id` unused | 158 only |
| Dedicated PIN login signs out JWT | `signInStaff` |
| Sync requires JWT + `shop_members` | `resolveShopCtx` |
| Owner must bootstrap the device cache first | `authenticateOfflineStaff` |
| `SessionActor` has no `shopId` | Primary shop only |
| Offline partition is `sb:<userId>` | Two cashiers = two Auth users = two ledgers (correct later; today cashiers share **owner** key) |
| Device enrollment is owner-login-centric | `registerShopDeviceOnLogin` |
| Pull still maps seller from `created_by` | `rowToSale` |
| Filters still match `staff:` | Home / POS / Receipts |
| Phase 3 does not prove membership of `sold_by_user_id` | Helper = `auth.users` existence only |

Independent cashier Auth login is **possible on the server** (cashier `shop_members` + JWT already passes sale RPCs). It is **not implemented** in the product.

---

## 8. Shared-device PIN — model comparison

PIN must stay. Shared terminals are real. PIN must **not** be cloud authentication.

Desired shape:

```
Authenticated shop/device session (real JWT, a shop member)
  → POS locked
  → staff selected
  → PIN verifies shop_pos_staff for this shop
  → commercial seller = shop_pos_staff.user_id (Auth UUID)
  → cloud writes still use the JWT
  → created_by = JWT user · sold_by_user_id = linked staff Auth UUID
```

Compatible with current Supabase: **yes**, if the device JWT is a `shop_members` user (owner, manager, or a future “terminal” member) and seller UUID is membership-checked server-side. PIN never appears in RPCs.

| | Model A — each staff has own Auth session | Model B — shared JWT + PIN selects seller | Model C — `staff:<id>` today |
|--|--|--|--|
| **Security** | Best: RLS is the seller | Good if PIN only picks seller and server validates membership + link | Fail: PIN is not Auth; owner JWT impersonates |
| **RLS** | Natural `auth.uid()` | JWT is device/operator; seller is a column | JWT is owner; seller lost |
| **Offline** | Each user has own `sb:<id>` ledger — shared terminal must not swap account keys mid-shift without flush | Best: one device ledger; PIN only changes actor | What we have; ledger is owner’s |
| **Attribution** | `created_by` ≈ `sold_by` | Split writer vs seller (already in 158/159) | Writer only |
| **Multi-device personal** | Required | Not sufficient alone | Impossible |
| **Shared terminal** | Awkward (sign out / sign in per cashier) | Required | What we have, broken in cloud |
| **Complexity** | Invite + login + session | PIN verify + link + server seller check | Already built |

**RECOMMENDATION:** ship **A + B**. Personal devices use A. Shared POS uses B. C remains **legacy only** until the row is linked.

Cloud writes on a shared terminal **must** stay authenticated as a real `shop_members` JWT (owner, manager, or dedicated device member). Never as PIN.

---

## 9. Security audit

| # | Question | Evidence / answer |
|---|----------|-------------------|
| S1 | Can one staff user access another shop? | PIN staff: only local IDB. Auth member: only shops in `shop_members`, **or** all org shops if org owner/admin (`user_can_access_shop`). Internal staff have extra sales select (`020`). |
| S2 | Can a client forge `sold_by_user_id`? | **Yes today.** Client sends any string. Helper accepts any UUID that exists in `auth.users`. **No shop membership check. No link to `shop_pos_staff`. Phase 3 is insufficient for the final architecture.** |
| S3 | Can a cashier claim to be another seller? | Locally they can set any `soldByUserId` if they tamper with the store. On cloud, a JWT holder can send another user’s UUID and Phase 3 will store it if that user exists. |
| S4 | Can an owner create unauthorized memberships? | No product RPC. RLS allows `user_can_manage_shop` to INSERT arbitrary `user_id`. Latent. Accept-invite must be security-definer, not client INSERT. |
| S5 | Staff Auth account deleted? | `shop_members.user_id` **ON DELETE CASCADE** — membership gone. `shop_pos_staff.user_id` and `sales.sold_by_user_id` **ON DELETE SET NULL** (158) — profile and historical seller column null out; PIN row remains. `created_by` still references `auth.users` (005) — **delete of a writer can fail or restrict** depending on later FK behavior; treat Auth deletion as a dedicated erasure path (existing hard-delete engine). |
| S6 | Can PIN authenticate cloud writes? | **No.** After `signInStaff`, `auth.uid()` is null. |
| S7 | Server validation required for final seller | Candidate is UUID; exists in `auth.users`; **`shop_members` for `p_shop_id`**; optionally equals `shop_pos_staff.user_id` for that shop when PIN-attributed; never invent owner; never store `staff:`; fill-once remains. |
| S8 | Viewer can push sales | `user_is_cashier_or_above` includes `viewer` (`076`). Tighten in a later authz pass, not Phase 3. |

---

## 10. Backward compatibility

Live WAKA POS currently has **zero** `shop_pos_staff` rows (runtime observation from authorized Phase 3 testing). The product still has the full PIN create path; other environments / future rows must migrate safely.

```
Legacy PIN staff (user_id NULL)
  → still works as today (staff: + owner JWT rewrite)
  → optional link shop_pos_staff.user_id
  → invite / upgrade → shop_members + Auth login
  → real cloud identity
```

**RECOMMENDATION (do not constrain in this audit):**

| Rule | Recommendation | Why |
|------|----------------|-----|
| One staff row → one Auth user | **Yes** (`user_id` single column) | One human per employment profile |
| One Auth user → many staff rows | **Yes, across shops** | Same person, Shop A cashier / Shop B waiter; matches `shop_members` |
| One Auth user → two staff rows on **same** shop | **No** | Partial unique `(shop_id, user_id) WHERE user_id IS NOT NULL` later |
| Global unique `user_id` | **No** | Would block cross-shop employment |
| Unlinked PIN rows | Remain valid | `user_id` NULL is the legacy state |
| Cross-shop employment | Support via two `shop_members` + two `shop_pos_staff` | Schema already allows it; client primary-shop limitation is a later session fix |

---

## D. What is real today vs what is fake/local today

| Thing | Real cloud? | Notes |
|-------|-------------|-------|
| Owner Auth session | **Real** | JWT, `auth.uid()`, persisted localStorage |
| `shop_members` owner row | **Real** | Created by bootstrap |
| Non-owner `shop_members` | **Real table, unused product** | Server would honor it |
| `shop_pos_staff` | **Real table, local identity** | PIN profile; `user_id` unused |
| `staff:<id>` | **Fake / local** | Never Auth |
| Dedicated PIN session | **Local only** | Signs out JWT |
| Owner JWT + switch-user | **Real writer, fake seller** | Sync works; seller is owner |
| `sales.created_by` | **Real writer** | |
| `sales.sold_by_user_id` | **Real column, PIN always NULL** | Auth UUID sellers only (Phase 3) |
| Phase 3 helper | **Real but weak** | Existence, not membership |
| Shop invitation | **Absent** | |
| Device row | **Real shop device** | Not a person |
| Cashier dashboards | **Local string equality** | Break after pull |
| `accountKey` for PIN | **Owner’s** `sb:<ownerId>` | Not the staff person’s |

---

## E. Existing infrastructure we can reuse

| Asset | Reuse how |
|-------|-----------|
| Supabase Auth | Staff are `auth.users`. Email hook + invite/recovery templates |
| `shop_members` | Canonical membership; do not replace |
| RLS helpers | `user_can_access_shop`, `user_is_cashier_or_above`, `user_can_manage_shop` — tighten later, reuse now |
| Sale RPCs | Keep `created_by` contract; extend seller checks |
| `shop_pos_staff` + PIN hash/lockout | Employment + shared-terminal verification |
| `shop_pos_staff.user_id` (158) | Link after invite; do not re-migrate |
| `sales.sold_by_user_id` + observe helper (159) | Keep fill-once; add membership validation later |
| `list_user_shops` / `set_user_primary_shop` | Multi-shop later |
| Device fingerprint + approval | Bind shared terminal; not a substitute for Auth |
| `bootstrap_owner_workspace` style | Template for accept-invite RPC |
| Auth callback `"invite"` | Session after email accept |

---

## F. Recommended end-state architecture

**Canonical stack**

```
auth.users                human login
    ↓
profiles                  display, primary_shop_id
    ↓
shop_members              CANONICAL: (shop_id, user_id, role[, status])
    ↓
shop_pos_staff            OPTIONAL profile: PIN, lockout, client_id
                          user_id → same Auth user for that shop
    ↓
sales.created_by          JWT writer
sales.sold_by_user_id     commercial seller Auth UUID (membership-checked)
```

### F1. Owner

```
Owner signs in (email/Google)
  → JWT = owner
  → shop_members.role = owner
  → SessionActor.userId = auth.uid()
  → created_by = sold_by_user_id = owner
```

Unchanged in spirit. Do not use owner JWT as a fake cashier identity.

### F2. Independently authenticated staff (personal device)

```
Owner invites (email + shop + role)
  → Auth user created / existing user accepts
  → shop_members inserted (cashier/…)
  → optional shop_pos_staff.user_id linked
Staff signs in on their tablet with THEIR credentials
  → JWT = staff
  → resolveShopCtx = { shopId, userId: staff }
  → no owner JWT
  → created_by = staff · sold_by_user_id = staff
```

**Do not call `signOut` on this path.**

### F3. Multi-device staff

```
Each device: that person's JWT
Offline partition: sb:<thatUserId>  (later + shop id if multi-shop)
RLS: only Shop A membership
Seller: that person
```

Requires Phase 5–6. Primary-shop-only `resolveShopCtx` is a follow-on if one cashier works two shops.

### F4. Shared terminal with PIN

```
Device holds a shop-member JWT (owner, manager, or future terminal member)
  → lock screen
  → select staff → PIN against shop_pos_staff for this shop
  → if user_id set: SessionActor commercial id = that Auth UUID
  → if user_id null: legacy staff:<id> (sold_by stays NULL) until upgraded
  → sync still uses device JWT
  → created_by = JWT user
  → sold_by_user_id = linked Auth UUID (server-validated)
```

PIN never becomes the JWT.

### F5. Legacy PIN migration

```
user_id IS NULL → today’s behavior (safe)
Owner invites / links existing Auth user
  → set user_id
  → insert shop_members if missing
  → filters still use staff: until Phase 10
  → after cutover, local actor for that person is the Auth UUID
```

---

## G. Security model

| Question | Answer |
|----------|--------|
| **Who authenticates?** | Supabase Auth JWT only. PIN is verification of a linked profile, not a credential for `auth.uid()`. |
| **Who authorizes shop data?** | `shop_members` (and org owner/admin bridge). RPCs keep `auth.uid()` + shop helpers. |
| **Who is recorded as writer?** | `sales.created_by` = authenticated cloud writer. |
| **Who is recorded as seller?** | `sales.sold_by_user_id` = commercial Auth UUID, server-checked as a member of `p_shop_id`. |
| **Who may invite?** | Shop owner (and later manager if product allows), via security-definer RPC + token, not RLS insert. |
| **Shared terminal** | JWT authorizes the **device session**. PIN selects the **seller**. Server rejects a seller who is not a member of that shop. |

---

## H. Exact phased implementation plan

**Do not implement these phases in this audit.**

Do **not** reopen 158/159 unless a later phase proves them defective. Do **not** apply 151–157 as part of Staff V2.

### Phase 4 — Canonical staff / member data model

**Goal:** Specify and add **nullable, additive** constraints/indexes only. No invite UI. No login change. No filter change.

- **DB:** Partial unique `(shop_id, user_id)` on `shop_pos_staff` where `user_id IS NOT NULL`. Comments. Optional `shop_members.status` **only if** invite requires it; otherwise wait for Phase 5. Do not unique `user_id` globally.
- **Client:** None, or read-only types. Still do not write `user_id`.
- **RPC/RLS:** None.
- **Risk:** Existing duplicate links (none expected). Unique index must be `NOT VALID` / cleaned if any appear.
- **Compatibility:** Unlinked PIN rows stay valid.
- **Tests:** Migration foothold: unique per shop; two shops same user allowed; NULL `user_id` duplicates still allowed.
- **Gate:** GO if index applied and no client behavior change.

### Phase 5 — Secure staff invitation + Auth onboarding

**Goal:** Owner can create a **real** Auth staff user on a shop.

- **DB:** `shop_invitations` (or equivalent token table): shop_id, email, role, token hash, expires, invited_by, accepted_at. Or signed token without a table if you accept operational limits. Prefer a table.
- **RPC:** `shop_invite_staff` (owner), `shop_accept_staff_invite` (authenticated invitee). Insert `shop_members`. Optionally create/link `shop_pos_staff.user_id`. **Revoke** client RLS as the way to add members (or leave RLS but do not use it from the app).
- **Client:** Owner invite UI. Accept via existing Auth email callback (`invite` / magic link) then accept RPC.
- **Reuse:** `auth-send-email` / Resend.
- **Risk:** Email confirmation; existing Auth user already in another shop; role vocab (no supervisor on `shop_members` — map or extend).
- **Compatibility:** PIN create path unchanged.
- **Tests:** Invitee becomes member; cannot accept for another shop; expired token; second owner rejected; manager-invite policy explicit.
- **Gate:** GO when a second Auth user can sign in and `resolveShopCtx` returns Shop A **without** the owner JWT on that device.

### Phase 6 — Independent staff login / session

**Goal:** Staff Auth login is a first-class session. `signInStaff` is **not** used for that path.

- **Client:** Staff email/password (or magic link) uses `signIn`, not `signInStaff`. `SessionActor.userId = user.id`. `accountKey = sb:<staffUserId>`. Device enrollment for the staff JWT. **Do not sign out** after staff Auth login.
- **DB:** None required if Phase 5 landed.
- **RPC/RLS:** Existing cashier-or-above is enough to push. Consider excluding `viewer` here or in a small authz follow-up.
- **Risk:** Empty local ledger on first staff device (they are not on the owner `sb:` key). Need pull-on-first-login.
- **Compatibility:** PIN login remains for unlinked staff.
- **Tests:** Staff JWT push; `created_by` and `sold_by_user_id` both staff UUID; no owner JWT; cannot resolve another shop.
- **Gate:** GO when Tests A–D from Phase 3 pass **through the app** for an Auth cashier (not throwaway SQL).

### Phase 7 — Real seller attribution + server validation

**Goal:** Phase 3 helper is no longer sufficient.

- **DB/RPC:** Replace or wrap `staff_v2_observe_sold_by_user_id`: membership on `p_shop_id`; optional `shop_pos_staff.user_id` match; unknown/non-member → NULL; never abort sale; never substitute owner; keep fill-once; **do not change `created_by`**.
- **Client:** Still send UUID only when `isUuid`. Still no `staff:` conversion.
- **Risk:** Over-strict check nulls a legitimate seller. Under-strict allows forge.
- **Compatibility:** Unlinked PIN still NULL `sold_by`.
- **Tests:** Member UUID persists; other shop’s user → NULL; random `auth.users` → NULL; PIN prefix → NULL; retry fill-once.
- **Gate:** GO when forge of another shop’s user is proven NULL on staging/test project.

### Phase 8 — Shared-device PIN architecture

**Goal:** PIN verifies; JWT remains.

- **Client:** Lock-screen / switch-user: if `staff.user_id` set, commercial actor is that UUID **without** `signOut`. If unset, keep `staff:<id>` (legacy). Flush rules if you ever switch `accountKey` (prefer **not** to).
- **DB:** `user_id` populated for upgraded staff.
- **RPC:** Phase 7 validation.
- **Risk:** Signing out on shared terminal returns to Phase 3 failure. Do not reuse `signInStaff` as-is.
- **Compatibility:** Unlinked PIN still works locally.
- **Tests:** Shared JWT + PIN → `sold_by` = linked UUID, `created_by` = device user; dedicated `signInStaff` still documented as legacy.
- **Gate:** GO when a shared tablet uploads a PIN sale with real `sold_by_user_id` and the owner JWT is not required **if** a shop-member device session exists.

### Phase 9 — Legacy PIN migration

**Goal:** Upgrade existing PIN rows without breaking unread devices.

- **DB:** Backfill `user_id` only after accept. No mass rewrite of historical `created_by`.
- **Client:** Owner “invite this PIN cashier” from the staff row (email).
- **Risk:** Two humans sharing one PIN row; username vs email mismatch.
- **Tests:** Unlinked rows unchanged; linked rows get membership; old `staff:` sales remain historically rewritten as owner (do not attempt to rewrite history in this phase).
- **Gate:** GO when a live PIN row can be upgraded without deleting the profile.

### Phase 10 — Dashboard / filter cutover

**Goal:** Local seller and cloud seller converge for Auth-attributed sales.

- **Client:** New local field (e.g. `soldByAuthUserId`) **or** carefully map `row.sold_by_user_id` without destroying `staff:` on unlinked rows. Then point Home / POS today / Receipts at Auth UUID for Auth cashiers. **Last**, not first.
- **Do not** change `rowToSale` / filters in Phases 4–9.
- **Risk:** Mixing `staff:` and UUID on one device hides or double-counts sales.
- **Tests:** Auth cashier sees own sales after pull; unlinked PIN cashier behavior **unchanged**; owner shop-wide totals unchanged.
- **Gate:** GO when cashier Home after pull matches `sales.sold_by_user_id` for Auth sellers and PIN-unlinked behavior is identical to today.

---

## I. Frozen files / dangerous changes

Do not touch until the phase that owns them.

| Until | Freeze |
|-------|--------|
| Phase 6 | `useAuth.signInStaff`, `staffOfflineAuth.ts`, `staffAuthentication.ts` (do not “just remove signOut”) |
| Phase 6 / 8 | `sessionActor.ts` `staff:` prefix; `preferences.activeStaffId` meaning |
| Phase 6 / 8 | `finalizeDraftSale` / pending builders’ `soldByUserId` assignment |
| Phase 10 | `rowToSale`, `saleFinancialMerge.ts` |
| Phase 10 | `homeVisibility.ts`, `todaySalesSummary.ts`, `ReceiptsPage.tsx` cashier `===` filters, `soldByLabels.ts` |
| Phase 5 | `shop_members` RLS as the invite mechanism; invitations |
| Phase 7 | `staff_v2_observe_sold_by_user_id` membership rules; `created_by` ternary |
| Never as a drive-by | `created_by` meaning; PIN hash format; `shop_members` unique/owner trigger; 158/159 rewrite; dashboards “fix” that maps `staff:` to owner |
| Out of scope | Migrations 151–157; marketplace project; production-only opportunism |

Dangerous if done early: changing pull to `sold_by_user_id` before Auth cashiers exist; signing out shared-terminal JWT; unique-global `user_id`; treating PIN as JWT.

---

## J. STOP

```
NO CODE WAS WRITTEN FOR IMPLEMENTATION.
NO MIGRATION WAS CREATED.
NO SQL WAS APPLIED.
158 / 159 WERE NOT MODIFIED OR REAPPLIED.
151–157 WERE NOT APPLIED.
PHASE 4+ IS NOT STARTED.

Architecture audit complete.
Next authorized step is Phase 4 design approval, then implementation.
```

# STAFF V2 — PHASE 5: SECURE STAFF INVITATION + AUTH ONBOARDING

**Mode:** Architecture audit + implementation plan. No code, no migration, no SQL, no UI.  
**Date:** 2026-08-23  
**Repo:** pos-waka  
**Live:** `ljaedextsenbkxzzgxcg` (`Waka-pos`) — 158, 159, 160 applied. 151–157 unapplied (out of scope).

Legend: **EVIDENCE** · **INFERENCE** · **RECOMMENDATION**

Depends on: `docs/STAFF_V2_PHASE_0_REAL_CLOUD_STAFF_ARCHITECTURE_AUDIT.md`, Phase 4 (`160`).

---

# Verdict

**READY FOR PHASE 5 IMPLEMENTATION — WITH HARD PRECONDITIONS**

The missing bridge is shop-scoped invitation, not Auth email itself.

```
Owner (JWT)  →  shop_invite_staff
                    ↓
              shop_staff_invitations (token_hash, shop_id, email, roles)
                    ↓
              WAKA email (Resend)
                    ↓
Invitee Auth signup/login (own JWT)
                    ↓
              shop_accept_staff_invite
                    ↓
auth.users → shop_members → shop_pos_staff.user_id
```

Supabase Auth **invite** can deliver an account. It **must not** grant shop membership. Membership is only created by a security-definer accept RPC that binds `auth.uid()` + hashed token + that `shop_id`.

**Hard precondition:** `AuthCallbackPage` currently calls `ensureOwnerWorkspaceIfNeeded` after every callback. That RPC creates a **new shop as owner** if the user has no `shop_members` row. A staff invitee who lands there **before** accept would become an owner of an empty shop. Accept (or an explicit skip) **must run first**.

Do not implement until this design is approved.

---

# 1. Current invitation infrastructure

**EVIDENCE**

| Piece | Status | What it actually does |
|-------|--------|------------------------|
| Shop invitation table | **Absent** | No `shop_staff_invitations` / `shop_invitations` in migrations |
| `inviteUserByEmail` / `admin.invite` / `generateLink` | **Absent** in `src/` and functions | Product never calls Auth Admin invite |
| `auth-send-email` + Resend | **Present** | Auth Send Email Hook only |
| `dispatchAuthHookEmail` `invite` | **Present** | Subject “You've been invited to Waka POS”; CTA “Accept invitation” → Auth `/auth/v1/verify` |
| `buildAuthConfirmationUrl` | **Present** | Auth verify URL. No `shop_id` |
| `authCallbackSession.ts` | **Present** | Completes OTP types including `"invite"` / `"magiclink"` |
| `AuthCallbackPage` | **Present, owner-shaped** | After session: `ensureOwnerWorkspaceIfNeeded` then `markFirstTimeOwnerOnDevice` |
| `organization_members.invited_by` | **Unused** for shop staff | |
| Client `shop_members` insert | **None** | Reads only |
| Membership writes | **Owner bootstrap only** | `bootstrap_owner_workspace` inserts `auth.uid()` as **owner** |
| Latent RLS | **Open** | `shop_members` INSERT if `user_can_manage_shop` (`008`) — no token |

**Can we reuse Supabase Auth invite?**  
**Partially.** Reuse: branded email pipeline, verify URL builder, callback session bootstrap.  
**Missing:** shop id, role, PIN-staff link, single-shop authorization, consume-once token owned by WAKA.

Auth `invite` is account-scoped. `UNIQUE(shop_id, user_id)` is shop-scoped. One email can be cashier at Shop A and waiter at Shop B. Auth invite cannot express that.

**RECOMMENDATION:** WAKA invitation is the membership authority. Auth signup/login (or Auth invite as **delivery only**) creates `auth.users`. Do not treat Auth invite acceptance as `shop_members` insert.

---

# 2. Proposed database changes

**New table only.** Do not alter `auth.users`, `shop_members` columns, or 158–160.

```
public.shop_staff_invitations
  id              uuid PK
  shop_id         uuid NOT NULL → shops(id) ON DELETE CASCADE
  email           text NOT NULL          -- stored lower(trim)
  membership_role text NOT NULL          -- shop_members role only
  pos_role        text NOT NULL          -- shop_pos_staff / client UserRole
  staff_id        uuid NULL → shop_pos_staff(id) ON DELETE SET NULL
  invited_by      uuid NOT NULL → auth.users(id)
  token_hash      text NOT NULL          -- sha256 hex of single-use token
  expires_at      timestamptz NOT NULL
  accepted_at     timestamptz NULL
  accepted_by     uuid NULL → auth.users(id)
  revoked_at      timestamptz NULL
  created_at      timestamptz NOT NULL default now()
```

**Rules (constraints, not client logic):**

- `membership_role IN ('manager','cashier','stock_keeper','waiter','viewer')` — **never `owner`**
- `pos_role IN` client/PIN set (`manager`,`cashier`,`stock_keeper`,`supervisor`,`waiter`,`kitchen`,`bar`)
- Email check: `email = lower(trim(email))`
- Partial unique: one **pending** invite per `(shop_id, email)` where `accepted_at IS NULL AND revoked_at IS NULL`
- Unique `token_hash`
- `staff_id` if set must be same shop (enforce in RPC; optional trigger)
- RLS: no client SELECT of `token_hash`; table not granted to `anon`/`authenticated` (RPCs only), same pattern as other security-definer staff tables
- TTL: **7 days** (constant in RPC)
- No plaintext token column

Phase 4 already blocks two linked `shop_pos_staff` rows for the same `(shop_id, user_id)`.

Optional hardening (same migration or immediate follow-up): **revoke INSERT on `shop_members` from `authenticated`** after confirming no client insert (already true). Bootstrap stays security definer. Closes latent manager INSERT.

Do **not** add `shop_members.status` in Phase 5 unless accept needs `invited` rows before Auth exists. Invitation table already holds pending state.

---

# 3. Proposed RPC functions

All `security definer`, `search_path = public`, revoke from `public`/`anon`, grant execute to `authenticated` only.

### `shop_invite_staff(p_shop_id, p_email, p_membership_role, p_pos_role, p_staff_id uuid default null)`

1. `auth.uid()` required.
2. **`user_is_shop_owner(p_shop_id)` only** in Phase 5. Managers cannot invite.
3. Normalize email. Reject empty / invalid.
4. Reject `membership_role = owner`.
5. Reject if that email already has `shop_members` on this shop (join via `auth.users.email` if present, plus pending invite).
6. If `p_staff_id` set: row exists, `shop_id` matches, `user_id IS NULL`, not deleted.
7. Revoke any other pending invite for `(shop_id, email)`.
8. Generate 32+ byte token in the RPC **or** accept `p_token_hash` from an Edge Function that generated the secret. Prefer: RPC generates token, stores **hash only**, returns `{ ok, invitation_id, token }` **once**. Caller (Edge Function, not UI) sends email.
9. Insert invitation. `expires_at = now() + 7 days`. `invited_by = auth.uid()`.
10. Do **not** insert `shop_members` here.

**Email send:** Postgres should not call Resend. **RECOMMENDATION:** Edge Function `staff-invite` (`verify_jwt = true`) → owner JWT → RPC → Resend via existing `EmailService`. Owner UI never displays the raw token.

### `shop_accept_staff_invite(p_token text)`

1. `auth.uid()` required. Email should be confirmed (`auth.users.email_confirmed_at`).
2. `token_hash = sha256(p_token)`. Lookup. If none → `invalid_token`.
3. Reject if `revoked_at` set, `accepted_at` set, or `expires_at < now()`.
4. Reject if `lower(auth.email())` ≠ invitation email (cannot accept another shop’s / another person’s invite).
5. Reject if already a member of **this** `shop_id`.
6. Insert `shop_members (shop_id, user_id, role)` with `membership_role`. Conflict on unique → error, do not second-grant.
7. Link profile:
   - If `staff_id` set: `update shop_pos_staff set user_id = auth.uid() where id = staff_id and shop_id = … and user_id is null`. Phase 4 unique will reject a clash.
   - Else: insert a new `shop_pos_staff` row with `user_id = auth.uid()`, `role = pos_role`, generated `client_id`, no PIN required yet (PIN optional for personal-device staff).
8. Set `accepted_at`, `accepted_by`. Token cannot be reused.
9. Return `{ ok, shop_id, membership_role }`.

### `shop_revoke_staff_invite(p_invitation_id)` / `shop_list_staff_invitations(p_shop_id)`

Owner-only. List **without** `token_hash`. Revoke pending only.

### What the RPCs must not do

- Call `bootstrap_owner_workspace`
- Set `role = owner`
- Use `user_can_manage_shop` in Phase 5 (that includes managers and org admins)
- Write `sales.sold_by_user_id` or change `created_by`
- Change PIN verification

---

# 4. Security model

| Question | Rule |
|----------|------|
| Who can invite? | **Shop owner only** (`user_is_shop_owner`). Not manager in Phase 5. |
| Who can accept? | Authenticated user whose **verified email** matches the invite. |
| Other shop? | Token is bound to `shop_id`. Accept inserts only that shop. No shop id from the client. |
| Expired reuse? | `expires_at` check. Reject. Owner resends (new token, old revoked). |
| One token, many memberships? | `accepted_at` set on first success. Second call `already_accepted`. |
| Manager invite? | **No** in Phase 5. |
| Client forge `shop_members`? | Product path is RPC only. **Recommend** revoke table INSERT from `authenticated`. RLS write policy is latent today. |
| Forge token? | 256-bit secret, hashed at rest, not logged. |
| Invite owner? | Reject. One-owner trigger + role check. |
| PIN as Auth? | Unchanged. Invite does not sign out; accept uses invitee JWT. |
| Seller forge? | Out of scope (Phase 7). |

**Who authenticates after accept:** the staff person’s JWT.  
**Who authorizes Shop A:** new `shop_members` row.  
**Who is seller:** still Phase 3 rules until Phase 6/7 (`sold_by` only if local actor is already a UUID — which it will be if they use `signIn`, not `signInStaff`).

---

# 5. Existing PIN migration path

### A) New staff (no `shop_pos_staff` row)

```
Owner invites email + membership_role + pos_role (staff_id null)
  → invitation
  → accept
  → shop_members
  → new shop_pos_staff with user_id set (PIN unset until owner/staff set one)
```

Personal device: they never need PIN. Shared terminal later (Phase 8) can set PIN on that row.

### B) Existing PIN staff (`user_id` NULL)

```
John, shop_pos_staff.id = ABC, user_id NULL
Owner invites john@email.com with p_staff_id = ABC
  → invitation.staff_id = ABC
  → accept
  → shop_members
  → ABC.user_id = auth.uid()
  → pin_hash unchanged
```

PIN remains for shared terminals. `staff:<id>` local actor remains until Phase 6/8/10. Cloud seller stays NULL on PIN-switch until those phases.

If owner invites without `staff_id` while John already exists: accept creates a **second** staff row + link. Phase 4 allows that only if `user_id`s differ; two NULL rows are allowed. **RECOMMENDATION:** owner UI must pick the existing PIN profile when upgrading. RPC should reject a second linked profile for that user on that shop (Phase 4). Optionally reject invite if email matches `shop_pos_staff.email` but `staff_id` omitted.

---

# 6. Role mapping

Two vocabularies. **Store both. Do not silently drop POS roles.**

| Intent (PIN / UI) | `shop_members.role` (cloud authz) | `shop_pos_staff.role` (employment) |
|-------------------|-----------------------------------|-------------------------------------|
| owner | *not invitable* | *not a staff profile* |
| manager | `manager` | `manager` |
| cashier | `cashier` | `cashier` |
| stock_keeper | `stock_keeper` | `stock_keeper` |
| waiter | `waiter` | `waiter` |
| supervisor | `cashier` | `supervisor` |
| kitchen | `waiter` | `kitchen` |
| bar | `waiter` | `bar` |
| viewer | `viewer` | no staff row **or** omit PIN profile |

**EVIDENCE:** `shop_members` check (`072`) has no supervisor/kitchen/bar. `shop_pos_staff` check (`123`) has those, no owner/viewer. Client `UserRole` (`permissions.ts`) includes supervisor/kitchen/bar; `viewer` normalizes to `stock_keeper`.

`user_is_cashier_or_above` includes **viewer** today — a viewer invitee could push sales. Phase 5 should still allow `viewer` on invitations if product wants it, but **default invite role is `cashier`**. Do not “fix” viewer-can-sell in this phase unless you explicitly want that hardening in the same migration.

Custom permission JSONB on PIN staff is **not** copied onto `shop_members`. After accept, cloud authz is membership role only. Local custom permissions stay on the staff row for PIN/shared-terminal UI until a later permissions phase.

---

# 7. Multi-shop behavior

**Allowed:** one Auth user is cashier on Shop A and waiter on Shop B. Two invitations, two accepts. Phase 4 allows two `shop_pos_staff.user_id` links across shops. Auth email is globally unique; that is enough.

**Client gap (do not fix in Phase 5 schema):** `resolveShopCtx` uses **one** primary shop (`profiles.primary_shop_id`, else first owner/manager row). An owner invited as cashier on Shop B will still resolve Shop A first.

**RECOMMENDATION for Phase 5 accept:**

- Do **not** overwrite `primary_shop_id` if the user already has a membership.
- If this is their **first** membership, set `primary_shop_id` to the invited shop so `resolveShopCtx` works.

Document Shop B as a Phase 6+ session/`set_user_primary_shop` problem, not an invite-table problem.

---

# 8. Client architecture impact (audit only)

**Do not change in this design step.** Implementation later must be minimal.

| Area | Today | Phase 5 need |
|------|-------|----------------|
| Owner invite UI | PIN create only | New: email + role + optional existing staff picker |
| Accept route | None | `/staff/accept?token=` — sign up / sign in → `shop_accept_staff_invite` |
| `AuthCallbackPage` | Always `ensureOwnerWorkspaceIfNeeded` | **Must** accept pending invite **or** skip bootstrap if a pending invite exists for this email. Otherwise staff become owners of a new shop |
| `useAuth.signIn` | Owner email/password | **Reuse as staff login** after accept. Do **not** use `signInStaff` |
| `signInStaff` | Signs out JWT | **Frozen.** Still PIN-only |
| `SessionActor` | Auth UUID if no staff session | After email login: `user.id`. **Frozen prefix** for PIN |
| `resolveShopCtx` | JWT + `shop_members` | Works once accept inserted the row |
| `accountKey` | `sb:<authUserId>` | Staff get **their** namespace — empty local ledger; need pull-on-first-login (Phase 6 if not in 5) |
| Device enrollment | `user_can_access_shop`; **non-owners stay pending** (`141`) | Cashier device likely **pending until owner approves**. Independent JWT sync may still work; POS UI may block. Call out in tests |

Phase 5 GO is: second Auth user is a `shop_members` cashier and can obtain a JWT **without** the owner’s session. Full POS-on-cashier-device (empty IDB, device approval) may land in Phase 6.

---

# 9. Testing plan (when implementing)

Do not run these until implementation is approved.

| ID | Case | Expect |
|----|------|--------|
| I1 | Owner invites valid email | Row created; token_hash stored; plaintext not in DB |
| I2 | Non-owner / manager invites | `forbidden` |
| I3 | Invite `owner` role | Rejected |
| I4 | Second pending same shop+email | Old revoked; new token |
| I5 | Accept valid token as matching user | `shop_members` + `user_id` link |
| I6 | Accept with other account’s JWT | Rejected (email mismatch) |
| I7 | Accept after expiry | Rejected |
| I8 | Accept twice | Second `already_accepted`; still one membership |
| I9 | Token for Shop A used while claiming Shop B | Impossible (shop from row only) |
| I10 | New staff, no `staff_id` | New `shop_pos_staff` with `user_id` |
| I11 | Upgrade PIN staff `staff_id` | Same row linked; PIN hash unchanged |
| I12 | Duplicate link same shop | Phase 4 unique / RPC error |
| I13 | Same human, second shop | Allowed |
| I14 | AuthCallback without accept-first | **Must not** create a new owner shop |
| I15 | Frozen | `signInStaff`, `sessionActor` `staff:`, `rowToSale`, `created_by` ternary unchanged |
| I16 | 151–157 | Still unapplied |

Use a throwaway shop. Do not invite onto existing tenant shops in live testing.

---

# 10. Migration order (implementation, not now)

1. **Preflight:** CLI on `ljaedextsenbkxzzgxcg`. Do **not** `db push` (would apply 151–157). Targeted apply only.
2. **161** (name may vary): table + indexes + comments + RPCs + grants. Optional: revoke `shop_members` INSERT from `authenticated`.
3. **Edge Function** `staff-invite` (Resend). Do not put service role in the Vite app.
4. **Client (separate PR if needed):** owner invite UI; accept page; AuthCallback guard **before** `ensureOwnerWorkspaceIfNeeded`.
5. Verify I1–I16 on WAKA POS test/throwaway shop.
6. **STOP.** No Phase 6 (`signInStaff` rewrite) until approval.

Do not modify 158–160. Do not apply 151–157.

---

# Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| AuthCallback bootstrap creates a rogue owner shop | **P0** | Accept or skip-bootstrap **before** `ensureOwnerWorkspaceIfNeeded` |
| Auth invite treated as membership | **P0** | WAKA token is the only insert path |
| Latent `shop_members` RLS INSERT | **P1** | Revoke client INSERT; owner-only RPC |
| Token returned to browser | **P1** | Edge Function sends email; UI never shows token |
| Primary shop stays the other shop | **P1** | Set primary only on first membership; document multi-shop |
| Cashier device stuck `pending` | **P2** | Owner approval remains; Phase 6 UX |
| Empty `sb:<staffId>` ledger | **P2** | Force cloud pull after first staff login |
| Viewer can push sales | **P2** | Default invite `cashier`; optional later authz fix |
| Role vocab loss (kitchen/bar) | **P1** | Dual columns `membership_role` + `pos_role` |
| Existing Auth owner invited as cashier | **P2** | Allow second membership; do not steal primary shop |
| Email confirmation required | **P2** | Accept requires confirmed email; match `resolveShopCtx` |

---

# Frozen during Phase 5 implementation

- `sessionActor.ts` `staff:` prefix
- `useAuth.signInStaff` / PIN verify
- `rowToSale`, `saleFinancialMerge`, cashier filters
- `created_by` / Phase 3 observe helper
- Migrations 158–160
- 151–157

Allowed when approved: new 161, new Edge Function, new invite/accept UI, **narrow** AuthCallback ordering change.

---

# STOP

```
NO PHASE 5 CODE WAS WRITTEN.
NO MIGRATION WAS CREATED.
NO SQL WAS APPLIED.
NO AUTH FLOW WAS MODIFIED.

WAITING FOR APPROVAL TO IMPLEMENT PHASE 5.
```

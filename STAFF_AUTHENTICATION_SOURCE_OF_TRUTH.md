# DKASU POS Staff Authentication & Invitation — Source of Truth

**Status:** Audit complete; implementation not yet performed  
**Purpose:** Authoritative implementation reference for hardening the staff authentication and invitation system.

> Derived strictly from the supplied forensic audit. It preserves the audit's findings and limitations and does not silently reconcile production/repository differences.

## 1. Scope and limitations

The audit changed nothing in code or the database. It inspected repository code/migrations and ran read-only catalog queries and aggregate counts against the live Supabase project; no personal data was read.

The local shell did not fully start, so some files were read by staging rather than searching the entire tree.

`.env.production.local` was not opened because it contains secrets. Therefore, whether `VITE_ENABLE_GOOGLE_AUTH` is enabled in production remains unverified.

The Google Cloud client configuration, Supabase Google provider settings, and dashboard redirect list were not directly verified. No exploit was executed.

**Important:** live database definitions differ from repository migrations for `user_can_manage_shop`, `shop_device_can_manage_staff`, and `shop_members_role_check`. Reconcile live definitions before writing migrations.

## 2. Current architecture

There are three parallel identities:

1. **Cloud member:** `shop_members(shop_id, user_id, role)`.
2. **POS staff profile:** `shop_pos_staff`, including a nullable `user_id` link to `auth.users`.
3. **Local PIN session:** `SessionActor.userId = "staff:<id>"`, stored in `waka.staff.session.v1` and restored from offline staff cache.

A Google/Auth staff member does not become a `staff:<id>` actor. Their actor is the Auth UUID, with role read from `shop_members`. The `shop_pos_staff.user_id` link is used mainly for sales attribution. Custom-role/per-staff permission behavior for Auth staff still requires confirmation.

## 3. Current invitation flow

1. Owner uses `StaffCloudInviteCard` or `StaffLegacyUpgradeDialog`.
2. `sendStaffInvite()` calls the `staff-invite` Edge Function.
3. The function calls `shop_invite_staff`.
4. The RPC checks `auth.uid()`, owner status, lowercases email, rejects owner role, revokes an earlier pending invite, stores `sha256(token)`, and sets a 7-day expiry.
5. Email links to `/staff/accept?token=…`.
6. `StaffAcceptPage` stores the token in `sessionStorage`.
7. The page currently offers email/password sign-in or sign-up only; there is no Google button.
8. After authentication, `shop_accept_staff_invite(p_token)` locks the invitation and checks revoked, accepted, expired and email-match state.
9. It creates/links `shop_members` and `shop_pos_staff`, marks the invite accepted, and may set `profiles.primary_shop_id`.
10. Auth callback/workspace hydration preserves the invitation flow.

## 4. Current authentication

- **Web Google:** Google Identity Services popup + `supabase.auth.signInWithIdToken`; no nonce.
- **Native Google:** `signInWithOAuth`, system browser, `wakapos://callback`, then PKCE exchange.
- **Email/password:** common Supabase sign-in path.
- **Staff PIN:** separate local/offline authentication with server lockout counters.
- `auth_user_email_verified()` accepts `email_confirmed_at` or Google/Apple provider presence, but does not prove provider identity email matches the current user email.
- `config.toml` lists WAKA redirects while code uses DKASU redirects and `wakapos://callback`; dashboard must be authoritative.

## 5. Database structure

### `shop_members`

Columns include `id`, `shop_id`, `user_id`, `role`.

Roles include `owner`, `manager`, `cashier`, `stock_keeper`, `waiter`, `viewer`.

There is `UNIQUE(shop_id, user_id)`, ownership constraints, and a single-owner trigger.

### `shop_pos_staff`

Includes identity, role, PIN/password hashes, permissions, active/deleted state, `user_id`, lockout and device fields.

`user_id` is unique per shop when present and uses `ON DELETE SET NULL`.

### `shop_staff_invitations`

Includes `id`, `shop_id`, `email`, `membership_role`, `pos_role`, `staff_id`, `invited_by`, `token_hash`, `expires_at`, `accepted_at`, `accepted_by`, `revoked_at`.

It has unique token hashes and unique pending invitations per shop/email. RLS is enabled with no direct policies/grants; access is intended through RPCs.

Other relevant tables: `shop_staff_security_events`, `audit_logs`, `shop_devices`, `profiles.primary_shop_id`.

## 6. Security findings

### CRITICAL — C1: Manager can take over the shop

`shop_members` UPDATE/DELETE permissions allow a manager to delete the owner's membership and potentially promote themselves to owner.

**Fix:**
- Revoke UPDATE/DELETE on `shop_members` from `authenticated`.
- Add owner-only RPCs for role changes/removal.
- Add audit entries.
- Protect owner deletion/demotion and protected `shop_id`/`user_id` changes with server-side controls.

### HIGH — H1: Disabled/removed staff keep access

Access depends on `shop_members`, and the audit found no complete removal path.

**Fix:** synchronize staff disable/remove with membership access in one server RPC and enforce active/non-deleted state for non-owners.

### HIGH — H2: Role drift

The UI can change `shop_pos_staff.role` while Auth/RLS uses `shop_members.role`.

**Fix:** one atomic server-side role update that keeps both records synchronized.

### HIGH — H3: Credential hashes are exposed

Staff listing/download can expose `pin_hash` and `password_hash`.

**Fix:** remove hashes from normal cloud responses or move verification to a server-side function.

### HIGH — H4: Managers can directly write staff identity/role data

The broad `shop_pos_staff_write` policy can bypass device checks/auditing and manipulate `user_id`, role, permissions and email.

**Fix:** remove direct writes and route sensitive changes through controlled RPCs.

### MEDIUM — M1: Google is not required

Invitation acceptance currently accepts email/password and compares an email string. This does not enforce Google-only authentication.

**Fix:** require a Google identity whose email matches the invitation and is verified, checked server-side.

### MEDIUM — M2: Device authority bypass

A null fingerprint and a 2-argument `shop_pos_staff_upsert` can bypass intended device checks.

**Fix:** make device checks mandatory and remove the bypass overload.

### MEDIUM — M3: Any member can lock/unlock staff

Login/security RPCs are gated too broadly.

**Fix:** restrict these operations and bind login recording appropriately.

### MEDIUM — M4: Invitation token in query string

`/staff/accept?token=` may leak through browser history/logs/referrers.

**Fix:** move token to the URL fragment and use `Referrer-Policy: no-referrer`.

### MEDIUM — M5: Wrong-account UX

Wrong-account handling lacks a clear sign-out/switch-account path, and several invitation states share generic messaging.

### LOW

- Revoke unnecessary `anon` execution of SECURITY DEFINER functions.
- Revoke unnecessary `anon` table privileges.
- Add GIS nonce.
- Review leaked-password protection.
- Consider unique active staff email per shop.
- Check `is_active` when linking an invitation.
- Decide whether multi-shop accounts are intended.
- Gmail aliases can cause email matching false negatives.

## 7. Existing protections

The audit found:

- 256-bit invitation tokens.
- Only token hashes stored.
- Single-use acceptance with row locking.
- Expiry/revocation checks.
- Server-side shop derived from the invitation, preventing Shop A → Shop B redirection.
- Lowercased email matching.
- Owner role cannot be invited.
- Invitation table has no direct client access.
- Users without tenancy/invitation do not receive a shop.

## 8. Target architecture

```text
SHOP OWNER
  ↓
INVITE BY EMAIL
  ↓
INVITATION TOKEN
  ↓
/staff/accept
  ↓
CONTINUE WITH GOOGLE
  ↓
GOOGLE AUTH
  ↓
VERIFY GOOGLE IDENTITY + VERIFIED EMAIL
  ↓
GOOGLE EMAIL == INVITED EMAIL
  ↓
SERVER-SIDE ACCEPT INVITATION
  ↓
auth.users.id → shop_pos_staff.user_id
  ↓
shop_members MEMBERSHIP
  ↓
ASSIGNED ROLE/PERMISSIONS
  ↓
AUTH STAFF SESSION
  ↓
POS ACCESS
```

The invitation's shop must always come from the server-side invitation record. Client-supplied shop IDs must not be trusted.

## 9. Required database changes

1. Revoke UPDATE/DELETE on `shop_members` from `authenticated`.
2. Revoke unnecessary direct writes on `shop_pos_staff`.
3. Revoke unnecessary `anon` privileges.
4. Protect owner membership and protected identity/shop fields.
5. Add owner-only `shop_set_member_role`.
6. Add owner-only `shop_remove_member`.
7. Synchronize `shop_members` and `shop_pos_staff`.
8. Enforce active/non-deleted state in `user_can_access_shop`.
9. Remove credential hashes from non-owner staff responses.
10. Consider unique `(shop_id, lower(email))` for active staff.
11. Capture live function/policy definitions before migrations.
12. Update `shop_accept_staff_invite` to enforce verified Google identity matching.

## 10. Required frontend changes

- Add **Continue with Google** directly to `/staff/accept`.
- Do not allow email/password signup to bypass Google-only acceptance.
- Move token to URL fragment.
- Add dedicated wrong-account, expired, revoked, accepted, already-member and disabled states.
- Provide sign-out/switch-account for wrong account.
- Route owner staff-management actions through lifecycle RPCs.
- Confirm and apply custom roles/per-staff permissions for Auth staff if intended.

## 11. Required backend/Supabase changes

- Server-side Google identity and verified-email check in `shop_accept_staff_invite`.
- Remove 2-argument staff upsert bypass.
- Enforce device authorization where required.
- Restrict unlock/login/security-event RPCs.
- Add GIS nonce.
- Verify Google client/provider and Supabase dashboard redirects.
- Reconcile `config.toml`.
- Review leaked-password protection.
- Review invitation-route `Referrer-Policy`.

## 12. Test plan

Run against staging:

### Authentication
- Correct Google account accepts.
- Wrong Google account rejected and invitation remains pending.
- Email/password cannot bypass Google-only acceptance.
- Google identity must be verified.
- Tampered/missing OAuth callback fails.

### Invitation lifecycle
- Expired, revoked and already-accepted invitations fail distinctly.
- Replay fails.
- Duplicate invitation revokes previous pending invitation.
- Cross-shop acceptance is impossible.

### Staff lifecycle
- Disabled/removed staff lose access.
- Role changes update both membership and staff records.
- Staff cannot change their own role or permissions.

### Security/RLS
- Manager cannot directly update/delete `shop_members`.
- Manager cannot delete/promote owner.
- Manager cannot forge `shop_pos_staff.user_id`.
- Cashier cannot read credential hashes.
- Cashier cannot unlock another staff member.
- Non-owner cannot call owner-only invitation RPCs.
- Direct RPC abuse is denied.

### Session
- Logout/login restores correct staff identity.
- App restart restores correct session.
- OAuth round trip preserves invitation state.
- Auth staff receives correct shop and role.
- PIN/shared-terminal sessions remain independent.

## 13. Implementation phases

### Phase 1 — Reconcile production
Capture live functions, policies, grants, indexes and constraints. Compare against migrations.

### Phase 2 — Lock down membership writes
Protect owner membership, remove direct member writes, create lifecycle RPCs and audit changes.

### Phase 3 — Protect staff credentials
Hide hashes, remove direct staff writes, remove insecure upsert overload and enforce device checks.

### Phase 4 — Secure staff lifecycle
Synchronize membership/staff state, fix role drift, restrict lock/unlock/security operations.

### Phase 5 — Google-first invitation acceptance
Add Google button, remove password acceptance, verify Google identity/email server-side, link Auth user to staff.

### Phase 6 — Invitation UX
Implement dedicated invitation states, wrong-account switching, fragment token and referrer policy.

### Phase 7 — Auth staff permissions
Confirm and implement intended custom role/permission behavior.

### Phase 8 — Configuration/hygiene
Verify OAuth configuration, redirects, nonce, security settings and headers.

### Phase 9 — Full test suite
Run the complete staging matrix before production deployment.

## 14. Implementation rules

1. Never trust client-supplied `shop_id` for invitation acceptance.
2. Invitation shop comes from the server-side invitation.
3. A different Google account must never accept an invitation.
4. Google identity email must match the invited email.
5. Google identity must be verified.
6. Roles and permissions must be enforced server-side.
7. Credential hashes must not be exposed to ordinary staff.
8. Managers must not promote themselves to owner.
9. Managers must not delete/demote the owner.
10. Staff removal must revoke shop access.
11. `shop_members` and `shop_pos_staff` must remain synchronized.
12. Do not write migrations until production/repository drift is reconciled.
13. Preserve existing WAKA technical identifiers unless a technical change is explicitly required.
14. Preserve Android package ID `ug.waka.pos`.
15. Test security boundaries against staging before production.

## 15. Completion checklist

- [ ] Production/repository schema differences reconciled.
- [ ] Membership privilege escalation closed.
- [ ] Owner membership protected.
- [ ] Credential hashes protected.
- [ ] Direct staff-write bypasses removed.
- [ ] Staff/member lifecycle synchronized.
- [ ] Google button available on invitation acceptance.
- [ ] Email/password cannot bypass Google-only acceptance.
- [ ] Google identity verified server-side.
- [ ] Google email matches invitation email.
- [ ] Auth user securely linked to intended staff record.
- [ ] Assigned role/permissions applied correctly.
- [ ] Wrong-account acceptance rejected.
- [ ] Expired/revoked/replayed invitations rejected.
- [ ] Disabled/removed staff lose access.
- [ ] Cross-shop access prevented.
- [ ] RLS/RPC security tests pass.
- [ ] OAuth callback tests pass.
- [ ] Session restart/logout tests pass.
- [ ] Full staging suite passes.
- [ ] Production configuration verified.

## 16. Audit record

The audit inspected:

- `supabase/config.toml`
- `docs/RLS.md`
- migrations 002, 003, 007, 008, 010, 013, 014, 029, 076, 088, 090, 095, 107, 108, 114, 123–126, 142, 158–164, 183–185 and the round9 revoke
- Edge Functions `staff-invite` and `auth-send-email`
- `src/App.tsx`
- `StaffAcceptPage`
- `AuthCallbackPage`
- `LoginPage`
- `StaffAccessPage`
- `useAuth`
- `RoleProtectedRoute`
- `OwnerProtectedRoute`
- staff/auth libraries including `staffInvite*`, `sessionActor`, `googleIdentity`, `nativeGoogleAuth`, `authConfig`, `staffOfflineAuth`, `staffSecret`, `shopStaffCloud`, `permissions`, and `ownerProvisioning`

Not fully read/verified:

- most other migrations
- `StaffCloudInviteCard`
- `usePosStore`
- `staffCacheSync`
- `.env.production.local`
- Supabase dashboard
- Google Cloud dashboard

**Audit conclusion:** No major rewrite is required. The existing invitation/token/linking/session architecture can support secure Google-authenticated staff. The work is primarily hardening, server-side identity enforcement, lifecycle synchronization, and Google-first invitation UX.

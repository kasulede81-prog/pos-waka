# Waka POS — Post-Pilot Security Hardening Plan

**Date:** 2026-05-28  
**Status:** For review — **no implementation in this deliverable**  
**Pilot constraint:** Do not block onboarding; do not redesign subscriptions or architecture.  
**Scope:** Close the three **High** findings from [`PILOT_SECURITY_AUDIT.md`](./PILOT_SECURITY_AUDIT.md) (H1, H2, H3) plus a separate **map visibility** appendix (operational, not a security finding).

**Baseline score (audit):** **74 / 100** — Critical **0**, High **3**, controlled pilot **approved with conditions**.

---

## Executive summary

| Priority | ID | Issue | Fix shape | Est. effort |
|----------|-----|--------|-----------|-------------|
| 1 | **H3** | Anonymous phone → email lookup | Edge function + revoke `anon` on RPC | **0.5–1 day** |
| 2 | **H2** | Missing `pos_role` → owner on client | Resolve from `shop_members`; safe default | **1–1.5 days** |
| 3 | **H1** | Paid features UI-only | SQL plan helper + RPC/RLS guards | **1.5–2.5 days** |
| — | Map | Shops missing on agent/admin map | GPS backfill + env + UX fallback | **0.5–1 day** (parallel) |

**Total engineering:** ~**4–6 days** + **1 day** staging QA with two test tenants.

**Target score after sprint:** **~88–92 / 100** (High → 0; remaining Medium items unchanged).

---

## Rollout strategy (pilot-safe)

1. **Staging first** — Two orgs (free + starter), one staff user without `pos_role`, one agent account.
2. **Order of deploy** (lowest operational risk first):
   - **H3** — Deploy edge function *before* revoking `anon` on `lookup_password_reset_email`.
   - **H2** — Ship client role resolution; optional one-off metadata backfill for known staff (no forced logout).
   - **H1** — Ship SQL helpers + reporting guards + product insert guard; monitor support for “locked product” tickets.
3. **Production** — Apply migration in a quiet window; no pilot shop downtime required (RPC/RLS only).
4. **Do not** — Subscription redesign, new billing provider, or breaking changes to sale/return RPCs.

**Rollback:** Each item is independently revertible via migration revert or client revert; H3 edge function can stay while RPC `anon` grant is restored only in emergency (accept temporary enumeration risk).

---

## Risks

| Risk | Mitigation |
|------|------------|
| H3 breaks phone-based forgot-password | Deploy edge function first; keep uniform UX copy; E2E test on staging |
| H1 locks pilot shops with >7 products on free | **Grandfather:** block new inserts only when `count >= 7`; do not delete existing rows |
| H1 breaks local-only mode | Guards apply only when `auth.uid()` + remote subscription path; local mode unchanged |
| H2 downgrades legacy owners | Resolve `shop_members.role = 'owner'` before defaulting to `cashier` |
| Map backfill wrong coordinates | Mark pins “approximate”; prefer owner GPS capture in profile over blind geocode |
| Field agents see empty map | Confirm district assignment + `VITE_MAPBOX_TOKEN` on agent build |

---

## Testing requirements (acceptance)

| Check | How |
|-------|-----|
| Free user cannot bypass product limits | JWT + `insert` into `products` when count ≥ 7 → rejected |
| Free user cannot access premium reports | JWT + `rpc('shop_get_monthly_sales_summary')` → `plan_required` (or sanitized) |
| Staff cannot gain owner permissions | User without `pos_role`, `shop_members.role = cashier` → no owner routes |
| Password recovery works | Valid phone → email sent; invalid phone → same generic message |
| Pilot shops unaffected | Existing owners still `owner`; sales/sync unchanged; no migration data loss |

---

# Priority 1 — H3 Password recovery lookup

## Root cause

`lookup_password_reset_email` is **`SECURITY DEFINER`**, returns `{ ok, email }` for a valid `+256…` phone, and is granted to **`anon`** in `049_profile_lock_phone_recovery.sql`.

The forgot-password flow is **pre-auth** by design (`useAuth.requestPasswordReset` in `src/hooks/useAuth.ts`): if the identifier has no `@`, the client calls this RPC, then `resetPasswordForEmail` with the returned email.

That creates a **direct enumeration channel**: valid registered phones yield a recovery email; invalid phones yield `no_recovery_email` / `invalid_phone`.

## Uses (complete)

| Location | Role |
|----------|------|
| `src/hooks/useAuth.ts` → `requestPasswordReset` | Only production caller |
| `docs/PASSWORD_RESET_BRANDED_FLOW.md` | Documented |
| `docs/PILOT_SECURITY_AUDIT.md` | Finding H3 |

**Anonymous access is not intrinsically required** — only *password reset by phone without a session* is required. That can be implemented without returning the email to the browser.

## Recommended fix

**Pattern: opaque server-side reset (no email disclosure to client).**

1. **New Edge Function** `password-reset-by-phone` (service role):
   - Input: `p_phone_e164` (validated `^\+256[0-9]{9}$`).
   - Lookup profile email (same rules as today: exclude `%@login.waka.ug`).
   - If found: call Supabase Auth admin API to trigger reset (or use existing reset path server-side).
   - **Always** return `{ ok: true }` for well-formed phone (and optionally rate-limit per IP/phone).
   - Log failures server-side only.

2. **Migration `069_password_reset_hardening.sql`** (name TBD):
   - `REVOKE EXECUTE … FROM anon` on `lookup_password_reset_email`.
   - Optionally `REVOKE` from `authenticated` too and **deprecate** function, or restrict to `service_role` only.
   - Document rate limits (Supabase / CDN / edge).

3. **Client** (`useAuth.ts`):
   - Replace RPC with `supabase.functions.invoke('password-reset-by-phone')`.
   - User-facing copy: *“If an account exists, we sent instructions to the email on file.”* (same for hit/miss).

4. **Anti-enumeration**:
   - Uniform response + rate limit.
   - Do not distinguish `invalid_phone` vs `no_recovery_email` in UI (optional: still validate format client-side for UX).

## Regression test

- **Vitest/integration:** mock edge invoke; assert client never reads `email` from response.
- **Manual:** known pilot phone receives reset link; unknown phone shows generic success; `anon` JWT cannot execute old RPC (403).
- **Branded flow:** `/reset-password` PKCE path unchanged ([`PASSWORD_RESET_BRANDED_FLOW.md`](./PASSWORD_RESET_BRANDED_FLOW.md)).

## Migration

Yes — one small migration (revoke grants). Edge function deploy is **required** before revoke.

---

# Priority 2 — H1 Subscription enforcement

## Feature list (subscription-gated)

Derived from `src/lib/subscriptionEntitlements.ts`, route guards, and audit §5.

| Feature | Permission / rule | Min tier | UI enforced | Server enforced today |
|---------|-------------------|----------|-------------|------------------------|
| Product count cap (7) | implicit free cap | `free` | `productPlanLock`, Stock/Pos pages | **No** — `products` INSERT via RLS only checks role |
| Profit reports | `reports.profit` | `starter` | `ProfitPage`, `ReportsPage` sections | **No** — RPCs return profit fields |
| Cloud backup restore | `canUseBackupRestore` | `starter` | `OfficeHubPage` | **No** — `shop_cloud_snapshots` RLS = shop member only |
| Owner dashboard / activity | `owner.*`, `settings.shop` | `business` | Routes + `hasEffectivePermission` | Partial — RPCs use role, not plan |
| Staff accounts (local) | Business marketing | `business` | Settings UI | N/A (local prefs) |
| Multi-device hints | `maxDevicesHintForTier` | tiered | UI only | **No** |
| Server reporting bundle | `reports.view` + data richness | de facto all tiers in UI | `useShopReportBundle` → `shop_get_*` | **No** — `_report_assert_shop()` only |

**Pilot sprint scope (audit-aligned):** product limit, **premium** reporting RPCs / profit payload, cloud snapshot write for free tier.

## Enforcement matrix (target state)

| Surface | Control | After hardening |
|---------|---------|-----------------|
| React routes | `hasEffectivePermission` | Unchanged |
| `shop_get_daily_sales_summary` | RPC | Membership + optional: strip profit fields if `free` |
| `shop_get_weekly_sales_summary` | RPC | `assert_shop_plan_min('starter')` |
| `shop_get_monthly_sales_summary` | RPC | `assert_shop_plan_min('starter')` |
| `shop_get_top_products` | RPC | `assert_shop_plan_min('starter')` |
| `shop_get_inventory_insights` | RPC | `assert_shop_plan_min('starter')` |
| `shop_get_customer_insights` | RPC | `assert_shop_plan_min('starter')` |
| `shop_get_dashboard_analytics` | RPC | `assert_shop_plan_min('starter')` |
| `products` INSERT | RLS policy or `BEFORE INSERT` trigger | `free` → `count < 7` (grandfather existing) |
| `shop_cloud_snapshots` INSERT/UPDATE | RLS | `starter+` effective plan |
| `shop_push_sale_*` | RPC | Unchanged (not subscription-gated) |

## Recommended fix (lightweight)

### 1. SQL helper (mirror client `resolveEffectivePlanTier`)

Add in migration **`069_shop_plan_enforcement.sql`** (or combined):

```sql
-- organization_effective_plan_code(p_org_id uuid) returns 'free'|'starter'|'business'|'waka_plus'
-- Logic aligned with subscriptionEntitlements.ts:
--   trial/trialing → free; expired → free; active with past period_end → free; else plan code
```

```sql
-- assert_shop_plan_min(p_min_plan text) 
-- Uses waka_primary_shop_for_user() → org → effective plan → raise 'plan_required'
```

### 2. Wire into existing RPCs (`061_shop_server_reporting.sql`)

At top of each `shop_get_*` (except daily if you keep basic day summary free):

```sql
perform public.assert_shop_plan_min('starter');
```

Alternatively return HTTP-style JSON `{ error: 'plan_required' }` instead of `raise` if client already handles exceptions — match existing RPC error patterns.

### 3. Products

Prefer **`BEFORE INSERT` trigger** on `products`:

- Resolve shop → org plan.
- If `free` and `(select count(*) from products where shop_id = new.shop_id) >= 7` → reject.

Updates/deletes unchanged so pilot inventory is not destroyed.

### 4. Cloud snapshots

Extend `052_shop_cloud_snapshots.sql` policies:

- `INSERT`/`UPDATE` require `assert_shop_plan_min('starter')` for the snapshot’s `shop_id`.

### 5. Client

- Handle `plan_required` in `shopReporting.ts` with friendly upgrade message (no logic redesign).

## Required migrations

| Migration | Contents |
|-----------|----------|
| `069_shop_plan_enforcement.sql` | `organization_effective_plan_code`, `assert_shop_plan_min`, trigger, policy updates |
| Patch body of `061` functions **or** `CREATE OR REPLACE` in `069` for all `shop_get_*` |

## Required RPC changes

All functions in `061_shop_server_reporting.sql` listed above; no change to `shop_push_sale_complete` / returns.

## Regression tests

- SQL/pgTAP or script: free org → 7th product insert OK, 8th fails; starter → 8th OK.
- Free JWT → `shop_get_monthly_sales_summary` fails; starter succeeds.
- Paid pilot shop smoke: dashboard still loads.

---

# Priority 3 — H2 Role resolution

## Current behavior

| Layer | Behavior |
|-------|----------|
| `src/lib/permissions.ts` → `resolveAuthRole()` | Supabase: `user_metadata.pos_role` or `role`; if missing → **`owner`**. Local mode → `owner`. |
| `src/lib/sessionActor.ts` | Uses `resolveAuthRole`; dev override only if already owner; `activeStaffId` for owner device switching. |
| Database | `shop_members.role` set on onboarding (`save_owner_business_profile_bundle` → `'owner'`). **Not read** for session permissions on client. |
| RLS | Many tables use `user_is_cashier_or_above`, `user_can_manage_shop` — **server is stricter than UI** for some actions. |

**Risk:** Any Supabase user in `shop_members` without `pos_role` metadata gets **owner navigation** (dashboard, office, settings) while RLS may still block writes.

## Proposed behavior

1. **On Supabase session hydrate** (e.g. `useAuth` / `fetchShopSubscription` path): load primary shop’s `shop_members.role` for `auth.uid()`.
2. **`resolveAuthRole` order:**
   - If `shop_members.role` present → map via `normalizeUserRole` (`viewer` → `stock_keeper`).
   - Else if `user_metadata.pos_role` → use it (explicit override for support edge cases).
   - Else if `organization_members.role` in (`owner`,`admin`) and single-shop owner bootstrap → `owner` (compatibility).
   - Else → **`cashier`** (least privilege), not owner.
3. **Do not** change offline `staffSession` path.
4. **Optional migration:** backfill `auth.users.raw_user_meta_data.pos_role` from `shop_members` for known staff accounts (support script, not blocking).

## Migration impact

- **No schema change required** for minimal fix (client + optional metadata backfill).
- Optional **`070_sync_pos_role_metadata.sql`**: one-time `SECURITY DEFINER` function run by admin to copy `shop_members.role` → metadata for non-owner rows only.

## Compatibility risks

| Account type | Risk | Mitigation |
|--------------|------|------------|
| Pilot owners | Low | `shop_members.role = 'owner'` → unchanged |
| Owner without metadata | Medium if shop_members missing | Fall back to org owner membership check |
| Future cashier login | High if not fixed | Default `cashier` + metadata on invite |
| Dev role simulator | Low | Still requires `canUseDevRoleSimulator(authRole)` with authRole owner |

## Deliverables (implementation phase)

- Update `permissions.ts` + session bootstrap query.
- Document: set `pos_role` when creating staff Supabase accounts (runbook).
- Vitest: `resolveAuthRole` matrix cases.

---

# Appendix A — Map visibility (agent device + admin)

**Not a security audit finding** — included because pilot ops need referred shops visible on the map.

## Root cause

Maps only render pins when **`shops.latitude` and `shops.longitude` are non-null**:

- Agent: `referralRowToMapPin` (`src/lib/referralAgents.ts`) — filters null GPS.
- Admin: `internal_ops_field_map_pins` (`028` / `032`) — `WHERE latitude IS NOT NULL`.
- Map component: `LovableFieldMap` / `InternalFieldOpsMap` need **`VITE_MAPBOX_TOKEN`** (or fallback message).

**Data gap:** Onboarding defaults **`gpsSkipped: true`** (`ShopOnboardingPage.tsx`, `useAuth` sign-up). GPS is stored as null. Referrals join `shops` for coordinates — **empty map is expected** until GPS exists.

**Secondary factors:**

- Field agents: RPC filters shops to `waka_internal_my_districts()` — shops outside assigned districts are hidden.
- Missing Mapbox token in agent APK/web build → “Set VITE_MAPBOX_TOKEN” placeholder.

## Recommended fix (focused, non-architecture)

| Step | Action |
|------|--------|
| 1 | **Ops:** Set `VITE_MAPBOX_TOKEN` in production env for admin + agent builds. |
| 2 | **Data backfill:** One-off SQL or script: for shops with `district_id` but null GPS, set approximate coordinates from a static district-centroid table (extend `districts` with `lat`/`lng` or JSON map by `code`). Mark `gps_missing = true` and UI badge “approximate”. |
| 3 | **Product (post-pilot):** Default onboarding to request GPS (opt-out skip), not opt-in skip. |
| 4 | **UX:** When `mapPins.length === 0`, distinguish “no token” vs “no GPS” vs “no referrals” in copy. |
| 5 | **Agent referrals:** Ensure `sync_agent_referral_shop_context` runs after onboarding (already in auth flow via `067`) — fixes list labels, not GPS. |

**Effort:** 0.5–1 day (centroid table + backfill + env verify). **No pilot blocking.**

---

# Before / after security score

| Dimension | Before (audit) | After sprint (estimate) |
|-----------|----------------|-------------------------|
| Cross-shop isolation | Strong | Unchanged |
| Subscription bypass | **High (H1)** | **Resolved** — server aligns with UI |
| Role escalation (client) | **High (H2)** | **Resolved** — `shop_members` + safe default |
| Account enumeration | **High (H3)** | **Resolved** — opaque reset |
| Medium findings (M1–M3) | Open | Open (out of scope) |
| **Overall** | **74** | **~88–92** |

**Strict pilot approval:** Moves from **conditional** to **yes** for controlled pilot once High = 0 and staging checklist passes.

---

# Implementation checklist (for engineering ticket)

- [ ] H3: Edge function + migration revoke `anon` + client invoke + tests
- [ ] H2: `shop_members` role in session + `resolveAuthRole` + tests
- [ ] H1: `organization_effective_plan_code` + `assert_shop_plan_min` + product trigger + reporting RPCs + snapshot RLS + tests
- [ ] Map: Mapbox env + district centroid backfill + UX messaging
- [ ] Staging: two-tenant JWT script from audit §1 residual test
- [ ] Production: apply migrations 069+; deploy edge function; no pilot downtime

---

# References

- [`docs/PILOT_SECURITY_AUDIT.md`](./PILOT_SECURITY_AUDIT.md) — H1–H3 definitions, score 74
- [`supabase/migrations/049_profile_lock_phone_recovery.sql`](../supabase/migrations/049_profile_lock_phone_recovery.sql) — lookup RPC
- [`supabase/migrations/061_shop_server_reporting.sql`](../supabase/migrations/061_shop_server_reporting.sql) — reporting RPCs
- [`src/lib/permissions.ts`](../src/lib/permissions.ts) — role default
- [`src/lib/subscriptionEntitlements.ts`](../src/lib/subscriptionEntitlements.ts) — tier gates
- [`src/pages/MarketingAgentPage.tsx`](../src/pages/MarketingAgentPage.tsx) — agent map
- [`src/components/internal-admin/InternalOpsDashboard.tsx`](../src/components/internal-admin/InternalOpsDashboard.tsx) — admin map

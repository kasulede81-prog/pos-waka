# Waka POS — Focused production security audit (pilot readiness)

**Date:** 2026-05-28  
**Scope:** Critical and High production risks for pilot shops with real data and paying customers.  
**Method:** Static code and migration review (no live penetration test in this pass).  
**Code changes:** None (audit-only per request).

---

## Executive answer

**Is Waka POS safe enough for a pilot with real paying customers?**

**Conditionally yes** for a **small, controlled pilot** where:

- Shops are mostly **single-owner, single-device** (current product shape).
- You accept that **paid-tier limits are enforced mainly in the app UI**, not yet on the server for all features.
- Supabase **Site URL / redirect URLs** and migrations **061–068** are applied in production.

**Not ready** for a broad commercial launch with strict paid-tier enforcement until High issues below are fixed.

| Metric | Count |
|--------|------:|
| **Critical issues** | **0** |
| **High issues** | **3** |

**Pilot Security Approval (strict):** **Not granted** while High > 0.  
**Pilot Security Approval (controlled pilot):** **Granted with conditions** (see Final verdict).

**Security score:** **74 / 100** (focused pilot lens; not a full enterprise audit).

---

## 1. Shop data isolation (highest priority)

### Design reviewed

- Tenant model: `organizations` → `shops` → `shop_members` / `organization_members`.
- RLS helpers: `user_can_access_shop`, `user_can_manage_shop`, `user_is_cashier_or_above` (`008`, `007`, `RLS.md`).
- Core tables (`sales`, `customers`, `products`, `sale_line_items`, `receipts`, `expenses`, etc.) use `shop_id` in policies scoped to those helpers.

### Cross-shop access (Shop A → Shop B)

| Asset | Server enforcement | Verdict |
|--------|-------------------|---------|
| Customers | RLS `user_can_access_shop(shop_id)` | **Isolated** |
| Sales / lines / payments | RLS + sale RPC checks `p_shop_id` + membership | **Isolated** |
| Inventory / products | RLS on `shop_id` | **Isolated** |
| Reports (server RPCs) | `_report_assert_shop()` → primary shop for **caller only**; no client `shop_id` param | **Isolated** |
| Cloud snapshot | `shop_cloud_snapshots` RLS; client upsert uses `resolvePrimaryOrganizationForUser()` | **Isolated** |
| Local JSON backup file | Device-local; restore overwrites **this device** only | **N/A (local)** |

**Transactional RPCs** (`063_shop_push_sale_complete`, `062_shop_push_sale_return`):

- Require `auth.uid()`.
- Require `user_is_cashier_or_above(p_shop_id)`.
- Validate `sales` / `products` belong to `p_shop_id`.

**Attempted escalation:** Authenticated user passing another shop’s UUID as `p_shop_id` should receive `forbidden` unless they are org owner/admin for that org (intentional org-wide access).

### Residual isolation notes (not Critical)

- **Org owner/admin** can access all shops in their organization by design — not cross-tenant, but worth knowing for multi-shop orgs.
- **Security definer** RPCs bypass RLS but include explicit shop/membership checks — pattern is consistent on reviewed RPCs.
- **Recommended live test:** Two Supabase test users on two unrelated orgs; use browser devtools or `curl` with anon key + JWT to `select` / `rpc` against the other shop’s IDs.

**Finding:** No **Critical** cross-shop data leak identified in schema/RPC design.

---

## 2. Role and permission security

### Server

- Destructive/admin RPCs (`admin_*`, `internal_*`) check `is_waka_internal_staff()` or `is_waka_internal_role(...)`.
- `save_owner_business_profile_bundle` blocks edits after onboarding complete (`profile_locked`).
- Subscriptions table: write limited to org `owner` / `admin` / `billing` (RLS).

### Client

- `RoleProtectedRoute` + `hasPermission` / `hasEffectivePermission` gate routes (owner dashboard, office, profit, settings.shop, etc.).
- Staff offline login uses `staffSession` with role from local staff accounts (not Supabase metadata).
- Internal admin: `fetchWakaInternalAdminMe()`; UI redirects non-admins away (`AdminShell`); preview mode blocks mutating RPCs when `previewMode`.

### Gap (High — see below)

- `resolveAuthRole()` treats missing `user_metadata.pos_role` as **`owner`** (legacy default).
- `shop_members.role` is **not** synced into session role on the client.
- If a future **second Supabase login** is added for cashiers without setting `pos_role`, they get **owner UI** while RLS may still limit some writes.

**Staff → owner dashboard / billing / admin**

- UI: cashier lacks `owner.dashboard`, `settings.shop`, etc. **unless** misclassified as owner (metadata gap).
- Direct URL to `/internal/waka`: non-admin sees empty redirect; RPCs return forbidden.
- Billing/subscription **writes** via table: blocked by RLS for non-owner roles.

---

## 3. RPC security (sample of important functions)

| RPC | Auth | Shop / scope check | Role / staff check | Notes |
|-----|------|-------------------|-------------------|--------|
| `shop_push_sale_complete` | `auth.uid()` | `user_is_cashier_or_above(p_shop_id)` + row `shop_id` | Cashier+ | Definer; can amend completed sale totals (fraud MEDIUM) |
| `shop_push_sale_return` | Yes | Product/sale `shop_id` | Cashier+ | OK |
| `shop_get_*` reporting | Yes | `_report_assert_shop()` | Shop member | **No subscription tier check** |
| `apply_referral_code` | Yes | Self-referral blocked | N/A | One row per user (`agent_referrals_user_key`) |
| `marketing_agent_upgrade_referral_plan` | Yes | Referral owned by agent | Agent roles | Can set paid plans on referred shops (trusted-agent model) |
| `admin_subscription_set_plan` | Yes | — | Internal role | OK |
| `internal_ops_shop_detail` | Yes | — | `is_waka_internal_staff` | OK |
| `save_owner_business_profile_bundle` | Yes | Own onboarding | Locked after complete | OK |

**Privilege escalation:** No path found for a normal shop user to invoke internal admin RPCs successfully without a row in `internal_admins`.

---

## 4. Password recovery security

**Implementation:** Branded `/reset-password`, PKCE `exchangeCodeForSession`, `ensure_referral_attribution`-style bootstrap in `passwordRecoverySession.ts`, sign-out after reset.

| Check | Status |
|--------|--------|
| Expired links | Handled (OTP/expired messaging) |
| Reused / invalid tokens | Handled; form not shown without session |
| Account takeover via reset | **Low risk** if Supabase Auth + redirect URLs configured correctly |
| Password in logs | No intentional password logging found |
| Sensitive token logging | Dev-only `authDevLog`; avoid verbose auth logs in prod builds |

**Operational dependency (Medium):** Misconfigured Supabase **Redirect URLs** / **Site URL** can break recovery or send users to wrong host — not a code defect but a deployment risk.

---

## 5. Subscription security

| Control | Client | Server |
|---------|--------|--------|
| Profit / starter features | `hasEffectivePermission` | Reporting RPCs **do not** check plan |
| Backup / restore (cloud) | `canUseBackupRestore` | Snapshot RLS does not check plan |
| Product limit (7 on free) | `productPlanLock` / UI | **`products` insert** allowed for managers with no count cap |
| URL / route bypass | Blocks UI routes | Direct `rpc('shop_get_*')` still works |
| Local storage tampering | Can change local prefs | Subscription read from `subscriptions` table for cloud mode |

**Revenue impact:** A motivated free-tier owner can use the anon key + JWT to call reporting RPCs and insert unlimited products. Pilot shops using the stock app only are unlikely to do this.

---

## 6. Referral security

| Test | Result |
|------|--------|
| Self-referral | Blocked (`self_referral`) |
| Duplicate referral per user | `unique(referred_user_id)` + `already_applied` |
| Code manipulation | Normalized case; invalid codes rejected |
| Fake commission | No open “mint commission” RPC found; agent upgrade tied to owned referral rows |

**Abuse surface:** Compromised **VIP agent** account can upgrade referred shops to paid plans (`marketing_agent_upgrade_referral_plan`) — business/trust issue, not shop-user escalation.

---

## 7. Backup security

| Path | Cross-shop risk |
|------|-----------------|
| `restoreShopFromCloudSnapshot()` | Reads only `ctx.shopId` for logged-in user |
| `uploadShopCloudSnapshot()` | Upserts only resolved primary shop |
| Local file import | Overwrites local device; next cloud upload affects **own** shop only |
| Download another shop’s backup file | Does not read other shop’s cloud data; could **corrupt own** shop if file imported |

**Finding:** No cross-shop **download** of another tenant’s cloud backup via API. File-based restore is a local integrity risk, not tenant bypass.

---

## 8. Client secrets review

| Item | Finding |
|------|---------|
| `VITE_SUPABASE_ANON_KEY` | Expected in SPA; safe if RLS sound |
| Service role | Not found in `VITE_*` client env examples |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | Public by design |
| Edge functions | Service role server-side only (e.g. permanent delete user) |

**Verdict:** No exposed service-role key in client bundle patterns reviewed.

---

# CRITICAL ISSUES

**None identified** in this audit for cross-tenant data exposure or unauthenticated admin takeover.

---

# HIGH ISSUES

### H1 — Paid features bypassable via API (subscription not enforced server-side)

**Description:** Plan gates (`reports.profit`, backup restore UI, product limits) are enforced in the React app. Server reporting functions (`shop_get_daily_sales_summary`, `shop_get_monthly_sales_summary`, etc. in `061_shop_server_reporting.sql`) only verify shop membership, not subscription tier. Free-tier users with `user_can_manage_shop` can insert unlimited `products` rows.

**Exploitation scenario:** Shop owner on free plan extracts JWT from app, calls `shop_get_monthly_sales_summary` and posts extra products via Supabase REST — bypassing Starter/Business limits without paying.

**Fix recommendation:** Add `assert_shop_plan_min('starter'|'business')` (or equivalent) inside reporting RPCs and product insert policy/trigger; enforce snapshot upload tier on server if backup is paid-only.

---

### H2 — Supabase users without `pos_role` metadata default to owner on client

**Description:** `resolveAuthRole()` returns `owner` when `user_metadata.pos_role` is absent (`permissions.ts`). Database `shop_members.role` is not used for UI permissions.

**Exploitation scenario:** A cashier Supabase account (if introduced) without metadata gets owner navigation (dashboard, office hub, upgrade UI). RLS blocks many actions, but increases attack surface and confusion; some RPCs only require cashier+.

**Fix recommendation:** Resolve role from `shop_members` for the active shop; default to least privilege (`cashier`), not `owner`. Set `pos_role` on invite/sign-up flows.

---

### H3 — Anonymous phone → email lookup (`lookup_password_reset_email`)

**Description:** `049_profile_lock_phone_recovery.sql` grants `execute` to **`anon`** on `lookup_password_reset_email`, returning the owner’s recovery email for a valid Uganda phone number.

**Exploitation scenario:** Attacker enumerates phone numbers registered on Waka and learns associated emails for phishing or credential attacks.

**Fix recommendation:** Require authenticated session, rate-limit, or return only “if account exists, email sent” without disclosing email to anon callers.

---

# MEDIUM ISSUES

### M1 — `shop_push_sale_complete` can modify financial fields on already-completed sales

**Description:** When `v_was_completed` is true, RPC still updates totals/payment fields on completed sales.

**Exploitation scenario:** Insider with cashier access alters historical sale totals after the fact.

**Recommendation:** Reject updates to completed sales except via controlled void/return flows.

---

### M2 — Internal admin UI reachable by any logged-in user (`?preview=1`)

**Description:** Authenticated non-admins hitting `/internal/waka?preview=1` see preview chrome; mutating RPCs are gated by `previewMode`.

**Exploitation scenario:** Information disclosure of admin UX layout only; low data risk.

**Recommendation:** Restrict preview to dev builds or internal staff IPs.

---

### M3 — Agent referral plan upgrades (trusted insider)

**Description:** VIP agents can elevate referred shops to paid plans via RPC.

**Recommendation:** Audit logging (partially present), rate limits, super-admin review for VIP agents.

---

### M4 — Password recovery depends on Supabase redirect configuration

**Recommendation:** Verify production redirect list includes `/reset-password` (see `PASSWORD_RESET_BRANDED_FLOW.md`).

---

### M5 — RPC error responses may include raw `sqlerrm` (e.g. `shop_push_sale_complete`)

**Recommendation:** Map to stable error codes in production.

---

# LOW ISSUES

### L1 — `local` auth mode grants full tier in entitlements (`local_full`)

**Description:** Intentional for offline demo; ensure production builds always use Supabase auth for pilot shops.

### L2 — Org-wide shop access for org owners

**Description:** By design; document for multi-shop customers.

### L3 — Dev role override in preferences

**Description:** Gated to owner + dev; ensure disabled in production builds.

---

# FINAL VERDICT

| Item | Value |
|------|--------|
| **Security score** | **74 / 100** |
| **Critical issues** | **0** |
| **High issues** | **3** |
| **Pilot ready (strict: High = 0)** | **NO** |
| **Pilot ready (controlled pilot)** | **YES, with conditions** |

### Blockers for strict “paid pilot” approval

1. **H1** — Server-side subscription enforcement for reporting, product limits, and paid backup.
2. **H3** — Anonymous recovery email lookup (privacy/abuse).
3. **H2** — If multi-user Supabase logins are in scope for pilot.

### Conditions for proceeding now (controlled pilot)

- Pilot cohort is **single-owner shops** using the official app (not raw API abuse).
- Apply migrations **061–068** and password-reset redirect config.
- Run **two-shop cross-access smoke test** in staging (JWT A cannot read B’s `sales` / `customers` / `shop_cloud_snapshots`).
- Monitor **H1** until server plan checks ship.

### First 30 days monitoring (if pilot starts)

- Supabase Auth logs: spikes in `resetPasswordForEmail`, failed `exchangeCodeForSession`.
- RPC errors / unusual `shop_push_sale_complete` volume per shop.
- `admin_*` / `internal_*` RPC calls — should only match internal admin user IDs.
- Subscription table changes not matching billing (agent upgrades vs payments).
- Support tickets: wrong shop data (possible local backup restore misuse).
- New product count per shop on `free` plan (detect H1 abuse).

---

## Recommended verification tests (staging)

1. User A JWT: `select * from sales where shop_id = '<B_shop>'` → expect 0 rows or policy error.
2. User A: `rpc('shop_push_sale_complete', { p_shop_id: B, ... })` → `forbidden`.
3. Free-tier user: `rpc('shop_get_monthly_sales_summary')` → document whether profit fields return (confirms H1).
4. Forgot-password link → lands on `pos.waka.ug/reset-password`, single use, then login.
5. `apply_referral_code` with own agent code → `self_referral` error.

---

*This audit does not replace a live penetration test or Supabase project configuration review. Re-run after major auth, RLS, or RPC changes.*

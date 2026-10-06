-- ============================================================================
-- M2 — SUBSCRIPTION ENTITLEMENT WRITE LOCKDOWN
-- ============================================================================
-- Forensic audit (post-M1, commit b46e084c) proved that the old 008/010
-- posture let an organization owner directly mutate their subscription row
-- through PostgREST: plan_id, status, payment_status, current_period_start /
-- end, trial_ends_at, billing_interval, admin_discount_percent, metadata,
-- activation_source, shop_id and even id were all writable, and fabricated
-- subscription rows could be INSERTed. Those fields are trusted by both the
-- client readers (SubscriptionContext → fetchShopSubscription) and the server
-- reader (shop_get_effective_subscription), so the hole granted real
-- entitlement and revenue-state forgery.
--
-- The audit also established that EVERY legitimate runtime subscription writer
-- is already SECURITY DEFINER (signup bootstrap, onboarding bundle, admin plan
-- set, status lifecycle, trial extension, manual/automatic payments, trial
-- requests, annual offers, agent upgrades, M1 payment settlement), that no
-- application code performs direct table DML on subscriptions, and that no
-- Edge Function writes it. Revoking client DML therefore breaks nothing —
-- this migration removes the capability without touching a single function.
--
-- Final contract:
--   CLIENT   → SELECT only, under the existing subscriptions_select RLS
--              policy (019, unchanged: org roles + internal staff).
--   SERVER   → SECURITY DEFINER RPCs remain the only mutation path;
--              postgres / service_role keep their privileges.
--
-- Additive and idempotent: only a table REVOKE (privileges, no schema/data
-- change) and two DROP POLICY IF EXISTS statements. No table structure, no
-- data, no function bodies, no function signatures, no RPC grants, no
-- FORCE ROW LEVEL SECURITY. Safe to run after M1 and on production.

-- 1) Client roles lose all direct mutation on the entitlement table.
--    SELECT is untouched: no select privilege is revoked here, and the
--    subscriptions_select policy (019) is deliberately left in place.
revoke insert, update, delete, truncate on table public.subscriptions from anon, authenticated;

-- 2) Retire the obsolete direct-write policies from 008 (INSERT WITH CHECK /
--    UPDATE USING for org owner/admin/billing). They are dead once the grants
--    above are gone, but they are dropped as well so that re-running an
--    010-style blanket grant in the future cannot re-open the write path:
--    with no write policy, RLS denies the write even if a grant reappears.
drop policy if exists subscriptions_write on public.subscriptions;
drop policy if exists subscriptions_update on public.subscriptions;

-- Deliberately NOT touched:
--   * subscriptions_select (019) — owners/staff must keep reading their
--     subscription rows (billing UI, SubscriptionContext, internal admin).
--   * service_role / postgres DML — definer bodies and future server-side
--     provider adapters keep working.
--   * EXECUTE grants on any RPC — every legitimate flow continues to be
--     reachable, just never through the table itself.
--   * subscriptions schema/rows — no structure or data change.

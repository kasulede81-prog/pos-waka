-- RECONCILIATION BACKFILL — this migration was applied directly to production
-- on 2026-09-13 (recorded version 20260913213131) without ever being committed
-- to this repository. Discovered during the WAKA POS financial certification
-- audit (P1#3 — migration drift). Reproduced here VERBATIM from
-- supabase_migrations.schema_migrations.statements for that version — no
-- content has been altered. This file intentionally reproduces the exact
-- production version identifier as its filename prefix so tooling recognizes
-- it as already applied; it must NOT be re-applied.

-- CREATE FUNCTION defaults to GRANT EXECUTE TO PUBLIC (which includes anon at
-- the privilege-check level) unless explicitly revoked. The intent for
-- admin_reset_shop_business_data was to match the stricter grant set used by
-- admin_permanently_delete_shop_account (authenticated, service_role, postgres
-- only -- no PUBLIC/anon), not the looser set used by lower-severity siblings
-- like admin_shop_reset_sync. The internal is_waka_internal_role() check
-- already blocks unauthorized callers regardless, but the grant should match
-- the documented, tighter intent.
revoke all on function public.admin_reset_shop_business_data(uuid, text, text) from public, anon;
grant execute on function public.admin_reset_shop_business_data(uuid, text, text) to authenticated, service_role;

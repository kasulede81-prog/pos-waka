-- Privilege hardening only — no logic, signature, RLS, table, or data changes.
-- Already applied and verified live in production; mirrors that deployed state for
-- source control.
--
-- Closes a default-privilege gap where `anon` had EXECUTE on the four historical
-- financial correction functions (192_historical_financial_correction_platform_functions.sql)
-- despite each already gating on auth.uid() internally. authenticated's EXECUTE grant
-- is untouched.

revoke execute on function public._is_finite_numeric_text(text) from anon;
revoke execute on function public.shop_correct_sale_line_financials(uuid, uuid, uuid, bigint, jsonb, jsonb, text) from anon;
revoke execute on function public.admin_regenerate_day_close_for_correction(uuid, text) from anon;
revoke execute on function public.shop_get_financial_fingerprint(uuid) from anon;

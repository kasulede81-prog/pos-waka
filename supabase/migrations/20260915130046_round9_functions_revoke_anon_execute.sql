-- Reconstructed from production.
--
-- Recovered verbatim from supabase_migrations.schema_migrations.statements for
-- version 20260915130046 (name: round9_functions_revoke_anon_execute), which is APPLIED in production. Filed under its exact
-- production version so local history matches what production actually ran and the
-- CLI does not treat it as pending. No production schema was changed to create this.
--
-- Privilege hardening only — no logic, signature, RLS, table, or data changes.
-- Closes the default-privilege gap where anon had EXECUTE on the four Round 9
-- historical-financial-correction functions despite each already gating on
-- auth.uid() internally. authenticated's EXECUTE grant is untouched.

revoke execute on function public._is_finite_numeric_text(text) from anon;
revoke execute on function public.shop_correct_sale_line_financials(uuid, uuid, uuid, bigint, jsonb, jsonb, text) from anon;
revoke execute on function public.admin_regenerate_day_close_for_correction(uuid, text) from anon;
revoke execute on function public.shop_get_financial_fingerprint(uuid) from anon;


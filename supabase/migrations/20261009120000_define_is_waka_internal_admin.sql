-- ============================================================================
-- DEFINE public.is_waka_internal_admin() — the missing gate behind
-- admin_update_platform_subscription_settings
-- ============================================================================
-- PROVEN against production (project ljaedextsenbkxzzgxcg), not inferred:
--
--   * `gen types --linked` lists `is_waka_internal_staff` and
--     `is_waka_internal_role` but NOT `is_waka_internal_admin` — and it does
--     expose helpers of that class, so the absence is real, not a privilege
--     artefact.
--   * `db lint --linked` (plpgsql_check, compiling the DEPLOYED body) reports:
--         function: public.admin_update_platform_subscription_settings
--         message:  function public.is_waka_internal_admin() does not exist
--         text:     not public.is_waka_internal_admin()
--
-- CONSEQUENCE: every call to `admin_update_platform_subscription_settings`
-- raises 42883 at the gate, so the admin **Subscription Policy** page
-- (`/internal/waka/subscription-settings`) has never been able to save. The
-- client only guards against PostgREST's PGRST202, so this surfaced as a raw
-- Postgres error rather than a local fallback.
--
-- WHY DEFINE THE FUNCTION RATHER THAN REWRITE THE RPC. This is purely ADDITIVE.
-- Nothing can call a function that does not exist, so creating it cannot change
-- the behaviour of anything that works today; editing the deployed RPC instead
-- would rewrite a live function body. It also fixes the name for any future
-- caller, and leaves the RPC byte-identical to its reviewed form.
--
-- THE ROLE SET IS NOT ARBITRARY. It matches the page's own client gate
-- (`AdminPlatformSubscriptionSettingsPage.tsx`: `isSuperAdmin(role) ||
-- role === "operations_admin"`). Deliberately NOT `is_waka_internal_staff()`
-- (any internal admin could then rewrite platform pricing policy) and
-- deliberately not `subscriptions_admin`, which would leave operations_admin
-- looking at controls the server refuses — the exact UI/server mismatch class
-- fixed elsewhere in this batch. **If the intended policy differs, change BOTH
-- sides together.**
--
-- Follows the convention of `is_waka_internal_staff` / `is_waka_internal_role`:
-- language sql, stable, security definer, explicit search_path, EXECUTE granted
-- explicitly rather than left to PUBLIC.

create or replace function public.is_waka_internal_admin ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_waka_internal_role (array['super_admin', 'operations_admin']::text[])
$$;

revoke all on function public.is_waka_internal_admin () from public;
grant execute on function public.is_waka_internal_admin () to authenticated;

comment on function public.is_waka_internal_admin () is
  'Platform subscription policy editors: super_admin and operations_admin. '
  'Gate for admin_update_platform_subscription_settings; matches the admin '
  'Subscription Policy page.';

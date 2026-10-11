-- ============================================================================
-- Discount authorization + internal pricing-helper hygiene
-- ============================================================================
-- APPROVED DECISION E. "Only the existing billing-authorized internal admin
-- roles may create, edit, or delete discounts or authorize free activation.
-- Enforce permissions server-side, including direct RPC calls."
--
-- WHAT WAS WRONG. Every discount RPC gated on `_pricing_require_admin()`, which
-- is `is_waka_internal_staff()` — i.e. ANY row in `internal_admins`, whatever
-- its role. The admin screens gate on the much narrower `canManageBillingOffers`
-- (super_admin | subscriptions_admin | finance_admin | operations_admin), so
-- support_admin and field_agent were refused by the UI and ACCEPTED by the
-- server. A discount is a money control; the server must not be the looser of
-- the two.
--
-- THE FIX IS AT ONE POINT. `_pricing_require_admin()` keeps its name and its
-- signature (so no caller needs rewriting and none can be missed), but its body
-- now delegates to the new `_pricing_require_billing_admin()`. Every RPC that
-- already called it — both discount setters, the delete, both read RPCs, and
-- every pricing-campaign RPC — becomes billing-gated in one edit. The new name
-- exists so new code reads as what it means.
--
-- `admin_subscription_mark_payment` (20261007250000) already uses exactly this
-- role array, so the discount surface now matches the manual-payment surface.
--
-- SECOND PART: HELPER HYGIENE. `_pricing_audit`, `_pricing_compute_plan_row`,
-- `_pricing_min_final_monthly_ugx`, `_pricing_active_campaign_id`,
-- `pricing_campaign_is_active` and `admin_plan_discount_is_active` were created
-- with no GRANT/REVOKE at all, so they kept PostgreSQL's default EXECUTE TO
-- PUBLIC. `_pricing_audit` is SECURITY DEFINER and writes
-- `internal_ops_admin_audit` with no check inside its body, so an anonymous
-- caller could insert audit rows. All of them are internal helpers called by
-- SECURITY DEFINER functions (whose nested calls run as the owner), so no
-- client role needs EXECUTE and every one is revoked here.
--
-- Nothing here changes a price.

-- ----------------------------------------------------------------------------
-- The billing gate
-- ----------------------------------------------------------------------------
create or replace function public._pricing_require_billing_admin ()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- The same four roles `canManageBillingOffers` shows the screens to, and the
  -- same array `admin_subscription_mark_payment` accepts.
  if not public.is_waka_internal_role (
    array['super_admin', 'subscriptions_admin', 'finance_admin', 'operations_admin']::text[]
  ) then
    raise exception 'forbidden';
  end if;
end;
$$;

comment on function public._pricing_require_billing_admin () is
  'The single authorization gate for every discount/pricing mutation: the four '
  'billing-authorized internal roles. Mirrors canManageBillingOffers in '
  'src/components/internal-admin/v2/adminRoles.ts — change BOTH together.';

revoke all on function public._pricing_require_billing_admin () from public;
revoke all on function public._pricing_require_billing_admin () from anon;
revoke all on function public._pricing_require_billing_admin () from authenticated;

/**
 * Kept as the name every existing caller uses. Its body is now the billing
 * gate, so a caller cannot be "missed" by this migration: there is exactly one
 * place where the old, too-broad predicate lived.
 */
create or replace function public._pricing_require_admin ()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._pricing_require_billing_admin ();
end;
$$;

comment on function public._pricing_require_admin () is
  'Deprecated alias of _pricing_require_billing_admin(). Was is_waka_internal_staff() '
  '(any internal admin); now the four billing roles.';

revoke all on function public._pricing_require_admin () from public;
revoke all on function public._pricing_require_admin () from anon;
revoke all on function public._pricing_require_admin () from authenticated;

-- ----------------------------------------------------------------------------
-- The audit writer checks the caller itself
-- ----------------------------------------------------------------------------
-- It is SECURITY DEFINER and inserts into the platform audit table. Its callers
-- gate first, but relying on that made the helper safe only by convention: a
-- direct RPC call bypassed every gate. Checking here means an audit row can
-- only be written by a billing-authorized admin, whoever calls it.
create or replace function public._pricing_audit (
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._pricing_require_billing_admin ();

  insert into public.internal_ops_admin_audit (actor, action, payload)
  values (auth.uid (), p_action, coalesce (p_payload, '{}'::jsonb) || jsonb_build_object ('at', now ()));
end;
$$;

revoke all on function public._pricing_audit (text, jsonb) from public;
revoke all on function public._pricing_audit (text, jsonb) from anon;
revoke all on function public._pricing_audit (text, jsonb) from authenticated;

-- ----------------------------------------------------------------------------
-- The remaining internal helpers — no client role needs any of them
-- ----------------------------------------------------------------------------
do $revoke$
declare
  sig text;
begin
  foreach sig in array array[
    'public._pricing_compute_plan_row (text, text, numeric, numeric)',
    'public._pricing_min_final_monthly_ugx ()',
    'public._pricing_active_campaign_id ()',
    'public.pricing_campaign_is_active (public.pricing_campaigns)',
    'public.admin_plan_discount_is_active (public.admin_plan_discounts)',
    'public._admin_discount_for_row (public.subscriptions)',
    'public._admin_discount_effective (numeric, text)',
    'public._admin_discount_campaign_amount (text, text)'
  ] loop
    if to_regprocedure (sig) is not null then
      execute format ('revoke all on function %s from public', sig);
      execute format ('revoke all on function %s from anon', sig);
      execute format ('revoke all on function %s from authenticated', sig);
    end if;
  end loop;
end;
$revoke$;

notify pgrst, 'reload schema';

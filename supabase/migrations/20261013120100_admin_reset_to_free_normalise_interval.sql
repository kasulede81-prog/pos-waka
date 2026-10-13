-- ============================================================================
-- Reset to Free — normalise `billing_interval` to the canonical Free value
-- ============================================================================
-- WHY A NEW FILE. `043_repair_admin_shop_plan_rpc.sql` (which defines this RPC,
-- and which is what production actually has — 041 was never applied) is already
-- live, so it is not edited again. This file re-declares the ONE function and
-- changes ONE assignment.
--
-- THE BUG. The Free branch clears `current_period_end`, `trial_ends_at` and
-- `payment_status`, but it never touched `billing_interval`. A shop that was on
-- ANNUAL Business and is reset to Free therefore keeps `billing_interval='year'`
-- on a zero-price plan. It is not a security hole — printer eligibility reads
-- `lower(sp.code) = 'business'` as well, so an annual flag on a Free plan still
-- refuses the promotion — but it leaves a row that contradicts itself, and the
-- next read that trusts the interval alone would be misled.
--
-- THE CANONICAL VALUE IS 'month'. Taken from the free-onboarding insert in
-- `044_free_onboarding_referral_agents.sql` (which writes `'active', 'month'`
-- for a Free subscription) and from this RPC's own INSERT branch, which writes
-- 'month' for every newly created row. Normalising the UPDATE branch to match
-- makes the two branches agree.
--
-- PAID PLANS ARE DELIBERATELY UNTOUCHED. `billing_interval` is meaningful for a
-- paid plan — annual Business is exactly what qualifies for the printer
-- promotion — so the paid path keeps whatever interval the row already had.
-- This is the current behaviour and it is preserved byte for byte:
--
--     case when v_plan_code = 'free' then 'month' else s.billing_interval end
--
-- DECISION — `admin_discount_percent` IS NOT CLEARED, ON PURPOSE.
-- Inspected before deciding:
--   * it is a deliberate, admin-set override ("Manual override by Waka admin
--     (0–100)", migration 006) with a companion `admin_discount_note`;
--   * it has its own audited setter, `admin_subscription_discount_save`
--     (20261010120000), which validates the range and caps it at 99%;
--   * a sibling column `admin_discount_percent_annual` was added later
--     (20261012100000), so the field is live and actively maintained.
-- Clearing it here would SILENTLY DESTROY an admin's recorded intent as a side
-- effect of a plan change, and the history row this RPC writes does not record
-- the discount at all — so the erasure would leave no trace of what was lost.
-- A Free plan is zero-priced, so the discount has no effect while the shop sits
-- on Free; it only becomes live again if the shop buys a plan. The UI therefore
-- WARNS that a manual discount is retained rather than erasing it. If the
-- business wants Reset-to-Free to clear discounts, that belongs in its own
-- audited change with the old value captured in the history payload.
--
-- LIKEWISE NOT DONE HERE: promotional grants are not revoked. `shop_effective_plan_code`
-- resolves a grant ABOVE the subscription's base tier, so a shop with an active
-- grant stays on the granted tier after this reset. That is existing, deliberate
-- behaviour (a grant is an overlay, not a subscription), and revoking one is a
-- separate audited operation — `revokePromotionalGrant`. The UI warns instead.
--
-- UNCHANGED: the role gate, the plan whitelist, the shop/plan lookups, the
-- cancellation of the org's OTHER active/trial rows, `payment_status`,
-- `external_provider` / `activation_source`, the history write, the audit_logs
-- write, the response shape, and the grants/revokes at the bottom.

create or replace function public.admin_shop_set_subscription_plan (
  p_shop_id uuid,
  p_plan_code text,
  p_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_code text := lower (trim (coalesce (p_plan_code, '')));
  v_days integer := greatest (1, coalesce (p_days, 30));
  v_role text;
  v_org uuid;
  v_plan uuid;
  v_sub_id uuid;
  v_old_plan text;
  v_period_end timestamptz;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select ia.role into v_role
  from public.internal_admins ia
  where ia.user_id = auth.uid ()
    and ia.active = true
  limit 1;

  if v_role is null or v_role not in (
    'super_admin', 'subscriptions_admin', 'finance_admin', 'operations_admin'
  ) then
    raise exception 'Forbidden';
  end if;

  if v_plan_code not in ('free', 'starter', 'business', 'waka_plus') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_plan');
  end if;

  select s.organization_id into v_org
  from public.shops s
  where s.id = p_shop_id
  limit 1;

  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  select sp.id into v_plan
  from public.subscription_plans sp
  where sp.code = v_plan_code
    and sp.is_active
  limit 1;

  if v_plan is null then
    return jsonb_build_object ('ok', false, 'error', 'plan_not_found');
  end if;

  select s.id, sp.code
  into v_sub_id, v_old_plan
  from public.subscriptions s
  left join public.subscription_plans sp on sp.id = s.plan_id
  where s.organization_id = v_org
  order by s.created_at desc
  limit 1;

  v_period_end := case
    when v_plan_code = 'free' then null
    else now () + (v_days::text || ' days')::interval
  end;

  if v_sub_id is not null then
    update public.subscriptions s
    set status = 'cancelled', updated_at = now ()
    where s.organization_id = v_org
      and s.id <> v_sub_id
      and s.status in ('trial', 'trialing', 'active', 'past_due');
  end if;

  if v_sub_id is null then
    insert into public.subscriptions (
      organization_id,
      shop_id,
      plan_id,
      status,
      billing_interval,
      trial_ends_at,
      current_period_start,
      current_period_end,
      payment_status,
      external_provider,
      activation_source,
      metadata
    )
    values (
      v_org,
      p_shop_id,
      v_plan,
      'active',
      'month',
      null,
      now (),
      v_period_end,
      case when v_plan_code = 'free' then 'waived' else 'paid' end,
      'manual_admin',
      'manual_admin',
      jsonb_build_object (
        'plan_set_by', auth.uid ()::text,
        'plan_set_at', timezone ('Africa/Kampala', now ())::text,
        'plan_days', case when v_plan_code = 'free' then null else v_days end
      )
    )
    returning id into v_sub_id;
  else
    update public.subscriptions s
    set
      shop_id = coalesce (s.shop_id, p_shop_id),
      plan_id = v_plan,
      status = 'active',
      -- Free is monthly by definition (see the header). A paid plan keeps the
      -- interval it already had — annual Business must stay annual.
      billing_interval = case when v_plan_code = 'free' then 'month' else s.billing_interval end,
      trial_ends_at = null,
      current_period_start = now (),
      current_period_end = v_period_end,
      payment_status = case when v_plan_code = 'free' then 'waived' else 'paid' end,
      external_provider = 'manual_admin',
      activation_source = 'manual_admin',
      updated_at = now (),
      metadata = coalesce (s.metadata, '{}'::jsonb)
        || jsonb_build_object (
          'plan_set_by', auth.uid ()::text,
          'plan_set_at', timezone ('Africa/Kampala', now ())::text,
          'plan_days', case when v_plan_code = 'free' then null else v_days end
        )
    where s.id = v_sub_id;
  end if;

  perform public._internal_subscription_history_write (
    v_sub_id,
    'admin_set_shop_plan',
    format ('%s -> %s', coalesce (v_old_plan, 'none'), v_plan_code),
    jsonb_build_object (
      'from_plan', v_old_plan,
      'to_plan', v_plan_code,
      'days', case when v_plan_code = 'free' then null else v_days end,
      'shop_id', p_shop_id
    )
  );

  insert into public.audit_logs (
    shop_id,
    actor_user_id,
    role,
    action,
    payload_summary,
    payload
  )
  values (
    p_shop_id,
    auth.uid (),
    'internal',
    'admin_shop_set_subscription_plan',
    'Admin set shop subscription plan',
    jsonb_build_object (
      'subscription_id', v_sub_id,
      'from_plan', v_old_plan,
      'to_plan', v_plan_code,
      'days', case when v_plan_code = 'free' then null else v_days end
    )
  );

  return jsonb_build_object (
    'ok', true,
    'subscription_id', v_sub_id,
    'plan_code', v_plan_code,
    'current_period_end', v_period_end
  );
end;
$$;

revoke all on function public.admin_shop_set_subscription_plan (uuid, text, integer) from public;
grant execute on function public.admin_shop_set_subscription_plan (uuid, text, integer) to authenticated;

notify pgrst, 'reload schema';

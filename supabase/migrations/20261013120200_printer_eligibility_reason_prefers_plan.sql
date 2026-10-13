-- ============================================================================
-- Printer eligibility `reason` — explain the PLAN before the billing interval
-- ============================================================================
-- WHY THIS FILE EXISTS AT ALL. It is a direct consequence of
-- `20261013120100_admin_reset_to_free_normalise_interval.sql`.
--
-- WHAT WENT WRONG. `internal_ops_printer_eligibility` builds its operator-facing
-- `reason` by testing the component facts in order, and it tested the BILLING
-- INTERVAL before the PLAN:
--
--     elsif lower (coalesce (v_interval, '')) <> 'year' then 'not_annual';
--     elsif lower (coalesce (v_plan, ''))     <> 'business' then 'not_business';
--
-- Before the reset-normalisation migration, a shop reset to Free kept
-- `billing_interval = 'year'` left over from its annual Business days. The
-- interval test therefore PASSED and the plan test fired, so the operator was
-- told `not_business` — "this shop is not on Business" — which is exactly the
-- right thing to say about a Free shop.
--
-- Normalising the interval to 'month' (correct: Free is monthly) makes the
-- interval test fire FIRST, so the very same shop now reports `not_annual` —
-- "the subscription is billed monthly", which is true but useless: Free has no
-- annual option to switch to, and the change the operator actually has to make
-- is the PLAN. The fix made the row honest and the message worse.
--
-- THE FIX IS THE ORDER, NOT THE NORMALISATION. Ask about the plan first. Both
-- facts are still reported verbatim in the response (`plan_code`,
-- `billing_interval`), so nothing is hidden either way; only which one is named
-- as the cause changes.
--
-- WHAT THIS DOES NOT CHANGE. The verdict is still delegated to
-- `_printer_promotion_eligible()` and is untouched — `eligible` and
-- `can_reserve` are byte-for-byte the same function's answer. Only the
-- explanatory `reason` string moves, and only in the case where the plan AND the
-- interval are both wrong (previously `not_annual`, now `not_business`).
-- `shop_not_active`, `no_subscription`, `subscription_not_active` and
-- `period_ended` keep their positions, so a monthly-Business shop still reports
-- `not_annual` and an annual-Starter shop still reports `not_business` — the two
-- cases the existing tests pin.

create or replace function public.internal_ops_printer_eligibility (
  p_shop_id uuid,
  p_promotion_code text default 'business_annual_printer_v1'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_shop_status text;
  v_shop_name text;
  v_sub_id uuid;
  v_plan text;
  v_status text;
  v_interval text;
  v_period_end timestamptz;
  v_eligible boolean := false;
  v_promo text := coalesce (nullif (trim (p_promotion_code), ''), 'business_annual_printer_v1');
  v_open_claim jsonb;
  v_reason text;
begin
  perform public._printer_require_fulfilment_admin ();

  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  select s.organization_id, s.branch_status, s.name
    into v_org, v_shop_status, v_shop_name
    from public.shops s where s.id = p_shop_id;

  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  -- The shared resolver, the same call the money paths make.
  v_sub_id := public._subscription_latest_for_org (v_org);

  if v_sub_id is not null then
    select sp.code, s.status, s.billing_interval, s.current_period_end
      into v_plan, v_status, v_interval, v_period_end
      from public.subscriptions s
      join public.subscription_plans sp on sp.id = s.plan_id
     where s.id = v_sub_id;

    v_eligible := public._printer_promotion_eligible (v_sub_id);
  end if;

  -- An existing open claim is reported separately from eligibility: an account
  -- can be perfectly eligible and still already have its one printer.
  select jsonb_build_object (
           'assignment_id', a.id,
           'status', a.status,
           'serial_number', u.serial_number,
           'reserved_until', a.reserved_until
         )
    into v_open_claim
    from public.waka_printer_assignments a
    join public.waka_printer_units u on u.id = a.unit_id
   where a.organization_id = v_org
     and a.promotion_code = v_promo
     and a.status in ('reserved', 'ready_for_collection', 'handed_over')
   order by a.created_at desc
   limit 1;

  -- EXPLANATION ONLY. Ordered the way an operator would reason, and deliberately
  -- silent when `eligible` is true.
  --
  -- PLAN BEFORE INTERVAL (20261013120200). A shop that is not on Business has to
  -- change plan whatever its interval is, and a Free plan has no annual option
  -- at all — so naming the interval first sends the operator after the wrong
  -- thing. Both facts are returned verbatim either way.
  if not v_eligible then
    if v_shop_status <> 'active' then
      v_reason := 'shop_not_active';
    elsif v_sub_id is null then
      v_reason := 'no_subscription';
    elsif v_status <> 'active' then
      v_reason := 'subscription_not_active';
    elsif lower (coalesce (v_plan, '')) <> 'business' then
      v_reason := 'not_business';
    elsif lower (coalesce (v_interval, '')) <> 'year' then
      v_reason := 'not_annual';
    elsif v_period_end is null or v_period_end <= now () then
      v_reason := 'period_ended';
    else
      -- The predicate refused and none of the components explains why. Say so
      -- rather than inventing a cause.
      v_reason := 'not_eligible';
    end if;
  end if;

  return jsonb_build_object (
    'ok', true,
    'shop_id', p_shop_id,
    'shop_name', v_shop_name,
    'shop_active', v_shop_status = 'active',
    'organization_id', v_org,
    'subscription_id', v_sub_id,
    'plan_code', v_plan,
    'subscription_status', v_status,
    'billing_interval', v_interval,
    'current_period_end', v_period_end,
    'promotion_code', v_promo,
    -- THE VERDICT. Authoritative.
    'eligible', v_eligible,
    -- Why, for the operator. Explanatory, never the decision.
    'reason', v_reason,
    'open_claim', v_open_claim,
    'can_reserve', v_eligible and v_open_claim is null,
    'reservation_days', 14,
    'checked_at', now ()
  );
end;
$$;

comment on function public.internal_ops_printer_eligibility (uuid, text) is
  'Read-only eligibility preview for a shop''s account. The verdict is delegated '
  'to _printer_promotion_eligible(); `reason` only explains it (plan is named '
  'before the billing interval). Reserves nothing.';

revoke all on function public.internal_ops_printer_eligibility (uuid, text) from public;
revoke all on function public.internal_ops_printer_eligibility (uuid, text) from anon;
grant execute on function public.internal_ops_printer_eligibility (uuid, text) to authenticated;

notify pgrst, 'reload schema';

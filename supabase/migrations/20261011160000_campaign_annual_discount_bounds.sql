-- ============================================================================
-- Campaign annual discounts: bounded, validated, and honestly reported
-- ============================================================================
-- APPROVED PLAN ITEM 9: "Validate campaign annual discount percentages
-- server-side and at the database level, rejecting invalid values instead of
-- silently converting them to zero."
-- APPROVED PLAN ITEM 10: fix the savings calculation.
--
-- WHAT WAS WRONG.
--   * `pricing_campaign_plan_discounts.annual_discount_percent` had NO check
--     constraint (`numeric(6,2)`, nullable). `_pricing_compute_plan_row` fed it
--     straight into the annual price with no clamp, so a campaign saved with
--     100% priced the whole year at UGX 0 and anything above 100 computed a
--     NEGATIVE annual price, which `subscription_payment_plan_amount` then
--     silently turned into 0 -- a free year. The admin form validated 0-90;
--     only the RPC (and direct SQL) could get past it.
--   * `monthly_discount_ugx` was computed BEFORE the UGX 5,000 floor was
--     applied, so "saves UGX X / month" overstated the saving whenever the
--     floor bound: 90% on an 18,000 plan claimed 16,200 saved when the price
--     actually only fell by 13,000. The admin preview mirrored the same maths,
--     so both were wrong together and neither could catch the other.
--
-- DATA COMPATIBILITY, BEFORE THE CONSTRAINT. A CHECK added over rows that
-- already violate it fails the migration, so this file NORMALISES first:
-- values above 90 are clamped to 90 (an operator who asked for more wanted a
-- deeper discount, and 90 is this mechanism's own maximum), and negative
-- values become NULL, which means "no annual override -- use the plan's
-- standard annual discount". NULL is the neutral choice: it restores the
-- shipped default rather than inventing a price nobody asked for.
--
-- The CHECK is added only after the data satisfies it. The RPC then enforces
-- the same bound with a discriminated error, and `_pricing_compute_plan_row`
-- clamps as a last line of defence for any row written before that.

-- ----------------------------------------------------------------------------
-- 1. Normalise what is already stored, then constrain it
-- ----------------------------------------------------------------------------
update public.pricing_campaign_plan_discounts
set annual_discount_percent = 90, updated_at = now ()
where annual_discount_percent > 90;

update public.pricing_campaign_plan_discounts
set annual_discount_percent = null, updated_at = now ()
where annual_discount_percent < 0;

alter table public.pricing_campaign_plan_discounts
  drop constraint if exists pricing_campaign_plan_discounts_annual_pct_range;

alter table public.pricing_campaign_plan_discounts
  add constraint pricing_campaign_plan_discounts_annual_pct_range
  check (annual_discount_percent is null
         or (annual_discount_percent >= 0 and annual_discount_percent <= 90));

comment on column public.pricing_campaign_plan_discounts.annual_discount_percent is
  'Campaign annual discount, 0-90. NULL means "use the plan''s default annual '
  'discount" (subscription_canonical_prices.default_annual_discount_percent). '
  'Enforced by CHECK, by admin_pricing_campaign_plan_discount_save, and by a '
  'clamp in _pricing_compute_plan_row.';

-- ----------------------------------------------------------------------------
-- 2. The pricing primitive: clamp the annual leg, report the real saving
-- ----------------------------------------------------------------------------
-- Byte-identical to `113_pricing_campaigns.sql` except `v_annual_pct`, which is
-- now bounded, and the one added line that recomputes the monthly saving after
-- the floor. The 90% monthly clamp, the UGX 5,000 floor and the fallback branch
-- are untouched.
create or replace function public._pricing_compute_plan_row (
  p_plan_code text,
  p_monthly_discount_type text,
  p_monthly_discount_value numeric,
  p_annual_discount_percent numeric
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_original_monthly bigint;
  v_default_annual_pct numeric;
  v_annual_pct numeric;
  v_monthly_discount bigint := 0;
  v_final_monthly bigint;
  v_original_annual_full bigint;
  v_final_annual bigint;
  v_min_monthly bigint := public._pricing_min_final_monthly_ugx ();
begin
  select monthly_price_ugx, default_annual_discount_percent
  into v_original_monthly, v_default_annual_pct
  from public.subscription_canonical_prices
  where plan_code = p_plan_code;

  if v_original_monthly is null then
    return null;
  end if;

  -- Bounded exactly like the monthly leg. The canonical default is already
  -- 0-90 by CHECK; an explicit campaign value is what needed the clamp.
  v_annual_pct := least (greatest (coalesce (p_annual_discount_percent, v_default_annual_pct), 0), 90);

  if p_monthly_discount_type = 'fixed_amount' then
    v_monthly_discount := least(
      greatest(0, round(p_monthly_discount_value)::bigint),
      greatest(0, v_original_monthly - v_min_monthly)
    );
    v_final_monthly := v_original_monthly - v_monthly_discount;
  elsif p_monthly_discount_type = 'percentage' then
    v_monthly_discount := round(
      v_original_monthly * least(greatest(p_monthly_discount_value, 0), 90) / 100.0
    )::bigint;
    v_final_monthly := greatest(v_min_monthly, v_original_monthly - v_monthly_discount);
  else
    v_final_monthly := v_original_monthly;
    v_monthly_discount := 0;
  end if;

  -- THE FIX: report what the plan actually saves. When the floor binds, the
  -- requested percentage overstates it (90% of 18,000 is 16,200, but the price
  -- only falls to 5,000 -- a 13,000 saving). Deriving it from the final price
  -- makes the figure honest for both discount types, and the admin preview
  -- mirrors this same line.
  v_monthly_discount := v_original_monthly - v_final_monthly;

  v_original_annual_full := v_original_monthly * 12;
  v_final_annual := round(v_final_monthly * 12 * (1 - v_annual_pct / 100.0))::bigint;

  return jsonb_build_object(
    'plan_code', p_plan_code,
    'original_monthly_ugx', v_original_monthly,
    'monthly_discount_ugx', v_monthly_discount,
    'final_monthly_ugx', v_final_monthly,
    'original_annual_full_ugx', v_original_annual_full,
    'final_annual_ugx', v_final_annual,
    'annual_discount_percent', v_annual_pct,
    'has_monthly_discount', v_monthly_discount > 0,
    'has_annual_discount', v_annual_pct > 0
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. The save RPC refuses an out-of-range annual percentage
-- ----------------------------------------------------------------------------
-- Byte-identical to `20261009140000` except the annual bound check, which sits
-- beside the monthly floor check and returns a discriminated error rather than
-- letting a zero or negative annual price reach the price book.
create or replace function public.admin_pricing_campaign_plan_discount_save (
  p_campaign_id uuid,
  p_plan_code text,
  p_monthly_discount_type text,
  p_monthly_discount_value numeric,
  p_annual_discount_percent numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev jsonb := '{}'::jsonb;
  v_new jsonb;
  v_actor_name text := '';
  v_computed jsonb;
  v_final_monthly bigint;
  v_min_monthly bigint := public._pricing_min_final_monthly_ugx ();
begin
  perform public._pricing_require_admin ();

  if p_plan_code not in ('starter', 'business', 'waka_plus') then
    return jsonb_build_object('ok', false, 'error', 'invalid_plan');
  end if;
  if p_monthly_discount_type not in ('none', 'fixed_amount', 'percentage') then
    return jsonb_build_object('ok', false, 'error', 'invalid_discount_type');
  end if;
  if trim(coalesce(p_reason, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;

  if not exists (select 1 from public.pricing_campaigns where id = p_campaign_id) then
    return jsonb_build_object('ok', false, 'error', 'campaign_not_found');
  end if;

  select jsonb_build_object(
    'monthly_discount_type', monthly_discount_type,
    'monthly_discount_value', monthly_discount_value,
    'annual_discount_percent', annual_discount_percent
  )
  into v_prev
  from public.pricing_campaign_plan_discounts
  where campaign_id = p_campaign_id and plan_code = p_plan_code;

  -- THE ANNUAL BOUND. The column had no CHECK and this RPC had no validation,
  -- so 100% priced the year at zero and >100 produced a negative price that the
  -- money path clamped to zero. Refused here with a code the form can explain.
  if p_annual_discount_percent is not null
     and (p_annual_discount_percent < 0 or p_annual_discount_percent > 90) then
    return jsonb_build_object('ok', false, 'error', 'annual_discount_out_of_range', 'max_percent', 90);
  end if;

  v_computed := public._pricing_compute_plan_row(
    p_plan_code, p_monthly_discount_type, p_monthly_discount_value, p_annual_discount_percent
  );
  v_final_monthly := (v_computed ->> 'final_monthly_ugx')::bigint;

  if v_final_monthly < v_min_monthly then
    return jsonb_build_object('ok', false, 'error', 'discount_below_minimum');
  end if;

  insert into public.pricing_campaign_plan_discounts (
    campaign_id, plan_code, monthly_discount_type, monthly_discount_value, annual_discount_percent
  )
  values (
    p_campaign_id, p_plan_code, p_monthly_discount_type,
    coalesce(p_monthly_discount_value, 0), p_annual_discount_percent
  )
  on conflict (campaign_id, plan_code) do update
  set
    monthly_discount_type = excluded.monthly_discount_type,
    monthly_discount_value = excluded.monthly_discount_value,
    annual_discount_percent = excluded.annual_discount_percent,
    updated_at = now();

  v_new := jsonb_build_object(
    'monthly_discount_type', p_monthly_discount_type,
    'monthly_discount_value', p_monthly_discount_value,
    'annual_discount_percent', p_annual_discount_percent,
    'computed', v_computed
  );

  -- Only change from 113: `p.id`, the real primary key, instead of `p.user_id`.
  select coalesce(p.full_name, p.email, '') into v_actor_name
  from public.profiles p where p.id = auth.uid();

  insert into public.pricing_campaign_audit_log (
    campaign_id, plan_code, actor_user_id, actor_name,
    previous_discount, new_discount, reason
  )
  values (
    p_campaign_id, p_plan_code, auth.uid(), coalesce(v_actor_name, ''),
    coalesce(v_prev, '{}'::jsonb), v_new, trim(p_reason)
  );

  perform public._pricing_audit(
    'pricing_campaign_plan_discount_saved',
    jsonb_build_object(
      'campaign_id', p_campaign_id,
      'plan_code', p_plan_code,
      'reason', p_reason,
      'previous', coalesce(v_prev, '{}'::jsonb),
      'new', v_new
    )
  );

  return jsonb_build_object('ok', true, 'computed', v_computed);
end;
$$;

revoke all on function public.admin_pricing_campaign_plan_discount_save (uuid, text, text, numeric, numeric, text) from public;
revoke all on function public.admin_pricing_campaign_plan_discount_save (uuid, text, text, numeric, numeric, text) from anon;
grant execute on function public.admin_pricing_campaign_plan_discount_save (uuid, text, text, numeric, numeric, text) to authenticated;

notify pgrst, 'reload schema';

-- Waka POS — fix `admin_pricing_campaign_plan_discount_save`: audit actor lookup.
--
-- THE BUG. The function resolved the acting admin's display name with
--     select coalesce(p.full_name, p.email, '') into v_actor_name
--       from public.profiles p where p.user_id = auth.uid();
-- but `public.profiles` has never had a `user_id` column. It is keyed on `id`
-- (`id uuid primary key references auth.users (id)`, 002_profiles.sql:4) and
-- every other call site joins it that way — the client uses
-- `.eq("id", user.id)` / `upsert({ id, ... })`.
--
-- Postgres resolves `p.user_id` when the statement is first executed, so every
-- call raised `column p.user_id does not exist` AFTER the discount row had been
-- written but BEFORE the audit insert… and because the whole function is one
-- transaction, the write rolled back with it. No plan discount could ever be
-- created or changed through the RPC — the Pricing Campaigns window's
-- "Save discount" action failed 100% of the time, and the HTTP layer reported
-- the raw 42703 rather than anything an operator could act on.
--
-- THE FIX. Join on the real primary key. Nothing else about the contract moves:
-- same signature, same return shape, same validation order, same audit rows,
-- same grants. The body below is 113_pricing_campaigns.sql:402-503 verbatim
-- except for the one predicate.
--
-- Covered by src/lib/pricingCampaignsAdmin.sql.integration.test.ts, which calls
-- this RPC with the internal-admin JWT claim against the real migration chain.

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
grant execute on function public.admin_pricing_campaign_plan_discount_save (uuid, text, text, numeric, numeric, text) to authenticated;

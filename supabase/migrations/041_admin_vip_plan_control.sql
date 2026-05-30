-- Waka POS — internal admin VIP / plan control
-- Lets authorized internal admins move a shop between Free, Starter, Business, and Waka Plus.

insert into public.subscription_plans (
  code,
  name,
  description,
  monthly_price_ugx,
  annual_price_ugx,
  annual_savings_note,
  annual_discount_percent,
  trial_days,
  max_shops,
  max_pos_users,
  features,
  is_active
)
values (
  'free',
  'Free Mode',
  'Basic free POS mode with product and device limits.',
  0,
  0,
  'Free Mode has no annual charge.',
  0,
  0,
  1,
  1,
  '{"tier":"free","devices":1,"staff":0,"users":1,"products":7}'::jsonb,
  true
)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  monthly_price_ugx = excluded.monthly_price_ugx,
  annual_price_ugx = excluded.annual_price_ugx,
  annual_savings_note = excluded.annual_savings_note,
  annual_discount_percent = excluded.annual_discount_percent,
  trial_days = excluded.trial_days,
  max_shops = excluded.max_shops,
  max_pos_users = excluded.max_pos_users,
  features = excluded.features,
  is_active = true;

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

  -- Keep the org-scoped partial unique index happy if an older active row exists.
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

create or replace function public.admin_subscription_set_plan (
  p_subscription_id uuid,
  p_plan_code text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid;
  v_result jsonb;
begin
  select s.shop_id into v_shop
  from public.subscriptions s
  where s.id = p_subscription_id
  limit 1;

  if v_shop is null then
    raise exception 'Subscription not found';
  end if;

  v_result := public.admin_shop_set_subscription_plan (v_shop, p_plan_code, 30);
  if coalesce ((v_result ->> 'ok')::boolean, false) is not true then
    raise exception '%', coalesce (v_result ->> 'error', 'plan_change_failed');
  end if;
end;
$$;

revoke all on function public.admin_subscription_set_plan (uuid, text) from public;
grant execute on function public.admin_subscription_set_plan (uuid, text) to authenticated;

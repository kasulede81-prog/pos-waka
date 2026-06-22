-- Waka POS — Subscription Pricing Campaigns
-- Canonical list prices are protected; campaigns apply temporary discounts without
-- mutating subscription_plans or historical subscription rows.

-- ---------------------------------------------------------------------------
-- Canonical prices (source of truth — never updated by campaigns)
-- ---------------------------------------------------------------------------

create table if not exists public.subscription_canonical_prices (
  plan_code text primary key
    check (plan_code in ('starter', 'business', 'waka_plus')),
  monthly_price_ugx bigint not null check (monthly_price_ugx > 0),
  default_annual_discount_percent numeric(6, 2) not null default 20
    check (default_annual_discount_percent >= 0 and default_annual_discount_percent <= 90),
  updated_at timestamptz not null default now ()
);

insert into public.subscription_canonical_prices (plan_code, monthly_price_ugx, default_annual_discount_percent)
values
  ('starter', 18000, 20),
  ('business', 36000, 20),
  ('waka_plus', 82000, 20)
on conflict (plan_code) do nothing;

alter table public.subscription_canonical_prices enable row level security;

drop policy if exists subscription_canonical_prices_read on public.subscription_canonical_prices;
create policy subscription_canonical_prices_read on public.subscription_canonical_prices
  for select using (true);

grant select on public.subscription_canonical_prices to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Campaign tables
-- ---------------------------------------------------------------------------

create table if not exists public.pricing_campaigns (
  id uuid primary key default gen_random_uuid (),
  name text not null,
  description text not null default '',
  enabled boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create table if not exists public.pricing_campaign_plan_discounts (
  id uuid primary key default gen_random_uuid (),
  campaign_id uuid not null references public.pricing_campaigns (id) on delete cascade,
  plan_code text not null check (plan_code in ('starter', 'business', 'waka_plus')),
  monthly_discount_type text not null default 'none'
    check (monthly_discount_type in ('none', 'fixed_amount', 'percentage')),
  monthly_discount_value numeric(12, 2) not null default 0
    check (monthly_discount_value >= 0),
  annual_discount_percent numeric(6, 2),
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  unique (campaign_id, plan_code)
);

create table if not exists public.pricing_campaign_audit_log (
  id uuid primary key default gen_random_uuid (),
  campaign_id uuid references public.pricing_campaigns (id) on delete set null,
  plan_code text check (plan_code in ('starter', 'business', 'waka_plus')),
  actor_user_id uuid references auth.users (id),
  actor_name text not null default '',
  previous_discount jsonb not null default '{}'::jsonb,
  new_discount jsonb not null default '{}'::jsonb,
  reason text not null default '',
  created_at timestamptz not null default now ()
);

create index if not exists pricing_campaigns_enabled_idx
  on public.pricing_campaigns (enabled, starts_at, ends_at);
create index if not exists pricing_campaign_audit_campaign_idx
  on public.pricing_campaign_audit_log (campaign_id, created_at desc);

alter table public.pricing_campaigns enable row level security;
alter table public.pricing_campaign_plan_discounts enable row level security;
alter table public.pricing_campaign_audit_log enable row level security;

drop policy if exists pricing_campaigns_staff_all on public.pricing_campaigns;
create policy pricing_campaigns_staff_all on public.pricing_campaigns
  for all using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

drop policy if exists pricing_campaign_plan_discounts_staff_all on public.pricing_campaign_plan_discounts;
create policy pricing_campaign_plan_discounts_staff_all on public.pricing_campaign_plan_discounts
  for all using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

drop policy if exists pricing_campaign_audit_staff_read on public.pricing_campaign_audit_log;
create policy pricing_campaign_audit_staff_read on public.pricing_campaign_audit_log
  for select using (public.is_waka_internal_staff ());

grant select on public.pricing_campaigns to authenticated;
grant select on public.pricing_campaign_plan_discounts to authenticated;
grant select on public.pricing_campaign_audit_log to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public._pricing_require_admin ()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_staff () then
    raise exception 'forbidden';
  end if;
end;
$$;

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
  insert into public.internal_ops_admin_audit (actor, action, payload)
  values (auth.uid (), p_action, coalesce (p_payload, '{}'::jsonb) || jsonb_build_object ('at', now ()));
end;
$$;

create or replace function public.pricing_campaign_is_active (c public.pricing_campaigns)
returns boolean
language sql
stable
as $$
  select c.enabled
    and (c.starts_at is null or now () >= c.starts_at)
    and (c.ends_at is null or now () < c.ends_at)
$$;

create or replace function public._pricing_min_final_monthly_ugx ()
returns bigint
language sql
immutable
as $$
  select 5000::bigint
$$;

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

  v_annual_pct := coalesce (p_annual_discount_percent, v_default_annual_pct);

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

create or replace function public._pricing_active_campaign_id ()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.pricing_campaigns c
  where public.pricing_campaign_is_active (c)
  order by c.updated_at desc
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Public pricing display (marketing + upgrade pages)
-- ---------------------------------------------------------------------------

create or replace function public.public_subscription_pricing ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_campaign_id uuid;
  v_campaign_name text := null;
  v_plans jsonb := '[]'::jsonb;
  v_plan text;
  v_row jsonb;
  v_discount record;
begin
  v_campaign_id := public._pricing_active_campaign_id ();

  if v_campaign_id is not null then
    select name into v_campaign_name from public.pricing_campaigns where id = v_campaign_id;
  end if;

  foreach v_plan in array array['starter', 'business', 'waka_plus']
  loop
    if v_campaign_id is null then
      v_row := public._pricing_compute_plan_row(v_plan, 'none', 0, null);
    else
      select * into v_discount
      from public.pricing_campaign_plan_discounts d
      where d.campaign_id = v_campaign_id and d.plan_code = v_plan;

      if found then
        v_row := public._pricing_compute_plan_row(
          v_plan,
          v_discount.monthly_discount_type,
          v_discount.monthly_discount_value,
          v_discount.annual_discount_percent
        );
      else
        v_row := public._pricing_compute_plan_row(v_plan, 'none', 0, null);
      end if;
    end if;

    if v_row is not null then
      v_plans := v_plans || jsonb_build_array(v_row);
    end if;
  end loop;

  return jsonb_build_object(
    'campaign_id', v_campaign_id,
    'campaign_name', v_campaign_name,
    'campaign_active', v_campaign_id is not null,
    'plans', v_plans,
    'as_of', now ()
  );
end;
$$;

revoke all on function public.public_subscription_pricing () from public;
grant execute on function public.public_subscription_pricing () to anon, authenticated;

-- Preview pricing for a draft campaign (admin only)
create or replace function public.admin_pricing_campaign_preview (p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plans jsonb := '[]'::jsonb;
  v_plan text;
  v_row jsonb;
  v_discount record;
begin
  perform public._pricing_require_admin ();

  foreach v_plan in array array['starter', 'business', 'waka_plus']
  loop
    select * into v_discount
    from public.pricing_campaign_plan_discounts d
    where d.campaign_id = p_campaign_id and d.plan_code = v_plan;

    if found then
      v_row := public._pricing_compute_plan_row(
        v_plan,
        v_discount.monthly_discount_type,
        v_discount.monthly_discount_value,
        v_discount.annual_discount_percent
      );
    else
      v_row := public._pricing_compute_plan_row(v_plan, 'none', 0, null);
    end if;

    if v_row is not null then
      v_plans := v_plans || jsonb_build_array(v_row);
    end if;
  end loop;

  return jsonb_build_object('plans', v_plans);
end;
$$;

revoke all on function public.admin_pricing_campaign_preview (uuid) from public;
grant execute on function public.admin_pricing_campaign_preview (uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: campaign CRUD
-- ---------------------------------------------------------------------------

create or replace function public.admin_pricing_campaign_save (
  p_id uuid,
  p_name text,
  p_description text,
  p_enabled boolean,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := p_id;
  v_created boolean := false;
begin
  perform public._pricing_require_admin ();

  if trim(coalesce(p_name, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'name_required');
  end if;

  if v_id is null then
    insert into public.pricing_campaigns (name, description, enabled, starts_at, ends_at, created_by)
    values (
      trim(p_name), coalesce(p_description, ''), coalesce(p_enabled, false),
      p_starts_at, p_ends_at, auth.uid()
    )
    returning id into v_id;
    v_created := true;
  else
    update public.pricing_campaigns
    set
      name = trim(coalesce(p_name, name)),
      description = coalesce(p_description, description),
      enabled = coalesce(p_enabled, enabled),
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      updated_at = now()
    where id = v_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'campaign_not_found');
    end if;
  end if;

  perform public._pricing_audit(
    case when v_created then 'pricing_campaign_created' else 'pricing_campaign_updated' end,
    jsonb_build_object('campaign_id', v_id, 'name', p_name, 'enabled', p_enabled)
  );

  return jsonb_build_object('ok', true, 'campaign_id', v_id, 'created', v_created);
end;
$$;

revoke all on function public.admin_pricing_campaign_save (uuid, text, text, boolean, timestamptz, timestamptz) from public;
grant execute on function public.admin_pricing_campaign_save (uuid, text, text, boolean, timestamptz, timestamptz) to authenticated;

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

  select coalesce(p.full_name, p.email, '') into v_actor_name
  from public.profiles p where p.user_id = auth.uid();

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

-- ---------------------------------------------------------------------------
-- Admin: metrics & audit feed
-- ---------------------------------------------------------------------------

create or replace function public.admin_pricing_campaign_metrics (
  p_campaign_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_id uuid := coalesce(p_campaign_id, public._pricing_active_campaign_id());
  v_campaign record;
  v_new_subs integer := 0;
  v_by_plan jsonb := '{}'::jsonb;
  v_revenue_impact bigint := 0;
  v_total_in_window integer := 0;
begin
  perform public._pricing_require_admin ();

  if v_campaign_id is not null then
    select * into v_campaign from public.pricing_campaigns where id = v_campaign_id;
  end if;

  with window_subs as (
    select
      sp.code as plan_code,
      s.organization_id,
      s.created_at,
      coalesce(spay.amount_ugx, 0) as paid_ugx
    from public.subscriptions s
    join public.subscription_plans sp on sp.id = s.plan_id
    left join lateral (
      select amount_ugx
      from public.subscription_payments spay
      where spay.subscription_id = s.id
      order by spay.created_at desc
      limit 1
    ) spay on true
    where sp.code in ('starter', 'business', 'waka_plus')
      and s.status in ('active', 'trialing')
      and (p_from is null or s.created_at >= p_from)
      and (p_to is null or s.created_at <= p_to)
      and (
        v_campaign_id is null
        or (
          (v_campaign.starts_at is null or s.created_at >= v_campaign.starts_at)
          and (v_campaign.ends_at is null or s.created_at < v_campaign.ends_at)
        )
      )
  )
  select
    coalesce(sum(cnt), 0)::integer,
    coalesce(jsonb_object_agg(plan_code, cnt), '{}'::jsonb),
    coalesce(sum(paid_ugx), 0)::bigint
  into v_new_subs, v_by_plan, v_revenue_impact
  from (
    select plan_code, count(*)::integer as cnt, sum(paid_ugx) as paid_ugx
    from window_subs
    group by plan_code
  ) agg;

  select count(*)::integer into v_total_in_window
  from public.subscriptions s
  where (p_from is null or s.created_at >= p_from)
    and (p_to is null or s.created_at <= p_to);

  return jsonb_build_object(
    'campaign_id', v_campaign_id,
    'campaign_name', v_campaign.name,
    'campaign_active', v_campaign.id is not null and public.pricing_campaign_is_active(v_campaign),
    'new_subscribers', v_new_subs,
    'new_subscribers_by_plan', v_by_plan,
    'revenue_recorded_ugx', v_revenue_impact,
    'conversion_rate_percent',
      case when v_total_in_window > 0
        then round((v_new_subs::numeric / v_total_in_window) * 100, 2)
        else 0
      end,
    'total_subscriptions_in_window', v_total_in_window
  );
end;
$$;

revoke all on function public.admin_pricing_campaign_metrics (uuid, timestamptz, timestamptz) from public;
grant execute on function public.admin_pricing_campaign_metrics (uuid, timestamptz, timestamptz) to authenticated;

create or replace function public.admin_pricing_campaign_audit_feed (p_limit integer default 50)
returns setof public.pricing_campaign_audit_log
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._pricing_require_admin ();
  return query
  select *
  from public.pricing_campaign_audit_log
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function public.admin_pricing_campaign_audit_feed (integer) from public;
grant execute on function public.admin_pricing_campaign_audit_feed (integer) to authenticated;

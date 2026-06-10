-- Waka POS — Growth Campaign & Monetization Control System
-- Temporary promotional plan grants for growth campaigns (automatic / referral / manual).
-- Extends monetization: the real `subscriptions` row is never modified by grants;
-- expiry automatically falls back to paid subscription → trial → free.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.growth_campaigns (
  id uuid primary key default gen_random_uuid (),
  name text not null,
  description text not null default '',
  enabled boolean not null default false,
  grant_mode text not null default 'manual'
    check (grant_mode in ('automatic', 'referral_based', 'manual')),
  granted_plan_code text not null default 'business'
    check (granted_plan_code in ('starter', 'business', 'waka_plus')),
  duration_days integer not null default 30 check (duration_days >= 1),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create table if not exists public.growth_referral_codes (
  id uuid primary key default gen_random_uuid (),
  campaign_id uuid references public.growth_campaigns (id) on delete set null,
  code text not null,
  description text not null default '',
  plan_code text not null default 'business'
    check (plan_code in ('starter', 'business', 'waka_plus')),
  duration_days integer not null default 30 check (duration_days >= 1),
  enabled boolean not null default true,
  usage_count integer not null default 0,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create unique index if not exists growth_referral_codes_code_key
  on public.growth_referral_codes (upper (code));

create table if not exists public.promotional_grants (
  id uuid primary key default gen_random_uuid (),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  campaign_id uuid references public.growth_campaigns (id) on delete set null,
  referral_code_id uuid references public.growth_referral_codes (id) on delete set null,
  plan_code text not null check (plan_code in ('starter', 'business', 'waka_plus')),
  granted_by text not null
    check (granted_by in ('growth_campaign', 'referral_code', 'manual_admin')),
  granted_by_admin_id uuid references auth.users (id),
  reason text,
  granted_at timestamptz not null default now (),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by_admin_id uuid references auth.users (id),
  created_at timestamptz not null default now ()
);

create index if not exists promotional_grants_org_idx
  on public.promotional_grants (organization_id, expires_at desc);
create index if not exists promotional_grants_campaign_idx
  on public.promotional_grants (campaign_id, granted_at desc);

-- One campaign-sourced grant per org per campaign (idempotent registration hook).
create unique index if not exists promotional_grants_org_campaign_key
  on public.promotional_grants (organization_id, campaign_id)
  where campaign_id is not null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.growth_campaigns enable row level security;
alter table public.growth_referral_codes enable row level security;
alter table public.promotional_grants enable row level security;

drop policy if exists growth_campaigns_staff_all on public.growth_campaigns;
create policy growth_campaigns_staff_all on public.growth_campaigns
  for all using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

drop policy if exists growth_referral_codes_staff_all on public.growth_referral_codes;
create policy growth_referral_codes_staff_all on public.growth_referral_codes
  for all using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

drop policy if exists promotional_grants_staff_all on public.promotional_grants;
create policy promotional_grants_staff_all on public.promotional_grants
  for all using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

-- Shop members may read their own org's grants (subscription snapshot fetch).
drop policy if exists promotional_grants_member_read on public.promotional_grants;
create policy promotional_grants_member_read on public.promotional_grants
  for select using (
    exists (
      select 1
      from public.shop_members sm
      join public.shops s on s.id = sm.shop_id
      where sm.user_id = auth.uid ()
        and s.organization_id = promotional_grants.organization_id
    )
  );

grant select on public.promotional_grants to authenticated;
grant select on public.growth_campaigns to authenticated;
grant select on public.growth_referral_codes to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public._growth_require_admin ()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;
  select ia.role into v_role
  from public.internal_admins ia
  where ia.user_id = auth.uid () and ia.active = true
  limit 1;
  if v_role is null or v_role not in (
    'super_admin', 'subscriptions_admin', 'finance_admin', 'operations_admin'
  ) then
    raise exception 'Forbidden';
  end if;
end;
$$;

revoke all on function public._growth_require_admin () from public;

create or replace function public._growth_audit (
  p_action text,
  p_shop_id uuid,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.internal_ops_admin_audit (actor, action, target_shop_id, payload)
  values (
    auth.uid (),
    p_action,
    p_shop_id,
    coalesce (p_payload, '{}'::jsonb) || jsonb_build_object ('at', now ())
  );
end;
$$;

revoke all on function public._growth_audit (text, uuid, jsonb) from public;

-- Campaign Active (computed): enabled AND inside [starts_at, ends_at).
create or replace function public.growth_campaign_is_active (c public.growth_campaigns)
returns boolean
language sql
stable
as $$
  select c.enabled
    and (c.starts_at is null or now () >= c.starts_at)
    and (c.ends_at is null or now () < c.ends_at)
$$;

-- ---------------------------------------------------------------------------
-- Admin: campaign + referral code management
-- ---------------------------------------------------------------------------

create or replace function public.admin_growth_campaign_save (
  p_id uuid,
  p_name text,
  p_description text,
  p_enabled boolean,
  p_grant_mode text,
  p_granted_plan_code text,
  p_duration_days integer,
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
  perform public._growth_require_admin ();

  if p_grant_mode not in ('automatic', 'referral_based', 'manual') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_grant_mode');
  end if;
  if p_granted_plan_code not in ('starter', 'business', 'waka_plus') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_plan');
  end if;
  if coalesce (p_duration_days, 0) < 1 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_duration');
  end if;

  if v_id is null then
    insert into public.growth_campaigns (
      name, description, enabled, grant_mode, granted_plan_code,
      duration_days, starts_at, ends_at, created_by
    )
    values (
      trim (coalesce (p_name, '')), coalesce (p_description, ''), coalesce (p_enabled, false),
      p_grant_mode, p_granted_plan_code, p_duration_days, p_starts_at, p_ends_at, auth.uid ()
    )
    returning id into v_id;
    v_created := true;
  else
    update public.growth_campaigns
    set
      name = trim (coalesce (p_name, name)),
      description = coalesce (p_description, description),
      enabled = coalesce (p_enabled, enabled),
      grant_mode = p_grant_mode,
      granted_plan_code = p_granted_plan_code,
      duration_days = p_duration_days,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      updated_at = now ()
    where id = v_id;
    if not found then
      return jsonb_build_object ('ok', false, 'error', 'campaign_not_found');
    end if;
  end if;

  perform public._growth_audit (
    case when v_created then 'growth_campaign_created' else 'growth_campaign_updated' end,
    null,
    jsonb_build_object (
      'campaign_id', v_id,
      'name', p_name,
      'enabled', p_enabled,
      'grant_mode', p_grant_mode,
      'plan', p_granted_plan_code,
      'duration_days', p_duration_days
    )
  );

  return jsonb_build_object ('ok', true, 'campaign_id', v_id, 'created', v_created);
end;
$$;

revoke all on function public.admin_growth_campaign_save (uuid, text, text, boolean, text, text, integer, timestamptz, timestamptz) from public;
grant execute on function public.admin_growth_campaign_save (uuid, text, text, boolean, text, text, integer, timestamptz, timestamptz) to authenticated;

create or replace function public.admin_growth_referral_code_save (
  p_id uuid,
  p_campaign_id uuid,
  p_code text,
  p_description text,
  p_plan_code text,
  p_duration_days integer,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := p_id;
  v_code text := upper (trim (coalesce (p_code, '')));
  v_created boolean := false;
begin
  perform public._growth_require_admin ();

  if v_code = '' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_code');
  end if;
  if p_plan_code not in ('starter', 'business', 'waka_plus') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_plan');
  end if;
  if coalesce (p_duration_days, 0) < 1 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_duration');
  end if;

  if v_id is null then
    insert into public.growth_referral_codes (
      campaign_id, code, description, plan_code, duration_days, enabled
    )
    values (
      p_campaign_id, v_code, coalesce (p_description, ''), p_plan_code,
      p_duration_days, coalesce (p_enabled, true)
    )
    on conflict (upper (code)) do update
    set
      campaign_id = excluded.campaign_id,
      description = excluded.description,
      plan_code = excluded.plan_code,
      duration_days = excluded.duration_days,
      enabled = excluded.enabled,
      updated_at = now ()
    returning id into v_id;
    v_created := true;
  else
    update public.growth_referral_codes
    set
      campaign_id = p_campaign_id,
      code = v_code,
      description = coalesce (p_description, description),
      plan_code = p_plan_code,
      duration_days = p_duration_days,
      enabled = coalesce (p_enabled, enabled),
      updated_at = now ()
    where id = v_id;
    if not found then
      return jsonb_build_object ('ok', false, 'error', 'code_not_found');
    end if;
  end if;

  if v_created then
    perform public._growth_audit (
      'referral_code_created',
      null,
      jsonb_build_object (
        'referral_code_id', v_id,
        'code', v_code,
        'campaign_id', p_campaign_id,
        'plan', p_plan_code,
        'duration_days', p_duration_days
      )
    );
  end if;

  return jsonb_build_object ('ok', true, 'referral_code_id', v_id, 'created', v_created);
end;
$$;

revoke all on function public.admin_growth_referral_code_save (uuid, uuid, text, text, text, integer, boolean) from public;
grant execute on function public.admin_growth_referral_code_save (uuid, uuid, text, text, text, integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: manual grant / extend / revoke
-- ---------------------------------------------------------------------------

create or replace function public.admin_grant_promotional_access (
  p_shop_id uuid,
  p_plan_code text,
  p_days integer,
  p_reason text default null,
  p_campaign_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_grant_id uuid;
  v_days integer := greatest (1, coalesce (p_days, 30));
begin
  perform public._growth_require_admin ();

  if p_plan_code not in ('starter', 'business', 'waka_plus') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_plan');
  end if;

  select s.organization_id into v_org
  from public.shops s
  where s.id = p_shop_id
  limit 1;
  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  insert into public.promotional_grants (
    organization_id, shop_id, campaign_id, plan_code, granted_by,
    granted_by_admin_id, reason, granted_at, expires_at
  )
  values (
    v_org, p_shop_id, p_campaign_id, p_plan_code, 'manual_admin',
    auth.uid (), nullif (trim (coalesce (p_reason, '')), ''),
    now (), now () + (v_days::text || ' days')::interval
  )
  returning id into v_grant_id;

  perform public._growth_audit (
    'promotional_access_granted',
    p_shop_id,
    jsonb_build_object (
      'grant_id', v_grant_id,
      'campaign_id', p_campaign_id,
      'plan', p_plan_code,
      'duration_days', v_days,
      'reason', p_reason
    )
  );

  return jsonb_build_object ('ok', true, 'grant_id', v_grant_id);
end;
$$;

revoke all on function public.admin_grant_promotional_access (uuid, text, integer, text, uuid) from public;
grant execute on function public.admin_grant_promotional_access (uuid, text, integer, text, uuid) to authenticated;

create or replace function public.admin_extend_promotional_access (
  p_grant_id uuid,
  p_extra_days integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant public.promotional_grants%rowtype;
  v_days integer := greatest (1, coalesce (p_extra_days, 30));
  v_new_expiry timestamptz;
begin
  perform public._growth_require_admin ();

  select * into v_grant from public.promotional_grants where id = p_grant_id limit 1;
  if v_grant.id is null then
    return jsonb_build_object ('ok', false, 'error', 'grant_not_found');
  end if;
  if v_grant.revoked_at is not null then
    return jsonb_build_object ('ok', false, 'error', 'grant_revoked');
  end if;

  -- Extension never shortens: extend from the later of now / current expiry.
  v_new_expiry := greatest (v_grant.expires_at, now ()) + (v_days::text || ' days')::interval;

  update public.promotional_grants
  set expires_at = v_new_expiry
  where id = p_grant_id;

  perform public._growth_audit (
    'promotional_access_extended',
    v_grant.shop_id,
    jsonb_build_object (
      'grant_id', p_grant_id,
      'campaign_id', v_grant.campaign_id,
      'plan', v_grant.plan_code,
      'duration_days', v_days,
      'new_expires_at', v_new_expiry,
      'reason', p_reason
    )
  );

  return jsonb_build_object ('ok', true, 'expires_at', v_new_expiry);
end;
$$;

revoke all on function public.admin_extend_promotional_access (uuid, integer, text) from public;
grant execute on function public.admin_extend_promotional_access (uuid, integer, text) to authenticated;

create or replace function public.admin_revoke_promotional_access (
  p_grant_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant public.promotional_grants%rowtype;
begin
  perform public._growth_require_admin ();

  select * into v_grant from public.promotional_grants where id = p_grant_id limit 1;
  if v_grant.id is null then
    return jsonb_build_object ('ok', false, 'error', 'grant_not_found');
  end if;
  if v_grant.revoked_at is not null then
    return jsonb_build_object ('ok', true, 'already_revoked', true);
  end if;

  update public.promotional_grants
  set revoked_at = now (), revoked_by_admin_id = auth.uid ()
  where id = p_grant_id;

  perform public._growth_audit (
    'promotional_access_revoked',
    v_grant.shop_id,
    jsonb_build_object (
      'grant_id', p_grant_id,
      'campaign_id', v_grant.campaign_id,
      'plan', v_grant.plan_code,
      'reason', p_reason
    )
  );

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.admin_revoke_promotional_access (uuid, text) from public;
grant execute on function public.admin_revoke_promotional_access (uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Registration hook: automatic + referral-based grants
-- Called by the client right after workspace bootstrap. Idempotent per
-- (organization, campaign). Security definer so new owners need no direct
-- access to campaign tables.
-- ---------------------------------------------------------------------------

create or replace function public.apply_growth_campaign_grant (
  p_referral_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_shop_id uuid;
  v_org_id uuid;
  v_campaign public.growth_campaigns%rowtype;
  v_code public.growth_referral_codes%rowtype;
  v_used_code text;
  v_grant_id uuid;
  v_plan text;
  v_days integer;
  v_source text;
  v_code_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select sm.shop_id, s.organization_id
  into v_shop_id, v_org_id
  from public.shop_members sm
  join public.shops s on s.id = sm.shop_id
  where sm.user_id = v_uid and sm.role = 'owner'
  order by sm.created_at asc
  limit 1;
  if v_org_id is null then
    return jsonb_build_object ('ok', false, 'error', 'no_workspace');
  end if;

  select * into v_campaign
  from public.growth_campaigns c
  where c.enabled = true
    and (c.starts_at is null or now () >= c.starts_at)
    and (c.ends_at is null or now () < c.ends_at)
  order by c.updated_at desc
  limit 1;
  if v_campaign.id is null then
    return jsonb_build_object ('ok', true, 'granted', false, 'reason', 'no_active_campaign');
  end if;

  if v_campaign.grant_mode = 'automatic' then
    v_plan := v_campaign.granted_plan_code;
    v_days := v_campaign.duration_days;
    v_source := 'growth_campaign';
    v_code_id := null;
  elsif v_campaign.grant_mode = 'referral_based' then
    v_used_code := upper (trim (coalesce (
      p_referral_code,
      (select u.raw_user_meta_data ->> 'referral_code' from auth.users u where u.id = v_uid),
      ''
    )));
    if v_used_code = '' then
      return jsonb_build_object ('ok', true, 'granted', false, 'reason', 'no_referral_code');
    end if;
    select * into v_code
    from public.growth_referral_codes rc
    where upper (rc.code) = v_used_code and rc.enabled = true
    limit 1;
    if v_code.id is null then
      return jsonb_build_object ('ok', true, 'granted', false, 'reason', 'unknown_referral_code');
    end if;
    v_plan := v_code.plan_code;
    v_days := v_code.duration_days;
    v_source := 'referral_code';
    v_code_id := v_code.id;
  else
    return jsonb_build_object ('ok', true, 'granted', false, 'reason', 'manual_mode');
  end if;

  -- Idempotent: one grant per org per campaign.
  insert into public.promotional_grants (
    organization_id, shop_id, campaign_id, referral_code_id, plan_code,
    granted_by, reason, granted_at, expires_at
  )
  values (
    v_org_id, v_shop_id, v_campaign.id, v_code_id, v_plan,
    v_source, v_campaign.name, now (), now () + (v_days::text || ' days')::interval
  )
  on conflict (organization_id, campaign_id) where campaign_id is not null and revoked_at is null
  do nothing
  returning id into v_grant_id;

  if v_grant_id is null then
    return jsonb_build_object ('ok', true, 'granted', false, 'reason', 'already_granted');
  end if;

  if v_code_id is not null then
    update public.growth_referral_codes
    set usage_count = usage_count + 1, updated_at = now ()
    where id = v_code_id;
    perform public._growth_audit (
      'referral_code_used',
      v_shop_id,
      jsonb_build_object (
        'referral_code_id', v_code_id,
        'code', v_used_code,
        'campaign_id', v_campaign.id,
        'grant_id', v_grant_id,
        'plan', v_plan,
        'duration_days', v_days
      )
    );
  end if;

  perform public._growth_audit (
    'promotional_access_granted',
    v_shop_id,
    jsonb_build_object (
      'grant_id', v_grant_id,
      'campaign_id', v_campaign.id,
      'source', v_source,
      'plan', v_plan,
      'duration_days', v_days
    )
  );

  return jsonb_build_object (
    'ok', true,
    'granted', true,
    'grant_id', v_grant_id,
    'plan_code', v_plan,
    'duration_days', v_days
  );
end;
$$;

revoke all on function public.apply_growth_campaign_grant (text) from public;
grant execute on function public.apply_growth_campaign_grant (text) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: campaign conversion metrics
-- ---------------------------------------------------------------------------

create or replace function public.admin_growth_campaign_metrics (
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
  v_campaign_shops integer;
  v_active integer;
  v_expired integer;
  v_converted integer;
  v_mrr bigint;
begin
  perform public._growth_require_admin ();

  with filtered as (
    select pg.organization_id,
      bool_or (pg.revoked_at is null and pg.expires_at > now ()) as has_active
    from public.promotional_grants pg
    where (p_campaign_id is null or pg.campaign_id = p_campaign_id)
      and (p_from is null or pg.granted_at >= p_from)
      and (p_to is null or pg.granted_at <= p_to)
    group by pg.organization_id
  ),
  paid as (
    select distinct on (s.organization_id)
      s.organization_id, sp.monthly_price_ugx
    from public.subscriptions s
    join public.subscription_plans sp on sp.id = s.plan_id
    where s.status = 'active'
      and sp.code <> 'free'
      and (s.current_period_end is null or s.current_period_end > now ())
      and coalesce (s.payment_status, '') = 'paid'
      and coalesce (s.activation_source, '') not in ('manual_admin', 'free_onboarding')
    order by s.organization_id, s.created_at desc
  )
  select
    count (*),
    count (*) filter (where f.has_active),
    count (*) filter (where not f.has_active),
    count (p.organization_id),
    coalesce (sum (p.monthly_price_ugx), 0)
  into v_campaign_shops, v_active, v_expired, v_converted, v_mrr
  from filtered f
  left join paid p on p.organization_id = f.organization_id;

  return jsonb_build_object (
    'campaign_shops', coalesce (v_campaign_shops, 0),
    'active_promotional_shops', coalesce (v_active, 0),
    'expired_promotional_shops', coalesce (v_expired, 0),
    'converted_to_paid', coalesce (v_converted, 0),
    'conversion_rate_pct', case
      when coalesce (v_campaign_shops, 0) = 0 then 0
      else round ((v_converted::numeric / v_campaign_shops::numeric) * 100, 1)
    end,
    'mrr_from_converted_ugx', coalesce (v_mrr, 0)
  );
end;
$$;

revoke all on function public.admin_growth_campaign_metrics (uuid, timestamptz, timestamptz) from public;
grant execute on function public.admin_growth_campaign_metrics (uuid, timestamptz, timestamptz) to authenticated;

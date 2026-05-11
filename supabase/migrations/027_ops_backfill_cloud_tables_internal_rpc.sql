-- Waka POS — Backfill missing shops / memberships, cloud ops tables, internal RPC for recent signups.

-- ---------- 1) Shops for organizations that never got a shop row ----------
insert into public.shops (organization_id, name, business_type, is_active, district, city, phone_e164)
select
  o.id,
  coalesce(nullif(trim(o.name), ''), 'Main Shop'),
  o.business_type,
  true,
  null,
  null,
  null
from public.organizations o
where not exists (
  select 1
  from public.shops sh
  where sh.organization_id = o.id
);

-- ---------- 2) shop_members: org owners on primary shop (first shop per org) ----------
insert into public.shop_members (shop_id, user_id, role)
select s.shop_id, om.user_id, 'owner'
from public.organization_members om
join lateral (
  select sh.id as shop_id
  from public.shops sh
  where sh.organization_id = om.organization_id
  order by sh.created_at asc
  limit 1
) s on true
where om.role = 'owner'
on conflict (shop_id, user_id) do update
set role = 'owner';

-- ---------- 3) Subscriptions trial for orgs with a shop but no subscription ----------
insert into public.subscriptions (
  organization_id,
  shop_id,
  plan_id,
  status,
  billing_interval,
  trial_ends_at,
  current_period_start,
  current_period_end,
  external_provider
)
select
  o.id,
  s.id,
  sp.id,
  'trial',
  'month',
  (timezone ('Africa/Kampala', now ()) + interval '30 days')::timestamptz,
  now (),
  (timezone ('Africa/Kampala', now ()) + interval '30 days')::timestamptz,
  'shop_backfill'
from public.organizations o
join lateral (
  select sh.id
  from public.shops sh
  where sh.organization_id = o.id
  order by sh.created_at asc
  limit 1
) s on true
cross join lateral (
  select sp2.id
  from public.subscription_plans sp2
  where sp2.code = 'business'
    and sp2.is_active
  limit 1
) sp
where not exists (
  select 1
  from public.subscriptions sub
  where sub.organization_id = o.id
);

-- ---------- 4) Support queue extras ----------
alter table public.support_requests
  add column if not exists contact_phone_e164 text;

alter table public.support_requests
  add column if not exists internal_notes text;

comment on column public.support_requests.contact_phone_e164 is 'Customer or shop contact for WhatsApp / callbacks.';
comment on column public.support_requests.internal_notes is 'Waka staff-only notes (never shown to shop owners in-app).';

-- ---------- 5) Cloud device registry (shop-scoped) ----------
create table if not exists public.shop_devices (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  device_fingerprint text not null,
  label text,
  platform text,
  last_seen_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  unique (shop_id, device_fingerprint)
);

create index if not exists shop_devices_shop_idx on public.shop_devices (shop_id);
create index if not exists shop_devices_shop_active_idx on public.shop_devices (shop_id, is_active);

drop trigger if exists trg_shop_devices_updated on public.shop_devices;
create trigger trg_shop_devices_updated
  before update on public.shop_devices
  for each row execute function public.set_updated_at ();

-- Light backfill: one legacy row per shop that reported devices (avoids empty device totals)
insert into public.shop_devices (shop_id, device_fingerprint, label, last_seen_at, is_active)
select
  s.id,
  'legacy-backfill-' || s.id::text,
  'Imported device',
  coalesce (s.last_seen_at, now ()),
  true
from public.shops s
where s.active_device_count > 0
on conflict (shop_id, device_fingerprint) do nothing;

-- ---------- 6) Subscription audit trail ----------
create table if not exists public.subscription_history (
  id uuid primary key default gen_random_uuid (),
  subscription_id uuid references public.subscriptions (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now ()
);

create index if not exists subscription_history_org_created_idx on public.subscription_history (organization_id, created_at desc);
create index if not exists subscription_history_sub_idx on public.subscription_history (subscription_id, created_at desc);

-- ---------- 7) Sync health (per shop; updated by clients / jobs later) ----------
create table if not exists public.sync_health (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  last_pull_at timestamptz,
  last_push_ok_at timestamptz,
  pending_outbound int not null default 0 check (pending_outbound >= 0),
  last_error text,
  updated_at timestamptz not null default now ()
);

-- ---------- 8) Shop activity rollup (optional aggregates) ----------
create table if not exists public.shop_activity (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  last_sale_at timestamptz,
  sale_count_30d int not null default 0 check (sale_count_30d >= 0),
  updated_at timestamptz not null default now ()
);

insert into public.sync_health (shop_id)
select s.id
from public.shops s
on conflict (shop_id) do nothing;

insert into public.shop_activity (shop_id, last_sale_at, sale_count_30d, updated_at)
select
  s.shop_id,
  max (s.completed_at) filter (
    where
      s.status = 'completed'
  ),
  count (*) filter (
    where
      s.status = 'completed'
      and s.completed_at is not null
      and s.completed_at >= (now () - interval '30 days')
  )::int,
  now ()
from public.sales s
where s.completed_at is not null
group by s.shop_id
on conflict (shop_id) do update
set
  last_sale_at = excluded.last_sale_at,
  sale_count_30d = excluded.sale_count_30d,
  updated_at = excluded.updated_at;

-- ---------- 9) RLS for new tables ----------
alter table public.shop_devices enable row level security;
alter table public.subscription_history enable row level security;
alter table public.sync_health enable row level security;
alter table public.shop_activity enable row level security;

drop policy if exists shop_devices_select on public.shop_devices;
create policy shop_devices_select
  on public.shop_devices for select
  using (
    public.is_waka_internal_staff ()
    or exists (
      select 1
      from public.shop_members sm
      where sm.shop_id = shop_devices.shop_id
        and sm.user_id = auth.uid ()
    )
  );

drop policy if exists shop_devices_internal_write on public.shop_devices;
create policy shop_devices_internal_write
  on public.shop_devices for all
  using (public.is_waka_internal_role (array['super_admin', 'support_admin']::text[]))
  with check (public.is_waka_internal_role (array['super_admin', 'support_admin']::text[]));

drop policy if exists shop_devices_manager_insert on public.shop_devices;
create policy shop_devices_manager_insert
  on public.shop_devices for insert
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists shop_devices_manager_update on public.shop_devices;
create policy shop_devices_manager_update
  on public.shop_devices for update
  using (public.user_can_manage_shop (shop_id))
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists subscription_history_internal_select on public.subscription_history;
create policy subscription_history_internal_select
  on public.subscription_history for select
  using (public.is_waka_internal_staff ());

drop policy if exists sync_health_select on public.sync_health;
create policy sync_health_select
  on public.sync_health for select
  using (
    public.is_waka_internal_staff ()
    or exists (
      select 1
      from public.shop_members sm
      where sm.shop_id = sync_health.shop_id
        and sm.user_id = auth.uid ()
    )
  );

drop policy if exists shop_activity_select on public.shop_activity;
create policy shop_activity_select
  on public.shop_activity for select
  using (
    public.is_waka_internal_staff ()
    or exists (
      select 1
      from public.shop_members sm
      where sm.shop_id = shop_activity.shop_id
        and sm.user_id = auth.uid ()
    )
  );

drop policy if exists sync_health_manager_write on public.sync_health;
create policy sync_health_manager_write
  on public.sync_health for insert
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists sync_health_manager_update on public.sync_health;
create policy sync_health_manager_update
  on public.sync_health for update
  using (public.user_can_manage_shop (shop_id))
  with check (public.user_can_manage_shop (shop_id));

-- ---------- 10) Internal staff can read profiles (ops console; read-only) ----------
drop policy if exists profiles_internal_staff_select on public.profiles;
create policy profiles_internal_staff_select
  on public.profiles for select
  to authenticated
  using (public.is_waka_internal_staff ());

-- ---------- 11) Recent shops with owner (SECURITY DEFINER; RLS-safe for console) ----------
create or replace function public.internal_ops_recent_shops (p_limit int default 20)
returns table (
  id uuid,
  name text,
  district text,
  city text,
  is_active boolean,
  created_at timestamptz,
  organization_id uuid,
  plan_code text,
  trial_ends_at timestamptz,
  subscription_status text,
  owner_label text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  return query
  select
    s.id,
    s.name,
    s.district,
    s.city,
    s.is_active,
    s.created_at,
    s.organization_id,
    sp.code as plan_code,
    sub.trial_ends_at,
    sub.status as subscription_status,
    coalesce(
      nullif (trim (pr.full_name), ''),
      nullif (trim (pr.email), ''),
      nullif (trim (pr.business_name), ''),
      own.user_id::text
    ) as owner_label
  from public.shops s
  left join lateral (
    select sm.user_id
    from public.shop_members sm
    where sm.shop_id = s.id
      and sm.role = 'owner'
    order by sm.created_at asc
    limit 1
  ) own on true
  left join public.profiles pr on pr.id = own.user_id
  left join lateral (
    select s2.*
    from public.subscriptions s2
    where s2.organization_id = s.organization_id
    order by s2.created_at desc
    limit 1
  ) sub on true
  left join public.subscription_plans sp on sp.id = sub.plan_id
  order by s.created_at desc
  limit least (greatest (coalesce (p_limit, 20), 1), 100);
end;
$$;

revoke all on function public.internal_ops_recent_shops (int) from public;
grant execute on function public.internal_ops_recent_shops (int) to authenticated;

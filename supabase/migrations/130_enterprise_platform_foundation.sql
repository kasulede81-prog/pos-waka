-- Phase 10.0 — Enterprise Platform Foundation
-- Shops remain branches under organizations; additive only for backward compatibility.

-- ---------- Organization HQ metadata ----------
alter table public.organizations
  add column if not exists hq_timezone text default 'Africa/Kampala';

alter table public.organizations
  add column if not exists enterprise_settings jsonb not null default '{}'::jsonb;

comment on column public.organizations.enterprise_settings is 'HQ preferences: reporting currency, alert thresholds, backup policy (Phase 10).';

-- ---------- Branch profile (shop = branch) ----------
alter table public.shops
  add column if not exists branch_status text not null default 'active';

alter table public.shops drop constraint if exists shops_branch_status_check;

alter table public.shops
  add constraint shops_branch_status_check check (
    branch_status in ('active', 'disabled', 'archived')
  );

alter table public.shops
  add column if not exists manager_user_id uuid references auth.users (id) on delete set null;

alter table public.shops
  add column if not exists timezone text default 'Africa/Kampala';

alter table public.shops
  add column if not exists currency text not null default 'UGX';

alter table public.shops
  add column if not exists tax_profile jsonb not null default '{}'::jsonb;

alter table public.shops
  add column if not exists business_types jsonb not null default '[]'::jsonb;

alter table public.shops
  add column if not exists branch_contacts jsonb not null default '{}'::jsonb;

alter table public.shops
  add column if not exists archived_at timestamptz;

create index if not exists shops_branch_status_idx on public.shops (organization_id, branch_status);

-- Backfill business_types from legacy single business_type column.
update public.shops sh
set business_types = jsonb_build_array(sh.business_type)
where coalesce(jsonb_array_length(sh.business_types), 0) = 0;

-- ---------- Cross-branch stock transfers ----------
create table if not exists public.enterprise_stock_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  from_shop_id uuid not null references public.shops (id) on delete restrict,
  to_shop_id uuid not null references public.shops (id) on delete restrict,
  status text not null default 'draft'
    check (
      status in (
        'draft',
        'pending_approval',
        'approved',
        'shipped',
        'in_transit',
        'received',
        'completed',
        'cancelled',
        'rejected'
      )
    ),
  reason text,
  controlled_transfer boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  shipped_at timestamptz,
  received_at timestamptz,
  completed_at timestamptz,
  client_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint enterprise_transfer_shops_distinct check (from_shop_id <> to_shop_id)
);

create index if not exists enterprise_stock_transfers_org_idx
  on public.enterprise_stock_transfers (organization_id, created_at desc);

create index if not exists enterprise_stock_transfers_status_idx
  on public.enterprise_stock_transfers (organization_id, status);

create unique index if not exists enterprise_stock_transfers_client_unique
  on public.enterprise_stock_transfers (organization_id, client_id)
  where client_id is not null;

create table if not exists public.enterprise_stock_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.enterprise_stock_transfers (id) on delete cascade,
  product_id uuid,
  product_name text not null,
  quantity numeric not null check (quantity > 0),
  batch_id text,
  batch_number text,
  batch_expiry date,
  unit_cost_ugx bigint not null default 0,
  received_quantity numeric not null default 0 check (received_quantity >= 0),
  created_at timestamptz not null default now()
);

create index if not exists enterprise_stock_transfer_lines_transfer_idx
  on public.enterprise_stock_transfer_lines (transfer_id);

-- ---------- Enterprise purchase orders ----------
create table if not exists public.enterprise_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  supplier_id uuid,
  supplier_name text,
  status text not null default 'pending'
    check (
      status in (
        'pending',
        'approved',
        'ordered',
        'partially_received',
        'received',
        'cancelled'
      )
    ),
  po_number text,
  notes text,
  total_ugx bigint not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  ordered_at timestamptz,
  client_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists enterprise_purchase_orders_org_idx
  on public.enterprise_purchase_orders (organization_id, created_at desc);

create table if not exists public.enterprise_purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.enterprise_purchase_orders (id) on delete cascade,
  product_name text not null,
  quantity numeric not null check (quantity > 0),
  unit_cost_ugx bigint not null default 0,
  received_quantity numeric not null default 0 check (received_quantity >= 0)
);

create table if not exists public.enterprise_purchase_order_branches (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.enterprise_purchase_orders (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  allocated_quantity numeric not null default 0,
  received_quantity numeric not null default 0,
  unique (purchase_order_id, shop_id)
);

-- ---------- RLS ----------
alter table public.enterprise_stock_transfers enable row level security;
alter table public.enterprise_stock_transfer_lines enable row level security;
alter table public.enterprise_purchase_orders enable row level security;
alter table public.enterprise_purchase_order_lines enable row level security;
alter table public.enterprise_purchase_order_branches enable row level security;

drop policy if exists enterprise_stock_transfers_select on public.enterprise_stock_transfers;
create policy enterprise_stock_transfers_select on public.enterprise_stock_transfers
  for select using (
    public.user_has_org_role (organization_id, array['owner', 'admin'])
    or public.user_can_manage_shop (from_shop_id)
    or public.user_can_manage_shop (to_shop_id)
  );

drop policy if exists enterprise_stock_transfers_write on public.enterprise_stock_transfers;
create policy enterprise_stock_transfers_write on public.enterprise_stock_transfers
  for all using (
    public.user_has_org_role (organization_id, array['owner', 'admin'])
    or public.user_can_manage_shop (from_shop_id)
  )
  with check (
    public.user_has_org_role (organization_id, array['owner', 'admin'])
    or public.user_can_manage_shop (from_shop_id)
  );

drop policy if exists enterprise_transfer_lines_select on public.enterprise_stock_transfer_lines;
create policy enterprise_transfer_lines_select on public.enterprise_stock_transfer_lines
  for select using (
    exists (
      select 1 from public.enterprise_stock_transfers t
      where t.id = transfer_id
        and (
          public.user_has_org_role (t.organization_id, array['owner', 'admin'])
          or public.user_can_manage_shop (t.from_shop_id)
          or public.user_can_manage_shop (t.to_shop_id)
        )
    )
  );

drop policy if exists enterprise_po_select on public.enterprise_purchase_orders;
create policy enterprise_po_select on public.enterprise_purchase_orders
  for select using (public.user_has_org_role (organization_id, array['owner', 'admin', 'billing']));

drop policy if exists enterprise_po_write on public.enterprise_purchase_orders;
create policy enterprise_po_write on public.enterprise_purchase_orders
  for all using (public.user_has_org_role (organization_id, array['owner', 'admin']))
  with check (public.user_has_org_role (organization_id, array['owner', 'admin']));

-- ---------- Helpers ----------
create or replace function public.enterprise_user_organization_id ()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select sh.organization_id
      from public.profiles pr
      join public.shops sh on sh.id = pr.primary_shop_id
      where pr.id = auth.uid ()
    ),
    (
      select sh.organization_id
      from public.shop_members sm
      join public.shops sh on sh.id = sm.shop_id
      where sm.user_id = auth.uid ()
      order by sm.created_at asc
      limit 1
    )
  );
$$;

revoke all on function public.enterprise_user_organization_id () from public;
grant execute on function public.enterprise_user_organization_id () to authenticated;

-- ---------- List branches (Enterprise Branch Center) ----------
create or replace function public.enterprise_list_branches ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.enterprise_user_organization_id ();
  j jsonb;
begin
  if v_org is null then
    return '[]'::jsonb;
  end if;

  if not public.user_has_org_role (v_org, array['owner', 'admin', 'billing', 'staff']) then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg (
      jsonb_build_object (
        'id', sh.id,
        'organizationId', sh.organization_id,
        'name', sh.name,
        'code', sh.code,
        'addressLine', sh.address_line,
        'city', sh.city,
        'district', sh.district,
        'phoneE164', sh.phone_e164,
        'managerUserId', sh.manager_user_id,
        'timezone', coalesce(sh.timezone, 'Africa/Kampala'),
        'currency', coalesce(sh.currency, 'UGX'),
        'taxProfile', sh.tax_profile,
        'businessTypes', sh.business_types,
        'businessType', sh.business_type,
        'status', sh.branch_status,
        'isActive', sh.is_active,
        'contacts', sh.branch_contacts,
        'shopNumber', sh.shop_number,
        'createdAt', sh.created_at,
        'archivedAt', sh.archived_at
      )
      order by sh.created_at asc
    ),
    '[]'::jsonb
  )
  into j
  from public.shops sh
  where sh.organization_id = v_org;

  return j;
end;
$$;

revoke all on function public.enterprise_list_branches () from public;
grant execute on function public.enterprise_list_branches () to authenticated;

-- ---------- Upsert branch ----------
create or replace function public.enterprise_upsert_branch (p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.enterprise_user_organization_id ();
  v_id uuid;
  v_name text;
begin
  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'no_organization');
  end if;

  if not public.user_has_org_role (v_org, array['owner', 'admin']) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif(trim(p_payload ->> 'id'), '')::uuid;
  v_name := nullif(trim(p_payload ->> 'name'), '');

  if v_name is null then
    return jsonb_build_object ('ok', false, 'error', 'name_required');
  end if;

  if v_id is null then
    insert into public.shops (
      organization_id,
      name,
      code,
      address_line,
      city,
      district,
      phone_e164,
      manager_user_id,
      timezone,
      currency,
      tax_profile,
      business_types,
      branch_contacts,
      business_type
    )
    values (
      v_org,
      v_name,
      nullif(trim(p_payload ->> 'code'), ''),
      nullif(trim(p_payload ->> 'addressLine'), ''),
      nullif(trim(p_payload ->> 'city'), ''),
      nullif(trim(p_payload ->> 'district'), ''),
      nullif(trim(p_payload ->> 'phoneE164'), ''),
      nullif(trim(p_payload ->> 'managerUserId'), '')::uuid,
      coalesce(nullif(trim(p_payload ->> 'timezone'), ''), 'Africa/Kampala'),
      coalesce(nullif(trim(p_payload ->> 'currency'), ''), 'UGX'),
      coalesce(p_payload -> 'taxProfile', '{}'::jsonb),
      coalesce(p_payload -> 'businessTypes', jsonb_build_array(coalesce(p_payload ->> 'businessType', 'kiosk_duka'))),
      coalesce(p_payload -> 'contacts', '{}'::jsonb),
      coalesce(nullif(trim(p_payload ->> 'businessType'), ''), 'kiosk_duka')
    )
    returning id into v_id;
  else
    update public.shops sh
    set
      name = v_name,
      code = nullif(trim(p_payload ->> 'code'), ''),
      address_line = nullif(trim(p_payload ->> 'addressLine'), ''),
      city = nullif(trim(p_payload ->> 'city'), ''),
      district = nullif(trim(p_payload ->> 'district'), ''),
      phone_e164 = nullif(trim(p_payload ->> 'phoneE164'), ''),
      manager_user_id = nullif(trim(p_payload ->> 'managerUserId'), '')::uuid,
      timezone = coalesce(nullif(trim(p_payload ->> 'timezone'), ''), sh.timezone),
      currency = coalesce(nullif(trim(p_payload ->> 'currency'), ''), sh.currency),
      tax_profile = coalesce(p_payload -> 'taxProfile', sh.tax_profile),
      business_types = coalesce(p_payload -> 'businessTypes', sh.business_types),
      branch_contacts = coalesce(p_payload -> 'contacts', sh.branch_contacts),
      updated_at = now ()
    where sh.id = v_id
      and sh.organization_id = v_org;
  end if;

  return jsonb_build_object ('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.enterprise_upsert_branch (jsonb) from public;
grant execute on function public.enterprise_upsert_branch (jsonb) to authenticated;

-- ---------- Branch lifecycle ----------
create or replace function public.enterprise_set_branch_status (
  p_shop_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.enterprise_user_organization_id ();
begin
  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'no_organization');
  end if;

  if not public.user_has_org_role (v_org, array['owner', 'admin']) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  if p_status not in ('active', 'disabled', 'archived') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_status');
  end if;

  update public.shops sh
  set
    branch_status = p_status,
    is_active = (p_status = 'active'),
    archived_at = case when p_status = 'archived' then now () else null end,
    updated_at = now ()
  where sh.id = p_shop_id
    and sh.organization_id = v_org;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.enterprise_set_branch_status (uuid, text) from public;
grant execute on function public.enterprise_set_branch_status (uuid, text) to authenticated;

-- ---------- HQ dashboard metrics (aggregated) ----------
create or replace function public.enterprise_dashboard_metrics (
  p_from date default (timezone ('Africa/Kampala', now()))::date,
  p_to date default (timezone ('Africa/Kampala', now()))::date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.enterprise_user_organization_id ();
  v_shop_ids uuid[];
  j jsonb;
begin
  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'no_organization');
  end if;

  select array_agg(sh.id)
  into v_shop_ids
  from public.shops sh
  where sh.organization_id = v_org
    and sh.branch_status = 'active';

  select jsonb_build_object (
    'ok', true,
    'organizationId', v_org,
    'from', p_from,
    'to', p_to,
    'branchCount', coalesce(array_length(v_shop_ids, 1), 0),
    'branchesOnline', (
      select count(*)::int
      from public.shops sh
      where sh.organization_id = v_org
        and sh.branch_status = 'active'
        and sh.last_seen_at > now () - interval '15 minutes'
    ),
    'branchesOffline', (
      select count(*)::int
      from public.shops sh
      where sh.organization_id = v_org
        and sh.branch_status = 'active'
        and (sh.last_seen_at is null or sh.last_seen_at <= now () - interval '15 minutes')
    ),
    'todaySalesUgx', coalesce((
      select sum(s.total_ugx)::bigint
      from public.sales s
      where s.shop_id = any (v_shop_ids)
        and s.status = 'completed'
        and (s.created_at at time zone 'Africa/Kampala')::date between p_from and p_to
    ), 0),
    'todayProfitUgx', coalesce((
      select sum(s.estimated_profit_ugx)::bigint
      from public.sales s
      where s.shop_id = any (v_shop_ids)
        and s.status = 'completed'
        and (s.created_at at time zone 'Africa/Kampala')::date between p_from and p_to
    ), 0),
    'openShifts', 0,
    'openBusinessDays', 0,
    'pendingSyncDevices', coalesce((
      select count(distinct sd.id)::int
      from public.shop_devices sd
      join public.shops sh on sh.id = sd.shop_id
      where sh.organization_id = v_org
        and sd.is_active = true
        and sd.last_seen_at > now () - interval '24 hours'
    ), 0),
    'lowStockBranches', 0,
    'nearExpiryAlerts', 0,
    'controlledMedicineAlerts', 0,
    'topBranches', '[]'::jsonb,
    'recentAudits', coalesce((
      select jsonb_agg(row order by row ->> 'at' desc)
      from (
        select jsonb_build_object (
          'id', al.id,
          'shopId', al.shop_id,
          'action', al.action,
          'summary', al.payload_summary,
          'at', al.created_at
        ) as row
        from public.audit_logs al
        where al.shop_id = any (v_shop_ids)
        order by al.created_at desc
        limit 12
      ) sub
    ), '[]'::jsonb)
  )
  into j;

  return j;
end;
$$;

revoke all on function public.enterprise_dashboard_metrics (date, date) from public;
grant execute on function public.enterprise_dashboard_metrics (date, date) to authenticated;

-- ---------- Enterprise audit search ----------
create or replace function public.enterprise_audit_search (
  p_shop_id uuid default null,
  p_action text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit int default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.enterprise_user_organization_id ();
  j jsonb;
begin
  if v_org is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(row order by row ->> 'at' desc),
    '[]'::jsonb
  )
  into j
  from (
    select jsonb_build_object (
      'id', al.id,
      'shopId', al.shop_id,
      'actorUserId', al.actor_user_id,
      'role', al.role,
      'action', al.action,
      'summary', al.payload_summary,
      'payload', al.payload,
      'deviceId', al.device_id,
      'at', al.created_at
    ) as row
    from public.audit_logs al
    join public.shops sh on sh.id = al.shop_id
    where sh.organization_id = v_org
      and (p_shop_id is null or al.shop_id = p_shop_id)
      and (p_action is null or al.action = p_action)
      and (p_from is null or al.created_at >= p_from)
      and (p_to is null or al.created_at <= p_to)
    order by al.created_at desc
    limit greatest(1, least(p_limit, 500))
  ) sub;

  return j;
end;
$$;

revoke all on function public.enterprise_audit_search (uuid, text, timestamptz, timestamptz, int) from public;
grant execute on function public.enterprise_audit_search (uuid, text, timestamptz, timestamptz, int) to authenticated;

comment on table public.enterprise_stock_transfers is 'Cross-branch stock transfers (Phase 10); offline client queues via sync when wired.';
comment on table public.enterprise_purchase_orders is 'HQ centralized purchase orders assigned to branches (Phase 10).';

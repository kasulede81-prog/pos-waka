-- Waka POS — commercial activation: requests, licenses, business_status + RPCs

-- 1) business_status (per shop lifecycle for POS gate)
create table if not exists public.business_status (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  lifecycle text not null default 'inactive'
    check (lifecycle in ('inactive', 'pending_review', 'active', 'suspended')),
  current_license_id uuid,
  updated_at timestamptz not null default now ()
);

create index if not exists business_status_lifecycle_idx on public.business_status (lifecycle);

comment on table public.business_status is 'POS access gate per shop: inactive until licensed, active when approved.';

-- 2) activation_requests
create table if not exists public.activation_requests (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  business_display_name text not null,
  public_reference_code text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id),
  license_id uuid,
  created_at timestamptz not null default now (),
  unique (public_reference_code)
);

create index if not exists activation_requests_shop_idx on public.activation_requests (shop_id);
create index if not exists activation_requests_status_idx on public.activation_requests (status);

-- 3) business_licenses (final keys issued by ops)
create table if not exists public.business_licenses (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  license_key text not null,
  plan_code text not null default 'business',
  expires_at timestamptz,
  max_devices int not null default 3,
  is_active boolean not null default true,
  created_at timestamptz not null default now (),
  unique (license_key)
);

create index if not exists business_licenses_shop_idx on public.business_licenses (shop_id);

alter table public.business_status
  drop constraint if exists business_status_license_fk;

alter table public.business_status
  add constraint business_status_license_fk
  foreign key (current_license_id) references public.business_licenses (id) on delete set null;

alter table public.activation_requests
  drop constraint if exists activation_requests_license_fk;

alter table public.activation_requests
  add constraint activation_requests_license_fk
  foreign key (license_id) references public.business_licenses (id) on delete set null;

-- Grandfather all existing shops as fully active
insert into public.business_status (shop_id, lifecycle)
select s.id, 'active'
from public.shops s
on conflict (shop_id) do nothing;

-- Ensure every shop has a row going forward
create or replace function public.trg_ensure_business_status_row ()
returns trigger
language plpgsql
as $$
begin
  insert into public.business_status (shop_id, lifecycle)
  values (new.id, 'inactive')
  on conflict (shop_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_shops_ensure_business_status on public.shops;
create trigger trg_shops_ensure_business_status
after insert on public.shops
for each row execute function public.trg_ensure_business_status_row ();

drop trigger if exists trg_business_status_updated on public.business_status;
create trigger trg_business_status_updated
before update on public.business_status
for each row execute function public.set_updated_at ();

-- Helpers: slug + license key fragments
create or replace function public.waka_slug_for_activation (p_name text)
returns text
language sql
immutable
as $$
  select upper(
    left(
      trim(both '-' from regexp_replace(coalesce(trim(p_name), ''), '[^a-zA-Z0-9]+', '-', 'g')),
      28
    )
  );
$$;

create or replace function public.waka_random_suffix (p_len int default 4)
returns text
language sql
as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, greatest(4, least(p_len, 8))));
$$;

create or replace function public.waka_generate_activation_request_code (p_business_name text)
returns text
language plpgsql
as $$
declare
  slug text := nullif(trim(public.waka_slug_for_activation(p_business_name)), '');
begin
  return 'WAKA-' || coalesce(nullif(slug, ''), 'SHOP') || '-' || public.waka_random_suffix(4);
end;
$$;

create or replace function public.waka_generate_license_key ()
returns text
language sql
as $$
  select 'WAKA-LIC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
$$;

-- Primary shop for current user (first membership row)
create or replace function public.waka_primary_shop_for_user ()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select sm.shop_id
  from public.shop_members sm
  where sm.user_id = auth.uid ()
  order by sm.created_at asc
  limit 1;
$$;

revoke all on function public.waka_primary_shop_for_user () from public;
grant execute on function public.waka_primary_shop_for_user () to authenticated;

-- Shop lifecycle as seen by the signed-in user (grandfather = active when no row)
create or replace function public.get_my_shop_activation_gate ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid := public.waka_primary_shop_for_user ();
  v_lifecycle text := 'inactive';
  v_req record;
begin
  if auth.uid () is null then
    raise exception 'Not authenticated';
  end if;

  if v_shop is null then
    return jsonb_build_object('shop_id', null, 'lifecycle', 'inactive', 'open_request', null, 'reference_code', null);
  end if;

  select coalesce(bs.lifecycle, 'active')
  into v_lifecycle
  from public.shops s
  left join public.business_status bs on bs.shop_id = s.id
  where s.id = v_shop;

  select *
  into v_req
  from public.activation_requests ar
  where ar.shop_id = v_shop
    and ar.status = 'pending'
  order by ar.created_at desc
  limit 1;

  return jsonb_build_object(
    'shop_id', v_shop,
    'lifecycle', v_lifecycle,
    'reference_code',
    case when v_req.id is null then null else v_req.public_reference_code end,
    'open_request',
    case
      when v_req.id is null then null
      else jsonb_build_object(
        'id', v_req.id,
        'business_display_name', v_req.business_display_name,
        'public_reference_code', v_req.public_reference_code,
        'status', v_req.status,
        'created_at', v_req.created_at
      )
    end,
    'active_license_key',
    (
      select bl.license_key
      from public.business_licenses bl
      inner join public.business_status bs on bs.current_license_id = bl.id and bs.shop_id = v_shop
      where bl.is_active
      limit 1
    )
  );
end;
$$;

revoke all on function public.get_my_shop_activation_gate () from public;
grant execute on function public.get_my_shop_activation_gate () to authenticated;

-- Owners/managers submit one pending request per shop at a time
create or replace function public.submit_shop_activation_request (p_business_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid := public.waka_primary_shop_for_user ();
  v_role text;
  v_nm text := trim(coalesce(p_business_display_name, ''));
  v_code text;
  v_try int := 0;
  v_id uuid;
begin
  if auth.uid () is null then raise exception 'Not authenticated'; end if;
  if v_shop is null then raise exception 'No shop membership'; end if;

  select sm.role into v_role from public.shop_members sm
  where sm.shop_id = v_shop and sm.user_id = auth.uid () limit 1;
  if v_role is null then raise exception 'Not a shop member'; end if;
  if v_role not in ('owner', 'manager') then raise exception 'Only owner or manager can activate'; end if;
  if length(v_nm) < 2 then raise exception 'Business name required'; end if;

  insert into public.business_status (shop_id, lifecycle)
  values (v_shop, 'inactive')
  on conflict (shop_id) do nothing;

  if exists (
    select 1 from public.business_status bs
    where bs.shop_id = v_shop and bs.lifecycle in ('active')
  ) then
    raise exception 'Shop already active';
  end if;

  if exists (
    select 1 from public.activation_requests ar
    where ar.shop_id = v_shop and ar.status = 'pending'
  ) then
    raise exception 'A request is already pending';
  end if;

  loop
    v_try := v_try + 1;
    v_code := public.waka_generate_activation_request_code(v_nm);
    begin
      insert into public.activation_requests (
        shop_id,
        created_by,
        business_display_name,
        public_reference_code,
        status
      ) values (
        v_shop,
        auth.uid (),
        v_nm,
        v_code,
        'pending'
      )
      returning id into v_id;
      exit;
    exception when unique_violation then
      if v_try > 14 then raise exception 'Could not generate unique code'; end if;
    end;
  end loop;

  insert into public.business_status (shop_id, lifecycle)
  values (v_shop, 'pending_review')
  on conflict (shop_id) do update set lifecycle = 'pending_review', updated_at = now ();

  return jsonb_build_object('id', v_id, 'public_reference_code', v_code);
end;
$$;

revoke all on function public.submit_shop_activation_request (text) from public;
grant execute on function public.submit_shop_activation_request (text) to authenticated;

-- ---------- Internal ops ----------
create or replace function public.waka_ops_list_activation_requests ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin', 'support_admin', 'finance_admin']::text[]) then
    raise exception 'Not allowed';
  end if;

  return coalesce (
    (
      select jsonb_agg(to_jsonb (x))
      from (
        select
          ar.id,
          ar.shop_id,
          ar.business_display_name,
          ar.public_reference_code,
          ar.status,
          ar.created_at,
          ar.created_by,
          coalesce(bs.lifecycle, 'inactive') as shop_lifecycle
        from public.activation_requests ar
        left join public.business_status bs on bs.shop_id = ar.shop_id
        where ar.status = 'pending'
        order by ar.created_at desc
      ) x
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.waka_ops_list_activation_requests () from public;
grant execute on function public.waka_ops_list_activation_requests () to authenticated;

create or replace function public.waka_ops_resolve_activation_request (
  p_request_id uuid,
  p_approve boolean,
  p_plan_code text default 'business',
  p_expires_days int default 365,
  p_max_devices int default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_shop uuid;
  v_lic_id uuid;
  v_key text;
  v_try int := 0;
  v_expires timestamptz := (
    timezone ('Africa/Kampala', now ())::date
    + make_interval(days => greatest(30, least(coalesce(p_expires_days, 365), 3650)))
  );
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin', 'support_admin']::text[]) then
    raise exception 'Not allowed';
  end if;

  select * into v_req from public.activation_requests ar where ar.id = p_request_id for update;
  if v_req.id is null then raise exception 'Request not found'; end if;

  if v_req.status <> 'pending' then raise exception 'Request already resolved'; end if;
  v_shop := v_req.shop_id;

  if coalesce(p_approve, false) then
    loop
      v_try := v_try + 1;
      v_key := public.waka_generate_license_key ();
      begin
        insert into public.business_licenses (shop_id, license_key, plan_code, expires_at, max_devices)
        values (
          v_shop,
          v_key,
          coalesce(nullif(trim(p_plan_code), ''), 'business'),
          v_expires,
          greatest(1, least(coalesce(p_max_devices, 3), 500))
        )
        returning id into v_lic_id;
        exit;
      exception when unique_violation then
        if v_try > 12 then raise exception 'Could not generate unique license key'; end if;
      end;
    end loop;

    update public.activation_requests set
      status = 'approved',
      resolved_at = now (),
      resolved_by = auth.uid (),
      license_id = v_lic_id
    where id = v_req.id;

    insert into public.business_status (shop_id, lifecycle, current_license_id)
    values (v_shop, 'active', v_lic_id)
    on conflict (shop_id) do update set
      lifecycle = 'active',
      current_license_id = v_lic_id,
      updated_at = now ();

    return jsonb_build_object('ok', true, 'license_key', v_key, 'license_id', v_lic_id);
  else
    update public.activation_requests set
      status = 'rejected',
      resolved_at = now (),
      resolved_by = auth.uid ()
    where id = v_req.id;

    insert into public.business_status (shop_id, lifecycle)
    values (v_shop, 'inactive')
    on conflict (shop_id) do update set lifecycle = 'inactive', updated_at = now ();

    return jsonb_build_object('ok', true, 'rejected', true);
  end if;
end;
$$;

revoke all on function public.waka_ops_resolve_activation_request (uuid, boolean, text, int, int) from public;
grant execute on function public.waka_ops_resolve_activation_request (uuid, boolean, text, int, int) to authenticated;

-- ---------- RLS ----------
alter table public.business_status enable row level security;
alter table public.activation_requests enable row level security;
alter table public.business_licenses enable row level security;

drop policy if exists business_status_shop_read on public.business_status;
create policy business_status_shop_read on public.business_status
  for select using (
    public.is_waka_internal_staff ()
    or exists (
      select 1 from public.shop_members sm
      where sm.shop_id = business_status.shop_id and sm.user_id = auth.uid ()
    )
  );

drop policy if exists activation_requests_shop_rw on public.activation_requests;
create policy activation_requests_shop_rw on public.activation_requests
  for select using (
    public.is_waka_internal_staff ()
    or exists (
      select 1 from public.shop_members sm
      where sm.shop_id = activation_requests.shop_id and sm.user_id = auth.uid ()
    )
  );

drop policy if exists business_licenses_shop_read on public.business_licenses;
create policy business_licenses_shop_read on public.business_licenses
  for select using (
    public.is_waka_internal_staff ()
    or exists (
      select 1 from public.shop_members sm
      where sm.shop_id = business_licenses.shop_id and sm.user_id = auth.uid ()
    )
  );

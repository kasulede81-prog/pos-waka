-- Identity & trust hardening: email verification gates, workspace repair, single owner,
-- cloud staff, primary shop, internal admin privacy, device fingerprint audit.

-- ---------- A1: Email verification helpers ----------
create or replace function public.auth_user_email_verified ()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid ()
      and (
        u.email_confirmed_at is not null
        or coalesce (u.raw_app_meta_data ->> 'provider', '') in ('google', 'apple')
        or exists (
          select 1
          from jsonb_array_elements_text (
            coalesce (u.raw_app_meta_data -> 'providers', '[]'::jsonb)
          ) p (val)
          where val in ('google', 'apple')
        )
      )
  );
$$;

revoke all on function public.auth_user_email_verified () from public;
grant execute on function public.auth_user_email_verified () to authenticated;

create or replace function public.require_verified_email_for_cloud ()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid () is null then
    raise exception 'Not authenticated';
  end if;
  if not public.auth_user_email_verified () then
    raise exception 'email_not_verified'
      using hint = 'Confirm your email before using cloud features.';
  end if;
end;
$$;

revoke all on function public.require_verified_email_for_cloud () from public;
grant execute on function public.require_verified_email_for_cloud () to authenticated;

-- ---------- A3: Single owner per shop ----------
-- Demote duplicate owners (keep earliest membership).
with ranked as (
  select
    sm.id,
    sm.shop_id,
    row_number() over (partition by sm.shop_id order by sm.created_at asc) as rn
  from public.shop_members sm
  where sm.role = 'owner'
)
update public.shop_members sm
set role = 'manager'
from ranked r
where sm.id = r.id
  and r.rn > 1;

create unique index if not exists shop_members_one_owner_per_shop
  on public.shop_members (shop_id)
  where role = 'owner';

create or replace function public.trg_shop_members_enforce_single_owner ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
begin
  if new.role is distinct from 'owner' then
    return new;
  end if;

  select sm.user_id
  into v_existing
  from public.shop_members sm
  where sm.shop_id = new.shop_id
    and sm.role = 'owner'
    and (tg_op = 'INSERT' or sm.id <> new.id)
  limit 1;

  if v_existing is not null then
    insert into public.audit_logs (
      shop_id,
      actor_user_id,
      role,
      action,
      payload_summary,
      payload
    )
    values (
      new.shop_id,
      auth.uid (),
      'owner',
      'auth_forbidden',
      'Rejected second shop owner assignment',
      jsonb_build_object (
        'attempted_user_id', new.user_id,
        'existing_owner_user_id', v_existing
      )
    );
    raise exception 'shop_already_has_owner'
      using hint = 'This shop already has an owner.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_shop_members_single_owner on public.shop_members;
create trigger trg_shop_members_single_owner
  before insert or update of role on public.shop_members
  for each row
  execute function public.trg_shop_members_enforce_single_owner ();

-- ---------- A2: Workspace health + repair ----------
create or replace function public.owner_workspace_health ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid ();
  v_has_profile boolean;
  v_has_org boolean;
  v_has_shop boolean;
  v_has_membership boolean;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select exists (select 1 from public.profiles pr where pr.id = v_uid)
  into v_has_profile;

  select exists (
    select 1 from public.organization_members om where om.user_id = v_uid
  )
  into v_has_org;

  select exists (
    select 1
    from public.shop_members sm
    where sm.user_id = v_uid
  )
  into v_has_membership;

  select exists (
    select 1
    from public.shop_members sm
    join public.shops sh on sh.id = sm.shop_id
    where sm.user_id = v_uid
  )
  into v_has_shop;

  return jsonb_build_object (
    'ok',
    v_has_profile and v_has_org and v_has_shop and v_has_membership,
    'has_profile',
    v_has_profile,
    'has_org',
    v_has_org,
    'has_shop',
    v_has_shop,
    'has_membership',
    v_has_membership
  );
end;
$$;

revoke all on function public.owner_workspace_health () from public;
grant execute on function public.owner_workspace_health () to authenticated;

-- ---------- D: Primary shop on profile ----------
alter table public.profiles
  add column if not exists primary_shop_id uuid references public.shops (id) on delete set null;

create index if not exists profiles_primary_shop_idx on public.profiles (primary_shop_id)
  where primary_shop_id is not null;

-- Backfill primary shop for existing owners.
update public.profiles pr
set primary_shop_id = sub.shop_id
from (
  select distinct on (sm.user_id)
    sm.user_id,
    sm.shop_id
  from public.shop_members sm
  where sm.role = 'owner'
  order by sm.user_id, sm.created_at asc
) sub
where pr.id = sub.user_id
  and pr.primary_shop_id is null;

create or replace function public.list_user_shops ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  j jsonb;
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg (
      jsonb_build_object (
        'shop_id', sh.id,
        'shop_name', sh.name,
        'organization_id', sh.organization_id,
        'role', sm.role,
        'is_primary', (pr.primary_shop_id = sh.id)
      )
      order by (pr.primary_shop_id = sh.id) desc, sm.created_at asc
    ),
    '[]'::jsonb
  )
  into j
  from public.shop_members sm
  join public.shops sh on sh.id = sm.shop_id
  left join public.profiles pr on pr.id = v_uid
  where sm.user_id = v_uid;

  return j;
end;
$$;

revoke all on function public.list_user_shops () from public;
grant execute on function public.list_user_shops () to authenticated;

create or replace function public.set_user_primary_shop (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_required');
  end if;

  if not exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = p_shop_id
      and sm.user_id = v_uid
  ) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  update public.profiles pr
  set primary_shop_id = p_shop_id, updated_at = now ()
  where pr.id = v_uid;

  return jsonb_build_object ('ok', true, 'shop_id', p_shop_id);
end;
$$;

revoke all on function public.set_user_primary_shop (uuid) from public;
grant execute on function public.set_user_primary_shop (uuid) to authenticated;

-- ---------- B: Cloud POS staff ----------
create table if not exists public.shop_pos_staff (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  client_id uuid,
  name text not null,
  username text,
  role text not null default 'cashier'
    check (
      role in (
        'manager',
        'cashier',
        'stock_keeper',
        'supervisor',
        'waiter'
      )
    ),
  pin_hash text,
  password_hash text,
  phone_e164 text,
  permissions jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  constraint shop_pos_staff_phone_format check (
    phone_e164 is null
    or phone_e164 ~ '^\+256[0-9]{9}$'
  )
);

create unique index if not exists shop_pos_staff_shop_username_active
  on public.shop_pos_staff (shop_id, lower (trim (username)))
  where username is not null
    and deleted_at is null;

create index if not exists shop_pos_staff_shop_active_idx
  on public.shop_pos_staff (shop_id, updated_at desc)
  where deleted_at is null;

drop trigger if exists trg_shop_pos_staff_updated on public.shop_pos_staff;
create trigger trg_shop_pos_staff_updated
  before update on public.shop_pos_staff
  for each row execute function public.set_updated_at ();

alter table public.shop_pos_staff enable row level security;

drop policy if exists shop_pos_staff_select on public.shop_pos_staff;
create policy shop_pos_staff_select
  on public.shop_pos_staff for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists shop_pos_staff_write on public.shop_pos_staff;
create policy shop_pos_staff_write
  on public.shop_pos_staff for all
  using (
    public.user_is_shop_owner (shop_id)
    or exists (
      select 1
      from public.shop_members sm
      where sm.shop_id = shop_pos_staff.shop_id
        and sm.user_id = auth.uid ()
        and sm.role in ('owner', 'manager')
    )
  )
  with check (
    public.user_is_shop_owner (shop_id)
    or exists (
      select 1
      from public.shop_members sm
      where sm.shop_id = shop_pos_staff.shop_id
        and sm.user_id = auth.uid ()
        and sm.role in ('owner', 'manager')
    )
  );

create or replace function public.shop_pos_staff_list (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j jsonb;
begin
  perform public.require_verified_email_for_cloud ();

  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  select coalesce(
    jsonb_agg (
      jsonb_build_object (
        'id', s.id,
        'client_id', s.client_id,
        'name', s.name,
        'username', s.username,
        'role', s.role,
        'pin_hash', s.pin_hash,
        'password_hash', s.password_hash,
        'phone_e164', s.phone_e164,
        'permissions', s.permissions,
        'is_active', s.is_active,
        'created_at', s.created_at,
        'updated_at', s.updated_at
      )
      order by s.created_at asc
    ),
    '[]'::jsonb
  )
  into j
  from public.shop_pos_staff s
  where s.shop_id = p_shop_id
    and s.deleted_at is null;

  return j;
end;
$$;

revoke all on function public.shop_pos_staff_list (uuid) from public;
grant execute on function public.shop_pos_staff_list (uuid) to authenticated;

create or replace function public.shop_pos_staff_upsert (p_shop_id uuid, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_client_id uuid;
  v_name text;
  v_username text;
  v_role text;
begin
  perform public.require_verified_email_for_cloud ();

  if not public.user_is_shop_owner (p_shop_id)
    and not exists (
      select 1
      from public.shop_members sm
      where sm.shop_id = p_shop_id
        and sm.user_id = auth.uid ()
        and sm.role = 'manager'
    ) then
    raise exception 'Forbidden';
  end if;

  v_id := nullif (p_row ->> 'id', '')::uuid;
  v_client_id := nullif (p_row ->> 'client_id', '')::uuid;
  v_name := nullif (trim (p_row ->> 'name'), '');
  v_username := nullif (lower (trim (p_row ->> 'username')), '');
  v_role := coalesce (nullif (trim (p_row ->> 'role'), ''), 'cashier');

  if v_name is null then
    return jsonb_build_object ('ok', false, 'error', 'name_required');
  end if;

  if v_id is null and v_client_id is not null then
    select s.id
    into v_id
    from public.shop_pos_staff s
    where s.shop_id = p_shop_id
      and s.client_id = v_client_id
      and s.deleted_at is null
    limit 1;
  end if;

  if v_id is null then
    insert into public.shop_pos_staff (
      shop_id,
      client_id,
      name,
      username,
      role,
      pin_hash,
      password_hash,
      phone_e164,
      permissions,
      is_active
    )
    values (
      p_shop_id,
      v_client_id,
      v_name,
      v_username,
      v_role,
      nullif (p_row ->> 'pin_hash', ''),
      nullif (p_row ->> 'password_hash', ''),
      nullif (trim (p_row ->> 'phone_e164'), ''),
      coalesce (p_row -> 'permissions', '[]'::jsonb),
      coalesce ((p_row ->> 'is_active')::boolean, true)
    )
    returning id into v_id;
  else
    update public.shop_pos_staff s
    set
      name = v_name,
      username = v_username,
      role = v_role,
      pin_hash = coalesce (nullif (p_row ->> 'pin_hash', ''), s.pin_hash),
      password_hash = coalesce (nullif (p_row ->> 'password_hash', ''), s.password_hash),
      phone_e164 = coalesce (nullif (trim (p_row ->> 'phone_e164'), ''), s.phone_e164),
      permissions = coalesce (p_row -> 'permissions', s.permissions),
      is_active = coalesce ((p_row ->> 'is_active')::boolean, s.is_active),
      client_id = coalesce (v_client_id, s.client_id),
      updated_at = now ()
    where s.id = v_id
      and s.shop_id = p_shop_id
      and s.deleted_at is null;
  end if;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'owner',
    'staff_account_change',
    'Cloud staff account saved',
    jsonb_build_object ('staff_id', v_id, 'client_id', v_client_id)
  );

  return jsonb_build_object ('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.shop_pos_staff_upsert (uuid, jsonb) from public;
grant execute on function public.shop_pos_staff_upsert (uuid, jsonb) to authenticated;

create or replace function public.shop_pos_staff_set_active (
  p_shop_id uuid,
  p_staff_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_verified_email_for_cloud ();
  if not public.user_is_shop_owner (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  update public.shop_pos_staff s
  set is_active = p_active, updated_at = now ()
  where s.id = p_staff_id
    and s.shop_id = p_shop_id
    and s.deleted_at is null;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'owner',
    'staff_account_change',
    case when p_active then 'Staff enabled' else 'Staff disabled' end,
    jsonb_build_object ('staff_id', p_staff_id, 'is_active', p_active)
  );

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.shop_pos_staff_set_active (uuid, uuid, boolean) from public;
grant execute on function public.shop_pos_staff_set_active (uuid, uuid, boolean) to authenticated;

create or replace function public.shop_pos_staff_delete (p_shop_id uuid, p_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_verified_email_for_cloud ();
  if not public.user_is_shop_owner (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  update public.shop_pos_staff s
  set deleted_at = now (), is_active = false, updated_at = now ()
  where s.id = p_staff_id
    and s.shop_id = p_shop_id;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'owner',
    'staff_account_change',
    'Staff deleted',
    jsonb_build_object ('staff_id', p_staff_id)
  );

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.shop_pos_staff_delete (uuid, uuid) from public;
grant execute on function public.shop_pos_staff_delete (uuid, uuid) to authenticated;

-- Import local staff rows once (migration from device snapshot).
create or replace function public.shop_pos_staff_import_local (
  p_shop_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_imported int := 0;
begin
  perform public.require_verified_email_for_cloud ();
  if not public.user_is_shop_owner (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if p_rows is null or jsonb_typeof (p_rows) <> 'array' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_rows');
  end if;

  for r in select * from jsonb_array_elements (p_rows)
  loop
    if nullif (r ->> 'client_id', '') is null then
      continue;
    end if;
    if exists (
      select 1
      from public.shop_pos_staff s
      where s.shop_id = p_shop_id
        and s.client_id = (r ->> 'client_id')::uuid
    ) then
      continue;
    end if;
    perform public.shop_pos_staff_upsert (
      p_shop_id,
      r
    );
    v_imported := v_imported + 1;
  end loop;

  return jsonb_build_object ('ok', true, 'imported', v_imported);
end;
$$;

revoke all on function public.shop_pos_staff_import_local (uuid, jsonb) from public;
grant execute on function public.shop_pos_staff_import_local (uuid, jsonb) to authenticated;

-- ---------- C: Internal admin sensitive data gate ----------
alter table public.internal_admins
  add column if not exists can_view_sensitive_data boolean not null default false;

update public.internal_admins ia
set can_view_sensitive_data = true
where ia.role = 'super_admin'
  and ia.active;

create or replace function public.internal_can_view_sensitive_shop_data ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.internal_admins ia
    where ia.user_id = auth.uid ()
      and ia.active
      and ia.can_view_sensitive_data
  );
$$;

revoke all on function public.internal_can_view_sensitive_shop_data () from public;
grant execute on function public.internal_can_view_sensitive_shop_data () to authenticated;

drop policy if exists sales_select on public.sales;
create policy sales_select
  on public.sales for select
  using (
    public.user_can_access_shop (shop_id)
    or (
      public.is_waka_internal_staff ()
      and public.internal_can_view_sensitive_shop_data ()
    )
  );

drop policy if exists sale_lines_select on public.sale_line_items;
create policy sale_lines_select
  on public.sale_line_items for select
  using (
    exists (
      select 1
      from public.sales s
      where s.id = sale_line_items.sale_id
        and (
          public.user_can_access_shop (s.shop_id)
          or (
            public.is_waka_internal_staff ()
            and public.internal_can_view_sensitive_shop_data ()
          )
        )
    )
  );

drop policy if exists customers_select on public.customers;
create policy customers_select
  on public.customers for select
  using (
    public.user_can_access_shop (shop_id)
    or (
      public.is_waka_internal_staff ()
      and public.internal_can_view_sensitive_shop_data ()
    )
  );

drop policy if exists receipts_select on public.receipts;
create policy receipts_select
  on public.receipts for select
  using (
    public.user_can_access_shop (shop_id)
    or (
      public.is_waka_internal_staff ()
      and public.internal_can_view_sensitive_shop_data ()
    )
  );

-- Redact PII in internal shop detail unless sensitive access granted.
create or replace function public.internal_ops_shop_detail (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j jsonb;
  v_sensitive boolean;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  v_sensitive := public.internal_can_view_sensitive_shop_data ();

  select
    jsonb_build_object (
      'shop',
      to_jsonb (sh),
      'owner_label',
      coalesce(
        nullif (trim (pr.full_name), ''),
        nullif (trim (pr.business_name), ''),
        case when v_sensitive then nullif (lower (trim (pr.email)), '') else null end,
        own.user_id::text
      ),
      'owner_email',
      case when v_sensitive then lower (trim (pr.email)) else null end,
      'product_count',
      (
        select count(*)::int
        from public.products p
        where p.shop_id = p_shop_id and coalesce (p.is_active, true)
      ),
      'sales_count_30d',
      (
        select count(*)::int
        from public.sales s
        where s.shop_id = p_shop_id
          and s.status = 'completed'
          and s.created_at >= timezone ('Africa/Kampala', now ()) - interval '30 days'
      ),
      'sensitive_data_redacted',
      not v_sensitive
    )
  into j
  from public.shops sh
  left join lateral (
    select sm.user_id
    from public.shop_members sm
    where sm.shop_id = sh.id and sm.role = 'owner'
    order by sm.created_at asc
    limit 1
  ) own on true
  left join public.profiles pr on pr.id = own.user_id
  where sh.id = p_shop_id;

  return coalesce (j, jsonb_build_object ('error', 'shop_not_found'));
end;
$$;

-- ---------- Patch bootstrap: verified email + primary shop ----------
create or replace function public.bootstrap_owner_workspace (
  p_org_name text,
  p_business_type text default 'kiosk_duka',
  p_full_name text default null,
  p_email text default null,
  p_district_id uuid default null,
  p_phone_e164 text default null,
  p_address text default null,
  p_gps_missing boolean default true,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_shop_display_name text default null
)
returns table (
  organization_id uuid,
  shop_id uuid
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid ();
  v_org_id uuid;
  v_shop_id uuid;
  v_business_type text := coalesce (nullif (trim (p_business_type), ''), 'kiosk_duka');
  v_business_plan uuid;
  v_district_name text;
  v_shop_label text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  perform public.require_verified_email_for_cloud ();

  if v_business_type not in (
    'kiosk_duka','wholesale','mini_supermarket','hardware','restaurant','salon',
    'pharmacy','boutique','electronics','produce_market','mobile_money_agent','other'
  ) then
    v_business_type := 'kiosk_duka';
  end if;

  v_shop_label := coalesce (
    nullif (trim (p_shop_display_name), ''),
    nullif (trim (p_org_name), ''),
    'Main Shop'
  );

  insert into public.profiles (id, full_name, business_name, email, role, phone_e164)
  values (
    v_uid,
    nullif (trim (p_full_name), ''),
    nullif (trim (p_org_name), ''),
    nullif (lower (trim (p_email)), ''),
    'owner',
    case
      when trim (coalesce (p_phone_e164, '')) ~ '^\+256[0-9]{9}$' then trim (p_phone_e164)
      else null
    end
  )
  on conflict (id) do update
  set full_name = coalesce (nullif (trim (p_full_name), ''), public.profiles.full_name),
      business_name = coalesce (nullif (trim (p_org_name), ''), public.profiles.business_name),
      email = coalesce (nullif (lower (trim (p_email)), ''), public.profiles.email),
      phone_e164 = coalesce (
        case
          when trim (coalesce (p_phone_e164, '')) ~ '^\+256[0-9]{9}$' then trim (p_phone_e164)
          else null
        end,
        public.profiles.phone_e164
      ),
      role = 'owner',
      updated_at = now ();

  select om.organization_id
  into v_org_id
  from public.organization_members om
  where om.user_id = v_uid
  order by om.created_at asc
  limit 1;

  if v_org_id is null then
    insert into public.organizations (name, business_type, created_by)
    values (coalesce (nullif (trim (p_org_name), ''), 'My Shop'), v_business_type, v_uid)
    returning id into v_org_id;
  end if;

  insert into public.organization_members (organization_id, user_id, profile_id, role)
  values (v_org_id, v_uid, v_uid, 'owner')
  on conflict (organization_id, user_id) do update
  set role = 'owner',
      profile_id = coalesce (public.organization_members.profile_id, excluded.profile_id);

  if p_district_id is not null then
    select d.name into v_district_name from public.districts d where d.id = p_district_id limit 1;
  end if;

  select s.id
  into v_shop_id
  from public.shops s
  where s.organization_id = v_org_id
  order by s.created_at asc
  limit 1;

  if v_shop_id is null then
    insert into public.shops (
      organization_id,
      name,
      business_type,
      is_active,
      district_id,
      district,
      phone_e164,
      address_line,
      latitude,
      longitude,
      gps_missing,
      owner_user_id
    )
    values (
      v_org_id,
      v_shop_label,
      v_business_type,
      true,
      p_district_id,
      v_district_name,
      case
        when trim (coalesce (p_phone_e164, '')) ~ '^\+256[0-9]{9}$' then trim (p_phone_e164)
        else null
      end,
      nullif (trim (p_address), ''),
      p_latitude,
      p_longitude,
      coalesce (p_gps_missing, true)
        and (p_latitude is null or p_longitude is null),
      v_uid
    )
    returning id into v_shop_id;
  else
    update public.shops sh
    set owner_user_id = coalesce (sh.owner_user_id, v_uid)
    where sh.id = v_shop_id;
  end if;

  insert into public.shop_members (shop_id, user_id, role)
  values (v_shop_id, v_uid, 'owner')
  on conflict (shop_id, user_id) do update
  set role = 'owner';

  update public.profiles pr
  set primary_shop_id = coalesce (pr.primary_shop_id, v_shop_id), updated_at = now ()
  where pr.id = v_uid;

  select sp.id into v_business_plan
  from public.subscription_plans sp
  where sp.code = 'business' and sp.is_active
  limit 1;

  if v_business_plan is not null then
    if not exists (
      select 1 from public.subscriptions s where s.organization_id = v_org_id
    ) then
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
      values (
        v_org_id,
        v_shop_id,
        v_business_plan,
        'trial',
        'month',
        (timezone ('Africa/Kampala', now ())::date + interval '30 days')::timestamptz,
        now (),
        (timezone ('Africa/Kampala', now ())::date + interval '30 days')::timestamptz,
        'trial_auto'
      );
    end if;
  end if;

  return query select v_org_id, v_shop_id;
end;
$$;

create or replace function public.repair_owner_workspace (
  p_org_name text default 'My Shop',
  p_business_type text default 'kiosk_duka',
  p_full_name text default null,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_health jsonb;
  v_org uuid;
  v_shop uuid;
begin
  if auth.uid () is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  v_health := public.owner_workspace_health ();
  if coalesce ((v_health ->> 'ok')::boolean, false) then
    return jsonb_build_object ('ok', true, 'repaired', false, 'health', v_health);
  end if;

  if not public.auth_user_email_verified () then
    return jsonb_build_object (
      'ok',
      false,
      'error',
      'email_not_verified',
      'health',
      v_health
    );
  end if;

  select b.organization_id, b.shop_id
  into v_org, v_shop
  from public.bootstrap_owner_workspace (
    p_org_name,
    p_business_type,
    p_full_name,
    p_email,
    null,
    null,
    null,
    true,
    null,
    null,
    p_org_name
  ) b;

  v_health := public.owner_workspace_health ();

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    v_shop,
    auth.uid (),
    'owner',
    'workspace_repaired',
    'Owner workspace auto-repaired',
    jsonb_build_object ('health', v_health)
  );

  return jsonb_build_object (
    'ok',
    coalesce ((v_health ->> 'ok')::boolean, false),
    'repaired',
    true,
    'organization_id',
    v_org,
    'shop_id',
    v_shop,
    'health',
    v_health
  );
end;
$$;

revoke all on function public.repair_owner_workspace (text, text, text, text) from public;
grant execute on function public.repair_owner_workspace (text, text, text, text) to authenticated;

-- ---------- E: Device fingerprint change audit ----------
create or replace function public.shop_device_report_fingerprint_change (
  p_shop_id uuid,
  p_previous_fingerprint text,
  p_new_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if nullif (trim (p_previous_fingerprint), '') is null
    or nullif (trim (p_new_fingerprint), '') is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_fingerprint');
  end if;

  if trim (p_previous_fingerprint) = trim (p_new_fingerprint) then
    return jsonb_build_object ('ok', true, 'notified', false);
  end if;

  perform public.audit_shop_device_event (
    p_shop_id,
    'device_suspicious_fingerprint',
    'Device fingerprint changed on this browser',
    p_new_fingerprint,
    jsonb_build_object (
      'previous_fingerprint', trim (p_previous_fingerprint),
      'notify_owner', true
    )
  );

  update public.shop_devices d
  set suspicious_flag = true, updated_at = now ()
  where d.shop_id = p_shop_id
    and d.device_fingerprint = trim (p_new_fingerprint);

  return jsonb_build_object ('ok', true, 'notified', true);
end;
$$;

revoke all on function public.shop_device_report_fingerprint_change (uuid, text, text) from public;
grant execute on function public.shop_device_report_fingerprint_change (uuid, text, text) to authenticated;

-- Notify owner on brand-new device activation (insert path).
create or replace function public.shop_device_notify_new_activation (
  p_shop_id uuid,
  p_device_fingerprint text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.audit_shop_device_event (
    p_shop_id,
    'device_new_activation',
    'A new device was activated on this shop',
    p_device_fingerprint,
    jsonb_build_object ('notify_owner', true)
  );
end;
$$;

revoke all on function public.shop_device_notify_new_activation (uuid, text) from public;
grant execute on function public.shop_device_notify_new_activation (uuid, text) to authenticated;

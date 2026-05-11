-- Waka POS — RLS for internal ops tables, extend shop/subscription visibility for staff,
-- SECURITY DEFINER RPCs for sensitive admin actions (real enforcement beyond UI allowlists).

-- ---------- Helpers (SECURITY DEFINER; JWT via auth.uid()) ----------
create or replace function public.is_waka_internal_staff ()
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
      and ia.active = true
  );
$$;

create or replace function public.is_waka_internal_role (p_roles text[])
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
      and ia.active = true
      and ia.role = any (p_roles)
  );
$$;

revoke all on function public.is_waka_internal_staff () from public;
grant execute on function public.is_waka_internal_staff () to authenticated;

revoke all on function public.is_waka_internal_role (text[]) from public;
grant execute on function public.is_waka_internal_role (text[]) to authenticated;

-- ---------- Who am I (internal) — safe for client gate ----------
create or replace function public.waka_internal_me ()
returns table (
  id uuid,
  role text,
  assigned_district_ids uuid[],
  active boolean,
  max_shops int
)
language sql
stable
security definer
set search_path = public
as $$
  select ia.id, ia.role, ia.assigned_district_ids, ia.active, ia.max_shops
  from public.internal_admins ia
  where ia.user_id = auth.uid ()
    and ia.active = true;
$$;

revoke all on function public.waka_internal_me () from public;
grant execute on function public.waka_internal_me () to authenticated;

-- ---------- Extend existing policies: shops + subscriptions ----------
drop policy if exists shops_select on public.shops;
create policy shops_select
  on public.shops for select
  using (
    public.user_can_access_shop (id)
    or public.is_waka_internal_staff ()
  );

drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select
  on public.subscriptions for select
  using (
    public.user_has_org_role (organization_id, array['owner', 'admin', 'billing', 'staff'])
    or public.is_waka_internal_staff ()
  );

-- ---------- audit_logs (tighten; was previously without RLS) ----------
alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_shop_access on public.audit_logs;
create policy audit_logs_shop_access
  on public.audit_logs for select
  using (
    shop_id is not null
    and public.user_can_access_shop (shop_id)
  );

drop policy if exists audit_logs_internal_all on public.audit_logs;
create policy audit_logs_internal_all
  on public.audit_logs for select
  using (public.is_waka_internal_staff ());

drop policy if exists audit_logs_member_insert on public.audit_logs;
create policy audit_logs_member_insert
  on public.audit_logs for insert
  with check (
    actor_user_id = auth.uid ()
    and (
      shop_id is null
      or public.user_can_access_shop (shop_id)
    )
  );

-- ---------- districts ----------
alter table public.districts enable row level security;

drop policy if exists districts_authenticated_read on public.districts;
create policy districts_authenticated_read
  on public.districts for select
  to authenticated
  using (true);

-- ---------- internal_admins ----------
alter table public.internal_admins enable row level security;

drop policy if exists internal_admins_select on public.internal_admins;
create policy internal_admins_select
  on public.internal_admins for select
  using (
    user_id = auth.uid ()
    or public.is_waka_internal_role (array['super_admin']::text[])
  );

drop policy if exists internal_admins_super_insert on public.internal_admins;
create policy internal_admins_super_insert
  on public.internal_admins for insert
  with check (public.is_waka_internal_role (array['super_admin']::text[]));

drop policy if exists internal_admins_super_update on public.internal_admins;
create policy internal_admins_super_update
  on public.internal_admins for update
  using (public.is_waka_internal_role (array['super_admin']::text[]));

drop policy if exists internal_admins_super_delete on public.internal_admins;
create policy internal_admins_super_delete
  on public.internal_admins for delete
  using (public.is_waka_internal_role (array['super_admin']::text[]));

-- ---------- admin_assignments ----------
alter table public.admin_assignments enable row level security;

drop policy if exists admin_assignments_select on public.admin_assignments;
create policy admin_assignments_select
  on public.admin_assignments for select
  using (
    public.is_waka_internal_role (array['super_admin']::text[])
    or exists (
      select 1
      from public.internal_admins ia
      where ia.id = admin_assignments.internal_admin_id
        and ia.user_id = auth.uid ()
        and ia.active = true
    )
  );

drop policy if exists admin_assignments_super_write on public.admin_assignments;
create policy admin_assignments_super_write
  on public.admin_assignments for insert
  with check (public.is_waka_internal_role (array['super_admin']::text[]));

drop policy if exists admin_assignments_super_update on public.admin_assignments;
create policy admin_assignments_super_update
  on public.admin_assignments for update
  using (public.is_waka_internal_role (array['super_admin']::text[]));

drop policy if exists admin_assignments_super_delete on public.admin_assignments;
create policy admin_assignments_super_delete
  on public.admin_assignments for delete
  using (public.is_waka_internal_role (array['super_admin']::text[]));

-- ---------- shop_locations ----------
alter table public.shop_locations enable row level security;

drop policy if exists shop_locations_select on public.shop_locations;
create policy shop_locations_select
  on public.shop_locations for select
  using (
    public.user_can_manage_shop (shop_id)
    or public.is_waka_internal_staff ()
  );

drop policy if exists shop_locations_insert on public.shop_locations;
create policy shop_locations_insert
  on public.shop_locations for insert
  with check (
    public.user_can_manage_shop (shop_id)
    or public.is_waka_internal_staff ()
  );

-- ---------- support_requests ----------
alter table public.support_requests enable row level security;

drop policy if exists support_requests_shop_read on public.support_requests;
create policy support_requests_shop_read
  on public.support_requests for select
  using (
    shop_id is not null
    and public.user_can_access_shop (shop_id)
  );

drop policy if exists support_requests_internal_read on public.support_requests;
create policy support_requests_internal_read
  on public.support_requests for select
  using (public.is_waka_internal_staff ());

drop policy if exists support_requests_member_insert on public.support_requests;
create policy support_requests_member_insert
  on public.support_requests for insert
  with check (
    opened_by_user_id = auth.uid ()
    and shop_id is not null
    and public.user_can_access_shop (shop_id)
  );

drop policy if exists support_requests_internal_update on public.support_requests;
create policy support_requests_internal_update
  on public.support_requests for update
  using (
    public.is_waka_internal_role (
      array['super_admin', 'support_admin', 'finance_admin']::text[]
    )
  );

-- ---------- field_visits ----------
alter table public.field_visits enable row level security;

drop policy if exists field_visits_internal_all on public.field_visits;
create policy field_visits_internal_all
  on public.field_visits for all
  using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

-- ---------- SECURITY DEFINER RPCs (mutations; not granted to anon) ----------
create or replace function public.admin_extend_subscription_trial (
  p_subscription_id uuid,
  p_extra_days int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_role (array['super_admin', 'subscriptions_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  if p_extra_days is null or p_extra_days < 1 or p_extra_days > 366 then
    raise exception 'Invalid trial extension';
  end if;

  update public.subscriptions s
  set
    trial_ends_at = coalesce (s.trial_ends_at, timezone ('Africa/Kampala', now ())) + (p_extra_days::text || ' days')::interval,
    updated_at = now (),
    activation_source = coalesce (s.activation_source, 'manual_admin'),
    metadata = coalesce (s.metadata, '{}'::jsonb)
      || jsonb_build_object (
        'trial_extended_days', p_extra_days,
        'trial_extended_at', to_jsonb (timezone ('Africa/Kampala', now ())::text),
        'trial_extended_by', auth.uid ()::text
      )
  where s.id = p_subscription_id;

  if not found then
    raise exception 'Subscription not found';
  end if;

  insert into public.audit_logs (
    shop_id,
    actor_user_id,
    role,
    action,
    payload_summary,
    payload
  )
  values (
    null,
    auth.uid (),
    'internal',
    'admin_extend_subscription_trial',
    'Extended trial on subscription ' || p_subscription_id::text,
    jsonb_build_object ('subscription_id', p_subscription_id, 'extra_days', p_extra_days)
  );
end;
$$;

revoke all on function public.admin_extend_subscription_trial (uuid, int) from public;
grant execute on function public.admin_extend_subscription_trial (uuid, int) to authenticated;

create or replace function public.admin_set_shop_active (
  p_shop_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_role (array['super_admin', 'support_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  update public.shops sh
  set is_active = p_active,
      updated_at = now ()
  where sh.id = p_shop_id;

  if not found then
    raise exception 'Shop not found';
  end if;

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
    'admin_set_shop_active',
    format ('Shop %s set active=%s', p_shop_id::text, p_active::text),
    jsonb_build_object ('shop_id', p_shop_id, 'active', p_active)
  );
end;
$$;

revoke all on function public.admin_set_shop_active (uuid, boolean) from public;
grant execute on function public.admin_set_shop_active (uuid, boolean) to authenticated;

create or replace function public.field_visit_mark_completed (
  p_visit_id uuid,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent uuid;
  v_shop uuid;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select ia.id
  into v_agent
  from public.internal_admins ia
  where ia.user_id = auth.uid ()
    and ia.active = true
  limit 1;

  select fv.shop_id
  into v_shop
  from public.field_visits fv
  where fv.id = p_visit_id;

  if v_shop is null then
    raise exception 'Visit not found';
  end if;

  update public.field_visits fv
  set
    visit_status = 'completed',
    completed_at = timezone ('Africa/Kampala', now ()),
    notes = coalesce (nullif (trim (p_notes), ''), fv.notes),
    updated_at = now ()
  where fv.id = p_visit_id
    and (
      public.is_waka_internal_role (array['super_admin', 'support_admin']::text[])
      or fv.field_agent_internal_admin_id = v_agent
    );

  if not found then
    raise exception 'Visit not found or not assigned to you';
  end if;

  insert into public.audit_logs (
    shop_id,
    actor_user_id,
    role,
    action,
    payload_summary,
    payload
  )
  values (
    v_shop,
    auth.uid (),
    'internal',
    'field_visit_completed',
    'Field visit completed',
    jsonb_build_object ('visit_id', p_visit_id)
  );
end;
$$;

revoke all on function public.field_visit_mark_completed (uuid, text) from public;
grant execute on function public.field_visit_mark_completed (uuid, text) to authenticated;

create or replace function public.field_visit_create_planned (
  p_shop_id uuid,
  p_scheduled_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent uuid;
  v_id uuid;
begin
  if not public.is_waka_internal_role (array['super_admin', 'field_agent', 'support_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  select ia.id
  into v_agent
  from public.internal_admins ia
  where ia.user_id = auth.uid ()
    and ia.active = true
  limit 1;

  insert into public.field_visits (
    shop_id,
    field_agent_internal_admin_id,
    visit_status,
    scheduled_at
  )
  values (
    p_shop_id,
    v_agent,
    'planned',
    p_scheduled_at
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.field_visit_create_planned (uuid, timestamptz) from public;
grant execute on function public.field_visit_create_planned (uuid, timestamptz) to authenticated;

create or replace function public.shop_record_last_seen (p_shop_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  update public.shops sh
  set last_seen_at = timezone ('Africa/Kampala', now ())
  where sh.id = p_shop_id;
end;
$$;

revoke all on function public.shop_record_last_seen (uuid) from public;
grant execute on function public.shop_record_last_seen (uuid) to authenticated;

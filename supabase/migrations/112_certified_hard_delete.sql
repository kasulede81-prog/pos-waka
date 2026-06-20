-- Certified hard delete: purge support/audit refs, collect all org auth users, post-delete verification.

create or replace function public.hard_delete_collect_org_user_ids (p_org_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array_agg(distinct u.user_id),
    '{}'::uuid[]
  )
  from (
    select om.user_id
    from public.organization_members om
    where om.organization_id = p_org_id
    union
    select sm.user_id
    from public.shop_members sm
    join public.shops sh on sh.id = sm.shop_id
    where sh.organization_id = p_org_id
    union
    select sh.owner_user_id
    from public.shops sh
    where sh.organization_id = p_org_id
      and sh.owner_user_id is not null
  ) u
  where u.user_id is not null
    and not exists (
      select 1
      from public.internal_admins ia
      where (ia.auth_user_id = u.user_id or ia.user_id = u.user_id)
        and coalesce (ia.is_active, ia.active, true) = true
    );
$$;

revoke all on function public.hard_delete_collect_org_user_ids (uuid) from public;

create or replace function public.hard_delete_collect_org_shop_ids (p_org_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(sh.id), '{}'::uuid[])
  from public.shops sh
  where sh.organization_id = p_org_id;
$$;

revoke all on function public.hard_delete_collect_org_shop_ids (uuid) from public;

create or replace function public.hard_delete_verification_report (
  p_org_id uuid,
  p_shop_ids uuid[],
  p_owner_user_id uuid default null,
  p_staff_user_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_counts jsonb;
  v_orgs int := 0;
  v_shops int := 0;
  v_products int := 0;
  v_sales int := 0;
  v_customers int := 0;
  v_suppliers int := 0;
  v_purchases int := 0;
  v_shifts int := 0;
  v_inventory_counts int := 0;
  v_stock_movements int := 0;
  v_cloud_snapshots int := 0;
  v_devices int := 0;
  v_subscriptions int := 0;
  v_audit_logs int := 0;
  v_support_requests int := 0;
  v_owner_auth int := 0;
  v_staff_auth int := 0;
  v_staff_only uuid[];
  v_all_passed boolean := true;
begin
  if p_org_id is not null then
    select count(*)::int into v_orgs from public.organizations o where o.id = p_org_id;
    select count(*)::int into v_shops from public.shops sh where sh.organization_id = p_org_id;
    select count(*)::int into v_subscriptions from public.subscriptions s where s.organization_id = p_org_id;
    select count(*)::int
    into v_support_requests
    from public.support_requests sr
    where sr.organization_id = p_org_id
       or (cardinality(p_shop_ids) > 0 and sr.shop_id = any (p_shop_ids));
  end if;

  if cardinality(p_shop_ids) > 0 then
    select count(*)::int into v_products from public.products p where p.shop_id = any (p_shop_ids);
    select count(*)::int into v_sales from public.sales s where s.shop_id = any (p_shop_ids);
    select count(*)::int into v_customers from public.customers c where c.shop_id = any (p_shop_ids);
    select count(*)::int into v_suppliers from public.shop_suppliers ss where ss.shop_id = any (p_shop_ids);
    select count(*)::int into v_purchases from public.shop_purchases sp where sp.shop_id = any (p_shop_ids);
    select count(*)::int into v_shifts from public.shop_shifts shf where shf.shop_id = any (p_shop_ids);
    select count(*)::int
    into v_inventory_counts
    from public.shop_inventory_count_sessions ic
    where ic.shop_id = any (p_shop_ids);
    select count(*)::int
    into v_stock_movements
    from public.shop_stock_movements sm
    where sm.shop_id = any (p_shop_ids);
    select count(*)::int into v_cloud_snapshots from public.shop_cloud_snapshots scs where scs.shop_id = any (p_shop_ids);
    select count(*)::int into v_devices from public.shop_devices d where d.shop_id = any (p_shop_ids);
    select count(*)::int into v_audit_logs from public.audit_logs al where al.shop_id = any (p_shop_ids);
  end if;

  v_staff_only := array(
    select uid
    from unnest(coalesce(p_staff_user_ids, '{}'::uuid[])) uid
    where uid is distinct from p_owner_user_id
  );

  if p_owner_user_id is not null then
    select count(*)::int into v_owner_auth from auth.users u where u.id = p_owner_user_id;
  end if;

  if cardinality(v_staff_only) > 0 then
    select count(*)::int into v_staff_auth from auth.users u where u.id = any (v_staff_only);
  end if;

  v_counts := jsonb_build_object(
    'organizations', v_orgs,
    'shops', v_shops,
    'products', v_products,
    'sales', v_sales,
    'customers', v_customers,
    'suppliers', v_suppliers,
    'purchases', v_purchases,
    'shifts', v_shifts,
    'inventory_counts', v_inventory_counts,
    'stock_movements', v_stock_movements,
    'cloud_snapshots', v_cloud_snapshots,
    'devices', v_devices,
    'subscriptions', v_subscriptions,
    'audit_logs', v_audit_logs,
    'support_requests', v_support_requests,
    'owner_auth_account', v_owner_auth,
    'staff_auth_accounts', v_staff_auth
  );

  select bool_and((value)::int = 0)
  into v_all_passed
  from jsonb_each_text(v_counts);

  return jsonb_build_object(
    'all_passed', coalesce(v_all_passed, true),
    'counts', v_counts,
    'checked_at', now()
  );
end;
$$;

revoke all on function public.hard_delete_verification_report (uuid, uuid[], uuid, uuid[]) from public;

create or replace function public.certified_hard_delete_organization_execute (
  p_org_id uuid,
  p_primary_shop_id uuid,
  p_owner_user_id uuid,
  p_actor_user_id uuid,
  p_actor_role text,
  p_audit_action text default 'certified_hard_delete_executed'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop_ids uuid[];
  v_user_ids uuid[];
  v_staff_user_ids uuid[];
  v_owner_email text;
  v_agents_removed int := 0;
  v_referrals_removed int := 0;
  v_sales_deleted int := 0;
  v_numbers_released int := 0;
  v_devices_deactivated int := 0;
  v_audit_logs_removed int := 0;
  v_support_removed int := 0;
  v_profiles_removed int := 0;
  v_verification jsonb;
begin
  if p_org_id is null then
    return jsonb_build_object ('ok', false, 'error', 'organization_required');
  end if;

  v_shop_ids := public.hard_delete_collect_org_shop_ids (p_org_id);
  v_user_ids := public.hard_delete_collect_org_user_ids (p_org_id);

  if p_owner_user_id is not null and not (p_owner_user_id = any (v_user_ids)) then
    v_user_ids := array_append(v_user_ids, p_owner_user_id);
  end if;

  v_staff_user_ids := array(
    select uid
    from unnest(v_user_ids) uid
    where uid is distinct from p_owner_user_id
  );

  select lower (trim (coalesce (pr.email, u.email, '')))
  into v_owner_email
  from auth.users u
  left join public.profiles pr on pr.id = u.id
  where u.id = p_owner_user_id;

  if p_primary_shop_id is not null then
    insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
    values (
      p_primary_shop_id,
      p_actor_user_id,
      coalesce (nullif (trim (p_actor_role), ''), 'system'),
      p_audit_action,
      'Certified hard delete started',
      jsonb_build_object (
        'organization_id', p_org_id,
        'owner_user_id', p_owner_user_id,
        'shop_ids', to_jsonb (v_shop_ids),
        'user_ids', to_jsonb (v_user_ids)
      )
    );
  end if;

  update public.shop_devices d
  set
    status = 'revoked'::public.shop_device_status,
    updated_at = now ()
  where d.shop_id = any (v_shop_ids);
  get diagnostics v_devices_deactivated = row_count;

  delete from public.support_requests sr
  where sr.organization_id = p_org_id
     or (cardinality(v_shop_ids) > 0 and sr.shop_id = any (v_shop_ids));
  get diagnostics v_support_removed = row_count;

  if cardinality(v_shop_ids) > 0 then
    delete from public.audit_logs al
    where al.shop_id = any (v_shop_ids);
    get diagnostics v_audit_logs_removed = row_count;
  end if;

  insert into public.waka_shop_number_released (shop_number)
  select distinct upper (trim (sh.shop_number))
  from public.shops sh
  where sh.organization_id = p_org_id
    and sh.shop_number is not null
    and trim (sh.shop_number) <> ''
    and upper (trim (sh.shop_number)) ~ '^A[0-9]+$'
  on conflict (shop_number) do nothing;
  get diagnostics v_numbers_released = row_count;

  delete from public.agent_referrals ar
  where ar.organization_id = p_org_id
     or ar.referred_user_id = any (v_user_ids)
     or (cardinality(v_shop_ids) > 0 and ar.referred_shop_id = any (v_shop_ids));
  get diagnostics v_referrals_removed = row_count;

  delete from public.marketing_agents ma
  where ma.user_id = any (v_user_ids)
     or (
       v_owner_email is not null
       and v_owner_email <> ''
       and ma.email is not null
       and lower (trim (ma.email)) = v_owner_email
     );
  get diagnostics v_agents_removed = row_count;

  if cardinality(v_user_ids) > 0 then
    delete from public.profiles pr
    where pr.id = any (v_user_ids);
    get diagnostics v_profiles_removed = row_count;
  end if;

  if cardinality(v_shop_ids) > 0 then
    delete from public.sales s
    where s.shop_id = any (v_shop_ids);
    get diagnostics v_sales_deleted = row_count;
  end if;

  delete from public.organizations o
  where o.id = p_org_id;

  v_verification := public.hard_delete_verification_report (
    p_org_id,
    v_shop_ids,
    p_owner_user_id,
    v_staff_user_ids
  );

  if coalesce((v_verification ->> 'all_passed')::boolean, false) is not true then
    return jsonb_build_object (
      'ok',
      false,
      'error',
      'verification_failed',
      'detail',
      'Post-delete verification found remaining rows.',
      'verification',
      v_verification,
      'user_ids',
      to_jsonb (v_user_ids),
      'owner_user_id',
      p_owner_user_id,
      'shop_ids',
      to_jsonb (v_shop_ids),
      'sales_deleted',
      v_sales_deleted,
      'audit_logs_removed',
      v_audit_logs_removed,
      'support_requests_removed',
      v_support_removed
    );
  end if;

  return jsonb_build_object (
    'ok',
    true,
    'organization_id',
    p_org_id,
    'owner_user_id',
    p_owner_user_id,
    'user_ids',
    to_jsonb (v_user_ids),
    'staff_user_ids',
    to_jsonb (v_staff_user_ids),
    'shop_ids',
    to_jsonb (v_shop_ids),
    'sales_deleted',
    v_sales_deleted,
    'agents_removed',
    v_agents_removed,
    'referrals_removed',
    v_referrals_removed,
    'shop_numbers_released',
    v_numbers_released,
    'devices_deactivated',
    v_devices_deactivated,
    'audit_logs_removed',
    v_audit_logs_removed,
    'support_requests_removed',
    v_support_removed,
    'profiles_removed',
    v_profiles_removed,
    'verification',
    v_verification
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'delete_failed', 'detail', sqlerrm);
end;
$$;

revoke all on function public.certified_hard_delete_organization_execute (uuid, uuid, uuid, uuid, text, text) from public;

create or replace function public.owner_permanently_delete_own_account (
  p_confirmation text,
  p_phase text default 'execute'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := auth.uid ();
  v_shop_id uuid;
  v_org_id uuid;
  v_shop_name text;
  v_user_ids uuid[];
  v_confirm text := upper (trim (coalesce (p_confirmation, '')));
  v_phase text := lower (trim (coalesce (p_phase, 'execute')));
begin
  if v_owner_id is null then
    return jsonb_build_object ('ok', false, 'error', 'unauthorized');
  end if;

  select sh.id, sh.organization_id, sh.name
  into v_shop_id, v_org_id, v_shop_name
  from public.shop_members sm
  join public.shops sh on sh.id = sm.shop_id
  where sm.user_id = v_owner_id
    and sm.role = 'owner'
  order by sm.created_at asc
  limit 1;

  if v_shop_id is null then
    select pr.primary_shop_id into v_shop_id
    from public.profiles pr
    where pr.id = v_owner_id;
  end if;

  if v_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  if not public.user_is_shop_owner (v_shop_id) then
    return jsonb_build_object (
      'ok',
      false,
      'error',
      'forbidden',
      'detail',
      'Only the shop owner can permanently delete this account.'
    );
  end if;

  select sh.organization_id, sh.name
  into v_org_id, v_shop_name
  from public.shops sh
  where sh.id = v_shop_id;

  if v_org_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  if exists (
    select 1
    from public.internal_admins ia
    where (ia.auth_user_id = v_owner_id or ia.user_id = v_owner_id)
      and coalesce (ia.is_active, ia.active, true) = true
  ) then
    return jsonb_build_object (
      'ok',
      false,
      'error',
      'cannot_delete_internal_admin',
      'detail',
      'Waka internal admin accounts must be removed by platform staff.'
    );
  end if;

  if v_confirm <> 'DELETE PERMANENTLY' and v_confirm <> upper (trim (v_shop_name)) then
    return jsonb_build_object (
      'ok',
      false,
      'error',
      'confirmation_required',
      'detail',
      'Type DELETE PERMANENTLY or the exact shop name to confirm.'
    );
  end if;

  v_user_ids := public.hard_delete_collect_org_user_ids (v_org_id);
  if not (v_owner_id = any (v_user_ids)) then
    v_user_ids := array_append(v_user_ids, v_owner_id);
  end if;

  if v_phase = 'prepare' then
    return jsonb_build_object (
      'ok',
      true,
      'phase',
      'prepare',
      'owner_user_id',
      v_owner_id,
      'organization_id',
      v_org_id,
      'shop_id',
      v_shop_id,
      'shop_name',
      v_shop_name,
      'user_ids',
      to_jsonb (v_user_ids),
      'shop_ids',
      to_jsonb (public.hard_delete_collect_org_shop_ids (v_org_id))
    );
  end if;

  return public.certified_hard_delete_organization_execute (
    v_org_id,
    v_shop_id,
    v_owner_id,
    v_owner_id,
    'owner',
    'owner_permanent_delete_executed'
  ) || jsonb_build_object ('shop_id', v_shop_id, 'shop_name', v_shop_name);
end;
$$;

revoke all on function public.owner_permanently_delete_own_account (text, text) from public;
grant execute on function public.owner_permanently_delete_own_account (text, text) to authenticated;

create or replace function public.admin_permanently_delete_shop_account (
  p_shop_id uuid,
  p_confirmation text,
  p_phase text default 'execute'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_owner_id uuid;
  v_shop_name text;
  v_user_ids uuid[];
  v_confirm text := upper (trim (coalesce (p_confirmation, '')));
  v_phase text := lower (trim (coalesce (p_phase, 'execute')));
begin
  if not public.is_waka_internal_role (array['super_admin']::text[]) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden', 'detail', 'Super admin only.');
  end if;

  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_id_required');
  end if;

  select sh.organization_id, sh.name
  into v_org_id, v_shop_name
  from public.shops sh
  where sh.id = p_shop_id;

  if v_org_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  if v_confirm <> 'DELETE PERMANENTLY' and v_confirm <> upper (trim (v_shop_name)) then
    return jsonb_build_object (
      'ok',
      false,
      'error',
      'confirmation_required',
      'detail',
      'Type DELETE PERMANENTLY or the exact shop name to confirm.'
    );
  end if;

  select sm.user_id
  into v_owner_id
  from public.shop_members sm
  where sm.shop_id = p_shop_id
    and sm.role = 'owner'
  order by sm.created_at asc
  limit 1;

  if v_owner_id is null then
    select sm.user_id
    into v_owner_id
    from public.shop_members sm
    where sm.shop_id = p_shop_id
    order by sm.created_at asc
    limit 1;
  end if;

  if v_owner_id is null then
    return jsonb_build_object ('ok', false, 'error', 'owner_not_found');
  end if;

  if v_owner_id = auth.uid () then
    return jsonb_build_object ('ok', false, 'error', 'cannot_delete_self');
  end if;

  if exists (
    select 1
    from public.internal_admins ia
    where (ia.auth_user_id = v_owner_id or ia.user_id = v_owner_id)
      and coalesce (ia.is_active, ia.active, true) = true
  ) then
    return jsonb_build_object ('ok', false, 'error', 'cannot_delete_internal_admin');
  end if;

  v_user_ids := public.hard_delete_collect_org_user_ids (v_org_id);
  if not (v_owner_id = any (v_user_ids)) then
    v_user_ids := array_append(v_user_ids, v_owner_id);
  end if;

  if v_phase = 'prepare' then
    return jsonb_build_object (
      'ok',
      true,
      'phase',
      'prepare',
      'owner_user_id',
      v_owner_id,
      'organization_id',
      v_org_id,
      'shop_id',
      p_shop_id,
      'shop_name',
      v_shop_name,
      'user_ids',
      to_jsonb (v_user_ids),
      'shop_ids',
      to_jsonb (public.hard_delete_collect_org_shop_ids (v_org_id))
    );
  end if;

  return public.certified_hard_delete_organization_execute (
    v_org_id,
    p_shop_id,
    v_owner_id,
    auth.uid (),
    'internal',
    'admin_permanent_delete_executed'
  ) || jsonb_build_object ('shop_id', p_shop_id, 'shop_name', v_shop_name);
end;
$$;

revoke all on function public.admin_permanently_delete_shop_account (uuid, text, text) from public;
grant execute on function public.admin_permanently_delete_shop_account (uuid, text, text) to authenticated;

-- Service-only auth verification merge (called from edge after auth.admin.deleteUser).
create or replace function public.hard_delete_merge_auth_verification (
  p_org_id uuid,
  p_shop_ids uuid[],
  p_owner_user_id uuid,
  p_staff_user_ids uuid[],
  p_owner_auth_remaining int,
  p_staff_auth_remaining int
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_db jsonb;
  v_counts jsonb;
  v_all_passed boolean;
begin
  v_db := public.hard_delete_verification_report (
    p_org_id,
    p_shop_ids,
    p_owner_user_id,
    coalesce (p_staff_user_ids, '{}'::uuid[])
  );

  v_counts := (v_db -> 'counts') || jsonb_build_object(
    'owner_auth_account', greatest (0, coalesce (p_owner_auth_remaining, 0)),
    'staff_auth_accounts', greatest (0, coalesce (p_staff_auth_remaining, 0))
  );

  select bool_and((value)::int = 0)
  into v_all_passed
  from jsonb_each_text(v_counts);

  return jsonb_build_object(
    'all_passed', coalesce(v_all_passed, false),
    'counts', v_counts,
    'db_verification', v_db,
    'checked_at', now()
  );
end;
$$;

revoke all on function public.hard_delete_merge_auth_verification (uuid, uuid[], uuid, uuid[], int, int) from public;
grant execute on function public.hard_delete_merge_auth_verification (uuid, uuid[], uuid, uuid[], int, int) to authenticated;

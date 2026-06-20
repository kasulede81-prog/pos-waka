-- Owner self-delete hardening: health probe, device lockout, owner-safe audit, orphan detection.

create or replace function public.owner_self_delete_health_probe ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return jsonb_build_object (
    'ok',
    true,
    'rpc',
    'owner_permanently_delete_own_account',
    'migration',
    '111_owner_self_delete_hardening'
  );
end;
$$;

revoke all on function public.owner_self_delete_health_probe () from public;
grant execute on function public.owner_self_delete_health_probe () to authenticated;

create or replace function public.owner_self_delete_auth_audit (
  p_owner_user_id uuid,
  p_shop_id uuid,
  p_action text,
  p_ok boolean,
  p_detail text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid () is null or auth.uid () <> p_owner_user_id then
    raise exception 'Forbidden';
  end if;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    p_owner_user_id,
    'owner',
    coalesce (nullif (trim (p_action), ''), 'owner_self_delete_auth_audit'),
    coalesce (p_detail, case when p_ok then 'Auth user deleted' else 'Auth user delete failed' end),
    jsonb_build_object ('owner_user_id', p_owner_user_id, 'ok', p_ok, 'detail', p_detail)
  );
end;
$$;

revoke all on function public.owner_self_delete_auth_audit (uuid, uuid, text, boolean, text) from public;
grant execute on function public.owner_self_delete_auth_audit (uuid, uuid, text, boolean, text) to authenticated;

create or replace function public.owner_self_delete_orphan_auth_status ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_has_org boolean := false;
  v_has_owner_shop boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'unauthorized');
  end if;

  select exists (
    select 1
    from public.organization_members om
    where om.user_id = v_uid
  )
  into v_has_org;

  select exists (
    select 1
    from public.shop_members sm
    where sm.user_id = v_uid
      and sm.role = 'owner'
  )
  into v_has_owner_shop;

  return jsonb_build_object (
    'ok',
    true,
    'orphan_auth',
    not v_has_org and not v_has_owner_shop,
    'has_organization',
    v_has_org,
    'has_owner_shop',
    v_has_owner_shop
  );
end;
$$;

revoke all on function public.owner_self_delete_orphan_auth_status () from public;
grant execute on function public.owner_self_delete_orphan_auth_status () to authenticated;

create or replace function public.owner_permanently_delete_own_account (
  p_confirmation text
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
  v_owner_email text;
  v_agents_removed int := 0;
  v_referrals_removed int := 0;
  v_sales_deleted int := 0;
  v_numbers_released int := 0;
  v_devices_deactivated int := 0;
  v_confirm text := upper (trim (coalesce (p_confirmation, '')));
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

  select lower (trim (coalesce (pr.email, u.email, '')))
  into v_owner_email
  from auth.users u
  left join public.profiles pr on pr.id = u.id
  where u.id = v_owner_id;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    v_shop_id,
    v_owner_id,
    'owner',
    'owner_permanent_delete_started',
    'Owner requested permanent account deletion',
    jsonb_build_object (
      'shop_id',
      v_shop_id,
      'organization_id',
      v_org_id,
      'owner_user_id',
      v_owner_id,
      'shop_name',
      v_shop_name
    )
  );

  update public.shop_devices d
  set
    is_active = false,
    status = 'revoked',
    updated_at = now ()
  where d.shop_id in (
    select sh.id from public.shops sh where sh.organization_id = v_org_id
  )
    and coalesce (d.is_active, true) = true;
  get diagnostics v_devices_deactivated = row_count;

  insert into public.waka_shop_number_released (shop_number)
  select distinct upper (trim (sh.shop_number))
  from public.shops sh
  where sh.organization_id = v_org_id
    and sh.shop_number is not null
    and trim (sh.shop_number) <> ''
    and upper (trim (sh.shop_number)) ~ '^A[0-9]+$'
  on conflict (shop_number) do nothing;
  get diagnostics v_numbers_released = row_count;

  delete from public.agent_referrals ar
  where ar.referred_user_id = v_owner_id
     or ar.referred_shop_id = v_shop_id
     or ar.organization_id = v_org_id;
  get diagnostics v_referrals_removed = row_count;

  delete from public.marketing_agents ma
  where ma.user_id = v_owner_id
     or (
       v_owner_email is not null
       and v_owner_email <> ''
       and ma.email is not null
       and lower (trim (ma.email)) = v_owner_email
     );
  get diagnostics v_agents_removed = row_count;

  delete from public.profiles pr
  where pr.id = v_owner_id;

  delete from public.sales s
  where s.shop_id in (
    select sh.id from public.shops sh where sh.organization_id = v_org_id
  );
  get diagnostics v_sales_deleted = row_count;

  delete from public.organizations o
  where o.id = v_org_id;

  return jsonb_build_object (
    'ok',
    true,
    'owner_user_id',
    v_owner_id,
    'shop_id',
    v_shop_id,
    'organization_id',
    v_org_id,
    'shop_name',
    v_shop_name,
    'sales_deleted',
    v_sales_deleted,
    'agents_removed',
    v_agents_removed,
    'referrals_removed',
    v_referrals_removed,
    'shop_numbers_released',
    v_numbers_released,
    'devices_deactivated',
    v_devices_deactivated
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'delete_failed', 'detail', sqlerrm);
end;
$$;

revoke all on function public.owner_permanently_delete_own_account (text) from public;
grant execute on function public.owner_permanently_delete_own_account (text) to authenticated;

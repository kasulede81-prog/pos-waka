-- Permanent removal of a shop owner's cloud account and organization data (super_admin only).
-- Auth user is removed by edge function admin-permanently-delete-shop-account after this RPC.

create or replace function public.admin_permanently_delete_shop_account (
  p_shop_id uuid,
  p_confirmation text
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
  v_sales_deleted int := 0;
  v_confirm text := upper (trim (coalesce (p_confirmation, '')));
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

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'internal',
    'admin_permanent_delete_shop_started',
    'Permanent delete shop account started',
    jsonb_build_object (
      'shop_id',
      p_shop_id,
      'organization_id',
      v_org_id,
      'owner_user_id',
      v_owner_id,
      'shop_name',
      v_shop_name
    )
  );

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
    'organization_id',
    v_org_id,
    'shop_name',
    v_shop_name,
    'sales_deleted',
    v_sales_deleted
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'delete_failed', 'detail', sqlerrm);
end;
$$;

revoke all on function public.admin_permanently_delete_shop_account (uuid, text) from public;
grant execute on function public.admin_permanently_delete_shop_account (uuid, text) to authenticated;

create or replace function public.admin_permanent_delete_auth_user_audit (
  p_owner_user_id uuid,
  p_shop_id uuid,
  p_ok boolean,
  p_detail text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_role (array['super_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'internal',
    case when p_ok then 'admin_permanent_delete_auth_user_ok' else 'admin_permanent_delete_auth_user_failed' end,
    coalesce (p_detail, case when p_ok then 'Auth user deleted' else 'Auth user delete failed' end),
    jsonb_build_object ('owner_user_id', p_owner_user_id, 'ok', p_ok)
  );
end;
$$;

revoke all on function public.admin_permanent_delete_auth_user_audit (uuid, uuid, boolean, text) from public;
grant execute on function public.admin_permanent_delete_auth_user_audit (uuid, uuid, boolean, text) to authenticated;

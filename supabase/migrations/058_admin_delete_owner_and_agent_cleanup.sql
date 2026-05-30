-- Fix incomplete permanent delete: remove marketing_agents, referrals, profile before org;
-- allow staff to remove marketing agents from the panel.

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
  v_owner_email text;
  v_agents_removed int := 0;
  v_referrals_removed int := 0;
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

  select lower (trim (coalesce (pr.email, u.email, '')))
  into v_owner_email
  from auth.users u
  left join public.profiles pr on pr.id = u.id
  where u.id = v_owner_id;

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

  delete from public.agent_referrals ar
  where ar.referred_user_id = v_owner_id
     or ar.referred_shop_id = p_shop_id
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
    'organization_id',
    v_org_id,
    'shop_name',
    v_shop_name,
    'sales_deleted',
    v_sales_deleted,
    'agents_removed',
    v_agents_removed,
    'referrals_removed',
    v_referrals_removed
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'delete_failed', 'detail', sqlerrm);
end;
$$;

create or replace function public.internal_delete_marketing_agent (
  p_agent_id uuid,
  p_delete_login boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.marketing_agents%rowtype;
begin
  if not public.is_waka_internal_role (array['super_admin', 'admin']::text[]) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  if p_agent_id is null then
    return jsonb_build_object ('ok', false, 'error', 'agent_required');
  end if;

  select * into v_row
  from public.marketing_agents ma
  where ma.id = p_agent_id;

  if v_row.id is null then
    return jsonb_build_object ('ok', false, 'error', 'agent_not_found');
  end if;

  delete from public.marketing_agents ma
  where ma.id = p_agent_id;

  return jsonb_build_object (
    'ok',
    true,
    'user_id',
    v_row.user_id,
    'delete_login',
    coalesce (p_delete_login, false),
    'referral_code',
    v_row.referral_code
  );
end;
$$;

revoke all on function public.internal_delete_marketing_agent (uuid, boolean) from public;
grant execute on function public.internal_delete_marketing_agent (uuid, boolean) to authenticated;

create or replace function public.internal_list_marketing_agents ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  return coalesce (
    (
      select jsonb_agg (
        jsonb_build_object (
          'id', ma.id,
          'referral_code', ma.referral_code,
          'full_name', ma.full_name,
          'email', ma.email,
          'phone_e164', ma.phone_e164,
          'active', ma.active,
          'roles', ma.roles,
          'referral_count', (select count(*)::int from public.agent_referrals ar where ar.agent_id = ma.id),
          'created_at', ma.created_at,
          'shop_id', own.shop_id,
          'shop_name', own.shop_name,
          'user_id', ma.user_id
        )
        order by ma.created_at desc
      )
      from public.marketing_agents ma
      left join lateral (
        select s.id as shop_id, s.name as shop_name
        from public.shop_members sm
        join public.shops s on s.id = sm.shop_id
        where sm.user_id = ma.user_id
        order by (case when sm.role = 'owner' then 0 else 1 end), sm.created_at asc
        limit 1
      ) own on true
      where ma.active = true
    ),
    '[]'::jsonb
  );
end;
$$;

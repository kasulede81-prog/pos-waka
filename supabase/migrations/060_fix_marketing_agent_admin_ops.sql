-- Fix marketing agent admin ops: any internal staff can remove agents; reactivate inactive rows on grant.
-- Safe to run after 057; adds roles column if missing.

alter table public.marketing_agents
  add column if not exists roles text[] not null default array['field_agent']::text[];

create or replace function public._normalize_agent_roles (p_roles text[])
returns text[]
language sql
immutable
as $$
  select coalesce (
    (
      select array_agg(distinct r order by r)
      from (
        select unnest (coalesce (p_roles, array[]::text[])) as r
      ) x
      where r in ('trial_agent', 'vip_agent', 'field_agent')
    ),
    array['field_agent']::text[]
  );
$$;

create or replace function public.internal_set_marketing_agent_roles (
  p_agent_id uuid,
  p_roles text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roles text[] := public._normalize_agent_roles (p_roles);
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  if p_agent_id is null then
    return jsonb_build_object ('ok', false, 'error', 'agent_required');
  end if;

  update public.marketing_agents ma
  set roles = v_roles, active = true, updated_at = now ()
  where ma.id = p_agent_id;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'agent_not_found');
  end if;

  return jsonb_build_object ('ok', true, 'roles', to_jsonb (v_roles));
end;
$$;

revoke all on function public.internal_set_marketing_agent_roles (uuid, text[]) from public;
grant execute on function public.internal_set_marketing_agent_roles (uuid, text[]) to authenticated;

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
  if not public.is_waka_internal_staff () then
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

  delete from public.agent_referrals ar
  where ar.agent_id = p_agent_id;

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

create or replace function public.internal_grant_marketing_agent_by_shop (
  p_shop_id uuid,
  p_roles text[] default array['trial_agent', 'field_agent']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_code text;
  v_id uuid;
  v_email text;
  v_name text;
  v_phone text;
  v_shop_name text;
  v_roles text[] := public._normalize_agent_roles (p_roles);
  v_try int := 0;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_required');
  end if;

  select s.name into v_shop_name from public.shops s where s.id = p_shop_id;
  if v_shop_name is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  select sm.user_id into v_uid
  from public.shop_members sm
  where sm.shop_id = p_shop_id
  order by (case when sm.role = 'owner' then 0 else 1 end), sm.created_at asc
  limit 1;

  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'no_owner');
  end if;

  select lower (trim (u.email)) into v_email from auth.users u where u.id = v_uid;
  select nullif (trim (pr.full_name), ''), nullif (trim (pr.phone_e164), '')
  into v_name, v_phone
  from public.profiles pr
  where pr.id = v_uid;

  select ma.id, ma.referral_code into v_id, v_code
  from public.marketing_agents ma
  where ma.user_id = v_uid
  order by ma.active desc, ma.created_at desc
  limit 1;

  if v_id is not null then
    update public.marketing_agents ma
    set
      roles = v_roles,
      active = true,
      email = coalesce (v_email, ma.email),
      full_name = coalesce (v_name, ma.full_name),
      phone_e164 = coalesce (v_phone, ma.phone_e164),
      updated_at = now ()
    where ma.id = v_id;

    return jsonb_build_object (
      'ok', true,
      'id', v_id,
      'referral_code', v_code,
      'already_agent', true,
      'shop_name', v_shop_name,
      'roles', to_jsonb (v_roles)
    );
  end if;

  loop
    v_try := v_try + 1;
    v_code := 'WAKA-' || upper (substr (replace (gen_random_uuid()::text, '-', ''), 1, 4));
    exit when not exists (select 1 from public.marketing_agents ma where ma.referral_code = v_code);
    if v_try > 12 then
      return jsonb_build_object ('ok', false, 'error', 'code_generation_failed');
    end if;
  end loop;

  insert into public.marketing_agents (user_id, referral_code, email, full_name, phone_e164, active, roles)
  values (v_uid, v_code, v_email, v_name, v_phone, true, v_roles)
  returning id into v_id;

  return jsonb_build_object (
    'ok', true,
    'id', v_id,
    'referral_code', v_code,
    'user_id', v_uid,
    'shop_name', v_shop_name,
    'roles', to_jsonb (v_roles)
  );
exception
  when unique_violation then
    return jsonb_build_object ('ok', false, 'error', 'already_agent');
end;
$$;

revoke all on function public.internal_grant_marketing_agent_by_shop (uuid, text[]) from public;
grant execute on function public.internal_grant_marketing_agent_by_shop (uuid, text[]) to authenticated;

-- Grant marketing agents by shop (phone-primary owners use login.waka.ug emails, not real inboxes).

-- List agents with their primary shop name for admin UI
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
          'referral_count', (select count(*)::int from public.agent_referrals ar where ar.agent_id = ma.id),
          'created_at', ma.created_at,
          'shop_id', own.shop_id,
          'shop_name', own.shop_name
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
    ),
    '[]'::jsonb
  );
end;
$$;

-- Grant agent role to the owner of an existing shop (match by shop, not inbox email)
create or replace function public.internal_grant_marketing_agent_by_shop (p_shop_id uuid)
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
  v_try int := 0;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_required');
  end if;

  select s.name into v_shop_name
  from public.shops s
  where s.id = p_shop_id;

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

  select lower (trim (u.email)) into v_email
  from auth.users u
  where u.id = v_uid;

  select nullif (trim (pr.full_name), ''), nullif (trim (pr.phone_e164), '')
  into v_name, v_phone
  from public.profiles pr
  where pr.id = v_uid;

  if exists (
    select 1 from public.marketing_agents ma
    where ma.user_id = v_uid and ma.active
  ) then
    select ma.id, ma.referral_code into v_id, v_code
    from public.marketing_agents ma
    where ma.user_id = v_uid and ma.active
    limit 1;
    return jsonb_build_object (
      'ok', true,
      'id', v_id,
      'referral_code', v_code,
      'already_agent', true,
      'shop_name', v_shop_name
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

  insert into public.marketing_agents (user_id, referral_code, email, full_name, phone_e164, active)
  values (v_uid, v_code, v_email, v_name, v_phone, true)
  returning id into v_id;

  return jsonb_build_object (
    'ok', true,
    'id', v_id,
    'referral_code', v_code,
    'user_id', v_uid,
    'shop_name', v_shop_name
  );
exception
  when unique_violation then
    return jsonb_build_object ('ok', false, 'error', 'already_agent');
end;
$$;

revoke all on function public.internal_grant_marketing_agent_by_shop (uuid) from public;
grant execute on function public.internal_grant_marketing_agent_by_shop (uuid) to authenticated;

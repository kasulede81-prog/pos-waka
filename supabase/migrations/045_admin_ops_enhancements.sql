-- Admin ops: shop stats, normalized emails, grant marketing agents by registered email

-- ---------- Recent shops: activity + product counts ----------
create or replace function public.internal_ops_recent_shops (p_limit int default 20)
returns table (
  id uuid,
  name text,
  district text,
  city text,
  is_active boolean,
  created_at timestamptz,
  organization_id uuid,
  plan_code text,
  trial_ends_at timestamptz,
  subscription_status text,
  owner_label text,
  owner_email text,
  phone_e164 text,
  business_type text,
  gps_missing boolean,
  last_seen_at timestamptz,
  product_count int,
  sale_count_30d int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  return query
  select
    s.id,
    s.name,
    s.district,
    s.city,
    s.is_active,
    s.created_at,
    s.organization_id,
    sp.code as plan_code,
    sub.trial_ends_at,
    sub.status as subscription_status,
    coalesce(
      nullif (trim (pr.full_name), ''),
      nullif (trim (pr.business_name), ''),
      nullif (lower (trim (pr.email)), ''),
      own.user_id::text
    ) as owner_label,
    lower (trim (pr.email)) as owner_email,
    coalesce (s.phone_e164, pr.phone_e164) as phone_e164,
    s.business_type,
    coalesce (s.gps_missing, true) as gps_missing,
    s.last_seen_at,
    (
      select count(*)::int
      from public.products p
      where p.shop_id = s.id and p.is_active
    ) as product_count,
    coalesce (sa.sale_count_30d, 0)::int as sale_count_30d
  from public.shops s
  left join public.shop_activity sa on sa.shop_id = s.id
  left join lateral (
    select sm.user_id
    from public.shop_members sm
    where sm.shop_id = s.id
    order by (case when sm.role = 'owner' then 0 else 1 end), sm.created_at asc
    limit 1
  ) own on true
  left join public.profiles pr on pr.id = own.user_id
  left join lateral (
    select s2.*
    from public.subscriptions s2
    where s2.organization_id = s.organization_id
    order by s2.created_at desc
    limit 1
  ) sub on true
  left join public.subscription_plans sp on sp.id = sub.plan_id
  order by coalesce (s.last_seen_at, s.created_at) desc
  limit least (greatest (coalesce (p_limit, 20), 1), 100);
end;
$$;

-- ---------- Shop detail: owner email + shop busy stats ----------
create or replace function public.internal_ops_shop_detail (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j jsonb;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select
    jsonb_build_object (
      'shop',
      to_jsonb (sh),
      'owner_label',
      coalesce(
        nullif (trim (pr.full_name), ''),
        nullif (trim (pr.business_name), ''),
        nullif (lower (trim (pr.email)), ''),
        own.user_id::text
      ),
      'owner_email',
      lower (trim (pr.email)),
      'product_count',
      (
        select count(*)::int
        from public.products p
        where p.shop_id = sh.id and p.is_active
      ),
      'sale_count_30d',
      coalesce (sa.sale_count_30d, 0),
      'last_sale_at',
      sa.last_sale_at,
      'subscription',
      (
        select to_jsonb (s)
        from public.subscriptions s
        where s.organization_id = sh.organization_id
        order by s.created_at desc
        limit 1
      ),
      'plan_code',
      (
        select sp2.code
        from public.subscriptions s
        join public.subscription_plans sp2 on sp2.id = s.plan_id
        where s.organization_id = sh.organization_id
        order by s.created_at desc
        limit 1
      ),
      'devices',
      (
        select coalesce (jsonb_agg (to_jsonb (x)), '[]'::jsonb)
        from (
          select d.*
          from public.shop_devices d
          where d.shop_id = p_shop_id
          order by d.last_seen_at desc nulls last
          limit 50
        ) x
      ),
      'sync_health',
      (
        select to_jsonb (sy)
        from public.sync_health sy
        where sy.shop_id = p_shop_id
      ),
      'subscription_payments_recent',
      (
        select coalesce (jsonb_agg (to_jsonb (y)), '[]'::jsonb)
        from (
          select sp2.*
          from public.subscription_payments sp2
          join public.subscriptions s2 on s2.id = sp2.subscription_id
          join public.shops sh2 on sh2.organization_id = s2.organization_id
          where sh2.id = p_shop_id
          order by sp2.created_at desc
          limit 12
        ) y
      )
    )
  into j
  from public.shops sh
  left join public.shop_activity sa on sa.shop_id = sh.id
  left join lateral (
    select sm.user_id
    from public.shop_members sm
    where sm.shop_id = sh.id
      and sm.role = 'owner'
    order by sm.created_at asc
    limit 1
  ) own on true
  left join public.profiles pr on pr.id = own.user_id
  where sh.id = p_shop_id;

  return coalesce (j, '{}'::jsonb);
end;
$$;

-- ---------- Grant marketing agent to an existing registered user (auto referral code) ----------
create or replace function public.internal_grant_marketing_agent (p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_code text;
  v_id uuid;
  v_email text := lower (trim (coalesce (p_email, '')));
  v_name text;
  v_phone text;
  v_try int := 0;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  if v_email !~ '^[^@]+@[^@]+\.[^@]+$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_email');
  end if;

  select u.id into v_uid
  from auth.users u
  where lower (trim (u.email)) = v_email
  limit 1;

  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'user_not_found');
  end if;

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
    return jsonb_build_object ('ok', true, 'id', v_id, 'referral_code', v_code, 'already_agent', true);
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

  return jsonb_build_object ('ok', true, 'id', v_id, 'referral_code', v_code, 'user_id', v_uid);
exception
  when unique_violation then
    return jsonb_build_object ('ok', false, 'error', 'already_agent');
end;
$$;

revoke all on function public.internal_grant_marketing_agent (text) from public;
grant execute on function public.internal_grant_marketing_agent (text) to authenticated;

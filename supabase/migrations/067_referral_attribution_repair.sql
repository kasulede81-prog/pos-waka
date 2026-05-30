-- Repair missed referral rows: read signup metadata server-side + staff backfill by shop.

create or replace function public.ensure_referral_attribution ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_code text;
  v_has_row boolean;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select exists (
    select 1 from public.agent_referrals ar where ar.referred_user_id = v_uid
  ) into v_has_row;

  if v_has_row then
    return jsonb_build_object ('ok', true, 'already_applied', true);
  end if;

  select nullif (trim (u.raw_user_meta_data ->> 'referral_code'), '')
  into v_code
  from auth.users u
  where u.id = v_uid;

  if v_code is null or length (public.normalize_referral_code (v_code)) < 3 then
    return jsonb_build_object ('ok', true, 'skipped', 'no_code');
  end if;

  return public.apply_referral_code (v_code);
end;
$$;

revoke all on function public.ensure_referral_attribution () from public;
grant execute on function public.ensure_referral_attribution () to authenticated;

-- Ops: attach a referred shop to an agent when signup attribution was missed.
create or replace function public.internal_attach_shop_referral (p_shop_id uuid, p_referral_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent public.marketing_agents%rowtype;
  v_uid uuid;
  v_org_id uuid;
  v_shop_name text;
  v_email text;
  v_phone text;
  v_norm text := public.normalize_referral_code (p_referral_code);
  v_existing_agent_id uuid;
  v_referral_id uuid;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  if p_shop_id is null or length (v_norm) < 3 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_input');
  end if;

  select * into v_agent
  from public.marketing_agents ma
  where public.normalize_referral_code (ma.referral_code) = v_norm
    and ma.active
  limit 1;

  if v_agent.id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_code');
  end if;

  select sm.user_id, s.organization_id, s.name
  into v_uid, v_org_id, v_shop_name
  from public.shop_members sm
  join public.shops s on s.id = sm.shop_id
  where sm.shop_id = p_shop_id
  order by (case when sm.role = 'owner' then 0 else 1 end), sm.created_at asc
  limit 1;

  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'no_owner');
  end if;

  if v_agent.user_id = v_uid then
    return jsonb_build_object ('ok', false, 'error', 'self_referral');
  end if;

  select ar.agent_id, ar.id
  into v_existing_agent_id, v_referral_id
  from public.agent_referrals ar
  where ar.referred_user_id = v_uid
  limit 1;

  if v_existing_agent_id is not null then
    if v_existing_agent_id = v_agent.id then
      return jsonb_build_object (
        'ok', true,
        'already_applied', true,
        'referral_id', v_referral_id,
        'agent_id', v_agent.id
      );
    end if;
    return jsonb_build_object ('ok', false, 'error', 'already_referred_other_agent');
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;
  select pr.phone_e164 into v_phone from public.profiles pr where pr.id = v_uid;

  insert into public.agent_referrals (
    agent_id,
    referred_user_id,
    referred_shop_id,
    organization_id,
    shop_name,
    owner_email
  )
  values (
    v_agent.id,
    v_uid,
    p_shop_id,
    v_org_id,
    coalesce (nullif (trim (v_shop_name), ''), 'Shop'),
    coalesce (nullif (trim (v_email), ''), nullif (trim (v_phone), ''))
  )
  returning id into v_referral_id;

  return jsonb_build_object (
    'ok', true,
    'referral_id', v_referral_id,
    'agent_id', v_agent.id,
    'referred_user_id', v_uid
  );
end;
$$;

revoke all on function public.internal_attach_shop_referral (uuid, text) from public;
grant execute on function public.internal_attach_shop_referral (uuid, text) to authenticated;

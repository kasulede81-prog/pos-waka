-- Public agent verification for QR codes: /verify-agent/{referral_code}
-- Exposes only safe fields via security-definer RPC (anon + authenticated).

alter table public.marketing_agents
  add column if not exists credential_expires_at timestamptz;

comment on column public.marketing_agents.credential_expires_at is
  'When the agent verification credential expires; null falls back to created_at + 1 year.';

update public.marketing_agents ma
set credential_expires_at = ma.created_at + interval '1 year'
where ma.credential_expires_at is null;

create or replace function public.public_verify_marketing_agent (p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm text := public.normalize_referral_code (p_code);
  v_agent public.marketing_agents%rowtype;
  v_status text;
  v_expires timestamptz;
  v_issue timestamptz;
begin
  if length (v_norm) < 3 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_code');
  end if;

  select * into v_agent
  from public.marketing_agents ma
  where public.normalize_referral_code (ma.referral_code) = v_norm
  limit 1;

  if v_agent.id is null then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  v_issue := v_agent.created_at;
  v_expires := coalesce (v_agent.credential_expires_at, v_agent.created_at + interval '1 year');

  if not v_agent.active then
    v_status := 'suspended';
  elsif v_expires < now() then
    v_status := 'expired';
  else
    v_status := 'active';
  end if;

  return jsonb_build_object (
    'ok', true,
    'referral_code', v_agent.referral_code,
    'agent_name', coalesce (nullif (trim (v_agent.full_name), ''), 'Waka Agent'),
    'status', v_status,
    'is_active', v_status = 'active',
    'issued_at', v_issue,
    'expires_at', v_expires,
    'phone_e164',
      case
        when v_status = 'active' and nullif (trim (v_agent.phone_e164), '') is not null
          then trim (v_agent.phone_e164)
        else null
      end
  );
end;
$$;

revoke all on function public.public_verify_marketing_agent (text) from public;
grant execute on function public.public_verify_marketing_agent (text) to anon, authenticated;

-- Set credential expiry on grant / reactivation (extends 060 grant RPC).
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
      credential_expires_at = coalesce (ma.credential_expires_at, now() + interval '1 year'),
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

  insert into public.marketing_agents (
    user_id, referral_code, email, full_name, phone_e164, active, roles, credential_expires_at
  )
  values (v_uid, v_code, v_email, v_name, v_phone, true, v_roles, now() + interval '1 year')
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

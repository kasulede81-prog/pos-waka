-- ============================================================================
-- MERCHANT REGISTRATION HARDENING
-- ============================================================================
-- Fixes the merchant signup/bootstrap path ONLY. Nothing here touches loyalty, members,
-- QR enrollment or Wallet, and nothing here moves or rewrites a single row of data.
--
-- THE DEFECTS THIS CLOSES
--
-- 1. CONCURRENT DOUBLE PROVISIONING. `bootstrap_owner_workspace` resolved the caller's
--    organization as "the oldest organization_members row for this user". Two sessions - two
--    tabs, or a retry landing while the first call is still in flight - both read "none" and
--    both inserted one, so one merchant could end up with two organizations and two shops.
--    The function now takes a transaction-scoped advisory lock on the caller's auth uid,
--    which makes the read-then-insert atomic per person. Two callers produce exactly one
--    organization and one shop: the second finds the first one's rows.
--
--    The lock is keyed on the user id resolved from auth.uid(). Nothing client-supplied
--    takes part, so it cannot be used to block or serialize another merchant.
--
-- 2. `owner_onboarding_status()` FAILED OPEN. It returned `complete: true` whenever
--    auth.uid() was null: it reported "onboarding finished" exactly when it could not tell
--    whose onboarding it was. Every gate that trusts this function inherited that. It now
--    returns complete=false with an explicit reason.
--
-- 3. THE BOOTSTRAP RPCs WERE EXECUTABLE BY `anon`. Not because any migration granted it -
--    Postgres grants EXECUTE on a new function to PUBLIC by default and no migration ever
--    revoked it. They were still safe (each re-checks auth.uid() and refuses a null identity),
--    so this is a least-privilege repair rather than an open door: an unauthenticated caller
--    is now stopped by the GRANT, one layer before the function body would have stopped it.
--    `authenticated` keeps exactly the access the application uses; `service_role` keeps the
--    access the operational tooling uses.
--
-- 4. The bundle save takes the same per-user lock, because it can also create the
--    organization and shop when it is reached without a prior bootstrap.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
--   * no backfill, no data migration: not one row is inserted, updated or deleted;
--   * no unique index on organizations.created_by or on shop_members role='owner' - a genuine
--     second business per person is a product decision that needs its own explicit flow, and
--     a unique index here would forbid it forever as a side effect of a reliability fix;
--   * no weakening of RLS, and no change to waka_account_identity() or to who may own what.
--
-- Idempotent: every statement is create-or-replace or a grant, so applying it twice is safe.

create or replace function public.bootstrap_owner_workspace (
  p_org_name text,
  p_business_type text default 'kiosk_duka',
  p_full_name text default null,
  p_email text default null,
  p_district_id uuid default null,
  p_phone_e164 text default null,
  p_address text default null,
  p_gps_missing boolean default true,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_shop_display_name text default null
)
returns table (
  organization_id uuid,
  shop_id uuid
)
language plpgsql
security definer
set search_path = public, auth
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid ();
  v_org_id uuid;
  v_shop_id uuid;
  v_business_type text := coalesce (nullif (trim (p_business_type), ''), 'kiosk_duka');
  v_business_plan uuid;
  v_district_name text;
  v_shop_label text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Idempotency under concurrency. Two sessions for the same person both used to read
  -- "no organization yet" and both insert one. This lock is per-user and transaction-scoped,
  -- so the second caller waits and then sees the first caller's rows. It is keyed on the
  -- auth uid - never on anything a client supplied.
  perform pg_advisory_xact_lock (hashtextextended (v_uid::text, 0));

  -- Use the shared validator (kept in sync with the shops CHECK constraint) instead of a
  -- literal list that predated hospitality / bar / restaurant_bar / hotel and silently
  -- coerced them to kiosk_duka. Unknown values still fall back to kiosk_duka.
  if not public.is_valid_shop_business_type (v_business_type) then
    v_business_type := 'kiosk_duka';
  end if;

  v_shop_label := coalesce (
    nullif (trim (p_shop_display_name), ''),
    nullif (trim (p_org_name), ''),
    'Main Shop'
  );

  insert into public.profiles (id, full_name, business_name, email, role, phone_e164)
  values (
    v_uid,
    nullif (trim (p_full_name), ''),
    nullif (trim (p_org_name), ''),
    nullif (lower (trim (p_email)), ''),
    'owner',
    case
      when trim (coalesce (p_phone_e164, '')) ~ '^\+256[0-9]{9}$' then trim (p_phone_e164)
      else null
    end
  )
  on conflict (id) do update
  set full_name = coalesce (nullif (trim (p_full_name), ''), public.profiles.full_name),
      business_name = coalesce (nullif (trim (p_org_name), ''), public.profiles.business_name),
      email = coalesce (nullif (lower (trim (p_email)), ''), public.profiles.email),
      phone_e164 = coalesce (
        case
          when trim (coalesce (p_phone_e164, '')) ~ '^\+256[0-9]{9}$' then trim (p_phone_e164)
          else null
        end,
        public.profiles.phone_e164
      ),
      role = 'owner',
      updated_at = now ();

  select om.organization_id
  into v_org_id
  from public.organization_members om
  where om.user_id = v_uid
  order by om.created_at asc
  limit 1;

  if v_org_id is null then
    insert into public.organizations (name, business_type, created_by)
    values (coalesce (nullif (trim (p_org_name), ''), 'My Shop'), v_business_type, v_uid)
    returning id into v_org_id;
  end if;

  insert into public.organization_members as om (
    organization_id,
    user_id,
    profile_id,
    role
  )
  values (v_org_id, v_uid, v_uid, 'owner')
  on conflict on constraint organization_members_organization_id_user_id_key do update
  set role = 'owner',
      profile_id = coalesce (om.profile_id, excluded.profile_id);

  if p_district_id is not null then
    select d.name into v_district_name from public.districts d where d.id = p_district_id limit 1;
  end if;

  select s.id
  into v_shop_id
  from public.shops s
  where s.organization_id = v_org_id
  order by s.created_at asc
  limit 1;

  if v_shop_id is null then
    insert into public.shops as sh (
      organization_id,
      name,
      business_type,
      is_active,
      district_id,
      district,
      phone_e164,
      address_line,
      latitude,
      longitude,
      gps_missing,
      owner_user_id
    )
    values (
      v_org_id,
      v_shop_label,
      v_business_type,
      true,
      p_district_id,
      v_district_name,
      case
        when trim (coalesce (p_phone_e164, '')) ~ '^\+256[0-9]{9}$' then trim (p_phone_e164)
        else null
      end,
      nullif (trim (p_address), ''),
      p_latitude,
      p_longitude,
      coalesce (p_gps_missing, true)
        and (p_latitude is null or p_longitude is null),
      v_uid
    )
    returning sh.id into v_shop_id;
  else
    update public.shops sh
    set
      owner_user_id = coalesce (sh.owner_user_id, v_uid),
      name = case
        when nullif (trim (p_shop_display_name), '') is not null then trim (p_shop_display_name)
        when nullif (trim (p_org_name), '') is not null and (sh.name is null or trim (sh.name) = '') then trim (p_org_name)
        else sh.name
      end
    where sh.id = v_shop_id;
  end if;

  insert into public.shop_members as sm (shop_id, user_id, role)
  values (v_shop_id, v_uid, 'owner')
  on conflict on constraint shop_members_shop_id_user_id_key do update
  set role = 'owner';

  update public.profiles pr
  set primary_shop_id = coalesce (pr.primary_shop_id, v_shop_id), updated_at = now ()
  where pr.id = v_uid;

  select sp.id into v_business_plan
  from public.subscription_plans sp
  where sp.code = 'business' and sp.is_active
  limit 1;

  if v_business_plan is not null then
    if not exists (
      select 1 from public.subscriptions s where s.organization_id = v_org_id
    ) then
      insert into public.subscriptions as sub (
        organization_id,
        shop_id,
        plan_id,
        status,
        billing_interval,
        trial_ends_at,
        current_period_start,
        current_period_end,
        external_provider
      )
      values (
        v_org_id,
        v_shop_id,
        v_business_plan,
        'trial',
        'month',
        (timezone ('Africa/Kampala', now ())::date + interval '30 days')::timestamptz,
        now (),
        (timezone ('Africa/Kampala', now ())::date + interval '30 days')::timestamptz,
        'trial_auto'
      );
    end if;
  end if;

  return query select v_org_id, v_shop_id;
end;
$$;

do $g$
begin
  execute 'revoke all on function public.bootstrap_owner_workspace (text, text, text, text, uuid, text, text, boolean, double precision, double precision, text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.bootstrap_owner_workspace (text, text, text, text, uuid, text, text, boolean, double precision, double precision, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.bootstrap_owner_workspace (text, text, text, text, uuid, text, text, boolean, double precision, double precision, text) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.bootstrap_owner_workspace (text, text, text, text, uuid, text, text, boolean, double precision, double precision, text) to service_role';
  end if;
end;
$g$;

create or replace function public.save_owner_business_profile_bundle (
  p_shop_name text,
  p_business_type text,
  p_district_id uuid,
  p_phone_e164 text,
  p_currency text,
  p_address text default null,
  p_city text default null,
  p_area text default null,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_shop_id uuid;
  v_org_id uuid;
  v_district_name text;
  v_cur text := upper (trim (coalesce (p_currency, 'UGX')));
  v_phone text;
  v_bt text := coalesce (nullif (trim (p_business_type), ''), 'kiosk_duka');
  v_owner_name text := coalesce (nullif (trim (p_shop_name), ''), 'Owner');
  v_shop_label text := coalesce (nullif (trim (p_shop_name), ''), 'Main Shop');
  v_onboarding jsonb;
  v_auth_email text;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  -- Idempotency under concurrency. Two sessions for the same person both used to read
  -- "no organization yet" and both insert one. This lock is per-user and transaction-scoped,
  -- so the second caller waits and then sees the first caller's rows. It is keyed on the
  -- auth uid - never on anything a client supplied.
  perform pg_advisory_xact_lock (hashtextextended (v_uid::text, 0));

  v_onboarding := public.owner_onboarding_status ();
  if coalesce ((v_onboarding ->> 'complete')::boolean, false) then
    return jsonb_build_object (
      'ok',
      false,
      'error',
      'profile_locked',
      'detail',
      'Shop details are locked. Contact Waka support to change them.'
    );
  end if;

  if v_cur !~ '^[A-Z]{3}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_currency');
  end if;

  v_phone := trim (coalesce (p_phone_e164, ''));
  if v_phone !~ '^\+256[0-9]{9}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_phone');
  end if;

  if exists (
    select 1
    from public.profiles pr
    where pr.phone_e164 = v_phone
      and pr.id <> v_uid
  ) then
    return jsonb_build_object (
      'ok',
      false,
      'error',
      'phone_in_use',
      'detail',
      'This phone number is already registered to another Waka account.'
    );
  end if;

  if p_district_id is null then
    return jsonb_build_object ('ok', false, 'error', 'district_required');
  end if;

  if not public.is_valid_shop_business_type (v_bt) then
    return jsonb_build_object (
      'ok',
      false,
      'error',
      'invalid_business_type',
      'detail',
      format ('Unknown business type: %s', v_bt)
    );
  end if;

  select d.name into v_district_name
  from public.districts d
  where d.id = p_district_id
  limit 1;

  select lower (trim (u.email))
  into v_auth_email
  from auth.users u
  where u.id = v_uid;

  insert into public.profiles (id, full_name, phone_e164, business_name, email)
  values (
    v_uid,
    v_owner_name,
    v_phone,
    nullif (trim (p_shop_name), ''),
    nullif (v_auth_email, '')
  )
  on conflict (id) do update
  set full_name = coalesce (nullif (trim (public.profiles.full_name), ''), excluded.full_name),
      phone_e164 = excluded.phone_e164,
      business_name = coalesce (excluded.business_name, public.profiles.business_name),
      email = coalesce (
        nullif (lower (trim (public.profiles.email)), ''),
        nullif (v_auth_email, ''),
        public.profiles.email
      ),
      updated_at = now ();

  select om.organization_id
  into v_org_id
  from public.organization_members om
  where om.user_id = v_uid
  order by om.created_at asc
  limit 1;

  if v_org_id is null then
    insert into public.organizations (name, business_type, default_currency, created_by)
    values (coalesce (nullif (trim (p_shop_name), ''), 'My Shop'), v_bt, v_cur, v_uid)
    returning id into v_org_id;
  end if;

  insert into public.organization_members (organization_id, user_id, profile_id, role)
  values (v_org_id, v_uid, v_uid, 'owner')
  on conflict (organization_id, user_id) do update
  set role = 'owner',
      profile_id = coalesce (public.organization_members.profile_id, excluded.profile_id);

  select sh.id
  into v_shop_id
  from public.shop_members sm
  join public.shops sh on sh.id = sm.shop_id
  where sm.user_id = v_uid
  order by sm.created_at asc
  limit 1;

  if v_shop_id is null then
    select sh.id
    into v_shop_id
    from public.shops sh
    where sh.organization_id = v_org_id
    order by sh.created_at asc
    limit 1;
  end if;

  if v_shop_id is null then
    insert into public.shops (
      organization_id,
      name,
      business_type,
      is_active,
      district_id,
      district,
      city,
      area,
      phone_e164,
      address_line,
      latitude,
      longitude,
      gps_missing
    )
    values (
      v_org_id,
      v_shop_label,
      v_bt,
      true,
      p_district_id,
      v_district_name,
      nullif (trim (p_city), ''),
      nullif (trim (p_area), ''),
      v_phone,
      nullif (trim (p_address), ''),
      p_latitude,
      p_longitude,
      (p_latitude is null or p_longitude is null)
    )
    returning id into v_shop_id;
  end if;

  insert into public.shop_members (shop_id, user_id, role)
  values (v_shop_id, v_uid, 'owner')
  on conflict (shop_id, user_id) do update
  set role = 'owner';

  update public.organizations o
  set
    name = coalesce (nullif (trim (p_shop_name), ''), o.name),
    business_type = v_bt,
    default_currency = v_cur,
    updated_at = now ()
  where o.id = v_org_id;

  update public.shops sh
  set
    name = coalesce (nullif (trim (p_shop_name), ''), sh.name),
    business_type = v_bt,
    district_id = p_district_id,
    district = coalesce (v_district_name, sh.district),
    city = nullif (trim (p_city), ''),
    area = nullif (trim (p_area), ''),
    phone_e164 = v_phone,
    address_line = nullif (trim (p_address), ''),
    latitude = p_latitude,
    longitude = p_longitude,
    gps_missing = (p_latitude is null or p_longitude is null),
    updated_at = now ()
  where sh.id = v_shop_id;

  -- Subscription initialization is owned exclusively by bootstrap_owner_workspace.
  -- Do not insert subscription rows here — prevents race with Business trial bootstrap.

  return jsonb_build_object ('ok', true, 'shop_id', v_shop_id, 'organization_id', v_org_id);
exception
  when unique_violation then
    if sqlerrm ilike '%profiles_phone_e164%' then
      return jsonb_build_object (
        'ok',
        false,
        'error',
        'phone_in_use',
        'detail',
        'This phone number is already registered to another Waka account.'
      );
    end if;
    return jsonb_build_object ('ok', false, 'error', 'save_failed', 'detail', sqlerrm);
  when others then
    return jsonb_build_object ('ok', false, 'error', 'save_failed', 'detail', sqlerrm);
end;
$$;

do $g$
begin
  execute 'revoke all on function public.save_owner_business_profile_bundle (text, text, uuid, text, text, text, text, text, double precision, double precision) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.save_owner_business_profile_bundle (text, text, uuid, text, text, text, text, text, double precision, double precision) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.save_owner_business_profile_bundle (text, text, uuid, text, text, text, text, text, double precision, double precision) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.save_owner_business_profile_bundle (text, text, uuid, text, text, text, text, text, double precision, double precision) to service_role';
  end if;
end;
$g$;

create or replace function public.owner_onboarding_status ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_shop record;
  v_profile_email text;
  v_complete boolean := false;
  v_missing text[] := array[]::text[];
begin
  -- FAIL CLOSED. An unauthenticated caller is not a completed owner. Returning complete=true
  -- here meant "cannot tell whose onboarding this is" was reported as "finished", and every
  -- gate that trusts this function inherited that.
  if v_uid is null then
    return jsonb_build_object ('complete', false, 'missing', to_jsonb (array['not_authenticated']::text[]));
  end if;

  select lower (trim (coalesce (pr.email, '')))
  into v_profile_email
  from public.profiles pr
  where pr.id = v_uid;

  select sh.id, sh.name, sh.district_id, sh.phone_e164, sh.business_type, o.name as org_name, o.default_currency
  into v_shop
  from public.shop_members sm
  join public.shops sh on sh.id = sm.shop_id
  join public.organizations o on o.id = sh.organization_id
  where sm.user_id = v_uid
  order by sm.created_at asc
  limit 1;

  if not found then
    return jsonb_build_object ('complete', false, 'missing', to_jsonb (array['shop']::text[]));
  end if;

  if coalesce (trim (v_shop.org_name), '') = '' then v_missing := array_append (v_missing, 'organization_name'); end if;
  if coalesce (trim (v_shop.name), '') = '' then v_missing := array_append (v_missing, 'shop_name'); end if;
  if v_shop.business_type is null or trim (v_shop.business_type) = '' then v_missing := array_append (v_missing, 'business_type'); end if;
  if v_shop.district_id is null then v_missing := array_append (v_missing, 'district'); end if;
  if v_shop.phone_e164 is null or trim (v_shop.phone_e164) !~ '^\+256[0-9]{9}$' then
    v_missing := array_append (v_missing, 'phone');
  end if;
  if v_profile_email is null or v_profile_email = '' or v_profile_email like '%@login.waka.ug' then
    v_missing := array_append (v_missing, 'email');
  end if;
  if v_shop.default_currency is null or length (trim (v_shop.default_currency)) <> 3 then
    v_missing := array_append (v_missing, 'currency');
  end if;

  v_complete := coalesce (array_length (v_missing, 1), 0) = 0;
  return jsonb_build_object ('complete', v_complete, 'missing', to_jsonb (v_missing));
end;
$$;

do $g$
begin
  execute 'revoke all on function public.owner_onboarding_status () from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.owner_onboarding_status () from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.owner_onboarding_status () to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.owner_onboarding_status () to service_role';
  end if;
end;
$g$;


do $g$
begin
  -- Guarded: this function is created by the identity-hardening migration, not by this one. On a
  -- database that has not had that applied yet there is nothing to revoke, and failing here would
  -- block the whole hardening for a reason that has nothing to do with it.
  if to_regprocedure ('public.owner_workspace_health()') is null then
    return;
  end if;
  execute 'revoke all on function public.owner_workspace_health () from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.owner_workspace_health () from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.owner_workspace_health () to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.owner_workspace_health () to service_role';
  end if;
end;
$g$;


do $g$
begin
  -- Guarded for the same reason as owner_workspace_health above.
  if to_regprocedure ('public.repair_owner_workspace(text, text, text, text)') is null then
    return;
  end if;
  execute 'revoke all on function public.repair_owner_workspace (text, text, text, text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.repair_owner_workspace (text, text, text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.repair_owner_workspace (text, text, text, text) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.repair_owner_workspace (text, text, text, text) to service_role';
  end if;
end;
$g$;

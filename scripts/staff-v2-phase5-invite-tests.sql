-- STAFF-V2 Phase 5 live checks I1–I11 on a throwaway shop.
-- Intended to run inside one transaction and ROLLBACK.
-- Do not run against tenant shops.

begin;

create temporary table phase5_results (
  id text primary key,
  ok boolean not null,
  detail text
);

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_invitee uuid := gen_random_uuid();
  v_wrong uuid := gen_random_uuid();
  v_org uuid;
  v_shop uuid;
  v_shop2 uuid;
  v_staff uuid;
  v_pin text := 'phase5-pin-hash-unchanged';
  v_i1 jsonb;
  v_i2 jsonb;
  v_i3 jsonb;
  v_i4 jsonb;
  v_i5 jsonb;
  v_i6 jsonb;
  v_i7 jsonb;
  v_i8 jsonb;
  v_i8b jsonb;
  v_i9 jsonb;
  v_i10 jsonb;
  v_i11 boolean;
  v_token text;
  v_expired text;
  v_upgrade text;
  v_new text;
  v_shop2_token text;
  v_members int;
  v_linked uuid;
  v_pin_after text;
  v_new_staff uuid;
  v_owner_memberships int;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', v_owner, 'authenticated', 'authenticated',
     'phase5-owner@waka.invalid', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_manager, 'authenticated', 'authenticated',
     'phase5-manager@waka.invalid', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_invitee, 'authenticated', 'authenticated',
     'phase5-invitee@waka.invalid', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_wrong, 'authenticated', 'authenticated',
     'phase5-wrong@waka.invalid', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.organizations (id, name, created_by)
  values (gen_random_uuid(), 'PHASE5 THROW AWAY ORG', v_owner)
  returning id into v_org;

  insert into public.shops (organization_id, name, code)
  values (v_org, 'PHASE5 THROW AWAY SHOP', 'P5A')
  returning id into v_shop;

  insert into public.shops (organization_id, name, code)
  values (v_org, 'PHASE5 THROW AWAY SHOP B', 'P5B')
  returning id into v_shop2;

  insert into public.shop_members (shop_id, user_id, role) values
    (v_shop, v_owner, 'owner'),
    (v_shop2, v_owner, 'owner'),
    (v_shop, v_manager, 'manager');

  insert into public.shop_pos_staff (shop_id, client_id, name, role, pin_hash, is_active)
  values (v_shop, gen_random_uuid(), 'Phase5 PIN John', 'cashier', v_pin, true)
  returning id into v_staff;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.email', 'phase5-owner@waka.invalid', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'email', 'phase5-owner@waka.invalid', 'role', 'authenticated')::text,
    true
  );

  v_i1 := public.shop_invite_staff(v_shop, '  phase5-invitee@waka.invalid ', 'cashier', 'cashier', null);
  insert into phase5_results values (
    'I1',
    coalesce((v_i1 ->> 'ok')::boolean, false)
      and exists (
        select 1 from public.shop_staff_invitations i
        where i.id = (v_i1 ->> 'invitation_id')::uuid
          and i.token_hash = public.staff_v2_hash_invite_token(v_i1 ->> 'token')
          and i.email = 'phase5-invitee@waka.invalid'
          and i.token_hash is distinct from (v_i1 ->> 'token')
      ),
    v_i1::text
  );
  v_token := v_i1 ->> 'token';

  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  perform set_config('request.jwt.claim.email', 'phase5-manager@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_manager, 'email', 'phase5-manager@waka.invalid', 'role', 'authenticated')::text,
    true
  );
  v_i2 := public.shop_invite_staff(v_shop, 'phase5-manager-invite@waka.invalid', 'cashier', 'cashier', null);
  insert into phase5_results values (
    'I2',
    (v_i2 ->> 'ok') = 'false' and (v_i2 ->> 'error') = 'forbidden',
    v_i2::text
  );

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.email', 'phase5-owner@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'email', 'phase5-owner@waka.invalid', 'role', 'authenticated')::text,
    true
  );
  v_i3 := public.shop_invite_staff(v_shop, 'phase5-owner-role@waka.invalid', 'owner', 'cashier', null);
  insert into phase5_results values (
    'I3',
    (v_i3 ->> 'ok') = 'false' and (v_i3 ->> 'error') = 'owner_role_forbidden',
    v_i3::text
  );

  perform set_config('request.jwt.claim.sub', v_invitee::text, true);
  perform set_config('request.jwt.claim.email', 'phase5-invitee@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_invitee, 'email', 'phase5-invitee@waka.invalid', 'role', 'authenticated')::text,
    true
  );
  v_i4 := public.shop_accept_staff_invite(v_token);
  select count(*) into v_members
  from public.shop_members
  where shop_id = v_shop and user_id = v_invitee and role = 'cashier';
  insert into phase5_results values (
    'I4',
    coalesce((v_i4 ->> 'ok')::boolean, false) and v_members = 1,
    v_i4::text
  );

  v_i1 := public.shop_invite_staff(v_shop, 'phase5-wrong@waka.invalid', 'cashier', 'cashier', null);
  -- owner JWT required for invite
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.email', 'phase5-owner@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'email', 'phase5-owner@waka.invalid', 'role', 'authenticated')::text,
    true
  );
  v_i1 := public.shop_invite_staff(v_shop, 'phase5-wrong@waka.invalid', 'cashier', 'cashier', null);
  perform set_config('request.jwt.claim.sub', v_invitee::text, true);
  perform set_config('request.jwt.claim.email', 'phase5-invitee@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_invitee, 'email', 'phase5-invitee@waka.invalid', 'role', 'authenticated')::text,
    true
  );
  v_i5 := public.shop_accept_staff_invite(v_i1 ->> 'token');
  insert into phase5_results values (
    'I5',
    (v_i5 ->> 'ok') = 'false' and (v_i5 ->> 'error') = 'email_mismatch',
    v_i5::text
  );

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.email', 'phase5-owner@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'email', 'phase5-owner@waka.invalid', 'role', 'authenticated')::text,
    true
  );
  v_i1 := public.shop_invite_staff(v_shop, 'phase5-invitee@waka.invalid', 'waiter', 'waiter', null);
  -- already a member of shop A as cashier — invite should fail already_member
  -- use a fresh email for expiry instead
  v_i1 := public.shop_invite_staff(v_shop, 'phase5-expired@waka.invalid', 'cashier', 'cashier', null);
  v_expired := v_i1 ->> 'token';
  update public.shop_staff_invitations
  set expires_at = now() - interval '1 hour'
  where id = (v_i1 ->> 'invitation_id')::uuid;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
    'phase5-expired@waka.invalid', crypt('x', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

  perform set_config('request.jwt.claim.sub', (
    select id::text from auth.users where email = 'phase5-expired@waka.invalid' limit 1
  ), true);
  perform set_config('request.jwt.claim.email', 'phase5-expired@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', (select id from auth.users where email = 'phase5-expired@waka.invalid' limit 1),
      'email', 'phase5-expired@waka.invalid',
      'role', 'authenticated'
    )::text,
    true
  );
  v_i6 := public.shop_accept_staff_invite(v_expired);
  insert into phase5_results values (
    'I6',
    (v_i6 ->> 'ok') = 'false' and (v_i6 ->> 'error') = 'expired',
    v_i6::text
  );

  perform set_config('request.jwt.claim.sub', v_invitee::text, true);
  perform set_config('request.jwt.claim.email', 'phase5-invitee@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_invitee, 'email', 'phase5-invitee@waka.invalid', 'role', 'authenticated')::text,
    true
  );
  v_i7 := public.shop_accept_staff_invite(v_token);
  select count(*) into v_members
  from public.shop_members
  where shop_id = v_shop and user_id = v_invitee;
  insert into phase5_results values (
    'I7',
    (v_i7 ->> 'ok') = 'false'
      and (v_i7 ->> 'error') in ('already_accepted', 'already_member')
      and v_members = 1,
    v_i7::text || ' members=' || v_members
  );

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.email', 'phase5-owner@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'email', 'phase5-owner@waka.invalid', 'role', 'authenticated')::text,
    true
  );
  v_i8 := public.shop_invite_staff(v_shop, 'phase5-wrong@waka.invalid', 'cashier', 'cashier', v_staff);
  v_upgrade := v_i8 ->> 'token';
  perform set_config('request.jwt.claim.sub', v_wrong::text, true);
  perform set_config('request.jwt.claim.email', 'phase5-wrong@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_wrong, 'email', 'phase5-wrong@waka.invalid', 'role', 'authenticated')::text,
    true
  );
  v_i8b := public.shop_accept_staff_invite(v_upgrade);
  select s.user_id, s.pin_hash into v_linked, v_pin_after
  from public.shop_pos_staff s where s.id = v_staff;
  insert into phase5_results values (
    'I8',
    coalesce((v_i8b ->> 'ok')::boolean, false)
      and v_linked = v_wrong
      and v_pin_after = v_pin
      and (v_i8b ->> 'staff_id') = v_staff::text
      and (v_i8b ->> 'linked_existing') = 'true',
    v_i8b::text
  );

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.email', 'phase5-owner@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'email', 'phase5-owner@waka.invalid', 'role', 'authenticated')::text,
    true
  );
  -- I9 uses a new email/user
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
    'phase5-newstaff@waka.invalid', crypt('x', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );
  v_i9 := public.shop_invite_staff(v_shop, 'phase5-newstaff@waka.invalid', 'waiter', 'kitchen', null);
  v_new := v_i9 ->> 'token';
  perform set_config('request.jwt.claim.sub', (
    select id::text from auth.users where email = 'phase5-newstaff@waka.invalid' limit 1
  ), true);
  perform set_config('request.jwt.claim.email', 'phase5-newstaff@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', (select id from auth.users where email = 'phase5-newstaff@waka.invalid' limit 1),
      'email', 'phase5-newstaff@waka.invalid',
      'role', 'authenticated'
    )::text,
    true
  );
  v_i9 := public.shop_accept_staff_invite(v_new);
  v_new_staff := (v_i9 ->> 'staff_id')::uuid;
  insert into phase5_results values (
    'I9',
    coalesce((v_i9 ->> 'ok')::boolean, false)
      and (v_i9 ->> 'linked_existing') = 'false'
      and exists (
        select 1 from public.shop_pos_staff s
        where s.id = v_new_staff
          and s.user_id = (select id from auth.users where email = 'phase5-newstaff@waka.invalid' limit 1)
          and s.role = 'kitchen'
          and s.id is distinct from v_staff
      ),
    v_i9::text
  );

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.email', 'phase5-owner@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'email', 'phase5-owner@waka.invalid', 'role', 'authenticated')::text,
    true
  );
  v_i10 := public.shop_invite_staff(v_shop2, 'phase5-invitee@waka.invalid', 'waiter', 'waiter', null);
  v_shop2_token := v_i10 ->> 'token';
  perform set_config('request.jwt.claim.sub', v_invitee::text, true);
  perform set_config('request.jwt.claim.email', 'phase5-invitee@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_invitee, 'email', 'phase5-invitee@waka.invalid', 'role', 'authenticated')::text,
    true
  );
  v_i10 := public.shop_accept_staff_invite(v_shop2_token);
  insert into phase5_results values (
    'I10',
    coalesce((v_i10 ->> 'ok')::boolean, false)
      and exists (
        select 1 from public.shop_members sm
        where sm.shop_id = v_shop2 and sm.user_id = v_invitee and sm.role = 'waiter'
      )
      and exists (
        select 1 from public.shop_members sm
        where sm.shop_id = v_shop and sm.user_id = v_invitee and sm.role = 'cashier'
      ),
    v_i10::text
  );

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
    'phase5-callback@waka.invalid', crypt('x', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.email', 'phase5-owner@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'email', 'phase5-owner@waka.invalid', 'role', 'authenticated')::text,
    true
  );
  perform public.shop_invite_staff(v_shop, 'phase5-callback@waka.invalid', 'cashier', 'cashier', null);

  perform set_config('request.jwt.claim.sub', (
    select id::text from auth.users where email = 'phase5-callback@waka.invalid' limit 1
  ), true);
  perform set_config('request.jwt.claim.email', 'phase5-callback@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', (select id from auth.users where email = 'phase5-callback@waka.invalid' limit 1),
      'email', 'phase5-callback@waka.invalid',
      'role', 'authenticated'
    )::text,
    true
  );
  v_i11 := public.shop_has_pending_staff_invite_for_me();
  select count(*) into v_owner_memberships
  from public.shop_members
  where user_id = (select id from auth.users where email = 'phase5-callback@waka.invalid' limit 1)
    and role = 'owner';
  insert into phase5_results values (
    'I11',
    v_i11 = true
      and v_owner_memberships = 0
      and not exists (
        select 1 from public.shop_members sm
        where sm.user_id = v_invitee and sm.role = 'owner'
      ),
    'pending=' || v_i11 || ' owner_memberships=' || v_owner_memberships
  );
end;
$$;

select * from phase5_results order by id;

rollback;

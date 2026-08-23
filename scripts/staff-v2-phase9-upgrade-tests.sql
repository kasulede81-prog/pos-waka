-- STAFF-V2 Phase 9 live checks M0–M9 on a throwaway shop.
-- Intended to run inside one transaction and ROLLBACK.
-- Do not run against tenant shops.

begin;

create temporary table phase9_results (
  id text primary key,
  ok boolean not null,
  detail text
);

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_org uuid;
  v_shop uuid;
  v_staff uuid;
  v_client_id uuid := gen_random_uuid();
  v_staff2 uuid;
  v_pin text := 'phase9-pin-hash-unchanged';
  v_invite jsonb;
  v_accept jsonb;
  v_invite2 jsonb;
  v_m0 jsonb;
  v_m8 jsonb;
  v_m9 jsonb;
  v_linked uuid;
  v_pin_after text;
  v_same_id uuid;
  v_members int;
  v_sale_before uuid := gen_random_uuid();
  v_sale_auth uuid := gen_random_uuid();
  v_sale_shared uuid := gen_random_uuid();
  v_push jsonb;
  v_created uuid;
  v_sold uuid;
  v_hist_created uuid;
  v_hist_sold uuid;
  v_dup_ok boolean := false;
  v_token text;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', v_owner, 'authenticated', 'authenticated',
     'phase9-owner@waka.invalid', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_manager, 'authenticated', 'authenticated',
     'phase9-manager@waka.invalid', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_worker, 'authenticated', 'authenticated',
     'phase9-worker@waka.invalid', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_other, 'authenticated', 'authenticated',
     'phase9-other@waka.invalid', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.organizations (id, name, created_by)
  values (gen_random_uuid(), 'PHASE9 THROW AWAY ORG', v_owner)
  returning id into v_org;

  insert into public.shops (organization_id, name, code)
  values (v_org, 'PHASE9 THROW AWAY SHOP', 'P9A')
  returning id into v_shop;

  insert into public.shop_members (shop_id, user_id, role) values
    (v_shop, v_owner, 'owner'),
    (v_shop, v_manager, 'manager');

  insert into public.shop_pos_staff (
    shop_id, client_id, name, role, pin_hash, is_active, user_id
  ) values (
    v_shop, v_client_id, 'Phase9 PIN John', 'cashier', v_pin, true, null
  )
  returning id into v_staff;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.email', 'phase9-owner@waka.invalid', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'email', 'phase9-owner@waka.invalid', 'role', 'authenticated')::text,
    true
  );

  -- Historical sale before upgrade (owner wrote; no sold_by)
  v_push := public.shop_push_sale_complete(
    v_shop,
    jsonb_build_object(
      'sale', jsonb_build_object(
        'id', v_sale_before,
        'subtotal_ugx', 0,
        'tax_ugx', 0,
        'discount_ugx', 0,
        'total_ugx', 0,
        'cash_amount_ugx', 0,
        'debt_amount_ugx', 0,
        'payment_status', 'paid',
        'created_by', v_owner,
        'created_at', now(),
        'updated_at', now(),
        'completed_at', now(),
        'metadata', '{}'::jsonb
      ),
      'lines', '[]'::jsonb,
      'payments', '[]'::jsonb
    )
  );
  if not coalesce((v_push ->> 'ok')::boolean, false) then
    raise exception 'phase9 pre-upgrade sale failed: %', v_push;
  end if;

  -- M0: invite using client_id (what StaffAccount.id is after sync)
  v_m0 := public.shop_invite_staff(
    v_shop, 'phase9-worker@waka.invalid', 'cashier', 'cashier', v_client_id
  );
  insert into phase9_results values (
    'M0',
    coalesce((v_m0 ->> 'ok')::boolean, false)
      and (v_m0 ->> 'staff_id') = v_staff::text,
    v_m0::text
  );

  -- M9: non-owner cannot upgrade
  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  perform set_config('request.jwt.claim.email', 'phase9-manager@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_manager, 'email', 'phase9-manager@waka.invalid', 'role', 'authenticated')::text,
    true
  );
  v_m9 := public.shop_invite_staff(
    v_shop, 'phase9-other@waka.invalid', 'cashier', 'cashier', v_client_id
  );
  insert into phase9_results values (
    'M9',
    (v_m9 ->> 'ok') = 'false' and (v_m9 ->> 'error') = 'forbidden',
    v_m9::text
  );

  -- M1: accept upgrade (reuse M0 token)
  v_token := v_m0 ->> 'token';
  perform set_config('request.jwt.claim.sub', v_worker::text, true);
  perform set_config('request.jwt.claim.email', 'phase9-worker@waka.invalid', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_worker, 'email', 'phase9-worker@waka.invalid', 'role', 'authenticated')::text,
    true
  );
  v_accept := public.shop_accept_staff_invite(v_token);
  select s.id, s.user_id, s.pin_hash into v_same_id, v_linked, v_pin_after
  from public.shop_pos_staff s where s.id = v_staff;
  select count(*) into v_members
  from public.shop_members where shop_id = v_shop and user_id = v_worker;
  insert into phase9_results values (
    'M1',
    coalesce((v_accept ->> 'ok')::boolean, false)
      and (v_accept ->> 'linked_existing') = 'true'
      and v_same_id = v_staff
      and v_linked = v_worker
      and v_pin_after = v_pin
      and v_members = 1,
    format('accept=%s linked=%s pin=%s members=%s', v_accept, v_linked, v_pin_after, v_members)
  );

  -- M2: PIN hash still present and unchanged (PIN auth surface frozen)
  insert into phase9_results values (
    'M2',
    v_pin_after = v_pin and v_pin is not null,
    format('pin_after=%s', v_pin_after)
  );

  -- M3: Auth login identity — membership + linked staff exists for worker JWT
  insert into phase9_results values (
    'M3',
    v_members = 1
      and exists (
        select 1 from public.shop_pos_staff s
        where s.shop_id = v_shop and s.user_id = v_worker and s.id = v_staff
      ),
    format('members=%s', v_members)
  );

  -- M6: historical sale unchanged
  select s.created_by, s.sold_by_user_id into v_hist_created, v_hist_sold
  from public.sales s where s.id = v_sale_before;
  insert into phase9_results values (
    'M6',
    v_hist_created = v_owner and v_hist_sold is null,
    format('created=%s sold=%s', v_hist_created, v_hist_sold)
  );

  -- M4: Auth worker sale — created_by and sold_by = worker
  perform set_config('request.jwt.claim.sub', v_worker::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_worker, 'email', 'phase9-worker@waka.invalid', 'role', 'authenticated')::text,
    true
  );
  v_push := public.shop_push_sale_complete(
    v_shop,
    jsonb_build_object(
      'sale', jsonb_build_object(
        'id', v_sale_auth,
        'subtotal_ugx', 0,
        'tax_ugx', 0,
        'discount_ugx', 0,
        'total_ugx', 0,
        'cash_amount_ugx', 0,
        'debt_amount_ugx', 0,
        'payment_status', 'paid',
        'created_by', v_worker,
        'sold_by_user_id', v_worker::text,
        'created_at', now(),
        'updated_at', now(),
        'completed_at', now(),
        'metadata', '{}'::jsonb
      ),
      'lines', '[]'::jsonb,
      'payments', '[]'::jsonb
    )
  );
  select s.created_by, s.sold_by_user_id into v_created, v_sold
  from public.sales s where s.id = v_sale_auth;
  insert into phase9_results values (
    'M4',
    coalesce((v_push ->> 'ok')::boolean, false)
      and v_created = v_worker
      and v_sold = v_worker,
    format('push=%s created=%s sold=%s', v_push, v_created, v_sold)
  );

  -- M5: shared terminal — owner JWT, sold_by = worker
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'email', 'phase9-owner@waka.invalid', 'role', 'authenticated')::text,
    true
  );
  v_push := public.shop_push_sale_complete(
    v_shop,
    jsonb_build_object(
      'sale', jsonb_build_object(
        'id', v_sale_shared,
        'subtotal_ugx', 0,
        'tax_ugx', 0,
        'discount_ugx', 0,
        'total_ugx', 0,
        'cash_amount_ugx', 0,
        'debt_amount_ugx', 0,
        'payment_status', 'paid',
        'created_by', v_owner,
        'sold_by_user_id', v_worker::text,
        'created_at', now(),
        'updated_at', now(),
        'completed_at', now(),
        'metadata', '{}'::jsonb
      ),
      'lines', '[]'::jsonb,
      'payments', '[]'::jsonb
    )
  );
  select s.created_by, s.sold_by_user_id into v_created, v_sold
  from public.sales s where s.id = v_sale_shared;
  insert into phase9_results values (
    'M5',
    coalesce((v_push ->> 'ok')::boolean, false)
      and v_created = v_owner
      and v_sold = v_worker,
    format('push=%s created=%s sold=%s', v_push, v_created, v_sold)
  );

  -- M8: already linked rejected
  v_m8 := public.shop_invite_staff(
    v_shop, 'phase9-other@waka.invalid', 'cashier', 'cashier', v_client_id
  );
  insert into phase9_results values (
    'M8',
    (v_m8 ->> 'ok') = 'false' and (v_m8 ->> 'error') = 'staff_already_linked',
    v_m8::text
  );

  -- M7: Phase 4 unique — second staff row cannot take same user_id
  insert into public.shop_pos_staff (
    shop_id, client_id, name, role, pin_hash, is_active, user_id
  ) values (
    v_shop, gen_random_uuid(), 'Phase9 Dup', 'waiter', 'other-pin', true, null
  )
  returning id into v_staff2;

  begin
    update public.shop_pos_staff set user_id = v_worker where id = v_staff2;
    v_dup_ok := false;
  exception
    when unique_violation then
      v_dup_ok := true;
  end;
  insert into phase9_results values (
    'M7',
    v_dup_ok,
    format('dup_blocked=%s staff2=%s', v_dup_ok, v_staff2)
  );

  -- Also confirm server-id invite path still works (fresh staff + email)
  insert into public.shop_pos_staff (
    shop_id, client_id, name, role, pin_hash, is_active, user_id
  ) values (
    v_shop, gen_random_uuid(), 'Phase9 ServerId', 'waiter', 'pin-b', true, null
  )
  returning id into v_staff2;

  v_invite2 := public.shop_invite_staff(
    v_shop, 'phase9-other@waka.invalid', 'waiter', 'waiter', v_staff2
  );
  insert into phase9_results values (
    'M0b',
    coalesce((v_invite2 ->> 'ok')::boolean, false)
      and (v_invite2 ->> 'staff_id') = v_staff2::text,
    v_invite2::text
  );
end;
$$;

select * from phase9_results order by id;

do $$
declare
  v_fail text;
  v_pass int;
begin
  select count(*) into v_pass
  from phase9_results
  where ok and id in ('M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9');
  select string_agg(id, ', ') into v_fail
  from phase9_results
  where ok is not true and id in ('M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9');
  insert into phase9_results values (
    'GATE',
    v_fail is null,
    format('required_pass=%s/10 fail=%s', v_pass, coalesce(v_fail, 'none'))
  );
end;
$$;

select * from phase9_results order by id;

rollback;

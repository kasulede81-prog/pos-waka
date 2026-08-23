-- STAFF-V2 Phase 8 live checks P1/P2/P4 on a throwaway shop (client mapping + Phase 7).
-- P3 offline and P5 accountKey are covered by static vitest.
-- Intended to run inside one transaction and ROLLBACK.

begin;

create temporary table phase8_results (
  id text primary key,
  ok boolean not null,
  detail text
);

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_cashier uuid := gen_random_uuid();
  v_org uuid;
  v_shop uuid;
  v_staff uuid;
  v_sale_id uuid;
  v_push jsonb;
  v_retry jsonb;
  v_created uuid;
  v_sold uuid;
  v_sold_after uuid;
  v_validated uuid;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', v_owner, 'authenticated', 'authenticated',
     'phase8-owner@waka.invalid', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_cashier, 'authenticated', 'authenticated',
     'phase8-cashier@waka.invalid', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.organizations (id, name, created_by)
  values (gen_random_uuid(), 'PHASE8 THROW AWAY ORG', v_owner)
  returning id into v_org;

  insert into public.shops (organization_id, name, code)
  values (v_org, 'PHASE8 THROW AWAY SHOP', 'P8A')
  returning id into v_shop;

  insert into public.shop_members (shop_id, user_id, role) values
    (v_shop, v_owner, 'owner'),
    (v_shop, v_cashier, 'cashier');

  insert into public.shop_pos_staff (
    shop_id, client_id, name, role, pin_hash, is_active, user_id
  ) values (
    v_shop, gen_random_uuid(), 'Phase8 Linked John', 'cashier', 'phase8-pin', true, v_cashier
  )
  returning id into v_staff;

  -- Confirm download payload includes user_id
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );

  insert into phase8_results
  select 'DOWNLOAD',
    exists (
      select 1
      from jsonb_array_elements(
        coalesce((public.shop_pos_staff_download(v_shop, 0, 'p8-device') -> 'changed'), '[]'::jsonb)
      ) e
      where (e ->> 'user_id')::uuid = v_cashier
    ),
    (public.shop_pos_staff_download(v_shop, 0, 'p8-device') -> 'changed')::text;

  -- P1: owner JWT writes; sold_by = linked cashier (simulates Phase 8 client payload)
  v_sale_id := gen_random_uuid();
  v_push := public.shop_push_sale_complete(
    v_shop,
    jsonb_build_object(
      'sale', jsonb_build_object(
        'id', v_sale_id,
        'subtotal_ugx', 0,
        'tax_ugx', 0,
        'discount_ugx', 0,
        'total_ugx', 0,
        'cash_amount_ugx', 0,
        'debt_amount_ugx', 0,
        'payment_status', 'paid',
        'created_by', v_owner,
        'sold_by_user_id', v_cashier::text,
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
  from public.sales s where s.id = v_sale_id;

  insert into phase8_results values (
    'P1',
    coalesce((v_push ->> 'ok')::boolean, false)
      and v_created = v_owner
      and v_sold = v_cashier,
    format('push=%s created=%s sold=%s', v_push, v_created, v_sold)
  );

  -- P2: legacy unlinked — null sold_by
  v_validated := public.staff_v2_validate_sold_by_user_id(
    v_shop,
    jsonb_build_object('sold_by_user_id', 'staff:' || v_staff::text),
    v_owner
  );
  insert into phase8_results values (
    'P2',
    v_validated is null,
    format('validated=%s', v_validated)
  );

  -- P4 fill-once
  v_retry := public.shop_push_sale_complete(
    v_shop,
    jsonb_build_object(
      'sale', jsonb_build_object(
        'id', v_sale_id,
        'subtotal_ugx', 0,
        'tax_ugx', 0,
        'discount_ugx', 0,
        'total_ugx', 0,
        'cash_amount_ugx', 0,
        'debt_amount_ugx', 0,
        'payment_status', 'paid',
        'created_by', v_owner,
        'sold_by_user_id', v_owner::text,
        'created_at', now(),
        'updated_at', now(),
        'completed_at', now(),
        'metadata', '{}'::jsonb
      ),
      'lines', '[]'::jsonb,
      'payments', '[]'::jsonb
    )
  );
  select s.sold_by_user_id into v_sold_after from public.sales s where s.id = v_sale_id;
  insert into phase8_results values (
    'P4',
    coalesce((v_retry ->> 'ok')::boolean, false) and v_sold_after = v_cashier,
    format('retry=%s sold_after=%s', v_retry, v_sold_after)
  );
end;
$$;

select * from phase8_results order by id;

do $$
declare
  v_fail text;
  v_pass int;
begin
  select count(*) into v_pass from phase8_results where ok and id in ('P1', 'P2', 'P4', 'DOWNLOAD');
  select string_agg(id, ', ') into v_fail
  from phase8_results
  where ok is not true and id in ('P1', 'P2', 'P4', 'DOWNLOAD');
  insert into phase8_results values (
    'GATE',
    v_fail is null,
    format('required_pass=%s/4 fail=%s', v_pass, coalesce(v_fail, 'none'))
  );
end;
$$;

select * from phase8_results order by id;

rollback;

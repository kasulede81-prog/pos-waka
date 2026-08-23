-- STAFF-V2 Phase 7 live checks S1–S6 on a throwaway shop.
-- Intended to run inside one transaction and ROLLBACK.
-- Do not run against tenant shops.

begin;

create temporary table phase7_results (
  id text primary key,
  ok boolean not null,
  detail text
);

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_cashier uuid := gen_random_uuid();
  v_foreign uuid := gen_random_uuid();
  v_shop_b_user uuid := gen_random_uuid();
  v_org uuid;
  v_shop_a uuid;
  v_shop_b uuid;
  v_sale_id uuid;
  v_sale2 uuid;
  v_push jsonb;
  v_retry jsonb;
  v_created uuid;
  v_sold uuid;
  v_sold_after uuid;
  v_validated uuid;
  v_staff uuid;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', v_owner, 'authenticated', 'authenticated',
     'phase7-owner@waka.invalid', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_cashier, 'authenticated', 'authenticated',
     'phase7-cashier@waka.invalid', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_foreign, 'authenticated', 'authenticated',
     'phase7-foreign@waka.invalid', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_shop_b_user, 'authenticated', 'authenticated',
     'phase7-shopb@waka.invalid', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.organizations (id, name, created_by)
  values (gen_random_uuid(), 'PHASE7 THROW AWAY ORG', v_owner)
  returning id into v_org;

  insert into public.shops (organization_id, name, code)
  values (v_org, 'PHASE7 THROW AWAY SHOP A', 'P7A')
  returning id into v_shop_a;

  insert into public.shops (organization_id, name, code)
  values (v_org, 'PHASE7 THROW AWAY SHOP B', 'P7B')
  returning id into v_shop_b;

  insert into public.shop_members (shop_id, user_id, role) values
    (v_shop_a, v_owner, 'owner'),
    (v_shop_a, v_cashier, 'cashier'),
    (v_shop_b, v_owner, 'owner'),
    (v_shop_b, v_shop_b_user, 'cashier');

  insert into public.shop_pos_staff (shop_id, client_id, name, role, pin_hash, is_active)
  values (v_shop_a, gen_random_uuid(), 'Phase7 Legacy PIN', 'cashier', 'phase7-pin-hash', true)
  returning id into v_staff;

  -- Helper: set JWT as a given user
  perform set_config('request.jwt.claim.sub', v_cashier::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_cashier, 'role', 'authenticated')::text,
    true
  );

  -- S1 Auth cashier attribution via push RPC
  -- Zero totals + empty lines satisfy validate_sale_push_financials (identity-only gate).
  v_sale_id := gen_random_uuid();
  v_push := public.shop_push_sale_complete(
    v_shop_a,
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
        'created_by', v_cashier,
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

  select s.created_by, s.sold_by_user_id
  into v_created, v_sold
  from public.sales s
  where s.id = v_sale_id;

  insert into phase7_results values (
    'S1',
    coalesce((v_push ->> 'ok')::boolean, false)
      and v_created = v_cashier
      and v_sold = v_cashier,
    format('push=%s created=%s sold=%s', v_push, v_created, v_sold)
  );

  -- S2 Foreign Auth UUID rejected (sale continues, sold_by NULL)
  v_sale2 := gen_random_uuid();
  v_push := public.shop_push_sale_complete(
    v_shop_a,
    jsonb_build_object(
      'sale', jsonb_build_object(
        'id', v_sale2,
        'subtotal_ugx', 0,
        'tax_ugx', 0,
        'discount_ugx', 0,
        'total_ugx', 0,
        'cash_amount_ugx', 0,
        'debt_amount_ugx', 0,
        'payment_status', 'paid',
        'created_by', v_cashier,
        'sold_by_user_id', v_foreign::text,
        'created_at', now(),
        'updated_at', now(),
        'completed_at', now(),
        'metadata', '{}'::jsonb
      ),
      'lines', '[]'::jsonb,
      'payments', '[]'::jsonb
    )
  );

  select s.sold_by_user_id into v_sold from public.sales s where s.id = v_sale2;

  insert into phase7_results values (
    'S2',
    coalesce((v_push ->> 'ok')::boolean, false) and v_sold is null,
    format('push=%s sold=%s', v_push, v_sold)
  );

  -- S3 Other-shop member rejected by validator
  v_validated := public.staff_v2_validate_sold_by_user_id(
    v_shop_a,
    jsonb_build_object('sold_by_user_id', v_shop_b_user::text),
    v_cashier
  );
  insert into phase7_results values (
    'S3',
    v_validated is null,
    format('validated=%s', v_validated)
  );

  -- S4 Legacy PIN / staff:<id> / non-UUID → NULL (client sends null; also malformed string)
  v_validated := public.staff_v2_validate_sold_by_user_id(
    v_shop_a,
    jsonb_build_object('sold_by_user_id', 'staff:' || v_staff::text),
    v_owner
  );
  insert into phase7_results values (
    'S4',
    v_validated is null,
    format('validated=%s staff=%s', v_validated, v_staff)
  );

  -- S5 Deferred: linked PIN attribution needs Phase 8 client wiring.
  -- Document server readiness: membership-only path would accept linked UUID if sent.
  v_validated := public.staff_v2_validate_sold_by_user_id(
    v_shop_a,
    jsonb_build_object('sold_by_user_id', v_cashier::text),
    v_owner
  );
  insert into phase7_results values (
    'S5',
    v_validated = v_cashier, -- server-ready membership path; full E2E deferred to Phase 8
    format('server_ready_membership=%s (Phase 8 client deferred)', v_validated)
  );

  -- S6 Fill-once: retry with different seller must keep original
  perform set_config('request.jwt.claim.sub', v_cashier::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_cashier, 'role', 'authenticated')::text,
    true
  );

  v_retry := public.shop_push_sale_complete(
    v_shop_a,
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
        'created_by', v_cashier,
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

  insert into phase7_results values (
    'S6',
    coalesce((v_retry ->> 'ok')::boolean, false)
      and v_sold_after = v_cashier,
    format('retry=%s sold_after=%s expected=%s', v_retry, v_sold_after, v_cashier)
  );
end;
$$;

select * from phase7_results order by id;

-- Soft gate: emit summary instead of aborting so results remain visible.
do $$
declare
  v_fail text;
  v_pass int;
begin
  select count(*) into v_pass from phase7_results where ok and id in ('S1', 'S2', 'S3', 'S4', 'S6');
  select string_agg(id, ', ')
  into v_fail
  from phase7_results
  where ok is not true
    and id in ('S1', 'S2', 'S3', 'S4', 'S6');
  insert into phase7_results values (
    'GATE',
    v_fail is null,
    format('required_pass=%s/5 fail=%s', v_pass, coalesce(v_fail, 'none'))
  );
end;
$$;

select * from phase7_results order by id;

rollback;

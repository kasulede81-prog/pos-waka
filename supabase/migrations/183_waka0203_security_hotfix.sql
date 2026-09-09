-- WAKA-02 / WAKA-03 / R8 — security hotfix.
--
-- WAKA-02: `_apply_durable_stock_delta` is SECURITY DEFINER and was revoked
-- from PUBLIC and `authenticated` only. Supabase grants EXECUTE to `anon`
-- separately from PUBLIC, so the internal stock primitive stayed callable
-- with the anon key (`POST /rest/v1/rpc/_apply_durable_stock_delta`).
--
-- WAKA-03: `_report_*` / `_shop_completed_sales_count_for_day` were
-- SECURITY DEFINER with no (or PUBLIC-only) EXECUTE revoke, and
-- `shop_pos_staff_revisions`, `waka_shop_number_counter`,
-- `waka_shop_number_released` had RLS disabled.
--
-- R8: SECURITY DEFINER functions missing a trusted `search_path` are
-- hardened in-place. Invoker functions are left untouched.
--
-- Idempotent: safe to re-run. Does not change business authorization on
-- the public `shop_*` RPCs.

-- ---------------------------------------------------------------------------
-- Roles PostgREST uses. Exist on hosted Supabase; created here for PGLite.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

grant usage on schema public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- WAKA-02 — internal stock primitive: not callable by clients.
-- ---------------------------------------------------------------------------
create or replace function public._apply_durable_stock_delta (
  p_shop_id uuid,
  p_product_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_delta numeric,
  p_reason text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_stock numeric;
  v_server_updated_at timestamptz;
  v_new_stock numeric;
  v_movement_id uuid;
  v_already boolean := false;
  v_uid uuid := auth.uid();
begin
  -- Defence in depth: even if EXECUTE is re-granted, unauthenticated callers
  -- cannot mutate stock. Domain RPCs run with a JWT, so auth.uid() is set.
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if p_reference_type not in ('adjustment', 'inventory_count', 'sale_void', 'purchase_void') then
    return jsonb_build_object('ok', false, 'error', 'invalid_reference_type');
  end if;
  if p_product_id is null or p_reference_id is null or p_shop_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;
  if p_delta is null or p_delta = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_delta');
  end if;

  select p.stock_on_hand, p.updated_at
  into v_server_stock, v_server_updated_at
  from public.products p
  where p.id = p_product_id and p.shop_id = p_shop_id and p.is_active = true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'product_not_found');
  end if;

  select exists (
    select 1
    from public.inventory_movements im
    where im.shop_id = p_shop_id
      and im.reference_type = p_reference_type
      and im.reference_id = p_reference_id
      and im.product_id = p_product_id
  ) into v_already;

  if v_already then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'stock_on_hand', v_server_stock,
      'updated_at', v_server_updated_at
    );
  end if;

  v_new_stock := greatest(coalesce(v_server_stock, 0) + p_delta, 0);

  update public.products p
  set stock_on_hand = v_new_stock,
      updated_at = now()
  where p.id = p_product_id and p.shop_id = p_shop_id;

  v_movement_id := public.inventory_movement_uuid (
    p_shop_id,
    p_reference_type,
    p_reference_id,
    p_product_id
  );

  insert into public.inventory_movements (
    id,
    shop_id,
    product_id,
    quantity_delta,
    reason,
    reference_type,
    reference_id,
    note,
    created_by
  )
  values (
    v_movement_id,
    p_shop_id,
    p_product_id,
    p_delta,
    coalesce(nullif(p_reason, ''), 'adjustment'),
    p_reference_type,
    p_reference_id,
    p_note,
    v_uid
  )
  on conflict (id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'stock_on_hand', v_new_stock,
    'updated_at', (select updated_at from public.products where id = p_product_id)
  );
exception
  when unique_violation then
    select p.stock_on_hand, p.updated_at
    into v_server_stock, v_server_updated_at
    from public.products p
    where p.id = p_product_id and p.shop_id = p_shop_id;
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'stock_on_hand', v_server_stock,
      'updated_at', v_server_updated_at
    );
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public._apply_durable_stock_delta (uuid, uuid, text, uuid, numeric, text, text) from public;
revoke all on function public._apply_durable_stock_delta (uuid, uuid, text, uuid, numeric, text, text) from anon;
revoke all on function public._apply_durable_stock_delta (uuid, uuid, text, uuid, numeric, text, text) from authenticated;

-- ---------------------------------------------------------------------------
-- WAKA-03 — revoke EXECUTE on every public `_`-prefixed helper.
-- Domain `shop_*` RPCs stay granted to `authenticated`; they call these as
-- SECURITY DEFINER (owner), so nested EXECUTE still succeeds.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as ident
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like '\_%' escape '\'
      and p.prokind in ('f', 'p')
  loop
    execute format('revoke all on function %s from public', r.ident);
    execute format('revoke all on function %s from anon', r.ident);
    execute format('revoke all on function %s from authenticated', r.ident);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- WAKA-03 — shop-access guards on the named financial helpers (if present).
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.expenses') is not null then
    execute $fn$
      create or replace function public._report_cash_drawer_expenses_ugx (
        p_shop uuid,
        p_start date,
        p_end date
      )
      returns bigint
      language sql
      stable
      security definer
      set search_path = public
      as $body$
        select coalesce(sum(e.amount_ugx), 0)::bigint
        from public.expenses e
        where e.shop_id = p_shop
          and public.user_can_access_shop(p_shop)
          and e.expense_type = 'cash_drawer'
          and e.deleted_at is null
          and e.paid_on between p_start and p_end;
      $body$;
    $fn$;
    execute 'revoke all on function public._report_cash_drawer_expenses_ugx(uuid, date, date) from public, anon, authenticated';
  end if;

  if to_regclass('public.sales') is not null then
    execute $fn$
      create or replace function public._shop_completed_sales_count_for_day (
        p_shop_id uuid,
        p_date_key text
      )
      returns bigint
      language sql
      stable
      security definer
      set search_path = public
      as $body$
        select count(*)::bigint
        from public.sales s
        where s.shop_id = p_shop_id
          and public.user_can_access_shop(p_shop_id)
          and s.status = 'completed'
          and to_char((s.created_at at time zone 'Africa/Kampala'), 'YYYY-MM-DD') = p_date_key;
      $body$;
    $fn$;
    execute 'revoke all on function public._shop_completed_sales_count_for_day(uuid, text) from public, anon, authenticated';
  end if;

  if to_regclass('public.sales') is not null
     and to_regclass('public.sale_returns') is not null
     and to_regclass('public.sale_voids') is not null
     and exists (
       select 1 from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = '_sale_kampala_day'
     )
  then
    execute $fn$
      create or replace function public._report_period_remaining_cash_debt (
        p_shop uuid,
        p_start date,
        p_end date,
        p_created_only boolean default false
      )
      returns table (
        cash_ugx bigint,
        debt_ugx bigint
      )
      language sql
      stable
      security definer
      set search_path = public
      as $body$
        with sales_in as (
          select
            s.id,
            coalesce(s.cash_amount_ugx, 0)::bigint as cash_amount_ugx,
            coalesce(s.debt_amount_ugx, 0)::bigint as debt_amount_ugx
          from public.sales s
          where s.shop_id = p_shop
            and public.user_can_access_shop(p_shop)
            and s.status = 'completed'
            and case
              when p_created_only then public._sale_kampala_day(s.created_at)
              else public._sale_kampala_day(coalesce(s.completed_at, s.created_at))
            end between p_start and p_end
        ),
        adj as (
          select
            x.sale_id,
            coalesce(sum(x.amount_ugx), 0)::bigint as amount_ugx
          from (
            select sr.sale_id, sr.refund_amount_ugx as amount_ugx
            from public.sale_returns sr
            where sr.shop_id = p_shop
              and sr.sale_id is not null
            union all
            select sv.sale_id, sv.amount_ugx
            from public.sale_voids sv
            where sv.shop_id = p_shop
          ) x
          group by x.sale_id
        )
        select
          coalesce(sum(greatest(
            0,
            s.cash_amount_ugx - least(s.cash_amount_ugx, coalesce(a.amount_ugx, 0))
          )), 0)::bigint as cash_ugx,
          coalesce(sum(greatest(
            0,
            s.debt_amount_ugx - greatest(
              0,
              coalesce(a.amount_ugx, 0) - least(s.cash_amount_ugx, coalesce(a.amount_ugx, 0))
            )
          )), 0)::bigint as debt_ugx
        from sales_in s
        left join adj a on a.sale_id = s.id;
      $body$;
    $fn$;
    execute 'revoke all on function public._report_period_remaining_cash_debt(uuid, date, date, boolean) from public, anon, authenticated';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- WAKA-03 — RLS on the three advisor-flagged public tables.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.shop_pos_staff_revisions') is not null then
    execute 'alter table public.shop_pos_staff_revisions enable row level security';
    execute 'drop policy if exists shop_pos_staff_revisions_select on public.shop_pos_staff_revisions';
    execute $pol$
      create policy shop_pos_staff_revisions_select
        on public.shop_pos_staff_revisions
        for select
        to authenticated
        using (public.user_can_access_shop(shop_id))
    $pol$;
    execute 'revoke all on table public.shop_pos_staff_revisions from public';
    execute 'revoke all on table public.shop_pos_staff_revisions from anon';
    execute 'grant select on table public.shop_pos_staff_revisions to authenticated';
  end if;

  -- Platform counters are not shop-scoped. Enable RLS with no policies so
  -- anon/authenticated table access is denied; SECURITY DEFINER number
  -- allocators (table owner) continue to work.
  if to_regclass('public.waka_shop_number_counter') is not null then
    execute 'alter table public.waka_shop_number_counter enable row level security';
    execute 'revoke all on table public.waka_shop_number_counter from public';
    execute 'revoke all on table public.waka_shop_number_counter from anon';
    execute 'revoke all on table public.waka_shop_number_counter from authenticated';
  end if;

  if to_regclass('public.waka_shop_number_released') is not null then
    execute 'alter table public.waka_shop_number_released enable row level security';
    execute 'revoke all on table public.waka_shop_number_released from public';
    execute 'revoke all on table public.waka_shop_number_released from anon';
    execute 'revoke all on table public.waka_shop_number_released from authenticated';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- R8 — trusted search_path on SECURITY DEFINER functions that lack one.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select
      p.oid::regprocedure as ident,
      p.prokind
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg
        where cfg like 'search_path=%'
      )
  loop
    execute format(
      'alter %s %s set search_path = public',
      case when r.prokind = 'p' then 'procedure' else 'function' end,
      r.ident
    );
  end loop;
end
$$;

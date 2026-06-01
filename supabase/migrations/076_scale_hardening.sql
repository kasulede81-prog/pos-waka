-- Scale Hardening Sprint: subscription enforcement, debt payments, stock OCC, role helpers.

-- ---------- Subscription tier helpers (mirror client subscriptionEntitlements.ts) ----------
create or replace function public._plan_rank (p_code text)
returns int
language sql
immutable
as $$
  select case lower(trim(coalesce(p_code, 'free')))
    when 'free' then 0
    when 'free_mode' then 0
    when 'starter' then 1
    when 'business' then 2
    when 'waka_plus' then 3
    when 'waka plus' then 3
    else 1
  end;
$$;

create or replace function public.shop_org_id (p_shop_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select sh.organization_id from public.shops sh where sh.id = p_shop_id;
$$;

create or replace function public.shop_effective_plan_code (p_shop_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_status text;
  v_code text;
  v_period_end timestamptz;
begin
  v_org := public.shop_org_id(p_shop_id);
  if v_org is null then
    return 'free';
  end if;

  select sub.status, sp.code, sub.current_period_end
  into v_status, v_code, v_period_end
  from public.subscriptions sub
  join public.subscription_plans sp on sp.id = sub.plan_id
  where sub.organization_id = v_org
  order by sub.created_at desc
  limit 1;

  if v_code is null then
    return 'free';
  end if;

  v_status := lower(trim(coalesce(v_status, '')));
  if v_status in ('trial', 'trialing') then
    return 'free';
  end if;
  if v_status = 'expired' then
    return 'free';
  end if;
  if v_status = 'active' and v_period_end is not null and v_period_end <= now() then
    return 'free';
  end if;

  return lower(trim(v_code));
end;
$$;

create or replace function public.shop_plan_allows_feature (p_shop_id uuid, p_feature text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tier text := public.shop_effective_plan_code(p_shop_id);
  v_rank int := public._plan_rank(v_tier);
  v_need int;
begin
  v_need := case lower(trim(coalesce(p_feature, '')))
    when 'profit_reports' then 1
    when 'owner_dashboard' then 2
    when 'staff_accounts' then 2
    when 'unlimited_products' then 1
    else 0
  end;
  return v_rank >= v_need;
end;
$$;

create or replace function public.shop_assert_plan_feature (p_shop_id uuid, p_feature text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.shop_plan_allows_feature(p_shop_id, p_feature) then
    raise exception 'subscription_required:%', coalesce(p_feature, 'unknown');
  end if;
end;
$$;

-- ---------- Shop member role + permission helpers ----------
create or replace function public.shop_member_role_for_user (p_shop_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select sm.role
  from public.shop_members sm
  where sm.shop_id = p_shop_id
    and sm.user_id = p_user_id
  limit 1;
$$;

create or replace function public.shop_user_has_permission (p_shop_id uuid, p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    return false;
  end if;

  v_role := public.shop_member_role_for_user(p_shop_id, v_uid);

  if v_role is null then
    if exists (
      select 1
      from public.shops sh
      join public.organization_members om on om.organization_id = sh.organization_id
      where sh.id = p_shop_id
        and om.user_id = v_uid
        and om.role in ('owner', 'admin')
    ) then
      v_role := 'owner';
    else
      return false;
    end if;
  end if;

  return case lower(trim(coalesce(p_permission, '')))
    when 'sale_void' then v_role in ('owner', 'manager', 'cashier', 'supervisor')
    when 'reports.profit' then v_role in ('owner', 'manager', 'supervisor')
      and public.shop_plan_allows_feature(p_shop_id, 'profit_reports')
    when 'owner.dashboard' then v_role = 'owner'
      and public.shop_plan_allows_feature(p_shop_id, 'owner_dashboard')
    else public.user_is_cashier_or_above(p_shop_id)
  end;
end;
$$;

-- Expand cashier-or-above to include shop owner + stock/waiter roles
create or replace function public.user_is_cashier_or_above (p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_members sm
    where sm.shop_id = p_shop
      and sm.user_id = auth.uid ()
      and sm.role in ('owner', 'manager', 'cashier', 'stock_keeper', 'waiter', 'viewer')
  )
  or public.user_can_manage_shop (p_shop);
$$;

-- ---------- Debt payment sync ----------
create table if not exists public.customer_debt_payments (
  id uuid primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  amount_ugx bigint not null check (amount_ugx > 0),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists customer_debt_payments_shop_customer_idx
  on public.customer_debt_payments (shop_id, customer_id, created_at desc);

alter table public.customer_debt_payments enable row level security;

drop policy if exists customer_debt_payments_select on public.customer_debt_payments;
create policy customer_debt_payments_select
  on public.customer_debt_payments for select
  using (public.user_is_cashier_or_above (shop_id));

drop policy if exists customer_debt_payments_insert on public.customer_debt_payments;
create policy customer_debt_payments_insert
  on public.customer_debt_payments for insert
  with check (public.user_is_cashier_or_above (shop_id));

create or replace function public.shop_push_debt_payment (
  p_shop_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_payment_id uuid;
  v_customer_id uuid;
  v_amount bigint;
  v_created_at timestamptz;
  v_expected_balance bigint;
  v_current_balance bigint;
  v_new_balance bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_is_cashier_or_above(p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_payment_id := nullif(p_payload ->> 'payment_id', '')::uuid;
  v_customer_id := nullif(p_payload ->> 'customer_id', '')::uuid;
  v_amount := coalesce((p_payload ->> 'amount_ugx')::bigint, 0);
  v_created_at := coalesce(nullif(p_payload ->> 'created_at', '')::timestamptz, now());
  v_expected_balance := nullif(p_payload ->> 'expected_balance_ugx', '')::bigint;

  if v_payment_id is null or v_customer_id is null or v_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;

  if exists (
    select 1 from public.customer_debt_payments dp
    where dp.id = v_payment_id and dp.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;

  select greatest(coalesce((c.metadata ->> 'debtBalanceUgx')::bigint, 0), 0)
  into v_current_balance
  from public.customers c
  where c.id = v_customer_id and c.shop_id = p_shop_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'customer_not_found');
  end if;

  if v_expected_balance is not null and v_expected_balance <> v_current_balance then
    return jsonb_build_object(
      'ok', false,
      'error', 'stale_balance',
      'server_balance_ugx', v_current_balance
    );
  end if;

  v_new_balance := greatest(v_current_balance - v_amount, 0);
  if v_amount > v_current_balance then
    return jsonb_build_object('ok', false, 'error', 'amount_exceeds_balance');
  end if;

  insert into public.customer_debt_payments (id, shop_id, customer_id, amount_ugx, created_at, metadata)
  values (
    v_payment_id,
    p_shop_id,
    v_customer_id,
    v_amount,
    v_created_at,
    coalesce(p_payload -> 'metadata', '{}'::jsonb)
  );

  update public.customers c
  set metadata = jsonb_set(
        coalesce(c.metadata, '{}'::jsonb),
        '{debtBalanceUgx}',
        to_jsonb(v_new_balance),
        true
      ),
      updated_at = now()
  where c.id = v_customer_id and c.shop_id = p_shop_id;

  return jsonb_build_object(
    'ok', true,
    'new_balance_ugx', v_new_balance,
    'payment_id', v_payment_id
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', true, 'idempotent', true);
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_push_debt_payment (uuid, jsonb) from public;
grant execute on function public.shop_push_debt_payment (uuid, jsonb) to authenticated;

-- ---------- Product stock optimistic concurrency ----------
create or replace function public.shop_push_product_stock (
  p_shop_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_product_id uuid;
  v_delta numeric;
  v_base_updated_at timestamptz;
  v_base_stock numeric;
  v_server_updated_at timestamptz;
  v_server_stock numeric;
  v_new_stock numeric;
  v_note text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_is_cashier_or_above(p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_product_id := nullif(p_payload ->> 'product_id', '')::uuid;
  v_delta := coalesce((p_payload ->> 'delta')::numeric, 0);
  v_base_updated_at := nullif(p_payload ->> 'base_updated_at', '')::timestamptz;
  v_base_stock := nullif(p_payload ->> 'base_stock_on_hand', '')::numeric;
  v_note := nullif(p_payload ->> 'note', '');

  if v_product_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_product');
  end if;

  select p.stock_on_hand, p.updated_at
  into v_server_stock, v_server_updated_at
  from public.products p
  where p.id = v_product_id and p.shop_id = p_shop_id and p.is_active = true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'product_not_found');
  end if;

  if v_base_updated_at is not null
     and v_server_updated_at > v_base_updated_at
     and v_base_stock is not null
     and v_server_stock is distinct from v_base_stock then
    return jsonb_build_object(
      'ok', false,
      'error', 'stale_version',
      'server_stock_on_hand', v_server_stock,
      'server_updated_at', v_server_updated_at
    );
  end if;

  v_new_stock := greatest(coalesce(v_server_stock, 0) + v_delta, 0);

  update public.products p
  set stock_on_hand = v_new_stock,
      updated_at = now(),
      metadata = case
        when v_note is not null then
          jsonb_set(coalesce(p.metadata, '{}'::jsonb), '{lastStockNote}', to_jsonb(v_note), true)
        else p.metadata
      end
  where p.id = v_product_id and p.shop_id = p_shop_id;

  return jsonb_build_object(
    'ok', true,
    'stock_on_hand', v_new_stock,
    'updated_at', (select updated_at from public.products where id = v_product_id)
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_push_product_stock (uuid, jsonb) from public;
grant execute on function public.shop_push_product_stock (uuid, jsonb) to authenticated;

-- ---------- Gate profit fields in daily summary for free tier ----------
create or replace function public.shop_get_daily_sales_summary (p_day date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop uuid := public._report_assert_shop ();
  v_day date := coalesce (p_day, public._sale_kampala_day (now ()));
  v_row record;
  v_profit bigint := 0;
  v_allow_profit boolean;
begin
  v_allow_profit := public.shop_plan_allows_feature(v_shop, 'profit_reports');

  select
    count(*)::int as tx_count,
    coalesce (sum(s.total_ugx), 0)::bigint as revenue,
    coalesce (sum(s.cash_amount_ugx), 0)::bigint as cash,
    coalesce (sum(s.debt_amount_ugx), 0)::bigint as debt,
    coalesce (sum(s.discount_ugx), 0)::bigint as discounts,
    coalesce (sum(s.tax_ugx), 0)::bigint as taxes
  into v_row
  from public.sales s
  where s.shop_id = v_shop
    and s.status = 'completed'
    and public._sale_kampala_day (coalesce (s.completed_at, s.created_at)) = v_day;

  if v_allow_profit then
    select coalesce (sum(
      coalesce (
        nullif ((sli.metadata ->> 'estimatedProfitUgx')::bigint, null),
        sli.line_total_ugx - round(
          sli.quantity * coalesce (
            nullif ((sli.metadata ->> 'unitCostUgx')::numeric, null),
            p.cost_price_per_unit_ugx,
            0
          )
        )::bigint
      )
    ), 0)::bigint
    into v_profit
    from public.sale_line_items sli
    join public.sales s on s.id = sli.sale_id
    left join public.products p on p.id = sli.product_id
    where s.shop_id = v_shop
      and s.status = 'completed'
      and public._sale_kampala_day (coalesce (s.completed_at, s.created_at)) = v_day;
  end if;

  return jsonb_build_object (
    'ok', true,
    'day', v_day,
    'transaction_count', coalesce (v_row.tx_count, 0),
    'total_revenue_ugx', coalesce (v_row.revenue, 0),
    'cash_collected_ugx', coalesce (v_row.cash, 0),
    'debt_issued_ugx', coalesce (v_row.debt, 0),
    'discounts_ugx', coalesce (v_row.discounts, 0),
    'taxes_ugx', coalesce (v_row.taxes, 0),
    'estimated_profit_ugx', case when v_allow_profit then coalesce (v_profit, 0) else null end,
    'profit_gated', not v_allow_profit,
    'average_transaction_ugx',
      case when coalesce (v_row.tx_count, 0) > 0
        then (coalesce (v_row.revenue, 0) / v_row.tx_count)::bigint
        else 0
      end
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

-- Gate product creation on free tier (7 product cap) via upsert RPC path used by clients
create or replace function public.shop_assert_product_limit (p_shop_id uuid, p_product_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if public.shop_plan_allows_feature(p_shop_id, 'unlimited_products') then
    return;
  end if;
  if exists (
    select 1 from public.products p
    where p.id = p_product_id and p.shop_id = p_shop_id
  ) then
    return;
  end if;
  select count(*)::int into v_count
  from public.products p
  where p.shop_id = p_shop_id and p.is_active = true;
  if v_count >= 7 then
    raise exception 'subscription_required:product_limit';
  end if;
end;
$$;

grant execute on function public.shop_effective_plan_code (uuid) to authenticated;
grant execute on function public.shop_plan_allows_feature (uuid, text) to authenticated;
grant execute on function public.shop_member_role_for_user (uuid, uuid) to authenticated;

-- Server-side shop reporting: aggregated RPCs (no raw sales download).

alter table public.sales add column if not exists metadata jsonb not null default '{}'::jsonb;

create or replace function public._sale_kampala_day (p_ts timestamptz)
returns date
language sql
stable
as $$
  select (coalesce (p_ts, now ()) at time zone 'Africa/Kampala')::date;
$$;

create or replace function public._report_shop_id ()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.waka_primary_shop_for_user ();
$$;

create or replace function public._report_assert_shop ()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop uuid;
begin
  if auth.uid () is null then
    raise exception 'not_authenticated';
  end if;
  v_shop := public._report_shop_id ();
  if v_shop is null then
    raise exception 'no_shop';
  end if;
  if not exists (
    select 1 from public.shop_members sm
    where sm.shop_id = v_shop and sm.user_id = auth.uid ()
  ) then
    raise exception 'forbidden';
  end if;
  return v_shop;
end;
$$;

create index if not exists sales_shop_completed_created_idx
  on public.sales (shop_id, created_at desc)
  where status = 'completed';

create index if not exists sale_line_items_product_idx
  on public.sale_line_items (product_id);

-- ---------- Daily summary ----------
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
begin
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

  return jsonb_build_object (
    'ok', true,
    'day', v_day,
    'transaction_count', coalesce (v_row.tx_count, 0),
    'total_revenue_ugx', coalesce (v_row.revenue, 0),
    'cash_collected_ugx', coalesce (v_row.cash, 0),
    'debt_issued_ugx', coalesce (v_row.debt, 0),
    'discounts_ugx', coalesce (v_row.discounts, 0),
    'taxes_ugx', coalesce (v_row.taxes, 0),
    'estimated_profit_ugx', coalesce (v_profit, 0),
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

-- ---------- Weekly summary (7-day window ending p_anchor_day) ----------
create or replace function public.shop_get_weekly_sales_summary (p_anchor_day date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop uuid := public._report_assert_shop ();
  v_end date := coalesce (p_anchor_day, public._sale_kampala_day (now ()));
  v_start date := v_end - 6;
  v_totals record;
  v_days jsonb;
  v_top jsonb;
  v_customers int;
begin
  select
    count(*)::int as tx_count,
    coalesce (sum(s.total_ugx), 0)::bigint as revenue,
    coalesce (sum(s.cash_amount_ugx), 0)::bigint as cash
  into v_totals
  from public.sales s
  where s.shop_id = v_shop
    and s.status = 'completed'
    and public._sale_kampala_day (coalesce (s.completed_at, s.created_at)) between v_start and v_end;

  select coalesce (
    jsonb_agg (
      jsonb_build_object (
        'day', d.day,
        'revenue_ugx', d.revenue,
        'transaction_count', d.tx_count
      )
      order by d.day
    ),
    '[]'::jsonb
  )
  into v_days
  from (
    select
      public._sale_kampala_day (coalesce (s.completed_at, s.created_at)) as day,
      coalesce (sum(s.total_ugx), 0)::bigint as revenue,
      count(*)::int as tx_count
    from public.sales s
    where s.shop_id = v_shop
      and s.status = 'completed'
      and public._sale_kampala_day (coalesce (s.completed_at, s.created_at)) between v_start and v_end
    group by 1
  ) d;

  select coalesce (
    jsonb_agg (
      jsonb_build_object (
        'product_id', t.product_id,
        'name', t.name,
        'quantity', t.qty,
        'revenue_ugx', t.revenue
      )
      order by t.revenue desc
    ),
    '[]'::jsonb
  )
  into v_top
  from (
    select
      sli.product_id,
      coalesce (max(sli.metadata ->> 'name'), max(p.name), 'Item') as name,
      coalesce (sum(sli.quantity), 0)::numeric as qty,
      coalesce (sum(sli.line_total_ugx), 0)::bigint as revenue
    from public.sale_line_items sli
    join public.sales s on s.id = sli.sale_id
    left join public.products p on p.id = sli.product_id
    where s.shop_id = v_shop
      and s.status = 'completed'
      and public._sale_kampala_day (coalesce (s.completed_at, s.created_at)) between v_start and v_end
    group by sli.product_id
    order by revenue desc
    limit 10
  ) t;

  select count(distinct s.customer_id)::int
  into v_customers
  from public.sales s
  where s.shop_id = v_shop
    and s.status = 'completed'
    and s.customer_id is not null
    and public._sale_kampala_day (coalesce (s.completed_at, s.created_at)) between v_start and v_end;

  return jsonb_build_object (
    'ok', true,
    'start_day', v_start,
    'end_day', v_end,
    'transaction_count', coalesce (v_totals.tx_count, 0),
    'total_revenue_ugx', coalesce (v_totals.revenue, 0),
    'cash_collected_ugx', coalesce (v_totals.cash, 0),
    'daily_trend', v_days,
    'top_products', v_top,
    'active_customers', coalesce (v_customers, 0)
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

-- ---------- Monthly summary ----------
create or replace function public.shop_get_monthly_sales_summary (p_month text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop uuid := public._report_assert_shop ();
  v_month text := coalesce (p_month, to_char (public._sale_kampala_day (now ()), 'YYYY-MM'));
  v_prev_month text := to_char ((to_date (v_month || '-01', 'YYYY-MM-DD') - interval '1 month')::date, 'YYYY-MM');
  v_cur record;
  v_prev record;
  v_profit bigint := 0;
  v_expenses bigint := 0;
begin
  if v_month !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_month');
  end if;

  select
    count(*)::int as tx_count,
    coalesce (sum(s.total_ugx), 0)::bigint as revenue,
    coalesce (sum(s.cash_amount_ugx), 0)::bigint as cash,
    coalesce (sum(s.debt_amount_ugx), 0)::bigint as debt
  into v_cur
  from public.sales s
  where s.shop_id = v_shop
    and s.status = 'completed'
    and to_char (public._sale_kampala_day (coalesce (s.completed_at, s.created_at)), 'YYYY-MM') = v_month;

  select coalesce (sum(s.total_ugx), 0)::bigint as revenue
  into v_prev
  from public.sales s
  where s.shop_id = v_shop
    and s.status = 'completed'
    and to_char (public._sale_kampala_day (coalesce (s.completed_at, s.created_at)), 'YYYY-MM') = v_prev_month;

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
    and to_char (public._sale_kampala_day (coalesce (s.completed_at, s.created_at)), 'YYYY-MM') = v_month;

  begin
    select coalesce (sum(e.amount_ugx), 0)::bigint
    into v_expenses
    from public.expenses e
    where e.shop_id = v_shop
      and to_char (e.paid_on, 'YYYY-MM') = v_month;
  exception
    when others then
      v_expenses := 0;
  end;

  return jsonb_build_object (
    'ok', true,
    'month', v_month,
    'transaction_count', coalesce (v_cur.tx_count, 0),
    'total_revenue_ugx', coalesce (v_cur.revenue, 0),
    'cash_collected_ugx', coalesce (v_cur.cash, 0),
    'debt_issued_ugx', coalesce (v_cur.debt, 0),
    'estimated_profit_ugx', coalesce (v_profit, 0),
    'expenses_ugx', coalesce (v_expenses, 0),
    'net_earnings_ugx', coalesce (v_profit, 0) - coalesce (v_expenses, 0),
    'previous_month_revenue_ugx', coalesce (v_prev.revenue, 0),
    'revenue_growth_pct',
      case
        when coalesce (v_prev.revenue, 0) <= 0 then null
        else round(((coalesce (v_cur.revenue, 0)::numeric - v_prev.revenue::numeric) / v_prev.revenue::numeric) * 100, 1)
      end
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

-- ---------- Top / slow products ----------
create or replace function public.shop_get_top_products (
  p_start_day date default null,
  p_end_day date default null,
  p_limit int default 10,
  p_order text default 'top'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop uuid := public._report_assert_shop ();
  v_end date := coalesce (p_end_day, public._sale_kampala_day (now ()));
  v_start date := coalesce (p_start_day, v_end - 6);
  v_rows jsonb;
begin
  select coalesce (
    jsonb_agg (
      jsonb_build_object (
        'product_id', t.product_id,
        'name', t.name,
        'quantity', t.qty,
        'revenue_ugx', t.revenue,
        'profit_ugx', t.profit
      )
    ),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      sli.product_id,
      coalesce (max(sli.metadata ->> 'name'), max(p.name), 'Item') as name,
      coalesce (sum(sli.quantity), 0)::numeric as qty,
      coalesce (sum(sli.line_total_ugx), 0)::bigint as revenue,
      coalesce (sum(
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
      ), 0)::bigint as profit
    from public.sale_line_items sli
    join public.sales s on s.id = sli.sale_id
    left join public.products p on p.id = sli.product_id
    where s.shop_id = v_shop
      and s.status = 'completed'
      and public._sale_kampala_day (coalesce (s.completed_at, s.created_at)) between v_start and v_end
    group by sli.product_id
    having coalesce (sum(sli.line_total_ugx), 0) > 0
    order by
      case when lower(coalesce (p_order, 'top')) = 'slow' then coalesce (sum(sli.line_total_ugx), 0) end asc nulls last,
      case when lower(coalesce (p_order, 'top')) <> 'slow' then coalesce (sum(sli.line_total_ugx), 0) end desc nulls last
    limit greatest (1, least (coalesce (p_limit, 10), 50))
  ) t;

  return jsonb_build_object (
    'ok', true,
    'start_day', v_start,
    'end_day', v_end,
    'order', lower(coalesce (p_order, 'top')),
    'products', v_rows
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

-- ---------- Inventory insights ----------
create or replace function public.shop_get_inventory_insights ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop uuid := public._report_assert_shop ();
  v_low jsonb;
  v_out jsonb;
  v_stock_value bigint := 0;
  v_restock jsonb;
begin
  select coalesce (sum(greatest (p.stock_on_hand, 0) * greatest (p.cost_price_per_unit_ugx, 0)), 0)::bigint
  into v_stock_value
  from public.products p
  where p.shop_id = v_shop and p.is_active = true;

  select coalesce (
    jsonb_agg (row_to_json(x)::jsonb),
    '[]'::jsonb
  )
  into v_low
  from (
    select
      p.id as product_id,
      p.name,
      p.stock_on_hand,
      coalesce (p.minimum_stock_alert, p.reorder_level, 0) as minimum_stock_alert
    from public.products p
    where p.shop_id = v_shop
      and p.is_active = true
      and p.stock_on_hand > 0
      and p.stock_on_hand <= greatest (coalesce (p.minimum_stock_alert, p.reorder_level, 0), 3)
    order by p.stock_on_hand asc
    limit 20
  ) x;

  select coalesce (
    jsonb_agg (
      jsonb_build_object ('product_id', p.id, 'name', p.name)
      order by p.name
    ),
    '[]'::jsonb
  )
  into v_out
  from public.products p
  where p.shop_id = v_shop and p.is_active = true and p.stock_on_hand <= 0
  limit 30;

  select coalesce (
    jsonb_agg (
      jsonb_build_object (
        'product_id', p.id,
        'name', p.name,
        'stock_on_hand', p.stock_on_hand,
        'minimum_stock_alert', coalesce (p.minimum_stock_alert, p.reorder_level, 0),
        'suggested_reorder_qty', greatest (
          coalesce (p.minimum_stock_alert, p.reorder_level, 5) * 2 - p.stock_on_hand,
          coalesce (p.minimum_stock_alert, p.reorder_level, 5)
        )
      )
      order by p.stock_on_hand asc
    ),
    '[]'::jsonb
  )
  into v_restock
  from public.products p
  where p.shop_id = v_shop
    and p.is_active = true
    and p.stock_on_hand <= greatest (coalesce (p.minimum_stock_alert, p.reorder_level, 0), 3)
  limit 15;

  return jsonb_build_object (
    'ok', true,
    'stock_value_at_cost_ugx', coalesce (v_stock_value, 0),
    'low_stock', v_low,
    'out_of_stock', v_out,
    'restock_recommendations', v_restock
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

-- ---------- Customer insights ----------
create or replace function public.shop_get_customer_insights (
  p_start_day date default null,
  p_end_day date default null,
  p_limit int default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop uuid := public._report_assert_shop ();
  v_end date := coalesce (p_end_day, public._sale_kampala_day (now ()));
  v_start date := coalesce (p_start_day, v_end - 29);
  v_top jsonb;
  v_debt bigint := 0;
  v_debtors int := 0;
begin
  select
    coalesce (sum(greatest ((c.metadata ->> 'debtBalanceUgx')::bigint, 0)), 0)::bigint,
    count(*) filter (where greatest ((c.metadata ->> 'debtBalanceUgx')::bigint, 0) > 0)::int
  into v_debt, v_debtors
  from public.customers c
  where c.shop_id = v_shop;

  select coalesce (
    jsonb_agg (
      jsonb_build_object (
        'customer_id', t.customer_id,
        'name', t.name,
        'purchase_count', t.purchase_count,
        'lifetime_revenue_ugx', t.lifetime_revenue,
        'debt_balance_ugx', t.debt_balance
      )
      order by t.lifetime_revenue desc
    ),
    '[]'::jsonb
  )
  into v_top
  from (
    select
      c.id as customer_id,
      c.name,
      count(s.id)::int as purchase_count,
      coalesce (sum(s.total_ugx), 0)::bigint as lifetime_revenue,
      greatest ((c.metadata ->> 'debtBalanceUgx')::bigint, 0) as debt_balance
    from public.customers c
    left join public.sales s
      on s.customer_id = c.id
      and s.shop_id = v_shop
      and s.status = 'completed'
      and public._sale_kampala_day (coalesce (s.completed_at, s.created_at)) between v_start and v_end
    where c.shop_id = v_shop
    group by c.id, c.name, c.metadata
    order by lifetime_revenue desc
    limit greatest (1, least (coalesce (p_limit, 10), 50))
  ) t;

  return jsonb_build_object (
    'ok', true,
    'start_day', v_start,
    'end_day', v_end,
    'top_customers', v_top,
    'total_debt_outstanding_ugx', coalesce (v_debt, 0),
    'customers_with_debt', coalesce (v_debtors, 0)
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

-- ---------- Dashboard bundle (single round-trip) ----------
create or replace function public.shop_get_dashboard_analytics ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_daily jsonb;
  v_weekly jsonb;
  v_inventory jsonb;
  v_customers jsonb;
begin
  v_daily := public.shop_get_daily_sales_summary (null);
  v_weekly := public.shop_get_weekly_sales_summary (null);
  v_inventory := public.shop_get_inventory_insights ();
  v_customers := public.shop_get_customer_insights (null, null, 5);

  return jsonb_build_object (
    'ok', true,
    'daily', v_daily,
    'weekly', v_weekly,
    'inventory', v_inventory,
    'customers', v_customers
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_get_daily_sales_summary (date) from public;
grant execute on function public.shop_get_daily_sales_summary (date) to authenticated;

revoke all on function public.shop_get_weekly_sales_summary (date) from public;
grant execute on function public.shop_get_weekly_sales_summary (date) to authenticated;

revoke all on function public.shop_get_monthly_sales_summary (text) from public;
grant execute on function public.shop_get_monthly_sales_summary (text) to authenticated;

revoke all on function public.shop_get_top_products (date, date, int, text) from public;
grant execute on function public.shop_get_top_products (date, date, int, text) to authenticated;

revoke all on function public.shop_get_inventory_insights () from public;
grant execute on function public.shop_get_inventory_insights () to authenticated;

revoke all on function public.shop_get_customer_insights (date, date, int) from public;
grant execute on function public.shop_get_customer_insights (date, date, int) to authenticated;

revoke all on function public.shop_get_dashboard_analytics () from public;
grant execute on function public.shop_get_dashboard_analytics () to authenticated;

-- SALES-MULTI-01 P2-01: shop summary RPCs subtract sale_voids the same way
-- they already subtract sale_returns. Does NOT mutate sales.total_ugx.
-- Cash/debt use cash-first remaining on the original header (same as
-- reduceSaleTotalsByAmount): min(adjustments, cash) then debt.

create or replace function public._report_voids_summary (
  p_shop uuid,
  p_start date,
  p_end date
)
returns table (
  void_count int,
  voids_ugx bigint,
  profit_reduction_ugx bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::int as void_count,
    coalesce (sum(sv.amount_ugx), 0)::bigint as voids_ugx,
    coalesce (sum(
      sv.amount_ugx - round(
        sv.quantity * coalesce (p.cost_price_per_unit_ugx, 0)
      )::bigint
    ), 0)::bigint as profit_reduction_ugx
  from public.sale_voids sv
  left join public.products p on p.id = sv.product_id and p.shop_id = sv.shop_id
  where sv.shop_id = p_shop
    and public._sale_kampala_day (sv.created_at) between p_start and p_end;
$$;

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
as $$
  with sales_in as (
    select
      s.id,
      coalesce (s.cash_amount_ugx, 0)::bigint as cash_amount_ugx,
      coalesce (s.debt_amount_ugx, 0)::bigint as debt_amount_ugx
    from public.sales s
    where s.shop_id = p_shop
      and s.status = 'completed'
      and case
        when p_created_only then public._sale_kampala_day (s.created_at)
        else public._sale_kampala_day (coalesce (s.completed_at, s.created_at))
      end between p_start and p_end
  ),
  adj as (
    select
      x.sale_id,
      coalesce (sum(x.amount_ugx), 0)::bigint as amount_ugx
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
    coalesce (sum(greatest (
      0,
      s.cash_amount_ugx - least (s.cash_amount_ugx, coalesce (a.amount_ugx, 0))
    )), 0)::bigint as cash_ugx,
    coalesce (sum(greatest (
      0,
      s.debt_amount_ugx - greatest (
        0,
        coalesce (a.amount_ugx, 0) - least (s.cash_amount_ugx, coalesce (a.amount_ugx, 0))
      )
    )), 0)::bigint as debt_ugx
  from sales_in s
  left join adj a on a.sale_id = s.id;
$$;

create or replace function public._report_empty_voids_summary ()
returns table (
  void_count int,
  voids_ugx bigint,
  profit_reduction_ugx bigint
)
language sql
stable
as $$
  select 0::int, 0::bigint, 0::bigint;
$$;

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
  v_returns record;
  v_voids record;
  v_tender record;
  v_allow_profit boolean := true;
begin
  if to_regprocedure ('public.shop_plan_allows_feature(uuid, text)') is not null then
    v_allow_profit := public.shop_plan_allows_feature (v_shop, 'profit_reports');
  end if;

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
    and public._sale_kampala_day (s.created_at) = v_day;

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
      and public._sale_kampala_day (s.created_at) = v_day
      and coalesce ((sli.metadata ->> 'voided')::boolean, false) = false;
  end if;

  select * into v_returns
  from public._report_returns_summary (v_shop, v_day, v_day);

  if to_regclass ('public.sale_voids') is not null then
    select * into v_voids
    from public._report_voids_summary (v_shop, v_day, v_day);
    select * into v_tender
    from public._report_period_remaining_cash_debt (v_shop, v_day, v_day, true);
  else
    select * into v_voids from public._report_empty_voids_summary ();
    v_tender := null;
  end if;

  return jsonb_build_object (
    'ok', true,
    'day', v_day,
    'transaction_count', coalesce (v_row.tx_count, 0),
    'total_revenue_ugx', greatest (
      0,
      coalesce (v_row.revenue, 0) - coalesce (v_returns.refunds_ugx, 0) - coalesce (v_voids.voids_ugx, 0)
    ),
    'gross_revenue_ugx', coalesce (v_row.revenue, 0),
    'returns_refunds_ugx', coalesce (v_returns.refunds_ugx, 0),
    'return_count', coalesce (v_returns.return_count, 0),
    'voids_ugx', coalesce (v_voids.voids_ugx, 0),
    'void_count', coalesce (v_voids.void_count, 0),
    'cash_collected_ugx', coalesce (v_tender.cash_ugx, v_row.cash, 0),
    'debt_issued_ugx', coalesce (v_tender.debt_ugx, v_row.debt, 0),
    'discounts_ugx', coalesce (v_row.discounts, 0),
    'taxes_ugx', coalesce (v_row.taxes, 0),
    'estimated_profit_ugx',
      case
        when v_allow_profit then greatest (
          0,
          coalesce (v_profit, 0)
            - coalesce (v_returns.profit_reduction_ugx, 0)
            - coalesce (v_voids.profit_reduction_ugx, 0)
        )
        else null
      end,
    'profit_gated', not v_allow_profit,
    'average_transaction_ugx',
      case
        when coalesce (v_row.tx_count, 0) > 0 then (
          greatest (
            0,
            coalesce (v_row.revenue, 0) - coalesce (v_returns.refunds_ugx, 0) - coalesce (v_voids.voids_ugx, 0)
          ) / v_row.tx_count
        )::bigint
        else 0
      end
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

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
  v_returns record;
  v_voids record;
  v_tender record;
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

  select * into v_returns
  from public._report_returns_summary (v_shop, v_start, v_end);

  if to_regclass ('public.sale_voids') is not null then
    select * into v_voids
    from public._report_voids_summary (v_shop, v_start, v_end);
    select * into v_tender
    from public._report_period_remaining_cash_debt (v_shop, v_start, v_end, false);
  else
    select * into v_voids from public._report_empty_voids_summary ();
    v_tender := null;
  end if;

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
    'total_revenue_ugx', greatest (
      0,
      coalesce (v_totals.revenue, 0) - coalesce (v_returns.refunds_ugx, 0) - coalesce (v_voids.voids_ugx, 0)
    ),
    'gross_revenue_ugx', coalesce (v_totals.revenue, 0),
    'returns_refunds_ugx', coalesce (v_returns.refunds_ugx, 0),
    'return_count', coalesce (v_returns.return_count, 0),
    'voids_ugx', coalesce (v_voids.voids_ugx, 0),
    'void_count', coalesce (v_voids.void_count, 0),
    'cash_collected_ugx', coalesce (v_tender.cash_ugx, v_totals.cash, 0),
    'daily_trend', v_days,
    'top_products', v_top,
    'active_customers', coalesce (v_customers, 0)
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

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
  v_returns record;
  v_voids record;
  v_tender record;
  v_start date := to_date (v_month || '-01', 'YYYY-MM-DD');
  v_end date := (v_start + interval '1 month' - interval '1 day')::date;
  v_allow_profit boolean := true;
begin
  if v_month !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_month');
  end if;

  if to_regprocedure ('public.shop_plan_allows_feature(uuid, text)') is not null then
    v_allow_profit := public.shop_plan_allows_feature (v_shop, 'profit_reports');
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
      and to_char (public._sale_kampala_day (coalesce (s.completed_at, s.created_at)), 'YYYY-MM') = v_month;
  end if;

  select * into v_returns
  from public._report_returns_summary (v_shop, v_start, v_end);

  if to_regclass ('public.sale_voids') is not null then
    select * into v_voids
    from public._report_voids_summary (v_shop, v_start, v_end);
    select * into v_tender
    from public._report_period_remaining_cash_debt (v_shop, v_start, v_end, false);
  else
    select * into v_voids from public._report_empty_voids_summary ();
    v_tender := null;
  end if;

  if to_regprocedure ('public._report_cash_drawer_expenses_ugx(uuid, date, date)') is not null then
    v_expenses := public._report_cash_drawer_expenses_ugx (v_shop, v_start, v_end);
  end if;

  return jsonb_build_object (
    'ok', true,
    'month', v_month,
    'transaction_count', coalesce (v_cur.tx_count, 0),
    'total_revenue_ugx', greatest (
      0,
      coalesce (v_cur.revenue, 0) - coalesce (v_returns.refunds_ugx, 0) - coalesce (v_voids.voids_ugx, 0)
    ),
    'gross_revenue_ugx', coalesce (v_cur.revenue, 0),
    'returns_refunds_ugx', coalesce (v_returns.refunds_ugx, 0),
    'return_count', coalesce (v_returns.return_count, 0),
    'voids_ugx', coalesce (v_voids.voids_ugx, 0),
    'void_count', coalesce (v_voids.void_count, 0),
    'cash_collected_ugx', coalesce (v_tender.cash_ugx, v_cur.cash, 0),
    'debt_issued_ugx', coalesce (v_tender.debt_ugx, v_cur.debt, 0),
    'estimated_profit_ugx',
      case
        when v_allow_profit then greatest (
          0,
          coalesce (v_profit, 0)
            - coalesce (v_returns.profit_reduction_ugx, 0)
            - coalesce (v_voids.profit_reduction_ugx, 0)
        )
        else null
      end,
    'profit_gated', not v_allow_profit,
    'expenses_ugx', coalesce (v_expenses, 0),
    'net_earnings_ugx',
      case
        when v_allow_profit then greatest (
          0,
          coalesce (v_profit, 0)
            - coalesce (v_returns.profit_reduction_ugx, 0)
            - coalesce (v_voids.profit_reduction_ugx, 0)
        ) - coalesce (v_expenses, 0)
        else null
      end,
    'previous_month_revenue_ugx', coalesce (v_prev.revenue, 0),
    'revenue_growth_pct',
      case
        when coalesce (v_prev.revenue, 0) <= 0 then null
        else round((
          (
            greatest (
              0,
              coalesce (v_cur.revenue, 0) - coalesce (v_returns.refunds_ugx, 0) - coalesce (v_voids.voids_ugx, 0)
            )::numeric - v_prev.revenue::numeric
          ) / v_prev.revenue::numeric
        ) * 100, 1)
      end
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public._report_voids_summary (uuid, date, date) from public;
revoke all on function public._report_period_remaining_cash_debt (uuid, date, date, boolean) from public;
revoke all on function public._report_empty_voids_summary () from public;
revoke all on function public.shop_get_daily_sales_summary (date) from public;
revoke all on function public.shop_get_weekly_sales_summary (date) from public;
revoke all on function public.shop_get_monthly_sales_summary (text) from public;

grant execute on function public.shop_get_daily_sales_summary (date) to authenticated;
grant execute on function public.shop_get_weekly_sales_summary (date) to authenticated;
grant execute on function public.shop_get_monthly_sales_summary (text) to authenticated;

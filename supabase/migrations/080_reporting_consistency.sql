-- Restore return-adjusted daily summary (064) with profit gating (076).
-- Align sale day bucketing with client: Kampala day of created_at.

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
  v_allow_profit boolean;
begin
  v_allow_profit := public.shop_plan_allows_feature (v_shop, 'profit_reports');

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

  return jsonb_build_object (
    'ok', true,
    'day', v_day,
    'transaction_count', coalesce (v_row.tx_count, 0),
    'total_revenue_ugx', greatest (0, coalesce (v_row.revenue, 0) - coalesce (v_returns.refunds_ugx, 0)),
    'gross_revenue_ugx', coalesce (v_row.revenue, 0),
    'returns_refunds_ugx', coalesce (v_returns.refunds_ugx, 0),
    'return_count', coalesce (v_returns.return_count, 0),
    'cash_collected_ugx', coalesce (v_row.cash, 0),
    'debt_issued_ugx', coalesce (v_row.debt, 0),
    'discounts_ugx', coalesce (v_row.discounts, 0),
    'taxes_ugx', coalesce (v_row.taxes, 0),
    'estimated_profit_ugx',
      case
        when v_allow_profit then greatest (0, coalesce (v_profit, 0) - coalesce (v_returns.profit_reduction_ugx, 0))
        else null
      end,
    'profit_gated', not v_allow_profit,
    'average_transaction_ugx',
      case
        when coalesce (v_row.tx_count, 0) > 0 then (
          greatest (0, coalesce (v_row.revenue, 0) - coalesce (v_returns.refunds_ugx, 0)) / v_row.tx_count
        )::bigint
        else 0
      end
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

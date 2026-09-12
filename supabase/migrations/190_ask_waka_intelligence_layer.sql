-- Ask WAKA Phase 2 — WAKA POS intelligence layer.
-- All new functions follow the exact `_report_assert_shop()` pattern used by
-- every existing Ask WAKA reporting RPC: zero shop parameters, shop resolved
-- purely from auth.uid(), security definer, membership-asserted.
--
-- Phase 2A (product-level sales for "today") needs no new SQL — shop_get_top_products
-- already accepts an arbitrary p_start_day/p_end_day; only the Ask WAKA tool-layer
-- validation was restricting it to week=this|last. See src/lib/ai/askWakaToolContracts.ts.

-- ============================================================
-- Phase 2B — payment method breakdown (public.sale_payments is genuinely
-- populated on every sale completion — verified against the live
-- shop_push_sale_complete definition before writing this).
-- ============================================================
create or replace function public.shop_get_payment_method_summary (
  p_start_day date default null,
  p_end_day date default null
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
  v_start date := coalesce (p_start_day, v_end);
  v_rows jsonb;
  v_total bigint;
begin
  if v_start > v_end then
    return jsonb_build_object ('ok', false, 'error', 'invalid_date_range');
  end if;
  if (v_end - v_start) > 92 then
    return jsonb_build_object ('ok', false, 'error', 'date_range_too_large');
  end if;

  select
    coalesce (jsonb_agg (jsonb_build_object ('method', t.method, 'amount_ugx', t.amount) order by t.amount desc), '[]'::jsonb),
    coalesce (sum (t.amount), 0)::bigint
  into v_rows, v_total
  from (
    select sp.method, coalesce (sum (sp.amount_ugx), 0)::bigint as amount
    from public.sale_payments sp
    join public.sales s on s.id = sp.sale_id
    where s.shop_id = v_shop
      and s.status = 'completed'
      and public._sale_kampala_day (coalesce (s.completed_at, s.created_at)) between v_start and v_end
    group by sp.method
  ) t;

  return jsonb_build_object (
    'ok', true,
    'start_day', v_start,
    'end_day', v_end,
    'methods', v_rows,
    'total_ugx', v_total
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_get_payment_method_summary (date, date) from public;
grant execute on function public.shop_get_payment_method_summary (date, date) to authenticated;

-- ============================================================
-- Phase 2C — notable/individual sales. No customer identity is ever
-- returned by this function, by design (see Phase 1 audit §J risk 5).
-- ============================================================
create or replace function public.shop_get_notable_sales (
  p_start_day date default null,
  p_end_day date default null,
  p_limit integer default 5
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
  v_start date := coalesce (p_start_day, v_end);
  v_limit int := greatest (1, least (coalesce (p_limit, 5), 20));
  v_rows jsonb;
begin
  if v_start > v_end then
    return jsonb_build_object ('ok', false, 'error', 'invalid_date_range');
  end if;
  if (v_end - v_start) > 92 then
    return jsonb_build_object ('ok', false, 'error', 'date_range_too_large');
  end if;

  select coalesce (
    jsonb_agg (
      jsonb_build_object (
        'sale_id', t.id,
        'completed_at', t.completed_at,
        'total_ugx', t.total_ugx,
        'item_count', t.item_count,
        'payment_methods', t.payment_methods
      )
      order by t.total_ugx desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      s.id,
      coalesce (s.completed_at, s.created_at) as completed_at,
      s.total_ugx,
      (select coalesce (sum (sli.quantity), 0) from public.sale_line_items sli where sli.sale_id = s.id) as item_count,
      (
        select coalesce (jsonb_agg (jsonb_build_object ('method', sp.method, 'amount_ugx', sp.amount_ugx)), '[]'::jsonb)
        from public.sale_payments sp
        where sp.sale_id = s.id
      ) as payment_methods
    from public.sales s
    where s.shop_id = v_shop
      and s.status = 'completed'
      and public._sale_kampala_day (coalesce (s.completed_at, s.created_at)) between v_start and v_end
    order by s.total_ugx desc
    limit v_limit
  ) t;

  return jsonb_build_object (
    'ok', true,
    'start_day', v_start,
    'end_day', v_end,
    'sales', v_rows
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_get_notable_sales (date, date, integer) from public;
grant execute on function public.shop_get_notable_sales (date, date, integer) to authenticated;

-- ============================================================
-- Phase 2D — unsold products (anti-join against sale_line_items).
-- Deliberately a separate function rather than a third mode bolted onto
-- shop_get_top_products, which is an already-shipped, tested aggregate
-- query — an anti-join is a structurally different shape.
-- ============================================================
create or replace function public.shop_get_unsold_products (
  p_start_day date default null,
  p_end_day date default null,
  p_limit integer default 50
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
  v_limit int := greatest (1, least (coalesce (p_limit, 50), 100));
  v_rows jsonb;
begin
  if v_start > v_end then
    return jsonb_build_object ('ok', false, 'error', 'invalid_date_range');
  end if;
  if (v_end - v_start) > 92 then
    return jsonb_build_object ('ok', false, 'error', 'date_range_too_large');
  end if;

  select coalesce (
    jsonb_agg (
      jsonb_build_object ('product_id', t.id, 'name', t.name, 'stock_on_hand', t.stock_on_hand)
      order by t.name
    ),
    '[]'::jsonb
  )
  into v_rows
  from (
    select p.id, p.name, p.stock_on_hand
    from public.products p
    where p.shop_id = v_shop
      and p.is_active = true
      and not exists (
        select 1
        from public.sale_line_items sli
        join public.sales s on s.id = sli.sale_id
        where sli.product_id = p.id
          and s.shop_id = v_shop
          and s.status = 'completed'
          and public._sale_kampala_day (coalesce (s.completed_at, s.created_at)) between v_start and v_end
      )
    order by p.name
    limit v_limit
  ) t;

  return jsonb_build_object (
    'ok', true,
    'start_day', v_start,
    'end_day', v_end,
    'products', v_rows
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_get_unsold_products (date, date, integer) from public;
grant execute on function public.shop_get_unsold_products (date, date, integer) to authenticated;

-- ============================================================
-- Phase 2E — credit sales for a specific day. `total_debt_created_ugx`
-- is deliberately NOT named like the cumulative "outstanding debt" figure
-- in shop_get_customer_insights — these are different concepts and must
-- never be confused (Phase 1 audit, Phase 2E instructions).
-- ============================================================
create or replace function public.shop_get_credit_sales (
  p_day date default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop uuid := public._report_assert_shop ();
  v_day date := coalesce (p_day, public._sale_kampala_day (now ()));
  v_limit int := greatest (1, least (coalesce (p_limit, 20), 50));
  v_rows jsonb;
  v_total bigint;
begin
  select
    coalesce (
      jsonb_agg (
        jsonb_build_object (
          'customer_name', t.customer_name,
          'sale_total_ugx', t.total_ugx,
          'debt_amount_ugx', t.debt_amount_ugx,
          'completed_at', t.completed_at
        )
        order by t.debt_amount_ugx desc
      ),
      '[]'::jsonb
    ),
    coalesce (sum (t.debt_amount_ugx), 0)::bigint
  into v_rows, v_total
  from (
    select
      coalesce (c.name, 'Customer') as customer_name,
      s.total_ugx,
      s.debt_amount_ugx,
      coalesce (s.completed_at, s.created_at) as completed_at
    from public.sales s
    left join public.customers c on c.id = s.customer_id and c.shop_id = s.shop_id
    where s.shop_id = v_shop
      and s.status = 'completed'
      and s.debt_amount_ugx > 0
      and public._sale_kampala_day (coalesce (s.completed_at, s.created_at)) = v_day
    order by s.debt_amount_ugx desc
    limit v_limit
  ) t;

  return jsonb_build_object (
    'ok', true,
    'day', v_day,
    'credit_sales', v_rows,
    'total_debt_created_ugx', v_total
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_get_credit_sales (date, integer) from public;
grant execute on function public.shop_get_credit_sales (date, integer) to authenticated;

-- ============================================================
-- Phase 2F — staff sales with real names when a staff link exists.
-- Additive only: adds `staff_name` (null when unresolved) alongside the
-- existing `staff_key`/`transaction_count`/`total_revenue_ugx` fields.
-- shop_pos_staff.user_id -> sales.created_by is a real, schema-enforced
-- link (partial unique index added in migration 160); unlinked/PIN-only
-- staff simply resolve to a null name, and the Ask WAKA tool layer falls
-- back to the existing anonymized staff_1/staff_2 label in that case.
-- ============================================================
create or replace function public.shop_get_staff_sales_summary (
  p_start_day date default null,
  p_end_day date default null,
  p_limit integer default 20
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
  v_start date := coalesce (p_start_day, v_end);
  v_limit int := greatest (1, least (coalesce (p_limit, 20), 20));
  v_rows jsonb;
  v_span int;
begin
  if v_start > v_end then
    return jsonb_build_object ('ok', false, 'error', 'invalid_date_range');
  end if;

  v_span := (v_end - v_start);
  if v_span > 92 then
    return jsonb_build_object ('ok', false, 'error', 'date_range_too_large');
  end if;

  select coalesce (
    jsonb_agg (
      jsonb_build_object (
        'staff_key', t.staff_key,
        'staff_name', t.staff_name,
        'transaction_count', t.tx_count,
        'total_revenue_ugx', t.revenue
      )
      order by t.revenue desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      coalesce (s.created_by::text, 'unknown') as staff_key,
      max (sp.name) as staff_name,
      count(*)::int as tx_count,
      coalesce (sum (s.total_ugx), 0)::bigint as revenue
    from public.sales s
    left join public.shop_pos_staff sp
      on sp.user_id = s.created_by and sp.shop_id = v_shop
    where s.shop_id = v_shop
      and s.status = 'completed'
      and public._sale_kampala_day (coalesce (s.completed_at, s.created_at)) between v_start and v_end
    group by coalesce (s.created_by::text, 'unknown')
    order by coalesce (sum (s.total_ugx), 0) desc
    limit v_limit
  ) t;

  return jsonb_build_object (
    'ok', true,
    'start_day', v_start,
    'end_day', v_end,
    'staff', v_rows
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

-- ============================================================
-- Phase 2G — day/week net earnings, additive fields only, mirroring the
-- already-live month RPC's profit/expenses/net_earnings pattern exactly.
-- Weekly did not compute profit at all before this migration; the same
-- proven per-line profit formula (already live in daily + monthly) is
-- reused verbatim, not reinvented.
-- ============================================================
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
  v_expenses bigint := 0;
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
    coalesce (sum (s.total_ugx), 0)::bigint as revenue,
    coalesce (sum (s.cash_amount_ugx), 0)::bigint as cash,
    coalesce (sum (s.debt_amount_ugx), 0)::bigint as debt,
    coalesce (sum (s.discount_ugx), 0)::bigint as discounts,
    coalesce (sum (s.tax_ugx), 0)::bigint as taxes
  into v_row
  from public.sales s
  where s.shop_id = v_shop
    and s.status = 'completed'
    and public._sale_kampala_day (s.created_at) = v_day;

  if v_allow_profit then
    select coalesce (sum (
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

  if to_regprocedure ('public._report_cash_drawer_expenses_ugx(uuid, date, date)') is not null then
    v_expenses := public._report_cash_drawer_expenses_ugx (v_shop, v_day, v_day);
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
  v_profit bigint := 0;
  v_expenses bigint := 0;
  v_allow_profit boolean := true;
begin
  if to_regprocedure ('public.shop_plan_allows_feature(uuid, text)') is not null then
    v_allow_profit := public.shop_plan_allows_feature (v_shop, 'profit_reports');
  end if;

  select
    count(*)::int as tx_count,
    coalesce (sum (s.total_ugx), 0)::bigint as revenue,
    coalesce (sum (s.cash_amount_ugx), 0)::bigint as cash
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

  if v_allow_profit then
    select coalesce (sum (
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
      and public._sale_kampala_day (coalesce (s.completed_at, s.created_at)) between v_start and v_end
      and coalesce ((sli.metadata ->> 'voided')::boolean, false) = false;
  end if;

  if to_regprocedure ('public._report_cash_drawer_expenses_ugx(uuid, date, date)') is not null then
    v_expenses := public._report_cash_drawer_expenses_ugx (v_shop, v_start, v_end);
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
      coalesce (sum (s.total_ugx), 0)::bigint as revenue,
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
      coalesce (max (sli.metadata ->> 'name'), max (p.name), 'Item') as name,
      coalesce (sum (sli.quantity), 0)::numeric as qty,
      coalesce (sum (sli.line_total_ugx), 0)::bigint as revenue
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
    'active_customers', coalesce (v_customers, 0),
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
      end
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

-- ============================================================
-- Phase 2H — shift-scoped item-level sales.
--
-- PRODUCTION-VERIFIED before writing this (read-only query against the
-- live database, 2026-09-12): for the 69 real shifts whose actor_user_id
-- is a valid Auth UUID, matching against `sales.created_by` (the writer
-- identity — which is exactly what shiftOwnerUserId() in sessionActor.ts
-- stores into actor_user_id) gave 54/54 shifts-with-sales fully matching,
-- 0 mismatches, 0 nulls, across 569 sales. Matching against
-- `sales.sold_by_user_id` (the commercial-seller identity) instead gave
-- only 6 fully-matching shifts and 369 null-seller sales out of the same
-- population — that field is too sparsely populated in production to be
-- a safe join key today. `created_by` is therefore the correct, verified
-- anchor; `sold_by_user_id` is used only as an honesty cross-check
-- (mismatched_seller_sales_count) that a different logged seller may
-- have transacted during the shift.
--
-- For the 9 real shifts whose actor_user_id is a PIN-only "staff:<id>"
-- string (not a UUID), there is no reliable identity bridge at all —
-- this function returns `shift_sales_not_supported` rather than guess.
-- ============================================================
create or replace function public.shop_get_shift_sales (
  p_shift_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop uuid := public._report_assert_shop ();
  v_row public.shop_shifts%rowtype;
  v_open_count int;
  v_candidates jsonb;
  v_actor_uuid uuid;
  v_end_at timestamptz;
  v_products jsonb;
  v_tx_count int;
  v_mismatched int;
begin
  if p_shift_id is not null then
    select * into v_row from public.shop_shifts where id = p_shift_id and shop_id = v_shop;
    if not found then
      return jsonb_build_object ('ok', false, 'error', 'shift_not_found');
    end if;
  else
    select count(*) into v_open_count
    from public.shop_shifts
    where shop_id = v_shop and end_at is null;

    if v_open_count = 1 then
      select * into v_row
      from public.shop_shifts
      where shop_id = v_shop and end_at is null
      limit 1;
    elsif v_open_count = 0 then
      select * into v_row
      from public.shop_shifts
      where shop_id = v_shop and end_at is not null
      order by end_at desc
      limit 1;
      if not found then
        return jsonb_build_object ('ok', false, 'error', 'no_shift_found');
      end if;
    else
      select coalesce (
        jsonb_agg (
          jsonb_build_object (
            'id', s.id,
            'actor_user_id', s.actor_user_id,
            'actor_name', s.payload ->> 'actorName',
            'start_at', s.start_at
          )
          order by s.start_at desc
        ),
        '[]'::jsonb
      )
      into v_candidates
      from public.shop_shifts s
      where s.shop_id = v_shop and s.end_at is null;

      return jsonb_build_object ('ok', false, 'error', 'multiple_open_shifts', 'candidates', v_candidates);
    end if;
  end if;

  begin
    v_actor_uuid := v_row.actor_user_id::uuid;
  exception
    when others then
      v_actor_uuid := null;
  end;

  if v_actor_uuid is null then
    return jsonb_build_object (
      'ok', true,
      'shift_id', v_row.id,
      'status', 'shift_sales_not_supported',
      'note', 'This shift is owned by a PIN-only staff profile with no linked Auth identity, so item-level sales cannot be safely attributed to it.'
    );
  end if;

  v_end_at := coalesce (v_row.end_at, now ());

  select count(*)::int into v_tx_count
  from public.sales s
  where s.shop_id = v_shop
    and s.status = 'completed'
    and s.created_by = v_actor_uuid
    and s.created_at between v_row.start_at and v_end_at;

  select count(*)::int into v_mismatched
  from public.sales s
  where s.shop_id = v_shop
    and s.status = 'completed'
    and s.created_by = v_actor_uuid
    and s.created_at between v_row.start_at and v_end_at
    and s.sold_by_user_id is not null
    and s.sold_by_user_id <> v_actor_uuid;

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
  into v_products
  from (
    select
      sli.product_id,
      coalesce (max (sli.metadata ->> 'name'), max (p.name), 'Item') as name,
      coalesce (sum (sli.quantity), 0)::numeric as qty,
      coalesce (sum (sli.line_total_ugx), 0)::bigint as revenue
    from public.sale_line_items sli
    join public.sales s on s.id = sli.sale_id
    left join public.products p on p.id = sli.product_id
    where s.shop_id = v_shop
      and s.status = 'completed'
      and s.created_by = v_actor_uuid
      and s.created_at between v_row.start_at and v_end_at
    group by sli.product_id
    order by revenue desc
    limit greatest (1, least (coalesce (p_limit, 20), 50))
  ) t;

  return jsonb_build_object (
    'ok', true,
    'shift_id', v_row.id,
    'status', 'ok',
    'start_at', v_row.start_at,
    'end_at', v_row.end_at,
    'transaction_count', v_tx_count,
    'products', v_products,
    'mismatched_seller_sales_count', v_mismatched,
    'shop_id', v_shop
  );
end;
$$;

revoke all on function public.shop_get_shift_sales (uuid, integer) from public;
grant execute on function public.shop_get_shift_sales (uuid, integer) to authenticated;

-- ============================================================
-- Phase 2I — inventory movement history (public.inventory_movements is a
-- real, actively-written append-only ledger — verified across ~13 write
-- paths before writing this; not merely the products.stock_on_hand
-- snapshot).
-- ============================================================
create or replace function public.shop_get_inventory_movements (
  p_start_day date default null,
  p_end_day date default null,
  p_reason text default null,
  p_limit integer default 30
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
  v_start date := coalesce (p_start_day, v_end);
  v_limit int := greatest (1, least (coalesce (p_limit, 30), 100));
  v_reason text := nullif (lower (trim (coalesce (p_reason, ''))), '');
  v_rows jsonb;
begin
  if v_start > v_end then
    return jsonb_build_object ('ok', false, 'error', 'invalid_date_range');
  end if;
  if (v_end - v_start) > 92 then
    return jsonb_build_object ('ok', false, 'error', 'date_range_too_large');
  end if;
  if v_reason is not null and v_reason not in ('sale', 'return', 'adjustment', 'initial', 'transfer', 'waste', 'other') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_reason');
  end if;

  select coalesce (
    jsonb_agg (
      jsonb_build_object (
        'product_id', t.product_id,
        'name', t.name,
        'quantity_delta', t.quantity_delta,
        'reason', t.reason,
        'occurred_at', t.created_at
      )
      order by t.created_at desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from (
    select im.product_id, coalesce (p.name, 'Item') as name, im.quantity_delta, im.reason, im.created_at
    from public.inventory_movements im
    left join public.products p on p.id = im.product_id
    where im.shop_id = v_shop
      and public._sale_kampala_day (im.created_at) between v_start and v_end
      and (v_reason is null or im.reason = v_reason)
    order by im.created_at desc
    limit v_limit
  ) t;

  return jsonb_build_object (
    'ok', true,
    'start_day', v_start,
    'end_day', v_end,
    'reason_filter', v_reason,
    'movements', v_rows
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_get_inventory_movements (date, date, text, integer) from public;
grant execute on function public.shop_get_inventory_movements (date, date, text, integer) to authenticated;

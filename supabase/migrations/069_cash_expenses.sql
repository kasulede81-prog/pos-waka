-- Cash drawer expenses: schema hardening, push RPC, reporting helpers.
-- Client sync/UI: see docs/CASH_EXPENSES_FEATURE_SPEC.md

-- ---------- Extend expenses ----------
alter table public.expenses
  add column if not exists expense_type text not null default 'cash_drawer',
  add column if not exists updated_at timestamptz not null default now (),
  add column if not exists updated_by uuid references auth.users (id),
  add column if not exists approved_by uuid references auth.users (id),
  add column if not exists approved_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists recorded_by_staff_id text,
  add column if not exists recorded_by_label text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.expenses
  drop constraint if exists expenses_expense_type_check;

alter table public.expenses
  add constraint expenses_expense_type_check
    check (expense_type in ('cash_drawer', 'legacy'));

alter table public.expenses
  drop constraint if exists expenses_category_len_check;

alter table public.expenses
  add constraint expenses_category_len_check
    check (char_length (trim (category)) between 1 and 64);

create index if not exists expenses_shop_paid_active_idx
  on public.expenses (shop_id, paid_on desc)
  where deleted_at is null and expense_type = 'cash_drawer';

create index if not exists expenses_shop_updated_idx
  on public.expenses (shop_id, updated_at desc);

drop trigger if exists trg_expenses_updated on public.expenses;
create trigger trg_expenses_updated
  before update on public.expenses
  for each row execute function public.set_updated_at ();

comment on table public.expenses is
  'Shop expenses; cash_drawer rows are money removed from the POS cash drawer for operational costs.';

-- ---------- RLS: allow cashiers to insert drawer expenses (RPC + direct) ----------
drop policy if exists expenses_write on public.expenses;
create policy expenses_write
  on public.expenses for insert
  with check (
    public.user_is_cashier_or_above (shop_id)
    and expense_type = 'cash_drawer'
  );

-- ---------- Reporting helper ----------
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
as $$
  select coalesce (sum(e.amount_ugx), 0)::bigint
  from public.expenses e
  where e.shop_id = p_shop
    and e.expense_type = 'cash_drawer'
    and e.deleted_at is null
    and e.paid_on between p_start and p_end;
$$;

-- ---------- Push RPC (idempotent upsert) ----------
create or replace function public.shop_push_cash_expense (
  p_shop_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_id uuid;
  v_category text;
  v_amount bigint;
  v_desc text;
  v_paid date;
  v_created timestamptz;
  v_staff_id text;
  v_staff_label text;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_required');
  end if;
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif (p_payload ->> 'id', '')::uuid;
  v_category := nullif (trim (p_payload ->> 'category'), '');
  v_amount := coalesce ((p_payload ->> 'amount_ugx')::bigint, 0);
  v_desc := nullif (trim (p_payload ->> 'description'), '');
  v_paid := coalesce (
    nullif (p_payload ->> 'paid_on', '')::date,
    public._sale_kampala_day (now ())
  );
  v_created := coalesce (
    nullif (p_payload ->> 'created_at', '')::timestamptz,
    now ()
  );
  v_staff_id := nullif (trim (p_payload ->> 'recorded_by_staff_id'), '');
  v_staff_label := nullif (trim (p_payload ->> 'recorded_by_label'), '');

  if v_id is null or v_category is null or v_amount <= 0 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;

  insert into public.expenses (
    id,
    shop_id,
    expense_type,
    category,
    amount_ugx,
    description,
    paid_on,
    created_by,
    created_at,
    updated_at,
    updated_by,
    recorded_by_staff_id,
    recorded_by_label,
    metadata
  )
  values (
    v_id,
    p_shop_id,
    'cash_drawer',
    v_category,
    v_amount,
    v_desc,
    v_paid,
    v_uid,
    v_created,
    now (),
    v_uid,
    v_staff_id,
    v_staff_label,
    coalesce (p_payload -> 'metadata', '{}'::jsonb)
  )
  on conflict (id) do update
  set
    category = excluded.category,
    amount_ugx = excluded.amount_ugx,
    description = excluded.description,
    paid_on = excluded.paid_on,
    updated_at = now (),
    updated_by = v_uid,
    recorded_by_staff_id = coalesce (excluded.recorded_by_staff_id, public.expenses.recorded_by_staff_id),
    recorded_by_label = coalesce (excluded.recorded_by_label, public.expenses.recorded_by_label),
    metadata = public.expenses.metadata || excluded.metadata
  where public.expenses.shop_id = p_shop_id
    and public.expenses.deleted_at is null;

  return jsonb_build_object ('ok', true, 'id', v_id);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'save_failed', 'detail', sqlerrm);
end;
$$;

revoke all on function public.shop_push_cash_expense (uuid, jsonb) from public;
grant execute on function public.shop_push_cash_expense (uuid, jsonb) to authenticated;

-- ---------- Soft delete RPC (owners/managers) ----------
create or replace function public.shop_void_cash_expense (
  p_shop_id uuid,
  p_expense_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  update public.expenses e
  set
    deleted_at = now (),
    updated_at = now (),
    updated_by = v_uid
  where e.id = p_expense_id
    and e.shop_id = p_shop_id
    and e.expense_type = 'cash_drawer'
    and e.deleted_at is null;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.shop_void_cash_expense (uuid, uuid) from public;
grant execute on function public.shop_void_cash_expense (uuid, uuid) to authenticated;

-- ---------- Owner insights RPC ----------
create or replace function public.shop_get_cash_expense_insights ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop uuid := public._report_assert_shop ();
  v_today date := public._sale_kampala_day (now ());
  v_week_start date := v_today - 6;
  v_month_start date := date_trunc ('month', v_today::timestamp)::date;
  v_month_end date := (v_month_start + interval '1 month' - interval '1 day')::date;
begin
  return jsonb_build_object (
    'ok', true,
    'today_ugx', public._report_cash_drawer_expenses_ugx (v_shop, v_today, v_today),
    'week_ugx', public._report_cash_drawer_expenses_ugx (v_shop, v_week_start, v_today),
    'month_ugx', public._report_cash_drawer_expenses_ugx (v_shop, v_month_start, v_month_end),
    'top_categories', coalesce (
      (
        select jsonb_agg (row_data order by (row_data ->> 'total_ugx')::bigint desc)
        from (
          select jsonb_build_object (
            'category', e.category,
            'count', count(*)::int,
            'total_ugx', sum(e.amount_ugx)::bigint
          ) as row_data
          from public.expenses e
          where e.shop_id = v_shop
            and e.expense_type = 'cash_drawer'
            and e.deleted_at is null
            and e.paid_on between v_month_start and v_month_end
          group by e.category
          order by sum(e.amount_ugx) desc
          limit 8
        ) t
      ),
      '[]'::jsonb
    )
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_get_cash_expense_insights () from public;
grant execute on function public.shop_get_cash_expense_insights () to authenticated;

-- ---------- Daily summary: expected cash in drawer ----------
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
  v_expenses bigint := 0;
  v_cash bigint := 0;
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

  select * into v_returns
  from public._report_returns_summary (v_shop, v_day, v_day);

  v_expenses := public._report_cash_drawer_expenses_ugx (v_shop, v_day, v_day);
  v_cash := coalesce (v_row.cash, 0);

  return jsonb_build_object (
    'ok', true,
    'day', v_day,
    'transaction_count', coalesce (v_row.tx_count, 0),
    'total_revenue_ugx', greatest (0, coalesce (v_row.revenue, 0) - coalesce (v_returns.refunds_ugx, 0)),
    'gross_revenue_ugx', coalesce (v_row.revenue, 0),
    'returns_refunds_ugx', coalesce (v_returns.refunds_ugx, 0),
    'return_count', coalesce (v_returns.return_count, 0),
    'cash_collected_ugx', v_cash,
    'cash_expenses_ugx', v_expenses,
    'expected_cash_in_drawer_ugx', greatest (0, v_cash - coalesce (v_returns.refunds_ugx, 0) - v_expenses),
    'debt_issued_ugx', coalesce (v_row.debt, 0),
    'discounts_ugx', coalesce (v_row.discounts, 0),
    'taxes_ugx', coalesce (v_row.taxes, 0),
    'estimated_profit_ugx', greatest (0, coalesce (v_profit, 0) - coalesce (v_returns.profit_reduction_ugx, 0)),
    'average_transaction_ugx',
      case when coalesce (v_row.tx_count, 0) > 0
        then (greatest (0, coalesce (v_row.revenue, 0) - coalesce (v_returns.refunds_ugx, 0)) / v_row.tx_count)::bigint
        else 0
      end
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

-- ---------- Monthly: exclude soft-deleted drawer expenses ----------
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
  v_start date := to_date (v_month || '-01', 'YYYY-MM-DD');
  v_end date := (v_start + interval '1 month' - interval '1 day')::date;
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

  select * into v_returns
  from public._report_returns_summary (v_shop, v_start, v_end);

  v_expenses := public._report_cash_drawer_expenses_ugx (v_shop, v_start, v_end);

  return jsonb_build_object (
    'ok', true,
    'month', v_month,
    'transaction_count', coalesce (v_cur.tx_count, 0),
    'total_revenue_ugx', greatest (0, coalesce (v_cur.revenue, 0) - coalesce (v_returns.refunds_ugx, 0)),
    'gross_revenue_ugx', coalesce (v_cur.revenue, 0),
    'returns_refunds_ugx', coalesce (v_returns.refunds_ugx, 0),
    'return_count', coalesce (v_returns.return_count, 0),
    'cash_collected_ugx', coalesce (v_cur.cash, 0),
    'debt_issued_ugx', coalesce (v_cur.debt, 0),
    'estimated_profit_ugx', greatest (0, coalesce (v_profit, 0) - coalesce (v_returns.profit_reduction_ugx, 0)),
    'expenses_ugx', v_expenses,
    'net_earnings_ugx', greatest (0, coalesce (v_profit, 0) - coalesce (v_returns.profit_reduction_ugx, 0)) - v_expenses,
    'previous_month_revenue_ugx', coalesce (v_prev.revenue, 0),
    'revenue_growth_pct',
      case
        when coalesce (v_prev.revenue, 0) <= 0 then null
        else round((
          (greatest (0, coalesce (v_cur.revenue, 0) - coalesce (v_returns.refunds_ugx, 0))::numeric - v_prev.revenue::numeric)
          / v_prev.revenue::numeric
        ) * 100, 1)
      end
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

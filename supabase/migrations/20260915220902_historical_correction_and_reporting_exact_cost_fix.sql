-- P1 REMEDIATION — rounded DB cost column leakage (financial certification
-- audit, P1#1).
--
-- products.cost_price_per_unit_ugx is a rounded bigint shadow: for a product
-- whose buyingPackCostUgx does not divide evenly by conversionRate (e.g.
-- 10000 / 30 = 333.333...), this column stores the rounded/truncated integer
-- (333), while the authoritative exact value lives in
-- products.metadata.exactCostPricePerUnitUgx (333.3333333333333). The client
-- (src/offline/cloudSync.ts) has always preferred the exact metadata value.
-- Several server-side functions did not, and were flagged by the audit as
-- UNSAFE. This migration fixes only those confirmed-unsafe call sites.
--
-- Fixed here (all switched to the existing canonical helper
-- product_exact_unit_cost_ugx(), migration 167 — previously an orphaned,
-- unused reference implementation):
--   1. shop_correct_sale_line_financials — v_historical_unit_cost fallback
--      (the bug that could make the correction RPC reject a mathematically
--      correct correction with provenance_mismatch for any product whose
--      exact unit cost isn't a whole number).
--   2. shop_get_daily_sales_summary
--   3. shop_get_monthly_sales_summary
--   4. shop_get_top_products
--   5. shop_get_inventory_insights
--   6. _report_returns_summary
--   7. _report_voids_summary (feeds AskWaka tools transitively — no direct
--      AskWaka function change needed, they only ever call these RPCs)
--
-- Classified SAFE and deliberately NOT touched by this migration (per the
-- audit's explicit instruction not to blindly replace every occurrence):
--   - Every client-side (TypeScript) read of costPricePerUnitUgx: already
--     resolves to the exact value via cloudSync.ts's rowToProduct.
--   - product_exact_unit_cost_ugx() itself (migration 167) — already correct,
--     this migration just gives it real callers.
--   - shop_lookup_sale_line_for_correction — never reads a cost column at all.
--   - Any place cost_price_per_unit_ugx is written (cloudSync.ts productToRow,
--     product create/edit forms) — that column is INTENTIONALLY a rounded
--     display/persistence shadow; writing a rounded integer into a bigint
--     column is correct, the bug was only ever in code that later trusted
--     that rounded value as if it were exact.
--
-- No historical sale, correction, or product row is modified by this
-- migration — it only changes function bodies (query logic), not data.

-- ============================================================
-- 1. shop_correct_sale_line_financials
-- ============================================================
create or replace function public.shop_correct_sale_line_financials(p_shop_id uuid, p_sale_id uuid, p_sale_line_item_id uuid, p_expected_current_revision bigint, p_expected_before jsonb, p_correction_basis jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_sale record;
  v_line record;
  v_product record;
  v_reason text;
  v_server_unit_cost_text text;
  v_server_cogs_text text;
  v_server_gp_text text;
  v_server_est_text text;
  v_server_unit_cost numeric;
  v_server_cogs numeric;
  v_server_gp numeric;
  v_server_est numeric;
  v_exp_unit_cost numeric;
  v_exp_cogs numeric;
  v_exp_gp numeric;
  v_exp_est numeric;
  v_basis_type text;
  v_pack_cost_text text;
  v_conversion_rate_text text;
  v_pack_cost numeric;
  v_conversion_rate numeric;
  v_computed_unit_cost numeric;
  v_historical_unit_cost numeric;
  v_source_ref_ids jsonb;
  v_proving_row record;
  v_new_unit_cost bigint;
  v_new_cogs bigint;
  v_new_gp bigint;
  v_new_est bigint;
  v_new_line_revision bigint;
  v_new_sale_revision bigint;
  v_correction_id uuid := gen_random_uuid();
  v_sale_gp_sum bigint;
  v_date_key text;
  v_return_conflict boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select ia.role into v_role
  from public.internal_admins ia
  where coalesce(ia.auth_user_id, ia.user_id) = v_uid
    and coalesce(ia.is_active, ia.active, true) = true
    and ia.role = any(array['super_admin','finance_admin'])
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_shop_id is null or p_sale_id is null or p_sale_line_item_id is null or p_expected_current_revision is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_arguments');
  end if;

  v_reason := trim(coalesce(p_reason, ''));
  if length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;

  -- Lock parent sale first (lock-order discipline), then the line.
  select id, shop_id, status, financial_revision, metadata, created_at
  into v_sale
  from public.sales
  where id = p_sale_id and shop_id = p_shop_id
  for update;

  if v_sale.id is null then
    return jsonb_build_object('ok', false, 'error', 'sale_not_found');
  end if;

  if v_sale.status <> 'completed' then
    return jsonb_build_object('ok', false, 'error', 'sale_not_completed');
  end if;

  select id, sale_id, product_id, quantity, line_total_ugx, metadata, financial_revision
  into v_line
  from public.sale_line_items
  where id = p_sale_line_item_id and sale_id = p_sale_id
  for update;

  if v_line.id is null then
    return jsonb_build_object('ok', false, 'error', 'line_not_found');
  end if;

  if coalesce((v_line.metadata ->> 'voided')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'line_voided');
  end if;

  select exists(
    select 1 from public.sale_returns sr where sr.sale_id = p_sale_id and sr.product_id = v_line.product_id
  ) into v_return_conflict;
  if v_return_conflict then
    return jsonb_build_object('ok', false, 'error', 'return_conflict');
  end if;

  if v_line.financial_revision <> p_expected_current_revision then
    return jsonb_build_object('ok', false, 'error', 'revision_conflict', 'current_revision', v_line.financial_revision);
  end if;

  -- Server-derived "before" — never trust client-submitted before values.
  v_server_unit_cost_text := v_line.metadata ->> 'unitCostUgx';
  v_server_cogs_text := v_line.metadata ->> 'cogsUgx';
  v_server_gp_text := v_line.metadata ->> 'grossProfitUgx';
  v_server_est_text := v_line.metadata ->> 'estimatedProfitUgx';

  if not (public._is_finite_numeric_text(v_server_unit_cost_text)
      and public._is_finite_numeric_text(v_server_cogs_text)
      and public._is_finite_numeric_text(v_server_gp_text)
      and public._is_finite_numeric_text(v_server_est_text)) then
    return jsonb_build_object('ok', false, 'error', 'malformed_current_metadata');
  end if;

  v_server_unit_cost := v_server_unit_cost_text::numeric;
  v_server_cogs := v_server_cogs_text::numeric;
  v_server_gp := v_server_gp_text::numeric;
  v_server_est := v_server_est_text::numeric;

  if p_expected_before is null
     or not public._is_finite_numeric_text(p_expected_before ->> 'unitCostUgx')
     or not public._is_finite_numeric_text(p_expected_before ->> 'cogsUgx')
     or not public._is_finite_numeric_text(p_expected_before ->> 'grossProfitUgx')
     or not public._is_finite_numeric_text(p_expected_before ->> 'estimatedProfitUgx') then
    return jsonb_build_object('ok', false, 'error', 'invalid_expected_before');
  end if;

  v_exp_unit_cost := (p_expected_before ->> 'unitCostUgx')::numeric;
  v_exp_cogs := (p_expected_before ->> 'cogsUgx')::numeric;
  v_exp_gp := (p_expected_before ->> 'grossProfitUgx')::numeric;
  v_exp_est := (p_expected_before ->> 'estimatedProfitUgx')::numeric;

  if v_exp_unit_cost <> v_server_unit_cost
     or v_exp_cogs <> v_server_cogs
     or v_exp_gp <> v_server_gp
     or v_exp_est <> v_server_est then
    return jsonb_build_object(
      'ok', false, 'error', 'stale_expected_before',
      'server_before', jsonb_build_object(
        'unitCostUgx', v_server_unit_cost, 'cogsUgx', v_server_cogs,
        'grossProfitUgx', v_server_gp, 'estimatedProfitUgx', v_server_est
      )
    );
  end if;

  v_basis_type := p_correction_basis ->> 'basisType';
  if v_basis_type is distinct from 'pack_cost_conversion' then
    return jsonb_build_object('ok', false, 'error', 'unsupported_basis');
  end if;

  v_pack_cost_text := p_correction_basis ->> 'packCostUgx';
  v_conversion_rate_text := p_correction_basis ->> 'conversionRate';
  if not public._is_finite_numeric_text(v_pack_cost_text) or not public._is_finite_numeric_text(v_conversion_rate_text) then
    return jsonb_build_object('ok', false, 'error', 'invalid_correction_basis');
  end if;
  v_pack_cost := v_pack_cost_text::numeric;
  v_conversion_rate := v_conversion_rate_text::numeric;
  if v_pack_cost <= 0 or v_conversion_rate <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_correction_basis');
  end if;

  select id, shop_id, conversion_rate, cost_price_per_unit_ugx, metadata
  into v_product
  from public.products
  where id = v_line.product_id and shop_id = p_shop_id;

  if v_product.id is null then
    return jsonb_build_object('ok', false, 'error', 'product_not_found');
  end if;

  if v_product.conversion_rate is null or v_conversion_rate <> v_product.conversion_rate then
    return jsonb_build_object('ok', false, 'error', 'conversion_rate_mismatch');
  end if;

  v_computed_unit_cost := round(v_pack_cost / v_conversion_rate, 2);

  -- Provenance: earliest logged cost change strictly after the sale, else current cost.
  select al.id, al.created_at, (chg ->> 'from')::numeric as from_cost
  into v_proving_row
  from public.audit_logs al
  cross join lateral jsonb_array_elements(coalesce(al.payload -> 'changes', '[]'::jsonb)) as chg
  where al.shop_id = p_shop_id
    and al.action = 'product_update'
    and (al.payload ->> 'productId') = v_product.id::text
    and chg ->> 'field' = 'cost'
    and al.created_at > v_sale.created_at
    and public._is_finite_numeric_text(chg ->> 'from')
  order by al.created_at asc
  limit 1;

  if v_proving_row.id is null then
    -- Authoritative current cost is the EXACT value (metadata.exactCostPricePerUnitUgx
    -- / buyingPackCostUgx ÷ conversionRate), not the rounded cost_price_per_unit_ugx
    -- bigint shadow column. Same coalesce chain as product_exact_unit_cost_ugx()
    -- (migration 167), inlined here rather than called because v_product is a
    -- partial `record` (only the columns explicitly selected above), not a real
    -- `products`-typed row, and constructing a synthetic one via row()::products
    -- would require guessing the table's full column order — fragile and unsafe
    -- to do inside the correction RPC itself. Rounded to 2dp here to match
    -- v_computed_unit_cost's own precision — otherwise a product whose exact cost
    -- isn't a whole number (e.g. 10000/30 = 333.333...) would fail
    -- provenance_mismatch even when the client's correction is exactly right
    -- (333.33 computed vs 333 rounded-column-only — audit finding P1#1).
    v_historical_unit_cost := round(coalesce(
      nullif((v_product.metadata ->> 'exactCostPricePerUnitUgx')::numeric, null),
      v_product.cost_price_per_unit_ugx::numeric
    ), 2);

    v_source_ref_ids := p_correction_basis -> 'sourceReferenceIds';
  else
    v_historical_unit_cost := round(v_proving_row.from_cost, 2);

    v_source_ref_ids := p_correction_basis -> 'sourceReferenceIds';
    if v_source_ref_ids is null
       or jsonb_typeof(v_source_ref_ids) <> 'array'
       or jsonb_array_length(v_source_ref_ids) <> 1
       or not (v_source_ref_ids ->> 0 ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
       or (v_source_ref_ids ->> 0)::uuid <> v_proving_row.id then
      return jsonb_build_object('ok', false, 'error', 'source_reference_required', 'proving_row_id', v_proving_row.id);
    end if;
  end if;

  if v_computed_unit_cost <> v_historical_unit_cost then
    return jsonb_build_object(
      'ok', false, 'error', 'provenance_mismatch',
      'computed_unit_cost', v_computed_unit_cost, 'historical_unit_cost', v_historical_unit_cost
    );
  end if;

  v_new_unit_cost := round(v_computed_unit_cost);
  v_new_cogs := round(v_computed_unit_cost * v_line.quantity);
  v_new_gp := v_line.line_total_ugx - v_new_cogs;
  v_new_est := v_new_gp;

  if abs(v_new_cogs) > 1000000000000000 or abs(v_new_gp) > 1000000000000000 then
    return jsonb_build_object('ok', false, 'error', 'value_out_of_range');
  end if;

  if v_new_unit_cost = v_server_unit_cost and v_new_cogs = v_server_cogs then
    return jsonb_build_object('ok', false, 'error', 'no_change');
  end if;

  -- Supersede prior active correction BEFORE inserting new one (partial unique index safety).
  update public.sale_line_item_corrections
  set superseded_at = now(), superseded_by = v_correction_id
  where sale_line_item_id = p_sale_line_item_id and superseded_at is null;

  v_new_line_revision := v_line.financial_revision + 1;

  update public.sale_line_items
  set
    metadata = metadata || jsonb_build_object(
      'unitCostUgx', v_new_unit_cost, 'cogsUgx', v_new_cogs,
      'grossProfitUgx', v_new_gp, 'estimatedProfitUgx', v_new_est
    ),
    financial_revision = v_new_line_revision
  where id = p_sale_line_item_id;

  insert into public.sale_line_item_corrections (
    id, sale_id, sale_line_item_id, shop_id, product_id, before, after, correction_basis,
    reason, corrected_by, corrected_role, resulting_revision, created_at
  ) values (
    v_correction_id, p_sale_id, p_sale_line_item_id, p_shop_id, v_line.product_id,
    jsonb_build_object('unitCostUgx', v_server_unit_cost, 'cogsUgx', v_server_cogs, 'grossProfitUgx', v_server_gp, 'estimatedProfitUgx', v_server_est),
    jsonb_build_object('unitCostUgx', v_new_unit_cost, 'cogsUgx', v_new_cogs, 'grossProfitUgx', v_new_gp, 'estimatedProfitUgx', v_new_est),
    p_correction_basis, v_reason, v_uid, v_role, v_new_line_revision, now()
  );

  -- Recompute sale-level profit excluding voided lines.
  select coalesce(sum((sli.metadata ->> 'grossProfitUgx')::numeric), 0)
  into v_sale_gp_sum
  from public.sale_line_items sli
  where sli.sale_id = p_sale_id
    and coalesce((sli.metadata ->> 'voided')::boolean, false) = false
    and public._is_finite_numeric_text(sli.metadata ->> 'grossProfitUgx');

  v_new_sale_revision := v_sale.financial_revision + 1;

  update public.sales
  set
    metadata = metadata || jsonb_build_object('estimatedProfitUgx', v_sale_gp_sum),
    financial_revision = v_new_sale_revision
  where id = p_sale_id;

  insert into public.shop_recovery_signals (shop_id, updated_at)
  values (p_shop_id, now())
  on conflict (shop_id) do update set updated_at = now();

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id, v_uid, v_role, 'financial_correction_applied',
    'Corrected line ' || p_sale_line_item_id::text,
    jsonb_build_object(
      'correctionId', v_correction_id, 'saleId', p_sale_id, 'saleLineItemId', p_sale_line_item_id,
      'before', jsonb_build_object('unitCostUgx', v_server_unit_cost, 'cogsUgx', v_server_cogs, 'grossProfitUgx', v_server_gp),
      'after', jsonb_build_object('unitCostUgx', v_new_unit_cost, 'cogsUgx', v_new_cogs, 'grossProfitUgx', v_new_gp)
    )
  );

  v_date_key := to_char(public._sale_kampala_day(v_sale.created_at), 'YYYY-MM-DD');

  return jsonb_build_object(
    'ok', true, 'correction_id', v_correction_id, 'resulting_line_revision', v_new_line_revision,
    'resulting_sale_revision', v_new_sale_revision,
    'closed_day_requires_regeneration', exists(
      select 1 from public.shop_day_closes d where d.shop_id = p_shop_id and d.date_key = v_date_key and d.superseded_at is null
    ),
    'affected_date_key', v_date_key
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'error', 'internal_error');
end;
$function$;

-- ============================================================
-- 2. shop_get_daily_sales_summary
-- ============================================================
create or replace function public.shop_get_daily_sales_summary(p_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
            public.product_exact_unit_cost_ugx (p),
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
$function$;

-- ============================================================
-- 3. shop_get_monthly_sales_summary
-- ============================================================
create or replace function public.shop_get_monthly_sales_summary(p_month text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
            public.product_exact_unit_cost_ugx (p),
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
$function$;

-- ============================================================
-- 4. shop_get_top_products
-- ============================================================
create or replace function public.shop_get_top_products(p_start_day date DEFAULT NULL::date, p_end_day date DEFAULT NULL::date, p_limit integer DEFAULT 10, p_order text DEFAULT 'top'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
              public.product_exact_unit_cost_ugx (p),
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
$function$;

-- ============================================================
-- 5. shop_get_inventory_insights
-- ============================================================
create or replace function public.shop_get_inventory_insights()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_shop uuid := public._report_assert_shop ();
  v_low jsonb;
  v_out jsonb;
  v_stock_value bigint := 0;
  v_restock jsonb;
begin
  select coalesce (sum(greatest (p.stock_on_hand, 0) * greatest (public.product_exact_unit_cost_ugx (p), 0)), 0)::bigint
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
$function$;

-- ============================================================
-- 6. _report_returns_summary
-- ============================================================
create or replace function public._report_returns_summary(p_shop uuid, p_start date, p_end date)
 RETURNS TABLE(return_count integer, refunds_ugx bigint, profit_reduction_ugx bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    count(*)::int as return_count,
    coalesce (sum(sr.refund_amount_ugx), 0)::bigint as refunds_ugx,
    coalesce (sum(
      sr.refund_amount_ugx - round(
        sr.quantity * coalesce (public.product_exact_unit_cost_ugx (p), 0)
      )::bigint
    ), 0)::bigint as profit_reduction_ugx
  from public.sale_returns sr
  left join public.products p on p.id = sr.product_id and p.shop_id = sr.shop_id
  where sr.shop_id = p_shop
    and public._sale_kampala_day (sr.created_at) between p_start and p_end;
$function$;

-- ============================================================
-- 7. _report_voids_summary
-- ============================================================
create or replace function public._report_voids_summary(p_shop uuid, p_start date, p_end date)
 RETURNS TABLE(void_count integer, voids_ugx bigint, profit_reduction_ugx bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    count(*)::int as void_count,
    coalesce (sum(sv.amount_ugx), 0)::bigint as voids_ugx,
    coalesce (sum(
      sv.amount_ugx - round(
        sv.quantity * coalesce (public.product_exact_unit_cost_ugx (p), 0)
      )::bigint
    ), 0)::bigint as profit_reduction_ugx
  from public.sale_voids sv
  left join public.products p on p.id = sv.product_id and p.shop_id = sv.shop_id
  where sv.shop_id = p_shop
    and public._sale_kampala_day (sv.created_at) between p_start and p_end;
$function$;

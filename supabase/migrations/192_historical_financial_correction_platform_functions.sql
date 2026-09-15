-- Historical financial correction platform infrastructure.
--
-- Already applied and verified live in production (this file mirrors that deployed
-- state for source control; do not re-apply blindly — check current production
-- function definitions first if this is ever reapplied).
--
-- Platform-wide by design: every function is parameterized by p_shop_id / p_sale_id /
-- p_sale_line_item_id / p_date_key with no shop, sale, product, or line identifier
-- hardcoded anywhere in this file. N&C is a reproduction case used to validate this
-- design, not a target this code is written around. Does NOT modify
-- shop_push_sale_complete.

create or replace function public._is_finite_numeric_text(p_text text)
returns boolean
language sql
immutable
as $$
  select p_text is not null and p_text ~ '^-?[0-9]+(\.[0-9]+)?$';
$$;

revoke all on function public._is_finite_numeric_text(text) from public;
grant execute on function public._is_finite_numeric_text(text) to authenticated;

-- ============================================================
create or replace function public.shop_correct_sale_line_financials(
  p_shop_id uuid,
  p_sale_id uuid,
  p_sale_line_item_id uuid,
  p_expected_current_revision bigint,
  p_expected_before jsonb,
  p_correction_basis jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  select id, shop_id, conversion_rate, cost_price_per_unit_ugx
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
    v_historical_unit_cost := v_product.cost_price_per_unit_ugx;
  else
    v_historical_unit_cost := v_proving_row.from_cost;

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
$$;

revoke all on function public.shop_correct_sale_line_financials(uuid, uuid, uuid, bigint, jsonb, jsonb, text) from public;
grant execute on function public.shop_correct_sale_line_financials(uuid, uuid, uuid, bigint, jsonb, jsonb, text) to authenticated;

-- ============================================================
create or replace function public.admin_regenerate_day_close_for_correction(
  p_shop_id uuid,
  p_date_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_active_id uuid;
  v_active_payload jsonb;
  v_has_returns_or_voids boolean;
  v_missing_snapshot_count int;
  v_malformed_snapshot_count int;
  v_fresh_profit bigint;
  v_stored_top_text text;
  v_stored_top bigint;
  v_stored_nested_text text;
  v_stored_nested bigint;
  v_has_snapshot boolean;
  v_needs_regen boolean;
  v_all_correction_ids jsonb;
  v_new_id uuid;
  v_new_payload jsonb;
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

  if p_shop_id is null or p_date_key is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_arguments');
  end if;

  perform pg_advisory_xact_lock(hashtext(p_shop_id::text), hashtext(p_date_key));

  select id, payload into v_active_id, v_active_payload
  from public.shop_day_closes
  where shop_id = p_shop_id and date_key = p_date_key and superseded_at is null
  for update;

  if v_active_id is null then
    return jsonb_build_object('ok', true, 'no_active_close', true);
  end if;

  select exists(
    select 1 from public.sale_returns sr
    where sr.shop_id = p_shop_id
      and to_char(public._sale_kampala_day(sr.created_at), 'YYYY-MM-DD') = p_date_key
  ) or exists(
    select 1
    from public.audit_logs al
    where al.shop_id = p_shop_id
      and al.action in ('sale_void', 'controlled_void')
      and (
        al.payload ->> 'saleId' is null
        or al.payload ->> 'saleId' !~ '^[0-9a-fA-F-]{36}$'
        or exists(
          select 1 from public.sales s4
          where s4.id = (al.payload ->> 'saleId')::uuid
            and to_char(public._sale_kampala_day(s4.created_at), 'YYYY-MM-DD') = p_date_key
        )
      )
  ) into v_has_returns_or_voids;

  if v_has_returns_or_voids then
    return jsonb_build_object('ok', false, 'error', 'requires_manual_review', 'reason', 'date_has_returns_or_line_voids_cannot_safely_auto_recompute');
  end if;

  with scoped_lines as (
    select
      (sli.metadata ? 'netRevenueUgx') and (sli.metadata ? 'cogsUgx') and (sli.metadata ? 'grossProfitUgx') as has_snapshot,
      sli.metadata ->> 'grossProfitUgx' as gp_text
    from public.sale_line_items sli
    join public.sales s on s.id = sli.sale_id
    where s.shop_id = p_shop_id
      and s.status = 'completed'
      and to_char(public._sale_kampala_day(s.created_at), 'YYYY-MM-DD') = p_date_key
      and coalesce((sli.metadata ->> 'voided')::boolean, false) = false
  ),
  validated as (
    select
      has_snapshot,
      case
        when not has_snapshot then null
        when gp_text !~ '^-?[0-9]+$' then null
        when abs(gp_text::numeric) > 1000000000000000 then null
        else gp_text::bigint
      end as safe_value
    from scoped_lines
  )
  select
    count(*) filter (where not has_snapshot),
    count(*) filter (where has_snapshot and safe_value is null),
    coalesce(sum(safe_value), 0)
  into v_missing_snapshot_count, v_malformed_snapshot_count, v_fresh_profit
  from validated;

  if v_missing_snapshot_count > 0 or v_malformed_snapshot_count > 0 then
    return jsonb_build_object(
      'ok', false, 'error', 'requires_manual_review',
      'reason', case when v_missing_snapshot_count > 0 then 'line_missing_financial_snapshot_fields' else 'malformed_or_out_of_range_line_financial_metadata' end
    );
  end if;

  v_stored_top_text := v_active_payload ->> 'profitEstimateUgx';
  v_stored_top := case when v_stored_top_text ~ '^-?[0-9]+$' and abs(v_stored_top_text::numeric) <= 1000000000000000 then v_stored_top_text::bigint else null end;

  v_has_snapshot := jsonb_typeof(v_active_payload -> 'documentSnapshot') = 'object';
  if v_has_snapshot then
    v_stored_nested_text := v_active_payload #>> '{documentSnapshot,profitEstimateUgx}';
    v_stored_nested := case when v_stored_nested_text ~ '^-?[0-9]+$' and abs(v_stored_nested_text::numeric) <= 1000000000000000 then v_stored_nested_text::bigint else null end;
  end if;

  v_needs_regen := (v_stored_top is distinct from v_fresh_profit)
    or (v_has_snapshot and v_stored_nested is distinct from v_fresh_profit);

  if not v_needs_regen then
    return jsonb_build_object('ok', true, 'already_reflected', true, 'active_close_id', v_active_id, 'profit_estimate_ugx', v_fresh_profit);
  end if;

  select coalesce(jsonb_agg(c.id::text), '[]'::jsonb)
  into v_all_correction_ids
  from public.sale_line_item_corrections c
  join public.sales s5 on s5.id = c.sale_id
  where s5.shop_id = p_shop_id
    and s5.status = 'completed'
    and to_char(public._sale_kampala_day(s5.created_at), 'YYYY-MM-DD') = p_date_key;

  v_new_id := gen_random_uuid();
  v_new_payload := v_active_payload || jsonb_build_object(
    'profitEstimateUgx', v_fresh_profit,
    'priorPeriodAdjustment', coalesce(v_active_payload -> 'priorPeriodAdjustment', '{}'::jsonb) || jsonb_build_object(
      'recomputationMethod', 'fresh_absolute_from_current_sale_line_items',
      'correctionRecordIds', v_all_correction_ids,
      'previousProfitEstimateUgx', v_stored_top,
      'previousDocumentSnapshotProfitEstimateUgx', v_stored_nested
    )
  );
  if v_has_snapshot then
    v_new_payload := jsonb_set(v_new_payload, '{documentSnapshot,profitEstimateUgx}', to_jsonb(v_fresh_profit), true);
  end if;

  update public.shop_day_closes set superseded_at = now(), updated_at = now() where id = v_active_id;

  insert into public.shop_day_closes (id, shop_id, date_key, superseded_at, payload, created_at, updated_at)
  values (v_new_id, p_shop_id, p_date_key, null, v_new_payload, now(), now());

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id, v_uid, v_role, 'day_close_prior_period_adjustment',
    'Regenerated close for ' || p_date_key || ' (top ' || coalesce(v_stored_top::text,'null') || ' / nested ' || coalesce(v_stored_nested::text,'n/a') || ' -> ' || v_fresh_profit::text || ')',
    jsonb_build_object('superseded_close_id', v_active_id, 'new_close_id', v_new_id,
      'previous_top_profit_ugx', v_stored_top, 'previous_nested_profit_ugx', v_stored_nested,
      'fresh_profit_ugx', v_fresh_profit, 'correction_record_ids', v_all_correction_ids)
  );

  return jsonb_build_object('ok', true, 'superseded_close_id', v_active_id, 'new_close_id', v_new_id, 'profit_estimate_ugx', v_fresh_profit);
exception
  when others then
    return jsonb_build_object('ok', false, 'error', 'internal_error');
end;
$$;

revoke all on function public.admin_regenerate_day_close_for_correction(uuid, text) from public;
grant execute on function public.admin_regenerate_day_close_for_correction(uuid, text) to authenticated;

-- ============================================================
create or replace function public.shop_get_financial_fingerprint(p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.is_waka_internal_role(array['super_admin','finance_admin'])
     and not public.user_can_access_shop(p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  return (
    select jsonb_build_object(
      'ok', true,
      'shop_id', p_shop_id,
      'line_count', count(*) filter (where sli.financial_revision > 0),
      'max_line_revision', coalesce(max(sli.financial_revision), 0),
      'revision_sum', coalesce(sum(sli.financial_revision), 0),
      'digest', md5(coalesce(string_agg(
        sli.id::text || ':' || sli.financial_revision::text || ':' || coalesce(sli.metadata->>'grossProfitUgx',''),
        ',' order by sli.id
      ), ''))
    )
    from public.sale_line_items sli
    join public.sales s on s.id = sli.sale_id
    where s.shop_id = p_shop_id and s.status = 'completed' and sli.financial_revision > 0
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'error', 'internal_error');
end;
$$;

revoke all on function public.shop_get_financial_fingerprint(uuid) from public;
grant execute on function public.shop_get_financial_fingerprint(uuid) to authenticated;

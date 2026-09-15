-- Historical financial correction RPC (Phase 5).
--
-- The exclusive, controlled write path for correcting a completed sale line's
-- cogsUgx/unitCostUgx/grossProfitUgx/estimatedProfitUgx after the fact. Nothing else
-- may write sale_line_item_corrections (see migration 155's RLS policy — no
-- insert/update/delete policy exists for any role); this function, security definer,
-- is the only writer.
--
-- Scope, enforced structurally by never issuing a statement against these tables:
-- quantity/unit_price_ugx/line_total_ugx/line_discount_ugx, products.stock_on_hand,
-- inventory_movements, sale_payments, cash/debt fields, packCostUnitsDepleted,
-- non-financial sale metadata, and shop_day_closes are never touched by this function.

create or replace function public.shop_correct_sale_line_financials (
  p_shop_id uuid,
  p_sale_id uuid,
  p_sale_line_item_id uuid,
  p_expected_current_revision bigint,
  p_expected_before jsonb,
  p_corrected jsonb,
  p_correction_basis jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_role text;
  v_sale_status text;
  v_sale_shop_id uuid;
  v_line_sale_id uuid;
  v_line_product_id uuid;
  v_line_quantity numeric;
  v_line_metadata jsonb;
  v_line_revision bigint;
  v_has_return boolean;
  v_sale_voided boolean;
  v_line_voided boolean;
  v_basis_type text;
  v_pack_cost numeric;
  v_conversion_rate numeric;
  v_expected_unit_cost numeric;
  v_expected_cogs numeric;
  v_corrected_unit_cost numeric;
  v_corrected_cogs numeric;
  v_corrected_gross_profit numeric;
  v_corrected_estimated_profit numeric;
  v_correction_id uuid;
  v_prior_active_correction_id uuid;
  v_new_revision bigint;
  v_new_line_metadata jsonb;
  v_new_sale_profit bigint;
  v_new_sale_revision bigint;
begin
  ---------------------------------------------------------------------------
  -- 1. Authorize
  ---------------------------------------------------------------------------
  if v_uid is null then
    raise exception 'Forbidden';
  end if;

  select ia.role into v_role
  from public.internal_admins ia
  where coalesce (ia.auth_user_id, ia.user_id) = v_uid
    and coalesce (ia.is_active, ia.active, true) = true
    and ia.role = any (array['super_admin', 'finance_admin'])
  limit 1;

  if v_role is null then
    raise exception 'Forbidden';
  end if;

  if p_shop_id is null or p_sale_id is null or p_sale_line_item_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_arguments');
  end if;
  if p_reason is null or char_length (btrim (p_reason)) < 3 then
    return jsonb_build_object ('ok', false, 'error', 'reason_required');
  end if;

  ---------------------------------------------------------------------------
  -- 2. Verify sale belongs to shop
  ---------------------------------------------------------------------------
  select s.status, s.shop_id into v_sale_status, v_sale_shop_id
  from public.sales s
  where s.id = p_sale_id and s.shop_id = p_shop_id;

  if v_sale_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'sale_not_found');
  end if;

  ---------------------------------------------------------------------------
  -- 3. Verify completed status
  ---------------------------------------------------------------------------
  if v_sale_status <> 'completed' then
    return jsonb_build_object ('ok', false, 'error', 'sale_not_completed');
  end if;

  ---------------------------------------------------------------------------
  -- 4. Verify no return/void conflict
  ---------------------------------------------------------------------------
  select exists (select 1 from public.sale_returns sr where sr.sale_id = p_sale_id)
  into v_has_return;

  select (s.metadata ->> 'saleVoidedAt') is not null into v_sale_voided
  from public.sales s where s.id = p_sale_id;

  if v_has_return or coalesce (v_sale_voided, false) then
    return jsonb_build_object ('ok', false, 'error', 'return_or_void_conflict');
  end if;

  ---------------------------------------------------------------------------
  -- 5. Lock target line FOR UPDATE (also validates it belongs to p_sale_id)
  ---------------------------------------------------------------------------
  select sli.sale_id, sli.product_id, sli.quantity, sli.metadata, coalesce (sli.financial_revision, 0)
  into v_line_sale_id, v_line_product_id, v_line_quantity, v_line_metadata, v_line_revision
  from public.sale_line_items sli
  where sli.id = p_sale_line_item_id
  for update;

  if v_line_sale_id is null or v_line_sale_id <> p_sale_id then
    return jsonb_build_object ('ok', false, 'error', 'line_not_found');
  end if;

  v_line_voided := coalesce ((v_line_metadata ->> 'voided')::boolean, false);
  if v_line_voided then
    return jsonb_build_object ('ok', false, 'error', 'return_or_void_conflict');
  end if;

  ---------------------------------------------------------------------------
  -- 6. Compare expected revision
  ---------------------------------------------------------------------------
  if v_line_revision <> coalesce (p_expected_current_revision, -1) then
    return jsonb_build_object (
      'ok', false, 'error', 'stale_revision', 'server_revision', v_line_revision
    );
  end if;

  ---------------------------------------------------------------------------
  -- 7. Compare expected-before financial values
  ---------------------------------------------------------------------------
  if p_expected_before is null
     or (p_expected_before ->> 'cogsUgx')::numeric is distinct from (v_line_metadata ->> 'cogsUgx')::numeric
     or (p_expected_before ->> 'unitCostUgx')::numeric is distinct from (v_line_metadata ->> 'unitCostUgx')::numeric
     or (p_expected_before ->> 'grossProfitUgx')::numeric is distinct from (v_line_metadata ->> 'grossProfitUgx')::numeric
  then
    return jsonb_build_object (
      'ok', false, 'error', 'stale_before_values',
      'server_values', jsonb_build_object (
        'cogsUgx', v_line_metadata -> 'cogsUgx',
        'unitCostUgx', v_line_metadata -> 'unitCostUgx',
        'grossProfitUgx', v_line_metadata -> 'grossProfitUgx',
        'estimatedProfitUgx', v_line_metadata -> 'estimatedProfitUgx'
      )
    );
  end if;

  ---------------------------------------------------------------------------
  -- 8. Validate correction basis
  ---------------------------------------------------------------------------
  v_basis_type := p_correction_basis ->> 'basisType';
  v_corrected_unit_cost := (p_corrected ->> 'unitCostUgx')::numeric;
  v_corrected_cogs := (p_corrected ->> 'cogsUgx')::numeric;
  v_corrected_gross_profit := (p_corrected ->> 'grossProfitUgx')::numeric;
  v_corrected_estimated_profit := coalesce ((p_corrected ->> 'estimatedProfitUgx')::numeric, v_corrected_gross_profit);

  if v_basis_type is null or v_corrected_unit_cost is null or v_corrected_cogs is null or v_corrected_gross_profit is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_correction_basis');
  end if;

  if v_corrected_unit_cost < 0 or v_corrected_cogs < 0 then
    return jsonb_build_object ('ok', false, 'error', 'impossible_financial_values');
  end if;

  if v_basis_type = 'pack_cost_conversion' then
    v_pack_cost := (p_correction_basis ->> 'packCostUgx')::numeric;
    v_conversion_rate := (p_correction_basis ->> 'conversionRate')::numeric;
    if v_pack_cost is null or v_conversion_rate is null or v_conversion_rate <= 0 then
      return jsonb_build_object ('ok', false, 'error', 'invalid_correction_basis');
    end if;
    v_expected_unit_cost := round (v_pack_cost / v_conversion_rate, 2);
    v_expected_cogs := round (v_expected_unit_cost * v_line_quantity);
    if abs (v_corrected_unit_cost - v_expected_unit_cost) > 1 or abs (v_corrected_cogs - v_expected_cogs) > 1 then
      return jsonb_build_object ('ok', false, 'error', 'invalid_correction_basis');
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 9 + 10. Insert correction record; supersede previous active correction if any
  ---------------------------------------------------------------------------
  select id into v_prior_active_correction_id
  from public.sale_line_item_corrections
  where sale_line_item_id = p_sale_line_item_id and superseded_at is null;

  v_new_revision := v_line_revision + 1;
  v_correction_id := gen_random_uuid ();

  begin
    insert into public.sale_line_item_corrections (
      id, sale_id, sale_line_item_id, shop_id, product_id,
      before, after, correction_basis, reason,
      corrected_by, corrected_role, resulting_revision, created_at
    )
    values (
      v_correction_id, p_sale_id, p_sale_line_item_id, p_shop_id, v_line_product_id,
      p_expected_before, p_corrected, p_correction_basis, btrim (p_reason),
      v_uid, v_role, v_new_revision, now ()
    );
  exception
    when unique_violation then
      return jsonb_build_object ('ok', false, 'error', 'duplicate_active_correction');
  end;

  if v_prior_active_correction_id is not null then
    update public.sale_line_item_corrections
    set superseded_at = now (), superseded_by = v_correction_id
    where id = v_prior_active_correction_id;
  end if;

  ---------------------------------------------------------------------------
  -- 11 + 12. Update ONLY the four financial metadata fields; increment line revision
  ---------------------------------------------------------------------------
  v_new_line_metadata := v_line_metadata || jsonb_build_object (
    'unitCostUgx', v_corrected_unit_cost,
    'cogsUgx', v_corrected_cogs,
    'grossProfitUgx', v_corrected_gross_profit,
    'estimatedProfitUgx', v_corrected_estimated_profit
  );

  update public.sale_line_items
  set metadata = v_new_line_metadata,
      financial_revision = v_new_revision
  where id = p_sale_line_item_id;

  ---------------------------------------------------------------------------
  -- 13 + 14. Recompute sale header from ALL current lines; increment sale revision
  ---------------------------------------------------------------------------
  -- Matches the existing repairLegacySaleFinancials/normalizeSale convention: a line
  -- without a usable estimatedProfitUgx/grossProfitUgx contributes exactly 0, it is
  -- never treated as 100% margin (unlike shop_get_daily_sales_summary's line_total_ugx
  -- fallback, which this RPC deliberately does not reuse).
  select coalesce (sum (
    coalesce (
      (sli.metadata ->> 'estimatedProfitUgx')::bigint,
      (sli.metadata ->> 'grossProfitUgx')::bigint,
      0
    )
  ), 0)
  into v_new_sale_profit
  from public.sale_line_items sli
  where sli.sale_id = p_sale_id;

  select coalesce (financial_revision, 0) + 1 into v_new_sale_revision
  from public.sales where id = p_sale_id;

  update public.sales
  set metadata = coalesce (metadata, '{}'::jsonb) || jsonb_build_object ('estimatedProfitUgx', v_new_sale_profit),
      financial_revision = v_new_sale_revision,
      updated_at = now ()
  where id = p_sale_id and shop_id = p_shop_id;

  ---------------------------------------------------------------------------
  -- 15. Audit log
  ---------------------------------------------------------------------------
  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id, v_uid, v_role, 'sale_line_item_financial_correction',
    'Corrected line ' || p_sale_line_item_id::text || ' (revision ' || v_new_revision::text || ')',
    jsonb_build_object (
      'correction_id', v_correction_id,
      'sale_id', p_sale_id,
      'sale_line_item_id', p_sale_line_item_id,
      'before', p_expected_before,
      'after', p_corrected,
      'correction_basis', p_correction_basis,
      'reason', btrim (p_reason),
      'resulting_line_revision', v_new_revision,
      'resulting_sale_revision', v_new_sale_revision
    )
  );

  ---------------------------------------------------------------------------
  -- 16. Recovery signal
  ---------------------------------------------------------------------------
  -- Isolated sub-block: a race on this low-stakes signal table (unrelated to the
  -- correction itself) must never roll back the correction/audit work already done
  -- above, so it gets its own exception scope rather than sharing the function's
  -- top-level handler.
  begin
    update public.shop_recovery_signals
    set force_full_resync_at = now (), updated_at = now ()
    where shop_id = p_shop_id;
    if not found then
      insert into public.shop_recovery_signals (shop_id, force_full_resync_at, updated_at)
      values (p_shop_id, now (), now ());
    end if;
  exception
    when others then
      null; -- best-effort; the correction itself is already durable at this point
  end;

  return jsonb_build_object (
    'ok', true,
    'correction_id', v_correction_id,
    'sale_line_item_id', p_sale_line_item_id,
    'resulting_line_revision', v_new_revision,
    'resulting_sale_revision', v_new_sale_revision,
    'sale_estimated_profit_ugx', v_new_sale_profit
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_correct_sale_line_financials (uuid, uuid, uuid, bigint, jsonb, jsonb, jsonb, text) from public;
grant execute on function public.shop_correct_sale_line_financials (uuid, uuid, uuid, bigint, jsonb, jsonb, jsonb, text) to authenticated;

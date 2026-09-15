-- Stale-push protection for shop_push_sale_complete (Phase 4).
--
-- Problem (from audit): this RPC unconditionally deletes and reinserts every
-- sale_line_items row for a sale on every call, including for already-completed sales
-- (the v_was_completed branch only skips server-side arithmetic validation, it never
-- protected the financial metadata itself). A per-line void (voidSaleLine) or a product
-- return (returnProduct) on an already-completed sale both legitimately re-push the sale
-- through this same path with zero server-side re-validation, silently reverting any
-- financial correction a stale local copy doesn't know about yet.
--
-- Fix: guard ONLY the four financial metadata keys per line (cogsUgx, unitCostUgx,
-- grossProfitUgx, estimatedProfitUgx) plus sales.metadata.estimatedProfitUgx, using the
-- financial_revision counters added in migration 155. Every other field (quantity,
-- price, discount, void state, payment state, receipt metadata, non-financial sale
-- metadata) continues through exactly as before — a stale device is never blocked from
-- pushing legitimate non-financial changes to a corrected sale.
--
-- Revision comparison per line (incoming = coalesce(line->>'financialRevision', 0)):
--   no prior row for this line id        -> accept incoming as-is (genuinely new line)
--   stored revision  = incoming revision -> accept incoming financial fields
--   stored revision  > incoming revision -> preserve stored financial fields + revision
--   incoming revision > stored revision  -> never trust a client-asserted increase;
--                                            preserve stored + log financial_revision_anomaly
-- An old client that never sends financialRevision at all is treated as revision 0,
-- i.e. it behaves exactly like the "stored > incoming" case whenever the line has ever
-- been corrected — fail-closed by construction, no app update required for safety.
--
-- Sale header: once sales.financial_revision > 0 (this sale has ever been corrected),
-- sales.metadata.estimatedProfitUgx is permanently protected from this RPC — only
-- shop_correct_sale_line_financials may change it from that point on. Ordinary pushes
-- merge their own metadata normally but with estimatedProfitUgx pinned to the stored
-- value whenever financial_revision > 0.

create or replace function public.shop_push_sale_complete (
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
  v_sale_id uuid;
  v_sale jsonb;
  v_lines jsonb;
  v_payments jsonb;
  v_line jsonb;
  v_pay jsonb;
  v_was_completed boolean := false;
  v_line_id uuid;
  v_idx int := 0;
  v_stock_result jsonb;
  v_status text;
  v_validation jsonb;
  v_prior_financials jsonb;
  v_prior_line jsonb;
  v_prior_revision bigint;
  v_incoming_revision bigint;
  v_effective_metadata jsonb;
  v_effective_revision bigint;
  v_sale_stored_revision bigint;
  v_sale_effective_metadata jsonb;
  v_anomaly_count int := 0;
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

  v_sale := p_payload -> 'sale';
  v_lines := coalesce (p_payload -> 'lines', '[]'::jsonb);
  v_payments := coalesce (p_payload -> 'payments', '[]'::jsonb);

  if v_sale is null or jsonb_typeof (v_sale) <> 'object' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_sale');
  end if;

  v_sale_id := nullif (v_sale ->> 'id', '')::uuid;
  if v_sale_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_sale_id');
  end if;

  select (s.status = 'completed'), coalesce (s.financial_revision, 0)
  into v_was_completed, v_sale_stored_revision
  from public.sales s
  where s.id = v_sale_id and s.shop_id = p_shop_id;

  v_was_completed := coalesce (v_was_completed, false);
  v_sale_stored_revision := coalesce (v_sale_stored_revision, 0);

  if not v_was_completed then
    v_validation := public.validate_sale_push_financials (p_shop_id, v_sale, v_lines);
    if coalesce ((v_validation ->> 'ok')::boolean, false) is not true then
      return v_validation;
    end if;
  end if;

  -- Snapshot current financial state of every existing line for this sale BEFORE the
  -- delete, keyed by line id, so the reinsert loop below can guard against a stale push.
  select coalesce (
    jsonb_object_agg (
      sli.id::text,
      jsonb_build_object (
        'financial_revision', coalesce (sli.financial_revision, 0),
        'cogsUgx', sli.metadata -> 'cogsUgx',
        'unitCostUgx', sli.metadata -> 'unitCostUgx',
        'grossProfitUgx', sli.metadata -> 'grossProfitUgx',
        'estimatedProfitUgx', sli.metadata -> 'estimatedProfitUgx'
      )
    ),
    '{}'::jsonb
  )
  into v_prior_financials
  from public.sale_line_items sli
  where sli.sale_id = v_sale_id;

  insert into public.sales (
    id, shop_id, customer_id, status, payment_status, subtotal_ugx, tax_ugx,
    discount_ugx, total_ugx, cash_amount_ugx, debt_amount_ugx, issue_receipt,
    created_by, completed_at, metadata, created_at, updated_at
  )
  values (
    v_sale_id, p_shop_id, nullif (v_sale ->> 'customer_id', '')::uuid,
    'draft',
    coalesce (v_sale ->> 'payment_status', case when coalesce ((v_sale ->> 'debt_amount_ugx')::bigint, 0) > 0 then 'partial' else 'paid' end),
    coalesce ((v_sale ->> 'subtotal_ugx')::bigint, 0),
    coalesce ((v_sale ->> 'tax_ugx')::bigint, 0),
    coalesce ((v_sale ->> 'discount_ugx')::bigint, 0),
    coalesce ((v_sale ->> 'total_ugx')::bigint, 0),
    coalesce ((v_sale ->> 'cash_amount_ugx')::bigint, 0),
    coalesce ((v_sale ->> 'debt_amount_ugx')::bigint, 0),
    coalesce ((v_sale ->> 'issue_receipt')::boolean, false),
    coalesce (nullif (v_sale ->> 'created_by', '')::uuid, v_uid),
    null,
    coalesce (v_sale -> 'metadata', '{}'::jsonb),
    coalesce ((v_sale ->> 'created_at')::timestamptz, now ()),
    coalesce ((v_sale ->> 'updated_at')::timestamptz, now ())
  )
  on conflict (id) do update set
    customer_id = excluded.customer_id,
    subtotal_ugx = excluded.subtotal_ugx,
    tax_ugx = excluded.tax_ugx,
    discount_ugx = excluded.discount_ugx,
    total_ugx = excluded.total_ugx,
    cash_amount_ugx = excluded.cash_amount_ugx,
    debt_amount_ugx = excluded.debt_amount_ugx,
    metadata = excluded.metadata,
    updated_at = excluded.updated_at;

  delete from public.sale_line_items where sale_id = v_sale_id;
  delete from public.sale_payments where sale_id = v_sale_id;

  for v_line in select * from jsonb_array_elements (v_lines)
  loop
    v_idx := v_idx + 1;
    v_line_id := coalesce (nullif (v_line ->> 'id', '')::uuid, gen_random_uuid ());
    v_prior_line := v_prior_financials -> v_line_id::text;

    if v_prior_line is null then
      -- Genuinely new line (or the sale never had one at this id before) — nothing to
      -- protect, accept the incoming financial metadata and revision as-is.
      v_effective_metadata := coalesce (v_line -> 'metadata', '{}'::jsonb);
      v_effective_revision := coalesce ((v_line ->> 'financialRevision')::bigint, 0);
    else
      v_prior_revision := coalesce ((v_prior_line ->> 'financial_revision')::bigint, 0);
      v_incoming_revision := coalesce ((v_line ->> 'financialRevision')::bigint, 0);

      if v_incoming_revision > v_prior_revision then
        -- A client should never legitimately hold a revision higher than the server's —
        -- only shop_correct_sale_line_financials increments it. Treat as an anomaly:
        -- fail closed on the financial fields exactly like a stale push, and log it.
        v_anomaly_count := v_anomaly_count + 1;
        insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
        values (
          p_shop_id, v_uid, null, 'financial_revision_anomaly',
          'Line ' || v_line_id::text || ': incoming revision ' || v_incoming_revision::text ||
            ' > stored revision ' || v_prior_revision::text,
          jsonb_build_object (
            'sale_id', v_sale_id, 'sale_line_item_id', v_line_id,
            'stored_revision', v_prior_revision, 'incoming_revision', v_incoming_revision
          )
        );
        v_effective_metadata := coalesce (v_line -> 'metadata', '{}'::jsonb) || jsonb_build_object (
          'cogsUgx', v_prior_line -> 'cogsUgx',
          'unitCostUgx', v_prior_line -> 'unitCostUgx',
          'grossProfitUgx', v_prior_line -> 'grossProfitUgx',
          'estimatedProfitUgx', v_prior_line -> 'estimatedProfitUgx'
        );
        v_effective_revision := v_prior_revision;
      elsif v_prior_revision > v_incoming_revision then
        -- Stale push (includes old clients that never send financialRevision at all,
        -- which coalesce above already normalized to 0): preserve the corrected values.
        v_effective_metadata := coalesce (v_line -> 'metadata', '{}'::jsonb) || jsonb_build_object (
          'cogsUgx', v_prior_line -> 'cogsUgx',
          'unitCostUgx', v_prior_line -> 'unitCostUgx',
          'grossProfitUgx', v_prior_line -> 'grossProfitUgx',
          'estimatedProfitUgx', v_prior_line -> 'estimatedProfitUgx'
        );
        v_effective_revision := v_prior_revision;
      else
        -- Equal — client has already caught up to the current correction (or the line
        -- has never been corrected, 0 = 0). Accept incoming financial fields normally.
        v_effective_metadata := coalesce (v_line -> 'metadata', '{}'::jsonb);
        v_effective_revision := v_incoming_revision;
      end if;
    end if;

    insert into public.sale_line_items (
      id, sale_id, product_id, quantity, unit_price_ugx, line_discount_ugx,
      line_total_ugx, line_input_mode, money_amount_ugx, metadata, financial_revision
    )
    values (
      v_line_id, v_sale_id, nullif (v_line ->> 'product_id', '')::uuid,
      coalesce ((v_line ->> 'quantity')::numeric, 0),
      coalesce ((v_line ->> 'unit_price_ugx')::bigint, 0),
      coalesce ((v_line ->> 'line_discount_ugx')::bigint, 0),
      coalesce ((v_line ->> 'line_total_ugx')::bigint, 0),
      coalesce (nullif (v_line ->> 'line_input_mode', ''), 'quantity'),
      nullif (v_line ->> 'money_amount_ugx', '')::bigint,
      v_effective_metadata,
      v_effective_revision
    );
  end loop;

  for v_pay in select * from jsonb_array_elements (v_payments)
  loop
    insert into public.sale_payments (id, sale_id, method, amount_ugx, recorded_by)
    values (
      coalesce (nullif (v_pay ->> 'id', '')::uuid, gen_random_uuid ()),
      v_sale_id,
      coalesce (nullif (v_pay ->> 'method', ''), 'cash'),
      coalesce ((v_pay ->> 'amount_ugx')::bigint, 0),
      coalesce (nullif (v_pay ->> 'recorded_by', '')::uuid, v_uid)
    );
  end loop;

  -- Sale-header estimatedProfitUgx guard: once this sale has ever been corrected
  -- (financial_revision > 0), pin that one key to its current stored value regardless
  -- of what the client's own recomputation sends — only shop_correct_sale_line_financials
  -- may change it from this point forward.
  if v_sale_stored_revision > 0 then
    select coalesce (metadata, '{}'::jsonb) -> 'estimatedProfitUgx'
    into v_sale_effective_metadata
    from public.sales where id = v_sale_id and shop_id = p_shop_id;
    v_sale_effective_metadata := coalesce (v_sale -> 'metadata', '{}'::jsonb)
      || jsonb_build_object ('estimatedProfitUgx', v_sale_effective_metadata);
  else
    v_sale_effective_metadata := coalesce (v_sale -> 'metadata', '{}'::jsonb);
  end if;

  if not v_was_completed then
    update public.sales
    set status = 'completed',
        completed_at = coalesce ((v_sale ->> 'completed_at')::timestamptz, (v_sale ->> 'created_at')::timestamptz, now ()),
        payment_status = coalesce (v_sale ->> 'payment_status', case when coalesce ((v_sale ->> 'debt_amount_ugx')::bigint, 0) > 0 then 'partial' else 'paid' end),
        metadata = v_sale_effective_metadata,
        updated_at = now ()
    where id = v_sale_id and shop_id = p_shop_id and status is distinct from 'completed';
  else
    update public.sales
    set payment_status = coalesce (v_sale ->> 'payment_status', payment_status),
        cash_amount_ugx = coalesce ((v_sale ->> 'cash_amount_ugx')::bigint, cash_amount_ugx),
        debt_amount_ugx = coalesce ((v_sale ->> 'debt_amount_ugx')::bigint, debt_amount_ugx),
        total_ugx = coalesce ((v_sale ->> 'total_ugx')::bigint, total_ugx),
        subtotal_ugx = coalesce ((v_sale ->> 'subtotal_ugx')::bigint, subtotal_ugx),
        metadata = v_sale_effective_metadata,
        updated_at = now ()
    where id = v_sale_id and shop_id = p_shop_id;
  end if;

  select status into v_status from public.sales where id = v_sale_id and shop_id = p_shop_id;

  if v_status = 'completed' then
    v_stock_result := public.apply_sale_stock_movements (v_sale_id);
  else
    v_stock_result := '[]'::jsonb;
  end if;

  return jsonb_build_object (
    'ok', true, 'sale_id', v_sale_id, 'already_completed', v_was_completed,
    'stock_applied', v_status = 'completed',
    'product_stocks', coalesce (v_stock_result, '[]'::jsonb),
    'financial_anomalies_detected', v_anomaly_count
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_push_sale_complete (uuid, jsonb) from public;
grant execute on function public.shop_push_sale_complete (uuid, jsonb) to authenticated;

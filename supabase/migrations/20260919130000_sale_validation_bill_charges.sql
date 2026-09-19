-- F1 - the canonical sale validator must understand the bill charges the client already records.
--
-- finalizeDraftSale (usePosStore) builds a completed sale as
--     total = (listSubtotal - discount) + serviceChargeUgx + taxUgx + tipUgx
-- and keeps subtotal as the sum of the lines. The client pushes that sale to shop_push_sale_complete with
--     sale.subtotal_ugx, sale.discount_ugx, sale.total_ugx, sale.cash_amount_ugx, sale.debt_amount_ugx
--     sale.metadata.serviceChargeUgx / .tipUgx / .taxUgx   (hospitalitySaleMetadata; null when there is none)
-- but validate_sale_push_financials (migration 120) required total = subtotal - discount, so every sale carrying
-- a service charge, a tip or an exclusive tax was rejected with 'sale_total_mismatch' BEFORE any row was written:
-- it stayed local, was never stored on the server, and its stock deduction never happened there.
--
-- This replaces ONLY that function. The expected total becomes
--     greatest(0, subtotal - discount) + serviceChargeUgx + tipUgx + taxUgx
-- with the three amounts read from the sale's own metadata (the same object shop_push_sale_complete stores
-- verbatim in sales.metadata). Nothing else changes:
--   * a sale without those fields (every Retail/Duka/Pharmacy sale) validates exactly as before - absent or
--     null means 0, and the result JSON for every such input is identical to the previous version;
--   * every existing check, error code and the +/-1 rounding tolerance are unchanged;
--   * a charge that is negative, or not a JSON number, is rejected, so the extra terms cannot be used to make a
--     wrong total balance;
--   * cash + debt must still equal the total (a credit sale with charges owes the charges too).
-- No new function, table, column, grant or data change: the function keeps its signature, security definer,
-- volatility and search_path, and CREATE OR REPLACE keeps its existing privileges.

create or replace function public.validate_sale_push_financials (
  p_shop_id uuid,
  p_sale jsonb,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_subtotal bigint := 0;
  v_line_total bigint;
  v_unit_price bigint;
  v_line_discount bigint;
  v_quantity numeric;
  v_input_mode text;
  v_money_amount bigint;
  v_expected_line bigint;
  v_sale_subtotal bigint;
  v_sale_discount bigint;
  v_sale_total bigint;
  v_cash bigint;
  v_debt bigint;
  v_meta jsonb;
  v_key text;
  v_kind text;
  v_amount numeric;
  v_charges numeric := 0;
begin
  if p_sale is null or jsonb_typeof (p_sale) <> 'object' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_sale');
  end if;

  if p_lines is null or jsonb_typeof (p_lines) <> 'array' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_lines');
  end if;

  for v_line in select * from jsonb_array_elements (p_lines)
  loop
    v_quantity := coalesce ((v_line ->> 'quantity')::numeric, 0);
    v_unit_price := coalesce ((v_line ->> 'unit_price_ugx')::bigint, 0);
    v_line_discount := coalesce ((v_line ->> 'line_discount_ugx')::bigint, 0);
    v_line_total := coalesce ((v_line ->> 'line_total_ugx')::bigint, 0);
    v_input_mode := coalesce (nullif (v_line ->> 'line_input_mode', ''), 'quantity');
    v_money_amount := coalesce ((v_line ->> 'money_amount_ugx')::bigint, v_line_total);

    if v_quantity < 0 or v_unit_price < 0 or v_line_discount < 0 or v_line_total < 0 then
      return jsonb_build_object ('ok', false, 'error', 'negative_line_amount');
    end if;

    if v_input_mode = 'money' then
      if v_line_total <> v_money_amount then
        return jsonb_build_object ('ok', false, 'error', 'money_line_total_mismatch');
      end if;
    else
      v_expected_line := greatest (
        0,
        (round (v_quantity * v_unit_price)::bigint) - v_line_discount
      );
      if abs (v_line_total - v_expected_line) > 1 then
        return jsonb_build_object (
          'ok', false,
          'error', 'line_total_mismatch',
          'expected', v_expected_line,
          'actual', v_line_total
        );
      end if;
    end if;

    v_subtotal := v_subtotal + v_line_total;
  end loop;

  v_sale_subtotal := coalesce ((p_sale ->> 'subtotal_ugx')::bigint, 0);
  v_sale_discount := coalesce ((p_sale ->> 'discount_ugx')::bigint, 0);
  v_sale_total := coalesce ((p_sale ->> 'total_ugx')::bigint, 0);
  v_cash := coalesce ((p_sale ->> 'cash_amount_ugx')::bigint, 0);
  v_debt := coalesce ((p_sale ->> 'debt_amount_ugx')::bigint, 0);

  if v_sale_subtotal < 0 or v_sale_discount < 0 or v_sale_total < 0 or v_cash < 0 or v_debt < 0 then
    return jsonb_build_object ('ok', false, 'error', 'negative_sale_amount');
  end if;

  if abs (v_sale_subtotal - v_subtotal) > 1 then
    return jsonb_build_object (
      'ok', false,
      'error', 'subtotal_mismatch',
      'expected', v_subtotal,
      'actual', v_sale_subtotal
    );
  end if;

  -- Bill charges recorded by finalizeDraftSale: absent / null = none.
  v_meta := case when jsonb_typeof (p_sale -> 'metadata') = 'object' then p_sale -> 'metadata' else '{}'::jsonb end;
  foreach v_key in array array['serviceChargeUgx', 'tipUgx', 'taxUgx']
  loop
    v_kind := jsonb_typeof (v_meta -> v_key);
    if v_kind is null or v_kind = 'null' then
      v_amount := 0;
    elsif v_kind = 'number' then
      v_amount := (v_meta ->> v_key)::numeric;
    else
      return jsonb_build_object ('ok', false, 'error', 'invalid_bill_charge', 'field', v_key);
    end if;
    if v_amount < 0 then
      return jsonb_build_object ('ok', false, 'error', 'negative_sale_amount');
    end if;
    v_charges := v_charges + v_amount;
  end loop;

  if abs (v_sale_total - (greatest (0, v_sale_subtotal - v_sale_discount) + v_charges)) > 1 then
    return jsonb_build_object ('ok', false, 'error', 'sale_total_mismatch');
  end if;

  if abs (v_cash + v_debt - v_sale_total) > 1 then
    return jsonb_build_object ('ok', false, 'error', 'payment_total_mismatch');
  end if;

  return jsonb_build_object ('ok', true);
end;
$$;

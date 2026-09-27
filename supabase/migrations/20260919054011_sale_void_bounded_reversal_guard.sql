-- Round 4 - bounded reversal guard for sale voids (server side).
--
-- shop_apply_sale_void_stock (migration 179) is the ONLY place a completed-sale void reaches the cloud:
-- it records the void in sale_voids (the financial ledger) and restores stock, exactly once per
-- (void_record_id, product). Until now the server trusted the client for everything else: a void could
-- name a product that is not on the sale, exceed the quantity sold, or double-reverse units that a
-- return (another table, another id) had already reversed.
--
-- This replaces the function with the SAME function plus one check, on the path that carries the
-- financial ledger (sale_id + amount) and only for a void the server has not recorded yet:
--   * the product must be a line of that sale            -> void_product_not_in_sale
--   * voided + returned + this delta <= quantity sold     -> void_exceeds_sold
-- Idempotent replays, legacy calls without a sale id, and sales the server holds no line items for are
-- unchanged. No table is altered and nothing is backfilled or rewritten.
--
-- BEFORE APPLYING (recommended): the dry-run query in the accompanying test file's header lists any
-- historical (sale, product) whose recorded reversals already exceed the sold quantity; such rows never
-- re-run (their void ids exist), so they cannot be blocked by this guard, but they are worth knowing.

create or replace function public.shop_apply_sale_void_stock (
  p_shop_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_product_id uuid;
  v_void_record_id uuid;
  v_delta numeric;
  v_note text;
  v_product_shop uuid;
  v_sale_id uuid;
  v_amount bigint;
  v_line_index int;
  v_sale_voided_at timestamptz;
  v_already boolean := false;
  v_sale_shop uuid;
  v_sale_created timestamptz;
  v_date_key text;
  v_guard jsonb;
  v_sold numeric;
  v_lines int;
  v_reversed numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_product_id := nullif(p_payload ->> 'product_id', '')::uuid;
  v_void_record_id := nullif(
    coalesce(p_payload ->> 'void_record_id', p_payload ->> 'reference_id'),
    ''
  )::uuid;
  v_delta := coalesce((p_payload ->> 'delta')::numeric, 0);
  v_note := nullif(p_payload ->> 'note', '');
  v_sale_id := nullif(p_payload ->> 'sale_id', '')::uuid;
  v_amount := coalesce((p_payload ->> 'amount_ugx')::bigint, 0);
  v_line_index := coalesce((p_payload ->> 'line_index')::int, 0);
  v_sale_voided_at := nullif(p_payload ->> 'sale_voided_at', '')::timestamptz;

  if v_product_id is null or v_void_record_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;

  if v_delta <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_delta');
  end if;

  select p.shop_id into v_product_shop
  from public.products p
  where p.id = v_product_id and p.is_active = true;

  if v_product_shop is null then
    return jsonb_build_object('ok', false, 'error', 'product_not_found');
  end if;

  if p_shop_id is not null and p_shop_id is distinct from v_product_shop then
    return jsonb_build_object('ok', false, 'error', 'shop_mismatch');
  end if;

  if not public.user_is_cashier_or_above(v_product_shop) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_sale_id is not null and v_amount > 0 then
    select s.shop_id, coalesce(s.created_at, s.completed_at, now())
    into v_sale_shop, v_sale_created
    from public.sales s
    where s.id = v_sale_id;

    if v_sale_shop is null then
      return jsonb_build_object('ok', false, 'error', 'sale_not_found');
    end if;

    if v_sale_shop is distinct from v_product_shop then
      return jsonb_build_object('ok', false, 'error', 'shop_mismatch');
    end if;

    select exists (
      select 1 from public.sale_voids sv where sv.id = v_void_record_id
    ) into v_already;

    if not v_already then
      -- Bounded reversal (Round 4): a NEW void may only reverse what this sale actually sold, and never
      -- more than what is still un-reversed. The void record id is deterministic per sale line, so a
      -- replay is caught above (v_already); this closes the remaining doors: a void naming a product
      -- that is not on the sale (cross-sale / cross-line), a quantity beyond the sold quantity, and two
      -- devices reversing the same units through different records (a void plus a return, or two
      -- returns). Skipped only when the server holds no line items for the sale (nothing to check).
      -- serialise concurrent reversals of the same sale x product so both cannot pass the check
      perform pg_advisory_xact_lock (hashtextextended (v_sale_id::text || ':' || v_product_id::text, 0));

      select count(*), coalesce(sum(sli.quantity) filter (where sli.product_id = v_product_id), 0)
      into v_lines, v_sold
      from public.sale_line_items sli
      where sli.sale_id = v_sale_id;

      if v_lines > 0 then
        if v_sold <= 0 then
          return jsonb_build_object('ok', false, 'error', 'void_product_not_in_sale');
        end if;
        select
          coalesce((select sum(sv.quantity) from public.sale_voids sv
                    where sv.sale_id = v_sale_id and sv.product_id = v_product_id), 0)
          + coalesce((select sum(sr.quantity) from public.sale_returns sr
                      where sr.sale_id = v_sale_id and sr.product_id = v_product_id), 0)
        into v_reversed;
        if v_reversed + v_delta > v_sold + 0.0001 then
          return jsonb_build_object('ok', false, 'error', 'void_exceeds_sold');
        end if;
      end if;

      if to_regprocedure('public.assert_shop_business_date_open(uuid, text)') is not null
         and to_regprocedure('public._sale_kampala_day(timestamptz)') is not null then
        v_date_key := to_char(public._sale_kampala_day(v_sale_created), 'YYYY-MM-DD');
        v_guard := public.assert_shop_business_date_open(v_product_shop, v_date_key);
        if coalesce((v_guard ->> 'ok')::boolean, false) is not true then
          return jsonb_build_object('ok', false, 'error', 'closed_business_date');
        end if;
      end if;

      insert into public.sale_voids (
        id,
        shop_id,
        sale_id,
        product_id,
        quantity,
        amount_ugx,
        line_index,
        note,
        sale_voided_at,
        created_by,
        created_at,
        metadata
      )
      values (
        v_void_record_id,
        v_product_shop,
        v_sale_id,
        v_product_id,
        v_delta,
        v_amount,
        greatest(v_line_index, 0),
        v_note,
        v_sale_voided_at,
        v_uid,
        coalesce((p_payload ->> 'created_at')::timestamptz, now()),
        jsonb_build_object(
          'productName', coalesce(p_payload ->> 'product_name', ''),
          'lineIndex', greatest(v_line_index, 0)
        )
      )
      on conflict (id) do nothing;
    end if;
  end if;

  return public._apply_durable_stock_delta (
    v_product_shop,
    v_product_id,
    'sale_void',
    v_void_record_id,
    v_delta,
    'void',
    coalesce(v_note, 'sale_void')
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_apply_sale_void_stock (uuid, jsonb) from public;
grant execute on function public.shop_apply_sale_void_stock (uuid, jsonb) to authenticated;

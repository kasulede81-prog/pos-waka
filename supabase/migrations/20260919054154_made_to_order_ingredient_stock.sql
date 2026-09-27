-- Phase 5 - made-to-order recipe stock: the cloud finally agrees with the client.
--
-- WHAT WAS WRONG
--   apply_sale_stock_movements (083) subtracts the sold quantity of EVERY sale_line_items product from
--   products.stock_on_hand. A made-to-order dish has no finished stock: the client consumes its
--   INGREDIENTS at sale (and records exactly which, per line, in sale_line_items.metadata
--   .ingredientConsumption). The cloud never saw that: it drove the dish negative and left the
--   ingredients untouched, so any device that pulled/restored stock from the cloud lost the ingredient
--   consumption, and voids/returns credited a dish that never had stock.
--
-- WHAT THIS MIGRATION DOES (additive: create-or-replace of three functions + new helpers; no table is
-- altered, nothing is backfilled or rewritten)
--   1. apply_sale_stock_movements: a line with VALID recorded provenance is a made-to-order line -
--      the finished dish is NOT deducted, the recorded ingredient quantities are (aggregated per
--      ingredient across the sale, one idempotent 'recipe' movement each). Every other line
--      (retail, batch-prepared portions, legacy made-to-order without provenance, malformed
--      provenance) behaves EXACTLY as before. The server marks the lines it applied under the recipe
--      model (metadata.serverRecipeStockApplied) so later voids/returns know which model the sale used.
--   2. shop_apply_sale_void_line_stock (new RPC): the void of one sale LINE. For a marked recipe line
--      it records the void ledger row (sale_voids, bound to the line id) and credits the ingredients
--      the SERVER derives from the recorded provenance - never a client-supplied quantity - bounded by
--      what the line consumed. For any other line it delegates to shop_apply_sale_void_stock unchanged.
--   3. apply_sale_return_stock: same rule for returns (the return row carries the sale line id in its
--      metadata; a legacy return with no line id resolves to the product's only line, or is refused
--      when that is ambiguous and a recipe line is involved).
--
-- COMPATIBILITY BOUNDARY
--   A sale applied by the previous function (or by a client that sends no provenance) has no
--   serverRecipeStockApplied marker and is never converted: its voids/returns keep crediting the
--   finished product, mirroring what the cloud deducted for it. History is not rewritten and no
--   ingredient is guessed from today's recipe.
--
-- Independent of 20260919090000 (floor tombstones) and 20260919100000 (bounded void guard): this file
-- does not replace shop_apply_sale_void_stock.

-- ── helpers (internal) ───────────────────────────────────────────────────────

create or replace function public._wk_try_uuid (p text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p::uuid;
exception
  when others then
    return null;
end;
$$;

-- Structure-only view of a line's recorded provenance: an array of {productId uuid, quantity > 0},
-- aggregated per ingredient. NULL = absent or malformed (never guessed).
create or replace function public._wk_recipe_provenance_struct (p_metadata jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_raw jsonb := p_metadata -> 'ingredientConsumption';
  v_bad boolean;
begin
  if v_raw is null or jsonb_typeof (v_raw) <> 'array' then
    return null;
  end if;

  select bool_or (
    case
      when jsonb_typeof (e) <> 'object' then true
      when public._wk_try_uuid (e ->> 'productId') is null then true
      when jsonb_typeof (e -> 'quantity') <> 'number' then true
      when (e ->> 'quantity')::numeric <= 0 then true
      else false
    end
  )
  into v_bad
  from jsonb_array_elements (v_raw) e;

  if coalesce (v_bad, false) then
    return null;
  end if;

  return coalesce (
    (
      select jsonb_agg (jsonb_build_object ('productId', t.pid, 'quantity', t.q) order by t.pid)
      from (
        select (e ->> 'productId')::uuid as pid, sum ((e ->> 'quantity')::numeric) as q
        from jsonb_array_elements (v_raw) e
        group by 1
      ) t
    ),
    '[]'::jsonb
  );
end;
$$;

-- Provenance accepted at SALE time: structurally valid AND every ingredient is one the dish's own menu
-- recipe (base, variants, modifier options) actually uses. A client cannot make the cloud deduct an
-- arbitrary product by writing it into a made-to-order line.
create or replace function public.recipe_line_provenance (p_metadata jsonb, p_dish_id uuid, p_shop uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_prov jsonb := public._wk_recipe_provenance_struct (p_metadata);
  v_menu jsonb;
  v_allowed jsonb;
begin
  if v_prov is null then
    return null;
  end if;
  if jsonb_array_length (v_prov) = 0 then
    return v_prov;
  end if;

  select p.metadata -> 'menu' into v_menu
  from public.products p
  where p.id = p_dish_id and p.shop_id = p_shop;

  if v_menu is null or jsonb_typeof (v_menu) <> 'object' then
    return null;
  end if;

  v_allowed :=
    coalesce (jsonb_path_query_array (v_menu, '$.recipe.lines[*].ingredientProductId'), '[]'::jsonb)
    || coalesce (jsonb_path_query_array (v_menu, '$.variants[*].recipe.lines[*].ingredientProductId'), '[]'::jsonb)
    || coalesce (jsonb_path_query_array (v_menu, '$.modifierGroups[*].options[*].ingredientProductId'), '[]'::jsonb);

  if exists (
    select 1
    from jsonb_array_elements (v_prov) e
    where not (v_allowed @> to_jsonb (e ->> 'productId'))
  ) then
    return null;
  end if;

  return v_prov;
end;
$$;

-- Lines of a sale that are made-to-order recipe lines under the recipe model: valid provenance, and
-- either already marked by this server, or the sale has not been applied at all yet (so the previous
-- function cannot have deducted the dish for it).
create or replace function public._wk_recipe_lines (p_sale_id uuid, p_shop uuid, p_has_movements boolean)
returns table (line_id uuid, product_id uuid, quantity numeric, provenance jsonb)
language sql
stable
set search_path = public
as $$
  select x.id, x.product_id, x.quantity, x.prov
  from (
    select
      sli.id,
      sli.product_id,
      sli.quantity,
      sli.metadata,
      public.recipe_line_provenance (sli.metadata, sli.product_id, p_shop) as prov
    from public.sale_line_items sli
    where sli.sale_id = p_sale_id and sli.product_id is not null
  ) x
  where x.prov is not null
    and (
      coalesce (x.metadata ->> 'serverRecipeStockApplied', '') = 'true'
      or not p_has_movements
    );
$$;

-- Units of one line already reversed (voided + returned) according to the financial ledgers. Rows that
-- carry no line id count against a line only when it is the product's sole line on the sale.
create or replace function public._wk_recipe_line_reversed_qty (
  p_sale_id uuid,
  p_line_id uuid,
  p_exclude_return_id uuid default null
)
returns numeric
language sql
stable
set search_path = public
as $$
  with ln as (
    select sli.id, sli.product_id,
           (select count(*) from public.sale_line_items o
            where o.sale_id = sli.sale_id and o.product_id = sli.product_id) as same_product_lines
    from public.sale_line_items sli
    where sli.id = p_line_id and sli.sale_id = p_sale_id
  )
  select
    coalesce ((
      select sum (sv.quantity)
      from public.sale_voids sv, ln
      where sv.sale_id = p_sale_id
        and (
          sv.metadata ->> 'saleLineId' = ln.id::text
          or (coalesce (sv.metadata ->> 'saleLineId', '') = '' and sv.product_id = ln.product_id and ln.same_product_lines = 1)
        )
    ), 0)
    + coalesce ((
      select sum (sr.quantity)
      from public.sale_returns sr, ln
      where sr.sale_id = p_sale_id
        and (p_exclude_return_id is null or sr.id <> p_exclude_return_id)
        and (
          sr.metadata ->> 'saleLineId' = ln.id::text
          or (coalesce (sr.metadata ->> 'saleLineId', '') = '' and sr.product_id = ln.product_id and ln.same_product_lines = 1)
        )
    ), 0);
$$;

-- Ingredient quantity a reversal of p_qty gives back, on CUMULATIVE proportions so any sequence of
-- partial reversals sums to exactly the recorded consumption (mirrors the client's ingredientReversalFor).
create or replace function public._wk_recipe_credit (
  p_consumed numeric,
  p_line_qty numeric,
  p_before numeric,
  p_qty numeric
)
returns numeric
language sql
immutable
as $$
  select round (
    (case
       when least (1, greatest (0, (p_before + p_qty) / p_line_qty)) >= 1 - 0.000000001 then p_consumed
       else round (p_consumed * least (1, greatest (0, (p_before + p_qty) / p_line_qty)), 4)
     end)
    - (case
         when least (1, greatest (0, p_before / p_line_qty)) >= 1 - 0.000000001 then p_consumed
         else round (p_consumed * least (1, greatest (0, p_before / p_line_qty)), 4)
       end),
    4
  );
$$;

-- Movement ledger uniqueness for the recipe model (one movement per sale x ingredient).
create unique index if not exists inventory_movements_sale_recipe_unique
  on public.inventory_movements (shop_id, reference_type, reference_id, product_id)
  where reference_type = 'recipe' and reference_id is not null;

revoke all on function public._wk_try_uuid (text) from public, anon, authenticated;
revoke all on function public._wk_recipe_provenance_struct (jsonb) from public, anon, authenticated;
revoke all on function public.recipe_line_provenance (jsonb, uuid, uuid) from public, anon, authenticated;
revoke all on function public._wk_recipe_lines (uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public._wk_recipe_line_reversed_qty (uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._wk_recipe_credit (numeric, numeric, numeric, numeric) from public, anon, authenticated;

-- ── 1. sale application ──────────────────────────────────────────────────────

create or replace function public.apply_sale_stock_movements (p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_shop uuid;
  v_new numeric;
  v_updated_at timestamptz;
  v_movement_id uuid;
  v_stocks jsonb := '[]'::jsonb;
  v_has_movements boolean;
begin
  select shop_id into strict v_shop from public.sales where id = p_sale_id;

  -- Has ANY stock already been applied for this sale (by this or the previous function)? Decides,
  -- before anything is written, which lines are recipe lines (see _wk_recipe_lines).
  v_has_movements := exists (
    select 1
    from public.inventory_movements im
    where im.shop_id = v_shop
      and im.reference_id = p_sale_id
      and im.reference_type in ('sale', 'recipe')
  );

  -- (a) finished-product deduction - unchanged - for every line that is NOT a recipe line.
  for r in
    select sli.product_id, sum (sli.quantity) as quantity
    from public.sale_line_items sli
    where sli.sale_id = p_sale_id
      and sli.product_id is not null
      and not exists (
        select 1
        from public._wk_recipe_lines (p_sale_id, v_shop, v_has_movements) rl
        where rl.line_id = sli.id
      )
    group by sli.product_id
  loop
    if r.quantity <= 0 then
      continue;
    end if;

    if exists (
      select 1
      from public.inventory_movements im
      where im.shop_id = v_shop
        and im.reference_type = 'sale'
        and im.reference_id = p_sale_id
        and im.product_id = r.product_id
    ) then
      select p.stock_on_hand, p.updated_at
      into v_new, v_updated_at
      from public.products p
      where p.id = r.product_id and p.shop_id = v_shop;

      v_stocks := v_stocks || jsonb_build_array (
        jsonb_build_object (
          'product_id', r.product_id,
          'stock_on_hand', v_new,
          'updated_at', v_updated_at
        )
      );
      continue;
    end if;

    v_movement_id := public.inventory_movement_uuid (v_shop, 'sale', p_sale_id, r.product_id);

    update public.products p
    set stock_on_hand = p.stock_on_hand - r.quantity,
        updated_at = now ()
    where p.id = r.product_id
      and p.shop_id = v_shop
    returning p.stock_on_hand, p.updated_at into v_new, v_updated_at;

    if not found then
      raise exception 'Product % not in this shop', r.product_id;
    end if;

    insert into public.inventory_movements (
      id, shop_id, product_id, quantity_delta, reason, reference_type, reference_id, created_by
    )
    values (
      v_movement_id, v_shop, r.product_id, -r.quantity, 'sale', 'sale', p_sale_id, auth.uid ()
    )
    on conflict (id) do nothing;

    v_stocks := v_stocks || jsonb_build_array (
      jsonb_build_object (
        'product_id', r.product_id,
        'stock_on_hand', v_new,
        'updated_at', v_updated_at
      )
    );
  end loop;

  -- (b) made-to-order recipe lines: the dish is NOT deducted; the ingredients the client recorded for
  -- each line are, aggregated per ingredient across the sale (one idempotent movement each).
  for r in
    select (e ->> 'productId')::uuid as product_id, sum ((e ->> 'quantity')::numeric) as quantity
    from public._wk_recipe_lines (p_sale_id, v_shop, v_has_movements) rl,
         jsonb_array_elements (rl.provenance) e
    group by 1
  loop
    if r.quantity <= 0 then
      continue;
    end if;

    if exists (
      select 1
      from public.inventory_movements im
      where im.shop_id = v_shop
        and im.reference_type = 'recipe'
        and im.reference_id = p_sale_id
        and im.product_id = r.product_id
    ) then
      select p.stock_on_hand, p.updated_at
      into v_new, v_updated_at
      from public.products p
      where p.id = r.product_id and p.shop_id = v_shop;

      if found then
        v_stocks := v_stocks || jsonb_build_array (
          jsonb_build_object ('product_id', r.product_id, 'stock_on_hand', v_new, 'updated_at', v_updated_at)
        );
      end if;
      continue;
    end if;

    update public.products p
    set stock_on_hand = p.stock_on_hand - r.quantity,
        updated_at = now ()
    where p.id = r.product_id
      and p.shop_id = v_shop
    returning p.stock_on_hand, p.updated_at into v_new, v_updated_at;

    if not found then
      -- an ingredient that no longer exists in this shop cannot be consumed; it must not block the sale
      continue;
    end if;

    insert into public.inventory_movements (
      id, shop_id, product_id, quantity_delta, reason, reference_type, reference_id, note, created_by
    )
    values (
      public.inventory_movement_uuid (v_shop, 'recipe', p_sale_id, r.product_id),
      v_shop, r.product_id, -r.quantity, 'sale', 'recipe', p_sale_id, 'made_to_order_ingredients', auth.uid ()
    )
    on conflict (id) do nothing;

    v_stocks := v_stocks || jsonb_build_array (
      jsonb_build_object ('product_id', r.product_id, 'stock_on_hand', v_new, 'updated_at', v_updated_at)
    );
  end loop;

  -- (c) remember, per line, that THIS server applied it under the recipe model (server-authored key).
  update public.sale_line_items sli
  set metadata = sli.metadata || jsonb_build_object ('serverRecipeStockApplied', true)
  where sli.sale_id = p_sale_id
    and coalesce (sli.metadata ->> 'serverRecipeStockApplied', '') <> 'true'
    and sli.id in (select rl.line_id from public._wk_recipe_lines (p_sale_id, v_shop, v_has_movements) rl);

  return v_stocks;
end;
$$;

-- ── 2. void of one sale line ────────────────────────────────────────────────

create or replace function public.shop_apply_sale_void_line_stock (
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
  v_void_id uuid := public._wk_try_uuid (coalesce (p_payload ->> 'void_record_id', p_payload ->> 'reference_id'));
  v_sale_id uuid := public._wk_try_uuid (p_payload ->> 'sale_id');
  v_line_id uuid := public._wk_try_uuid (p_payload ->> 'sale_line_id');
  v_qty numeric := coalesce ((p_payload ->> 'delta')::numeric, (p_payload ->> 'quantity')::numeric, 0);
  v_amount bigint := coalesce ((p_payload ->> 'amount_ugx')::bigint, 0);
  v_line_index int := coalesce ((p_payload ->> 'line_index')::int, 0);
  v_note text := nullif (p_payload ->> 'note', '');
  v_sale_shop uuid;
  v_sale_created timestamptz;
  v_line record;
  v_prov jsonb;
  v_reversed numeric;
  v_credit numeric;
  v_res jsonb;
  v_stocks jsonb := '[]'::jsonb;
  v_date_key text;
  v_guard jsonb;
  e record;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if v_void_id is null or v_sale_id is null or v_line_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;
  if v_qty <= 0 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_delta');
  end if;

  select s.shop_id, coalesce (s.created_at, s.completed_at, now ())
  into v_sale_shop, v_sale_created
  from public.sales s
  where s.id = v_sale_id;

  if v_sale_shop is null then
    return jsonb_build_object ('ok', false, 'error', 'sale_not_found');
  end if;
  if p_shop_id is not null and p_shop_id is distinct from v_sale_shop then
    return jsonb_build_object ('ok', false, 'error', 'shop_mismatch');
  end if;
  if not public.user_is_cashier_or_above (v_sale_shop) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select sli.id, sli.product_id, sli.quantity, sli.metadata
  into v_line
  from public.sale_line_items sli
  where sli.id = v_line_id and sli.sale_id = v_sale_id;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'sale_line_not_found');
  end if;

  -- Not a recipe line under the recipe model (retail, batch-prepared, legacy): the existing void RPC,
  -- unchanged, for the sold product.
  if coalesce (v_line.metadata ->> 'serverRecipeStockApplied', '') <> 'true' then
    v_res := public.shop_apply_sale_void_stock (
      v_sale_shop,
      jsonb_strip_nulls (
        jsonb_build_object (
          'product_id', v_line.product_id,
          'void_record_id', v_void_id,
          'delta', v_qty,
          'sale_id', v_sale_id,
          'amount_ugx', nullif (v_amount, 0),
          'line_index', v_line_index,
          'note', v_note,
          'sale_voided_at', p_payload ->> 'sale_voided_at',
          'product_name', p_payload ->> 'product_name',
          'created_at', p_payload ->> 'created_at'
        )
      )
    );
    return v_res;
  end if;

  v_prov := public._wk_recipe_provenance_struct (v_line.metadata);
  if v_prov is null then
    return jsonb_build_object ('ok', false, 'error', 'recipe_provenance_invalid');
  end if;

  -- one reversal at a time per line: the cumulative bound below must not race
  perform pg_advisory_xact_lock (hashtextextended ('recipe-line:' || v_line_id::text, 0));

  if exists (select 1 from public.sale_voids sv where sv.id = v_void_id) then
    if not exists (
      select 1 from public.sale_voids sv
      where sv.id = v_void_id and sv.sale_id = v_sale_id and sv.metadata ->> 'saleLineId' = v_line_id::text
    ) then
      return jsonb_build_object ('ok', false, 'error', 'void_record_conflict');
    end if;
    -- replay: already recorded and applied
    select coalesce (jsonb_agg (jsonb_build_object ('product_id', p.id, 'stock_on_hand', p.stock_on_hand, 'updated_at', p.updated_at)), '[]'::jsonb)
    into v_stocks
    from public.products p
    where p.shop_id = v_sale_shop and p.id in (select (x ->> 'productId')::uuid from jsonb_array_elements (v_prov) x);
    return jsonb_build_object ('ok', true, 'idempotent', true, 'stocks', v_stocks);
  end if;

  v_reversed := public._wk_recipe_line_reversed_qty (v_sale_id, v_line_id);
  if v_reversed + v_qty > v_line.quantity + 0.0001 then
    return jsonb_build_object ('ok', false, 'error', 'void_exceeds_line');
  end if;

  if v_amount > 0 then
    if to_regprocedure ('public.assert_shop_business_date_open(uuid, text)') is not null
       and to_regprocedure ('public._sale_kampala_day(timestamptz)') is not null then
      v_date_key := to_char (public._sale_kampala_day (v_sale_created), 'YYYY-MM-DD');
      v_guard := public.assert_shop_business_date_open (v_sale_shop, v_date_key);
      if coalesce ((v_guard ->> 'ok')::boolean, false) is not true then
        return jsonb_build_object ('ok', false, 'error', 'closed_business_date');
      end if;
    end if;

    insert into public.sale_voids (
      id, shop_id, sale_id, product_id, quantity, amount_ugx, line_index, note, sale_voided_at,
      created_by, created_at, metadata
    )
    values (
      v_void_id, v_sale_shop, v_sale_id, v_line.product_id, v_qty, v_amount, greatest (v_line_index, 0), v_note,
      nullif (p_payload ->> 'sale_voided_at', '')::timestamptz, v_uid,
      coalesce ((p_payload ->> 'created_at')::timestamptz, now ()),
      jsonb_build_object (
        'productName', coalesce (p_payload ->> 'product_name', ''),
        'lineIndex', greatest (v_line_index, 0),
        'saleLineId', v_line_id,
        'recipe', true
      )
    )
    on conflict (id) do nothing;
  end if;

  -- ingredients back on the shelf: derived HERE from the recorded provenance, cumulative and capped
  for e in
    select (x ->> 'productId')::uuid as pid, (x ->> 'quantity')::numeric as consumed
    from jsonb_array_elements (v_prov) x
  loop
    v_credit := public._wk_recipe_credit (e.consumed, v_line.quantity, v_reversed, v_qty);
    if v_credit <= 0 then
      continue;
    end if;
    v_res := public._apply_durable_stock_delta (
      v_sale_shop, e.pid, 'sale_void', v_void_id, v_credit, 'void', coalesce (v_note, 'sale_void_recipe')
    );
    if coalesce ((v_res ->> 'ok')::boolean, false) is not true then
      if v_res ->> 'error' = 'product_not_found' then
        continue; -- a deleted ingredient cannot be restocked; it must not block the void
      end if;
      raise exception 'recipe void credit failed: %', v_res ->> 'error';
    end if;
    v_stocks := v_stocks || jsonb_build_array (
      jsonb_build_object ('product_id', e.pid, 'stock_on_hand', v_res -> 'stock_on_hand', 'updated_at', v_res -> 'updated_at')
    );
  end loop;

  return jsonb_build_object ('ok', true, 'idempotent', false, 'stocks', v_stocks);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_apply_sale_void_line_stock (uuid, jsonb) from public, anon;
grant execute on function public.shop_apply_sale_void_line_stock (uuid, jsonb) to authenticated;

-- ── 3. return application ───────────────────────────────────────────────────

create or replace function public.apply_sale_return_stock (p_return_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.sale_returns%rowtype;
  v_new numeric;
  v_reason text;
  v_line_id uuid;
  v_line record;
  v_cnt int;
  v_prov jsonb;
  v_reversed numeric;
  v_credit numeric;
  e record;
begin
  select * into strict r from public.sale_returns where id = p_return_id for update;

  if r.stock_applied_at is not null then
    return;
  end if;

  if exists (
    select 1 from public.inventory_movements im
    where im.reference_type = 'sale_return'
      and im.reference_id = p_return_id
  ) then
    update public.sale_returns
    set stock_applied_at = coalesce (stock_applied_at, now ())
    where id = p_return_id;
    return;
  end if;

  v_reason := coalesce (r.reason, 'other');

  -- Unsellable: mark applied without changing stock (matches local POS).
  if v_reason in ('damaged', 'broken', 'warm_bad') then
    update public.sale_returns
    set stock_applied_at = now (),
        updated_at = now ()
    where id = p_return_id;
    return;
  end if;

  -- Recipe line: give back the ingredients the line consumed (server-derived), not the dish.
  if r.sale_id is not null then
    v_line_id := public._wk_try_uuid (r.metadata ->> 'saleLineId');
    if v_line_id is null then
      select count (*), (array_agg (sli.id))[1]
      into v_cnt, v_line_id
      from public.sale_line_items sli
      where sli.sale_id = r.sale_id and sli.product_id = r.product_id;
      if v_cnt <> 1 then
        v_line_id := null;
        if exists (
          select 1 from public.sale_line_items sli
          where sli.sale_id = r.sale_id
            and sli.product_id = r.product_id
            and coalesce (sli.metadata ->> 'serverRecipeStockApplied', '') = 'true'
        ) then
          raise exception 'return_line_required';
        end if;
      end if;
    end if;

    if v_line_id is not null then
      select sli.id, sli.product_id, sli.quantity, sli.metadata
      into v_line
      from public.sale_line_items sli
      where sli.id = v_line_id and sli.sale_id = r.sale_id;

      if found and coalesce (v_line.metadata ->> 'serverRecipeStockApplied', '') = 'true' then
        if v_line.product_id is distinct from r.product_id then
          raise exception 'return_line_product_mismatch';
        end if;
        perform pg_advisory_xact_lock (hashtextextended ('recipe-line:' || v_line_id::text, 0));
        v_prov := public._wk_recipe_provenance_struct (v_line.metadata);
        if v_prov is null then
          raise exception 'recipe_provenance_invalid';
        end if;
        v_reversed := public._wk_recipe_line_reversed_qty (r.sale_id, v_line_id, p_return_id);
        if v_reversed + r.quantity > v_line.quantity + 0.0001 then
          raise exception 'return_exceeds_line';
        end if;

        for e in
          select (x ->> 'productId')::uuid as pid, (x ->> 'quantity')::numeric as consumed
          from jsonb_array_elements (v_prov) x
        loop
          v_credit := public._wk_recipe_credit (e.consumed, v_line.quantity, v_reversed, r.quantity);
          if v_credit <= 0 then
            continue;
          end if;
          update public.products p
          set stock_on_hand = p.stock_on_hand + v_credit,
              updated_at = now ()
          where p.id = e.pid and p.shop_id = r.shop_id;
          if not found then
            continue;
          end if;
          insert into public.inventory_movements (
            id, shop_id, product_id, quantity_delta, reason, reference_type, reference_id, note, created_by
          )
          values (
            public.inventory_movement_uuid (r.shop_id, 'sale_return', p_return_id, e.pid),
            r.shop_id, e.pid, v_credit, 'return', 'sale_return', p_return_id, 'made_to_order_ingredients', auth.uid ()
          )
          on conflict (id) do nothing;
        end loop;

        update public.sale_returns
        set stock_applied_at = now (),
            updated_at = now ()
        where id = p_return_id;
        return;
      end if;
    end if;
  end if;

  update public.products p
  set stock_on_hand = p.stock_on_hand + r.quantity,
      updated_at = now ()
  where p.id = r.product_id
    and p.shop_id = r.shop_id
  returning p.stock_on_hand into v_new;

  if not found then
    raise exception 'Product % not in shop', r.product_id;
  end if;

  insert into public.inventory_movements (
    shop_id, product_id, quantity_delta, reason, reference_type, reference_id, created_by
  )
  values (
    r.shop_id,
    r.product_id,
    r.quantity,
    'return',
    'sale_return',
    p_return_id,
    auth.uid ()
  );

  update public.sale_returns
  set stock_applied_at = now (),
      updated_at = now ()
  where id = p_return_id;
end;
$$;

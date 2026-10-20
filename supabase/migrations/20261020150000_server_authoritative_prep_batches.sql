-- Server-authoritative prep batches.
--
-- WHY
--   Prep batch state previously lived only in products.metadata.menu.prepBatches. Two devices
--   could consume/waste the same batch concurrently, both write version+1, and the client merge
--   kept the local copy on a tie. Product catalog upserts are last-write-wins, so a stale device
--   could also overwrite newer batch JSON in the cloud. The result could over-sell prepared
--   portions or restore portions that were already sold/wasted.
--
-- THIS MIGRATION
--   1. Adds public.prep_batches (authoritative identity/current portion state/cost/provenance)
--      and public.prep_batch_events (append-only, idempotent portion events). Neither table is a
--      stock ledger: dish/ingredient stock stays in products.stock_on_hand + inventory_movements.
--   2. Adds shop_apply_prep_batch_event(...), a row-locked, stable-event-id RPC for create, waste,
--      cancel, sale consumption, sale void and sale return. It never guesses: missing/insufficient
--      batch quantities become applied/shortfall/unreconciled events, never negative counters or
--      invented batches.
--   3. Keeps products.metadata.menu.prepBatches as a READ MODEL. A BEFORE INSERT/UPDATE trigger
--      replaces the incoming prepBatches array with the authoritative projection, so generic
--      product catalog upserts cannot overwrite batch state with stale JSON.
--   4. Backfills existing JSON batches idempotently (rerunnable).
--
-- STOCK BOUNDARY
--   - create: stock remains on the existing pending_stock_updates path (recipe ingredient
--     deductions + prepared stock increase); this RPC stores batch state only.
--   - waste/cancel: the RPC applies the portion-dependent dish/ingredient deltas through
--     _apply_durable_stock_delta (the same inventory_movements ledger) using the client's durable
--     adjustment ids. The new client stops queueing those stock ops, so each movement is applied
--     exactly once; old queued ops with the same adjustment id are idempotent no-ops.
--   - sale consume/void/return: this RPC changes batch portions only. The existing sale/void/return
--     stock application remains the ONLY dish/ingredient stock path for those flows.
--
-- OFFLINE
--   Clients enqueue one durable event per operation in the existing sync queue. Retries are
--   idempotent by (shop_id, event_key). A sale/void/return event waits until the corresponding
--   server sale/ledger row exists; it is retried, never guessed.
--
-- NOT APPLIED BY THIS REPOSITORY. Apply manually in the test environment.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tables
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.prep_batches (
  shop_id uuid not null,
  id uuid not null,
  menu_product_id uuid not null,
  prepared_at timestamptz not null,
  portions_prepared numeric(18, 4) not null default 0 check (portions_prepared >= 0),
  remaining_portions numeric(18, 4) not null default 0 check (remaining_portions >= 0),
  wasted_portions numeric(18, 4) not null default 0 check (wasted_portions >= 0),
  waste_cost_ugx bigint not null default 0 check (waste_cost_ugx >= 0),
  status text not null default 'active'
    check (status in ('active', 'depleted', 'wasted', 'cancelled')),
  version bigint not null default 1 check (version >= 1),
  cost_per_plate_ugx bigint not null default 0 check (cost_per_plate_ugx >= 0),
  -- Frozen full-batch ingredient quantities (array of {productId, quantityBase}) used by cancel.
  ingredient_requirements jsonb,
  -- Scaling denominator used by the client cancel logic: remaining / portions_prepared.
  ingredient_basis_portions numeric(18, 4),
  -- The client PrepBatch JSON (read-model fields; counters/status/version are overridden below).
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (shop_id, id)
);

create index if not exists prep_batches_shop_product_idx
  on public.prep_batches (shop_id, menu_product_id, prepared_at);
create index if not exists prep_batches_shop_status_idx
  on public.prep_batches (shop_id, status);

create table if not exists public.prep_batch_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  -- Deterministic idempotency key, e.g. create:<batch>, sale:<line>:<batch>,
  -- waste:<event uuid>, cancel:<batch>, void:<void>:<batch>, return:<return>:<batch>.
  event_key text not null,
  batch_id uuid,
  menu_product_id uuid,
  kind text not null check (kind in (
    'create', 'sale_consume', 'sale_void', 'sale_return', 'waste', 'cancel'
  )),
  portions numeric(18, 4) not null default 0 check (portions >= 0),
  applied_portions numeric(18, 4) not null default 0 check (applied_portions >= 0),
  shortfall_portions numeric(18, 4) not null default 0 check (shortfall_portions >= 0),
  status text not null default 'applied'
    check (status in ('applied', 'insufficient', 'unreconciled', 'skipped')),
  sale_id uuid,
  sale_line_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (shop_id, event_key),
  check (applied_portions + shortfall_portions <= portions + 0.0001)
);

create index if not exists prep_batch_events_shop_batch_idx
  on public.prep_batch_events (shop_id, batch_id, created_at);
create index if not exists prep_batch_events_shop_line_idx
  on public.prep_batch_events (shop_id, sale_line_id, created_at);
create index if not exists prep_batch_events_shop_status_idx
  on public.prep_batch_events (shop_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS + privileges (all writes go through the security-definer RPC)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.prep_batches enable row level security;
alter table public.prep_batch_events enable row level security;

drop policy if exists prep_batches_select on public.prep_batches;
create policy prep_batches_select
  on public.prep_batches for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists prep_batch_events_select on public.prep_batch_events;
create policy prep_batch_events_select
  on public.prep_batch_events for select
  using (public.user_can_access_shop (shop_id));

revoke all on public.prep_batches from public;
revoke all on public.prep_batches from anon;
revoke all on public.prep_batches from authenticated;
grant select on public.prep_batches to authenticated;

revoke all on public.prep_batch_events from public;
revoke all on public.prep_batch_events from anon;
revoke all on public.prep_batch_events from authenticated;
grant select on public.prep_batch_events to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. JSON projection + product read-model trigger
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public._wk_try_timestamptz (p text)
returns timestamptz
language plpgsql
immutable
set search_path = public
as $$
begin
  return p::timestamptz;
exception
  when others then
    return null;
end;
$$;

create or replace function public._wk_prep_batch_json (p_batch public.prep_batches)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_batch.data, '{}'::jsonb) || jsonb_build_object (
    'id', p_batch.id,
    'menuProductId', p_batch.menu_product_id,
    'preparedAt', p_batch.prepared_at,
    'portionsPrepared', p_batch.portions_prepared,
    'remainingPortions', p_batch.remaining_portions,
    'wastedPortions', p_batch.wasted_portions,
    'wasteCostUgx', p_batch.waste_cost_ugx,
    'status', p_batch.status,
    'version', p_batch.version,
    'updatedAt', p_batch.updated_at,
    'createdAt', coalesce (public._wk_try_timestamptz (p_batch.data ->> 'createdAt'), p_batch.created_at),
    'batchCostPerPlateUgx', p_batch.cost_per_plate_ugx,
    'unitCostUgx', coalesce (nullif (p_batch.data ->> 'unitCostUgx', '')::bigint, 0)
  );
$$;

create or replace function public._wk_refresh_prep_batch_projection (p_shop uuid, p_product uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The BEFORE trigger rebuilds metadata.menu.prepBatches from prep_batches.
  update public.products
  set metadata = coalesce (metadata, '{}'::jsonb)
  where shop_id = p_shop and id = p_product;
end;
$$;

create or replace function public._wk_project_prep_batches_to_product ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batches jsonb;
begin
  if new.metadata is null or jsonb_typeof (new.metadata -> 'menu') <> 'object' then
    return new;
  end if;

  select coalesce (
    jsonb_agg (public._wk_prep_batch_json (b) order by b.prepared_at, b.id),
    '[]'::jsonb
  )
  into v_batches
  from public.prep_batches b
  where b.shop_id = new.shop_id and b.menu_product_id = new.id;

  -- Do not add an empty prepBatches array to unrelated retail products.
  if jsonb_array_length (v_batches) > 0 or (new.metadata -> 'menu') ? 'prepBatches' then
    new.metadata := jsonb_set (new.metadata, '{menu,prepBatches}', v_batches, true);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_products_prep_batches_projection on public.products;
create trigger trg_products_prep_batches_projection
before insert or update on public.products
for each row execute function public._wk_project_prep_batches_to_product ();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Stock helper for the RPC (same ledger, deterministic movement ids)
-- ─────────────────────────────────────────────────────────────────────────────

-- Returns the applied delta result and appends a server stock row when available.
create or replace function public._wk_prep_batch_stock (
  p_shop uuid,
  p_product uuid,
  p_adjustment_id uuid,
  p_delta numeric,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res jsonb;
begin
  if p_product is null or p_adjustment_id is null or p_delta is null or p_delta = 0 then
    return jsonb_build_object ('ok', true, 'skipped', true);
  end if;
  v_res := public._apply_durable_stock_delta (
    p_shop, p_product, 'adjustment', p_adjustment_id, p_delta, 'adjustment', p_note
  );
  return v_res;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Reconcile events recorded while the batch was missing
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public._wk_reconcile_prep_batch_events (p_shop uuid, p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.prep_batches%rowtype;
  e record;
  v_applied numeric;
  v_shortfall numeric;
  v_status text;
  v_capacity numeric;
begin
  select * into v_batch
  from public.prep_batches
  where shop_id = p_shop and id = p_batch_id
  for update;
  if not found then
    return;
  end if;

  for e in
    select *
    from public.prep_batch_events
    where shop_id = p_shop and batch_id = p_batch_id and status = 'unreconciled'
    order by created_at, id
  loop
    if v_batch.status in ('cancelled', 'wasted') and e.kind <> 'sale_return' and e.kind <> 'sale_void' then
      update public.prep_batch_events
      set applied_portions = 0,
          shortfall_portions = e.portions,
          status = 'unreconciled',
          metadata = metadata || jsonb_build_object ('reconcile', 'batch_not_active')
      where id = e.id;
      continue;
    end if;

    if e.kind in ('sale_consume', 'waste') then
      v_applied := least (e.portions, v_batch.remaining_portions);
      v_shortfall := round (e.portions - v_applied, 4);
      v_status := case when v_shortfall <= 0.0001 then 'applied' else 'insufficient' end;
      v_batch.remaining_portions := round (v_batch.remaining_portions - v_applied, 4);
      if e.kind = 'waste' then
        v_batch.wasted_portions := round (v_batch.wasted_portions + v_applied, 4);
        v_batch.waste_cost_ugx := v_batch.waste_cost_ugx + round (v_applied * v_batch.cost_per_plate_ugx);
        if v_batch.remaining_portions <= 0.0001 then
          v_batch.status := 'wasted';
        else
          v_batch.status := 'active';
        end if;
      elsif v_batch.remaining_portions <= 0.0001 then
        v_batch.status := 'depleted';
      end if;
      v_batch.version := v_batch.version + 1;
      v_batch.updated_at := now ();
    elsif e.kind in ('sale_void', 'sale_return') then
      if v_batch.status in ('cancelled', 'wasted') then
        update public.prep_batch_events
        set applied_portions = 0,
            shortfall_portions = e.portions,
            status = 'unreconciled',
            metadata = metadata || jsonb_build_object ('reconcile', 'batch_not_active')
        where id = e.id;
        continue;
      end if;
      v_capacity := greatest (v_batch.portions_prepared, v_batch.remaining_portions);
      v_applied := least (e.portions, greatest (0, v_capacity - v_batch.remaining_portions));
      v_shortfall := round (e.portions - v_applied, 4);
      v_status := case when v_shortfall <= 0.0001 then 'applied' else 'insufficient' end;
      v_batch.remaining_portions := round (v_batch.remaining_portions + v_applied, 4);
      v_batch.status := case when v_batch.remaining_portions > 0.0001 then 'active' else v_batch.status end;
      v_batch.version := v_batch.version + 1;
      v_batch.updated_at := now ();
    elsif e.kind = 'cancel' then
      v_batch.remaining_portions := 0;
      v_batch.status := 'cancelled';
      v_batch.version := v_batch.version + 1;
      v_batch.updated_at := now ();
      v_status := 'applied';
      v_shortfall := 0;
    else
      continue;
    end if;

    update public.prep_batch_events
    set applied_portions = v_applied,
        shortfall_portions = v_shortfall,
        status = v_status,
        metadata = metadata || jsonb_build_object ('reconciledAt', now ())
    where id = e.id;
  end loop;

  update public.prep_batches b
  set remaining_portions = v_batch.remaining_portions,
      wasted_portions = v_batch.wasted_portions,
      waste_cost_ugx = v_batch.waste_cost_ugx,
      status = v_batch.status,
      version = v_batch.version,
      updated_at = v_batch.updated_at
  where b.shop_id = p_shop and b.id = p_batch_id;

  perform public._wk_refresh_prep_batch_projection (p_shop, v_batch.menu_product_id);
end;
$$;

-- Apply (once) the missing sale consumption events for one sale line. Called by the
-- sale_consume event and by void/return before crediting, so a reversal can never be
-- credited before the consumption it reverses, regardless of queue arrival order.
create or replace function public._wk_apply_sale_line_consumption (
  p_shop uuid,
  p_sale_id uuid,
  p_line_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_alloc jsonb;
  v_alloc_item jsonb;
  v_batch public.prep_batches%rowtype;
  v_event_key text;
  v_batch_id uuid;
  v_portions numeric;
  v_left numeric;
  v_applied numeric;
  v_shortfall numeric;
  v_status text;
begin
  select sli.id, sli.product_id, sli.quantity, sli.metadata
  into v_line
  from public.sale_line_items sli
  join public.sales s on s.id = sli.sale_id
  where sli.id = p_line_id
    and sli.sale_id = p_sale_id
    and s.shop_id = p_shop
    and s.status = 'completed';
  if not found then
    return;
  end if;

  v_alloc := v_line.metadata -> 'prepAllocation';
  if jsonb_typeof (v_alloc) <> 'array' then
    return;
  end if;

  perform pg_advisory_xact_lock (hashtextextended ('prep-sale:' || p_sale_id::text, 0));
  v_left := greatest (0, v_line.quantity);

  for v_alloc_item in select * from jsonb_array_elements (v_alloc) loop
    v_batch_id := public._wk_try_uuid (v_alloc_item ->> 'batchId');
    v_portions := greatest (0, coalesce ((v_alloc_item ->> 'portions')::numeric, 0));
    if v_batch_id is null or v_portions <= 0 then
      continue;
    end if;
    v_portions := least (v_portions, v_left);
    v_left := round (v_left - v_portions, 4);
    if v_portions <= 0 then
      continue;
    end if;

    -- Same per-batch lock as create/waste/cancel: a sale cannot pass a concurrent
    -- create and must see the committed batch before recording consumption.
    perform pg_advisory_xact_lock (hashtextextended ('prep-batch:' || p_shop::text || ':' || v_batch_id::text, 0));
    v_event_key := 'sale:' || p_line_id::text || ':' || v_batch_id::text;
    insert into public.prep_batch_events (
      shop_id, event_key, batch_id, menu_product_id, kind, portions,
      applied_portions, shortfall_portions, status, sale_id, sale_line_id, metadata, created_by
    )
    values (
      p_shop, v_event_key, v_batch_id, v_line.product_id, 'sale_consume',
      v_portions, 0, v_portions, 'unreconciled', p_sale_id, p_line_id,
      jsonb_build_object ('source', 'sale'), auth.uid ()
    )
    on conflict (shop_id, event_key) do nothing;
    if not found then
      continue;
    end if;

    select * into v_batch
    from public.prep_batches
    where shop_id = p_shop and id = v_batch_id
    for update;
    if not found then
      continue; -- stays unreconciled until the batch is created/backfilled
    end if;
    if v_batch.status in ('cancelled', 'wasted') then
      update public.prep_batch_events
      set metadata = metadata || jsonb_build_object ('reasonCode', 'batch_not_active')
      where shop_id = p_shop and event_key = v_event_key;
      continue;
    end if;

    v_applied := least (v_portions, v_batch.remaining_portions);
    v_shortfall := round (v_portions - v_applied, 4);
    v_status := case when v_shortfall <= 0.0001 then 'applied' else 'insufficient' end;

    update public.prep_batches b
    set remaining_portions = round (b.remaining_portions - v_applied, 4),
        status = case when round (b.remaining_portions - v_applied, 4) <= 0.0001 then 'depleted' else b.status end,
        version = b.version + 1,
        updated_at = now ()
    where b.shop_id = p_shop and b.id = v_batch_id
    returning * into v_batch;

    update public.prep_batch_events
    set applied_portions = v_applied,
        shortfall_portions = v_shortfall,
        status = v_status,
        metadata = metadata || jsonb_build_object ('batchVersion', v_batch.version)
    where shop_id = p_shop and event_key = v_event_key;

    perform public._wk_refresh_prep_batch_projection (p_shop, v_batch.menu_product_id);
  end loop;

  if v_left > 0.0001 then
    insert into public.prep_batch_events (
      shop_id, event_key, batch_id, menu_product_id, kind, portions,
      applied_portions, shortfall_portions, status, sale_id, sale_line_id, metadata, created_by
    )
    values (
      p_shop, 'sale:' || p_line_id::text || ':unallocated', null, v_line.product_id,
      'sale_consume', v_left, 0, v_left, 'unreconciled', p_sale_id, p_line_id,
      jsonb_build_object ('source', 'sale', 'reasonCode', 'allocation_short'), auth.uid ()
    )
    on conflict (shop_id, event_key) do nothing;
  end if;
end;
$$;

-- Sale lifecycle integration: whenever a sale becomes completed, consume every
-- line's prepAllocation against the authoritative batch table. This is idempotent
-- with the client's sale_consume event and never touches dish/ingredient stock —
-- the existing sale stock application remains the only stock path.
create or replace function public._wk_trg_sales_prep_batch_consumption ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    for r in
      select id from public.sale_line_items where sale_id = new.id
    loop
      perform public._wk_apply_sale_line_consumption (new.shop_id, new.id, r.id);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sales_prep_batch_consumption on public.sales;
create trigger trg_sales_prep_batch_consumption
after insert or update of status on public.sales
for each row execute function public._wk_trg_sales_prep_batch_consumption ();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. The single batch-event RPC
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.shop_apply_prep_batch_event (p_shop_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_kind text := lower (coalesce (p_payload ->> 'kind', ''));
  v_event_id uuid := public._wk_try_uuid (p_payload ->> 'eventId');
  v_batch_id uuid := public._wk_try_uuid (p_payload ->> 'batchId');
  v_product_id uuid := public._wk_try_uuid (p_payload ->> 'productId');
  v_sale_id uuid := public._wk_try_uuid (p_payload ->> 'saleId');
  v_line_id uuid := public._wk_try_uuid (p_payload ->> 'saleLineId');
  v_portions numeric := greatest (0, coalesce ((p_payload ->> 'portions')::numeric, 0));
  v_quantity numeric := greatest (0, coalesce ((p_payload ->> 'quantity')::numeric, 0));
  v_reason text := nullif (p_payload ->> 'reason', '');
  v_event_key text;
  v_batch public.prep_batches%rowtype;
  v_line record;
  v_alloc jsonb;
  v_alloc_item jsonb;
  v_batches jsonb := '[]'::jsonb;
  v_stocks jsonb := '[]'::jsonb;
  v_stock_deltas jsonb := '[]'::jsonb;
  v_res jsonb;
  v_applied numeric;
  v_credit numeric;
  v_shortfall numeric;
  v_status text;
  v_capacity numeric;
  v_stock numeric;
  v_stock_applied numeric;
  v_restore_portions numeric;
  v_line_left numeric;
  v_meta jsonb := '{}'::jsonb;
  v_batch_json jsonb;
  v_prepared_at timestamptz;
  v_alloc_batch uuid;
  v_alloc_portions numeric;
  v_take numeric;
  v_skip numeric;
  v_i int;
  v_count int;
  v_prefix text;
  v_already boolean;
  v_already_reversed numeric;
  v_req jsonb;
  v_req_item jsonb;
  v_req_pid uuid;
  v_req_qty numeric;
  v_scale numeric;
  v_adj uuid;
  e record;
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
  if v_kind not in ('create', 'waste', 'cancel', 'sale_consume', 'sale_void', 'sale_return') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_kind');
  end if;

  -- ── CREATE (batch state only; existing stock outbox remains the stock path) ──
  if v_kind = 'create' then
    if v_batch_id is null or v_product_id is null then
      return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
    end if;
    v_event_key := 'create:' || v_batch_id::text;
    perform pg_advisory_xact_lock (hashtextextended ('prep-batch:' || p_shop_id::text || ':' || v_batch_id::text, 0));

    if exists (select 1 from public.prep_batch_events where shop_id = p_shop_id and event_key = v_event_key) then
      select * into v_batch from public.prep_batches where shop_id = p_shop_id and id = v_batch_id;
      return jsonb_build_object (
        'ok', true, 'idempotent', true,
        'batch', case when found then public._wk_prep_batch_json (v_batch) else null end,
        'stocks', '[]'::jsonb
      );
    end if;

    select * into v_batch from public.prep_batches where shop_id = p_shop_id and id = v_batch_id;
    if found then
      insert into public.prep_batch_events (
        shop_id, event_key, batch_id, menu_product_id, kind, portions,
        applied_portions, shortfall_portions, status, metadata, created_by
      )
      values (
        p_shop_id, v_event_key, v_batch_id, v_batch.menu_product_id, 'create',
        v_batch.portions_prepared, v_batch.portions_prepared, 0, 'applied',
        jsonb_build_object ('idempotent', true), v_uid
      )
      on conflict (shop_id, event_key) do nothing;
      return jsonb_build_object ('ok', true, 'idempotent', true, 'batch', public._wk_prep_batch_json (v_batch), 'stocks', '[]'::jsonb);
    end if;

    if not exists (
      select 1 from public.products p
      where p.id = v_product_id and p.shop_id = p_shop_id and p.is_active = true
    ) then
      return jsonb_build_object ('ok', false, 'error', 'product_not_found');
    end if;
    if jsonb_typeof (p_payload -> 'batch') <> 'object' then
      return jsonb_build_object ('ok', false, 'error', 'invalid_batch');
    end if;
    v_batch_json := p_payload -> 'batch';
    if greatest (0, coalesce ((v_batch_json ->> 'portionsPrepared')::numeric, 0)) <= 0 then
      return jsonb_build_object ('ok', false, 'error', 'invalid_portions');
    end if;
    if public._wk_try_uuid (v_batch_json ->> 'id') is distinct from v_batch_id then
      return jsonb_build_object ('ok', false, 'error', 'batch_id_mismatch');
    end if;
    v_prepared_at := public._wk_try_timestamptz (v_batch_json ->> 'preparedAt');
    if v_prepared_at is null then
      return jsonb_build_object ('ok', false, 'error', 'invalid_batch');
    end if;

    insert into public.prep_batches (
      shop_id, id, menu_product_id, prepared_at, portions_prepared, remaining_portions,
      wasted_portions, waste_cost_ugx, status, version, cost_per_plate_ugx,
      ingredient_requirements, ingredient_basis_portions, data, created_at, updated_at
    )
    values (
      p_shop_id,
      v_batch_id,
      v_product_id,
      v_prepared_at,
      (v_batch_json ->> 'portionsPrepared')::numeric,
      (v_batch_json ->> 'portionsPrepared')::numeric,
      greatest (0, coalesce ((v_batch_json ->> 'wastedPortions')::numeric, 0)),
      greatest (0, coalesce ((v_batch_json ->> 'wasteCostUgx')::bigint, 0)),
      'active',
      1,
      greatest (0, coalesce ((v_batch_json ->> 'batchCostPerPlateUgx')::bigint, (v_batch_json ->> 'unitCostUgx')::bigint, 0)),
      p_payload -> 'ingredientRequirements',
      greatest (0, coalesce ((p_payload ->> 'ingredientBasisPortions')::numeric, (v_batch_json ->> 'portionsPrepared')::numeric)),
      v_batch_json,
      now (), now ()
    )
    on conflict (shop_id, id) do nothing;

    select * into v_batch from public.prep_batches where shop_id = p_shop_id and id = v_batch_id;

    insert into public.prep_batch_events (
      shop_id, event_key, batch_id, menu_product_id, kind, portions,
      applied_portions, shortfall_portions, status, metadata, created_by
    )
    values (
      p_shop_id, v_event_key, v_batch_id, v_product_id, 'create',
      v_batch.portions_prepared, v_batch.portions_prepared, 0, 'applied',
      jsonb_build_object ('preparedAt', v_batch.prepared_at), v_uid
    )
    on conflict (shop_id, event_key) do nothing;

    perform public._wk_reconcile_prep_batch_events (p_shop_id, v_batch_id);
    select * into v_batch from public.prep_batches where shop_id = p_shop_id and id = v_batch_id;
    perform public._wk_refresh_prep_batch_projection (p_shop_id, v_batch.menu_product_id);

    return jsonb_build_object (
      'ok', true, 'idempotent', false,
      'batch', public._wk_prep_batch_json (v_batch),
      'stocks', '[]'::jsonb
    );
  end if;

  -- ── WASTE (batch state + portion-dependent dish stock) ──
  if v_kind = 'waste' then
    if v_batch_id is null or v_event_id is null then
      return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
    end if;
    v_event_key := 'waste:' || v_event_id::text;
    perform pg_advisory_xact_lock (hashtextextended ('prep-batch:' || p_shop_id::text || ':' || v_batch_id::text, 0));

    if exists (select 1 from public.prep_batch_events where shop_id = p_shop_id and event_key = v_event_key) then
      select * into v_batch from public.prep_batches where shop_id = p_shop_id and id = v_batch_id;
      return jsonb_build_object ('ok', true, 'idempotent', true, 'batch', case when found then public._wk_prep_batch_json (v_batch) else null end, 'stocks', '[]'::jsonb);
    end if;

    if v_portions <= 0 then
      return jsonb_build_object ('ok', false, 'error', 'invalid_portions');
    end if;

    select * into v_batch from public.prep_batches where shop_id = p_shop_id and id = v_batch_id for update;
    if not found then
      insert into public.prep_batch_events (
        shop_id, event_key, batch_id, menu_product_id, kind, portions,
        applied_portions, shortfall_portions, status, metadata, created_by
      )
      values (
        p_shop_id, v_event_key, v_batch_id, v_product_id, 'waste', v_portions,
        0, v_portions, 'unreconciled',
        jsonb_build_object ('reason', coalesce (v_reason, ''), 'reasonCode', 'batch_missing'), v_uid
      )
      on conflict (shop_id, event_key) do nothing;
      return jsonb_build_object ('ok', true, 'idempotent', false, 'unreconciled', true, 'batch', null, 'stocks', '[]'::jsonb);
    end if;

    if v_batch.status in ('cancelled', 'wasted') then
      insert into public.prep_batch_events (
        shop_id, event_key, batch_id, menu_product_id, kind, portions,
        applied_portions, shortfall_portions, status, metadata, created_by
      )
      values (
        p_shop_id, v_event_key, v_batch_id, v_batch.menu_product_id, 'waste', v_portions,
        0, v_portions, 'unreconciled',
        jsonb_build_object ('reason', coalesce (v_reason, ''), 'reasonCode', 'batch_not_active'), v_uid
      )
      on conflict (shop_id, event_key) do nothing;
      return jsonb_build_object ('ok', true, 'idempotent', false, 'unreconciled', true, 'batch', public._wk_prep_batch_json (v_batch), 'stocks', '[]'::jsonb);
    end if;

    -- Cap by the authoritative dish stock as well: a concurrent sale may already have
    -- reduced it, and prepared stock must never be driven negative.
    select p.stock_on_hand into v_stock
    from public.products p
    where p.shop_id = p_shop_id and p.id = v_batch.menu_product_id
    for update;
    v_stock := greatest (0, coalesce (v_stock, 0));

    v_applied := least (v_portions, v_batch.remaining_portions, v_stock);
    v_shortfall := round (v_portions - v_applied, 4);
    v_status := case when v_shortfall <= 0.0001 then 'applied' else 'insufficient' end;

    update public.prep_batches b
    set remaining_portions = round (b.remaining_portions - v_applied, 4),
        wasted_portions = round (b.wasted_portions + v_applied, 4),
        waste_cost_ugx = b.waste_cost_ugx + round (v_applied * b.cost_per_plate_ugx),
        status = case when round (b.remaining_portions - v_applied, 4) <= 0.0001 then 'wasted' else 'active' end,
        version = b.version + 1,
        updated_at = now ()
    where b.shop_id = p_shop_id and b.id = v_batch_id
    returning * into v_batch;

    -- Portion-dependent stock: use the client's durable adjustment id when supplied so an
    -- old queued stock op with the same id and this RPC cannot both apply the movement.
    v_adj := public._wk_try_uuid (p_payload ->> 'dishStockAdjustmentId');
    if v_adj is null then
      v_adj := public.inventory_movement_uuid (p_shop_id, 'prep_batch_waste', v_event_id, v_batch.menu_product_id);
    end if;
    v_res := public._wk_prep_batch_stock (
      p_shop_id, v_batch.menu_product_id, v_adj, -v_applied, 'prep_waste'
    );
    if coalesce ((v_res ->> 'ok')::boolean, false) is true and v_res ? 'stock_on_hand' then
      v_stocks := v_stocks || jsonb_build_array (
        jsonb_build_object ('product_id', v_batch.menu_product_id, 'stock_on_hand', v_res -> 'stock_on_hand', 'updated_at', v_res -> 'updated_at')
      );
      if coalesce ((v_res ->> 'skipped')::boolean, false) is not true then
        v_stock_deltas := v_stock_deltas || jsonb_build_array (
          jsonb_build_object ('productId', v_batch.menu_product_id, 'delta', -v_applied)
        );
      end if;
    elsif coalesce ((v_res ->> 'ok')::boolean, false) is not true and v_res ->> 'error' <> 'product_not_found' then
      raise exception 'prep waste stock failed: %', v_res ->> 'error';
    end if;
    v_meta := jsonb_build_object (
      'reason', coalesce (v_reason, ''),
      'stockAdjustmentId', v_adj
    );
    if coalesce ((v_res ->> 'ok')::boolean, false)
       and coalesce ((v_res ->> 'skipped')::boolean, false) is not true then
      v_meta := v_meta || jsonb_build_object ('stockApplied', true);
    end if;

    insert into public.prep_batch_events (
      shop_id, event_key, batch_id, menu_product_id, kind, portions,
      applied_portions, shortfall_portions, status, metadata, created_by
    )
    values (
      p_shop_id, v_event_key, v_batch_id, v_batch.menu_product_id, 'waste', v_portions,
      v_applied, v_shortfall, v_status, v_meta, v_uid
    )
    on conflict (shop_id, event_key) do nothing;

    perform public._wk_refresh_prep_batch_projection (p_shop_id, v_batch.menu_product_id);

    return jsonb_build_object (
      'ok', true, 'idempotent', false,
      'batch', public._wk_prep_batch_json (v_batch),
      'appliedPortions', v_applied,
      'shortfallPortions', v_shortfall,
      'stocks', v_stocks,
      'stockDeltas', v_stock_deltas
    );
  end if;

  -- ── CANCEL (batch state + portion-dependent dish/ingredient stock) ──
  if v_kind = 'cancel' then
    if v_batch_id is null then
      return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
    end if;
    v_event_key := 'cancel:' || v_batch_id::text;
    perform pg_advisory_xact_lock (hashtextextended ('prep-batch:' || p_shop_id::text || ':' || v_batch_id::text, 0));

    if exists (select 1 from public.prep_batch_events where shop_id = p_shop_id and event_key = v_event_key) then
      select * into v_batch from public.prep_batches where shop_id = p_shop_id and id = v_batch_id;
      return jsonb_build_object ('ok', true, 'idempotent', true, 'batch', case when found then public._wk_prep_batch_json (v_batch) else null end, 'stocks', '[]'::jsonb);
    end if;

    select * into v_batch from public.prep_batches where shop_id = p_shop_id and id = v_batch_id for update;
    if not found then
      insert into public.prep_batch_events (
        shop_id, event_key, batch_id, menu_product_id, kind, portions,
        applied_portions, shortfall_portions, status, metadata, created_by
      )
      values (
        p_shop_id, v_event_key, v_batch_id, v_product_id, 'cancel', v_portions,
        0, v_portions, 'unreconciled',
        jsonb_build_object ('reasonCode', 'batch_missing'), v_uid
      )
      on conflict (shop_id, event_key) do nothing;
      return jsonb_build_object ('ok', true, 'idempotent', false, 'unreconciled', true, 'batch', null, 'stocks', '[]'::jsonb);
    end if;

    if v_batch.status in ('cancelled', 'wasted') then
      insert into public.prep_batch_events (
        shop_id, event_key, batch_id, menu_product_id, kind, portions,
        applied_portions, shortfall_portions, status, metadata, created_by
      )
      values (
        p_shop_id, v_event_key, v_batch_id, v_batch.menu_product_id, 'cancel', 0,
        0, 0, 'skipped', jsonb_build_object ('reasonCode', 'batch_not_active'), v_uid
      )
      on conflict (shop_id, event_key) do nothing;
      return jsonb_build_object ('ok', true, 'idempotent', true, 'batch', public._wk_prep_batch_json (v_batch), 'stocks', '[]'::jsonb);
    end if;

    v_portions := v_batch.remaining_portions;

    -- Only remove prepared stock that actually exists. A concurrent sale may already have
    -- consumed it; the difference is recorded, never forced negative or guessed away.
    select p.stock_on_hand into v_stock
    from public.products p
    where p.shop_id = p_shop_id and p.id = v_batch.menu_product_id
    for update;
    v_stock := greatest (0, coalesce (v_stock, 0));
    v_stock_applied := least (v_portions, v_stock);
    v_restore_portions := v_stock_applied;

    update public.prep_batches b
    set remaining_portions = 0,
        status = 'cancelled',
        version = b.version + 1,
        updated_at = now ()
    where b.shop_id = p_shop_id and b.id = v_batch_id
    returning * into v_batch;

    -- Prepared-dish stock removal.
    v_adj := public._wk_try_uuid (p_payload ->> 'dishStockAdjustmentId');
    if v_adj is null then
      v_adj := public.inventory_movement_uuid (p_shop_id, 'prep_batch_cancel_stock', v_batch_id, v_batch.menu_product_id);
    end if;
    v_res := public._wk_prep_batch_stock (
      p_shop_id, v_batch.menu_product_id, v_adj, -v_stock_applied, 'prep_cancel_stock'
    );
    if coalesce ((v_res ->> 'ok')::boolean, false) is true and v_res ? 'stock_on_hand' then
      v_stocks := v_stocks || jsonb_build_array (
        jsonb_build_object ('product_id', v_batch.menu_product_id, 'stock_on_hand', v_res -> 'stock_on_hand', 'updated_at', v_res -> 'updated_at')
      );
      if coalesce ((v_res ->> 'skipped')::boolean, false) is not true and v_stock_applied > 0 then
        v_stock_deltas := v_stock_deltas || jsonb_build_array (
          jsonb_build_object ('productId', v_batch.menu_product_id, 'delta', -v_stock_applied)
        );
      end if;
    elsif coalesce ((v_res ->> 'ok')::boolean, false) is not true and v_res ->> 'error' <> 'product_not_found' then
      raise exception 'prep cancel stock failed: %', v_res ->> 'error';
    end if;

    -- Ingredient restoration from the frozen full-batch requirements, scaled to the
    -- server's remaining portions / portions_prepared (mirrors the client cancel logic).
    v_meta := jsonb_build_object (
      'cancelledPortions', v_portions,
      'stockCancelledPortions', v_stock_applied,
      'stockShortfallPortions', round (v_portions - v_stock_applied, 4)
    );
    v_req := v_batch.ingredient_requirements;
    if jsonb_typeof (v_req) = 'array'
       and coalesce (v_batch.ingredient_basis_portions, 0) > 0
       and v_restore_portions > 0 then
      v_scale := v_restore_portions / v_batch.ingredient_basis_portions;
      for v_req_item in select * from jsonb_array_elements (v_req) loop
        v_req_pid := public._wk_try_uuid (v_req_item ->> 'productId');
        v_req_qty := round (greatest (0, coalesce ((v_req_item ->> 'quantityBase')::numeric, 0)) * v_scale, 4);
        if v_req_pid is null or v_req_qty <= 0 then
          continue;
        end if;
        -- Prefer the client's durable adjustment id for this ingredient (idempotent with an
        -- old queued stock op); otherwise derive a deterministic server id.
        v_adj := null;
        if jsonb_typeof (p_payload -> 'ingredientAdjustments') = 'array' then
          select public._wk_try_uuid (x ->> 'adjustmentId')
          into v_adj
          from jsonb_array_elements (p_payload -> 'ingredientAdjustments') x
          where public._wk_try_uuid (x ->> 'productId') = v_req_pid
          limit 1;
        end if;
        if v_adj is null then
          v_adj := public.inventory_movement_uuid (p_shop_id, 'prep_batch_cancel', v_batch_id, v_req_pid);
        end if;
        v_res := public._wk_prep_batch_stock (
          p_shop_id, v_req_pid, v_adj, v_req_qty, 'prep_cancel'
        );
        if coalesce ((v_res ->> 'ok')::boolean, false) is true and v_res ? 'stock_on_hand' then
          v_stocks := v_stocks || jsonb_build_array (
            jsonb_build_object ('product_id', v_req_pid, 'stock_on_hand', v_res -> 'stock_on_hand', 'updated_at', v_res -> 'updated_at')
          );
          if coalesce ((v_res ->> 'skipped')::boolean, false) is not true then
            v_stock_deltas := v_stock_deltas || jsonb_build_array (
              jsonb_build_object ('productId', v_req_pid, 'delta', v_req_qty)
            );
          end if;
        elsif coalesce ((v_res ->> 'ok')::boolean, false) is not true and v_res ->> 'error' <> 'product_not_found' then
          raise exception 'prep cancel ingredient stock failed: %', v_res ->> 'error';
        end if;
      end loop;
    elsif v_restore_portions > 0 then
      v_meta := v_meta || jsonb_build_object ('ingredientsUnreconciled', true);
    end if;

    insert into public.prep_batch_events (
      shop_id, event_key, batch_id, menu_product_id, kind, portions,
      applied_portions, shortfall_portions, status, metadata, created_by
    )
    values (
      p_shop_id, v_event_key, v_batch_id, v_batch.menu_product_id, 'cancel', v_portions,
      v_portions, 0, 'applied', v_meta, v_uid
    )
    on conflict (shop_id, event_key) do nothing;

    perform public._wk_refresh_prep_batch_projection (p_shop_id, v_batch.menu_product_id);

    return jsonb_build_object (
      'ok', true, 'idempotent', false,
      'batch', public._wk_prep_batch_json (v_batch),
      'cancelledPortions', v_portions,
      'stocks', v_stocks,
      'stockDeltas', v_stock_deltas
    );
  end if;

  -- ── SALE CONSUMPTION (batch portions only; sale stock is untouched) ──
  if v_kind = 'sale_consume' then
    if v_sale_id is null or v_line_id is null then
      return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
    end if;
    if not exists (
      select 1 from public.sales s
      where s.id = v_sale_id and s.shop_id = p_shop_id and s.status = 'completed'
    ) then
      return jsonb_build_object ('ok', false, 'error', 'sale_not_completed', 'retry', true);
    end if;
    if not exists (
      select 1 from public.sale_line_items sli
      where sli.id = v_line_id and sli.sale_id = v_sale_id
    ) then
      return jsonb_build_object ('ok', false, 'error', 'sale_line_not_found', 'retry', true);
    end if;

    perform public._wk_apply_sale_line_consumption (p_shop_id, v_sale_id, v_line_id);
    return jsonb_build_object ('ok', true, 'idempotent', false, 'stocks', '[]'::jsonb);
  end if;

  -- ── SALE VOID / RETURN (batch portions only; existing stock paths untouched) ──
  if v_kind in ('sale_void', 'sale_return') then
    if v_sale_id is null or v_line_id is null or v_event_id is null then
      return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
    end if;

    if v_kind = 'sale_return' then
      select sr.reason, sr.stock_applied_at, sr.quantity
      into v_line
      from public.sale_returns sr
      where sr.id = v_event_id and sr.sale_id = v_sale_id and sr.shop_id = p_shop_id;
      if not found or v_line.stock_applied_at is null then
        return jsonb_build_object ('ok', false, 'error', 'return_not_applied', 'retry', true);
      end if;
      if coalesce (v_line.reason, '') in ('damaged', 'broken', 'warm_bad') then
        insert into public.prep_batch_events (
          shop_id, event_key, batch_id, menu_product_id, kind, portions,
          applied_portions, shortfall_portions, status, sale_id, sale_line_id, metadata, created_by
        )
        values (
          p_shop_id, v_kind || ':' || v_event_id::text || ':skipped', null, null, v_kind,
          0, 0, 0, 'skipped', v_sale_id, v_line_id,
          jsonb_build_object ('reason', v_line.reason, 'reasonCode', 'unsellable_return'), v_uid
        )
        on conflict (shop_id, event_key) do nothing;
        return jsonb_build_object ('ok', true, 'idempotent', false, 'skipped', true, 'batches', '[]'::jsonb, 'stocks', '[]'::jsonb);
      end if;
      v_quantity := least (v_quantity, v_line.quantity);
    end if;
    -- A void does not require its financial row here: a stock-only void on a closed
    -- business date deliberately records no sale_voids row. The sale-completed and
    -- line checks below (plus the per-line event key) make the reversal safe.

    select sli.id, sli.product_id, sli.quantity, sli.metadata
    into v_line
    from public.sale_line_items sli
    where sli.id = v_line_id and sli.sale_id = v_sale_id;
    if not found then
      return jsonb_build_object ('ok', false, 'error', 'sale_line_not_found', 'retry', true);
    end if;
    v_alloc := v_line.metadata -> 'prepAllocation';
    if jsonb_typeof (v_alloc) <> 'array' then
      return jsonb_build_object ('ok', true, 'skipped', true, 'batches', '[]'::jsonb, 'stocks', '[]'::jsonb);
    end if;

    if not exists (
      select 1 from public.sales s
      where s.id = v_sale_id and s.shop_id = p_shop_id and s.status = 'completed'
    ) then
      return jsonb_build_object ('ok', false, 'error', 'sale_not_completed', 'retry', true);
    end if;
    -- A reversal must never be credited before the consumption it reverses, whatever
    -- order the offline queue delivers the events in.
    perform public._wk_apply_sale_line_consumption (p_shop_id, v_sale_id, v_line_id);

    if v_quantity <= 0 then
      v_quantity := v_line.quantity;
    end if;
    v_quantity := least (v_quantity, v_line.quantity);

    v_prefix := v_kind || ':' || v_event_id::text || ':';
    select exists (
      select 1 from public.prep_batch_events
      where shop_id = p_shop_id and event_key like v_prefix || '%'
    ) into v_already;
    if v_already then
      return jsonb_build_object ('ok', true, 'idempotent', true, 'batches', '[]'::jsonb, 'stocks', '[]'::jsonb);
    end if;

    perform pg_advisory_xact_lock (hashtextextended ('prep-line:' || v_line_id::text, 0));

    select coalesce (sum (portions), 0)
    into v_already_reversed
    from public.prep_batch_events
    where shop_id = p_shop_id
      and sale_line_id = v_line_id
      and kind in ('sale_void', 'sale_return');

    v_take := v_quantity;
    v_skip := v_already_reversed;
    v_count := jsonb_array_length (v_alloc);

    -- Consume the allocation from the END (last consumed, first returned), mirroring
    -- the client's prepAllocationWindow.
    for v_i in 0 .. v_count - 1 loop
      if v_take <= 0.0001 then
        exit;
      end if;
      v_alloc_item := v_alloc -> (v_count - 1 - v_i);
      v_alloc_batch := public._wk_try_uuid (v_alloc_item ->> 'batchId');
      v_alloc_portions := greatest (0, coalesce ((v_alloc_item ->> 'portions')::numeric, 0));
      if v_alloc_batch is null or v_alloc_portions <= 0 then
        continue;
      end if;

      if v_skip > 0.0001 then
        if v_skip >= v_alloc_portions then
          v_skip := v_skip - v_alloc_portions;
          continue;
        end if;
        v_alloc_portions := v_alloc_portions - v_skip;
        v_skip := 0;
      end if;

      -- Same per-batch lock as create/waste/cancel/consume.
      perform pg_advisory_xact_lock (hashtextextended ('prep-batch:' || p_shop_id::text || ':' || v_alloc_batch::text, 0));
      v_applied := least (v_alloc_portions, v_take);
      v_take := round (v_take - v_applied, 4);
      v_event_key := v_prefix || v_alloc_batch::text;

      insert into public.prep_batch_events (
        shop_id, event_key, batch_id, menu_product_id, kind, portions,
        applied_portions, shortfall_portions, status, sale_id, sale_line_id, metadata, created_by
      )
      values (
        p_shop_id, v_event_key, v_alloc_batch, v_line.product_id, v_kind,
        v_applied, 0, v_applied, 'unreconciled', v_sale_id, v_line_id,
        jsonb_build_object ('source', v_kind), v_uid
      )
      on conflict (shop_id, event_key) do nothing;
      if not found then
        continue;
      end if;

      select * into v_batch
      from public.prep_batches
      where shop_id = p_shop_id and id = v_alloc_batch
      for update;
      if not found then
        update public.prep_batch_events
        set metadata = metadata || jsonb_build_object ('reasonCode', 'batch_missing')
        where shop_id = p_shop_id and event_key = v_event_key;
        continue;
      end if;
      if v_batch.status in ('cancelled', 'wasted') then
        update public.prep_batch_events
        set metadata = metadata || jsonb_build_object ('reasonCode', 'batch_not_active')
        where shop_id = p_shop_id and event_key = v_event_key;
        continue;
      end if;

      v_capacity := greatest (v_batch.portions_prepared, v_batch.remaining_portions);
      v_credit := least (v_applied, greatest (0, v_capacity - v_batch.remaining_portions));
      v_shortfall := round (v_applied - v_credit, 4);
      v_applied := round (v_credit, 4);
      v_status := case when v_shortfall <= 0.0001 then 'applied' else 'insufficient' end;

      update public.prep_batches b
      set remaining_portions = round (b.remaining_portions + v_applied, 4),
          status = case when round (b.remaining_portions + v_applied, 4) > 0.0001 then 'active' else b.status end,
          version = b.version + 1,
          updated_at = now ()
      where b.shop_id = p_shop_id and b.id = v_alloc_batch
      returning * into v_batch;

      update public.prep_batch_events
      set applied_portions = v_applied,
          shortfall_portions = v_shortfall,
          status = v_status,
          metadata = metadata || jsonb_build_object ('batchVersion', v_batch.version)
      where shop_id = p_shop_id and event_key = v_event_key;

      v_batches := v_batches || jsonb_build_array (public._wk_prep_batch_json (v_batch));
      perform public._wk_refresh_prep_batch_projection (p_shop_id, v_batch.menu_product_id);
    end loop;

    if v_take > 0.0001 then
      insert into public.prep_batch_events (
        shop_id, event_key, batch_id, menu_product_id, kind, portions,
        applied_portions, shortfall_portions, status, sale_id, sale_line_id, metadata, created_by
      )
      values (
        p_shop_id, v_prefix || 'unallocated', null, v_line.product_id, v_kind,
        v_take, 0, v_take, 'unreconciled', v_sale_id, v_line_id,
        jsonb_build_object ('source', v_kind, 'reasonCode', 'allocation_exhausted'), v_uid
      )
      on conflict (shop_id, event_key) do nothing;
    end if;

    return jsonb_build_object ('ok', true, 'idempotent', false, 'batches', v_batches, 'stocks', '[]'::jsonb);
  end if;

  return jsonb_build_object ('ok', false, 'error', 'unsupported_kind');
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_apply_prep_batch_event (uuid, jsonb) from public;
revoke all on function public.shop_apply_prep_batch_event (uuid, jsonb) from anon;
grant execute on function public.shop_apply_prep_batch_event (uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Backfill existing JSON batches (idempotent; safe to re-run)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public._wk_backfill_prep_batches ()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product record;
  b jsonb;
  v_req jsonb;
  v_snapshot jsonb;
  v_prepared numeric;
  v_expected numeric;
  v_basis numeric;
  v_batch_id uuid;
  v_prepared_at timestamptz;
  v_status text;
  v_portions numeric;
  v_remaining numeric;
  v_wasted numeric;
  v_waste_cost bigint;
  v_version bigint;
  v_cost bigint;
begin
  for v_product in select id, shop_id, metadata from public.products loop
    if v_product.metadata is null
       or jsonb_typeof (v_product.metadata -> 'menu') <> 'object'
       or jsonb_typeof (v_product.metadata -> 'menu' -> 'prepBatches') <> 'array' then
      continue;
    end if;

    for b in select * from jsonb_array_elements (v_product.metadata -> 'menu' -> 'prepBatches') loop
      begin
      if b is null or jsonb_typeof (b) <> 'object' then
        continue;
      end if;
      v_batch_id := public._wk_try_uuid (b ->> 'id');
      -- Prefer the recorded prep time; fall back to the recorded creation time.
      -- If neither is a readable timestamp, leave the batch out rather than guess one.
      v_prepared_at := coalesce (
        public._wk_try_timestamptz (b ->> 'preparedAt'),
        public._wk_try_timestamptz (b ->> 'createdAt')
      );
      if v_batch_id is null or v_prepared_at is null then
        continue;
      end if;

      v_prepared := greatest (0, coalesce ((b ->> 'portionsPrepared')::numeric, 0));
      v_remaining := greatest (0, coalesce ((b ->> 'remainingPortions')::numeric, 0));
      v_wasted := greatest (0, coalesce ((b ->> 'wastedPortions')::numeric, 0));
      v_waste_cost := greatest (0, coalesce ((b ->> 'wasteCostUgx')::bigint, 0));
      v_status := coalesce (nullif (b ->> 'status', ''), 'active');
      if v_status not in ('active', 'depleted', 'wasted', 'cancelled') then
        v_status := 'active';
      end if;
      v_version := greatest (1, coalesce ((b ->> 'version')::bigint, 1));
      v_cost := greatest (0, coalesce ((b ->> 'batchCostPerPlateUgx')::bigint, (b ->> 'unitCostUgx')::bigint, 0));
      v_expected := nullif (b ->> 'expectedPortions', '')::numeric;
      v_snapshot := b -> 'recipeSnapshot';

      -- Full-batch ingredient quantities for cancel. Explicit batches used the expected
      -- yield as the ingredient basis; legacy batches use the prepared count. The scaling
      -- denominator is always portions_prepared, matching the client.
      v_req := null;
      if jsonb_typeof (v_snapshot -> 'lines') = 'array' then
        v_basis := coalesce (v_expected, v_prepared);
        if v_basis > 0 then
          select jsonb_agg (jsonb_build_object (
            'productId', l ->> 'ingredientProductId',
            'quantityBase', round (
              greatest (0, coalesce ((l ->> 'quantityBase')::numeric, 0))
              * v_basis / greatest (1, coalesce ((v_snapshot ->> 'yieldQty')::numeric, 1))
              * (1 + least (100, greatest (0, coalesce ((l ->> 'wastePercent')::numeric, 0))) / 100),
              4
            )
          ))
          into v_req
          from jsonb_array_elements (v_snapshot -> 'lines') l
          where nullif (l ->> 'ingredientProductId', '') is not null;
        end if;
      end if;

      insert into public.prep_batches (
        shop_id, id, menu_product_id, prepared_at, portions_prepared, remaining_portions,
        wasted_portions, waste_cost_ugx, status, version, cost_per_plate_ugx,
        ingredient_requirements, ingredient_basis_portions, data, created_at, updated_at
      )
      values (
        v_product.shop_id, v_batch_id, v_product.id, v_prepared_at, v_prepared, v_remaining,
        v_wasted, v_waste_cost, v_status, v_version, v_cost,
        v_req, v_prepared, b, now (), now ()
      )
      on conflict (shop_id, id) do nothing;
      exception
        when others then
          -- One malformed legacy batch must not block the whole backfill.
          continue;
      end;
    end loop;
  end loop;

  -- Refresh the read-model JSON for products that now have authoritative batches.
  update public.products prod
  set metadata = coalesce (prod.metadata, '{}'::jsonb)
  where exists (
    select 1 from public.prep_batches b
    where b.shop_id = prod.shop_id and b.menu_product_id = prod.id
  );
end;
$$;

select public._wk_backfill_prep_batches ();

revoke all on function public._wk_backfill_prep_batches () from public;
revoke all on function public._wk_backfill_prep_batches () from anon;
revoke all on function public._wk_backfill_prep_batches () from authenticated;

-- Internal helpers are not client-callable.
revoke all on function public._wk_prep_batch_json (public.prep_batches) from public, anon, authenticated;
revoke all on function public._wk_try_timestamptz (text) from public, anon, authenticated;
revoke all on function public._wk_refresh_prep_batch_projection (uuid, uuid) from public, anon, authenticated;
revoke all on function public._wk_project_prep_batches_to_product () from public, anon, authenticated;
revoke all on function public._wk_prep_batch_stock (uuid, uuid, uuid, numeric, text) from public, anon, authenticated;
revoke all on function public._wk_reconcile_prep_batch_events (uuid, uuid) from public, anon, authenticated;
revoke all on function public._wk_apply_sale_line_consumption (uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._wk_trg_sales_prep_batch_consumption () from public, anon, authenticated;

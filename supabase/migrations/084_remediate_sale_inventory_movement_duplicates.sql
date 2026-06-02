-- Remediate historical duplicate sale inventory_movements, then enforce uniqueness.
-- Idempotent: safe to re-run; no-op when no duplicates remain.

-- ---------------------------------------------------------------------------
-- Pre-check (optional — run in SQL editor before migration)
-- ---------------------------------------------------------------------------
-- select shop_id, reference_type, reference_id, product_id, count(*) as row_count
-- from public.inventory_movements
-- where reference_type = 'sale' and reference_id is not null
-- group by shop_id, reference_type, reference_id, product_id
-- having count(*) > 1
-- order by row_count desc;

do $$
declare
  v_deleted bigint := 0;
  v_corrected bigint := 0;
begin
  create temp table _waka_sale_im_dupes (
    id uuid primary key,
    shop_id uuid not null,
    product_id uuid not null,
    quantity_delta numeric not null
  ) on commit drop;

  insert into _waka_sale_im_dupes (id, shop_id, product_id, quantity_delta)
  select
    im.id,
    im.shop_id,
    im.product_id,
    im.quantity_delta
  from (
    select
      im2.id,
      im2.shop_id,
      im2.product_id,
      im2.quantity_delta,
      row_number() over (
        partition by im2.shop_id, im2.reference_type, im2.reference_id, im2.product_id
        order by im2.created_at asc, im2.id asc
      ) as rn
    from public.inventory_movements im2
    where im2.reference_type = 'sale'
      and im2.reference_id is not null
      and im2.product_id is not null
  ) im
  where im.rn > 1;

  -- Duplicate sale movements reduced stock twice; add back the extra deduction.
  update public.products p
  set
    stock_on_hand = p.stock_on_hand - d.quantity_delta,
    updated_at = now()
  from _waka_sale_im_dupes d
  where p.id = d.product_id
    and p.shop_id = d.shop_id;

  get diagnostics v_corrected = row_count;

  delete from public.inventory_movements im
  using _waka_sale_im_dupes d
  where im.id = d.id;

  get diagnostics v_deleted = row_count;

  raise notice
    'Sale inventory dedupe: removed % duplicate row(s), corrected stock on % product row(s).',
    v_deleted,
    v_corrected;
end;
$$;

-- ---------------------------------------------------------------------------
-- Verification — abort if any duplicate groups remain
-- ---------------------------------------------------------------------------
do $$
declare
  v_dup_groups bigint;
begin
  select count(*)::bigint
  into v_dup_groups
  from (
    select 1
    from public.inventory_movements im
    where im.reference_type = 'sale'
      and im.reference_id is not null
      and im.product_id is not null
    group by im.shop_id, im.reference_type, im.reference_id, im.product_id
    having count(*) > 1
  ) d;

  if v_dup_groups > 0 then
    raise exception
      'inventory_movements sale dedupe incomplete: % duplicate group(s) remain',
      v_dup_groups;
  end if;

  raise notice 'Verification OK: zero duplicate sale inventory_movement groups.';
end;
$$;

-- ---------------------------------------------------------------------------
-- Unique index (083 failed here when duplicates existed)
-- ---------------------------------------------------------------------------
create unique index if not exists inventory_movements_sale_product_unique
  on public.inventory_movements (shop_id, reference_type, reference_id, product_id)
  where reference_type = 'sale' and reference_id is not null;

-- ---------------------------------------------------------------------------
-- Post-migration verification (expect 0 rows):
-- ---------------------------------------------------------------------------
-- select
--   shop_id,
--   reference_type,
--   reference_id,
--   product_id,
--   count(*) as duplicate_rows
-- from public.inventory_movements
-- where reference_type = 'sale' and reference_id is not null
-- group by shop_id, reference_type, reference_id, product_id
-- having count(*) > 1;

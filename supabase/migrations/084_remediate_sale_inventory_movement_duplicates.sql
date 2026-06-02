-- Remediate historical duplicate sale inventory_movements, then enforce uniqueness.
-- Safe to re-run: deletes only rn > 1 rows; index uses IF NOT EXISTS.

-- ---------------------------------------------------------------------------
-- 1) Report duplicates (run before/after in SQL editor for verification)
-- ---------------------------------------------------------------------------
-- select shop_id, reference_type, reference_id, product_id, count(*) as row_count
-- from public.inventory_movements
-- where reference_type = 'sale' and reference_id is not null
-- group by shop_id, reference_type, reference_id, product_id
-- having count(*) > 1
-- order by row_count desc;

-- ---------------------------------------------------------------------------
-- 2) Undo extra stock deductions from duplicate rows, then delete duplicates
--    Keep the oldest movement per (shop_id, reference_type, reference_id, product_id).
-- ---------------------------------------------------------------------------
do $$
declare
  v_deleted bigint := 0;
begin
  with ranked as (
    select
      im.id,
      im.shop_id,
      im.product_id,
      im.quantity_delta,
      row_number() over (
        partition by im.shop_id, im.reference_type, im.reference_id, im.product_id
        order by im.created_at asc, im.id asc
      ) as rn
    from public.inventory_movements im
    where im.reference_type = 'sale'
      and im.reference_id is not null
      and im.product_id is not null
  ),
  extras as (
    select id, shop_id, product_id, quantity_delta
    from ranked
    where rn > 1
  ),
  stock_fix as (
    update public.products p
    set
      stock_on_hand = p.stock_on_hand - e.quantity_delta,
      updated_at = now()
    from extras e
    where p.id = e.product_id
      and p.shop_id = e.shop_id
    returning p.id
  ),
  removed as (
    delete from public.inventory_movements im
    using extras e
    where im.id = e.id
    returning im.id
  )
  select count(*)::bigint into v_deleted from removed;

  raise notice 'Removed % duplicate sale inventory_movement row(s); stock corrected for removed deductions.', v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Verification — migration fails if duplicates remain (zero expected)
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
    raise exception 'inventory_movements sale dedupe incomplete: % duplicate group(s) remain', v_dup_groups;
  end if;

  raise notice 'Verification OK: zero duplicate sale inventory_movement groups.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Enforce uniqueness (083 may have failed here on production)
-- ---------------------------------------------------------------------------
create unique index if not exists inventory_movements_sale_product_unique
  on public.inventory_movements (shop_id, reference_type, reference_id, product_id)
  where reference_type = 'sale' and reference_id is not null;

-- ---------------------------------------------------------------------------
-- Post-migration verification query (expect 0 rows):
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

-- Align cloud return stock restore with client returnRestocksInventory():
-- only wrong_item returns restock inventory.

create or replace function public.apply_sale_return_stock (p_return_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.sale_returns%rowtype;
  v_new numeric;
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

  -- Damaged / broken / warm / other: mark applied without changing stock (matches local POS).
  if coalesce (r.reason, 'other') is distinct from 'wrong_item' then
    update public.sale_returns
    set stock_applied_at = now (),
        updated_at = now ()
    where id = p_return_id;
    return;
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

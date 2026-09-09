-- Drop the obsolete completed → void/refunded restock branch.
--
-- Modern voids use shop_apply_sale_void_stock and do not write sales.status
-- to void/refunded. reverse_sale_stock_movements is non-idempotent; the
-- leftover trigger arm plus sales_update RLS could inflate stock.
--
-- Keeps the completed-sale apply / receipt branch from 011.
-- Does not replace reverse_sale_stock_movements. Does not change ACLs.
-- Idempotent: CREATE OR REPLACE of the same trigger function.

create or replace function public.trg_sales_status_stock ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.status = 'completed' and old.status is distinct from 'completed' then
      perform public.apply_sale_stock_movements (new.id);
      if coalesce (new.issue_receipt, false) then
        perform public.create_receipt_for_sale (new.id);
      end if;
    end if;
  end if;
  return new;
end;
$$;

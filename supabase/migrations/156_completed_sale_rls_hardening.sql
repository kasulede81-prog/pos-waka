-- Completed-sale direct-mutation RLS hardening (Phase 2).
--
-- Audit finding: sale_lines_write/update already allowed a shop manager/owner to bypass
-- the draft-only gate via `or user_can_manage_shop(shop_id)`; sale_lines_delete and
-- sales_update had NO status predicate at all (any manager could delete line items from,
-- or any cashier-or-above could update any field of, a completed sale directly via
-- PostgREST); sale_payments_update/delete had the same gap. No src/ application code
-- relies on any of these direct-write paths — every legitimate mutation goes through a
-- security-definer RPC (shop_push_sale_complete, shop_push_pending_sale,
-- shop_cancel_pending_sale, shop_patch_hospitality_sale_metadata, shop_push_sale_return),
-- none of which are affected by RLS at all (security definer bypasses it). This migration
-- only narrows an existing, previously-latent gap — it does not touch sale_lines_select,
-- sale_payments_select, sales_select, sales_insert, or any RPC.

drop policy if exists sale_lines_write on public.sale_line_items;
create policy sale_lines_write
  on public.sale_line_items for insert
  with check (
    exists (
      select 1 from public.sales s
      where s.id = sale_line_items.sale_id
        and public.user_is_cashier_or_above (s.shop_id)
        and s.status <> 'completed'
    )
  );

drop policy if exists sale_lines_update on public.sale_line_items;
create policy sale_lines_update
  on public.sale_line_items for update
  using (
    exists (
      select 1 from public.sales s
      where s.id = sale_line_items.sale_id
        and public.user_is_cashier_or_above (s.shop_id)
        and s.status <> 'completed'
    )
  );

drop policy if exists sale_lines_delete on public.sale_line_items;
create policy sale_lines_delete
  on public.sale_line_items for delete
  using (
    exists (
      select 1 from public.sales s
      where s.id = sale_line_items.sale_id
        and public.user_can_manage_shop (s.shop_id)
        and s.status <> 'completed'
    )
  );

drop policy if exists sales_update on public.sales;
create policy sales_update
  on public.sales for update
  using (
    public.user_is_cashier_or_above (shop_id)
    and status <> 'completed'
  );

drop policy if exists sale_payments_write on public.sale_payments;
create policy sale_payments_write
  on public.sale_payments for insert
  with check (
    exists (
      select 1 from public.sales s
      where s.id = sale_payments.sale_id
        and public.user_is_cashier_or_above (s.shop_id)
        and s.status <> 'completed'
    )
  );

drop policy if exists sale_payments_update on public.sale_payments;
create policy sale_payments_update
  on public.sale_payments for update
  using (
    exists (
      select 1 from public.sales s
      where s.id = sale_payments.sale_id
        and public.user_can_manage_shop (s.shop_id)
        and s.status <> 'completed'
    )
  );

drop policy if exists sale_payments_delete on public.sale_payments;
create policy sale_payments_delete
  on public.sale_payments for delete
  using (
    exists (
      select 1 from public.sales s
      where s.id = sale_payments.sale_id
        and public.user_can_manage_shop (s.shop_id)
        and s.status <> 'completed'
    )
  );

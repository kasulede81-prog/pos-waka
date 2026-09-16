-- RECONCILIATION BACKFILL — this migration was applied directly to production
-- on 2026-09-14 (recorded version 20260914220053) without ever being committed
-- to this repository. Discovered during the WAKA POS financial certification
-- audit (P1#3 — migration drift; this is the fix for Issue I — completed-sale
-- RLS protection). Reproduced here VERBATIM from
-- supabase_migrations.schema_migrations.statements for that version — no
-- content has been altered. Before this migration, migration 008's original
-- policies allowed a shop owner/manager to UPDATE or DELETE sale_line_items
-- (including financial metadata) on a COMPLETED sale, and sales_update had no
-- status guard at all. This file intentionally reproduces the exact
-- production version identifier as its filename prefix so tooling recognizes
-- it as already applied; it must NOT be re-applied.
--
-- IMPORTANT for anyone rebuilding this database from migrations alone: this
-- migration is the ONLY thing that adds the `status <> 'completed'` guard to
-- sale_line_items UPDATE/DELETE and sales UPDATE (migration 008 does not have
-- it), and it also hardens sale_payments the same way. Without this file, a
-- fresh database would NOT have completed-sale write protection.

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

-- Waka POS — Row Level Security (multi-tenant isolation + cashier/manager split)
-- Requires 007_functions_and_triggers.sql (helper functions).

-- ---------- profiles ----------
alter table public.profiles enable row level security;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select
  on public.profiles for select
  using (auth.uid () = id);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update
  on public.profiles for update
  using (auth.uid () = id);

drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert
  on public.profiles for insert
  with check (auth.uid () = id);

-- ---------- organizations ----------
alter table public.organizations enable row level security;

drop policy if exists organizations_member_select on public.organizations;
create policy organizations_member_select
  on public.organizations for select
  using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = organizations.id and m.user_id = auth.uid ()
    )
    or created_by = auth.uid ()
  );

drop policy if exists organizations_create on public.organizations;
create policy organizations_create
  on public.organizations for insert
  with check (created_by = auth.uid ());

drop policy if exists organizations_admin_update on public.organizations;
create policy organizations_admin_update
  on public.organizations for update
  using (public.user_has_org_role (id, array['owner', 'admin']));

-- ---------- organization_members ----------
alter table public.organization_members enable row level security;

drop policy if exists org_members_select on public.organization_members;
create policy org_members_select
  on public.organization_members for select
  using (
    user_id = auth.uid ()
    or exists (
      select 1 from public.organization_members m
      where m.organization_id = organization_members.organization_id
        and m.user_id = auth.uid ()
    )
  );

drop policy if exists org_members_admin_write on public.organization_members;
create policy org_members_admin_write
  on public.organization_members for insert
  with check (
    public.user_has_org_role (organization_id, array['owner', 'admin'])
    or (
      user_id = auth.uid ()
      and role = 'owner'
    )
  );

drop policy if exists org_members_admin_update on public.organization_members;
create policy org_members_admin_update
  on public.organization_members for update
  using (public.user_has_org_role (organization_id, array['owner', 'admin']));

drop policy if exists org_members_admin_delete on public.organization_members;
create policy org_members_admin_delete
  on public.organization_members for delete
  using (public.user_has_org_role (organization_id, array['owner', 'admin']));

-- ---------- shops ----------
alter table public.shops enable row level security;

drop policy if exists shops_select on public.shops;
create policy shops_select
  on public.shops for select
  using (public.user_can_access_shop (id));

drop policy if exists shops_write on public.shops;
create policy shops_write
  on public.shops for insert
  with check (
    public.user_has_org_role (organization_id, array['owner', 'admin'])
  );

drop policy if exists shops_update on public.shops;
create policy shops_update
  on public.shops for update
  using (public.user_can_manage_shop (id));

drop policy if exists shops_delete on public.shops;
create policy shops_delete
  on public.shops for delete
  using (public.user_has_org_role (organization_id, array['owner', 'admin']));

-- ---------- shop_members ----------
alter table public.shop_members enable row level security;

drop policy if exists shop_members_select on public.shop_members;
create policy shop_members_select
  on public.shop_members for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists shop_members_write on public.shop_members;
create policy shop_members_write
  on public.shop_members for insert
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists shop_members_update on public.shop_members;
create policy shop_members_update
  on public.shop_members for update
  using (public.user_can_manage_shop (shop_id));

drop policy if exists shop_members_delete on public.shop_members;
create policy shop_members_delete
  on public.shop_members for delete
  using (public.user_can_manage_shop (shop_id));

-- ---------- product_categories ----------
alter table public.product_categories enable row level security;

drop policy if exists product_categories_select on public.product_categories;
create policy product_categories_select
  on public.product_categories for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists product_categories_write on public.product_categories;
create policy product_categories_write
  on public.product_categories for insert
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists product_categories_update on public.product_categories;
create policy product_categories_update
  on public.product_categories for update
  using (public.user_can_manage_shop (shop_id));

drop policy if exists product_categories_delete on public.product_categories;
create policy product_categories_delete
  on public.product_categories for delete
  using (public.user_can_manage_shop (shop_id));

-- ---------- products ----------
alter table public.products enable row level security;

drop policy if exists products_select on public.products;
create policy products_select
  on public.products for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists products_write on public.products;
create policy products_write
  on public.products for insert
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists products_update on public.products;
create policy products_update
  on public.products for update
  using (public.user_can_manage_shop (shop_id));

drop policy if exists products_delete on public.products;
create policy products_delete
  on public.products for delete
  using (public.user_can_manage_shop (shop_id));

-- ---------- inventory_movements ----------
alter table public.inventory_movements enable row level security;

drop policy if exists inventory_movements_select on public.inventory_movements;
create policy inventory_movements_select
  on public.inventory_movements for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists inventory_movements_insert on public.inventory_movements;
create policy inventory_movements_insert
  on public.inventory_movements for insert
  with check (
    public.user_is_cashier_or_above (shop_id)
    or public.user_can_manage_shop (shop_id)
  );

-- ---------- customers ----------
alter table public.customers enable row level security;

drop policy if exists customers_select on public.customers;
create policy customers_select
  on public.customers for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists customers_write on public.customers;
create policy customers_write
  on public.customers for insert
  with check (public.user_is_cashier_or_above (shop_id));

drop policy if exists customers_update on public.customers;
create policy customers_update
  on public.customers for update
  using (public.user_is_cashier_or_above (shop_id));

drop policy if exists customers_delete on public.customers;
create policy customers_delete
  on public.customers for delete
  using (public.user_can_manage_shop (shop_id));

-- ---------- sales ----------
alter table public.sales enable row level security;

drop policy if exists sales_select on public.sales;
create policy sales_select
  on public.sales for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists sales_insert on public.sales;
create policy sales_insert
  on public.sales for insert
  with check (public.user_is_cashier_or_above (shop_id));

drop policy if exists sales_update on public.sales;
create policy sales_update
  on public.sales for update
  using (public.user_is_cashier_or_above (shop_id));

-- ---------- sale_line_items ----------
alter table public.sale_line_items enable row level security;

drop policy if exists sale_lines_select on public.sale_line_items;
create policy sale_lines_select
  on public.sale_line_items for select
  using (
    exists (
      select 1 from public.sales s
      where s.id = sale_line_items.sale_id
        and public.user_can_access_shop (s.shop_id)
    )
  );

drop policy if exists sale_lines_write on public.sale_line_items;
create policy sale_lines_write
  on public.sale_line_items for insert
  with check (
    exists (
      select 1 from public.sales s
      where s.id = sale_line_items.sale_id
        and public.user_is_cashier_or_above (s.shop_id)
        and (
          s.status = 'draft'
          or public.user_can_manage_shop (s.shop_id)
        )
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
        and (
          s.status = 'draft'
          or public.user_can_manage_shop (s.shop_id)
        )
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
    )
  );

-- ---------- sale_payments ----------
alter table public.sale_payments enable row level security;

drop policy if exists sale_payments_select on public.sale_payments;
create policy sale_payments_select
  on public.sale_payments for select
  using (
    exists (
      select 1 from public.sales s
      where s.id = sale_payments.sale_id
        and public.user_can_access_shop (s.shop_id)
    )
  );

drop policy if exists sale_payments_write on public.sale_payments;
create policy sale_payments_write
  on public.sale_payments for insert
  with check (
    exists (
      select 1 from public.sales s
      where s.id = sale_payments.sale_id
        and public.user_is_cashier_or_above (s.shop_id)
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
    )
  );

-- ---------- receipts ----------
alter table public.receipts enable row level security;

drop policy if exists receipts_select on public.receipts;
create policy receipts_select
  on public.receipts for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists receipts_insert on public.receipts;
create policy receipts_insert
  on public.receipts for insert
  with check (public.user_is_cashier_or_above (shop_id));

drop policy if exists receipts_update on public.receipts;
create policy receipts_update
  on public.receipts for update
  using (public.user_can_manage_shop (shop_id));

-- ---------- expenses ----------
alter table public.expenses enable row level security;

drop policy if exists expenses_select on public.expenses;
create policy expenses_select
  on public.expenses for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists expenses_write on public.expenses;
create policy expenses_write
  on public.expenses for insert
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists expenses_update on public.expenses;
create policy expenses_update
  on public.expenses for update
  using (public.user_can_manage_shop (shop_id));

drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete
  on public.expenses for delete
  using (public.user_can_manage_shop (shop_id));

-- ---------- subscription plans (catalog) ----------
alter table public.subscription_plans enable row level security;

drop policy if exists plans_select on public.subscription_plans;
create policy plans_select
  on public.subscription_plans for select
  using (auth.uid () is not null and is_active);

-- ---------- subscriptions ----------
alter table public.subscriptions enable row level security;

drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select
  on public.subscriptions for select
  using (
    public.user_has_org_role (organization_id, array['owner', 'admin', 'billing', 'staff'])
  );

drop policy if exists subscriptions_write on public.subscriptions;
create policy subscriptions_write
  on public.subscriptions for insert
  with check (
    public.user_has_org_role (organization_id, array['owner', 'admin', 'billing'])
  );

drop policy if exists subscriptions_update on public.subscriptions;
create policy subscriptions_update
  on public.subscriptions for update
  using (
    public.user_has_org_role (organization_id, array['owner', 'admin', 'billing'])
  );

-- ---------- shop_counters (atomic sequences; writers must be cashier+ at that shop) ----------
alter table public.shop_counters enable row level security;

drop policy if exists shop_counters_rw on public.shop_counters;
create policy shop_counters_rw
  on public.shop_counters for all
  using (public.user_is_cashier_or_above (shop_id))
  with check (public.user_is_cashier_or_above (shop_id));

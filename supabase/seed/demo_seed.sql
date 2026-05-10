/*
 * Demo seed (development only) — UNCOMMENT this entire block before running.
 *
 * Prerequisites: migrations 001–010 applied; replace DEMO_USER_ID with a real
 * auth.users id from Dashboard → Authentication → Users.
 *
begin;

with u as (
  select 'DEMO_USER_ID'::uuid as uid
),
ins_org as (
  insert into public.organizations (name, slug, created_by)
  select 'Demo Uganda Traders', 'demo-uganda', uid from u
  returning id
),
ins_member as (
  insert into public.organization_members (organization_id, user_id, role)
  select id, (select uid from u), 'owner' from ins_org
  returning organization_id
),
ins_shop as (
  insert into public.shops (organization_id, name, code, phone_e164)
  select ins_member.organization_id, 'Kampala Main', 'KLA-01', '+256700000000'
  from ins_member
  returning id, organization_id
)
insert into public.shop_members (shop_id, user_id, role)
select ins_shop.id, (select uid from u), 'manager'
from ins_shop;

with shop as (
  select s.id as shop_id
  from public.shops s
  join public.organizations o on o.id = s.organization_id
  where o.slug = 'demo-uganda'
  limit 1
)
insert into public.product_categories (shop_id, name, sort_order)
select shop_id, 'Groceries', 1 from shop;

with shop as (
  select s.id as shop_id
  from public.shops s
  join public.organizations o on o.id = s.organization_id
  where o.slug = 'demo-uganda'
  limit 1
)
insert into public.products (shop_id, sku, name, price_ugx, cost_ugx, stock_on_hand, reorder_level)
select
  shop_id,
  v.sku,
  v.name,
  v.price_ugx,
  v.cost_ugx,
  v.stock,
  v.reorder
from shop
cross join (values
  ('SUG-1KG', 'Sugar 1kg', 4500::bigint, 3400::bigint, 100::numeric, 15::numeric),
  ('OIL-500', 'Cooking Oil 500ml', 6000::bigint, 4900::bigint, 40::numeric, 8::numeric)
) as v (sku, name, price_ugx, cost_ugx, stock, reorder);

commit;
*/

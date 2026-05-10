-- Waka POS — Uganda kiosk / duka: product selling modes, sell-by-money lines, optional receipts, simple debt flag

-- ---------- products: selling modes & per-base-unit pricing ----------
alter table public.products
  add column if not exists selling_mode text default 'unit';

alter table public.products
  drop constraint if exists products_selling_mode_check;

alter table public.products
  add constraint products_selling_mode_check check (selling_mode in ('unit', 'weighted', 'portion'));

alter table public.products alter column selling_mode set default 'unit';

alter table public.products alter column selling_mode set not null;

alter table public.products add column if not exists base_unit text;
alter table public.products add column if not exists buying_unit text;
alter table public.products add column if not exists conversion_rate numeric(18, 4);
alter table public.products add column if not exists selling_price_per_unit_ugx bigint;
alter table public.products add column if not exists cost_price_per_unit_ugx bigint;
alter table public.products add column if not exists minimum_stock_alert numeric(18, 4);

comment on column public.products.selling_mode is 'unit = count items; weighted = kg/L base stock; portion = liquids sold by measure or money.';
comment on column public.products.base_unit is 'Stock counted in this unit (ea, kg, litre, cup, …).';
comment on column public.products.buying_unit is 'How stock was bought (e.g. 100kg bag, 20L jerrican).';
comment on column public.products.conversion_rate is 'How many base_units per one buying_unit (e.g. 20 litres per jerrican).';
comment on column public.products.selling_price_per_unit_ugx is 'Retail price per base_unit (UGX); used for sell-by-money math.';
comment on column public.products.cost_price_per_unit_ugx is 'Estimated cost per base_unit (UGX) for profit hints.';
comment on column public.products.minimum_stock_alert is 'Low-stock threshold in base_unit; falls back to reorder_level.';

update public.products
set
  selling_price_per_unit_ugx = coalesce (selling_price_per_unit_ugx, price_ugx, 0),
  cost_price_per_unit_ugx = coalesce (cost_price_per_unit_ugx, cost_ugx, 0),
  base_unit = coalesce (nullif (trim (base_unit), ''), nullif (trim (unit), ''), 'ea'),
  minimum_stock_alert = coalesce (minimum_stock_alert, reorder_level),
  selling_mode = coalesce (selling_mode, 'unit')
where true;

alter table public.products alter column selling_price_per_unit_ugx set default 0;
alter table public.products alter column cost_price_per_unit_ugx set default 0;

update public.products set selling_price_per_unit_ugx = 0 where selling_price_per_unit_ugx is null;
update public.products set cost_price_per_unit_ugx = 0 where cost_price_per_unit_ugx is null;

alter table public.products alter column selling_price_per_unit_ugx set not null;
alter table public.products alter column cost_price_per_unit_ugx set not null;

alter table public.products drop constraint if exists products_selling_price_nonneg;
alter table public.products
  add constraint products_selling_price_nonneg check (selling_price_per_unit_ugx >= 0);

alter table public.products drop constraint if exists products_cost_price_nonneg;
alter table public.products
  add constraint products_cost_price_nonneg check (cost_price_per_unit_ugx >= 0);

-- ---------- sale line: quantity vs money input ----------
alter table public.sale_line_items
  add column if not exists line_input_mode text default 'quantity';

alter table public.sale_line_items drop constraint if exists sale_line_input_mode_check;

alter table public.sale_line_items
  add constraint sale_line_input_mode_check check (line_input_mode in ('quantity', 'money'));

alter table public.sale_line_items alter column line_input_mode set default 'quantity';
alter table public.sale_line_items alter column line_input_mode set not null;

alter table public.sale_line_items add column if not exists money_amount_ugx bigint;

alter table public.sale_line_items drop constraint if exists sale_line_money_nonneg;

alter table public.sale_line_items
  add constraint sale_line_money_nonneg check (money_amount_ugx is null or money_amount_ugx >= 0);

comment on column public.sale_line_items.line_input_mode is 'quantity = qty keypad; money = UGX amount, qty derived from price per base unit.';
comment on column public.sale_line_items.money_amount_ugx is 'When line_input_mode = money, customer paid this UGX on the line.';

-- ---------- sales: kiosk receipt + debt summary ----------
alter table public.sales add column if not exists issue_receipt boolean default false;
alter table public.sales alter column issue_receipt set not null;

alter table public.sales add column if not exists debt_amount_ugx bigint default 0;

alter table public.sales drop constraint if exists sales_debt_nonneg;

alter table public.sales
  add constraint sales_debt_nonneg check (debt_amount_ugx >= 0);

alter table public.sales alter column debt_amount_ugx set not null;

comment on column public.sales.issue_receipt is 'If true, completing sale generates a receipt row; kiosks usually leave false.';
comment on column public.sales.debt_amount_ugx is 'Portion of sale total recorded as still owed (on account).';

-- ---------- inventory: plain-language reasons ----------
alter table public.inventory_movements drop constraint if exists inventory_movements_reason_check;

alter table public.inventory_movements
  add constraint inventory_movements_reason_check check (
    reason in (
      'sale',
      'return',
      'adjustment',
      'initial',
      'transfer',
      'waste',
      'other',
      'damaged',
      'personal',
      'debt'
    )
  );

-- ---------- stock trigger: receipt only when requested ----------
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
    elsif old.status = 'completed' and new.status in ('void', 'refunded') then
      perform public.reverse_sale_stock_movements (old.id);
    end if;
  end if;
  return new;
end;
$$;

-- ---------- RPC: broader adjustment reasons (kiosk wording) ----------
create or replace function public.rpc_inventory_adjust (
  p_shop_id uuid,
  p_product_id uuid,
  p_delta numeric,
  p_reason text,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_can_manage_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if p_reason not in (
    'adjustment',
    'waste',
    'initial',
    'transfer',
    'other',
    'damaged',
    'personal',
    'debt'
  ) then
    raise exception 'Invalid reason';
  end if;

  update public.products
  set stock_on_hand = stock_on_hand + p_delta,
      updated_at = now ()
  where id = p_product_id and shop_id = p_shop_id;

  if not found then
    raise exception 'Product not in shop';
  end if;

  insert into public.inventory_movements (
    shop_id, product_id, quantity_delta, reason, reference_type, note, created_by
  )
  values (
    p_shop_id, p_product_id, p_delta, p_reason, 'manual', p_note, auth.uid ()
  );
end;
$$;

-- ---------- low stock uses minimum_stock_alert when set ----------
create or replace function public.rpc_low_stock (p_shop_id uuid, p_limit int default 50)
returns table (
  product_id uuid,
  name text,
  sku text,
  stock_on_hand numeric,
  reorder_level numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.sku,
    p.stock_on_hand,
    coalesce (p.minimum_stock_alert, p.reorder_level, 0::numeric) as reorder_level
  from public.products p
  where p.shop_id = p_shop_id
    and p.is_active
    and coalesce (p.minimum_stock_alert, p.reorder_level, 0) > 0
    and p.stock_on_hand <= coalesce (p.minimum_stock_alert, p.reorder_level, 0)
  order by p.stock_on_hand asc
  limit greatest (1, least (p_limit, 500));
$$;

-- Waka POS — categories, products, stock, movement audit

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create index if not exists product_categories_shop_idx on public.product_categories (shop_id);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  category_id uuid references public.product_categories (id) on delete set null,
  sku text,
  name text not null,
  description text,
  unit text not null default 'ea',
  price_ugx bigint not null default 0 check (price_ugx >= 0),
  cost_ugx bigint not null default 0 check (cost_ugx >= 0),
  tax_rate numeric(7, 4) not null default 0 check (tax_rate >= 0),
  stock_on_hand numeric(18, 4) not null default 0,
  reorder_level numeric(18, 4) not null default 0,
  is_active boolean not null default true,
  barcode text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  unique (shop_id, sku)
);

create index if not exists products_shop_idx on public.products (shop_id);
create index if not exists products_category_idx on public.products (category_id);
create index if not exists products_active_idx on public.products (shop_id) where is_active;

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  quantity_delta numeric(18, 4) not null,
  reason text not null
    check (reason in ('sale', 'return', 'adjustment', 'initial', 'transfer', 'waste', 'other')),
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now ()
);

create index if not exists inventory_movements_shop_created_idx on public.inventory_movements (shop_id, created_at desc);
create index if not exists inventory_movements_product_idx on public.inventory_movements (product_id);

drop trigger if exists trg_product_categories_updated on public.product_categories;
create trigger trg_product_categories_updated
  before update on public.product_categories
  for each row execute function public.set_updated_at ();

drop trigger if exists trg_products_updated on public.products;
create trigger trg_products_updated
  before update on public.products
  for each row execute function public.set_updated_at ();

comment on column public.products.price_ugx is 'Retail unit price in integer UGX.';
comment on table public.inventory_movements is 'Append-only stock ledger; quantity_delta negative reduces on-hand.';

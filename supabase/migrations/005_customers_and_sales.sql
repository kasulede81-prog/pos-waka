-- Waka POS — customers, sales, line items, payments (Uganda money rails)

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  phone_e164 text,
  email text,
  notes text,
  loyalty_points numeric(18, 4) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  constraint customer_phone_format check (
    phone_e164 is null
    or phone_e164 ~ '^\+256[0-9]{9}$'
  )
);

create index if not exists customers_shop_idx on public.customers (shop_id);
create index if not exists customers_phone_idx on public.customers (phone_e164) where phone_e164 is not null;

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete restrict,
  customer_id uuid references public.customers (id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'completed', 'void', 'refunded')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'partial', 'paid', 'refunded')),
  subtotal_ugx bigint not null default 0 check (subtotal_ugx >= 0),
  tax_ugx bigint not null default 0 check (tax_ugx >= 0),
  discount_ugx bigint not null default 0 check (discount_ugx >= 0),
  total_ugx bigint not null default 0 check (total_ugx >= 0),
  currency text not null default 'UGX',
  -- Denormalized quick references (also stored per payment row)
  cash_amount_ugx bigint not null default 0 check (cash_amount_ugx >= 0),
  mtn_momo_reference text,
  airtel_money_reference text,
  internal_note text,
  created_by uuid references auth.users (id),
  completed_at timestamptz,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create index if not exists sales_shop_created_idx on public.sales (shop_id, created_at desc);
create index if not exists sales_status_idx on public.sales (shop_id, status);

create table if not exists public.sale_line_items (
  id uuid primary key default gen_random_uuid (),
  sale_id uuid not null references public.sales (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity numeric(18, 4) not null check (quantity > 0),
  unit_price_ugx bigint not null check (unit_price_ugx >= 0),
  line_discount_ugx bigint not null default 0 check (line_discount_ugx >= 0),
  line_total_ugx bigint not null check (line_total_ugx >= 0),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists sale_line_items_sale_idx on public.sale_line_items (sale_id);

create table if not exists public.sale_payments (
  id uuid primary key default gen_random_uuid (),
  sale_id uuid not null references public.sales (id) on delete cascade,
  method text not null
    check (method in ('cash', 'mtn_momo', 'airtel_money', 'card', 'other')),
  amount_ugx bigint not null check (amount_ugx > 0),
  external_reference text,
  provider_payload jsonb not null default '{}'::jsonb,
  recorded_by uuid references auth.users (id),
  recorded_at timestamptz not null default now ()
);

create index if not exists sale_payments_sale_idx on public.sale_payments (sale_id);
create index if not exists sale_payments_external_ref_idx on public.sale_payments (external_reference) where external_reference is not null;

drop trigger if exists trg_customers_updated on public.customers;
create trigger trg_customers_updated
  before update on public.customers
  for each row execute function public.set_updated_at ();

drop trigger if exists trg_sales_updated on public.sales;
create trigger trg_sales_updated
  before update on public.sales
  for each row execute function public.set_updated_at ();

comment on column public.sales.mtn_momo_reference is 'MTN Mobile Money provider reference / transaction id.';
comment on column public.sales.airtel_money_reference is 'Airtel Money provider reference / transaction id.';
comment on column public.sale_payments.external_reference is 'MoMo / Airtel transaction reference, card auth code, etc.';

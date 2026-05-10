-- Waka POS — receipts, expenses, subscription catalog + org subscriptions

create table if not exists public.shop_counters (
  shop_id uuid not null references public.shops (id) on delete cascade,
  counter_key text not null,
  last_value bigint not null default 0,
  primary key (shop_id, counter_key),
  constraint counter_non_negative check (last_value >= 0)
);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  sale_id uuid not null unique references public.sales (id) on delete cascade,
  receipt_number bigint not null,
  receipt_code text not null,
  currency text not null default 'UGX',
  printed_at timestamptz,
  email_sent_at timestamptz,
  pdf_storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  unique (shop_id, receipt_number)
);

create index if not exists receipts_shop_idx on public.receipts (shop_id);
create index if not exists receipts_code_idx on public.receipts (receipt_code);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  category text not null,
  amount_ugx bigint not null check (amount_ugx > 0),
  currency text not null default 'UGX',
  description text,
  paid_on date not null default (timezone ('Africa/Kampala', now()))::date,
  attachment_path text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now ()
);

create index if not exists expenses_shop_paid_idx on public.expenses (shop_id, paid_on desc);

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid (),
  code text not null unique,
  name text not null,
  description text,
  monthly_price_ugx bigint not null check (monthly_price_ugx >= 0),
  annual_price_ugx bigint not null check (annual_price_ugx >= 0),
  annual_savings_note text,
  annual_discount_percent numeric(6, 2),
  trial_days int not null default 14 check (trial_days >= 0),
  max_shops int,
  max_pos_users int,
  features jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now ()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid (),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  plan_id uuid not null references public.subscription_plans (id),
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'canceled', 'paused')),
  billing_interval text not null default 'month'
    check (billing_interval in ('month', 'year')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  admin_discount_percent numeric(6, 2) not null default 0 check (admin_discount_percent >= 0 and admin_discount_percent <= 100),
  admin_discount_note text,
  external_provider text default 'manual',
  external_subscription_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create index if not exists subscriptions_org_idx on public.subscriptions (organization_id);
create index if not exists subscriptions_status_idx on public.subscriptions (status);

-- At most one live subscription row per org for trialing/active states
create unique index if not exists subscriptions_one_active_per_org
  on public.subscriptions (organization_id)
  where status in ('trialing', 'active', 'past_due');

drop trigger if exists trg_subscriptions_updated on public.subscriptions;
create trigger trg_subscriptions_updated
  before update on public.subscriptions
  for each row execute function public.set_updated_at ();

comment on table public.shop_counters is 'Atomic per-shop counters for receipt numbers and other sequences.';
comment on table public.subscription_plans is 'UGX SaaS price book; annual_price_ugx includes built-in annual discount.';
comment on column public.subscriptions.admin_discount_percent is 'Manual override by Waka admin (0–100).';

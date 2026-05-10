-- Waka POS — multi-tenant org → shops → membership RBAC

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid (),
  name text not null,
  slug text unique,
  legal_name text,
  tin text,
  billing_email text,
  phone_e164 text,
  default_currency text not null default 'UGX',
  timezone text default 'Africa/Kampala',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now (),
  constraint org_phone_format check (
    phone_e164 is null
    or phone_e164 ~ '^\+256[0-9]{9}$'
  )
);

create index if not exists organizations_created_by_idx on public.organizations (created_by);

-- org_role: owner (full), admin (full ops), billing (subscriptions), staff (base)
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid (),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'staff'
    check (role in ('owner', 'admin', 'billing', 'staff')),
  invited_by uuid references auth.users (id),
  created_at timestamptz not null default now (),
  unique (organization_id, user_id)
);

create index if not exists organization_members_user_idx on public.organization_members (user_id);
create index if not exists organization_members_org_idx on public.organization_members (organization_id);

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid (),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  code text,
  address_line text,
  city text,
  district text,
  phone_e164 text,
  is_active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  unique (organization_id, code),
  constraint shop_phone_format check (
    phone_e164 is null
    or phone_e164 ~ '^\+256[0-9]{9}$'
  )
);

create index if not exists shops_org_idx on public.shops (organization_id);

-- shop_role: manager (catalog+inventory+finance), cashier (POS), viewer (read)
create table if not exists public.shop_members (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'cashier'
    check (role in ('manager', 'cashier', 'viewer')),
  created_at timestamptz not null default now (),
  unique (shop_id, user_id)
);

create index if not exists shop_members_user_idx on public.shop_members (user_id);
create index if not exists shop_members_shop_idx on public.shop_members (shop_id);

drop trigger if exists trg_organizations_updated on public.organizations;
create trigger trg_organizations_updated
  before update on public.organizations
  for each row execute function public.set_updated_at ();

drop trigger if exists trg_shops_updated on public.shops;
create trigger trg_shops_updated
  before update on public.shops
  for each row execute function public.set_updated_at ();

comment on table public.organizations is 'Tenant / business group; billing and RLS anchor.';
comment on table public.shops is 'Physical / logical POS location under an organization.';
comment on table public.shop_members is 'Shop-scoped roles; org owner/admin implicitly see all shops via RLS helpers.';

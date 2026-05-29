-- Full-shop cloud snapshot for new-device restore (products, sales, preferences, archived, etc.).

create table if not exists public.shop_cloud_snapshots (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  snapshot jsonb not null,
  schema_version int not null default 1,
  byte_size int,
  updated_at timestamptz not null default now (),
  updated_by uuid references auth.users (id) on delete set null
);

create index if not exists shop_cloud_snapshots_updated_idx on public.shop_cloud_snapshots (updated_at desc);

comment on table public.shop_cloud_snapshots is
  'Latest full POS snapshot per shop for cross-device restore. Updated by the app after sync.';

alter table public.shop_cloud_snapshots enable row level security;

drop policy if exists shop_cloud_snapshots_select on public.shop_cloud_snapshots;
create policy shop_cloud_snapshots_select
  on public.shop_cloud_snapshots for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists shop_cloud_snapshots_insert on public.shop_cloud_snapshots;
create policy shop_cloud_snapshots_insert
  on public.shop_cloud_snapshots for insert
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists shop_cloud_snapshots_update on public.shop_cloud_snapshots;
create policy shop_cloud_snapshots_update
  on public.shop_cloud_snapshots for update
  using (public.user_can_manage_shop (shop_id));

grant select, insert, update on public.shop_cloud_snapshots to authenticated;

-- Waka POS — Restaurant & Bar (Hospitality Mode)

-- Extend business types
alter table public.shops drop constraint if exists shops_business_type_check;
alter table public.shops
  add constraint shops_business_type_check check (
    business_type in (
      'kiosk_duka',
      'wholesale',
      'mini_supermarket',
      'hardware',
      'restaurant',
      'bar',
      'restaurant_bar',
      'hotel',
      'salon',
      'pharmacy',
      'boutique',
      'electronics',
      'produce_market',
      'mobile_money_agent',
      'other'
    )
  );

alter table public.organizations drop constraint if exists organizations_business_type_check;
alter table public.organizations
  add constraint organizations_business_type_check check (
    business_type in (
      'kiosk_duka',
      'wholesale',
      'mini_supermarket',
      'hardware',
      'restaurant',
      'bar',
      'restaurant_bar',
      'hotel',
      'salon',
      'pharmacy',
      'boutique',
      'electronics',
      'produce_market',
      'mobile_money_agent',
      'other'
    )
  );

-- Waiter role on shop members
alter table public.shop_members drop constraint if exists shop_members_role_check;
alter table public.shop_members
  add constraint shop_members_role_check
    check (role in ('owner', 'manager', 'cashier', 'stock_keeper', 'waiter', 'viewer'));

-- Floor layout
create table if not exists public.dining_areas (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create unique index if not exists dining_areas_shop_name_unique
  on public.dining_areas (shop_id, lower(trim (name)));

create table if not exists public.dining_tables (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  area_id uuid not null references public.dining_areas (id) on delete cascade,
  label text not null,
  capacity int check (capacity is null or capacity > 0),
  sort_order int not null default 0,
  display_status text not null default 'available'
    check (display_status in ('available', 'occupied', 'payment_pending', 'reserved', 'disabled')),
  is_active boolean not null default true,
  grid_x int,
  grid_y int,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create unique index if not exists dining_tables_shop_area_label_unique
  on public.dining_tables (shop_id, area_id, lower(trim (label)));

create table if not exists public.kitchen_stations (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  station_type text not null
    check (station_type in ('kitchen', 'bar', 'grill', 'coffee', 'other')),
  sort_order int not null default 0,
  is_active boolean not null default true,
  print_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create unique index if not exists kitchen_stations_shop_name_unique
  on public.kitchen_stations (shop_id, lower(trim (name)));

create table if not exists public.table_sessions (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  table_id uuid not null references public.dining_tables (id) on delete restrict,
  sale_id uuid not null references public.sales (id) on delete restrict,
  guest_count int not null default 1 check (guest_count >= 1),
  customer_name text,
  customer_phone_e164 text,
  waiter_user_id uuid references auth.users (id),
  waiter_staff_id text,
  waiter_label text,
  status text not null default 'open'
    check (status in ('open', 'payment_pending', 'closed', 'cancelled', 'merged')),
  opened_at timestamptz not null default now (),
  closed_at timestamptz,
  opened_by uuid references auth.users (id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create unique index if not exists table_sessions_one_open_per_table
  on public.table_sessions (table_id)
  where status in ('open', 'payment_pending');

create table if not exists public.kitchen_tickets (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  table_session_id uuid not null references public.table_sessions (id) on delete cascade,
  sale_id uuid not null references public.sales (id) on delete cascade,
  station_id uuid not null references public.kitchen_stations (id) on delete restrict,
  ticket_number int not null default 1,
  status text not null default 'queued'
    check (status in ('queued', 'preparing', 'ready', 'served', 'cancelled')),
  fired_at timestamptz not null default now (),
  prepared_at timestamptz,
  served_at timestamptz,
  waiter_label text,
  table_label text,
  area_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create table if not exists public.kitchen_ticket_items (
  id uuid primary key default gen_random_uuid (),
  ticket_id uuid not null references public.kitchen_tickets (id) on delete cascade,
  sale_line_item_id uuid references public.sale_line_items (id) on delete set null,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  notes text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.table_session_events (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  session_id uuid references public.table_sessions (id) on delete set null,
  event_type text not null
    check (event_type in (
      'opened', 'closed', 'transferred', 'merged', 'split',
      'waiter_assigned', 'payment_pending', 'cancelled'
    )),
  actor_user_id uuid,
  actor_label text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now ()
);

-- FK from sales to table_sessions (added after table_sessions exists)
alter table public.sales drop constraint if exists sales_table_session_id_fkey;
alter table public.sales
  add constraint sales_table_session_id_fkey
  foreign key (table_session_id) references public.table_sessions (id) on delete set null;

create index if not exists dining_tables_shop_status_idx on public.dining_tables (shop_id, display_status);
create index if not exists table_sessions_shop_open_idx on public.table_sessions (shop_id, status)
  where status in ('open', 'payment_pending');
create index if not exists kitchen_tickets_station_status_idx on public.kitchen_tickets (station_id, status, fired_at desc);

-- updated_at triggers
drop trigger if exists trg_dining_areas_updated on public.dining_areas;
create trigger trg_dining_areas_updated
  before update on public.dining_areas
  for each row execute function public.set_updated_at ();

drop trigger if exists trg_dining_tables_updated on public.dining_tables;
create trigger trg_dining_tables_updated
  before update on public.dining_tables
  for each row execute function public.set_updated_at ();

drop trigger if exists trg_kitchen_stations_updated on public.kitchen_stations;
create trigger trg_kitchen_stations_updated
  before update on public.kitchen_stations
  for each row execute function public.set_updated_at ();

drop trigger if exists trg_table_sessions_updated on public.table_sessions;
create trigger trg_table_sessions_updated
  before update on public.table_sessions
  for each row execute function public.set_updated_at ();

drop trigger if exists trg_kitchen_tickets_updated on public.kitchen_tickets;
create trigger trg_kitchen_tickets_updated
  before update on public.kitchen_tickets
  for each row execute function public.set_updated_at ();

-- RLS
alter table public.dining_areas enable row level security;
alter table public.dining_tables enable row level security;
alter table public.kitchen_stations enable row level security;
alter table public.table_sessions enable row level security;
alter table public.kitchen_tickets enable row level security;
alter table public.kitchen_ticket_items enable row level security;
alter table public.table_session_events enable row level security;

drop policy if exists dining_areas_shop on public.dining_areas;
create policy dining_areas_shop on public.dining_areas
  for all using (public.user_can_access_shop (shop_id))
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists dining_tables_shop on public.dining_tables;
create policy dining_tables_shop on public.dining_tables
  for all using (public.user_can_access_shop (shop_id))
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists kitchen_stations_shop on public.kitchen_stations;
create policy kitchen_stations_shop on public.kitchen_stations
  for all using (public.user_can_access_shop (shop_id))
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists table_sessions_shop on public.table_sessions;
create policy table_sessions_shop on public.table_sessions
  for all using (public.user_can_access_shop (shop_id))
  with check (public.user_is_cashier_or_above (shop_id));

drop policy if exists kitchen_tickets_shop on public.kitchen_tickets;
create policy kitchen_tickets_shop on public.kitchen_tickets
  for all using (public.user_can_access_shop (shop_id))
  with check (public.user_is_cashier_or_above (shop_id));

drop policy if exists kitchen_ticket_items_shop on public.kitchen_ticket_items;
create policy kitchen_ticket_items_shop on public.kitchen_ticket_items
  for all using (
    exists (
      select 1 from public.kitchen_tickets kt
      where kt.id = kitchen_ticket_items.ticket_id
        and public.user_can_access_shop (kt.shop_id)
    )
  )
  with check (
    exists (
      select 1 from public.kitchen_tickets kt
      where kt.id = kitchen_ticket_items.ticket_id
        and public.user_is_cashier_or_above (kt.shop_id)
    )
  );

drop policy if exists table_session_events_shop on public.table_session_events;
create policy table_session_events_shop on public.table_session_events
  for all using (public.user_can_access_shop (shop_id))
  with check (public.user_is_cashier_or_above (shop_id));

comment on table public.dining_areas is 'Restaurant/bar floor zones (Main Hall, Veranda, VIP, etc.)';
comment on table public.table_sessions is 'Open table service session linked to a draft sale';

-- Waka POS — internal ops foundation: districts, internal staff, locations, support, field visits,
-- shop/subscription extensions. Builds on existing public.shops, public.subscriptions, public.audit_logs.

-- ---------- Reference: districts ----------
create table if not exists public.districts (
  id uuid primary key default gen_random_uuid (),
  code text not null unique,
  name text not null,
  region text,
  sort_order int not null default 0,
  created_at timestamptz not null default now ()
);

comment on table public.districts is 'Uganda-facing district list for shop grouping and admin assignment.';

insert into public.districts (code, name, region, sort_order)
values
  ('kampala', 'Kampala', 'Central', 10),
  ('nansana', 'Nansana', 'Central', 20),
  ('mukono', 'Mukono', 'Central', 30),
  ('entebbe', 'Entebbe', 'Central', 40),
  ('mbarara', 'Mbarara', 'Western', 50),
  ('gulu', 'Gulu', 'Northern', 60),
  ('jinja', 'Jinja', 'Eastern', 70),
  ('wakiso_other', 'Wakiso (other)', 'Central', 80),
  ('other', 'Other / not listed', null, 999)
on conflict (code) do nothing;

-- ---------- Internal Waka staff ----------
create table if not exists public.internal_admins (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  email text not null,
  role text not null
    check (
      role in (
        'super_admin',
        'finance_admin',
        'support_admin',
        'subscriptions_admin',
        'field_agent'
      )
    ),
  assigned_district_ids uuid[] not null default '{}'::uuid[],
  max_shops int,
  active boolean not null default true,
  created_at timestamptz not null default now (),
  constraint internal_admins_email_lower check (email = lower(email))
);

create index if not exists internal_admins_email_idx on public.internal_admins (email);
create index if not exists internal_admins_role_idx on public.internal_admins (role) where active;

comment on table public.internal_admins is 'Waka staff accounts; enforced by RLS + SECURITY DEFINER RPCs. Bootstrap first super via SQL (see supabase/README.md).';
comment on column public.internal_admins.assigned_district_ids is 'Subset of public.districts.id values this admin covers (esp. field_agent).';

-- ---------- Admin coverage (district and/or shop) ----------
create table if not exists public.admin_assignments (
  id uuid primary key default gen_random_uuid (),
  internal_admin_id uuid not null references public.internal_admins (id) on delete cascade,
  district_id uuid references public.districts (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete cascade,
  notes text,
  created_at timestamptz not null default now (),
  constraint admin_assignments_target_chk check (
    district_id is not null
    or shop_id is not null
  )
);

create index if not exists admin_assignments_admin_idx on public.admin_assignments (internal_admin_id);
create index if not exists admin_assignments_shop_idx on public.admin_assignments (shop_id);
create index if not exists admin_assignments_district_idx on public.admin_assignments (district_id);

-- ---------- Shop extensions (ops + GPS) ----------
alter table public.shops
  add column if not exists owner_user_id uuid references auth.users (id) on delete set null;

alter table public.shops
  add column if not exists district_id uuid references public.districts (id) on delete set null;

alter table public.shops
  add column if not exists area text;

alter table public.shops
  add column if not exists latitude double precision;

alter table public.shops
  add column if not exists longitude double precision;

alter table public.shops
  add column if not exists last_seen_at timestamptz;

alter table public.shops
  add column if not exists active_device_count int not null default 0 check (active_device_count >= 0);

alter table public.shops
  add column if not exists current_plan_code text;

alter table public.shops
  add column if not exists subscription_status text;

create index if not exists shops_district_id_idx on public.shops (district_id);
create index if not exists shops_last_seen_idx on public.shops (last_seen_at desc);

comment on column public.shops.area is 'Neighbourhood / parish / trading centre — finer than district.';
comment on column public.shops.latitude is 'Primary GPS pin for field visits; optional if owner skipped.';
comment on column public.shops.current_plan_code is 'Denormalized plan code for fast dashboards; subscription is source of truth.';

-- Backfill primary owner onto shop row (first shop_member owner).
update public.shops s
set owner_user_id = sm.user_id
from public.shop_members sm
where sm.shop_id = s.id
  and sm.role = 'owner'
  and s.owner_user_id is null;

-- ---------- Optional GPS history / multiple captures ----------
create table if not exists public.shop_locations (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  source text not null default 'device_gps',
  captured_at timestamptz not null default now (),
  is_primary boolean not null default false
);

create index if not exists shop_locations_shop_captured_idx on public.shop_locations (shop_id, captured_at desc);

-- ---------- Support tickets (lightweight; not a full CRM) ----------
create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid references public.shops (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete set null,
  opened_by_user_id uuid references auth.users (id) on delete set null,
  channel text not null default 'app' check (channel in ('app', 'whatsapp', 'email', 'phone', 'other')),
  subject text,
  body text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_internal_admin_id uuid references public.internal_admins (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create index if not exists support_requests_shop_idx on public.support_requests (shop_id);
create index if not exists support_requests_status_idx on public.support_requests (status);
create index if not exists support_requests_org_idx on public.support_requests (organization_id);

drop trigger if exists trg_support_requests_updated on public.support_requests;
create trigger trg_support_requests_updated
  before update on public.support_requests
  for each row execute function public.set_updated_at ();

-- ---------- Field visits ----------
create table if not exists public.field_visits (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  field_agent_internal_admin_id uuid not null references public.internal_admins (id) on delete cascade,
  visit_status text not null default 'planned' check (visit_status in ('planned', 'in_progress', 'completed', 'skipped')),
  scheduled_at timestamptz,
  completed_at timestamptz,
  notes text,
  photos_meta jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create index if not exists field_visits_shop_idx on public.field_visits (shop_id);
create index if not exists field_visits_agent_idx on public.field_visits (field_agent_internal_admin_id);

drop trigger if exists trg_field_visits_updated on public.field_visits;
create trigger trg_field_visits_updated
  before update on public.field_visits
  for each row execute function public.set_updated_at ();

-- ---------- Subscription extensions ----------
alter table public.subscriptions
  add column if not exists payment_status text not null default 'unknown'
    check (payment_status in ('unknown', 'unpaid', 'pending', 'paid', 'waived', 'failed'));

alter table public.subscriptions
  add column if not exists activation_source text;

alter table public.subscriptions
  add column if not exists activated_by uuid references auth.users (id) on delete set null;

comment on column public.subscriptions.activation_source is 'trial_auto, stripe, momo, manual_admin, …';
comment on column public.subscriptions.activated_by is 'Waka internal user who manually activated (when applicable).';

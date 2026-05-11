-- Waka POS — internal_admins schema normalization
-- Adds the columns requested for dynamic admin management UI.
-- We keep existing columns (user_id, assigned_district_ids, active, created_at) for backward compatibility.

alter table public.internal_admins
  add column if not exists auth_user_id uuid references auth.users (id) on delete cascade;

alter table public.internal_admins
  add column if not exists full_name text;

alter table public.internal_admins
  add column if not exists assigned_districts uuid[] not null default '{}'::uuid[];

alter table public.internal_admins
  add column if not exists is_active boolean not null default true;

alter table public.internal_admins
  add column if not exists created_by uuid references auth.users (id) on delete set null;

alter table public.internal_admins
  add column if not exists updated_at timestamptz not null default now();

-- Backfill new columns from the existing ones.
update public.internal_admins
set
  auth_user_id = user_id
where auth_user_id is null;

update public.internal_admins
set
  assigned_districts = assigned_district_ids
where assigned_districts = '{}'::uuid[];

update public.internal_admins
set
  is_active = active
where is_active is distinct from active;

-- Enforce uniqueness for auth_user_id to match the spec.
alter table public.internal_admins
  alter column auth_user_id set not null;

alter table public.internal_admins
  add constraint internal_admins_auth_user_unique unique (auth_user_id);

-- Replace role check with the requested role options (+ keep legacy roles).
alter table public.internal_admins
  drop constraint if exists internal_admins_role_check;

alter table public.internal_admins
  add constraint internal_admins_role_check check (
    role in (
      'super_admin',
      'operations_admin',
      'support_admin',
      'field_agent',
      -- legacy values kept for backward compatibility
      'finance_admin',
      'subscriptions_admin'
    )
  );

-- updated_at trigger
drop trigger if exists trg_internal_admins_updated on public.internal_admins;
create trigger trg_internal_admins_updated
  before update on public.internal_admins
  for each row execute function public.set_updated_at ();

comment on table public.internal_admins is
  'Waka staff accounts (dynamic admin management). Super admin is seeded automatically for the first Kasule email.';

comment on column public.internal_admins.auth_user_id is 'Auth user id for this internal admin.';
comment on column public.internal_admins.assigned_districts is 'District ids this admin covers (uuid[]).';
comment on column public.internal_admins.is_active is 'Whether this admin can access internal tooling.';


-- STAFF-V2-PHASE-2: unused Auth UUID foothold.
-- Adds nullable link columns only. Does not change created_by, PIN login,
-- shop_members, invitations, RLS, RPCs, or sales sync behavior.
-- Clients must not write these columns until a later approved phase.

alter table public.shop_pos_staff
  add column if not exists user_id uuid references auth.users (id) on delete set null;

comment on column public.shop_pos_staff.user_id is
  'STAFF-V2 foothold. Nullable Auth user for a PIN staff profile. Unused in Phase 2. Not a unique identity yet.';

create index if not exists shop_pos_staff_user_id_idx
  on public.shop_pos_staff (user_id)
  where user_id is not null;

alter table public.sales
  add column if not exists sold_by_user_id uuid references auth.users (id) on delete set null;

comment on column public.sales.sold_by_user_id is
  'STAFF-V2 foothold. Commercial seller Auth UUID. Distinct from created_by (cloud writer). Unused in Phase 2.';

create index if not exists sales_sold_by_user_id_idx
  on public.sales (shop_id, sold_by_user_id)
  where sold_by_user_id is not null;

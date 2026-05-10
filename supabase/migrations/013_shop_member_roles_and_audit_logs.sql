-- Extend shop POS roles and add optional server-side audit mirror (sync can insert later).

alter table public.shop_members
  drop constraint if exists shop_members_role_check;

alter table public.shop_members
  add constraint shop_members_role_check
    check (role in ('owner', 'manager', 'cashier', 'stock_keeper', 'viewer'));

comment on column public.shop_members.role is
  'POS role: owner, manager, cashier, stock_keeper, or legacy viewer (read-heavy). Client maps viewer → stock_keeper where needed.';

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid references public.shops (id) on delete set null,
  actor_user_id uuid references auth.users (id) on delete set null,
  role text,
  action text not null,
  payload_summary text,
  payload jsonb not null default '{}'::jsonb,
  device_id text,
  client_entry_id uuid,
  created_at timestamptz not null default now ()
);

create index if not exists audit_logs_shop_created_idx on public.audit_logs (shop_id, created_at desc);
create index if not exists audit_logs_actor_created_idx on public.audit_logs (actor_user_id, created_at desc);

comment on table public.audit_logs is
  'Append-only audit trail; client queues rows via sync when wired. RLS policies can be added per shop.';

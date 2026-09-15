-- Historical financial correction infrastructure — schema (Phase 1).
-- Adds per-row financial revision counters (stale-push / snapshot-certification guard)
-- and an append-only correction ledger. Purely additive: safe defaults, no data changes,
-- no existing column/table altered or dropped.

alter table public.sale_line_items
  add column if not exists financial_revision bigint not null default 0;

alter table public.sales
  add column if not exists financial_revision bigint not null default 0;

create table if not exists public.sale_line_item_corrections (
  id uuid primary key default gen_random_uuid (),
  sale_id uuid not null references public.sales (id),
  sale_line_item_id uuid not null references public.sale_line_items (id),
  shop_id uuid not null references public.shops (id),
  product_id uuid not null references public.products (id),
  before jsonb not null,
  after jsonb not null,
  correction_basis jsonb not null,
  reason text not null check (char_length (btrim (reason)) >= 3),
  corrected_by uuid not null references auth.users (id),
  corrected_role text not null check (corrected_role in ('super_admin', 'finance_admin')),
  resulting_revision bigint not null,
  created_at timestamptz not null default now (),
  superseded_at timestamptz,
  superseded_by uuid references public.sale_line_item_corrections (id)
);

comment on table public.sale_line_item_corrections is
  'Append-only ledger of admin-applied historical COGS/profit corrections. Never updated or deleted directly — write path is exclusively shop_correct_sale_line_financials (security definer). A correction is reversed by inserting a new correction row, never by editing/removing this one.';

-- At most one ACTIVE (non-superseded) correction per line at any time; unlimited history
-- via the superseded_at/superseded_by chain. Mirrors the proven shop_day_closes pattern
-- (migration 150_one_active_day_close_per_shop_date.sql).
create unique index if not exists sale_line_item_corrections_one_active_per_line
  on public.sale_line_item_corrections (sale_line_item_id)
  where superseded_at is null;

create index if not exists sale_line_item_corrections_sale_id_idx
  on public.sale_line_item_corrections (sale_id);

create index if not exists sale_line_item_corrections_shop_id_idx
  on public.sale_line_item_corrections (shop_id);

alter table public.sale_line_item_corrections enable row level security;

-- Read-only for internal finance/super admins. No insert/update/delete policy is defined
-- for any role — RLS default-denies any command without a matching policy, so ordinary
-- authenticated users (including shop owners/managers) cannot write this table directly
-- under any circumstance. The only write path is shop_correct_sale_line_financials
-- (security definer, bypasses RLS entirely, defined in a later migration).
drop policy if exists sale_line_item_corrections_select on public.sale_line_item_corrections;
create policy sale_line_item_corrections_select
  on public.sale_line_item_corrections for select
  using (
    public.is_waka_internal_role (array['super_admin', 'finance_admin'])
  );

-- Explicit belt-and-suspenders: strip the blanket authenticated grant (from migration
-- 010_grants.sql's ALTER DEFAULT PRIVILEGES) down to select-only for this table. RLS
-- alone already blocks writes, but this makes the "no direct write access" guarantee
-- true at the grant level too, not just the policy level.
revoke insert, update, delete on public.sale_line_item_corrections from authenticated;
grant select on public.sale_line_item_corrections to authenticated;

-- RECONCILIATION BACKFILL — this migration was applied directly to production
-- on 2026-09-14 (recorded version 20260914220003) without ever being committed
-- to this repository. Discovered during the WAKA POS financial certification
-- audit (P1#3 — migration drift). Reproduced here VERBATIM from
-- supabase_migrations.schema_migrations.statements for that version — no
-- content has been altered. This is the schema this repo's migration 192
-- (historical_financial_correction_platform_functions) already assumes
-- exists: sale_line_item_corrections plus the financial_revision columns on
-- sales/sale_line_items. This file intentionally reproduces the exact
-- production version identifier as its filename prefix so tooling recognizes
-- it as already applied; it must NOT be re-applied.

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

create unique index if not exists sale_line_item_corrections_one_active_per_line
  on public.sale_line_item_corrections (sale_line_item_id)
  where superseded_at is null;

create index if not exists sale_line_item_corrections_sale_id_idx
  on public.sale_line_item_corrections (sale_id);

create index if not exists sale_line_item_corrections_shop_id_idx
  on public.sale_line_item_corrections (shop_id);

alter table public.sale_line_item_corrections enable row level security;

drop policy if exists sale_line_item_corrections_select on public.sale_line_item_corrections;
create policy sale_line_item_corrections_select
  on public.sale_line_item_corrections for select
  using (
    public.is_waka_internal_role (array['super_admin', 'finance_admin'])
  );

revoke insert, update, delete on public.sale_line_item_corrections from authenticated;
grant select on public.sale_line_item_corrections to authenticated;

-- Shop purchases & suppliers: durable restock history for multi-device recovery.

create table if not exists public.shop_suppliers (
  id uuid primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  phone text not null default '',
  location text not null default '',
  notes text not null default '',
  balance_owed_ugx bigint not null default 0,
  total_purchases_ugx bigint not null default 0,
  last_supply_at timestamptz,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists shop_suppliers_shop_updated_idx
  on public.shop_suppliers (shop_id, updated_at desc);

drop trigger if exists trg_shop_suppliers_updated on public.shop_suppliers;
create trigger trg_shop_suppliers_updated
  before update on public.shop_suppliers
  for each row execute function public.set_updated_at ();

create table if not exists public.shop_purchases (
  id uuid primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  supplier_id uuid not null,
  supplier_name text not null default '',
  total_cost_ugx bigint not null check (total_cost_ugx >= 0),
  amount_paid_ugx bigint not null check (amount_paid_ugx >= 0),
  balance_delta_ugx bigint not null default 0,
  notes text not null default '',
  lines jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists shop_purchases_shop_created_idx
  on public.shop_purchases (shop_id, created_at desc);

create index if not exists shop_purchases_shop_updated_idx
  on public.shop_purchases (shop_id, updated_at desc);

create index if not exists shop_purchases_supplier_idx
  on public.shop_purchases (shop_id, supplier_id);

drop trigger if exists trg_shop_purchases_updated on public.shop_purchases;
create trigger trg_shop_purchases_updated
  before update on public.shop_purchases
  for each row execute function public.set_updated_at ();

create table if not exists public.shop_supplier_payments (
  id uuid primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  supplier_id uuid not null,
  amount_ugx bigint not null check (amount_ugx > 0),
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists shop_supplier_payments_shop_updated_idx
  on public.shop_supplier_payments (shop_id, updated_at desc);

drop trigger if exists trg_shop_supplier_payments_updated on public.shop_supplier_payments;
create trigger trg_shop_supplier_payments_updated
  before update on public.shop_supplier_payments
  for each row execute function public.set_updated_at ();

alter table public.shop_suppliers enable row level security;
alter table public.shop_purchases enable row level security;
alter table public.shop_supplier_payments enable row level security;

drop policy if exists shop_suppliers_select on public.shop_suppliers;
create policy shop_suppliers_select
  on public.shop_suppliers for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists shop_suppliers_write on public.shop_suppliers;
create policy shop_suppliers_write
  on public.shop_suppliers for all
  using (public.user_is_cashier_or_above (shop_id))
  with check (public.user_is_cashier_or_above (shop_id));

drop policy if exists shop_purchases_select on public.shop_purchases;
create policy shop_purchases_select
  on public.shop_purchases for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists shop_purchases_write on public.shop_purchases;
create policy shop_purchases_write
  on public.shop_purchases for all
  using (public.user_is_cashier_or_above (shop_id))
  with check (public.user_is_cashier_or_above (shop_id));

drop policy if exists shop_supplier_payments_select on public.shop_supplier_payments;
create policy shop_supplier_payments_select
  on public.shop_supplier_payments for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists shop_supplier_payments_write on public.shop_supplier_payments;
create policy shop_supplier_payments_write
  on public.shop_supplier_payments for all
  using (public.user_is_cashier_or_above (shop_id))
  with check (public.user_is_cashier_or_above (shop_id));

-- ---------- Push purchase (idempotent) ----------
create or replace function public.shop_push_purchase (
  p_shop_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_id uuid;
  v_lines jsonb;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_required');
  end if;
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif (p_payload ->> 'id', '')::uuid;
  if v_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;

  v_lines := coalesce (p_payload -> 'lines', '[]'::jsonb);
  if jsonb_typeof (v_lines) <> 'array' then
    v_lines := '[]'::jsonb;
  end if;

  insert into public.shop_purchases (
    id,
    shop_id,
    supplier_id,
    supplier_name,
    total_cost_ugx,
    amount_paid_ugx,
    balance_delta_ugx,
    notes,
    lines,
    created_at,
    metadata
  )
  values (
    v_id,
    p_shop_id,
    coalesce (nullif (p_payload ->> 'supplier_id', '')::uuid, gen_random_uuid ()),
    coalesce (nullif (trim (p_payload ->> 'supplier_name'), ''), 'Supplier'),
    coalesce ((p_payload ->> 'total_cost_ugx')::bigint, 0),
    coalesce ((p_payload ->> 'amount_paid_ugx')::bigint, 0),
    coalesce ((p_payload ->> 'balance_delta_ugx')::bigint, 0),
    coalesce (nullif (trim (p_payload ->> 'notes'), ''), ''),
    v_lines,
    coalesce ((p_payload ->> 'created_at')::timestamptz, now ()),
    coalesce (p_payload -> 'metadata', '{}'::jsonb)
  )
  on conflict (id) do update set
    supplier_id = excluded.supplier_id,
    supplier_name = excluded.supplier_name,
    total_cost_ugx = excluded.total_cost_ugx,
    amount_paid_ugx = excluded.amount_paid_ugx,
    balance_delta_ugx = excluded.balance_delta_ugx,
    notes = excluded.notes,
    lines = excluded.lines,
    metadata = excluded.metadata,
    updated_at = now ();

  return jsonb_build_object ('ok', true, 'purchase_id', v_id);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_push_purchase (uuid, jsonb) from public;
grant execute on function public.shop_push_purchase (uuid, jsonb) to authenticated;

-- ---------- Push supplier master row (idempotent) ----------
create or replace function public.shop_push_supplier (
  p_shop_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif (p_payload ->> 'id', '')::uuid;
  if v_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;

  insert into public.shop_suppliers (
    id,
    shop_id,
    name,
    phone,
    location,
    notes,
    balance_owed_ugx,
    total_purchases_ugx,
    last_supply_at,
    created_at,
    metadata
  )
  values (
    v_id,
    p_shop_id,
    coalesce (nullif (trim (p_payload ->> 'name'), ''), 'Supplier'),
    coalesce (nullif (trim (p_payload ->> 'phone'), ''), ''),
    coalesce (nullif (trim (p_payload ->> 'location'), ''), ''),
    coalesce (nullif (trim (p_payload ->> 'notes'), ''), ''),
    coalesce ((p_payload ->> 'balance_owed_ugx')::bigint, 0),
    coalesce ((p_payload ->> 'total_purchases_ugx')::bigint, 0),
    nullif (p_payload ->> 'last_supply_at', '')::timestamptz,
    coalesce ((p_payload ->> 'created_at')::timestamptz, now ()),
    coalesce (p_payload -> 'metadata', '{}'::jsonb)
  )
  on conflict (id) do update set
    name = excluded.name,
    phone = excluded.phone,
    location = excluded.location,
    notes = excluded.notes,
    balance_owed_ugx = excluded.balance_owed_ugx,
    total_purchases_ugx = excluded.total_purchases_ugx,
    last_supply_at = excluded.last_supply_at,
    metadata = excluded.metadata,
    updated_at = now ();

  return jsonb_build_object ('ok', true, 'supplier_id', v_id);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_push_supplier (uuid, jsonb) from public;
grant execute on function public.shop_push_supplier (uuid, jsonb) to authenticated;

-- ---------- Push supplier payment (idempotent) ----------
create or replace function public.shop_push_supplier_payment (
  p_shop_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif (p_payload ->> 'id', '')::uuid;
  if v_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;

  insert into public.shop_supplier_payments (
    id,
    shop_id,
    supplier_id,
    amount_ugx,
    created_at,
    metadata
  )
  values (
    v_id,
    p_shop_id,
    nullif (p_payload ->> 'supplier_id', '')::uuid,
    coalesce ((p_payload ->> 'amount_ugx')::bigint, 0),
    coalesce ((p_payload ->> 'created_at')::timestamptz, now ()),
    coalesce (p_payload -> 'metadata', '{}'::jsonb)
  )
  on conflict (id) do update set
    supplier_id = excluded.supplier_id,
    amount_ugx = excluded.amount_ugx,
    metadata = excluded.metadata,
    updated_at = now ();

  return jsonb_build_object ('ok', true, 'payment_id', v_id);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_push_supplier_payment (uuid, jsonb) from public;
grant execute on function public.shop_push_supplier_payment (uuid, jsonb) to authenticated;

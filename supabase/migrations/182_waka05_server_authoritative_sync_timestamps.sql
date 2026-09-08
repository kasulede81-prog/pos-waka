-- WAKA-05 — server-authoritative sync timestamps.
--
-- Pull cursors are compared against server column values, so those columns must
-- be stamped by the server. Where the client's own clock carries business
-- meaning (which trading day a payment belongs to) it is preserved in a
-- separate column rather than reused as a sync cursor.
--
-- Two write paths were letting a client clock decide a cursor value:
--
--   1. `shop_push_debt_payment` stored `customer_debt_payments.created_at`
--      straight from the client payload (migration 174, line 30). That column is
--      the debt-payment pull cursor (`.gt("created_at", …)`). A device with a
--      slow clock therefore wrote rows that already sat behind other devices'
--      cursors and were never delivered — which is the input to the
--      ledger-authoritative debt recompute and the re-billing path.
--
--   2. `public.customers` had a BEFORE UPDATE trigger stamping `updated_at`, but
--      no BEFORE INSERT one, so a client-supplied `updated_at` survived on the
--      insert half of the client's `.upsert()`.

-- 1 · Preserve the client-recorded time for business-date purposes.
alter table public.customer_debt_payments
  add column if not exists client_created_at timestamptz;

comment on column public.customer_debt_payments.client_created_at is
  'Client-recorded payment time. Business-date/trading-day source only. Never a sync cursor — use created_at (server-stamped) for that.';

-- Existing rows carry the client value in created_at; keep it addressable.
update public.customer_debt_payments
set client_created_at = created_at
where client_created_at is null;

-- The pull cursor orders and filters on this column.
create index if not exists customer_debt_payments_shop_created_idx
  on public.customer_debt_payments (shop_id, created_at);

-- 2 · Server stamps created_at; the client value goes to client_created_at.
create or replace function public.shop_push_debt_payment (
  p_shop_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_payment_id uuid;
  v_customer_id uuid;
  v_amount bigint;
  v_client_created_at timestamptz;
  v_current_balance bigint;
  v_new_balance bigint;
  v_existing_shop uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_is_cashier_or_above(p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_payment_id := nullif(p_payload ->> 'payment_id', '')::uuid;
  v_customer_id := nullif(p_payload ->> 'customer_id', '')::uuid;
  v_amount := coalesce((p_payload ->> 'amount_ugx')::bigint, 0);
  -- WAKA-05: retained for business-date reporting only. It must never reach
  -- created_at, which the incremental pull uses as its cursor.
  v_client_created_at := coalesce(nullif(p_payload ->> 'created_at', '')::timestamptz, now());

  if v_payment_id is null or v_customer_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;
  if v_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  -- Lock authoritative customer for this shop first (transactional apply point).
  select greatest(coalesce((c.metadata ->> 'debtBalanceUgx')::bigint, 0), 0)
  into v_current_balance
  from public.customers c
  where c.id = v_customer_id and c.shop_id = p_shop_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'customer_not_found');
  end if;

  -- Same payment ID → idempotent success; do not mutate balance again.
  if exists (
    select 1
    from public.customer_debt_payments dp
    where dp.id = v_payment_id and dp.shop_id = p_shop_id
  ) then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'payment_id', v_payment_id,
      'new_balance_ugx', v_current_balance
    );
  end if;

  if v_amount > v_current_balance then
    return jsonb_build_object(
      'ok', false,
      'error', 'amount_exceeds_balance',
      'server_balance_ugx', v_current_balance
    );
  end if;

  v_new_balance := v_current_balance - v_amount;

  insert into public.customer_debt_payments (
    id, shop_id, customer_id, amount_ugx, created_at, client_created_at, metadata
  )
  values (
    v_payment_id,
    p_shop_id,
    v_customer_id,
    v_amount,
    now(),
    v_client_created_at,
    coalesce(p_payload -> 'metadata', '{}'::jsonb)
  );

  update public.customers c
  set metadata = jsonb_set(
        coalesce(c.metadata, '{}'::jsonb),
        '{debtBalanceUgx}',
        to_jsonb(v_new_balance),
        true
      ),
      updated_at = now()
  where c.id = v_customer_id and c.shop_id = p_shop_id;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'new_balance_ugx', v_new_balance,
    'payment_id', v_payment_id
  );
exception
  when unique_violation then
    select dp.shop_id into v_existing_shop
    from public.customer_debt_payments dp
    where dp.id = v_payment_id;

    if v_existing_shop is not null and v_existing_shop = p_shop_id then
      select greatest(coalesce((c.metadata ->> 'debtBalanceUgx')::bigint, 0), 0)
      into v_current_balance
      from public.customers c
      where c.id = v_customer_id and c.shop_id = p_shop_id;

      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'payment_id', v_payment_id,
        'new_balance_ugx', coalesce(v_current_balance, 0)
      );
    end if;

    return jsonb_build_object('ok', false, 'error', 'payment_id_conflict');
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_push_debt_payment (uuid, jsonb) from public;
grant execute on function public.shop_push_debt_payment (uuid, jsonb) to authenticated;

-- 3 · customers.updated_at is the customers pull cursor — the server stamps it
-- on INSERT as well as UPDATE, so a client `.upsert()` cannot set it.
drop trigger if exists trg_customers_updated on public.customers;

create trigger trg_customers_updated
  before insert or update on public.customers
  for each row execute function public.set_updated_at ();

-- 4 · One server clock for bootstrap / full-sync checkpoint seeding.
-- Incremental cursors compare against server timestamps. Seeding them from the
-- client clock after a successful full pull recreates WAKA-05: a fast device
-- writes every cursor into the server's future and then skips every row
-- stamped in the gap.
create or replace function public.shop_server_now ()
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid () is null then
    return null;
  end if;
  return now ();
end;
$$;

revoke all on function public.shop_server_now () from public;
grant execute on function public.shop_server_now () to authenticated;

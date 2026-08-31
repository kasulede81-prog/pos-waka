-- DEBT-PAYMENT-CONCURRENCY-1.0
-- Durable debt payment identity = customer_debt_payments.id (already PK).
-- Concurrency authority: lock customer row, then apply-or-idempotent by payment id.
-- Remove expected_balance hard-fail (it blocked legitimate concurrent different payment IDs).

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
  v_created_at timestamptz;
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
  v_created_at := coalesce(nullif(p_payload ->> 'created_at', '')::timestamptz, now());

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

  insert into public.customer_debt_payments (id, shop_id, customer_id, amount_ugx, created_at, metadata)
  values (
    v_payment_id,
    p_shop_id,
    v_customer_id,
    v_amount,
    v_created_at,
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

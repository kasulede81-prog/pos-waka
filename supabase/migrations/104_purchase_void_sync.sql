-- Purchase void cloud sync — voided_at / void_reason columns + idempotent void push.

alter table public.shop_purchases
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;

create index if not exists shop_purchases_shop_voided_idx
  on public.shop_purchases (shop_id, voided_at desc nulls last);

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
  v_voided_at timestamptz;
  v_void_reason text;
  v_existing_voided_at timestamptz;
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

  v_voided_at := nullif (p_payload ->> 'voided_at', '')::timestamptz;
  if v_voided_at is null then
    v_voided_at := nullif (p_payload ->> 'voidedAt', '')::timestamptz;
  end if;
  v_void_reason := nullif (trim (coalesce (p_payload ->> 'void_reason', p_payload ->> 'voidReason', '')), '');

  select voided_at into v_existing_voided_at
  from public.shop_purchases
  where id = v_id and shop_id = p_shop_id;

  if v_existing_voided_at is not null and v_voided_at is not null and v_voided_at <> v_existing_voided_at then
    return jsonb_build_object ('ok', true, 'purchase_id', v_id, 'idempotent_void', true);
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
    voided_at,
    void_reason,
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
    v_voided_at,
    v_void_reason,
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
    voided_at = coalesce (public.shop_purchases.voided_at, excluded.voided_at),
    void_reason = case
      when public.shop_purchases.voided_at is not null then public.shop_purchases.void_reason
      else excluded.void_reason
    end,
    updated_at = now ();

  return jsonb_build_object ('ok', true, 'purchase_id', v_id);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_push_purchase (uuid, jsonb) from public;
grant execute on function public.shop_push_purchase (uuid, jsonb) to authenticated;

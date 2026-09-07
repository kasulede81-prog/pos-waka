-- SALES-MULTI-01: persist completed-sale void financials so Device B can
-- reconstruct the same header Device A applied locally.
-- Does NOT mutate sales.total_ugx / cash / debt (SL-03 + server reports
-- still subtract sale_returns from the original completed header).

create table if not exists public.sale_voids (
  id uuid primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  sale_id uuid not null,
  product_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  amount_ugx bigint not null check (amount_ugx > 0),
  line_index int not null default 0,
  note text,
  sale_voided_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists sale_voids_shop_updated_idx
  on public.sale_voids (shop_id, updated_at desc);

create index if not exists sale_voids_sale_idx
  on public.sale_voids (sale_id);

drop trigger if exists trg_sale_voids_updated on public.sale_voids;
create trigger trg_sale_voids_updated
  before update on public.sale_voids
  for each row execute function public.set_updated_at ();

alter table public.sale_voids enable row level security;

drop policy if exists sale_voids_select on public.sale_voids;
create policy sale_voids_select
  on public.sale_voids for select
  using (public.user_can_access_shop (shop_id));

-- Writes go through shop_apply_sale_void_stock (security definer).

create or replace function public.shop_apply_sale_void_stock (
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
  v_product_id uuid;
  v_void_record_id uuid;
  v_delta numeric;
  v_note text;
  v_product_shop uuid;
  v_sale_id uuid;
  v_amount bigint;
  v_line_index int;
  v_sale_voided_at timestamptz;
  v_already boolean := false;
  v_sale_shop uuid;
  v_sale_created timestamptz;
  v_date_key text;
  v_guard jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_product_id := nullif(p_payload ->> 'product_id', '')::uuid;
  v_void_record_id := nullif(
    coalesce(p_payload ->> 'void_record_id', p_payload ->> 'reference_id'),
    ''
  )::uuid;
  v_delta := coalesce((p_payload ->> 'delta')::numeric, 0);
  v_note := nullif(p_payload ->> 'note', '');
  v_sale_id := nullif(p_payload ->> 'sale_id', '')::uuid;
  v_amount := coalesce((p_payload ->> 'amount_ugx')::bigint, 0);
  v_line_index := coalesce((p_payload ->> 'line_index')::int, 0);
  v_sale_voided_at := nullif(p_payload ->> 'sale_voided_at', '')::timestamptz;

  if v_product_id is null or v_void_record_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;

  if v_delta <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_delta');
  end if;

  select p.shop_id into v_product_shop
  from public.products p
  where p.id = v_product_id and p.is_active = true;

  if v_product_shop is null then
    return jsonb_build_object('ok', false, 'error', 'product_not_found');
  end if;

  if p_shop_id is not null and p_shop_id is distinct from v_product_shop then
    return jsonb_build_object('ok', false, 'error', 'shop_mismatch');
  end if;

  if not public.user_is_cashier_or_above(v_product_shop) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_sale_id is not null and v_amount > 0 then
    select s.shop_id, coalesce(s.created_at, s.completed_at, now())
    into v_sale_shop, v_sale_created
    from public.sales s
    where s.id = v_sale_id;

    if v_sale_shop is null then
      return jsonb_build_object('ok', false, 'error', 'sale_not_found');
    end if;

    if v_sale_shop is distinct from v_product_shop then
      return jsonb_build_object('ok', false, 'error', 'shop_mismatch');
    end if;

    select exists (
      select 1 from public.sale_voids sv where sv.id = v_void_record_id
    ) into v_already;

    if not v_already then
      if to_regprocedure('public.assert_shop_business_date_open(uuid, text)') is not null
         and to_regprocedure('public._sale_kampala_day(timestamptz)') is not null then
        v_date_key := to_char(public._sale_kampala_day(v_sale_created), 'YYYY-MM-DD');
        v_guard := public.assert_shop_business_date_open(v_product_shop, v_date_key);
        if coalesce((v_guard ->> 'ok')::boolean, false) is not true then
          return jsonb_build_object('ok', false, 'error', 'closed_business_date');
        end if;
      end if;

      insert into public.sale_voids (
        id,
        shop_id,
        sale_id,
        product_id,
        quantity,
        amount_ugx,
        line_index,
        note,
        sale_voided_at,
        created_by,
        created_at,
        metadata
      )
      values (
        v_void_record_id,
        v_product_shop,
        v_sale_id,
        v_product_id,
        v_delta,
        v_amount,
        greatest(v_line_index, 0),
        v_note,
        v_sale_voided_at,
        v_uid,
        coalesce((p_payload ->> 'created_at')::timestamptz, now()),
        jsonb_build_object(
          'productName', coalesce(p_payload ->> 'product_name', ''),
          'lineIndex', greatest(v_line_index, 0)
        )
      )
      on conflict (id) do nothing;
    end if;
  end if;

  return public._apply_durable_stock_delta (
    v_product_shop,
    v_product_id,
    'sale_void',
    v_void_record_id,
    v_delta,
    'void',
    coalesce(v_note, 'sale_void')
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_apply_sale_void_stock (uuid, jsonb) from public;
grant execute on function public.shop_apply_sale_void_stock (uuid, jsonb) to authenticated;

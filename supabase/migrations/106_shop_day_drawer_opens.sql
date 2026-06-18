-- Day drawer open — cloud-authoritative opening float per shop/day (formula v2).

create table if not exists public.shop_day_drawer_opens (
  id uuid primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  date_key text not null,
  opening_float_ugx bigint not null check (opening_float_ugx > 0),
  status text not null check (status in ('open', 'superseded', 'voided')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null,
  superseded_at timestamptz,
  voided_at timestamptz,
  counted_at timestamptz not null default now(),
  counted_by_label text,
  note text not null default '',
  void_reason text,
  supersedes_id uuid references public.shop_day_drawer_opens (id),
  device_id text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists shop_day_drawer_opens_shop_date_idx
  on public.shop_day_drawer_opens (shop_id, date_key);

create unique index if not exists shop_day_drawer_opens_one_active_per_day
  on public.shop_day_drawer_opens (shop_id, date_key)
  where status = 'open';

alter table public.shop_day_drawer_opens enable row level security;

drop policy if exists shop_day_drawer_opens_select on public.shop_day_drawer_opens;
create policy shop_day_drawer_opens_select
  on public.shop_day_drawer_opens for select
  using (public.user_is_cashier_or_above (shop_id));

drop policy if exists shop_day_drawer_opens_insert on public.shop_day_drawer_opens;
create policy shop_day_drawer_opens_insert
  on public.shop_day_drawer_opens for insert
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists shop_day_drawer_opens_update on public.shop_day_drawer_opens;
create policy shop_day_drawer_opens_update
  on public.shop_day_drawer_opens for update
  using (public.user_can_manage_shop (shop_id));

-- Completed revenue sales on a Kampala calendar day (blocks supersede/void).
create or replace function public._shop_completed_sales_count_for_day (
  p_shop_id uuid,
  p_date_key text
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::bigint
  from public.sales s
  where s.shop_id = p_shop_id
    and s.status = 'completed'
    and to_char((s.created_at at time zone 'Africa/Kampala'), 'YYYY-MM-DD') = p_date_key;
$$;

create or replace function public.shop_create_day_drawer_open (
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
  v_date_key text;
  v_amount bigint;
  v_existing uuid;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_required');
  end if;
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif (p_payload ->> 'id', '')::uuid;
  v_date_key := nullif (trim (p_payload ->> 'date_key'), '');
  v_amount := coalesce ((p_payload ->> 'opening_float_ugx')::bigint, 0);

  if v_id is null or v_date_key is null or v_amount <= 0 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;

  select d.id into v_existing
  from public.shop_day_drawer_opens d
  where d.shop_id = p_shop_id
    and d.date_key = v_date_key
    and d.status = 'open'
    and d.id <> v_id
  limit 1;

  if v_existing is not null then
    return jsonb_build_object ('ok', false, 'error', 'dayDrawerAlreadyOpen', 'existing_id', v_existing);
  end if;

  insert into public.shop_day_drawer_opens (
    id,
    shop_id,
    date_key,
    opening_float_ugx,
    status,
    created_at,
    updated_at,
    created_by,
    counted_at,
    counted_by_label,
    note,
    device_id,
    metadata
  )
  values (
    v_id,
    p_shop_id,
    v_date_key,
    v_amount,
    'open',
    coalesce (nullif (p_payload ->> 'created_at', '')::timestamptz, now ()),
    now (),
    coalesce (nullif (trim (p_payload ->> 'created_by'), ''), v_uid::text),
    coalesce (nullif (p_payload ->> 'counted_at', '')::timestamptz, now ()),
    nullif (trim (p_payload ->> 'counted_by_label'), ''),
    coalesce (nullif (trim (p_payload ->> 'note'), ''), ''),
    nullif (trim (p_payload ->> 'device_id'), ''),
    coalesce (p_payload -> 'metadata', '{}'::jsonb)
  )
  on conflict (id) do update
  set
    opening_float_ugx = excluded.opening_float_ugx,
    date_key = excluded.date_key,
    status = case
      when public.shop_day_drawer_opens.status = 'voided' then public.shop_day_drawer_opens.status
      else excluded.status
    end,
    counted_at = excluded.counted_at,
    counted_by_label = excluded.counted_by_label,
    note = excluded.note,
    device_id = excluded.device_id,
    metadata = excluded.metadata,
    updated_at = now ()
  where public.shop_day_drawer_opens.status <> 'voided';

  return jsonb_build_object ('ok', true, 'id', v_id);
exception
  when unique_violation then
    return jsonb_build_object ('ok', false, 'error', 'dayDrawerAlreadyOpen');
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

create or replace function public.shop_supersede_day_drawer_open (
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
  v_prev_id uuid;
  v_date_key text;
  v_amount bigint;
  v_sales bigint;
  v_now timestamptz := now ();
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif (p_payload ->> 'id', '')::uuid;
  v_prev_id := nullif (p_payload ->> 'previous_id', '')::uuid;
  v_date_key := nullif (trim (p_payload ->> 'date_key'), '');
  v_amount := coalesce ((p_payload ->> 'opening_float_ugx')::bigint, 0);

  if v_id is null or v_prev_id is null or v_date_key is null or v_amount <= 0 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;

  v_sales := public._shop_completed_sales_count_for_day (p_shop_id, v_date_key);
  if v_sales > 0 then
    return jsonb_build_object ('ok', false, 'error', 'dayDrawerLockedAfterSales');
  end if;

  update public.shop_day_drawer_opens
  set status = 'superseded', superseded_at = v_now, updated_at = v_now
  where id = v_prev_id
    and shop_id = p_shop_id
    and status = 'open';

  insert into public.shop_day_drawer_opens (
    id,
    shop_id,
    date_key,
    opening_float_ugx,
    status,
    created_at,
    updated_at,
    created_by,
    counted_at,
    counted_by_label,
    note,
    supersedes_id,
    device_id,
    metadata
  )
  values (
    v_id,
    p_shop_id,
    v_date_key,
    v_amount,
    'open',
    coalesce (nullif (p_payload ->> 'created_at', '')::timestamptz, v_now),
    v_now,
    coalesce (nullif (trim (p_payload ->> 'created_by'), ''), v_uid::text),
    coalesce (nullif (p_payload ->> 'counted_at', '')::timestamptz, v_now),
    nullif (trim (p_payload ->> 'counted_by_label'), ''),
    coalesce (nullif (trim (p_payload ->> 'note'), ''), ''),
    v_prev_id,
    nullif (trim (p_payload ->> 'device_id'), ''),
    coalesce (p_payload -> 'metadata', '{}'::jsonb)
  )
  on conflict (id) do update
  set
    opening_float_ugx = excluded.opening_float_ugx,
    status = 'open',
    updated_at = v_now,
    supersedes_id = excluded.supersedes_id;

  return jsonb_build_object ('ok', true, 'id', v_id);
exception
  when unique_violation then
    return jsonb_build_object ('ok', false, 'error', 'dayDrawerAlreadyOpen');
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

create or replace function public.shop_void_day_drawer_open (
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
  v_date_key text;
  v_reason text;
  v_sales bigint;
  v_now timestamptz := now ();
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif (p_payload ->> 'id', '')::uuid;
  v_date_key := nullif (trim (p_payload ->> 'date_key'), '');
  v_reason := coalesce (nullif (trim (p_payload ->> 'void_reason'), ''), '');

  if v_id is null or v_date_key is null or length(v_reason) < 3 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;

  v_sales := public._shop_completed_sales_count_for_day (p_shop_id, v_date_key);
  if v_sales > 0 then
    return jsonb_build_object ('ok', false, 'error', 'dayDrawerLockedAfterSales');
  end if;

  update public.shop_day_drawer_opens
  set
    status = 'voided',
    voided_at = v_now,
    void_reason = v_reason,
    updated_at = v_now
  where id = v_id
    and shop_id = p_shop_id
    and status = 'open';

  if not found then
    -- Idempotent: already voided/superseded
    return jsonb_build_object ('ok', true, 'id', v_id, 'idempotent', true);
  end if;

  return jsonb_build_object ('ok', true, 'id', v_id);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

create or replace function public.shop_pull_day_drawer_opens (
  p_shop_id uuid,
  p_since timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if auth.uid () is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select coalesce (jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'date_key', d.date_key,
      'opening_float_ugx', d.opening_float_ugx,
      'status', d.status,
      'created_at', d.created_at,
      'updated_at', d.updated_at,
      'created_by', d.created_by,
      'superseded_at', d.superseded_at,
      'voided_at', d.voided_at,
      'counted_at', d.counted_at,
      'counted_by_label', d.counted_by_label,
      'note', d.note,
      'void_reason', d.void_reason,
      'supersedes_id', d.supersedes_id,
      'device_id', d.device_id
    ) order by d.updated_at desc
  ), '[]'::jsonb)
  into v_rows
  from public.shop_day_drawer_opens d
  where d.shop_id = p_shop_id
    and (p_since is null or d.updated_at > p_since);

  return jsonb_build_object ('ok', true, 'rows', v_rows);
end;
$$;

revoke all on function public.shop_create_day_drawer_open (uuid, jsonb) from public;
grant execute on function public.shop_create_day_drawer_open (uuid, jsonb) to authenticated;

revoke all on function public.shop_supersede_day_drawer_open (uuid, jsonb) from public;
grant execute on function public.shop_supersede_day_drawer_open (uuid, jsonb) to authenticated;

revoke all on function public.shop_void_day_drawer_open (uuid, jsonb) from public;
grant execute on function public.shop_void_day_drawer_open (uuid, jsonb) to authenticated;

revoke all on function public.shop_pull_day_drawer_opens (uuid, timestamptz) from public;
grant execute on function public.shop_pull_day_drawer_opens (uuid, timestamptz) to authenticated;

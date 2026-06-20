-- Multi-device operational sync: inventory counts, shifts, day closes (cloud-authoritative).

-- ---------- Inventory count sessions ----------
create table if not exists public.shop_inventory_count_sessions (
  id uuid primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  session_number int not null,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shop_inventory_count_sessions_shop_updated_idx
  on public.shop_inventory_count_sessions (shop_id, updated_at);

alter table public.shop_inventory_count_sessions enable row level security;

drop policy if exists shop_inventory_count_sessions_select on public.shop_inventory_count_sessions;
create policy shop_inventory_count_sessions_select
  on public.shop_inventory_count_sessions for select
  using (public.user_is_cashier_or_above (shop_id));

drop policy if exists shop_inventory_count_sessions_insert on public.shop_inventory_count_sessions;
create policy shop_inventory_count_sessions_insert
  on public.shop_inventory_count_sessions for insert
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists shop_inventory_count_sessions_update on public.shop_inventory_count_sessions;
create policy shop_inventory_count_sessions_update
  on public.shop_inventory_count_sessions for update
  using (public.user_can_manage_shop (shop_id));

-- ---------- Shop shifts ----------
create table if not exists public.shop_shifts (
  id uuid primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  actor_user_id text not null,
  start_at timestamptz not null,
  end_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shop_shifts_shop_updated_idx
  on public.shop_shifts (shop_id, updated_at);

create index if not exists shop_shifts_shop_start_idx
  on public.shop_shifts (shop_id, start_at desc);

alter table public.shop_shifts enable row level security;

drop policy if exists shop_shifts_select on public.shop_shifts;
create policy shop_shifts_select
  on public.shop_shifts for select
  using (public.user_is_cashier_or_above (shop_id));

drop policy if exists shop_shifts_insert on public.shop_shifts;
create policy shop_shifts_insert
  on public.shop_shifts for insert
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists shop_shifts_update on public.shop_shifts;
create policy shop_shifts_update
  on public.shop_shifts for update
  using (public.user_can_manage_shop (shop_id));

-- ---------- Day closes ----------
create table if not exists public.shop_day_closes (
  id uuid primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  date_key text not null,
  superseded_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shop_day_closes_shop_updated_idx
  on public.shop_day_closes (shop_id, updated_at);

create index if not exists shop_day_closes_shop_date_idx
  on public.shop_day_closes (shop_id, date_key);

alter table public.shop_day_closes enable row level security;

drop policy if exists shop_day_closes_select on public.shop_day_closes;
create policy shop_day_closes_select
  on public.shop_day_closes for select
  using (public.user_is_cashier_or_above (shop_id));

drop policy if exists shop_day_closes_insert on public.shop_day_closes;
create policy shop_day_closes_insert
  on public.shop_day_closes for insert
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists shop_day_closes_update on public.shop_day_closes;
create policy shop_day_closes_update
  on public.shop_day_closes for update
  using (public.user_can_manage_shop (shop_id));

-- ---------- Push inventory count session ----------
create or replace function public.shop_push_inventory_count_session (
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
  v_num int;
  v_status text;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif (p_payload ->> 'id', '')::uuid;
  v_num := coalesce ((p_payload ->> 'session_number')::int, 0);
  v_status := nullif (trim (p_payload ->> 'status'), '');

  if v_id is null or v_num <= 0 or v_status is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;

  insert into public.shop_inventory_count_sessions (
    id, shop_id, session_number, status, payload, created_at, updated_at
  )
  values (
    v_id,
    p_shop_id,
    v_num,
    v_status,
    coalesce (p_payload -> 'session', p_payload),
    coalesce (nullif (p_payload ->> 'created_at', '')::timestamptz, now ()),
    coalesce (nullif (p_payload ->> 'updated_at', '')::timestamptz, now ())
  )
  on conflict (id) do update
  set
    session_number = excluded.session_number,
    status = excluded.status,
    payload = excluded.payload,
    updated_at = greatest (public.shop_inventory_count_sessions.updated_at, excluded.updated_at);

  return jsonb_build_object ('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.shop_push_inventory_count_session (uuid, jsonb) from public;
grant execute on function public.shop_push_inventory_count_session (uuid, jsonb) to authenticated;

-- ---------- Pull inventory count sessions ----------
create or replace function public.shop_pull_inventory_count_sessions (
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
  v_max timestamptz;
begin
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select coalesce (jsonb_agg (to_jsonb (r) order by r.updated_at), '[]'::jsonb),
         coalesce (max (r.updated_at), p_since, now ())
  into v_rows, v_max
  from (
    select
      s.id,
      s.shop_id,
      s.session_number,
      s.status,
      s.payload,
      s.created_at,
      s.updated_at
    from public.shop_inventory_count_sessions s
    where s.shop_id = p_shop_id
      and (p_since is null or s.updated_at > p_since)
    order by s.updated_at
    limit 500
  ) r;

  return jsonb_build_object ('ok', true, 'rows', v_rows, 'checkpoint_at', v_max);
end;
$$;

revoke all on function public.shop_pull_inventory_count_sessions (uuid, timestamptz) from public;
grant execute on function public.shop_pull_inventory_count_sessions (uuid, timestamptz) to authenticated;

-- ---------- Push shift ----------
create or replace function public.shop_push_shift (
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
  v_actor text;
  v_start timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif (p_payload ->> 'id', '')::uuid;
  v_actor := nullif (trim (p_payload ->> 'actor_user_id'), '');
  v_start := nullif (p_payload ->> 'start_at', '')::timestamptz;

  if v_id is null or v_actor is null or v_start is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;

  insert into public.shop_shifts (
    id, shop_id, actor_user_id, start_at, end_at, payload, created_at, updated_at
  )
  values (
    v_id,
    p_shop_id,
    v_actor,
    v_start,
    nullif (p_payload ->> 'end_at', '')::timestamptz,
    coalesce (p_payload -> 'shift', p_payload),
    coalesce (nullif (p_payload ->> 'created_at', '')::timestamptz, now ()),
    coalesce (nullif (p_payload ->> 'updated_at', '')::timestamptz, now ())
  )
  on conflict (id) do update
  set
    actor_user_id = excluded.actor_user_id,
    start_at = excluded.start_at,
    end_at = excluded.end_at,
    payload = excluded.payload,
    updated_at = greatest (public.shop_shifts.updated_at, excluded.updated_at);

  return jsonb_build_object ('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.shop_push_shift (uuid, jsonb) from public;
grant execute on function public.shop_push_shift (uuid, jsonb) to authenticated;

-- ---------- Pull shifts ----------
create or replace function public.shop_pull_shifts (
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
  v_max timestamptz;
begin
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select coalesce (jsonb_agg (to_jsonb (r) order by r.updated_at), '[]'::jsonb),
         coalesce (max (r.updated_at), p_since, now ())
  into v_rows, v_max
  from (
    select s.id, s.shop_id, s.actor_user_id, s.start_at, s.end_at, s.payload, s.created_at, s.updated_at
    from public.shop_shifts s
    where s.shop_id = p_shop_id
      and (p_since is null or s.updated_at > p_since)
    order by s.updated_at
    limit 500
  ) r;

  return jsonb_build_object ('ok', true, 'rows', v_rows, 'checkpoint_at', v_max);
end;
$$;

revoke all on function public.shop_pull_shifts (uuid, timestamptz) from public;
grant execute on function public.shop_pull_shifts (uuid, timestamptz) to authenticated;

-- ---------- Push day close ----------
create or replace function public.shop_push_day_close (
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
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif (p_payload ->> 'id', '')::uuid;
  v_date_key := nullif (trim (p_payload ->> 'date_key'), '');

  if v_id is null or v_date_key is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;

  insert into public.shop_day_closes (
    id, shop_id, date_key, superseded_at, payload, created_at, updated_at
  )
  values (
    v_id,
    p_shop_id,
    v_date_key,
    nullif (p_payload ->> 'superseded_at', '')::timestamptz,
    coalesce (p_payload -> 'close', p_payload),
    coalesce (nullif (p_payload ->> 'created_at', '')::timestamptz, now ()),
    coalesce (nullif (p_payload ->> 'updated_at', '')::timestamptz, now ())
  )
  on conflict (id) do update
  set
    date_key = excluded.date_key,
    superseded_at = excluded.superseded_at,
    payload = excluded.payload,
    updated_at = greatest (public.shop_day_closes.updated_at, excluded.updated_at);

  return jsonb_build_object ('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.shop_push_day_close (uuid, jsonb) from public;
grant execute on function public.shop_push_day_close (uuid, jsonb) to authenticated;

-- ---------- Pull day closes ----------
create or replace function public.shop_pull_day_closes (
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
  v_max timestamptz;
begin
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select coalesce (jsonb_agg (to_jsonb (r) order by r.updated_at), '[]'::jsonb),
         coalesce (max (r.updated_at), p_since, now ())
  into v_rows, v_max
  from (
    select d.id, d.shop_id, d.date_key, d.superseded_at, d.payload, d.created_at, d.updated_at
    from public.shop_day_closes d
    where d.shop_id = p_shop_id
      and (p_since is null or d.updated_at > p_since)
    order by d.updated_at
    limit 500
  ) r;

  return jsonb_build_object ('ok', true, 'rows', v_rows, 'checkpoint_at', v_max);
end;
$$;

revoke all on function public.shop_pull_day_closes (uuid, timestamptz) from public;
grant execute on function public.shop_pull_day_closes (uuid, timestamptz) to authenticated;

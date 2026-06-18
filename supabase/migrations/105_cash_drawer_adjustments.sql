-- Cash drawer adjustments: owner injections, bank deposits, opening float, etc.

create table if not exists public.shop_cash_drawer_adjustments (
  id uuid primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  adjustment_type text not null,
  amount_ugx bigint not null check (amount_ugx > 0),
  note text not null default '',
  actor_user_id text not null,
  actor_label text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  deleted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists shop_cash_drawer_adjustments_shop_occurred_idx
  on public.shop_cash_drawer_adjustments (shop_id, occurred_at desc)
  where deleted_at is null;

alter table public.shop_cash_drawer_adjustments enable row level security;

drop policy if exists shop_cash_drawer_adjustments_select on public.shop_cash_drawer_adjustments;
create policy shop_cash_drawer_adjustments_select
  on public.shop_cash_drawer_adjustments for select
  using (public.user_is_cashier_or_above (shop_id));

drop policy if exists shop_cash_drawer_adjustments_insert on public.shop_cash_drawer_adjustments;
create policy shop_cash_drawer_adjustments_insert
  on public.shop_cash_drawer_adjustments for insert
  with check (public.user_is_cashier_or_above (shop_id));

create or replace function public.shop_push_cash_drawer_adjustment (
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
  v_type text;
  v_amount bigint;
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
  v_type := nullif (trim (p_payload ->> 'type'), '');
  v_amount := coalesce ((p_payload ->> 'amount_ugx')::bigint, 0);

  if v_id is null or v_type is null or v_amount <= 0 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;

  insert into public.shop_cash_drawer_adjustments (
    id,
    shop_id,
    adjustment_type,
    amount_ugx,
    note,
    actor_user_id,
    actor_label,
    occurred_at,
    created_at,
    updated_at,
    deleted_at,
    metadata
  )
  values (
    v_id,
    p_shop_id,
    v_type,
    v_amount,
    coalesce (nullif (trim (p_payload ->> 'note'), ''), ''),
    coalesce (nullif (trim (p_payload ->> 'actor_user_id'), ''), v_uid::text),
    nullif (trim (p_payload ->> 'actor_label'), ''),
    coalesce (nullif (p_payload ->> 'occurred_at', '')::timestamptz, now ()),
    coalesce (nullif (p_payload ->> 'created_at', '')::timestamptz, now ()),
    now (),
    nullif (p_payload ->> 'deleted_at', '')::timestamptz,
    coalesce (p_payload -> 'metadata', '{}'::jsonb)
  )
  on conflict (id) do update
  set
    adjustment_type = excluded.adjustment_type,
    amount_ugx = excluded.amount_ugx,
    note = excluded.note,
    occurred_at = excluded.occurred_at,
    updated_at = now (),
    deleted_at = excluded.deleted_at,
    metadata = excluded.metadata;

  return jsonb_build_object ('ok', true, 'id', v_id);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_push_cash_drawer_adjustment (uuid, jsonb) from public;
grant execute on function public.shop_push_cash_drawer_adjustment (uuid, jsonb) to authenticated;

create or replace function public.shop_pull_cash_drawer_adjustments (
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
      'id', a.id,
      'type', a.adjustment_type,
      'amount_ugx', a.amount_ugx,
      'note', a.note,
      'actor_user_id', a.actor_user_id,
      'actor_name', a.actor_label,
      'occurred_at', a.occurred_at,
      'created_at', a.created_at,
      'updated_at', a.updated_at,
      'deleted_at', a.deleted_at
    ) order by a.occurred_at desc
  ), '[]'::jsonb)
  into v_rows
  from public.shop_cash_drawer_adjustments a
  where a.shop_id = p_shop_id
    and (p_since is null or a.updated_at > p_since);

  return jsonb_build_object ('ok', true, 'rows', v_rows);
end;
$$;

revoke all on function public.shop_pull_cash_drawer_adjustments (uuid, timestamptz) from public;
grant execute on function public.shop_pull_cash_drawer_adjustments (uuid, timestamptz) to authenticated;

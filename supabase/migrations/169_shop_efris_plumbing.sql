-- WAKA POS — EFRIS Phase 1: shop-scoped config + outbox (internal plumbing only).
-- NO URA API. NO endpoints. NO secrets columns. NO invented provider URLs.
-- EFRIS is optional per shop (default enabled = false). Sale completion does not depend on this.

-- ---------------------------------------------------------------------------
-- Config (one row per shop; missing row = disabled)
-- ---------------------------------------------------------------------------

create table if not exists public.shop_efris_config (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  enabled boolean not null default false,
  connection_status text not null default 'not_configured'
    check (connection_status in ('not_configured', 'disconnected', 'connected', 'error')),
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

comment on table public.shop_efris_config is
  'Optional per-shop EFRIS switch. Default disabled. Does not store URA credentials or URLs.';

create index if not exists shop_efris_config_enabled_idx
  on public.shop_efris_config (enabled)
  where enabled = true;

drop trigger if exists trg_shop_efris_config_updated on public.shop_efris_config;
create trigger trg_shop_efris_config_updated
  before update on public.shop_efris_config
  for each row execute function public.set_updated_at ();

alter table public.shop_efris_config enable row level security;

drop policy if exists shop_efris_config_select on public.shop_efris_config;
create policy shop_efris_config_select
  on public.shop_efris_config for select
  using (public.user_can_access_shop (shop_id));

-- Writes only via security-definer RPCs (shop_set_efris_enabled).
revoke insert, update, delete on table public.shop_efris_config from authenticated;
grant select on table public.shop_efris_config to authenticated;

-- ---------------------------------------------------------------------------
-- Outbox: at most one EFRIS record per WAKA sale per shop
-- sale_id is the WAKA sale UUID (no FK: local complete may precede cloud sales row)
-- ---------------------------------------------------------------------------

create table if not exists public.shop_efris_submissions (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  sale_id uuid not null,
  efris_state text not null default 'PENDING'
    check (
      efris_state in (
        'NOT_REQUIRED',
        'PENDING',
        'SUBMITTED',
        'ACCEPTED',
        'FAILED',
        'RETRY_REQUIRED'
      )
    ),
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  unique (shop_id, sale_id)
);

comment on table public.shop_efris_submissions is
  'EFRIS outbox. Independent of WAKA pendingSync. UNIQUE(shop_id, sale_id). No URA payloads.';

create index if not exists shop_efris_submissions_shop_state_idx
  on public.shop_efris_submissions (shop_id, efris_state);

drop trigger if exists trg_shop_efris_submissions_updated on public.shop_efris_submissions;
create trigger trg_shop_efris_submissions_updated
  before update on public.shop_efris_submissions
  for each row execute function public.set_updated_at ();

alter table public.shop_efris_submissions enable row level security;

drop policy if exists shop_efris_submissions_select on public.shop_efris_submissions;
create policy shop_efris_submissions_select
  on public.shop_efris_submissions for select
  using (public.user_can_access_shop (shop_id));

revoke insert, update, delete on table public.shop_efris_submissions from authenticated;
grant select on table public.shop_efris_submissions to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.shop_get_efris_config (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_status text;
begin
  if p_shop_id is null then
    return jsonb_build_object('ok', false, 'error', 'shop_id_required');
  end if;
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select c.enabled, c.connection_status
  into v_enabled, v_status
  from public.shop_efris_config c
  where c.shop_id = p_shop_id;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'shop_id', p_shop_id,
      'enabled', false,
      'connection_status', 'not_configured'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'shop_id', p_shop_id,
    'enabled', v_enabled,
    'connection_status', v_status
  );
end;
$$;

revoke all on function public.shop_get_efris_config (uuid) from public;
grant execute on function public.shop_get_efris_config (uuid) to authenticated;

create or replace function public.shop_set_efris_enabled (p_shop_id uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_status text;
begin
  if p_shop_id is null then
    return jsonb_build_object('ok', false, 'error', 'shop_id_required');
  end if;
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  insert into public.shop_efris_config (shop_id, enabled, connection_status)
  values (p_shop_id, coalesce(p_enabled, false), 'not_configured')
  on conflict (shop_id) do update
    set enabled = excluded.enabled;
    -- Enabling never implies a live URA connection (Phase 1: no provider).

  select c.enabled, c.connection_status
  into v_enabled, v_status
  from public.shop_efris_config c
  where c.shop_id = p_shop_id;

  return jsonb_build_object(
    'ok', true,
    'shop_id', p_shop_id,
    'enabled', v_enabled,
    'connection_status', v_status
  );
end;
$$;

revoke all on function public.shop_set_efris_enabled (uuid, boolean) from public;
grant execute on function public.shop_set_efris_enabled (uuid, boolean) to authenticated;

-- Idempotent outbox insert. Disabled shops: no row (NOT_REQUIRED).
create or replace function public.shop_enqueue_efris_submission (p_shop_id uuid, p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean := false;
  v_id uuid;
  v_state text;
  v_inserted int := 0;
begin
  if p_shop_id is null or p_sale_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select c.enabled into v_enabled
  from public.shop_efris_config c
  where c.shop_id = p_shop_id;

  if coalesce(v_enabled, false) is not true then
    return jsonb_build_object(
      'ok', true,
      'enqueued', false,
      'efris_state', 'NOT_REQUIRED',
      'shop_id', p_shop_id,
      'sale_id', p_sale_id
    );
  end if;

  insert into public.shop_efris_submissions (shop_id, sale_id, efris_state)
  values (p_shop_id, p_sale_id, 'PENDING')
  on conflict (shop_id, sale_id) do nothing;
  get diagnostics v_inserted = row_count;

  select s.id, s.efris_state
  into v_id, v_state
  from public.shop_efris_submissions s
  where s.shop_id = p_shop_id and s.sale_id = p_sale_id;

  return jsonb_build_object(
    'ok', true,
    'enqueued', true,
    'created', (v_inserted > 0),
    'id', v_id,
    'shop_id', p_shop_id,
    'sale_id', p_sale_id,
    'efris_state', v_state
  );
end;
$$;

revoke all on function public.shop_enqueue_efris_submission (uuid, uuid) from public;
grant execute on function public.shop_enqueue_efris_submission (uuid, uuid) to authenticated;

-- Edge stub: record missing official provider. NEVER sets ACCEPTED/SUBMITTED.
create or replace function public.shop_efris_note_provider_absent (p_shop_id uuid, p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_state text;
begin
  if p_shop_id is null or p_sale_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.shop_efris_submissions s
  set
    last_error_code = 'EFRIS_PROVIDER_NOT_CONFIGURED',
    last_error_message = 'Official URA EFRIS provider is not configured'
  where s.shop_id = p_shop_id
    and s.sale_id = p_sale_id
    and s.efris_state not in ('ACCEPTED', 'SUBMITTED');

  if not found then
    select s.id, s.efris_state
    into v_id, v_state
    from public.shop_efris_submissions s
    where s.shop_id = p_shop_id and s.sale_id = p_sale_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'error', 'outbox_not_found');
    end if;
    return jsonb_build_object(
      'ok', true,
      'id', v_id,
      'efris_state', v_state,
      'unchanged', true
    );
  end if;

  select s.id, s.efris_state
  into v_id, v_state
  from public.shop_efris_submissions s
  where s.shop_id = p_shop_id and s.sale_id = p_sale_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'shop_id', p_shop_id,
    'sale_id', p_sale_id,
    'efris_state', v_state,
    'code', 'EFRIS_PROVIDER_NOT_CONFIGURED'
  );
end;
$$;

revoke all on function public.shop_efris_note_provider_absent (uuid, uuid) from public;
grant execute on function public.shop_efris_note_provider_absent (uuid, uuid) to authenticated;

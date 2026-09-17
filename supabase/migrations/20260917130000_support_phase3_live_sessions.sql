-- ============================================================
-- WAKA POS — PHASE 3: Live Support Session (transparent remote assistance)
--
-- Merchant grants a WAKA support agent time-boxed, read-only "guided
-- assistance": the agent sees which curated back-office screen the merchant
-- is on (via curated events the merchant app emits locally and the agent
-- triggers remotely for navigation), never field values, never the DOM, and
-- has NO write/control path into the merchant app. Existing permissions keep
-- gating everything — a support session is NOT an authorization escalation.
--
-- Security model:
--   * Merchants: ZERO direct DML. All writes go through SECURITY DEFINER RPCs.
--   * RLS grants SELECT only. Event inserts are RPC-gated on
--     caller = session.support_user_id AND session active AND unexpired.
--   * Events carry curated labels + sanitized scalar metadata only.
--   * Single requested/active session per ticket (partial unique index).
--   * Hard server-side expiry (5–60 min window) + pg_cron sweep every 2 min.
--   * Closing the ticket ends any open session (trigger).
--
-- Financial core touched: NO.
-- ============================================================

create table if not exists public.merchant_support_sessions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.merchant_support_tickets(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  support_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'requested'
    check (status in ('requested', 'active', 'expired', 'revoked', 'ended')),
  duration_minutes integer not null default 30
    check (duration_minutes between 5 and 60),
  requested_by uuid references auth.users(id) on delete set null,
  -- Who initiated the request: merchant asks (agent approves) or agent asks
  -- (merchant must allow before anything becomes active).
  requested_by_role text not null default 'merchant'
    check (requested_by_role in ('merchant', 'support')),
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  expires_at timestamptz not null,
  ended_at timestamptz,
  ended_by uuid references auth.users(id) on delete set null,
  ended_reason text check (ended_reason in
    (null, 'merchant_stop', 'admin_end', 'ticket_closed', 'expired', 'revoked', 'declined')),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists merchant_support_sessions_shop_idx
  on public.merchant_support_sessions (shop_id, status, created_at desc);
create index if not exists merchant_support_sessions_support_user_idx
  on public.merchant_support_sessions (support_user_id, status);
create index if not exists merchant_support_sessions_expiry_idx
  on public.merchant_support_sessions (expires_at) where status in ('requested', 'active');

-- One requested/active session per ticket, ever.
create unique index if not exists merchant_support_sessions_one_open_per_ticket
  on public.merchant_support_sessions (ticket_id)
  where status in ('requested', 'active');

create table if not exists public.merchant_support_session_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.merchant_support_sessions(id) on delete cascade,
  ticket_id uuid not null references public.merchant_support_tickets(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  -- Session owner; NULL while the request is still waiting for an agent.
  support_user_id uuid references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'session_requested', 'session_approved', 'session_started',
    'route_changed', 'page_opened', 'record_viewed', 'dialog_opened',
    'session_ended', 'revoked', 'expired'
  )),
  route_path text,
  label text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists merchant_support_session_events_session_idx
  on public.merchant_support_session_events (session_id, created_at);

-- Owner is NULL until an agent approves (merchant-initiated requests).
-- On support-initiated requests the requester is the prospective owner.
alter table public.merchant_support_session_events
  alter column support_user_id drop not null;

-- Owner is NULL until an agent approves (merchant-initiated requests).
-- On support-initiated requests the requester is the prospective owner.
alter table public.merchant_support_sessions
  alter column support_user_id drop not null;

alter table public.merchant_support_sessions
  add column if not exists requested_by_role text not null default 'merchant'
    check (requested_by_role in ('merchant', 'support'));
create index if not exists merchant_support_session_events_shop_idx
  on public.merchant_support_session_events (shop_id, created_at desc);

-- ------------------------------------------------------------
-- Grants: SELECT only for authenticated; all writes via RPCs.
-- ------------------------------------------------------------
alter table public.merchant_support_sessions enable row level security;
alter table public.merchant_support_session_events enable row level security;

revoke all on public.merchant_support_sessions from anon, authenticated;
revoke all on public.merchant_support_session_events from anon, authenticated;
grant select on public.merchant_support_sessions to authenticated;
grant select on public.merchant_support_session_events to authenticated;

drop policy if exists merchant_support_sessions_select on public.merchant_support_sessions;
create policy merchant_support_sessions_select on public.merchant_support_sessions
  for select to authenticated
  using (
    auth.uid() = support_user_id
    or public.user_can_access_shop(shop_id)
    or public.is_waka_internal_role(array['super_admin', 'support_admin'])
  );

drop policy if exists merchant_support_session_events_select on public.merchant_support_session_events;
create policy merchant_support_session_events_select on public.merchant_support_session_events
  for select to authenticated
  using (
    auth.uid() = support_user_id
    or public.user_can_access_shop(shop_id)
    or public.is_waka_internal_role(array['super_admin', 'support_admin'])
  );

-- ------------------------------------------------------------
-- Curated read-only route allowlist (single source of truth,
-- mirrored in src/lib/supportSessions.ts).
-- ------------------------------------------------------------
create or replace function public.waka_support_session_allowlist()
returns text[]
language sql
stable
as $$
  select array[
    '/office', '/stock', '/customers', '/cash-expenses',
    '/reports', '/receipts', '/settings'
  ];
$$;

-- ------------------------------------------------------------
-- RPC: merchant requests a live session for an OPEN ticket.
-- ------------------------------------------------------------
create or replace function public.waka_request_support_session(
  p_ticket_id uuid,
  p_duration_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.merchant_support_tickets%rowtype;
  v_duration integer;
  v_session public.merchant_support_sessions%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  select * into v_ticket from public.merchant_support_tickets where id = p_ticket_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ticket_not_found');
  end if;
  if v_ticket.status <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'ticket_not_open');
  end if;
  if not public.user_can_access_shop(v_ticket.shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if exists (
    select 1 from public.merchant_support_sessions
    where ticket_id = p_ticket_id and status in ('requested', 'active')
  ) then
    return jsonb_build_object('ok', false, 'error', 'session_already_open');
  end if;

  v_duration := greatest(5, least(60, coalesce(p_duration_minutes, 30)));

  insert into public.merchant_support_sessions (
    ticket_id, shop_id, status, duration_minutes, requested_by, requested_by_role, expires_at
  ) values (
    p_ticket_id, v_ticket.shop_id, 'requested', v_duration, auth.uid(), 'merchant',
    now() + make_interval(mins => v_duration)
  )
  returning * into v_session;

  insert into public.merchant_support_session_events (
    session_id, ticket_id, shop_id, support_user_id, event_type, label
  ) values (
    v_session.id, v_session.ticket_id, v_session.shop_id, auth.uid(),
    'session_requested', 'Merchant requested a live support session'
  );

  return jsonb_build_object('ok', true, 'session', to_jsonb(v_session));
end;
$$;

-- ------------------------------------------------------------
-- RPC: internal admin asks the merchant for a live session.
-- The requester is the prospective owner; nothing activates until
-- the merchant explicitly allows it (waka_merchant_respond_support_session).
-- ------------------------------------------------------------
create or replace function public.waka_admin_request_support_session(
  p_ticket_id uuid,
  p_duration_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.merchant_support_tickets%rowtype;
  v_duration integer;
  v_session public.merchant_support_sessions%rowtype;
begin
  if auth.uid() is null
     or not public.is_waka_internal_role(array['super_admin', 'support_admin']) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_ticket from public.merchant_support_tickets where id = p_ticket_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ticket_not_found');
  end if;
  if v_ticket.status <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'ticket_not_open');
  end if;
  if exists (
    select 1 from public.merchant_support_sessions
    where ticket_id = p_ticket_id and status in ('requested', 'active')
  ) then
    return jsonb_build_object('ok', false, 'error', 'session_already_open');
  end if;

  v_duration := greatest(5, least(60, coalesce(p_duration_minutes, 30)));

  insert into public.merchant_support_sessions (
    ticket_id, shop_id, status, duration_minutes, requested_by, requested_by_role,
    support_user_id, expires_at
  ) values (
    p_ticket_id, v_ticket.shop_id, 'requested', v_duration, auth.uid(), 'support',
    auth.uid(), now() + make_interval(mins => v_duration)
  )
  returning * into v_session;

  insert into public.merchant_support_session_events (
    session_id, ticket_id, shop_id, support_user_id, event_type, label
  ) values (
    v_session.id, v_session.ticket_id, v_session.shop_id, auth.uid(),
    'session_requested', 'Support agent requested a live session'
  );

  return jsonb_build_object('ok', true, 'session', to_jsonb(v_session));
end;
$$;

-- ------------------------------------------------------------
-- RPC: merchant allows or declines a support-initiated request.
-- ------------------------------------------------------------
create or replace function public.waka_merchant_respond_support_session(
  p_session_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.merchant_support_sessions%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  select * into v_session from public.merchant_support_sessions
  where id = p_session_id and status = 'requested' and requested_by_role = 'support'
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_pending');
  end if;
  if not public.user_can_access_shop(v_session.shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_approve then
    update public.merchant_support_sessions
    set status = 'active', approved_by = auth.uid(), approved_at = now(),
        expires_at = now() + make_interval(mins => duration_minutes)
    where id = v_session.id
    returning * into v_session;

    insert into public.merchant_support_session_events (
      session_id, ticket_id, shop_id, support_user_id, event_type, label
    ) values (
      v_session.id, v_session.ticket_id, v_session.shop_id, v_session.support_user_id,
      'session_approved', 'Merchant allowed the live session'
    );
    insert into public.merchant_support_session_events (
      session_id, ticket_id, shop_id, support_user_id, event_type, label
    ) values (
      v_session.id, v_session.ticket_id, v_session.shop_id, v_session.support_user_id,
      'session_started', 'Live support session started'
    );
  else
    update public.merchant_support_sessions
    set status = 'ended', ended_at = now(), ended_by = auth.uid(), ended_reason = 'declined'
    where id = v_session.id
    returning * into v_session;

    insert into public.merchant_support_session_events (
      session_id, ticket_id, shop_id, support_user_id, event_type, label
    ) values (
      v_session.id, v_session.ticket_id, v_session.shop_id, v_session.support_user_id,
      'session_ended', 'Merchant declined the live session request'
    );
  end if;

  return jsonb_build_object('ok', true, 'session', to_jsonb(v_session));
end;
$$;

-- ------------------------------------------------------------
-- RPC: internal admin approves or declines a MERCHANT-initiated request.
-- Approver becomes the session owner (support_user_id).
-- ------------------------------------------------------------
create or replace function public.waka_respond_support_session(
  p_session_id uuid,
  p_approve boolean,
  p_duration_minutes integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.merchant_support_sessions%rowtype;
  v_duration integer;
begin
  if auth.uid() is null
     or not public.is_waka_internal_role(array['super_admin', 'support_admin']) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_session from public.merchant_support_sessions
  where id = p_session_id and status = 'requested' and requested_by_role = 'merchant'
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_requested');
  end if;

  if p_approve then
    v_duration := greatest(5, least(60, coalesce(p_duration_minutes, v_session.duration_minutes)));
    update public.merchant_support_sessions
    set status = 'active',
        support_user_id = auth.uid(),
        approved_by = auth.uid(),
        approved_at = now(),
        duration_minutes = v_duration,
        expires_at = now() + make_interval(mins => v_duration)
    where id = v_session.id
    returning * into v_session;

    insert into public.merchant_support_session_events (
      session_id, ticket_id, shop_id, support_user_id, event_type, label
    ) values (
      v_session.id, v_session.ticket_id, v_session.shop_id, auth.uid(),
      'session_approved', 'Support agent approved the live session'
    );
    insert into public.merchant_support_session_events (
      session_id, ticket_id, shop_id, support_user_id, event_type, label
    ) values (
      v_session.id, v_session.ticket_id, v_session.shop_id, auth.uid(),
      'session_started', 'Live support session started'
    );
  else
    update public.merchant_support_sessions
    set status = 'ended', ended_at = now(), ended_by = auth.uid(), ended_reason = 'declined'
    where id = v_session.id
    returning * into v_session;

    insert into public.merchant_support_session_events (
      session_id, ticket_id, shop_id, support_user_id, event_type, label
    ) values (
      v_session.id, v_session.ticket_id, v_session.shop_id, auth.uid(),
      'session_ended', 'Support agent declined the live session request'
    );
  end if;

  return jsonb_build_object('ok', true, 'session', to_jsonb(v_session));
end;
$$;

-- ------------------------------------------------------------
-- RPC: merchant revokes an open (requested/active) session — instant kill.
-- ------------------------------------------------------------
create or replace function public.waka_revoke_support_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.merchant_support_sessions%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  select * into v_session from public.merchant_support_sessions
  where id = p_session_id and status in ('requested', 'active')
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_open');
  end if;
  if not public.user_can_access_shop(v_session.shop_id) then
    -- A non-member agent may only cancel their OWN support-initiated request.
    if not (
      public.is_waka_internal_role(array['super_admin', 'support_admin'])
      and v_session.requested_by_role = 'support'
      and v_session.support_user_id is not distinct from auth.uid()
    ) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
  end if;

  update public.merchant_support_sessions
  set status = 'revoked', ended_at = now(), ended_by = auth.uid(), ended_reason = 'revoked'
  where id = v_session.id;

  insert into public.merchant_support_session_events (
    session_id, ticket_id, shop_id, support_user_id, event_type, label
  ) values (
    v_session.id, v_session.ticket_id, v_session.shop_id,
    coalesce(v_session.support_user_id, auth.uid()),
    'revoked', 'Merchant stopped the live support session'
  );

  return jsonb_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------------
-- RPC: session owner (or any internal admin) ends an active session.
-- ------------------------------------------------------------
create or replace function public.waka_end_support_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.merchant_support_sessions%rowtype;
begin
  if auth.uid() is null
     or not public.is_waka_internal_role(array['super_admin', 'support_admin']) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_session from public.merchant_support_sessions
  where id = p_session_id and status = 'active'
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_active');
  end if;

  update public.merchant_support_sessions
  set status = 'ended', ended_at = now(), ended_by = auth.uid(), ended_reason = 'admin_end'
  where id = v_session.id;

  insert into public.merchant_support_session_events (
    session_id, ticket_id, shop_id, support_user_id, event_type, label
  ) values (
    v_session.id, v_session.ticket_id, v_session.shop_id, auth.uid(),
    'session_ended', 'Support agent ended the live session'
  );

  return jsonb_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------------
-- RPC: curated activity event. Callable ONLY by the session owner while
-- the session is active and unexpired. Label capped, metadata sanitized
-- to short scalar values, route_path must be in the allowlist.
-- ------------------------------------------------------------
create or replace function public.waka_support_session_event(
  p_session_id uuid,
  p_event_type text,
  p_label text,
  p_route_path text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.merchant_support_sessions%rowtype;
  v_label text;
  v_meta jsonb;
  v_key text;
  v_value text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  select * into v_session from public.merchant_support_sessions
  where id = p_session_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;
  if v_session.support_user_id is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if v_session.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'session_not_active');
  end if;
  if v_session.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'session_expired');
  end if;
  if p_event_type not in (
    'session_requested', 'session_approved', 'session_started',
    'route_changed', 'page_opened', 'record_viewed', 'dialog_opened',
    'session_ended', 'revoked', 'expired'
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_event_type');
  end if;
  if p_route_path is not null
     and p_route_path <> all (public.waka_support_session_allowlist()) then
    return jsonb_build_object('ok', false, 'error', 'route_not_allowed');
  end if;

  -- Curated label: cap 120 chars, single line.
  v_label := left(regexp_replace(coalesce(p_label, ''), '[\r\n]+', ' ', 'g'), 120);
  if v_label = '' then
    return jsonb_build_object('ok', false, 'error', 'label_required');
  end if;

  -- Sanitized metadata: flat object, <= 10 keys, short scalar text values.
  v_meta := '{}'::jsonb;
  if p_metadata is not null and jsonb_typeof(p_metadata) = 'object' then
    for v_key, v_value in
      select key, left(coalesce(value #>> '{}', ''), 80)
      from jsonb_each(p_metadata)
      limit 10
    loop
      v_meta := v_meta || jsonb_build_object(left(v_key, 40), v_value);
    end loop;
  end if;

  insert into public.merchant_support_session_events (
    session_id, ticket_id, shop_id, support_user_id,
    event_type, route_path, label, metadata
  ) values (
    v_session.id, v_session.ticket_id, v_session.shop_id, auth.uid(),
    p_event_type, p_route_path, v_label, v_meta
  );

  return jsonb_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------------
-- RPC: fetch the open (requested/active) session for a ticket.
-- ------------------------------------------------------------
create or replace function public.waka_get_ticket_session(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.merchant_support_sessions%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  select * into v_session from public.merchant_support_sessions
  where ticket_id = p_ticket_id and status in ('requested', 'active')
  order by created_at desc
  limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'session', null);
  end if;
  if auth.uid() is distinct from v_session.support_user_id
     and not public.user_can_access_shop(v_session.shop_id)
     and not public.is_waka_internal_role(array['super_admin', 'support_admin']) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  return jsonb_build_object('ok', true, 'session', to_jsonb(v_session));
end;
$$;

-- ------------------------------------------------------------
-- RPC: hard expiry sweep (pg_cron). Not callable by API roles.
-- ------------------------------------------------------------
create or replace function public.waka_expire_support_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
  v_count integer := 0;
begin
  for v_rec in
    select id, ticket_id, shop_id, support_user_id from public.merchant_support_sessions
    where status in ('requested', 'active') and expires_at <= now()
    order by expires_at
    for update
  loop
    update public.merchant_support_sessions
    set status = 'expired', ended_at = now(), ended_reason = 'expired'
    where id = v_rec.id;
    insert into public.merchant_support_session_events (
      session_id, ticket_id, shop_id, support_user_id, event_type, label
    ) values (
      v_rec.id, v_rec.ticket_id, v_rec.shop_id, v_rec.support_user_id,
      'expired', 'Live support session expired'
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ------------------------------------------------------------
-- Ticket close ends any open session on that ticket.
-- ------------------------------------------------------------
create or replace function public.support_end_sessions_on_ticket_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
begin
  if new.status = 'closed' and (old.status is distinct from new.status) then
    for v_rec in
      select id, support_user_id from public.merchant_support_sessions
      where ticket_id = new.id and status in ('requested', 'active')
    loop
      update public.merchant_support_sessions
      set status = 'ended', ended_at = now(), ended_by = auth.uid(),
          ended_reason = 'ticket_closed'
      where id = v_rec.id;
      insert into public.merchant_support_session_events (
        session_id, ticket_id, shop_id, support_user_id, event_type, label
      ) values (
        v_rec.id, new.id, new.shop_id, v_rec.support_user_id,
        'session_ended', 'Ticket closed — live support session ended'
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_merchant_support_ticket_end_sessions on public.merchant_support_tickets;
create trigger trg_merchant_support_ticket_end_sessions
  after update of status on public.merchant_support_tickets
  for each row
  execute function public.support_end_sessions_on_ticket_close();

-- ------------------------------------------------------------
-- RPC grants: authenticated can call the API-facing RPCs only.
-- ------------------------------------------------------------
revoke all on function public.waka_request_support_session(uuid, integer) from anon, authenticated;
revoke all on function public.waka_admin_request_support_session(uuid, integer) from anon, authenticated;
revoke all on function public.waka_merchant_respond_support_session(uuid, boolean) from anon, authenticated;
revoke all on function public.waka_respond_support_session(uuid, boolean, integer) from anon, authenticated;
revoke all on function public.waka_revoke_support_session(uuid) from anon, authenticated;
revoke all on function public.waka_end_support_session(uuid) from anon, authenticated;
revoke all on function public.waka_support_session_event(uuid, text, text, text, jsonb) from anon, authenticated;
revoke all on function public.waka_get_ticket_session(uuid) from anon, authenticated;
revoke all on function public.waka_expire_support_sessions() from anon, authenticated;
revoke all on function public.waka_support_session_allowlist() from anon, authenticated;

grant execute on function public.waka_request_support_session(uuid, integer) to authenticated;
grant execute on function public.waka_admin_request_support_session(uuid, integer) to authenticated;
grant execute on function public.waka_merchant_respond_support_session(uuid, boolean) to authenticated;
grant execute on function public.waka_respond_support_session(uuid, boolean, integer) to authenticated;
grant execute on function public.waka_revoke_support_session(uuid) to authenticated;
grant execute on function public.waka_end_support_session(uuid) to authenticated;
grant execute on function public.waka_support_session_event(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.waka_get_ticket_session(uuid) to authenticated;
grant execute on function public.waka_support_session_allowlist() to authenticated;

-- ------------------------------------------------------------
-- Realtime: stream both tables (RLS-filtered per subscriber).
-- UPDATE filters reference non-PK columns, so FULL replica identity.
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'merchant_support_sessions') then
      alter publication supabase_realtime add table public.merchant_support_sessions;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'merchant_support_session_events') then
      alter publication supabase_realtime add table public.merchant_support_session_events;
    end if;
  end if;
end $$;

alter table public.merchant_support_sessions replica identity full;
alter table public.merchant_support_session_events replica identity full;

-- ------------------------------------------------------------
-- pg_cron: sweep expired sessions every 2 minutes (idempotent schedule).
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (
      select 1 from cron.job
      where jobname = 'waka-expire-support-sessions'
    ) then
      perform cron.schedule(
        'waka-expire-support-sessions',
        '*/2 * * * *',
        $job$select public.waka_expire_support_sessions();$job$
      );
    end if;
  end if;
end $$;

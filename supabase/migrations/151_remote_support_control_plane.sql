-- RS-1: Remote Support control plane (authorization only).
-- Does NOT create remote-desktop credentials, listeners, or transport.

-- ---------- Tunables (change here, not in callers) ----------
create or replace function public.remote_support_request_ttl ()
returns interval
language sql
immutable
as $$
  select interval '5 minutes';
$$;

create or replace function public.remote_support_grant_ttl ()
returns interval
language sql
immutable
as $$
  select interval '5 minutes';
$$;

create or replace function public.remote_support_online_window ()
returns interval
language sql
immutable
as $$
  select interval '15 minutes';
$$;

revoke all on function public.remote_support_request_ttl () from public;
revoke all on function public.remote_support_grant_ttl () from public;
revoke all on function public.remote_support_online_window () from public;
grant execute on function public.remote_support_request_ttl () to authenticated;
grant execute on function public.remote_support_grant_ttl () to authenticated;
grant execute on function public.remote_support_online_window () to authenticated;

create or replace function public.waka_can_remote_support ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_waka_internal_role (array['super_admin', 'support_admin']::text[]);
$$;

revoke all on function public.waka_can_remote_support () from public;
grant execute on function public.waka_can_remote_support () to authenticated;

-- ---------- Tables ----------
create table if not exists public.remote_support_requests (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  shop_device_id uuid not null references public.shop_devices (id) on delete cascade,
  device_fingerprint text not null,
  technician_admin_id uuid not null references public.internal_admins (id) on delete restrict,
  technician_user_id uuid references auth.users (id) on delete set null,
  reason_code text not null,
  reason_text text not null,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'declined', 'cancelled', 'expired')),
  requested_at timestamptz not null default now (),
  expires_at timestamptz not null,
  customer_responded_at timestamptz,
  customer_actor_type text
    check (customer_actor_type is null or customer_actor_type in ('owner', 'staff', 'member')),
  customer_actor_id uuid,
  support_request_id uuid references public.support_requests (id) on delete set null,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  constraint remote_support_requests_reason_code_chk check (char_length(trim(reason_code)) between 1 and 64),
  constraint remote_support_requests_reason_text_chk check (char_length(trim(reason_text)) between 3 and 500),
  constraint remote_support_requests_fp_chk check (char_length(trim(device_fingerprint)) >= 8)
);

create table if not exists public.remote_support_sessions (
  id uuid primary key default gen_random_uuid (),
  request_id uuid not null unique references public.remote_support_requests (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  shop_device_id uuid not null references public.shop_devices (id) on delete cascade,
  technician_admin_id uuid not null references public.internal_admins (id) on delete restrict,
  status text not null default 'connecting'
    check (status in ('connecting', 'active', 'ended', 'failed', 'revoked', 'expired')),
  approved_at timestamptz not null default now (),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds int,
  ended_by text
    check (ended_by is null or ended_by in ('customer', 'technician', 'system', 'admin')),
  failure_reason text,
  grant_jti uuid not null unique default gen_random_uuid (),
  grant_expires_at timestamptz not null,
  grant_consumed_at timestamptz,
  transport_session_ref text,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

comment on column public.remote_support_sessions.transport_session_ref is
  'RS-1 placeholder only. Must not be used to open a remote-desktop connection.';
comment on column public.remote_support_sessions.grant_jti is
  'Future one-time control-plane grant id. Not a remote-control credential.';

create table if not exists public.remote_support_session_events (
  id uuid primary key default gen_random_uuid (),
  session_id uuid references public.remote_support_sessions (id) on delete cascade,
  request_id uuid not null references public.remote_support_requests (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  shop_device_id uuid not null references public.shop_devices (id) on delete cascade,
  at timestamptz not null default now (),
  actor_type text not null
    check (actor_type in ('technician', 'customer', 'admin', 'system')),
  actor_id uuid,
  event text not null,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists remote_support_requests_shop_idx
  on public.remote_support_requests (shop_id, requested_at desc);
create index if not exists remote_support_requests_device_status_idx
  on public.remote_support_requests (shop_device_id, status);
create index if not exists remote_support_requests_fp_status_idx
  on public.remote_support_requests (device_fingerprint, status);
create unique index if not exists remote_support_requests_one_open_per_device
  on public.remote_support_requests (shop_device_id)
  where status = 'requested';

create index if not exists remote_support_sessions_device_status_idx
  on public.remote_support_sessions (shop_device_id, status);
create unique index if not exists remote_support_sessions_one_open_per_device
  on public.remote_support_sessions (shop_device_id)
  where status in ('connecting', 'active');

create index if not exists remote_support_session_events_request_idx
  on public.remote_support_session_events (request_id, at desc);
create index if not exists remote_support_session_events_session_idx
  on public.remote_support_session_events (session_id, at desc);

drop trigger if exists trg_remote_support_requests_updated on public.remote_support_requests;
create trigger trg_remote_support_requests_updated
  before update on public.remote_support_requests
  for each row execute function public.set_updated_at ();

drop trigger if exists trg_remote_support_sessions_updated on public.remote_support_sessions;
create trigger trg_remote_support_sessions_updated
  before update on public.remote_support_sessions
  for each row execute function public.set_updated_at ();

alter table public.remote_support_requests enable row level security;
alter table public.remote_support_sessions enable row level security;
alter table public.remote_support_session_events enable row level security;

drop policy if exists remote_support_requests_staff_select on public.remote_support_requests;
create policy remote_support_requests_staff_select
  on public.remote_support_requests for select
  using (public.is_waka_internal_staff ());

drop policy if exists remote_support_requests_shop_select on public.remote_support_requests;
create policy remote_support_requests_shop_select
  on public.remote_support_requests for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists remote_support_sessions_staff_select on public.remote_support_sessions;
create policy remote_support_sessions_staff_select
  on public.remote_support_sessions for select
  using (public.is_waka_internal_staff ());

drop policy if exists remote_support_sessions_shop_select on public.remote_support_sessions;
create policy remote_support_sessions_shop_select
  on public.remote_support_sessions for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists remote_support_session_events_staff_select on public.remote_support_session_events;
create policy remote_support_session_events_staff_select
  on public.remote_support_session_events for select
  using (public.is_waka_internal_staff ());

drop policy if exists remote_support_session_events_shop_select on public.remote_support_session_events;
create policy remote_support_session_events_shop_select
  on public.remote_support_session_events for select
  using (public.user_can_access_shop (shop_id));

-- No client INSERT/UPDATE/DELETE policies. Mutations are SECURITY DEFINER RPCs only.

alter table public.remote_support_requests replica identity full;
alter table public.remote_support_sessions replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.remote_support_requests;
    alter publication supabase_realtime add table public.remote_support_sessions;
  end if;
exception
  when duplicate_object then null;
end;
$$;

-- ---------- Helpers ----------
create or replace function public._remote_support_append_event (
  p_session_id uuid,
  p_request_id uuid,
  p_shop_id uuid,
  p_shop_device_id uuid,
  p_actor_type text,
  p_actor_id uuid,
  p_event text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.remote_support_session_events (
    session_id, request_id, shop_id, shop_device_id, actor_type, actor_id, event, payload
  )
  values (
    p_session_id, p_request_id, p_shop_id, p_shop_device_id, p_actor_type, p_actor_id, p_event,
    coalesce(p_payload, '{}'::jsonb)
  );
end;
$$;

revoke all on function public._remote_support_append_event (uuid, uuid, uuid, uuid, text, uuid, text, jsonb) from public;

create or replace function public._remote_support_shop_audit (
  p_shop_id uuid,
  p_action text,
  p_summary text,
  p_device_fingerprint text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.audit_shop_device_event (
    p_shop_id,
    p_action,
    p_summary,
    p_device_fingerprint,
    coalesce(p_payload, '{}'::jsonb)
  );
end;
$$;

revoke all on function public._remote_support_shop_audit (uuid, text, text, text, jsonb) from public;

create or replace function public.remote_support_expire_stale (p_shop_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_sess record;
  v_n int := 0;
begin
  for v_req in
    select r.*
    from public.remote_support_requests r
    where r.status = 'requested'
      and r.expires_at <= now ()
      and (p_shop_id is null or r.shop_id = p_shop_id)
  loop
    update public.remote_support_requests
    set status = 'expired'
    where id = v_req.id
      and status = 'requested';
    if found then
      v_n := v_n + 1;
      perform public._remote_support_append_event (
        null, v_req.id, v_req.shop_id, v_req.shop_device_id, 'system', null, 'request_expired',
        jsonb_build_object('request_id', v_req.id)
      );
      perform public._remote_support_shop_audit (
        v_req.shop_id,
        'remote_support_request_expired',
        'Remote support request expired',
        v_req.device_fingerprint,
        jsonb_build_object('request_id', v_req.id)
      );
    end if;
  end loop;

  for v_sess in
    select s.*, r.device_fingerprint
    from public.remote_support_sessions s
    join public.remote_support_requests r on r.id = s.request_id
    where s.status in ('connecting', 'active')
      and s.grant_expires_at <= now ()
      and s.started_at is null
      and (p_shop_id is null or s.shop_id = p_shop_id)
  loop
    update public.remote_support_sessions
    set
      status = 'expired',
      ended_at = now (),
      ended_by = 'system',
      failure_reason = 'grant_expired',
      grant_consumed_at = coalesce(grant_consumed_at, now ())
    where id = v_sess.id
      and status in ('connecting', 'active');
    if found then
      v_n := v_n + 1;
      perform public._remote_support_append_event (
        v_sess.id, v_sess.request_id, v_sess.shop_id, v_sess.shop_device_id, 'system', null, 'request_expired',
        jsonb_build_object('session_id', v_sess.id, 'reason', 'grant_expired')
      );
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'expired_count', v_n);
end;
$$;

revoke all on function public.remote_support_expire_stale (uuid) from public;
grant execute on function public.remote_support_expire_stale (uuid) to authenticated;

create or replace function public.remote_support_request_start (
  p_shop_id uuid,
  p_shop_device_id uuid,
  p_reason_code text,
  p_reason_text text,
  p_support_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.internal_admins%rowtype;
  v_dev public.shop_devices%rowtype;
  v_reason_code text;
  v_reason_text text;
  v_id uuid;
  v_expires timestamptz;
begin
  perform public.remote_support_expire_stale (p_shop_id);

  if auth.uid () is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not public.waka_can_remote_support () then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  select *
  into v_admin
  from public.internal_admins ia
  where ia.user_id = auth.uid ()
    and ia.active = true
  limit 1;

  if v_admin.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  v_reason_code := lower(trim(coalesce(p_reason_code, '')));
  v_reason_text := trim(coalesce(p_reason_text, ''));
  if v_reason_code = '' or char_length(v_reason_text) < 3 then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;

  select *
  into v_dev
  from public.shop_devices d
  where d.id = p_shop_device_id;

  if v_dev.id is null then
    return jsonb_build_object('ok', false, 'error', 'device_not_found');
  end if;
  if v_dev.shop_id is distinct from p_shop_id then
    return jsonb_build_object('ok', false, 'error', 'device_shop_mismatch');
  end if;
  if v_dev.status is distinct from 'active'::public.shop_device_status
    or v_dev.approval_status is distinct from 'approved'
    or v_dev.is_active is not true
  then
    return jsonb_build_object('ok', false, 'error', 'device_not_eligible');
  end if;
  if lower(trim(coalesce(v_dev.platform, ''))) is distinct from 'windows' then
    return jsonb_build_object('ok', false, 'error', 'unsupported_platform');
  end if;
  if v_dev.last_seen_at is null or v_dev.last_seen_at < now () - public.remote_support_online_window () then
    return jsonb_build_object('ok', false, 'error', 'device_offline');
  end if;

  if exists (
    select 1
    from public.remote_support_requests r
    where r.shop_device_id = v_dev.id
      and r.status = 'requested'
  ) or exists (
    select 1
    from public.remote_support_sessions s
    where s.shop_device_id = v_dev.id
      and s.status in ('connecting', 'active')
  ) then
    return jsonb_build_object('ok', false, 'error', 'request_exists');
  end if;

  v_expires := now () + public.remote_support_request_ttl ();

  insert into public.remote_support_requests (
    shop_id, shop_device_id, device_fingerprint, technician_admin_id, technician_user_id,
    reason_code, reason_text, status, requested_at, expires_at, support_request_id
  )
  values (
    p_shop_id, v_dev.id, v_dev.device_fingerprint, v_admin.id, auth.uid (),
    v_reason_code, v_reason_text, 'requested', now (), v_expires, p_support_request_id
  )
  returning id into v_id;

  perform public._remote_support_append_event (
    null, v_id, p_shop_id, v_dev.id, 'technician', auth.uid (), 'request_created',
    jsonb_build_object(
      'request_id', v_id,
      'shop_id', p_shop_id,
      'shop_device_id', v_dev.id,
      'reason_code', v_reason_code
    )
  );
  perform public._remote_support_shop_audit (
    p_shop_id,
    'remote_support_request_created',
    'Remote support requested',
    v_dev.device_fingerprint,
    jsonb_build_object('request_id', v_id, 'reason_code', v_reason_code, 'technician_admin_id', v_admin.id)
  );

  return jsonb_build_object(
    'ok', true,
    'request_id', v_id,
    'status', 'requested',
    'expires_at', v_expires
  );
end;
$$;

revoke all on function public.remote_support_request_start (uuid, uuid, text, text, uuid) from public;
grant execute on function public.remote_support_request_start (uuid, uuid, text, text, uuid) to authenticated;

create or replace function public.remote_support_customer_approve (
  p_request_id uuid,
  p_device_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.remote_support_requests%rowtype;
  v_fp text;
  v_session_id uuid;
  v_grant uuid;
  v_grant_exp timestamptz;
begin
  perform public.remote_support_expire_stale ();

  v_fp := trim(coalesce(p_device_fingerprint, ''));
  if auth.uid () is null or char_length(v_fp) < 8 then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_req from public.remote_support_requests r where r.id = p_request_id;
  if v_req.id is null then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  perform public.remote_support_expire_stale (v_req.shop_id);
  select * into v_req from public.remote_support_requests r where r.id = p_request_id;

  if not public.user_can_access_shop (v_req.shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if v_req.device_fingerprint is distinct from v_fp then
    return jsonb_build_object('ok', false, 'error', 'device_mismatch');
  end if;
  if v_req.status = 'expired' or v_req.expires_at <= now () then
    return jsonb_build_object('ok', false, 'error', 'request_expired');
  end if;
  if v_req.status is distinct from 'requested' then
    return jsonb_build_object('ok', false, 'error', 'invalid_state');
  end if;

  v_grant := gen_random_uuid ();
  v_grant_exp := now () + public.remote_support_grant_ttl ();

  update public.remote_support_requests
  set
    status = 'approved',
    customer_responded_at = now (),
    customer_actor_type = 'member',
    customer_actor_id = auth.uid ()
  where id = v_req.id
    and status = 'requested';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_state');
  end if;

  insert into public.remote_support_sessions (
    request_id, shop_id, shop_device_id, technician_admin_id, status,
    approved_at, grant_jti, grant_expires_at
  )
  values (
    v_req.id, v_req.shop_id, v_req.shop_device_id, v_req.technician_admin_id, 'connecting',
    now (), v_grant, v_grant_exp
  )
  returning id into v_session_id;

  perform public._remote_support_append_event (
    v_session_id, v_req.id, v_req.shop_id, v_req.shop_device_id, 'customer', auth.uid (), 'customer_approved',
    jsonb_build_object('request_id', v_req.id, 'session_id', v_session_id)
  );
  perform public._remote_support_append_event (
    v_session_id, v_req.id, v_req.shop_id, v_req.shop_device_id, 'system', null, 'session_created',
    jsonb_build_object('session_id', v_session_id)
  );
  perform public._remote_support_shop_audit (
    v_req.shop_id,
    'remote_support_customer_approved',
    'Customer approved remote support',
    v_fp,
    jsonb_build_object('request_id', v_req.id, 'session_id', v_session_id)
  );

  return jsonb_build_object(
    'ok', true,
    'request_id', v_req.id,
    'session_id', v_session_id,
    'grant_jti', v_grant,
    'status', 'approved'
  );
end;
$$;

revoke all on function public.remote_support_customer_approve (uuid, text) from public;
grant execute on function public.remote_support_customer_approve (uuid, text) to authenticated;

create or replace function public.remote_support_customer_decline (
  p_request_id uuid,
  p_device_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.remote_support_requests%rowtype;
  v_fp text;
begin
  perform public.remote_support_expire_stale ();

  v_fp := trim(coalesce(p_device_fingerprint, ''));
  if auth.uid () is null or char_length(v_fp) < 8 then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_req from public.remote_support_requests r where r.id = p_request_id;
  if v_req.id is null then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;
  if not public.user_can_access_shop (v_req.shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if v_req.device_fingerprint is distinct from v_fp then
    return jsonb_build_object('ok', false, 'error', 'device_mismatch');
  end if;
  if v_req.status = 'expired' or v_req.expires_at <= now () then
    return jsonb_build_object('ok', false, 'error', 'request_expired');
  end if;
  if v_req.status is distinct from 'requested' then
    return jsonb_build_object('ok', false, 'error', 'invalid_state');
  end if;

  update public.remote_support_requests
  set
    status = 'declined',
    customer_responded_at = now (),
    customer_actor_type = 'member',
    customer_actor_id = auth.uid ()
  where id = v_req.id
    and status = 'requested';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_state');
  end if;

  perform public._remote_support_append_event (
    null, v_req.id, v_req.shop_id, v_req.shop_device_id, 'customer', auth.uid (), 'customer_declined',
    jsonb_build_object('request_id', v_req.id)
  );
  perform public._remote_support_shop_audit (
    v_req.shop_id,
    'remote_support_customer_declined',
    'Customer declined remote support',
    v_fp,
    jsonb_build_object('request_id', v_req.id)
  );

  return jsonb_build_object('ok', true, 'request_id', v_req.id, 'status', 'declined');
end;
$$;

revoke all on function public.remote_support_customer_decline (uuid, text) from public;
grant execute on function public.remote_support_customer_decline (uuid, text) to authenticated;

create or replace function public.remote_support_customer_end (
  p_session_id uuid,
  p_device_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sess public.remote_support_sessions%rowtype;
  v_fp text;
  v_req_fp text;
  v_duration int;
begin
  v_fp := trim(coalesce(p_device_fingerprint, ''));
  if auth.uid () is null or char_length(v_fp) < 8 then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select s.* into v_sess from public.remote_support_sessions s where s.id = p_session_id;
  if v_sess.id is null then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;
  if not public.user_can_access_shop (v_sess.shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select r.device_fingerprint into v_req_fp
  from public.remote_support_requests r
  where r.id = v_sess.request_id;

  if v_req_fp is distinct from v_fp then
    return jsonb_build_object('ok', false, 'error', 'device_mismatch');
  end if;
  if v_sess.status not in ('connecting', 'active') then
    return jsonb_build_object('ok', false, 'error', 'invalid_state');
  end if;

  v_duration := greatest(0, floor(extract(epoch from (now () - v_sess.approved_at)))::int);

  update public.remote_support_sessions
  set
    status = 'ended',
    ended_at = now (),
    ended_by = 'customer',
    duration_seconds = v_duration,
    grant_consumed_at = coalesce(grant_consumed_at, now ()),
    grant_expires_at = least(grant_expires_at, now ())
  where id = v_sess.id
    and status in ('connecting', 'active');

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_state');
  end if;

  perform public._remote_support_append_event (
    v_sess.id, v_sess.request_id, v_sess.shop_id, v_sess.shop_device_id, 'customer', auth.uid (), 'customer_ended',
    jsonb_build_object('session_id', v_sess.id, 'ended_by', 'customer')
  );
  perform public._remote_support_append_event (
    v_sess.id, v_sess.request_id, v_sess.shop_id, v_sess.shop_device_id, 'customer', auth.uid (), 'session_ended',
    jsonb_build_object('session_id', v_sess.id)
  );
  perform public._remote_support_shop_audit (
    v_sess.shop_id,
    'remote_support_customer_ended',
    'Customer ended remote support',
    v_fp,
    jsonb_build_object('session_id', v_sess.id, 'request_id', v_sess.request_id)
  );

  return jsonb_build_object('ok', true, 'session_id', v_sess.id, 'status', 'ended');
end;
$$;

revoke all on function public.remote_support_customer_end (uuid, text) from public;
grant execute on function public.remote_support_customer_end (uuid, text) to authenticated;

create or replace function public.remote_support_technician_cancel (p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.remote_support_requests%rowtype;
  v_admin public.internal_admins%rowtype;
begin
  perform public.remote_support_expire_stale ();

  if auth.uid () is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_admin
  from public.internal_admins ia
  where ia.user_id = auth.uid ()
    and ia.active = true
  limit 1;

  select * into v_req from public.remote_support_requests r where r.id = p_request_id;
  if v_req.id is null then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  if not (
    v_req.technician_admin_id = v_admin.id
    or public.waka_can_remote_support ()
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;
  if v_req.status is distinct from 'requested' then
    return jsonb_build_object('ok', false, 'error', 'invalid_state');
  end if;

  update public.remote_support_requests
  set status = 'cancelled'
  where id = v_req.id
    and status = 'requested';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_state');
  end if;

  perform public._remote_support_append_event (
    null, v_req.id, v_req.shop_id, v_req.shop_device_id, 'technician', auth.uid (), 'technician_cancelled',
    jsonb_build_object('request_id', v_req.id)
  );
  perform public._remote_support_shop_audit (
    v_req.shop_id,
    'remote_support_technician_cancelled',
    'Technician cancelled remote support request',
    v_req.device_fingerprint,
    jsonb_build_object('request_id', v_req.id)
  );

  return jsonb_build_object('ok', true, 'request_id', v_req.id, 'status', 'cancelled');
end;
$$;

revoke all on function public.remote_support_technician_cancel (uuid) from public;
grant execute on function public.remote_support_technician_cancel (uuid) to authenticated;

create or replace function public.remote_support_admin_revoke (
  p_request_id uuid default null,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.remote_support_requests%rowtype;
  v_sess public.remote_support_sessions%rowtype;
begin
  if not public.waka_can_remote_support () then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if p_session_id is not null then
    select * into v_sess from public.remote_support_sessions s where s.id = p_session_id;
    if v_sess.id is null then
      return jsonb_build_object('ok', false, 'error', 'request_not_found');
    end if;
    select * into v_req from public.remote_support_requests r where r.id = v_sess.request_id;
  elsif p_request_id is not null then
    select * into v_req from public.remote_support_requests r where r.id = p_request_id;
    if v_req.id is null then
      return jsonb_build_object('ok', false, 'error', 'request_not_found');
    end if;
    select * into v_sess from public.remote_support_sessions s where s.request_id = v_req.id;
  else
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  if v_req.status = 'requested' then
    update public.remote_support_requests
    set status = 'cancelled'
    where id = v_req.id
      and status = 'requested';
  end if;

  if v_sess.id is not null and v_sess.status in ('connecting', 'active') then
    update public.remote_support_sessions
    set
      status = 'revoked',
      ended_at = now (),
      ended_by = 'admin',
      duration_seconds = greatest(0, floor(extract(epoch from (now () - approved_at)))::int),
      grant_consumed_at = coalesce(grant_consumed_at, now ()),
      grant_expires_at = least(grant_expires_at, now ())
    where id = v_sess.id
      and status in ('connecting', 'active');
  end if;

  perform public._remote_support_append_event (
    v_sess.id, v_req.id, v_req.shop_id, v_req.shop_device_id, 'admin', auth.uid (), 'admin_revoked',
    jsonb_build_object('request_id', v_req.id, 'session_id', v_sess.id)
  );
  if v_sess.id is not null then
    perform public._remote_support_append_event (
      v_sess.id, v_req.id, v_req.shop_id, v_req.shop_device_id, 'admin', auth.uid (), 'session_revoked',
      jsonb_build_object('session_id', v_sess.id)
    );
  end if;
  perform public._remote_support_shop_audit (
    v_req.shop_id,
    'remote_support_admin_revoked',
    'Admin revoked remote support',
    v_req.device_fingerprint,
    jsonb_build_object('request_id', v_req.id, 'session_id', v_sess.id)
  );

  return jsonb_build_object(
    'ok', true,
    'request_id', v_req.id,
    'session_id', v_sess.id,
    'status', 'revoked'
  );
end;
$$;

revoke all on function public.remote_support_admin_revoke (uuid, uuid) from public;
grant execute on function public.remote_support_admin_revoke (uuid, uuid) to authenticated;

create or replace function public.remote_support_grant_assert (
  p_session_id uuid,
  p_grant_jti uuid,
  p_device_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sess public.remote_support_sessions%rowtype;
  v_fp text;
  v_req_fp text;
begin
  v_fp := trim(coalesce(p_device_fingerprint, ''));
  if auth.uid () is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_sess from public.remote_support_sessions s where s.id = p_session_id;
  if v_sess.id is null then
    return jsonb_build_object('ok', false, 'error', 'grant_session_mismatch');
  end if;

  select r.device_fingerprint into v_req_fp
  from public.remote_support_requests r
  where r.id = v_sess.request_id;

  if not (
    public.user_can_access_shop (v_sess.shop_id)
    or public.waka_can_remote_support ()
  ) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if v_sess.grant_jti is distinct from p_grant_jti then
    return jsonb_build_object('ok', false, 'error', 'grant_invalid');
  end if;
  if v_req_fp is distinct from v_fp then
    return jsonb_build_object('ok', false, 'error', 'grant_device_mismatch');
  end if;
  if v_sess.grant_consumed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'grant_replayed');
  end if;
  if v_sess.grant_expires_at <= now () then
    return jsonb_build_object('ok', false, 'error', 'grant_expired');
  end if;
  if v_sess.status not in ('connecting', 'active') then
    return jsonb_build_object('ok', false, 'error', 'grant_invalid');
  end if;

  update public.remote_support_sessions
  set grant_consumed_at = now ()
  where id = v_sess.id
    and grant_consumed_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'grant_replayed');
  end if;

  perform public._remote_support_append_event (
    v_sess.id, v_sess.request_id, v_sess.shop_id, v_sess.shop_device_id, 'system', auth.uid (), 'grant_asserted',
    jsonb_build_object('session_id', v_sess.id)
  );

  return jsonb_build_object('ok', true, 'session_id', v_sess.id, 'status', v_sess.status);
end;
$$;

revoke all on function public.remote_support_grant_assert (uuid, uuid, text) from public;
grant execute on function public.remote_support_grant_assert (uuid, uuid, text) to authenticated;

create or replace function public.remote_support_customer_inbox (p_device_fingerprint text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fp text;
  v_req jsonb;
  v_sess jsonb;
  v_admin_name text;
begin
  v_fp := trim(coalesce(p_device_fingerprint, ''));
  if auth.uid () is null or char_length(v_fp) < 8 then
    return jsonb_build_object('request', null, 'session', null);
  end if;

  select jsonb_build_object(
    'id', r.id,
    'shop_id', r.shop_id,
    'shop_device_id', r.shop_device_id,
    'device_fingerprint', r.device_fingerprint,
    'technician_admin_id', r.technician_admin_id,
    'technician_user_id', r.technician_user_id,
    'technician_name', coalesce(nullif(trim(ia.full_name), ''), ia.email, 'WAKA Support'),
    'reason_code', r.reason_code,
    'reason_text', r.reason_text,
    'status', r.status,
    'requested_at', r.requested_at,
    'expires_at', r.expires_at,
    'customer_responded_at', r.customer_responded_at,
    'customer_actor_type', r.customer_actor_type,
    'customer_actor_id', r.customer_actor_id,
    'support_request_id', r.support_request_id
  ),
    coalesce(nullif(trim(ia.full_name), ''), ia.email, 'WAKA Support')
  into v_req, v_admin_name
  from public.remote_support_requests r
  join public.internal_admins ia on ia.id = r.technician_admin_id
  where r.device_fingerprint = v_fp
    and r.status = 'requested'
    and r.expires_at > now ()
    and public.user_can_access_shop (r.shop_id)
  order by r.requested_at desc
  limit 1;

  select jsonb_build_object(
    'id', s.id,
    'request_id', s.request_id,
    'shop_id', s.shop_id,
    'shop_device_id', s.shop_device_id,
    'technician_admin_id', s.technician_admin_id,
    'technician_name', coalesce(v_admin_name, coalesce(nullif(trim(ia.full_name), ''), ia.email, 'WAKA Support')),
    'status', s.status,
    'approved_at', s.approved_at,
    'started_at', s.started_at,
    'ended_at', s.ended_at,
    'duration_seconds', s.duration_seconds,
    'ended_by', s.ended_by,
    'failure_reason', s.failure_reason,
    'grant_jti', s.grant_jti,
    'grant_expires_at', s.grant_expires_at,
    'grant_consumed_at', s.grant_consumed_at,
    'transport_session_ref', s.transport_session_ref
  )
  into v_sess
  from public.remote_support_sessions s
  join public.remote_support_requests r on r.id = s.request_id
  join public.internal_admins ia on ia.id = s.technician_admin_id
  where r.device_fingerprint = v_fp
    and s.status in ('connecting', 'active')
    and public.user_can_access_shop (s.shop_id)
  order by s.approved_at desc
  limit 1;

  return jsonb_build_object('request', v_req, 'session', v_sess);
end;
$$;

revoke all on function public.remote_support_customer_inbox (text) from public;
grant execute on function public.remote_support_customer_inbox (text) to authenticated;

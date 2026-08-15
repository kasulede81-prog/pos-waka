-- RS-1.2: Remote Support control-plane hardening.
-- Does not change shop_devices, device enrollment, or transport.
--
-- Identity limitation (do not pretend this is hardware auth):
-- WAKA POS device identity is the localStorage key waka-pos-device-id.
-- Inbox/approve still take a caller-supplied fingerprint and bind it to the
-- current shop_devices row. This closes Remote Support table/RPC discovery
-- of another device's request. It does not invent a TPM/machine credential.

-- ---------- Current-state eligibility (same rules as request_start) ----------
create or replace function public._remote_support_device_is_eligible (p_shop_device_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dev public.shop_devices%rowtype;
begin
  if p_shop_device_id is null then
    return false;
  end if;

  select * into v_dev from public.shop_devices d where d.id = p_shop_device_id;
  if v_dev.id is null then
    return false;
  end if;
  if v_dev.status is distinct from 'active'::public.shop_device_status then
    return false;
  end if;
  if v_dev.approval_status is distinct from 'approved' then
    return false;
  end if;
  if v_dev.is_active is not true then
    return false;
  end if;
  if lower(trim(coalesce(v_dev.platform, ''))) is distinct from 'windows' then
    return false;
  end if;
  if v_dev.last_seen_at is null or v_dev.last_seen_at < now () - public.remote_support_online_window () then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public._remote_support_device_is_eligible (uuid) from public;

-- ---------- RLS: no shop-member SELECT; staff limited to canRemoteSupport ----------
drop policy if exists remote_support_requests_shop_select on public.remote_support_requests;
drop policy if exists remote_support_sessions_shop_select on public.remote_support_sessions;
drop policy if exists remote_support_session_events_shop_select on public.remote_support_session_events;

drop policy if exists remote_support_requests_staff_select on public.remote_support_requests;
create policy remote_support_requests_staff_select
  on public.remote_support_requests for select
  using (public.waka_can_remote_support ());

drop policy if exists remote_support_sessions_staff_select on public.remote_support_sessions;
create policy remote_support_sessions_staff_select
  on public.remote_support_sessions for select
  using (public.waka_can_remote_support ());

drop policy if exists remote_support_session_events_staff_select on public.remote_support_session_events;
create policy remote_support_session_events_staff_select
  on public.remote_support_session_events for select
  using (public.waka_can_remote_support ());

-- Still no INSERT/UPDATE/DELETE policies. Mutations remain SECURITY DEFINER RPCs.

-- grant_jti is not a client-facing column. A table-level GRANT SELECT
-- still covers every column, so column REVOKE alone is not enough.
-- Re-issue SELECT on the operational columns only. SECURITY DEFINER RPCs
-- still read grant_jti as the table owner.
revoke select on public.remote_support_sessions from public, anon, authenticated;
grant select (
  id,
  request_id,
  shop_id,
  shop_device_id,
  technician_admin_id,
  status,
  approved_at,
  started_at,
  ended_at,
  duration_seconds,
  ended_by,
  failure_reason,
  grant_expires_at,
  grant_consumed_at,
  transport_session_ref,
  created_at,
  updated_at
) on public.remote_support_sessions to authenticated;

-- ---------- Expire TTL + ineligible devices ----------
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
      and (p_shop_id is null or r.shop_id = p_shop_id)
      and (
        r.expires_at <= now ()
        or not public._remote_support_device_is_eligible (r.shop_device_id)
      )
  loop
    update public.remote_support_requests
    set status = 'expired'
    where id = v_req.id
      and status = 'requested';
    if found then
      v_n := v_n + 1;
      perform public._remote_support_append_event (
        null, v_req.id, v_req.shop_id, v_req.shop_device_id, 'system', null, 'request_expired',
        jsonb_build_object(
          'request_id', v_req.id,
          'reason', case
            when v_req.expires_at <= now () then 'ttl'
            else 'device_no_longer_eligible'
          end
        )
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
      and (p_shop_id is null or s.shop_id = p_shop_id)
      and (
        (s.grant_expires_at <= now () and s.started_at is null)
        or not public._remote_support_device_is_eligible (s.shop_device_id)
      )
  loop
    update public.remote_support_sessions
    set
      status = case
        when public._remote_support_device_is_eligible (v_sess.shop_device_id) then 'expired'
        else 'revoked'
      end,
      ended_at = now (),
      ended_by = 'system',
      failure_reason = case
        when public._remote_support_device_is_eligible (v_sess.shop_device_id) then 'grant_expired'
        else 'device_no_longer_eligible'
      end,
      grant_consumed_at = coalesce(grant_consumed_at, now ()),
      grant_expires_at = least(grant_expires_at, now ())
    where id = v_sess.id
      and status in ('connecting', 'active');
    if found then
      v_n := v_n + 1;
      perform public._remote_support_append_event (
        v_sess.id, v_sess.request_id, v_sess.shop_id, v_sess.shop_device_id, 'system', null,
        case
          when public._remote_support_device_is_eligible (v_sess.shop_device_id) then 'request_expired'
          else 'session_revoked'
        end,
        jsonb_build_object('session_id', v_sess.id)
      );
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'expired_count', v_n);
end;
$$;

-- ---------- Request start: shared eligibility + clean unique conflict ----------
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

  select * into v_dev from public.shop_devices d where d.id = p_shop_device_id;
  if v_dev.id is null then
    return jsonb_build_object('ok', false, 'error', 'device_not_found');
  end if;
  if v_dev.shop_id is distinct from p_shop_id then
    return jsonb_build_object('ok', false, 'error', 'device_shop_mismatch');
  end if;
  if not public._remote_support_device_is_eligible (v_dev.id) then
    if lower(trim(coalesce(v_dev.platform, ''))) is distinct from 'windows' then
      return jsonb_build_object('ok', false, 'error', 'unsupported_platform');
    end if;
    if v_dev.last_seen_at is null or v_dev.last_seen_at < now () - public.remote_support_online_window () then
      return jsonb_build_object('ok', false, 'error', 'device_offline');
    end if;
    return jsonb_build_object('ok', false, 'error', 'device_not_eligible');
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

  begin
    insert into public.remote_support_requests (
      shop_id, shop_device_id, device_fingerprint, technician_admin_id, technician_user_id,
      reason_code, reason_text, status, requested_at, expires_at, support_request_id
    )
    values (
      p_shop_id, v_dev.id, v_dev.device_fingerprint, v_admin.id, auth.uid (),
      v_reason_code, v_reason_text, 'requested', now (), v_expires, p_support_request_id
    )
    returning id into v_id;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'request_exists');
  end;

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

-- ---------- Approve: re-check current device; no grant_jti in response ----------
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
  v_dev public.shop_devices%rowtype;
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

  select * into v_dev from public.shop_devices d where d.id = v_req.shop_device_id;
  if v_dev.id is null
    or v_dev.shop_id is distinct from v_req.shop_id
    or v_dev.device_fingerprint is distinct from v_req.device_fingerprint
    or not public._remote_support_device_is_eligible (v_dev.id)
  then
    update public.remote_support_requests
    set status = 'expired'
    where id = v_req.id
      and status = 'requested';
    perform public._remote_support_append_event (
      null, v_req.id, v_req.shop_id, v_req.shop_device_id, 'system', auth.uid (), 'request_expired',
      jsonb_build_object('request_id', v_req.id, 'reason', 'device_no_longer_eligible')
    );
    return jsonb_build_object('ok', false, 'error', 'device_no_longer_eligible');
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
    and status = 'requested'
    and exists (
      select 1
      from public.shop_devices d
      where d.id = v_req.shop_device_id
        and d.shop_id = v_req.shop_id
        and d.device_fingerprint = v_req.device_fingerprint
        and public._remote_support_device_is_eligible (d.id)
    );

  if not found then
    return jsonb_build_object('ok', false, 'error', 'device_no_longer_eligible');
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
    'status', 'approved'
  );
end;
$$;

-- ---------- Grant assert: atomic consume + current device eligibility ----------
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
  v_consumed uuid;
  v_status text;
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
  if not public._remote_support_device_is_eligible (v_sess.shop_device_id) then
    update public.remote_support_sessions
    set
      status = 'revoked',
      ended_at = now (),
      ended_by = 'system',
      failure_reason = 'device_no_longer_eligible',
      grant_consumed_at = coalesce(grant_consumed_at, now ()),
      grant_expires_at = least(grant_expires_at, now ())
    where id = v_sess.id
      and status in ('connecting', 'active');
    perform public._remote_support_append_event (
      v_sess.id, v_sess.request_id, v_sess.shop_id, v_sess.shop_device_id, 'system', auth.uid (), 'session_revoked',
      jsonb_build_object('session_id', v_sess.id, 'reason', 'device_no_longer_eligible')
    );
    return jsonb_build_object('ok', false, 'error', 'device_no_longer_eligible');
  end if;

  update public.remote_support_sessions s
  set grant_consumed_at = now ()
  where s.id = v_sess.id
    and s.grant_jti = p_grant_jti
    and s.grant_consumed_at is null
    and s.grant_expires_at > now ()
    and s.status in ('connecting', 'active')
    and exists (
      select 1
      from public.remote_support_requests r
      join public.shop_devices d on d.id = s.shop_device_id
      where r.id = s.request_id
        and r.device_fingerprint = v_fp
        and d.shop_id = s.shop_id
        and d.device_fingerprint = r.device_fingerprint
        and public._remote_support_device_is_eligible (d.id)
    )
  returning s.id, s.status into v_consumed, v_status;

  if v_consumed is null then
    return jsonb_build_object('ok', false, 'error', 'grant_replayed');
  end if;

  perform public._remote_support_append_event (
    v_sess.id, v_sess.request_id, v_sess.shop_id, v_sess.shop_device_id, 'system', auth.uid (), 'grant_asserted',
    jsonb_build_object('session_id', v_sess.id)
  );

  return jsonb_build_object('ok', true, 'session_id', v_sess.id, 'status', v_status);
end;
$$;

-- ---------- Inbox: this device only; no grant_jti / internal ids ----------
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
    'technician_name', coalesce(nullif(trim(ia.full_name), ''), 'WAKA Support'),
    'reason_code', r.reason_code,
    'reason_text', r.reason_text,
    'status', r.status,
    'requested_at', r.requested_at,
    'expires_at', r.expires_at
  )
  into v_req
  from public.remote_support_requests r
  join public.internal_admins ia on ia.id = r.technician_admin_id
  join public.shop_devices d on d.id = r.shop_device_id
  where r.device_fingerprint = v_fp
    and d.device_fingerprint = v_fp
    and d.shop_id = r.shop_id
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
    'technician_name', coalesce(nullif(trim(ia.full_name), ''), 'WAKA Support'),
    'status', s.status,
    'approved_at', s.approved_at
  )
  into v_sess
  from public.remote_support_sessions s
  join public.remote_support_requests r on r.id = s.request_id
  join public.internal_admins ia on ia.id = s.technician_admin_id
  join public.shop_devices d on d.id = s.shop_device_id
  where r.device_fingerprint = v_fp
    and d.device_fingerprint = v_fp
    and d.shop_id = s.shop_id
    and s.status in ('connecting', 'active')
    and public.user_can_access_shop (s.shop_id)
  order by s.approved_at desc
  limit 1;

  return jsonb_build_object('request', v_req, 'session', v_sess);
end;
$$;

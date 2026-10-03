-- ============================================================================
-- Phase 4 — Staff credential delivery lockdown
-- ============================================================================
-- Closes the items Phase 3 left open:
--
--   * shop_pos_staff_download() returned pin_hash / password_hash to any member,
--     and accepted p_device_fingerprint WITHOUT EVER READING IT — the device
--     parameter was decoration, not a control.
--   * shop_device_set_approval() skipped its device check entirely when the actor
--     fingerprint was null or blank.
--   * Ten staff SECURITY DEFINER functions carried anon EXECUTE they can never use.
--   * shop_pos_staff_write / shop_members_update / shop_members_delete survived
--     Phase 2 and 3 as unreachable policies.
--
-- Does NOT touch invitation architecture, Google auth, or Phase 2/3 protections.

-- ----------------------------------------------------------------------------
-- 1. Credential delivery is device-scoped
-- ----------------------------------------------------------------------------
-- AUTHORIZATION MODEL (explicit):
--
--   A credential download requires ALL of:
--     a. an authenticated, email-verified caller        (require_verified_email_for_cloud)
--     b. authority to manage the shop                   (user_can_manage_shop:
--                                                        owner, manager, or the
--                                                        organisation's owner/admin)
--     c. the shop in question                           (server-derived from p_shop_id,
--                                                        never a client-chosen target
--                                                        beyond it)
--     d. an approved, operational device OF THAT SHOP   (shop_device_can_manage_staff,
--                                                        matched on fingerprint)
--
-- Why manager-and-above rather than any member: the payload is the complete
-- credential set for every staff member in the shop. Membership alone must not
-- be an extraction capability. Owner/manager is the "operational manager/device
-- workflow" the source of truth permits, and it is what the POS setup flow
-- already does — the owner or a manager signs in on the terminal and provisions
-- it.
--
-- Why the device is the second half of the control: a matching fingerprint ties
-- delivery to a registered terminal for this shop. It rejects a signed-in member
-- pulling hashes from an unregistered browser or handset, a device belonging to
-- another shop, and a revoked/suspended terminal.
--
-- Fail-closed shape: both failures RAISE rather than returning {ok:false}. The
-- client (downloadStaffDelta) only treats a thrown error as "no data" and leaves
-- the cache alone; a returned error object would be parsed as a successful,
-- empty delta and could clear the on-device cache.
--
-- Offline PIN verification is unchanged: the terminal still receives hashes,
-- stores them locally, and verifies PINs offline with staffSecretMatchesAsync.
-- Only WHO may fetch and on WHAT device has changed.
create or replace function public.shop_pos_staff_download (
  p_shop_id uuid,
  p_local_version bigint default 0,
  p_device_fingerprint text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_version bigint;
  v_changed jsonb;
  v_removed jsonb;
begin
  perform public.require_verified_email_for_cloud ();

  if not public.user_can_manage_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  -- Credential material is delivered only to an approved operational device of
  -- this shop. A null or blank fingerprint is a denial, not a bypass.
  if not public.shop_device_can_manage_staff (p_shop_id, p_device_fingerprint) then
    raise exception 'device_not_authorized';
  end if;

  select sh.staff_version
  into v_version
  from public.shops sh
  where sh.id = p_shop_id;

  v_version := coalesce (v_version, 1);

  if p_local_version >= v_version and p_local_version > 0 then
    return jsonb_build_object (
      'ok', true,
      'unchanged', true,
      'version', v_version,
      'changed', '[]'::jsonb,
      'removed_client_ids', '[]'::jsonb
    );
  end if;

  if coalesce (p_local_version, 0) <= 0 then
    select coalesce(
      jsonb_agg (
        jsonb_build_object (
          'id', s.id,
          'client_id', s.client_id,
          'name', s.name,
          'username', s.username,
          'role', s.role,
          'pin_hash', s.pin_hash,
          'password_hash', s.password_hash,
          'phone_e164', s.phone_e164,
          'email', s.email,
          'permissions', s.permissions,
          'is_active', s.is_active,
          'user_id', s.user_id,
          'last_login_at', s.last_login_at,
          'last_device_fingerprint', s.last_device_fingerprint,
          'failed_pin_attempts', s.failed_pin_attempts,
          'locked_until', s.locked_until,
          'last_failed_login_at', s.last_failed_login_at,
          'created_at', s.created_at,
          'updated_at', s.updated_at
        )
        order by s.created_at asc
      ),
      '[]'::jsonb
    )
    into v_changed
    from public.shop_pos_staff s
    where s.shop_id = p_shop_id
      and s.deleted_at is null;
  else
    select coalesce(
      jsonb_agg (
        jsonb_build_object (
          'id', s.id,
          'client_id', s.client_id,
          'name', s.name,
          'username', s.username,
          'role', s.role,
          'pin_hash', s.pin_hash,
          'password_hash', s.password_hash,
          'phone_e164', s.phone_e164,
          'email', s.email,
          'permissions', s.permissions,
          'is_active', s.is_active,
          'user_id', s.user_id,
          'last_login_at', s.last_login_at,
          'last_device_fingerprint', s.last_device_fingerprint,
          'failed_pin_attempts', s.failed_pin_attempts,
          'locked_until', s.locked_until,
          'last_failed_login_at', s.last_failed_login_at,
          'created_at', s.created_at,
          'updated_at', s.updated_at
        )
      ),
      '[]'::jsonb
    )
    into v_changed
    from public.shop_pos_staff s
    where s.shop_id = p_shop_id
      and s.deleted_at is null
      and s.client_id in (
        select r.staff_client_id
        from public.shop_pos_staff_revisions r
        where r.shop_id = p_shop_id
          and r.shop_version > p_local_version
          and r.action = 'upsert'
          and r.staff_client_id is not null
      );
  end if;

  select coalesce(
    jsonb_agg (distinct r.staff_client_id),
    '[]'::jsonb
  )
  into v_removed
  from public.shop_pos_staff_revisions r
  where r.shop_id = p_shop_id
    and r.shop_version > coalesce (p_local_version, 0)
    and r.action = 'delete'
    and r.staff_client_id is not null;

  return jsonb_build_object (
    'ok', true,
    'unchanged', false,
    'version', v_version,
    'changed', coalesce (v_changed, '[]'::jsonb),
    'removed_client_ids', coalesce (v_removed, '[]'::jsonb)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Device approval fails closed on a missing actor fingerprint
-- ----------------------------------------------------------------------------
-- The previous body guarded with `if v_fp is not null and not <device check>`,
-- so a null or blank actor fingerprint skipped the check completely. The check is
-- now unconditional; shop_device_can_manage_staff() already returns false for a
-- null/blank fingerprint (Phase 3), so this is a denial rather than a bypass.
--
-- Owner authority, the device-limit path, cross-shop isolation (the target device
-- must belong to p_shop_id) and the audit entry are all preserved unchanged.
create or replace function public.shop_device_set_approval (
  p_shop_id uuid,
  p_device_id uuid,
  p_approval_status text,
  p_actor_device_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fp text;
  v_row public.shop_devices%rowtype;
  v_limit int;
  v_active int;
begin
  perform public.require_verified_email_for_cloud();

  if not public.user_is_shop_owner(p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if p_approval_status not in ('pending', 'approved', 'suspended', 'revoked', 'disabled') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  v_fp := nullif(trim(coalesce(p_actor_device_fingerprint, '')), '');
  -- Fail closed: an unidentified actor device cannot approve anything.
  if not public.shop_device_can_manage_staff(p_shop_id, v_fp) then
    return jsonb_build_object('ok', false, 'error', 'not_primary_device');
  end if;

  select d.*
  into v_row
  from public.shop_devices d
  where d.id = p_device_id
    and d.shop_id = p_shop_id;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'device_not_found');
  end if;

  if p_approval_status = 'approved' and v_row.approval_status <> 'approved' then
    select dl.device_limit into v_limit from public.resolve_shop_device_limit(p_shop_id) dl;
    v_active := public.count_shop_active_devices(p_shop_id, null);
    if v_limit is not null and v_active >= v_limit then
      return jsonb_build_object(
        'ok', false,
        'limit_blocked', true,
        'error', 'device_limit_reached',
        'device_limit', v_limit,
        'active_count', v_active
      );
    end if;
  end if;

  update public.shop_devices d
  set
    approval_status = p_approval_status,
    status = case
      when p_approval_status = 'approved' then 'active'::public.shop_device_status
      when p_approval_status in ('revoked', 'disabled', 'suspended') then 'revoked'::public.shop_device_status
      when p_approval_status = 'pending' then 'disconnected'::public.shop_device_status
      else d.status
    end,
    updated_at = now()
  where d.id = p_device_id;

  perform public.refresh_shop_active_device_count(p_shop_id);

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid(),
    'owner',
    case
      when p_approval_status = 'approved' then 'device_approved'
      when p_approval_status = 'revoked' then 'device_revoked'
      else 'device_approval_changed'
    end,
    'Device approval status changed',
    jsonb_build_object('device_id', p_device_id, 'approval_status', p_approval_status)
  );

  return jsonb_build_object('ok', true, 'device_id', p_device_id, 'approval_status', p_approval_status);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Retire anon EXECUTE on staff SECURITY DEFINER functions
-- ----------------------------------------------------------------------------
-- Every one of these begins with require_verified_email_for_cloud() and/or an
-- auth.uid()-based predicate, so an anonymous caller can never succeed — the
-- grant is pure surface area. Each was traced to its caller: all are invoked from
-- the authenticated client (src/lib/shopStaffCloud.ts, staffCacheSync.ts,
-- staffLoginSecurity.ts), or from inside other SECURITY DEFINER functions, which
-- execute as the definer and do not need the caller to hold EXECUTE.
--
-- Deliberately NOT revoked, with reasons:
--   * is_waka_internal_staff() — referenced by RLS policies on app_crash_events,
--     subscriptions, audit_logs and profiles. A policy expression is evaluated as
--     the querying role, so anon needs EXECUTE to evaluate it at all; revoking it
--     would turn anon reads on those tables into errors. It only ever returns a
--     boolean about internal staff, so it discloses nothing.
--   * admin_shop_reset_all_staff_credentials() and shop_get_staff_sales_summary()
--     are internal-support surfaces outside this phase's scope; they remain
--     anon-executable and are recorded as a residual item.
-- Guarded with to_regprocedure because a bare `revoke ... on function` raises if
-- the signature is absent, which would abort the whole migration. That matters
-- here: Phase 3 drops the 2-argument shop_pos_staff_upsert overload, and the
-- staff RPC set has already changed shape several times (123 -> 126 -> 136 -> 163).
do $revoke$
declare
  sig text;
begin
  foreach sig in array array[
    'public.shop_pos_staff_list (uuid)',
    'public.shop_pos_staff_download (uuid, bigint, text)',
    'public.shop_pos_staff_upsert (uuid, jsonb, text)',
    'public.shop_pos_staff_upsert (uuid, jsonb)',
    'public.shop_pos_staff_delete (uuid, uuid, text)',
    'public.shop_pos_staff_delete (uuid, uuid)',
    'public.shop_pos_staff_set_active (uuid, uuid, boolean, text)',
    'public.shop_pos_staff_set_active (uuid, uuid, boolean)',
    'public.shop_pos_staff_unlock (uuid, uuid, text)',
    'public.shop_pos_staff_record_login (uuid, uuid, text, boolean, integer, integer, text, boolean)',
    'public.shop_pos_staff_record_security_event (uuid, uuid, text, text, text, boolean, text, jsonb)',
    'public.shop_pos_staff_import_local (uuid, jsonb)',
    'public.shop_pos_staff_version (uuid)',
    'public.shop_device_can_manage_staff (uuid, text)'
  ] loop
    if to_regprocedure (sig) is not null then
      execute format ('revoke all on function %s from anon', sig);
    end if;
  end loop;
end;
$revoke$;

-- ----------------------------------------------------------------------------
-- 4. Retire the unreachable write policies
-- ----------------------------------------------------------------------------
-- Phase 2 revoked UPDATE/DELETE on shop_members from authenticated and Phase 3
-- revoked the writes on shop_pos_staff, which made these three policies
-- unreachable. They are dropped rather than left in place because of what
-- happens if a grant is ever restored: with the policy present, a restored grant
-- silently re-opens manager-level writes; with the policy gone, RLS is
-- default-deny and the table stays closed until someone deliberately re-creates
-- both grant and policy.
--
-- Read paths are untouched: shop_members_select and shop_pos_staff_select remain.
drop policy if exists shop_pos_staff_write on public.shop_pos_staff;
drop policy if exists shop_members_update on public.shop_members;
drop policy if exists shop_members_delete on public.shop_members;

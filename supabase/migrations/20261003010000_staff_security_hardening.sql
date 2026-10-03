-- ============================================================================
-- Phase 3 — Staff security & credential protection (H1-H4, M2, M3)
-- ============================================================================
-- Phase 1 confirmed the repository and production definitions are identical, so
-- every statement below is written against the live definitions captured there.
--
-- Findings addressed:
--
--   H1  disabled/deleted staff keep cloud access, because access is decided only
--       by shop_members and nothing consults the staff profile's own state.
--   H2  shop_members.role and shop_pos_staff.role drift apart in both directions.
--   H3  shop_pos_staff_list() is gated by user_can_access_shop() — ANY member —
--       and returns pin_hash and password_hash for every staff member.
--   H4  shop_pos_staff_write is FOR ALL and admits role in ('owner','manager'),
--       so a manager can rewrite user_id / role / permissions / email / hashes.
--   M2  shop_device_can_manage_staff() returns TRUE for a null fingerprint, so
--       every staff RPC that passes one through is device-check-bypassable; a
--       2-argument shop_pos_staff_upsert() overload still exists.
--   M3  shop_pos_staff_unlock() is gated by user_can_access_shop(), so a cashier
--       or viewer on any approved device can clear another staff member's lockout.
--
-- Not in this phase: Google-first invitation acceptance (Phase 5), invitation UX
-- (Phase 6), per-staff permission model (Phase 7).
--
-- Relationship to Phase 2 (20261003000000_shop_membership_lockdown.sql):
-- that migration owns shop_members writes and the owner-protection trigger. This
-- one does not touch either.

-- ----------------------------------------------------------------------------
-- H4 — Remove the direct staff write path
-- ----------------------------------------------------------------------------
-- The application already performs every staff mutation through SECURITY DEFINER
-- RPCs (shop_pos_staff_upsert / _delete / _set_active / _import_local); nothing
-- in src/ or supabase/functions/ writes the table directly. Those RPCs run as
-- the definer and are unaffected by this revoke.
--
-- TRUNCATE because it destroys the same protected data and no client role needs it.
revoke insert, update, delete, truncate on table public.shop_pos_staff from authenticated;
revoke insert, update, delete, truncate on table public.shop_pos_staff from anon;

-- ----------------------------------------------------------------------------
-- H3 — Stop returning credential hashes from the any-member staff list
-- ----------------------------------------------------------------------------
-- shop_pos_staff_list() is the cloud read used for the staff screen and for team
-- counts. It is gated by user_can_access_shop(), which is true for cashier,
-- waiter, stock_keeper and viewer as well as owner and manager — so it handed
-- every member the PIN and password hashes of every colleague.
--
-- Hashes are replaced with null, not omitted, so the response shape the client
-- types expect is preserved.
--
-- NOTE on shop_pos_staff_download(): that RPC deliberately KEEPS the hashes. It
-- is the offline shared-terminal sync path — the device verifies PINs locally
-- with staffSecretMatchesAsync({ pinHash }) while offline, so removing them there
-- would break offline staff login. It is a separate, device-parameterised path
-- and is left as-is; narrowing it is an architectural change, not a Phase 3 one.
create or replace function public.shop_pos_staff_list (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j jsonb;
begin
  perform public.require_verified_email_for_cloud ();

  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  select coalesce(
    jsonb_agg (
      jsonb_build_object (
        'id', s.id,
        'client_id', s.client_id,
        'name', s.name,
        'username', s.username,
        'role', s.role,
        -- Credential material is never returned to a shop member. A caller that
        -- legitimately needs to verify a PIN does so server-side, or through the
        -- device-scoped offline sync path.
        'pin_hash', null,
        'password_hash', null,
        'phone_e164', s.phone_e164,
        'email', s.email,
        'permissions', coalesce (s.permissions, '[]'::jsonb),
        'is_active', s.is_active,
        'user_id', s.user_id,
        'last_login_at', s.last_login_at,
        'last_device_fingerprint', s.last_device_fingerprint,
        'last_login_platform', s.last_login_platform,
        'failed_pin_attempts', s.failed_pin_attempts,
        'locked_until', s.locked_until,
        'last_failed_login_at', s.last_failed_login_at,
        'first_failed_login_at', s.first_failed_login_at,
        'failures_in_window', s.failures_in_window,
        'failure_window_started_at', s.failure_window_started_at,
        'pin_changed_at', s.pin_changed_at,
        'password_changed_at', s.password_changed_at,
        'created_at', s.created_at,
        'updated_at', s.updated_at
      )
      order by s.created_at asc
    ),
    '[]'::jsonb
  )
  into j
  from public.shop_pos_staff s
  where s.shop_id = p_shop_id
    and s.deleted_at is null;

  return j;
end;
$$;

-- ----------------------------------------------------------------------------
-- M2 — Device authority must fail closed
-- ----------------------------------------------------------------------------
-- Returning TRUE for a blank fingerprint meant "no fingerprint supplied => skip
-- the device check". Every staff RPC passes its fingerprint parameter (or null)
-- straight in, so omitting the argument bypassed device authority entirely.
--
-- A missing fingerprint is now a denial. Clients that legitimately manage staff
-- always send a real fingerprint (the app calls getOrCreateDeviceId()), and
-- server-side paths that must bypass devices use a different mechanism.
create or replace function public.shop_device_can_manage_staff (
  p_shop_id uuid,
  p_device_fingerprint text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fp text;
begin
  if p_shop_id is null then
    return false;
  end if;

  v_fp := nullif (trim (coalesce (p_device_fingerprint, '')), '');

  -- Fail closed: an unidentified device is not an authorised device.
  if v_fp is null then
    return false;
  end if;

  return exists (
    select 1
    from public.shop_devices d
    where d.shop_id = p_shop_id
      and d.device_fingerprint = v_fp
      and public.shop_device_is_operational (d.approval_status, d.status)
  );
end;
$$;

-- Retire the 2-argument overload. It wrote staff rows with no device argument at
-- all; the application calls the 3-argument form.
drop function if exists public.shop_pos_staff_upsert (uuid, jsonb);

-- ----------------------------------------------------------------------------
-- H1 — A disabled or deleted staff profile loses cloud access
-- ----------------------------------------------------------------------------
-- Access was decided purely by shop_members, so disabling or deleting a staff
-- profile left the person's membership intact and their cloud access working.
--
-- The rule, restricted to non-owners so an owner can never lock themselves out:
--   * an owner of the shop always keeps access;
--   * an organisation owner/admin always keeps access (they are not shop staff);
--   * anyone else who HAS a linked shop_pos_staff row in this shop loses access
--     while that row is is_active = false or deleted_at is not null.
--
-- A user with no staff row at all is unaffected: shop-only members such as an
-- owner's own account, or an org admin with no POS profile, keep working.
create or replace function public.user_can_access_shop (p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = p_shop
      and sm.user_id = auth.uid ()
      and (
        sm.role = 'owner'
        or not exists (
          select 1
          from public.shop_pos_staff s
          where s.shop_id = p_shop
            and s.user_id = auth.uid ()
            and (s.is_active = false or s.deleted_at is not null)
        )
      )
  )
  or exists (
    select 1
    from public.shops sh
    join public.organization_members om on om.organization_id = sh.organization_id
    where sh.id = p_shop
      and om.user_id = auth.uid ()
      and om.role in ('owner', 'admin')
  );
$$;

-- ----------------------------------------------------------------------------
-- M3 — Lockout state is not an any-member operation
-- ----------------------------------------------------------------------------
-- Clearing another staff member's lockout was gated by user_can_access_shop()
-- plus an approved device, so any cashier or viewer could unlock any colleague.
-- It now requires a member who may manage the shop (owner, manager, or the
-- organisation's owner/admin) on an approved device.
--
-- Staff self-service is unaffected: a staff member who simply signs in again
-- after their lockout expires does not call this RPC — it exists for a manager
-- to release a colleague, and it now requires exactly that authority.
create or replace function public.shop_pos_staff_unlock (
  p_shop_id uuid,
  p_client_id uuid,
  p_device_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_can_manage_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if not public.shop_device_can_manage_staff (p_shop_id, p_device_fingerprint) then
    return jsonb_build_object ('ok', false, 'error', 'device_not_authorized');
  end if;

  update public.shop_pos_staff s
  set
    failed_pin_attempts = 0,
    locked_until = null,
    last_failed_login_at = null,
    first_failed_login_at = null,
    failures_in_window = 0,
    failure_window_started_at = null,
    updated_at = now ()
  where s.shop_id = p_shop_id
    and s.client_id = p_client_id
    and s.deleted_at is null;

  return jsonb_build_object ('ok', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- H2 — Stop membership role and POS role drifting apart
-- ----------------------------------------------------------------------------
-- Authority split, now explicit:
--
--   shop_members.role    = CLOUD authority. RLS and every access predicate read
--                          this. A POS role can never grant cloud access.
--   shop_pos_staff.role  = POS/operational role: what the terminal shows and
--                          which local workflow a staff member may run.
--
-- Demoting someone in shop_members previously left their shop_pos_staff.role
-- untouched, so a member reduced to 'viewer' kept an elevated POS role on the
-- terminal. The trigger below mirrors a membership role change onto the linked
-- staff row.
--
-- The two role vocabularies are NOT the same set, which is why this is an
-- explicit map rather than a reuse of staff_v2_membership_role_for_pos_role():
-- that function maps POS -> membership, and this needs the inverse.
--
--   shop_members.role   ->  shop_pos_staff.role
--   manager             ->  manager
--   cashier             ->  cashier
--   stock_keeper        ->  stock_keeper
--   waiter              ->  waiter
--   viewer              ->  cashier
--   owner               ->  (skipped)
--
-- shop_pos_staff_role_check allows only manager, cashier, stock_keeper,
-- supervisor, waiter, kitchen, bar — there is no POS 'viewer', so 'viewer'
-- maps to 'cashier'. That is the pairing the invitation system already
-- sanctions: shop_invite_staff explicitly permits membership_role='viewer'
-- together with pos_role='cashier'.
--
-- Every membership role therefore maps to a value the check constraint accepts,
-- so this trigger cannot fail a membership update.
--
-- It never maps to 'owner': an owner holds no staff row to mirror onto, and
-- ownership is not expressible as a POS role.
create or replace function public.trg_shop_members_sync_pos_role ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pos_role text;
begin
  if tg_op <> 'UPDATE' or new.role is not distinct from old.role then
    return new;
  end if;

  v_pos_role := case new.role
    when 'manager' then 'manager'
    when 'cashier' then 'cashier'
    when 'stock_keeper' then 'stock_keeper'
    when 'waiter' then 'waiter'
    when 'viewer' then 'cashier'
    else null
  end;

  -- 'owner', and anything unrecognised, is left alone rather than guessed at.
  if v_pos_role is null then
    return new;
  end if;

  -- Only the membership -> POS direction is mirrored. The reverse is never
  -- automatic: a POS role change must not be able to move cloud authority.
  update public.shop_pos_staff s
     set role = v_pos_role,
         updated_at = now ()
   where s.shop_id = new.shop_id
     and s.user_id = new.user_id
     and s.deleted_at is null
     and s.role is distinct from v_pos_role;

  return new;
end;
$$;

drop trigger if exists trg_shop_members_sync_pos_role on public.shop_members;
create trigger trg_shop_members_sync_pos_role
  after update of role on public.shop_members
  for each row
  execute function public.trg_shop_members_sync_pos_role ();

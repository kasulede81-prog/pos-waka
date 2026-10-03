-- ============================================================================
-- Phase 2 — Lock down shop membership (closes C1, the manager takeover)
-- ============================================================================
-- Phase 1 production reconciliation confirmed the live state:
--
--   * `authenticated` holds UPDATE and DELETE on public.shop_members
--   * policies `shop_members_update` / `shop_members_delete` are gated only by
--     public.user_can_manage_shop(), which is TRUE for role in ('owner','manager')
--   * trg_shop_members_single_owner fires BEFORE INSERT OR UPDATE OF role only.
--     It never fires on DELETE, and its body returns immediately whenever the
--     new role is not 'owner'.
--
-- Those three together let any manager take over a shop:
--
--   1. DELETE the owner's shop_members row — the policy allows it (the manager
--      passes user_can_manage_shop) and no trigger fires on DELETE.
--   2. UPDATE their own row to role='owner' — allowed, and the single-owner
--      trigger is satisfied because no other owner remains.
--
-- A manager could also demote the owner in one step, because the trigger treats
-- "new role is not owner" as an immediate pass.
--
-- Phase 2 removes the direct write path entirely and routes every membership
-- mutation through owner-only SECURITY DEFINER RPCs.
--
-- Deliberately NOT in this phase: Google-first invitation acceptance, credential
-- hash exposure, staff lifecycle synchronisation, and the anon EXECUTE surface on
-- security-definer functions. Those are Phases 3-5.

-- ----------------------------------------------------------------------------
-- 1. Remove the direct membership write path
-- ----------------------------------------------------------------------------
-- INSERT was already revoked from authenticated in 161_staff_invitation_system.sql.
-- SELECT is deliberately retained: the client reads memberships for workspace
-- hydration and role display, and nothing here changes that.
--
-- TRUNCATE is included because it destroys the same protected data and no client
-- role has any use for it. RLS does not apply to TRUNCATE, so the privilege is
-- the only control.
revoke update, delete, truncate on table public.shop_members from authenticated;

-- anon should never have held these on a tenancy table. Supabase's default
-- privileges grant every new public table to anon + authenticated, and nothing
-- had revoked it here. RLS already denies anon rows, so this is defence in depth
-- rather than a live hole.
revoke insert, update, delete, truncate on table public.shop_members from anon;

-- ----------------------------------------------------------------------------
-- 2. Harden owner protection
-- ----------------------------------------------------------------------------
-- Adds the demotion guard the previous body lacked. Ownership transfer is not
-- part of this architecture, so an owner may not be moved to another role by any
-- path — including this one. A second owner still cannot be created, which also
-- keeps the "no silent transfer" property.
--
-- DELETE is intentionally NOT guarded here. shop_members rows are removed by FK
-- cascade (shop_members_shop_id_fkey and shop_members_user_id_fkey are both
-- ON DELETE CASCADE) when an account or a shop is deleted, and a BEFORE DELETE
-- guard that raised would abort those cascades and break account deletion. The
-- delete path is closed at the privilege layer in section 1 instead, and
-- public.shop_remove_member() refuses owner targets.
create or replace function public.trg_shop_members_enforce_single_owner ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
begin
  -- Demotion: an existing owner may never be moved to another role.
  if tg_op = 'UPDATE'
     and old.role = 'owner'
     and new.role is distinct from 'owner' then
    insert into public.audit_logs (
      shop_id,
      actor_user_id,
      role,
      action,
      payload_summary,
      payload
    )
    values (
      new.shop_id,
      auth.uid (),
      'owner',
      'owner_demotion_forbidden',
      'Rejected shop owner demotion',
      jsonb_build_object (
        'target_user_id', old.user_id,
        'attempted_role', new.role
      )
    );
    raise exception 'shop_owner_protected'
      using hint = 'The shop owner cannot be demoted.';
  end if;

  if new.role is distinct from 'owner' then
    return new;
  end if;

  select sm.user_id
  into v_existing
  from public.shop_members sm
  where sm.shop_id = new.shop_id
    and sm.role = 'owner'
    and sm.user_id is distinct from new.user_id
  limit 1;

  if v_existing is not null then
    insert into public.audit_logs (
      shop_id,
      actor_user_id,
      role,
      action,
      payload_summary,
      payload
    )
    values (
      new.shop_id,
      auth.uid (),
      'owner',
      'auth_forbidden',
      'Rejected second shop owner assignment',
      jsonb_build_object (
        'attempted_user_id', new.user_id,
        'existing_owner_user_id', v_existing
      )
    );
    raise exception 'shop_already_has_owner'
      using hint = 'This shop already has an owner.';
  end if;

  return new;
end;
$$;

-- The existing trigger already fires BEFORE INSERT OR UPDATE OF role, which is
-- exactly the surface this body needs. Recreate it so the definition is explicit
-- and idempotent regardless of how it was first installed.
drop trigger if exists trg_shop_members_single_owner on public.shop_members;
create trigger trg_shop_members_single_owner
  before insert or update of role on public.shop_members
  for each row
  execute function public.trg_shop_members_enforce_single_owner ();

-- ----------------------------------------------------------------------------
-- 3. Who may administer membership
-- ----------------------------------------------------------------------------
-- Shop owner, or the owner/admin of the shop's organisation — the same
-- owner-equivalent set that user_can_manage_shop() honoured via its
-- organisation_members branch, minus the 'manager' branch that caused C1.
-- Preserving the org branch keeps existing multi-shop owner capability intact.
create or replace function public.user_can_administer_shop_members (p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_is_shop_owner (p_shop_id)
  or exists (
    select 1
    from public.shops sh
    join public.organization_members om
      on om.organization_id = sh.organization_id
    where sh.id = p_shop_id
      and om.user_id = auth.uid ()
      and om.role in ('owner', 'admin')
  );
$$;

revoke all on function public.user_can_administer_shop_members (uuid) from public;
revoke all on function public.user_can_administer_shop_members (uuid) from anon;
grant execute on function public.user_can_administer_shop_members (uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Controlled membership RPCs
-- ----------------------------------------------------------------------------
-- Both RPCs operate on the EXISTING membership record by primary key. Neither
-- accepts or writes shop_id / user_id on the target row, so a membership's
-- identity and tenancy cannot be reassigned through them. The target must belong
-- to p_shop_id, which is what closes cross-shop mutation: a caller authorised for
-- shop A simply finds no row for that user in shop A when the membership lives
-- in shop B.
--
-- Both fail closed: any unmet precondition returns ok=false and performs no write.

create or replace function public.shop_set_member_role (
  p_shop_id uuid,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_role text;
  v_member public.shop_members%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'unauthenticated');
  end if;

  if p_shop_id is null or p_user_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_request');
  end if;

  if not public.user_can_administer_shop_members (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'not_shop_owner');
  end if;

  v_role := lower (trim (coalesce (p_role, '')));

  -- 'owner' is excluded on purpose: there is no ownership-transfer feature, and
  -- this path must not become one.
  if v_role not in ('manager', 'cashier', 'stock_keeper', 'waiter', 'viewer') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_role');
  end if;

  select *
  into v_member
  from public.shop_members sm
  where sm.shop_id = p_shop_id
    and sm.user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'member_not_found');
  end if;

  if v_member.role = 'owner' then
    return jsonb_build_object ('ok', false, 'error', 'owner_protected');
  end if;

  if v_member.role = v_role then
    return jsonb_build_object (
      'ok', true,
      'changed', false,
      'role', v_role
    );
  end if;

  update public.shop_members
     set role = v_role
   where id = v_member.id;

  insert into public.audit_logs (
    shop_id,
    actor_user_id,
    role,
    action,
    payload_summary,
    payload
  )
  values (
    p_shop_id,
    v_uid,
    'owner',
    'member_role_changed',
    'Member role changed',
    jsonb_build_object (
      'target_user_id', p_user_id,
      'old_role', v_member.role,
      'new_role', v_role
    )
  );

  return jsonb_build_object (
    'ok', true,
    'changed', true,
    'previous_role', v_member.role,
    'role', v_role
  );
end;
$$;

create or replace function public.shop_remove_member (
  p_shop_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_member public.shop_members%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'unauthenticated');
  end if;

  if p_shop_id is null or p_user_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_request');
  end if;

  if not public.user_can_administer_shop_members (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'not_shop_owner');
  end if;

  select *
  into v_member
  from public.shop_members sm
  where sm.shop_id = p_shop_id
    and sm.user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'member_not_found');
  end if;

  -- An owner can never be removed here. Because only owners (or org admins) may
  -- call this at all, a shop can never be left ownerless through it.
  if v_member.role = 'owner' then
    return jsonb_build_object ('ok', false, 'error', 'owner_protected');
  end if;

  delete from public.shop_members
   where id = v_member.id;

  insert into public.audit_logs (
    shop_id,
    actor_user_id,
    role,
    action,
    payload_summary,
    payload
  )
  values (
    p_shop_id,
    v_uid,
    'owner',
    'member_removed',
    'Member removed from shop',
    jsonb_build_object (
      'target_user_id', p_user_id,
      'removed_role', v_member.role
    )
  );

  return jsonb_build_object (
    'ok', true,
    'user_id', p_user_id,
    'removed_role', v_member.role
  );
end;
$$;

revoke all on function public.shop_set_member_role (uuid, uuid, text) from public;
revoke all on function public.shop_set_member_role (uuid, uuid, text) from anon;
grant execute on function public.shop_set_member_role (uuid, uuid, text) to authenticated;

revoke all on function public.shop_remove_member (uuid, uuid) from public;
revoke all on function public.shop_remove_member (uuid, uuid) from anon;
grant execute on function public.shop_remove_member (uuid, uuid) to authenticated;

-- ============================================================================
-- Phase 2F — a new WAKA Loyalty member must have a phone number
-- ============================================================================
-- WHY. `loyalty_members.phone_e164` is the value Phase 2A matches a shop's loyalty account
-- against, and `loyalty_member_join_by_code` refuses a member without one. Nothing enforced it at
-- creation: the RPC's format check only ran when the phone was NON-NULL, so a NULL was accepted and
-- inserted, producing a member who exists but can never join any merchant.
--
-- The client already validates (`becomeLoyaltyMember` returns invalid_phone), but a client-side
-- check is not a guarantee — the RPC is granted to `authenticated` and can be called directly.
-- This closes it where it has to be closed.
--
-- NO NOT NULL CONSTRAINT. The column stays nullable on purpose: a constraint would be a larger,
-- harder-to-reverse change to a table other code reads, and it is not what the rule needs — the
-- rule is about CREATION, not about every historical row. It also means this migration does not
-- depend on what history happens to contain: rows already holding a NULL are left exactly as they
-- are (they cannot join anything until a phone is added, which `loyalty_member_join_by_code`
-- already enforces with `member_phone_required`), and no backfill is implied or performed here.
--
-- Reproduced from 20260928100000 with that one guard added; everything else is identical.

create or replace function public.loyalty_member_register (
  p_display_name text default null,
  p_phone_e164 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid ();
  v_name text := nullif (btrim (coalesce (p_display_name, '')), '');
  v_phone text := nullif (btrim (coalesce (p_phone_e164, '')), '');
  v_email text;
  v_member public.loyalty_members%rowtype;
  v_created boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  if v_name is not null and char_length (v_name) > 120 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_name');
  end if;
  if v_phone is not null and v_phone !~ '^\+256[0-9]{9}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_phone');
  end if;

  -- Read from auth.users rather than auth.jwt(): the classifier already reads that table, so
  -- this keeps one shape, and it does not depend on which claims the caller's token happens to
  -- carry.
  select lower (nullif (btrim (coalesce(u.email, '')), '')) into v_email
  from auth.users u where u.id = v_uid;

  select * into v_member from public.loyalty_members m where m.auth_user_id = v_uid;

  -- Phase 2F — a phone is MANDATORY for a new member.
  --
  -- The check above only rejects a phone that is present and malformed: a NULL passed straight
  -- through and was inserted, so any authenticated caller could create a member with no phone.
  -- That member can then never join anything — loyalty_member_join_by_code refuses with
  -- member_phone_required — leaving an identity that exists but is unusable.
  --
  -- Scoped to the case that matters. An EXISTING member who already holds a phone may still call
  -- without one: the coalesce in the upsert means it cannot blank the stored value, and requiring
  -- it again would only break a harmless re-registration. The rule is that a member cannot be
  -- CREATED without a phone, which is exactly what is enforced here.
  if v_phone is null and (v_member.id is null or v_member.phone_e164 is null) then
    return jsonb_build_object ('ok', false, 'error', 'phone_required');
  end if;

  v_created := v_member.id is null;

  insert into public.loyalty_members (auth_user_id, display_name, phone_e164, email)
  values (v_uid, v_name, v_phone, v_email)
  on conflict (auth_user_id) do update
  set -- coalesce so a later call can never blank an existing value
      display_name = coalesce (excluded.display_name, public.loyalty_members.display_name),
      phone_e164 = coalesce (excluded.phone_e164, public.loyalty_members.phone_e164),
      email = coalesce (excluded.email, public.loyalty_members.email),
      updated_at = now ();

  select * into v_member from public.loyalty_members m where m.auth_user_id = v_uid;

  return jsonb_build_object (
    'ok', true,
    'member_id', v_member.id,
    'status', v_member.status,
    'created', v_created
  );
end;
$fn$;

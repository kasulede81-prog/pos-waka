-- ============================================================================
-- Phase 11 — a cashier may publish THEIR OWN shift
-- ============================================================================
-- THE DEFECT. `shop_push_shift` gated on `user_can_manage_shop()`, which is
-- `shop_members.role in ('owner','manager')` OR an `organization_members` row with
-- role owner/admin. An invited Google cashier has neither — they hold a
-- `shop_members` row with role 'cashier'. So their shift was created locally (the
-- client permission `shift.start` is theirs), then the push came back
-- `{ ok: false, error: 'forbidden' }` on every attempt and the row never reached
-- `public.shop_shifts`. A cashier's shift existed only on their own device.
--
-- THE NARROW FIX. Authorization becomes: a MANAGER keeps exactly what they had;
-- anyone else may write a shift ONLY when it is provably their own —
--
--     actor_user_id == auth.uid()
--
-- checked against the STORED row for an update and against the payload for a
-- first insert, so a client cannot claim to be a colleague. Nothing else widens:
--
--   * `user_can_manage_shop` is NOT granted to cashiers anywhere.
--   * The table's own RLS (`shop_shifts_insert` / `shop_shifts_update`, both
--     `user_can_manage_shop`) is deliberately UNCHANGED — direct client writes stay
--     manager-only. Only this SECURITY DEFINER entry point is widened, and only to
--     the caller's own row.
--   * No membership, subscription, drawer or role change of any kind.
--
-- WHY THIS MATCHES THE DATA MODEL. `shop_shifts.actor_user_id` is already the
-- per-actor key, there is no one-open-shift-per-shop constraint anywhere, and
-- `189_ask_waka_shift_report.sql` explicitly expects several concurrent open shifts
-- (`multiple_open_shifts` returns a candidate list rather than guessing). One shop,
-- many staff shifts, was always the intended shape.

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
  v_manager boolean;
  v_existing_shop uuid;
  v_existing_actor text;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  -- Owner/manager keep their existing authority, unchanged.
  v_manager := public.user_can_manage_shop (p_shop_id);

  -- Everyone else needs OPERATIONAL access to the shop before anything is read.
  if not v_manager and not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif (p_payload ->> 'id', '')::uuid;
  v_actor := nullif (trim (p_payload ->> 'actor_user_id'), '');
  v_start := nullif (p_payload ->> 'start_at', '')::timestamptz;

  if v_id is null or v_actor is null or v_start is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;

  select s.shop_id, s.actor_user_id
  into v_existing_shop, v_existing_actor
  from public.shop_shifts s
  where s.id = v_id;

  -- A shift id belongs to exactly one shop. A collision across shops is a conflict,
  -- never an update — it must not let `on conflict (id)` rewrite another shop's row.
  if v_existing_shop is not null and v_existing_shop <> p_shop_id then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  if not v_manager then
    -- 1. The caller may only claim to be themselves.
    if v_actor <> v_uid::text then
      return jsonb_build_object ('ok', false, 'error', 'forbidden');
    end if;
    -- 2. …and may not take over a shift that already belongs to somebody else.
    if v_existing_actor is not null and v_existing_actor <> v_uid::text then
      return jsonb_build_object ('ok', false, 'error', 'forbidden');
    end if;
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
revoke all on function public.shop_push_shift (uuid, jsonb) from anon;
grant execute on function public.shop_push_shift (uuid, jsonb) to authenticated;

-- ============================================================================
-- LOYALTY PHASE F — REWARD LIFECYCLE
-- ============================================================================
-- THE GAP THIS CLOSES. Deleting a reward was impossible for everyone: Phase 0 revoked
-- DELETE on `loyalty_rewards` from every client role, and `loyalty_redemptions.reward_id`
-- is ON DELETE RESTRICT. That protects history, and it also means a reward created by
-- mistake and never used sits in the catalogue forever with no way to remove it. A merchant
-- could only deactivate it and watch it accumulate.
--
-- THE LIFECYCLE MODEL IS NOT REDEFINED HERE — it already exists and is already safe:
--
--   active = true           offered to members who are eligible
--   active = false          WITHDRAWN. Hidden from members (unless they already redeemed it,
--                           which stays visible as their own history), still visible to the
--                           merchant, still intact in every historical row.
--   expires_on              C2 Kampala-day expiry, evaluated by loyalty_reward_unexpired
--
-- "Archive" IS `active = false`, and it is reversible — which is the point. There is no
-- separate `paused` or `archived` column, and this migration deliberately does not add one:
-- a paused reward and a withdrawn reward are indistinguishable to a member, so a third state
-- would be a label with a migration attached and no behaviour behind it. What was genuinely
-- missing was not another state — it was a way to REMOVE a reward that has nothing behind it,
-- and a way to tell the two cases apart when a merchant asks.
--
-- SO: deletion is now possible, and only when it destroys nothing. A reward with any
-- redemption, any assignment, or any offer still naming it is REFUSED with a reason and the
-- merchant is told to deactivate instead. History is never traded away to tidy a catalogue.

create or replace function public.loyalty_delete_unused_reward (
  p_shop_id uuid,
  p_reward_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $fn$
declare
  v_reward public.loyalty_rewards%rowtype;
  v_redemptions integer := 0;
  v_assignments integer := 0;
  v_offers integer := 0;
begin
  if auth.uid () is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  -- Same authority that authors a reward may remove an unused one.
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  -- Locked, so a redemption cannot be created between the history check and the delete.
  select * into v_reward
  from public.loyalty_rewards
  where id = p_reward_id and shop_id = p_shop_id
  for update;

  if not found then
    -- Another shop's reward is simply not here.
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  -- Everything that would be damaged by removal.
  select count (*) into v_redemptions
  from public.loyalty_redemptions where reward_id = p_reward_id;

  select count (*) into v_assignments
  from public.loyalty_reward_assignments where reward_id = p_reward_id;

  -- A `reward_grant` offer names rewards inside its config; deleting one would leave the
  -- offer pointing at nothing.
  select count (*) into v_offers
  from public.loyalty_customer_offers
  where shop_id = p_shop_id
    and config -> 'reward_ids' ? p_reward_id::text;

  if v_redemptions > 0 or v_assignments > 0 or v_offers > 0 then
    return jsonb_build_object (
      'ok', false,
      'error', 'reward_has_history',
      'redemptions', v_redemptions,
      'assignments', v_assignments,
      'offers', v_offers
    );
  end if;

  delete from public.loyalty_rewards where id = p_reward_id;

  return jsonb_build_object ('ok', true, 'deleted', true, 'reward_id', p_reward_id);
end;
$fn$;

revoke all on function public.loyalty_delete_unused_reward (uuid, uuid) from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_delete_unused_reward (uuid, uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_delete_unused_reward (uuid, uuid) to authenticated';
  end if;
end;
$g$;

comment on function public.loyalty_delete_unused_reward (uuid, uuid) is
  'Removes a reward that has NO history — no redemptions, no assignments and no offer naming '
  'it. Refuses with reward_has_history otherwise; the merchant then deactivates it instead '
  '(active = false), which is the reversible archive and preserves every historical row. '
  'Authority: user_can_manage_shop.';

-- Deactivating is the archive, and it must stay available to a manager on the existing
-- table policy — this asserts the intent, it does not change it.
comment on column public.loyalty_rewards.active is
  'true = offered to eligible members. false = WITHDRAWN (the archive): hidden from members, '
  'kept for the merchant, and every historical redemption/assignment/benefit keeps working. '
  'Reversible. There is no separate paused/archived state — see the Phase F migration header.';

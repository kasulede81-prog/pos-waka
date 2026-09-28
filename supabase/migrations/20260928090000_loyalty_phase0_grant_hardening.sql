-- WAKA Loyalty — Phase 0 (Member Dashboard): restore the grant layer.
--
-- The Member Dashboard investigation found that loyalty immutability rests on the ABSENCE of
-- write policies rather than on privileges. The live database showed, for `authenticated`:
--
--   loyalty_transactions   INSERT, UPDATE, DELETE, TRUNCATE granted — and ZERO write policies
--   loyalty_accounts                        DELETE, TRUNCATE granted
--   loyalty_redemptions              UPDATE, DELETE, TRUNCATE granted
--   loyalty_reward_assignments  INSERT, UPDATE, DELETE, TRUNCATE granted
--   loyalty_point_lot_allocations INSERT, UPDATE, DELETE, TRUNCATE granted
--   loyalty_customer_offers     INSERT, UPDATE, DELETE, TRUNCATE granted
--   loyalty_programs / loyalty_plan_tiers            TRUNCATE granted
--
-- Two consequences:
--
--   1. TRUNCATE is NOT filtered by row-level security — PostgreSQL applies policies to
--      SELECT/INSERT/UPDATE/DELETE only. Truncate is gated solely by the TRUNCATE privilege.
--      It is not reachable through PostgREST (no truncate verb), so this is not a web-API
--      exploit, but it is an unfiltered privilege on the ledger and the account tables.
--
--   2. The ledger's immutability — the invariant the whole loyalty system rests on — would be
--      lost the moment anyone adds a write policy to `loyalty_transactions`. Closing the grants
--      makes the invariant hold at two independent layers instead of one.
--
-- Grants are closed rather than function bodies edited because the engine calls these tables
-- from trigger context, and a re-grant is a trivial rollback.
--
-- NOT touched, deliberately: `loyalty_rewards` and `customers` KEEP their DML grants. Both are
-- written directly by the client — see loyaltyRewards.ts (insert/update) and cloudSync.ts
-- (customers upsert) — and each has matching write policies gated on user_can_manage_shop /
-- user_is_cashier_or_above. Only their TRUNCATE/REFERENCES/TRIGGER are removed.
--
-- No schema change, no function body change, no data change.

-- ============================================================================
-- 1) The immutable ledger becomes read-only to browser roles
-- ============================================================================
revoke insert, update, delete, truncate, references, trigger
  on public.loyalty_transactions from authenticated, anon, public;

grant select on public.loyalty_transactions to authenticated;

-- ============================================================================
-- 2) Tables written ONLY by SECURITY DEFINER RPCs
-- ============================================================================
-- Verified: no client or Edge Function writes any of these (src/ has only SELECT paths for
-- them; every mutation goes through an RPC). The grants were dead weight.
do $g$
declare
  t text;
begin
  foreach t in array array[
    'public.loyalty_reward_assignments',
    'public.loyalty_point_lot_allocations',
    'public.loyalty_customer_offers',
    'public.loyalty_redemptions'
  ] loop
    execute format ('revoke insert, update, delete, truncate, references, trigger on %s from authenticated, anon, public', t);
    execute format ('grant select on %s to authenticated', t);
  end loop;
end;
$g$;

-- ============================================================================
-- 3) loyalty_accounts: DELETE was granted with no policy to back it
-- ============================================================================
-- The UPDATE grant is already revoked (20260926090000). Only DELETE and the unfiltered
-- TRUNCATE remained.
revoke delete, truncate, references, trigger
  on public.loyalty_accounts from authenticated, anon, public;

-- ============================================================================
-- 4) Catalog tables — DML already revoked, TRUNCATE was not
-- ============================================================================
revoke truncate, references, trigger on public.loyalty_programs   from authenticated, anon, public;
revoke truncate, references, trigger on public.loyalty_plan_tiers from authenticated, anon, public;

-- ============================================================================
-- 5) Load-bearing grants: keep DML, drop the unfiltered TRUNCATE
-- ============================================================================
-- loyalty_rewards IS written directly by the client (loyaltyRewards.ts create/update).
-- customers IS upserted by the offline sync path (cloudSync.ts). Their INSERT/UPDATE grants and
-- their write policies are untouched on purpose.
revoke truncate, references, trigger on public.loyalty_rewards from authenticated, anon, public;
revoke truncate, references, trigger on public.customers        from authenticated, anon, public;

-- loyalty_rewards DELETE is granted to authenticated with NO delete policy to back it, and no
-- client delete path exists (rewards are deactivated via active=false, never removed —
-- loyalty_redemptions.reward_id is ON DELETE RESTRICT precisely so history survives). Same
-- latent shape as loyalty_accounts above: safe today only because the policy is absent.
revoke delete on public.loyalty_rewards from authenticated, anon, public;

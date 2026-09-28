-- WAKA Loyalty — Phase 0: close three over-exposed RPCs.
--
-- Two of these are SECURITY DEFINER with EXECUTE granted to `authenticated` and NO
-- authorization check of any kind, so they bypass RLS and answer for any account id supplied:
--
--   loyalty_resolve_customer_offers(p_account_id, p_now)
--     Reads loyalty_accounts purely by id and returns shop_id plus the full effective offer set
--     (multiplier, flat bonus, reward_grant_ids, badges). Any authenticated user holding any
--     account id reads another merchant's offer configuration.
--
--   loyalty_account_reward_granted(p_account_id, p_reward_id, p_now)
--     Same shape — a boolean existence oracle over any account's reward assignments.
--
-- The third is a different case and is revoked for hygiene, not exposure:
--
--   loyalty_earn_lot_remaining(p_credit_tx_id)
--     SECURITY INVOKER (prosecdef = false), so RLS applies and a caller without shop access
--     reads zero rows and gets 0 — identical to a nonexistent id. NOT a data leak. It was
--     granted to `anon`, which is unnecessary surface for a loyalty function.
--
-- WHY REVOKE RATHER THAN ADD AN AUTHORIZATION CHECK INSIDE THE FUNCTIONS
-- ---------------------------------------------------------------------
-- Every caller of all three is another SECURITY DEFINER function owned by postgres:
--
--   loyalty_resolve_customer_offers  <- loyalty_account_reward_granted,
--                                       loyalty_preview_account_offers, loyalty_redeem_reward
--   loyalty_account_reward_granted   <- (composed by loyalty_account_reward_granted path)
--   loyalty_earn_lot_remaining       <- loyalty_allocate_fifo, loyalty_award_for_sale,
--                                       loyalty_expire_due_points, loyalty_outstanding_for_sale
--
-- Those run from TRIGGER context (sale completion, returns, voids) where auth.uid() is
-- frequently NULL. A `user_can_access_shop` guard inside the function would therefore break
-- loyalty point awards on sale completion. Revoking EXECUTE removes the browser path with no
-- behavioural change: definer callers execute as the owner and are unaffected.
--
-- This is the pattern the codebase already uses for engine primitives — see
-- 20260922222138_loyalty_engine_primitive_revoke.sql, which revoked loyalty_award_for_sale,
-- loyalty_reverse_for_sale, loyalty_reverse_for_return and loyalty_apply_pending_reversals.
-- These three simply missed that sweep; the live database confirms the other engine primitives
-- already show `authenticated EXECUTE = false`.
--
-- The merchant-facing entry points that compose these internally are untouched and keep their
-- own shop guards: loyalty_preview_account_offers and loyalty_list_customer_offers.
--
-- No function body change, no schema change, no data change.

do $r$
declare
  sig text;
begin
  foreach sig in array array[
    'public.loyalty_resolve_customer_offers(uuid, timestamptz)',
    'public.loyalty_account_reward_granted(uuid, uuid, timestamptz)',
    'public.loyalty_earn_lot_remaining(uuid)'
  ] loop
    if to_regprocedure (sig) is not null then
      execute format ('revoke all on function %s from authenticated', sig);
      execute format ('revoke all on function %s from anon', sig);
      execute format ('revoke all on function %s from public', sig);
    end if;
  end loop;
end;
$r$;

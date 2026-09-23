-- Revoke client EXECUTE on the internal loyalty SECURITY DEFINER primitives.
--
-- Finding (P0): the four loyalty engine functions are SECURITY DEFINER with no
-- authorization check in their bodies — no user_can_access_shop, no auth.uid()
-- test. They were written to be reached only from the sales / sale_returns /
-- sale_voids triggers, but Postgres grants EXECUTE to PUBLIC by default, so they
-- were also reachable over PostgREST by any holder of the anon key (which ships
-- in the client bundle):
--
--   POST /rest/v1/rpc/loyalty_reverse_for_sale {"p_sale_id": "<any shop's sale>"}
--
-- erased points a customer legitimately earned, and loyalty_award_for_sale could
-- be forced against an unrelated shop. The idempotency indexes prevent a DOUBLE
-- award; they do nothing about an UNAUTHORIZED one.
--
-- This mirrors 184_ungated_definer_primitive_revoke.sql, which closed the same
-- class of hole for the sale stock primitives (apply/reverse_sale_stock_movements).
-- The loyalty data foundation granted EXECUTE explicitly only for the two gated
-- client RPCs (loyalty_enroll_customer, loyalty_adjust_points); these four were
-- never meant to be client-callable and are left with no client EXECUTE at all.
--
-- Does not replace any function body, trigger, policy, index or grant beyond the
-- four EXECUTE privileges below. Trigger execution is unaffected: every write that
-- fires a loyalty trigger today originates inside a SECURITY DEFINER function owned
-- by postgres (shop_push_sale_complete and the void/return RPCs), so the nested
-- call runs as the function owner and needs no anon/authenticated EXECUTE.
--
-- The gated client-facing RPCs are deliberately NOT revoked:
--   loyalty_enroll_customer, loyalty_adjust_points, loyalty_account_by_token,
--   loyalty_shop_overview, loyalty_update_program, loyalty_search_accounts,
--   loyalty_redeem_reward — each re-checks shop access internally.
-- loyalty_outstanding_for_sale is also left alone: it is NOT security definer, so
-- it reads through loyalty_transactions' own RLS and returns nothing to a caller
-- without shop access.
--
-- Idempotent: skips missing signatures. Safe to re-run. Does not GRANT EXECUTE
-- back to anon or authenticated.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Loyalty engine primitives — trigger-invoked only.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.loyalty_award_for_sale(uuid)') is not null then
    execute 'revoke all on function public.loyalty_award_for_sale (uuid) from public';
    execute 'revoke all on function public.loyalty_award_for_sale (uuid) from anon';
    execute 'revoke all on function public.loyalty_award_for_sale (uuid) from authenticated';
  end if;

  if to_regprocedure('public.loyalty_reverse_for_sale(uuid,text)') is not null then
    execute 'revoke all on function public.loyalty_reverse_for_sale (uuid, text) from public';
    execute 'revoke all on function public.loyalty_reverse_for_sale (uuid, text) from anon';
    execute 'revoke all on function public.loyalty_reverse_for_sale (uuid, text) from authenticated';
  end if;

  if to_regprocedure('public.loyalty_reverse_for_return(uuid)') is not null then
    execute 'revoke all on function public.loyalty_reverse_for_return (uuid) from public';
    execute 'revoke all on function public.loyalty_reverse_for_return (uuid) from anon';
    execute 'revoke all on function public.loyalty_reverse_for_return (uuid) from authenticated';
  end if;

  if to_regprocedure('public.loyalty_apply_pending_reversals(uuid)') is not null then
    execute 'revoke all on function public.loyalty_apply_pending_reversals (uuid) from public';
    execute 'revoke all on function public.loyalty_apply_pending_reversals (uuid) from anon';
    execute 'revoke all on function public.loyalty_apply_pending_reversals (uuid) from authenticated';
  end if;
end
$$;

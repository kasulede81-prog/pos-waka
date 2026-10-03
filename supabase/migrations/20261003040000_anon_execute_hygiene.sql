-- ============================================================================
-- Phase 8 — Anon EXECUTE hygiene
-- ============================================================================
-- Two of the three remaining anon-executable staff support functions cannot be
-- used by an anonymous caller at all, and the third is a trigger. Their EXECUTE
-- grants were pure surface area.
--
-- is_waka_internal_staff() is deliberately NOT revoked — see section 2.

-- ----------------------------------------------------------------------------
-- 1. Retire anon EXECUTE where there is no anonymous requirement
-- ----------------------------------------------------------------------------
-- Traced before revoking:
--
--   admin_shop_reset_all_staff_credentials(uuid)
--     Body begins `if not public.is_waka_internal_staff() then raise exception
--     'Forbidden'`. For anon, auth.uid() is null, so is_waka_internal_staff()
--     returns false and the call raises. Anon can never succeed.
--
--   shop_get_staff_sales_summary(date, date, integer)
--     Resolves its shop through public._report_assert_shop(), which is
--     auth-gated. With auth.uid() null there is no caller shop, so it raises.
--     Anon can never succeed.
--
--   bump_shop_staff_version()
--     RETURNS trigger. A trigger function cannot be invoked directly — calling it
--     raises — and triggers execute as the table owner regardless of the caller's
--     EXECUTE privilege, so revoking does not affect the trigger that uses it.
--
-- Guarded with to_regprocedure so a missing signature cannot abort the migration
-- (the staff RPC surface has changed shape several times).
do $revoke$
declare
  sig text;
begin
  foreach sig in array array[
    'public.admin_shop_reset_all_staff_credentials (uuid)',
    'public.shop_get_staff_sales_summary (date, date, integer)',
    'public.bump_shop_staff_version ()'
  ] loop
    if to_regprocedure (sig) is not null then
      execute format ('revoke all on function %s from anon', sig);
      execute format ('revoke all on function %s from public', sig);
    end if;
  end loop;
end;
$revoke$;

-- ----------------------------------------------------------------------------
-- 2. is_waka_internal_staff — anon EXECUTE is required, so make it anon-inert
-- ----------------------------------------------------------------------------
-- This one CANNOT be revoked. Phase 4 established that 50 RLS policies reference
-- it, and a policy expression is evaluated as the QUERYING role: an anon SELECT on
-- any of those tables must be able to evaluate the function, or the query errors
-- instead of returning no rows. Supabase's default privileges grant anon SELECT on
-- every public table, so those paths are reachable.
--
-- The compensating control is to make the function provably inert for an
-- unauthenticated caller rather than merely accidentally false. Previously anon
-- safety rested on `coalesce(...) = auth.uid()` comparing NULL — correct today, but
-- it depends on the shape of that single expression. The guard below short-circuits
-- before the internal_admins lookup, so the table is never touched and the result
-- cannot depend on any future edit to the predicate.
--
-- Safe to replace: the body still returns only a boolean, still SECURITY DEFINER,
-- still `search_path = public`, and still resolves to the same value for every
-- authenticated caller — anon and non-internal users get false, internal staff get
-- true.
create or replace function public.is_waka_internal_staff ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid () is null then false
    else exists (
      select 1
      from public.internal_admins ia
      where coalesce (ia.auth_user_id, ia.user_id) = auth.uid ()
        and coalesce (ia.is_active, ia.active, true) = true
    )
  end;
$$;

-- EXECUTE is granted explicitly to both roles rather than left to PUBLIC. The
-- function is inert for an unauthenticated caller (above), and anon needs it to
-- evaluate the 50 policies; revoking it would turn every anonymous read on those
-- tables into an error instead of an empty result, which is a behavioural change
-- no Phase 8 evidence supports. Naming both roles makes the exposure deliberate
-- and auditable instead of inherited.
revoke all on function public.is_waka_internal_staff () from public;
grant execute on function public.is_waka_internal_staff () to authenticated;
grant execute on function public.is_waka_internal_staff () to anon;

-- ============================================================================
-- Publish `subscriptions` to Realtime, so a plan change can reach a live terminal
-- ============================================================================
--
-- THE PROBLEM. An admin grants, cancels or renews a plan from another device, and
-- nothing tells the shop's running terminal. There has never been a Realtime
-- channel for `subscriptions` — this table was never added to the publication, and
-- the client compensated with a 60-second poll. A POS terminal sits in the
-- foreground on one screen for a whole shift, so that poll is the only thing that
-- ever notices, and for up to a minute the terminal shows a plan the database
-- stopped agreeing with a while ago.
--
-- WHAT THIS DOES NOT DO. Publishing a table does not change any value, grant any
-- privilege, or make anything authoritative. It only lets a client that is ALREADY
-- allowed to read a row be told that the row changed. The client's response is to
-- re-read the authoritative state through the same RPC path it always used; the
-- event itself activates nothing and is never evidence that a payment settled.
--
-- WHY NO REPLICA IDENTITY CHANGE. It stays DEFAULT, matching the precedent in
-- 20260929160000_loyalty_member_enrollment_status.sql. Realtime only needs the NEW
-- row to evaluate `subscriptions_select` for an INSERT or UPDATE, which is all this
-- table ever sees — a subscription is never deleted (it is cancelled, expired or
-- reset, all of which are UPDATEs). FULL would write the entire old row to WAL on
-- every change for information no subscriber here reads.
--
-- WHY RLS IS ENOUGH WITHOUT A FILTER. `subscriptions_select`
-- (019_internal_ops_rls_and_rpc.sql) scopes rows to the caller's organization roles
-- (owner/admin/billing/staff) or internal staff. Realtime applies that policy per
-- subscriber, so a client cannot be handed a row it could not have selected itself.
-- The client therefore subscribes unfiltered and lets RLS be the boundary, the same
-- choice the loyalty enrolment subscription makes.
--
-- WHO THAT LEAVES OUT, DELIBERATELY. That policy is `user_has_org_role(...)`, which
-- reads `organization_members`. An invited cashier is a STAFF member of a shop
-- (`shop_members` + `shop_pos_staff`) and holds no organization row — the exact defect
-- that `shop_get_effective_subscription` was written to work around
-- (20261005120000_shop_effective_subscription.sql), and which that migration resolves
-- by changing the READ PATH rather than the policy. So a cashier terminal receives no
-- events from `subscriptions` and keeps converging through the existing 60s tick. That
-- is a latency difference, not a correctness hole, and the policy is NOT widened here:
-- a permissive `user_can_access_shop(shop_id)` SELECT policy would hand those devices
-- the RAW row — including any column added later — instead of the curated projection
-- the RPC returns. Flagged for a separate decision, not taken here.
--
-- WHY `promotional_grants` IS PUBLISHED TOO. The client's effective plan is the
-- subscription row MERGED WITH an active promotional grant
-- (`resolveActivePromotionalGrantTier`), so revoking or extending a grant moves a
-- customer's plan without touching `subscriptions` at all. Its policy is
-- `shop_members`-based ("shop members may read their own org's grants"), which also
-- makes it the one trigger here that can reach a cashier device.
--
-- Idempotent and guarded: re-running must not error, and a project without the
-- realtime publication (a plain Postgres, the PGlite test harness) must not fail.
do $pub$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'subscriptions'
    ) then
      alter publication supabase_realtime add table public.subscriptions;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'promotional_grants'
    ) then
      alter publication supabase_realtime add table public.promotional_grants;
    end if;
  end if;
end;
$pub$;

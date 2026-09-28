-- WAKA Loyalty — Phase 1: re-assert every Phase 1 revocation.
--
-- Same instrument as 20260928090000_loyalty_phase0_grant_hardening.sql: the platform baseline
-- grants DML to `authenticated` on new tables (and TRUNCATE/REFERENCES/TRIGGER, which row-level
-- security does not filter), so "we never granted it" is not a durable guarantee. Re-asserting the
-- revokes in a separate migration means a later accidental re-grant — or a future migration that
-- recreates a table — is caught by this file rather than silently reopening a path.
--
-- Mirrors Phase 0's lesson: the loyalty account tables were safe only because a policy was
-- absent, not because a privilege was. Here the privileges are closed as well.

-- ============================================================================
-- 1) Tables — revoke everything, re-grant only the intended SELECTs
-- ============================================================================
do $t$
declare
  v_readonly text[] := array[
    'public.loyalty_members',
    'public.loyalty_member_claim_requests'
  ];
  v_noaccess text[] := array[
    'public.loyalty_member_links'
  ];
  t text;
begin
  -- Members may read their own row (RLS-scoped) and their own claims, never write either.
  foreach t in array v_readonly loop
    execute format ('revoke insert, update, delete, truncate, references, trigger on %s from authenticated', t);
    execute format ('revoke all on %s from anon', t);
    execute format ('revoke all on %s from public', t);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format ('grant select on %s to authenticated', t);
    end if;
  end loop;

  -- The links table has no browser read path at all: loyalty_member_dashboard() is the only
  -- reader, and it runs as the owner.
  foreach t in array v_noaccess loop
    execute format ('revoke all on %s from authenticated', t);
    execute format ('revoke all on %s from anon', t);
    execute format ('revoke all on %s from public', t);
  end loop;

  -- service_role retains full access for Edge Functions and maintenance.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    foreach t in array v_readonly || v_noaccess loop
      execute format ('grant all on %s to service_role', t);
    end loop;
  end if;
end;
$t$;

-- ============================================================================
-- 2) Functions — no anonymous or PUBLIC execution
-- ============================================================================
do $f$
declare
  sig text;
  v_sigs text[] := array[
    'public.waka_account_identity()',
    'public.loyalty_member_register(text, text)',
    'public.loyalty_member_dashboard()',
    'public.loyalty_member_claim_start(uuid, text)',
    'public.loyalty_member_claim_review(uuid, boolean, text)'
  ];
begin
  foreach sig in array v_sigs loop
    if to_regprocedure (sig) is not null then
      execute format ('revoke all on function %s from public', sig);
      if exists (select 1 from pg_roles where rolname = 'anon') then
        execute format ('revoke all on function %s from anon', sig);
      end if;
      if exists (select 1 from pg_roles where rolname = 'authenticated') then
        execute format ('grant execute on function %s to authenticated', sig);
      end if;
    end if;
  end loop;
end;
$f$;

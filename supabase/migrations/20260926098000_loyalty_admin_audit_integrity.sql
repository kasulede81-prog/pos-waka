-- WAKA Loyalty - Phase 6D: make the Loyalty control-plane audit trail tamper-proof from the browser.
--
-- Defect found in the Phase 6 final audit: public.internal_ops_admin_audit is covered by the
-- blanket 010_grants.sql DML grant to `authenticated`, and its only policy (030) is
-- `FOR ALL ... using (is_waka_internal_staff())`. Any internal staff member - including roles
-- the Loyalty control plane deliberately refuses (support_admin, finance_admin, field_agent,
-- ...) - could therefore DELETE or UPDATE the Phase 6 audit events written by
-- internal_ops_loyalty_* RPCs, or INSERT forged `loyalty_*` events, straight through PostgREST.
--
-- Scope is deliberately narrow: other consoles legitimately write this table from the browser
-- (src/lib/rescueSupportActions.ts inserts rescue/support events directly), so the shared
-- policy is left exactly as it is. Instead, RESTRICTIVE policies - which are AND-ed with the
-- existing permissive one - reserve every `loyalty_*` action for the server:
--
--   * no browser INSERT of a loyalty_* event   (no forged control-plane history)
--   * no browser UPDATE of a loyalty_* event, and no renaming another event into one
--   * no browser DELETE of a loyalty_* event   (no erased control-plane history)
--
-- Reads are unchanged. The SECURITY DEFINER internal_ops_loyalty_* RPCs run as the table owner
-- (RLS is not forced on this table), and the service role bypasses RLS, so the authoritative
-- audit writes are unaffected. Non-Loyalty audit behavior is unchanged.

alter table public.internal_ops_admin_audit enable row level security;

drop policy if exists internal_ops_admin_audit_loyalty_insert_guard on public.internal_ops_admin_audit;
create policy internal_ops_admin_audit_loyalty_insert_guard
  on public.internal_ops_admin_audit
  as restrictive
  for insert
  with check (left (action, 8) <> 'loyalty_');

drop policy if exists internal_ops_admin_audit_loyalty_update_guard on public.internal_ops_admin_audit;
create policy internal_ops_admin_audit_loyalty_update_guard
  on public.internal_ops_admin_audit
  as restrictive
  for update
  using (left (action, 8) <> 'loyalty_')
  with check (left (action, 8) <> 'loyalty_');

drop policy if exists internal_ops_admin_audit_loyalty_delete_guard on public.internal_ops_admin_audit;
create policy internal_ops_admin_audit_loyalty_delete_guard
  on public.internal_ops_admin_audit
  as restrictive
  for delete
  using (left (action, 8) <> 'loyalty_');

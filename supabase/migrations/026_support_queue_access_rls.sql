-- Waka POS — restrict support_requests internal visibility:
-- Support queue should be for super_admin + support_admin (and legacy finance_admin).

alter table public.support_requests enable row level security;

drop policy if exists support_requests_internal_read on public.support_requests;
create policy support_requests_internal_read
  on public.support_requests
  for select
  using (
    public.is_waka_internal_role (array['super_admin', 'support_admin', 'finance_admin']::text[])
  );


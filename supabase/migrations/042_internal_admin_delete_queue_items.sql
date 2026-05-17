-- Allow trusted internal admins to remove noisy queue items from the admin dashboard.
-- Subscription requests already have an internal "for all" policy; support needs delete too.

alter table public.support_requests enable row level security;

drop policy if exists support_requests_internal_delete on public.support_requests;
create policy support_requests_internal_delete
  on public.support_requests for delete
  using (
    public.is_waka_internal_role (array['super_admin', 'support_admin', 'finance_admin', 'operations_admin']::text[])
  );

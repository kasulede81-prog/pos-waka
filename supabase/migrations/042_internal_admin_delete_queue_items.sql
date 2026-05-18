-- Allow trusted internal admins to remove noisy queue items from the admin dashboard.
-- Subscription requests already have an internal "for all" policy; support needs delete too.

alter table public.support_requests enable row level security;

drop policy if exists support_requests_internal_delete on public.support_requests;
create policy support_requests_internal_delete
  on public.support_requests for delete
  using (
    public.is_waka_internal_role (array['super_admin', 'support_admin', 'finance_admin', 'operations_admin']::text[])
  );

create or replace function public.internal_ops_delete_support_request (p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_role (array['super_admin', 'support_admin', 'finance_admin', 'operations_admin']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'Not allowed');
  end if;

  delete from public.support_requests
  where id = p_request_id;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Support request not found');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.internal_ops_delete_subscription_request (p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_staff () then
    return jsonb_build_object('ok', false, 'message', 'Not allowed');
  end if;

  delete from public.subscription_requests
  where id = p_request_id;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Subscription request not found');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.internal_ops_delete_support_request (uuid) from public;
grant execute on function public.internal_ops_delete_support_request (uuid) to authenticated;

revoke all on function public.internal_ops_delete_subscription_request (uuid) from public;
grant execute on function public.internal_ops_delete_subscription_request (uuid) to authenticated;

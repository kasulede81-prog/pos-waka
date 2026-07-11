-- Phase 17.4 — platform subscription settings (billing platform configuration)

insert into public.platform_settings (key, value)
values (
  'subscription_settings',
  '{
    "automaticTrialEnabled": true,
    "defaultTrialPlan": "business",
    "defaultTrialDurationDays": 14,
    "monthlyDurationDays": 30,
    "yearlyDurationDays": 365,
    "gracePeriodDays": 0,
    "allowPromotionalGrants": true,
    "allowMultipleTrials": false,
    "requireVerifiedEmailBeforeTrial": false,
    "subscriptionReminderDays": [7, 3, 1]
  }'::jsonb
)
on conflict (key) do nothing;

create or replace function public.get_platform_subscription_settings ()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select ps.value from public.platform_settings ps where ps.key = 'subscription_settings'),
    '{
      "automaticTrialEnabled": true,
      "defaultTrialPlan": "business",
      "defaultTrialDurationDays": 14,
      "monthlyDurationDays": 30,
      "yearlyDurationDays": 365,
      "gracePeriodDays": 0,
      "allowPromotionalGrants": true,
      "allowMultipleTrials": false,
      "requireVerifiedEmailBeforeTrial": false,
      "subscriptionReminderDays": [7, 3, 1]
    }'::jsonb
  );
$$;

revoke all on function public.get_platform_subscription_settings () from public;
grant execute on function public.get_platform_subscription_settings () to authenticated;
grant execute on function public.get_platform_subscription_settings () to anon;

create or replace function public.admin_update_platform_subscription_settings (p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  insert into public.platform_settings (key, value, updated_at, updated_by)
  values ('subscription_settings', p_settings, now(), auth.uid())
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_update_platform_subscription_settings (jsonb) from public;
grant execute on function public.admin_update_platform_subscription_settings (jsonb) to authenticated;

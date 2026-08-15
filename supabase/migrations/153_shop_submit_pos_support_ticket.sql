-- RS-CI-0: shop-member POS "Need Help" ticket.
-- Ticket/context only. Does not authorize Remote Support or start transport.

create or replace function public.shop_submit_pos_support_ticket (
  p_shop_id uuid,
  p_subject text,
  p_body text,
  p_issue_type text default 'pos_support',
  p_diagnostics jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_id uuid;
  v_issue text;
  v_body text;
begin
  if auth.uid () is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  if p_shop_id is null or not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_body := nullif (trim (coalesce (p_body, '')), '');
  if v_body is null or char_length (v_body) < 3 then
    return jsonb_build_object ('ok', false, 'error', 'description_required');
  end if;

  v_issue := lower (trim (coalesce (p_issue_type, 'pos_support')));
  if v_issue not in (
    'pos_support',
    'printer',
    'cash_drawer',
    'scanner',
    'network',
    'waka_pos',
    'account_login',
    'other'
  ) then
    v_issue := 'pos_support';
  end if;

  select sh.organization_id into v_org from public.shops sh where sh.id = p_shop_id;

  insert into public.support_requests (
    shop_id,
    organization_id,
    opened_by_user_id,
    channel,
    subject,
    body,
    status,
    priority,
    issue_type,
    diagnostics_json,
    app_version,
    device_fingerprint,
    sync_health_snapshot,
    metadata
  )
  values (
    p_shop_id,
    v_org,
    auth.uid (),
    'app',
    left (coalesce (nullif (trim (p_subject), ''), left (v_body, 80)), 200),
    left (v_body, 2000),
    'open',
    'normal',
    v_issue,
    p_diagnostics,
    coalesce (p_diagnostics ->> 'appVersion', p_diagnostics ->> 'app_version'),
    coalesce (p_diagnostics ->> 'deviceId', p_diagnostics ->> 'device_id'),
    coalesce (p_diagnostics -> 'syncHealth', '{}'::jsonb),
    jsonb_build_object ('source', 'pos_need_help')
  )
  returning id into v_id;

  return jsonb_build_object ('ok', true, 'ticket_id', v_id);
end;
$$;

revoke all on function public.shop_submit_pos_support_ticket (uuid, text, text, text, jsonb) from public;
grant execute on function public.shop_submit_pos_support_ticket (uuid, text, text, text, jsonb) to authenticated;

comment on function public.shop_submit_pos_support_ticket (uuid, text, text, text, jsonb) is
  'Shop member POS help ticket. Does not create remote_support_requests or authorize remote control.';

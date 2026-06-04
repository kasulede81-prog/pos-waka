-- Track all admin-driven owner password resets in internal_ops_admin_audit (ops UI reads this table).

create or replace function public.internal_ops_audit_password_action (
  p_action text,
  p_shop_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.internal_ops_admin_audit (actor, action, target_shop_id, payload)
  values (
    auth.uid (),
    p_action,
    p_shop_id,
    coalesce (p_payload, '{}'::jsonb) || jsonb_build_object ('at', now ())
  );
end;
$$;

revoke all on function public.internal_ops_audit_password_action (text, uuid, jsonb) from public;

-- Resolve owner email from profile or auth.users (phone-only signups often have auth email only).
create or replace function public.admin_shop_send_owner_password_reset (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_uid uuid;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select
    sm.user_id,
    coalesce(
      nullif (lower (trim (pr.email)), ''),
      nullif (lower (trim (au.email::text)), '')
    )
  into v_uid, v_email
  from public.shop_members sm
  left join public.profiles pr on pr.id = sm.user_id
  left join auth.users au on au.id = sm.user_id
  where sm.shop_id = p_shop_id
    and sm.role = 'owner'
  order by sm.created_at asc
  limit 1;

  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'owner_not_found');
  end if;

  if v_email is null or v_email = '' then
    return jsonb_build_object ('ok', false, 'error', 'owner_email_missing');
  end if;

  insert into public.shop_recovery_signals (shop_id, password_reset_requested_at, password_reset_requested_by, updated_at)
  values (p_shop_id, now(), auth.uid (), now())
  on conflict (shop_id) do update
    set password_reset_requested_at = now(),
        password_reset_requested_by = auth.uid (),
        updated_at = now();

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'internal',
    'admin_request_owner_password_reset',
    'Admin requested owner password reset email',
    jsonb_build_object ('owner_email', v_email, 'at', now ())
  );

  perform public.internal_ops_audit_password_action (
    'admin_request_owner_password_reset',
    p_shop_id,
    jsonb_build_object ('owner_email', v_email, 'owner_user_id', v_uid)
  );

  return jsonb_build_object ('ok', true, 'owner_email', v_email);
end;
$$;

create or replace function public.admin_shop_password_set_audit (
  p_shop_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_role (array['super_admin', 'support_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'internal',
    'admin_set_owner_password',
    coalesce (nullif (trim (p_note), ''), 'Support set owner login password'),
    jsonb_build_object ('shop_id', p_shop_id, 'at', now ())
  );

  perform public.internal_ops_audit_password_action (
    'admin_set_owner_password',
    p_shop_id,
    jsonb_build_object ('note', coalesce (nullif (trim (p_note), ''), 'Support set owner login password'))
  );

  return jsonb_build_object ('ok', true);
end;
$$;

-- Client logs Supabase resetPasswordForEmail outcome after admin_shop_send_owner_password_reset.
create or replace function public.admin_shop_log_password_reset_email (
  p_shop_id uuid,
  p_ok boolean,
  p_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  v_action := case
    when coalesce (p_ok, false) then 'admin_password_reset_email_sent'
    else 'admin_password_reset_email_failed'
  end;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'internal',
    v_action,
    coalesce (nullif (trim (p_detail), ''), v_action),
    jsonb_build_object ('ok', coalesce (p_ok, false), 'detail', p_detail, 'at', now ())
  );

  perform public.internal_ops_audit_password_action (
    v_action,
    p_shop_id,
    jsonb_build_object ('ok', coalesce (p_ok, false), 'detail', p_detail)
  );

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.admin_shop_log_password_reset_email (uuid, boolean, text) from public;
grant execute on function public.admin_shop_log_password_reset_email (uuid, boolean, text) to authenticated;

-- Backfill historical shop audit_logs into ops feed (idempotent).
insert into public.internal_ops_admin_audit (actor, action, target_shop_id, payload, created_at)
select al.actor_user_id, al.action, al.shop_id, al.payload, al.created_at
from public.audit_logs al
where al.action in (
  'admin_request_owner_password_reset',
  'admin_set_owner_password',
  'admin_password_reset_email_sent',
  'admin_password_reset_email_failed'
)
  and al.shop_id is not null
  and not exists (
    select 1
    from public.internal_ops_admin_audit ioa
    where ioa.target_shop_id = al.shop_id
      and ioa.action = al.action
      and ioa.created_at = al.created_at
  );

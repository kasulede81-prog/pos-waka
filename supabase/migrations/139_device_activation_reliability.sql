-- Phase 20.2B: Align shop_device_ensure_activation with approval-based device model (138).
-- Extend pending approval TTL so owner auto-activation has time to complete on slow networks.

create or replace function public.shop_device_pending_approval_ttl ()
returns interval
language sql
immutable
as $$
  select interval '15 minutes';
$$;

create or replace function public.shop_device_ensure_activation (
  p_shop_id uuid,
  p_device_fingerprint text,
  p_label text default null,
  p_platform text default null,
  p_app_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fp text;
  v_row public.shop_devices%rowtype;
  v_now timestamptz := timezone('Africa/Kampala', now());
begin
  if not public.user_can_access_shop(p_shop_id) then
    raise exception 'Forbidden';
  end if;

  v_fp := nullif(trim(coalesce(p_device_fingerprint, '')), '');
  if v_fp is null or length(v_fp) < 8 then
    raise exception 'Invalid device fingerprint';
  end if;

  perform public.expire_stale_pending_shop_devices(p_shop_id);

  select d.*
  into v_row
  from public.shop_devices d
  where d.shop_id = p_shop_id
    and d.device_fingerprint = v_fp
  limit 1;

  if public.shop_device_is_operational(v_row.approval_status, v_row.status) then
    update public.shop_devices d
    set
      label = coalesce(nullif(trim(coalesce(p_label, '')), ''), d.label),
      platform = coalesce(nullif(trim(coalesce(p_platform, '')), ''), d.platform),
      app_version = coalesce(nullif(trim(coalesce(p_app_version, '')), ''), d.app_version),
      last_seen_at = v_now,
      last_login_at = v_now,
      updated_at = now()
    where d.id = v_row.id;

    perform public.refresh_shop_active_device_count(p_shop_id);

    return jsonb_build_object(
      'ok', true,
      'accepted', true,
      'activated', true,
      'approval_status', 'approved',
      'status', 'active',
      'existing_device', true,
      'reactivated', false
    );
  end if;

  return public.shop_device_register_on_login(
    p_shop_id,
    p_device_fingerprint,
    p_label,
    p_platform,
    p_app_version
  );
end;
$$;

revoke all on function public.shop_device_ensure_activation (uuid, text, text, text, text) from public;
grant execute on function public.shop_device_ensure_activation (uuid, text, text, text, text) to authenticated;

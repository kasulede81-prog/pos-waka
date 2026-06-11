-- Fix new-shop AI defaults: trigger was inserting all-false rows while backfilled shops got all-true.
-- Non-pilot rollout: new shops inherit open AI access (matches migration 101 backfill).
-- Pilot rollout: only auto-enable when pilot_auto_enable_new_shops is on.

create or replace function public.ensure_shop_ai_settings (p_shop_id uuid)
returns public.shop_ai_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.shop_ai_settings;
  v_settings jsonb;
  v_pilot boolean;
  v_auto boolean;
  v_enabled boolean;
begin
  if p_shop_id is null then
    return null;
  end if;

  v_settings := public.get_platform_ai_settings ();
  v_pilot := coalesce ((v_settings ->> 'pilot_rollout_mode')::boolean, false);
  v_auto := coalesce ((v_settings ->> 'pilot_auto_enable_new_shops')::boolean, false);
  v_enabled := case when v_pilot then v_auto else true end;

  insert into public.shop_ai_settings (
    shop_id,
    ai_enabled,
    product_assistant,
    business_setup_assistant,
    inventory_assistant,
    marketing_assistant,
    marketplace_assistant,
    monthly_request_limit
  )
  values (
    p_shop_id,
    v_enabled,
    v_enabled,
    v_enabled,
    v_enabled,
    false,
    false,
    500
  )
  on conflict (shop_id) do nothing;

  select * into v_row
  from public.shop_ai_settings sas
  where sas.shop_id = p_shop_id;

  return v_row;
end;
$$;

-- Repair shops stuck on trigger defaults (all flags false, never admin-touched).
update public.shop_ai_settings sas
set
  ai_enabled = true,
  product_assistant = true,
  business_setup_assistant = true,
  inventory_assistant = true,
  updated_at = now()
where sas.ai_enabled = false
  and sas.product_assistant = false
  and sas.business_setup_assistant = false
  and sas.inventory_assistant = false
  and sas.marketing_assistant = false
  and sas.marketplace_assistant = false
  and sas.monthly_request_limit = 500
  and coalesce ((public.get_platform_ai_settings () ->> 'pilot_rollout_mode')::boolean, false) = false
  and not exists (
    select 1
    from public.ai_admin_audit_log a
    where a.shop_id = sas.shop_id
      and a.action = 'shop_ai_settings_updated'
  );

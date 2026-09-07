-- BACKOFFICE-04: shop-wide register mode + primary device fingerprint.
-- Extends shop_policy_settings; does not change BACKOFFICE-02 selling/cash keys.

alter table public.shop_policy_settings
  add column if not exists register_mode text not null default 'multi';

alter table public.shop_policy_settings
  drop constraint if exists shop_policy_settings_register_mode_check;

alter table public.shop_policy_settings
  add constraint shop_policy_settings_register_mode_check
  check (register_mode in ('single', 'multi'));

alter table public.shop_policy_settings
  add column if not exists register_mode_updated_at timestamptz not null default 'epoch'::timestamptz;

alter table public.shop_policy_settings
  add column if not exists primary_device_fingerprint text;

alter table public.shop_policy_settings
  add column if not exists primary_device_fingerprint_updated_at timestamptz not null default 'epoch'::timestamptz;

alter table public.shop_policy_settings
  drop constraint if exists shop_policy_settings_primary_device_fingerprint_check;

alter table public.shop_policy_settings
  add constraint shop_policy_settings_primary_device_fingerprint_check
  check (
    primary_device_fingerprint is null
    or char_length(trim(primary_device_fingerprint)) between 8 and 128
  );

create or replace function public.shop_push_shop_policy (
  p_shop_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_payload jsonb := coalesce (p_payload, '{}'::jsonb);
  v_in_at timestamptz;
  v_mode text;
  v_threshold integer;
  v_register text;
  v_fp text;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  insert into public.shop_policy_settings (shop_id)
  values (p_shop_id)
  on conflict (shop_id) do nothing;

  if v_payload ? 'discount_control_mode' then
    v_mode := nullif (trim (v_payload ->> 'discount_control_mode'), '');
    if v_mode in ('unrestricted', 'manager_approval', 'max_percent') then
      v_in_at := coalesce (
        nullif (v_payload ->> 'discount_control_mode_updated_at', '')::timestamptz,
        now ()
      );
      update public.shop_policy_settings s
      set discount_control_mode = v_mode,
          discount_control_mode_updated_at = v_in_at,
          updated_at = now (),
          updated_by = v_uid
      where s.shop_id = p_shop_id
        and public.shop_policy_lww_wins (
          v_in_at,
          s.discount_control_mode_updated_at,
          v_mode,
          s.discount_control_mode
        );
    end if;
  end if;

  if v_payload ? 'discount_max_percent_threshold' then
    begin
      v_threshold := (v_payload ->> 'discount_max_percent_threshold')::integer;
    exception
      when others then
        v_threshold := null;
    end;
    if v_threshold is not null and v_threshold >= 0 and v_threshold <= 100 then
      v_in_at := coalesce (
        nullif (v_payload ->> 'discount_max_percent_threshold_updated_at', '')::timestamptz,
        now ()
      );
      update public.shop_policy_settings s
      set discount_max_percent_threshold = v_threshold,
          discount_max_percent_threshold_updated_at = v_in_at,
          updated_at = now (),
          updated_by = v_uid
      where s.shop_id = p_shop_id
        and public.shop_policy_lww_wins (
          v_in_at,
          s.discount_max_percent_threshold_updated_at,
          v_threshold::text,
          s.discount_max_percent_threshold::text
        );
    end if;
  end if;

  if v_payload ? 'kiosk_quick_sell' then
    v_in_at := coalesce (
      nullif (v_payload ->> 'kiosk_quick_sell_updated_at', '')::timestamptz,
      now ()
    );
    update public.shop_policy_settings s
    set kiosk_quick_sell = (v_payload ->> 'kiosk_quick_sell')::boolean,
        kiosk_quick_sell_updated_at = v_in_at,
        updated_at = now (),
        updated_by = v_uid
    where s.shop_id = p_shop_id
      and public.shop_policy_lww_wins (
        v_in_at,
        s.kiosk_quick_sell_updated_at,
        case when (v_payload ->> 'kiosk_quick_sell')::boolean then '1' else '0' end,
        case when s.kiosk_quick_sell then '1' else '0' end
      );
  end if;

  if v_payload ? 'staff_can_record_cash_expenses' then
    v_in_at := coalesce (
      nullif (v_payload ->> 'staff_can_record_cash_expenses_updated_at', '')::timestamptz,
      now ()
    );
    update public.shop_policy_settings s
    set staff_can_record_cash_expenses = (v_payload ->> 'staff_can_record_cash_expenses')::boolean,
        staff_can_record_cash_expenses_updated_at = v_in_at,
        updated_at = now (),
        updated_by = v_uid
    where s.shop_id = p_shop_id
      and public.shop_policy_lww_wins (
        v_in_at,
        s.staff_can_record_cash_expenses_updated_at,
        case when (v_payload ->> 'staff_can_record_cash_expenses')::boolean then '1' else '0' end,
        case when s.staff_can_record_cash_expenses then '1' else '0' end
      );
  end if;

  if v_payload ? 'require_cashier_expense_approval' then
    v_in_at := coalesce (
      nullif (v_payload ->> 'require_cashier_expense_approval_updated_at', '')::timestamptz,
      now ()
    );
    update public.shop_policy_settings s
    set require_cashier_expense_approval = (v_payload ->> 'require_cashier_expense_approval')::boolean,
        require_cashier_expense_approval_updated_at = v_in_at,
        updated_at = now (),
        updated_by = v_uid
    where s.shop_id = p_shop_id
      and public.shop_policy_lww_wins (
        v_in_at,
        s.require_cashier_expense_approval_updated_at,
        case when (v_payload ->> 'require_cashier_expense_approval')::boolean then '1' else '0' end,
        case when s.require_cashier_expense_approval then '1' else '0' end
      );
  end if;

  if v_payload ? 'register_mode' then
    v_register := nullif (trim (v_payload ->> 'register_mode'), '');
    if v_register in ('single', 'multi') then
      v_in_at := coalesce (
        nullif (v_payload ->> 'register_mode_updated_at', '')::timestamptz,
        now ()
      );
      update public.shop_policy_settings s
      set register_mode = v_register,
          register_mode_updated_at = v_in_at,
          updated_at = now (),
          updated_by = v_uid
      where s.shop_id = p_shop_id
        and public.shop_policy_lww_wins (
          v_in_at,
          s.register_mode_updated_at,
          v_register,
          s.register_mode
        );
    end if;
  end if;

  if v_payload ? 'primary_device_fingerprint' then
    v_fp := nullif (trim (v_payload ->> 'primary_device_fingerprint'), '');
    if v_fp is null or char_length(v_fp) between 8 and 128 then
      v_in_at := coalesce (
        nullif (v_payload ->> 'primary_device_fingerprint_updated_at', '')::timestamptz,
        now ()
      );
      update public.shop_policy_settings s
      set primary_device_fingerprint = v_fp,
          primary_device_fingerprint_updated_at = v_in_at,
          updated_at = now (),
          updated_by = v_uid
      where s.shop_id = p_shop_id
        and public.shop_policy_lww_wins (
          v_in_at,
          s.primary_device_fingerprint_updated_at,
          coalesce(v_fp, ''),
          coalesce(s.primary_device_fingerprint, '')
        );
    end if;
  end if;

  return jsonb_build_object ('ok', true);
end;
$$;

create or replace function public.shop_pull_shop_policy (
  p_shop_id uuid,
  p_since timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.shop_policy_settings%rowtype;
  v_since timestamptz := coalesce (p_since, 'epoch'::timestamptz);
begin
  if auth.uid () is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select *
    into v_row
  from public.shop_policy_settings
  where shop_id = p_shop_id;

  if not found then
    return jsonb_build_object (
      'ok', true,
      'empty', true,
      'checkpoint_at', v_since
    );
  end if;

  if v_row.updated_at <= v_since then
    return jsonb_build_object (
      'ok', true,
      'empty', true,
      'unchanged', true,
      'checkpoint_at', v_row.updated_at
    );
  end if;

  return jsonb_build_object (
    'ok', true,
    'empty', false,
    'shop_id', v_row.shop_id,
    'discount_control_mode', v_row.discount_control_mode,
    'discount_control_mode_updated_at', v_row.discount_control_mode_updated_at,
    'discount_max_percent_threshold', v_row.discount_max_percent_threshold,
    'discount_max_percent_threshold_updated_at', v_row.discount_max_percent_threshold_updated_at,
    'kiosk_quick_sell', v_row.kiosk_quick_sell,
    'kiosk_quick_sell_updated_at', v_row.kiosk_quick_sell_updated_at,
    'staff_can_record_cash_expenses', v_row.staff_can_record_cash_expenses,
    'staff_can_record_cash_expenses_updated_at', v_row.staff_can_record_cash_expenses_updated_at,
    'require_cashier_expense_approval', v_row.require_cashier_expense_approval,
    'require_cashier_expense_approval_updated_at', v_row.require_cashier_expense_approval_updated_at,
    'register_mode', v_row.register_mode,
    'register_mode_updated_at', v_row.register_mode_updated_at,
    'primary_device_fingerprint', v_row.primary_device_fingerprint,
    'primary_device_fingerprint_updated_at', v_row.primary_device_fingerprint_updated_at,
    'checkpoint_at', v_row.updated_at
  );
end;
$$;

comment on column public.shop_policy_settings.register_mode is
  'BACKOFFICE-04 shop-wide single/multi register. Consumed by assertCanFinalizeStockSale.';
comment on column public.shop_policy_settings.primary_device_fingerprint is
  'BACKOFFICE-04 designated primary register device id. Null = no designated primary (existing gate treats all devices as primary).';

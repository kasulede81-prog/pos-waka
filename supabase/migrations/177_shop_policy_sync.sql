-- Shop-wide selling / cash policy settings (live multi-device feed).
-- NOT shop_cloud_snapshots (snapshots remain backup/recovery only).
-- NOT shop_catalog_* (catalog remains the catalog-tree authority).

create table if not exists public.shop_policy_settings (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  discount_control_mode text not null default 'unrestricted'
    check (discount_control_mode in ('unrestricted', 'manager_approval', 'max_percent')),
  discount_control_mode_updated_at timestamptz not null default 'epoch'::timestamptz,
  discount_max_percent_threshold integer not null default 10
    check (discount_max_percent_threshold >= 0 and discount_max_percent_threshold <= 100),
  discount_max_percent_threshold_updated_at timestamptz not null default 'epoch'::timestamptz,
  -- Seed false, not a product default. Business-type defaults live on the client.
  -- Unstamped true ('1') beats this seed at equal epoch; unstamped false ties
  -- and stays false. default true made first-insert LWW flip pharmacy/wholesale
  -- shops to kioskQuickSell=true after an unrelated policy save.
  kiosk_quick_sell boolean not null default false,
  kiosk_quick_sell_updated_at timestamptz not null default 'epoch'::timestamptz,
  staff_can_record_cash_expenses boolean not null default false,
  staff_can_record_cash_expenses_updated_at timestamptz not null default 'epoch'::timestamptz,
  require_cashier_expense_approval boolean not null default false,
  require_cashier_expense_approval_updated_at timestamptz not null default 'epoch'::timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.shop_policy_settings enable row level security;

drop policy if exists shop_policy_settings_select on public.shop_policy_settings;
create policy shop_policy_settings_select
  on public.shop_policy_settings for select
  using (public.user_is_cashier_or_above (shop_id));

drop policy if exists shop_policy_settings_write on public.shop_policy_settings;
create policy shop_policy_settings_write
  on public.shop_policy_settings for all
  using (public.user_can_manage_shop (shop_id))
  with check (public.user_can_manage_shop (shop_id));

-- Per-field LWW: newer timestamp wins. Equal timestamps use a deterministic
-- lexicographic tie-break so arrival order cannot resurrect a stale peer.
create or replace function public.shop_policy_lww_wins (
  p_incoming_at timestamptz,
  p_stored_at timestamptz,
  p_incoming_tie text,
  p_stored_tie text
)
returns boolean
language sql
immutable
as $$
  select
    p_stored_at is null
    or p_incoming_at > p_stored_at
    or (
      p_incoming_at = p_stored_at
      and coalesce(p_incoming_tie, '') > coalesce(p_stored_tie, '')
    );
$$;

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
    'checkpoint_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.shop_policy_lww_wins (timestamptz, timestamptz, text, text) from public;
revoke all on function public.shop_push_shop_policy (uuid, jsonb) from public;
revoke all on function public.shop_pull_shop_policy (uuid, timestamptz) from public;
grant execute on function public.shop_push_shop_policy (uuid, jsonb) to authenticated;
grant execute on function public.shop_pull_shop_policy (uuid, timestamptz) to authenticated;

comment on table public.shop_policy_settings is
  'Shop-wide selling/cash policy. Live multi-device sync; not snapshot LWW and not catalog.';
comment on function public.shop_push_shop_policy (uuid, jsonb) is
  'Per-field LWW upsert of shop policy. Manager-only; never trusts client shopId alone.';
comment on function public.shop_pull_shop_policy (uuid, timestamptz) is
  'Pull shop policy for any shop member (cashier and above). Missing row is empty, not an error.';

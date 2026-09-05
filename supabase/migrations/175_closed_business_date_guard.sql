-- CASH-CONTROL-01: server-side closed business-date mutation rejection.
-- Authority = existing shop_day_closes active row (superseded_at is null).
-- Lock key matches shop_push_day_close so close and mutations serialize.

create or replace function public.assert_shop_business_date_open (
  p_shop_id uuid,
  p_date_key text
)
returns jsonb
language plpgsql
as $$
declare
  v_date_key text := nullif (trim (p_date_key), '');
begin
  if p_shop_id is null or v_date_key is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;

  perform pg_advisory_xact_lock (hashtext (p_shop_id::text), hashtext (v_date_key));

  if exists (
    select 1
    from public.shop_day_closes d
    where d.shop_id = p_shop_id
      and d.date_key = v_date_key
      and d.superseded_at is null
  ) then
    return jsonb_build_object ('ok', false, 'error', 'closed_business_date');
  end if;

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.assert_shop_business_date_open (uuid, text) from public;
grant execute on function public.assert_shop_business_date_open (uuid, text) to authenticated;

create or replace function public.enforce_closed_business_date ()
returns trigger
language plpgsql
as $$
declare
  v_date_key text;
  v_shop_id uuid;
  v_guard jsonb;
  v_old_status text;
  v_new_status text;
  v_existing boolean := false;
begin
  v_shop_id := NEW.shop_id;

  if TG_TABLE_NAME = 'sales' then
    v_date_key := to_char (
      public._sale_kampala_day (coalesce (NEW.created_at, NEW.completed_at, now ())),
      'YYYY-MM-DD'
    );
  elsif TG_TABLE_NAME = 'sale_returns' then
    v_date_key := to_char (public._sale_kampala_day (NEW.created_at), 'YYYY-MM-DD');
  elsif TG_TABLE_NAME = 'expenses' then
    v_date_key := to_char (NEW.paid_on, 'YYYY-MM-DD');
  elsif TG_TABLE_NAME = 'customer_debt_payments' then
    v_date_key := to_char (public._sale_kampala_day (NEW.created_at), 'YYYY-MM-DD');
  elsif TG_TABLE_NAME = 'shop_supplier_payments' then
    v_date_key := to_char (public._sale_kampala_day (NEW.created_at), 'YYYY-MM-DD');
  elsif TG_TABLE_NAME = 'shop_cash_drawer_adjustments' then
    v_date_key := to_char (public._sale_kampala_day (NEW.occurred_at), 'YYYY-MM-DD');
  else
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    if TG_TABLE_NAME = 'sales' then
      select exists (
        select 1 from public.sales s where s.id = NEW.id and s.shop_id = NEW.shop_id
      ) into v_existing;
    elsif TG_TABLE_NAME = 'sale_returns' then
      select exists (
        select 1 from public.sale_returns r where r.id = NEW.id and r.shop_id = NEW.shop_id
      ) into v_existing;
    elsif TG_TABLE_NAME = 'expenses' then
      select exists (
        select 1 from public.expenses e where e.id = NEW.id and e.shop_id = NEW.shop_id
      ) into v_existing;
    elsif TG_TABLE_NAME = 'customer_debt_payments' then
      select exists (
        select 1 from public.customer_debt_payments p where p.id = NEW.id and p.shop_id = NEW.shop_id
      ) into v_existing;
    elsif TG_TABLE_NAME = 'shop_supplier_payments' then
      select exists (
        select 1 from public.shop_supplier_payments p where p.id = NEW.id and p.shop_id = NEW.shop_id
      ) into v_existing;
    elsif TG_TABLE_NAME = 'shop_cash_drawer_adjustments' then
      select exists (
        select 1 from public.shop_cash_drawer_adjustments a where a.id = NEW.id and a.shop_id = NEW.shop_id
      ) into v_existing;
    end if;

    if v_existing then
      return NEW;
    end if;
  end if;

  if TG_OP = 'UPDATE' then
    if TG_TABLE_NAME = 'sales' then
      if not (
        (NEW.status = 'completed' and OLD.status is distinct from 'completed')
        or NEW.total_ugx is distinct from OLD.total_ugx
        or NEW.cash_amount_ugx is distinct from OLD.cash_amount_ugx
        or NEW.debt_amount_ugx is distinct from OLD.debt_amount_ugx
      ) then
        return NEW;
      end if;
    elsif TG_TABLE_NAME = 'expenses' then
      v_old_status := coalesce (OLD.metadata ->> 'approvalStatus', 'approved');
      v_new_status := coalesce (NEW.metadata ->> 'approvalStatus', 'approved');
      if NEW.deleted_at is not null
         and OLD.deleted_at is null
         and v_old_status = 'pending' then
        return NEW;
      end if;
      if NEW.amount_ugx is not distinct from OLD.amount_ugx
         and NEW.paid_on is not distinct from OLD.paid_on
         and NEW.deleted_at is not distinct from OLD.deleted_at
         and v_old_status is not distinct from v_new_status then
        return NEW;
      end if;
    elsif TG_TABLE_NAME in (
      'sale_returns',
      'customer_debt_payments',
      'shop_supplier_payments',
      'shop_cash_drawer_adjustments'
    ) then
      return NEW;
    end if;
  end if;

  v_guard := public.assert_shop_business_date_open (v_shop_id, v_date_key);
  if coalesce ((v_guard ->> 'ok')::boolean, false) is not true then
    raise exception 'closed_business_date';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_sales_closed_business_date on public.sales;
create trigger trg_sales_closed_business_date
  before insert or update on public.sales
  for each row execute function public.enforce_closed_business_date ();

drop trigger if exists trg_sale_returns_closed_business_date on public.sale_returns;
create trigger trg_sale_returns_closed_business_date
  before insert or update on public.sale_returns
  for each row execute function public.enforce_closed_business_date ();

drop trigger if exists trg_expenses_closed_business_date on public.expenses;
create trigger trg_expenses_closed_business_date
  before insert or update on public.expenses
  for each row execute function public.enforce_closed_business_date ();

drop trigger if exists trg_debt_payments_closed_business_date on public.customer_debt_payments;
create trigger trg_debt_payments_closed_business_date
  before insert or update on public.customer_debt_payments
  for each row execute function public.enforce_closed_business_date ();

drop trigger if exists trg_supplier_payments_closed_business_date on public.shop_supplier_payments;
create trigger trg_supplier_payments_closed_business_date
  before insert or update on public.shop_supplier_payments
  for each row execute function public.enforce_closed_business_date ();

drop trigger if exists trg_cash_adjustments_closed_business_date on public.shop_cash_drawer_adjustments;
create trigger trg_cash_adjustments_closed_business_date
  before insert or update on public.shop_cash_drawer_adjustments
  for each row execute function public.enforce_closed_business_date ();

create or replace function public.shop_push_cash_expense (
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
  v_id uuid;
  v_category text;
  v_amount bigint;
  v_desc text;
  v_paid date;
  v_created timestamptz;
  v_staff_id text;
  v_staff_label text;
  v_exists boolean := false;
  v_guard jsonb;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_required');
  end if;
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif (p_payload ->> 'id', '')::uuid;
  v_category := nullif (trim (p_payload ->> 'category'), '');
  v_amount := coalesce ((p_payload ->> 'amount_ugx')::bigint, 0);
  v_desc := nullif (trim (p_payload ->> 'description'), '');
  v_paid := coalesce (
    nullif (p_payload ->> 'paid_on', '')::date,
    public._sale_kampala_day (now ())
  );
  v_created := coalesce (
    nullif (p_payload ->> 'created_at', '')::timestamptz,
    now ()
  );
  v_staff_id := nullif (trim (p_payload ->> 'recorded_by_staff_id'), '');
  v_staff_label := nullif (trim (p_payload ->> 'recorded_by_label'), '');

  if v_id is null or v_category is null or v_amount <= 0 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;

  select exists (
    select 1 from public.expenses e where e.id = v_id and e.shop_id = p_shop_id
  ) into v_exists;

  if not v_exists then
    v_guard := public.assert_shop_business_date_open (p_shop_id, to_char (v_paid, 'YYYY-MM-DD'));
    if coalesce ((v_guard ->> 'ok')::boolean, false) is not true then
      return v_guard;
    end if;
  end if;

  insert into public.expenses (
    id,
    shop_id,
    expense_type,
    category,
    amount_ugx,
    description,
    paid_on,
    created_by,
    created_at,
    updated_at,
    updated_by,
    recorded_by_staff_id,
    recorded_by_label,
    metadata
  )
  values (
    v_id,
    p_shop_id,
    'cash_drawer',
    v_category,
    v_amount,
    v_desc,
    v_paid,
    v_uid,
    v_created,
    now (),
    v_uid,
    v_staff_id,
    v_staff_label,
    coalesce (p_payload -> 'metadata', '{}'::jsonb)
  )
  on conflict (id) do update
  set
    category = excluded.category,
    amount_ugx = excluded.amount_ugx,
    description = excluded.description,
    paid_on = excluded.paid_on,
    updated_at = now (),
    updated_by = v_uid,
    recorded_by_staff_id = coalesce (excluded.recorded_by_staff_id, public.expenses.recorded_by_staff_id),
    recorded_by_label = coalesce (excluded.recorded_by_label, public.expenses.recorded_by_label),
    metadata = public.expenses.metadata || excluded.metadata
  where public.expenses.shop_id = p_shop_id
    and public.expenses.deleted_at is null;

  return jsonb_build_object ('ok', true, 'id', v_id);
exception
  when others then
    if sqlerrm = 'closed_business_date' then
      return jsonb_build_object ('ok', false, 'error', 'closed_business_date');
    end if;
    return jsonb_build_object ('ok', false, 'error', 'save_failed', 'detail', sqlerrm);
end;
$$;

revoke all on function public.shop_push_cash_expense (uuid, jsonb) from public;
grant execute on function public.shop_push_cash_expense (uuid, jsonb) to authenticated;

create or replace function public.shop_void_cash_expense (
  p_shop_id uuid,
  p_expense_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_paid date;
  v_status text;
  v_guard jsonb;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select e.paid_on, coalesce (e.metadata ->> 'approvalStatus', 'approved')
  into v_paid, v_status
  from public.expenses e
  where e.id = p_expense_id
    and e.shop_id = p_shop_id
    and e.expense_type = 'cash_drawer'
    and e.deleted_at is null;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  if v_status is distinct from 'pending' then
    v_guard := public.assert_shop_business_date_open (p_shop_id, to_char (v_paid, 'YYYY-MM-DD'));
    if coalesce ((v_guard ->> 'ok')::boolean, false) is not true then
      return v_guard;
    end if;
  end if;

  update public.expenses e
  set
    deleted_at = now (),
    updated_at = now (),
    updated_by = v_uid
  where e.id = p_expense_id
    and e.shop_id = p_shop_id
    and e.expense_type = 'cash_drawer'
    and e.deleted_at is null;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object ('ok', true);
exception
  when others then
    if sqlerrm = 'closed_business_date' then
      return jsonb_build_object ('ok', false, 'error', 'closed_business_date');
    end if;
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_void_cash_expense (uuid, uuid) from public;
grant execute on function public.shop_void_cash_expense (uuid, uuid) to authenticated;

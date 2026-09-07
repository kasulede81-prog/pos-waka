-- NEW-04: close the UPDATE gap on financial tables that migration 175
-- already guards on INSERT. Same function + triggers; no second authority.

create or replace function public.enforce_closed_business_date ()
returns trigger
language plpgsql
as $$
declare
  v_date_key text;
  v_old_date_key text;
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
    if TG_OP = 'UPDATE' then
      v_old_date_key := to_char (
        public._sale_kampala_day (coalesce (OLD.created_at, OLD.completed_at, now ())),
        'YYYY-MM-DD'
      );
    end if;
  elsif TG_TABLE_NAME = 'sale_returns' then
    v_date_key := to_char (public._sale_kampala_day (NEW.created_at), 'YYYY-MM-DD');
    if TG_OP = 'UPDATE' then
      v_old_date_key := to_char (public._sale_kampala_day (OLD.created_at), 'YYYY-MM-DD');
    end if;
  elsif TG_TABLE_NAME = 'expenses' then
    v_date_key := to_char (NEW.paid_on, 'YYYY-MM-DD');
    if TG_OP = 'UPDATE' then
      v_old_date_key := to_char (OLD.paid_on, 'YYYY-MM-DD');
    end if;
  elsif TG_TABLE_NAME = 'customer_debt_payments' then
    v_date_key := to_char (public._sale_kampala_day (NEW.created_at), 'YYYY-MM-DD');
    if TG_OP = 'UPDATE' then
      v_old_date_key := to_char (public._sale_kampala_day (OLD.created_at), 'YYYY-MM-DD');
    end if;
  elsif TG_TABLE_NAME = 'shop_supplier_payments' then
    v_date_key := to_char (public._sale_kampala_day (NEW.created_at), 'YYYY-MM-DD');
    if TG_OP = 'UPDATE' then
      v_old_date_key := to_char (public._sale_kampala_day (OLD.created_at), 'YYYY-MM-DD');
    end if;
  elsif TG_TABLE_NAME = 'shop_cash_drawer_adjustments' then
    v_date_key := to_char (public._sale_kampala_day (NEW.occurred_at), 'YYYY-MM-DD');
    if TG_OP = 'UPDATE' then
      v_old_date_key := to_char (public._sale_kampala_day (OLD.occurred_at), 'YYYY-MM-DD');
    end if;
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
    elsif TG_TABLE_NAME = 'sale_returns' then
      if NEW.quantity is not distinct from OLD.quantity
         and NEW.refund_amount_ugx is not distinct from OLD.refund_amount_ugx
         and NEW.created_at is not distinct from OLD.created_at
         and NEW.product_id is not distinct from OLD.product_id
         and NEW.sale_id is not distinct from OLD.sale_id
         and NEW.shop_id is not distinct from OLD.shop_id then
        return NEW;
      end if;
    elsif TG_TABLE_NAME = 'customer_debt_payments' then
      if NEW.amount_ugx is not distinct from OLD.amount_ugx
         and NEW.created_at is not distinct from OLD.created_at
         and NEW.customer_id is not distinct from OLD.customer_id
         and NEW.shop_id is not distinct from OLD.shop_id then
        return NEW;
      end if;
    elsif TG_TABLE_NAME = 'shop_supplier_payments' then
      if NEW.amount_ugx is not distinct from OLD.amount_ugx
         and NEW.created_at is not distinct from OLD.created_at
         and NEW.supplier_id is not distinct from OLD.supplier_id
         and NEW.shop_id is not distinct from OLD.shop_id then
        return NEW;
      end if;
    elsif TG_TABLE_NAME = 'shop_cash_drawer_adjustments' then
      if NEW.amount_ugx is not distinct from OLD.amount_ugx
         and NEW.adjustment_type is not distinct from OLD.adjustment_type
         and NEW.occurred_at is not distinct from OLD.occurred_at
         and NEW.deleted_at is not distinct from OLD.deleted_at
         and NEW.shop_id is not distinct from OLD.shop_id then
        return NEW;
      end if;
    end if;
  end if;

  v_guard := public.assert_shop_business_date_open (v_shop_id, v_date_key);
  if coalesce ((v_guard ->> 'ok')::boolean, false) is not true then
    raise exception 'closed_business_date';
  end if;

  if TG_OP = 'UPDATE'
     and (
       OLD.shop_id is distinct from v_shop_id
       or v_old_date_key is distinct from v_date_key
     ) then
    v_guard := public.assert_shop_business_date_open (OLD.shop_id, v_old_date_key);
    if coalesce ((v_guard ->> 'ok')::boolean, false) is not true then
      raise exception 'closed_business_date';
    end if;
  end if;

  return NEW;
end;
$$;

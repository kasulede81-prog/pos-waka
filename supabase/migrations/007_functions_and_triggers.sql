-- Waka POS — security-definer helpers, stock + receipt automation, auth → profile

-- ---------- access helpers (used by RLS in 008) ----------
create or replace function public.get_user_org_ids ()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.organization_members
  where user_id = auth.uid ();
$$;

create or replace function public.user_has_org_role (p_org uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org
      and m.user_id = auth.uid ()
      and m.role = any (p_roles)
  );
$$;

create or replace function public.user_can_access_shop (p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_members sm
    where sm.shop_id = p_shop and sm.user_id = auth.uid ()
  )
  or exists (
    select 1
    from public.shops sh
    join public.organization_members om on om.organization_id = sh.organization_id
    where sh.id = p_shop
      and om.user_id = auth.uid ()
      and om.role in ('owner', 'admin')
  );
$$;

create or replace function public.user_can_manage_shop (p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_members sm
    where sm.shop_id = p_shop
      and sm.user_id = auth.uid ()
      and sm.role = 'manager'
  )
  or exists (
    select 1
    from public.shops sh
    join public.organization_members om on om.organization_id = sh.organization_id
    where sh.id = p_shop
      and om.user_id = auth.uid ()
      and om.role in ('owner', 'admin')
  );
$$;

create or replace function public.user_is_cashier_or_above (p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_members sm
    where sm.shop_id = p_shop
      and sm.user_id = auth.uid ()
      and sm.role in ('manager', 'cashier')
  )
  or public.user_can_manage_shop (p_shop);
$$;

-- ---------- counters & receipts ----------
create or replace function public.next_shop_counter (p_shop uuid, p_key text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
begin
  insert into public.shop_counters (shop_id, counter_key, last_value)
  values (p_shop, p_key, 1)
  on conflict (shop_id, counter_key)
  do update set last_value = public.shop_counters.last_value + 1
  returning last_value into v_next;
  return v_next;
end;
$$;

create or replace function public.build_receipt_code (p_shop uuid, p_seq bigint)
returns text
language sql
immutable
as $$
  select 'RCP-' || to_char (timezone ('Africa/Kampala', now()), 'YYYYMMDD') || '-' || lpad (p_seq::text, 6, '0');
$$;

create or replace function public.create_receipt_for_sale (p_sale_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid;
  v_num bigint;
  v_code text;
  v_rid uuid;
begin
  select shop_id into v_shop from public.sales where id = p_sale_id;
  if v_shop is null then
    raise exception 'Sale % not found', p_sale_id;
  end if;

  if exists (select 1 from public.receipts where sale_id = p_sale_id) then
    select id into v_rid from public.receipts where sale_id = p_sale_id;
    return v_rid;
  end if;

  v_num := public.next_shop_counter (v_shop, 'receipt');
  v_code := public.build_receipt_code (v_shop, v_num);

  insert into public.receipts (shop_id, sale_id, receipt_number, receipt_code)
  values (v_shop, p_sale_id, v_num, v_code)
  returning id into v_rid;

  return v_rid;
end;
$$;

-- ---------- stock ----------
create or replace function public.apply_sale_stock_movements (p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_shop uuid;
  v_new numeric;
begin
  select shop_id into strict v_shop from public.sales where id = p_sale_id;

  for r in
    select sli.product_id, sli.quantity
    from public.sale_line_items sli
    where sli.sale_id = p_sale_id
  loop
    update public.products p
    set stock_on_hand = p.stock_on_hand - r.quantity,
        updated_at = now ()
    where p.id = r.product_id
      and p.shop_id = v_shop
    returning p.stock_on_hand into v_new;

    if not found then
      raise exception 'Product % not in this shop', r.product_id;
    end if;

    if v_new < 0 then
      raise exception 'Insufficient stock for product %', r.product_id;
    end if;

    insert into public.inventory_movements (
      shop_id, product_id, quantity_delta, reason, reference_type, reference_id, created_by
    )
    values (
      v_shop,
      r.product_id,
      -r.quantity,
      'sale',
      'sale',
      p_sale_id,
      auth.uid ()
    );
  end loop;
end;
$$;

create or replace function public.reverse_sale_stock_movements (p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_shop uuid;
begin
  select shop_id into v_shop from public.sales where id = p_sale_id;
  if v_shop is null then
    raise exception 'Sale not found';
  end if;

  for r in
    select sli.product_id, sli.quantity
    from public.sale_line_items sli
    where sli.sale_id = p_sale_id
  loop
    update public.products
    set stock_on_hand = stock_on_hand + r.quantity,
        updated_at = now ()
    where id = r.product_id and shop_id = v_shop;

    insert into public.inventory_movements (
      shop_id, product_id, quantity_delta, reason, reference_type, reference_id, created_by
    )
    values (
      v_shop,
      r.product_id,
      r.quantity,
      'return',
      'sale',
      p_sale_id,
      auth.uid ()
    );
  end loop;
end;
$$;

create or replace function public.trg_sales_status_stock ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.status = 'completed' and old.status is distinct from 'completed' then
      perform public.apply_sale_stock_movements (new.id);
      perform public.create_receipt_for_sale (new.id);
    elsif old.status = 'completed' and new.status in ('void', 'refunded') then
      perform public.reverse_sale_stock_movements (old.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sales_status_stock on public.sales;
create trigger trg_sales_status_stock
  after update on public.sales
  for each row execute function public.trg_sales_status_stock ();

-- ---------- RPC: manual inventory adjustment ----------
create or replace function public.rpc_inventory_adjust (
  p_shop_id uuid,
  p_product_id uuid,
  p_delta numeric,
  p_reason text,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_can_manage_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if p_reason not in ('adjustment', 'waste', 'initial', 'transfer', 'other') then
    raise exception 'Invalid reason';
  end if;

  update public.products
  set stock_on_hand = stock_on_hand + p_delta,
      updated_at = now ()
  where id = p_product_id and shop_id = p_shop_id;

  if not found then
    raise exception 'Product not in shop';
  end if;

  insert into public.inventory_movements (
    shop_id, product_id, quantity_delta, reason, reference_type, note, created_by
  )
  values (
    p_shop_id, p_product_id, p_delta, p_reason, 'manual', p_note, auth.uid ()
  );
end;
$$;

grant execute on function public.rpc_inventory_adjust (uuid, uuid, numeric, text, text) to authenticated;

-- ---------- Low stock report ----------
create or replace function public.rpc_low_stock (p_shop_id uuid, p_limit int default 50)
returns table (
  product_id uuid,
  name text,
  sku text,
  stock_on_hand numeric,
  reorder_level numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.sku, p.stock_on_hand, p.reorder_level
  from public.products p
  where p.shop_id = p_shop_id
    and p.is_active
    and p.stock_on_hand <= p.reorder_level
    and p.reorder_level > 0
  order by p.stock_on_hand asc
  limit greatest (1, least (p_limit, 500));
$$;

grant execute on function public.rpc_low_stock (uuid, int) to authenticated;

-- ---------- Auth: profile bootstrap ----------
create or replace function public.handle_new_user ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, business_name, phone_e164)
  values (
    new.id,
    nullif (trim (new.raw_user_meta_data ->> 'full_name'), ''),
    nullif (trim (new.raw_user_meta_data ->> 'business_name'), ''),
    case
      when (new.raw_user_meta_data ->> 'phone_e164') ~ '^\+256[0-9]{9}$'
        then trim (new.raw_user_meta_data ->> 'phone_e164')
      else null
    end
  )
  on conflict (id) do update
    set full_name = coalesce (excluded.full_name, public.profiles.full_name),
        business_name = coalesce (excluded.business_name, public.profiles.business_name),
        phone_e164 = coalesce (excluded.phone_e164, public.profiles.phone_e164),
        updated_at = now ();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user ();

grant execute on function public.get_user_org_ids () to authenticated;
grant execute on function public.user_has_org_role (uuid, text[]) to authenticated;
grant execute on function public.user_can_access_shop (uuid) to authenticated;
grant execute on function public.user_can_manage_shop (uuid) to authenticated;
grant execute on function public.user_is_cashier_or_above (uuid) to authenticated;

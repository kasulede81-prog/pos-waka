-- Internal admin: read shop inventory + cloud snapshots; shop detail with live metrics.

-- Products: internal staff can read any shop catalog (support console).
drop policy if exists products_internal_staff_select on public.products;
create policy products_internal_staff_select
  on public.products for select
  using (public.is_waka_internal_staff ());

-- Cloud snapshots: internal staff can inspect backup age/size for support.
drop policy if exists shop_cloud_snapshots_internal_select on public.shop_cloud_snapshots;
create policy shop_cloud_snapshots_internal_select
  on public.shop_cloud_snapshots for select
  using (public.is_waka_internal_staff ());

-- Shop detail bundle for the internal user card (counts + product preview + cloud backup hint).
create or replace function public.internal_ops_shop_detail (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j jsonb;
  v_table_products int := 0;
  v_table_sales_30d int := 0;
  v_snap jsonb;
  v_snap_products int := 0;
  v_snap_sales int := 0;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select count(*)::int
  into v_table_products
  from public.products p
  where p.shop_id = p_shop_id and coalesce (p.is_active, true);

  select count(*)::int
  into v_table_sales_30d
  from public.sales s
  where s.shop_id = p_shop_id
    and s.status = 'completed'
    and s.created_at >= timezone ('Africa/Kampala', now ()) - interval '30 days';

  select scs.snapshot
  into v_snap
  from public.shop_cloud_snapshots scs
  where scs.shop_id = p_shop_id;

  if v_snap is not null then
    v_snap_products := coalesce(
      jsonb_array_length(v_snap -> 'snapshot' -> 'products'),
      jsonb_array_length(v_snap -> 'products'),
      0
    );
    v_snap_sales := coalesce(
      jsonb_array_length(v_snap -> 'snapshot' -> 'sales'),
      jsonb_array_length(v_snap -> 'sales'),
      0
    );
  end if;

  select
    jsonb_build_object (
      'shop',
      to_jsonb (sh),
      'owner_label',
      coalesce(
        nullif (trim (pr.full_name), ''),
        nullif (trim (pr.business_name), ''),
        nullif (lower (trim (pr.email)), ''),
        own.user_id::text
      ),
      'owner_email',
      lower (trim (pr.email)),
      'product_count',
      greatest (v_table_products, v_snap_products),
      'product_count_table',
      v_table_products,
      'product_count_snapshot',
      v_snap_products,
      'sale_count_30d',
      greatest (v_table_sales_30d, 0),
      'sale_count_table_30d',
      v_table_sales_30d,
      'sales_in_snapshot',
      v_snap_sales,
      'last_sale_at',
      (
        select max (s.created_at)
        from public.sales s
        where s.shop_id = sh.id and s.status = 'completed'
      ),
      'cloud_snapshot_at',
      (select scs.updated_at from public.shop_cloud_snapshots scs where scs.shop_id = sh.id),
      'cloud_snapshot_bytes',
      (select scs.byte_size from public.shop_cloud_snapshots scs where scs.shop_id = sh.id),
      'products_preview',
      (
        select coalesce (jsonb_agg (to_jsonb (x)), '[]'::jsonb)
        from (
          select
            p.id,
            p.name,
            coalesce (pc.name, nullif (trim (p.metadata ->> 'category'), ''), 'Uncategorized') as category,
            p.selling_price_per_unit_ugx as selling_price_ugx,
            p.stock_on_hand as stock_quantity,
            p.is_active,
            p.updated_at
          from public.products p
          left join public.product_categories pc on pc.id = p.category_id
          where p.shop_id = p_shop_id
          order by p.updated_at desc nulls last
          limit 80
        ) x
      ),
      'subscription',
      (
        select to_jsonb (s)
        from public.subscriptions s
        where s.organization_id = sh.organization_id
        order by s.created_at desc
        limit 1
      ),
      'plan_code',
      (
        select sp2.code
        from public.subscriptions s
        join public.subscription_plans sp2 on sp2.id = s.plan_id
        where s.organization_id = sh.organization_id
        order by s.created_at desc
        limit 1
      ),
      'devices',
      (
        select coalesce (jsonb_agg (to_jsonb (x)), '[]'::jsonb)
        from (
          select d.*
          from public.shop_devices d
          where d.shop_id = p_shop_id
          order by d.last_seen_at desc nulls last
          limit 50
        ) x
      ),
      'sync_health',
      (
        select to_jsonb (sy)
        from public.sync_health sy
        where sy.shop_id = p_shop_id
      ),
      'subscription_payments_recent',
      (
        select coalesce (jsonb_agg (to_jsonb (y)), '[]'::jsonb)
        from (
          select sp2.*
          from public.subscription_payments sp2
          join public.subscriptions s2 on s2.id = sp2.subscription_id
          join public.shops sh2 on sh2.organization_id = s2.organization_id
          where sh2.id = p_shop_id
          order by sp2.created_at desc
          limit 12
        ) y
      )
    )
  into j
  from public.shops sh
  left join lateral (
    select sm.user_id
    from public.shop_members sm
    where sm.shop_id = sh.id
      and sm.role = 'owner'
    order by sm.created_at asc
    limit 1
  ) own on true
  left join public.profiles pr on pr.id = own.user_id
  where sh.id = p_shop_id;

  return coalesce (j, '{}'::jsonb);
end;
$$;

revoke all on function public.internal_ops_shop_detail (uuid) from public;
grant execute on function public.internal_ops_shop_detail (uuid) to authenticated;

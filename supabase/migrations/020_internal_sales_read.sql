-- Let Waka internal staff read sales aggregates for ops dashboards (no write access added).

drop policy if exists sales_select on public.sales;
create policy sales_select
  on public.sales for select
  using (
    public.user_can_access_shop (shop_id)
    or public.is_waka_internal_staff ()
  );

drop policy if exists sale_lines_select on public.sale_line_items;
create policy sale_lines_select
  on public.sale_line_items for select
  using (
    exists (
      select 1
      from public.sales s
      where s.id = sale_line_items.sale_id
        and (
          public.user_can_access_shop (s.shop_id)
          or public.is_waka_internal_staff ()
        )
    )
  );

-- Aggregate for internal dashboard (avoids shipping huge sale rows to the browser).
create or replace function public.internal_ops_sales_total_ugx ()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  return coalesce(
    (
      select sum(s.total_ugx)::bigint
      from public.sales s
      where s.status = 'completed'
    ),
    0
  );
end;
$$;

revoke all on function public.internal_ops_sales_total_ugx () from public;
grant execute on function public.internal_ops_sales_total_ugx () to authenticated;

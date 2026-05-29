-- Waka site-wide shop numbers: A001, A002, … by registration order (first shop = A001).

alter table public.shops
  add column if not exists shop_number text;

create unique index if not exists shops_shop_number_unique_idx
  on public.shops (shop_number)
  where shop_number is not null;

comment on column public.shops.shop_number is
  'Public Waka shop number (A001 = first registered shop on the platform).';

create table if not exists public.waka_shop_number_counter (
  id int primary key default 1 check (id = 1),
  next_seq int not null default 1
);

insert into public.waka_shop_number_counter (id, next_seq)
values (1, 1)
on conflict (id) do nothing;

create or replace function public.format_waka_shop_number (p_seq int)
returns text
language sql
immutable
as $$
  select 'A' || lpad(greatest (p_seq, 1)::text, 3, '0');
$$;

create or replace function public.next_waka_shop_number ()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq int;
begin
  update public.waka_shop_number_counter
  set next_seq = next_seq + 1
  where id = 1
  returning next_seq - 1 into v_seq;

  if v_seq is null then
    insert into public.waka_shop_number_counter (id, next_seq)
    values (1, 2)
    on conflict (id) do update
    set next_seq = public.waka_shop_number_counter.next_seq + 1
    returning next_seq - 1 into v_seq;
  end if;

  return public.format_waka_shop_number (v_seq);
end;
$$;

revoke all on function public.next_waka_shop_number () from public;
grant execute on function public.next_waka_shop_number () to authenticated;

create or replace function public.trg_shops_assign_waka_number ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.shop_number is null or trim (new.shop_number) = '' then
    new.shop_number := public.next_waka_shop_number ();
  else
    new.shop_number := upper (trim (new.shop_number));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_shops_waka_number on public.shops;
create trigger trg_shops_waka_number
  before insert on public.shops
  for each row execute function public.trg_shops_assign_waka_number ();

-- Backfill existing shops in signup order.
with ordered as (
  select
    s.id,
    row_number() over (order by s.created_at asc, s.id asc) as rn
  from public.shops s
  where s.shop_number is null
)
update public.shops sh
set shop_number = public.format_waka_shop_number (o.rn::int)
from ordered o
where sh.id = o.id;

update public.waka_shop_number_counter
set next_seq = coalesce(
  (
    select max(
      nullif(regexp_replace(upper (trim (s.shop_number)), '^A', ''), '')::int
    ) + 1
    from public.shops s
    where s.shop_number ~ '^A[0-9]+$'
  ),
  1
)
where id = 1;

alter table public.shops
  alter column shop_number set not null;

-- Resolve shop UUID from A001-style number (internal support).
create or replace function public.resolve_shop_id_by_number (p_shop_number text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;
  return (
    select s.id
    from public.shops s
    where upper (trim (s.shop_number)) = upper (trim (p_shop_number))
    limit 1
  );
end;
$$;

revoke all on function public.resolve_shop_id_by_number (text) from public;
grant execute on function public.resolve_shop_id_by_number (text) to authenticated;

-- Recent shops list includes shop_number (must drop first — return type changed vs 045).
drop function if exists public.internal_ops_recent_shops (int);

create or replace function public.internal_ops_recent_shops (p_limit int default 20)
returns table (
  id uuid,
  shop_number text,
  name text,
  district text,
  city text,
  is_active boolean,
  created_at timestamptz,
  organization_id uuid,
  plan_code text,
  trial_ends_at timestamptz,
  subscription_status text,
  owner_label text,
  owner_email text,
  phone_e164 text,
  business_type text,
  gps_missing boolean,
  last_seen_at timestamptz,
  product_count int,
  sale_count_30d int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  return query
  select
    s.id,
    s.shop_number,
    s.name,
    s.district,
    s.city,
    s.is_active,
    s.created_at,
    s.organization_id,
    sp.code as plan_code,
    sub.trial_ends_at,
    sub.status as subscription_status,
    coalesce(
      nullif (trim (pr.full_name), ''),
      nullif (trim (pr.business_name), ''),
      nullif (lower (trim (pr.email)), ''),
      own.user_id::text
    ) as owner_label,
    lower (trim (pr.email)) as owner_email,
    coalesce (s.phone_e164, pr.phone_e164) as phone_e164,
    s.business_type,
    coalesce (s.gps_missing, true) as gps_missing,
    s.last_seen_at,
    (
      select count(*)::int
      from public.products p
      where p.shop_id = s.id and coalesce (p.is_active, true)
    ) as product_count,
    coalesce (sa.sale_count_30d, 0)::int as sale_count_30d
  from public.shops s
  left join public.shop_activity sa on sa.shop_id = s.id
  left join lateral (
    select sm.user_id
    from public.shop_members sm
    where sm.shop_id = s.id
    order by (case when sm.role = 'owner' then 0 else 1 end), sm.created_at asc
    limit 1
  ) own on true
  left join public.profiles pr on pr.id = own.user_id
  left join lateral (
    select s2.*
    from public.subscriptions s2
    where s2.organization_id = s.organization_id
    order by s2.created_at desc
    limit 1
  ) sub on true
  left join public.subscription_plans sp on sp.id = sub.plan_id
  order by s.created_at desc
  limit greatest (1, least (coalesce (p_limit, 20), 200));
end;
$$;

revoke all on function public.internal_ops_recent_shops (int) from public;
grant execute on function public.internal_ops_recent_shops (int) to authenticated;

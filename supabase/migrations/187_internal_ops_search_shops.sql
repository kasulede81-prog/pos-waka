-- ADMIN-1: server-side global shop discovery for internal staff.
-- Browse (empty query) and search are bounded (limit 1..50, offset 0..500).
-- Returns one extra row so the client can set has_more.
-- No trigram extension. No new index — shops.id PK, shops_shop_number_unique_idx,
-- and shops_created_at_desc_idx (030) already cover the chosen predicates.

create or replace function public.internal_ops_search_shops (
  p_query text,
  p_limit int default 25,
  p_offset int default 0
)
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
  owner_full_name text,
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
set search_path = public, auth
as $$
declare
  v_limit int := least (greatest (coalesce (p_limit, 25), 1), 50);
  v_offset int := least (greatest (coalesce (p_offset, 0), 0), 500);
  v_fetch int := v_limit + 1;
  v_raw text := btrim (regexp_replace (coalesce (p_query, ''), '\s+', ' ', 'g'));
  v_q text := lower (v_raw);
  v_mode text;
  v_like text;
  v_email_like text;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  if v_raw = '' then
    v_mode := 'browse';
  elsif v_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_mode := 'uuid';
  elsif upper (v_raw) ~ '^A[0-9]+$' then
    v_mode := 'shop_number';
  elsif position ('@' in v_raw) > 0 then
    v_mode := 'email';
  elsif char_length (v_raw) >= 2 then
    v_mode := 'text';
  else
    return;
  end if;

  v_like :=
    '%'
    || replace (replace (replace (v_q, '\', '\\'), '%', '\%'), '_', '\_')
    || '%';
  v_email_like :=
    '%'
    || replace (replace (replace (v_q, '\', '\\'), '%', '\%'), '_', '\_')
    || '%';

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
      case
        when public.internal_can_view_owner_contact ()
          then nullif (trim (coalesce (pr.email, au.email)), '')
        else null
      end,
      'Shop owner'
    ) as owner_label,
    case
      when public.internal_can_view_owner_contact ()
        then nullif (trim (coalesce (pr.email, au.email)), '')
      else null
    end as owner_email,
    nullif (trim (pr.full_name), '') as owner_full_name,
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
  from (
    select hit.id
    from public.shops hit
    left join lateral (
      select sm.user_id
      from public.shop_members sm
      where sm.shop_id = hit.id
      order by (case when sm.role = 'owner' then 0 else 1 end), sm.created_at asc
      limit 1
    ) own on true
    left join public.profiles pr on pr.id = own.user_id
    left join auth.users au on au.id = own.user_id
    where
      case v_mode
        when 'browse' then true
        when 'uuid' then hit.id = v_raw::uuid
        when 'shop_number' then upper (trim (coalesce (hit.shop_number, ''))) = upper (v_raw)
        when 'email' then (
          lower (trim (coalesce (pr.email, ''))) like v_email_like escape '\'
          or lower (trim (coalesce (au.email, ''))) like v_email_like escape '\'
        )
        when 'text' then (
          hit.name ilike v_like escape '\'
          or coalesce (hit.shop_number, '') ilike v_like escape '\'
          or coalesce (pr.full_name, '') ilike v_like escape '\'
        )
        else false
      end
    group by hit.id
  ) found
  join public.shops s on s.id = found.id
  left join public.shop_activity sa on sa.shop_id = s.id
  left join lateral (
    select sm.user_id
    from public.shop_members sm
    where sm.shop_id = s.id
    order by (case when sm.role = 'owner' then 0 else 1 end), sm.created_at asc
    limit 1
  ) own on true
  left join public.profiles pr on pr.id = own.user_id
  left join auth.users au on au.id = own.user_id
  left join lateral (
    select s2.*
    from public.subscriptions s2
    where s2.organization_id = s.organization_id
    order by s2.created_at desc
    limit 1
  ) sub on true
  left join public.subscription_plans sp on sp.id = sub.plan_id
  order by s.created_at desc, s.id desc
  limit v_fetch
  offset v_offset;
end;
$$;

comment on function public.internal_ops_search_shops (text, int, int) is
  'Internal staff shop discovery: paginated browse or bounded search. Unauthorized callers fail.';

revoke all on function public.internal_ops_search_shops (text, int, int) from public;
revoke all on function public.internal_ops_search_shops (text, int, int) from anon;
grant execute on function public.internal_ops_search_shops (text, int, int) to authenticated;

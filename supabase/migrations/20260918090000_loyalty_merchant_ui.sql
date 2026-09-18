-- Waka POS — Loyalty merchant UI (Phase 04)
--
-- Merchant-facing read models + program configuration. All functions are
-- security definer and re-check authorization internally (same pattern as
-- loyalty_enroll_customer / loyalty_adjust_points from the data foundation):
--   * overview/search  -> public.user_can_access_shop (any shop member)
--   * program config   -> public.user_can_manage_shop  (owner/manager)
--
-- No new tables: the ledger (loyalty_transactions) stays the audit source;
-- these RPCs only aggregate or upsert configuration.

-- ---------- Shop overview (dashboard aggregates) ----------
create or replace function public.loyalty_shop_overview (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_result jsonb;
begin
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select jsonb_build_object(
    'ok', true,
    'program', (
      select jsonb_build_object(
        'enabled', p.enabled,
        'earn_unit_ugx', p.earn_unit_ugx,
        'earn_points_per_unit', p.earn_points_per_unit,
        'min_eligible_spend_ugx', p.min_eligible_spend_ugx,
        'rule_kind', p.rule_kind,
        'updated_at', p.updated_at
      )
      from public.loyalty_programs p
      where p.shop_id = p_shop_id
    ),
    'members_total', (
      select count(*) from public.loyalty_accounts a where a.shop_id = p_shop_id
    ),
    'members_active', (
      select count(*) from public.loyalty_accounts a
      where a.shop_id = p_shop_id and a.status = 'active'
    ),
    'points_issued', (
      select coalesce(sum(t.points), 0)
      from public.loyalty_transactions t
      where t.shop_id = p_shop_id and t.points > 0
    ),
    'points_redeemed', (
      select coalesce(-sum(t.points), 0)
      from public.loyalty_transactions t
      where t.shop_id = p_shop_id and t.kind in ('redeemed', 'expired')
    ),
    'points_reversed', (
      select coalesce(-sum(t.points), 0)
      from public.loyalty_transactions t
      where t.shop_id = p_shop_id and t.kind = 'reversed'
    ),
    'recent_activity', (
      select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb)
      from (
        select
          t.id, t.account_id, t.kind, t.points, t.balance_after, t.cause, t.note,
          t.created_at, c.name as customer_name
        from public.loyalty_transactions t
        join public.loyalty_accounts a on a.id = t.account_id
        join public.customers c on c.id = a.customer_id
        where t.shop_id = p_shop_id
        order by t.created_at desc
        limit 10
      ) x
    )
  )
  into v_result;

  return v_result;
end;
$function$;

-- ---------- Program configuration (manager-only upsert) ----------
create or replace function public.loyalty_update_program (
  p_shop_id uuid,
  p_enabled boolean,
  p_earn_unit_ugx bigint,
  p_earn_points_per_unit integer,
  p_min_eligible_spend_ugx bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_earn_unit_ugx is null or p_earn_unit_ugx <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_earn_unit');
  end if;
  if p_earn_points_per_unit is null or p_earn_points_per_unit <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_points_per_unit');
  end if;
  if p_min_eligible_spend_ugx is null or p_min_eligible_spend_ugx < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_min_spend');
  end if;

  insert into public.loyalty_programs (
    shop_id, enabled, earn_unit_ugx, earn_points_per_unit, min_eligible_spend_ugx
  )
  values (
    p_shop_id, coalesce(p_enabled, false), p_earn_unit_ugx,
    p_earn_points_per_unit, p_min_eligible_spend_ugx
  )
  on conflict (shop_id) do update
  set enabled = coalesce(p_enabled, false),
      earn_unit_ugx = p_earn_unit_ugx,
      earn_points_per_unit = p_earn_points_per_unit,
      min_eligible_spend_ugx = p_min_eligible_spend_ugx;

  return jsonb_build_object('ok', true);
end;
$function$;

-- ---------- Account search (membership directory) ----------
create or replace function public.loyalty_search_accounts (
  p_shop_id uuid,
  p_query text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'accounts', coalesce((
      select jsonb_agg(row_to_json(x) order by x.customer_name)
      from (
        select
          a.id,
          a.customer_id,
          a.status,
          a.balance_points,
          a.lifetime_earned_points,
          a.lifetime_redeemed_points,
          a.enrolled_at,
          c.name as customer_name,
          c.phone_e164 as customer_phone
        from public.loyalty_accounts a
        join public.customers c on c.id = a.customer_id
        where a.shop_id = p_shop_id
          and (
            p_query is null
            or btrim(p_query) = ''
            or c.name ilike '%' || btrim(p_query) || '%'
            or c.phone_e164 ilike '%' || btrim(p_query) || '%'
          )
        limit v_limit
      ) x
    ), '[]'::jsonb)
  );
end;
$function$;

grant execute on function public.loyalty_shop_overview (uuid) to authenticated;
grant execute on function public.loyalty_update_program (uuid, boolean, bigint, integer, bigint) to authenticated;
grant execute on function public.loyalty_search_accounts (uuid, text, integer) to authenticated;

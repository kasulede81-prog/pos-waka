-- ============================================================================
-- CUSTOMER LOYALTY PHASE C — ACTIVITY CENTER FILTERS (projection parameters)
-- ============================================================================
--
-- Adds the four filters the customer Activity Center needs (audit §9/§23):
-- date range (p_from/p_to), one of the caller's OWN merchants (p_shop_id) and an
-- activity kind (p_kind). Everything else — the authority model, the keyset
-- cursor, the columns exposed, the exclusions (staff notes, tokens) — is
-- byte-for-byte the Phase A behavior.
--
-- AUTHORITY IS UNCHANGED. auth.uid() -> loyalty_members -> OWN active links ->
-- transactions joined on BOTH account_id AND shop_id. The new parameters only
-- NARROW rows the caller could already read:
--   * p_from/p_to  bound created_at — a time window is not an identity;
--   * p_shop_id    intersects with the caller's OWN links join, so naming a shop
--                  the member has no link to returns ZERO rows (same shape as
--                  passing a nonsense uuid) — it is a filter, not an authority;
--   * p_kind       matches loyalty_transactions.kind, already public vocabulary.
--
-- SIGNATURE. Adding parameters to an existing name CREATES AN OVERLOAD rather
-- than replacing it, which would leave old callers silently bound to the
-- unfiltered function. The superseded 3-argument shape is therefore dropped in
-- the same migration (same transaction), and grants are asserted on the single
-- remaining signature. Callers that pass only (p_limit, p_before, p_before_id)
-- — positionally or by name — keep working: the new parameters all default.
--
-- projection_version bumps to 2 so clients can tell the shapes apart.
-- ============================================================================

create or replace function public.loyalty_member_activity (
  p_limit integer default 20,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_shop_id uuid default null,
  p_kind text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $fn$
declare
  v_uid uuid := auth.uid ();
  v_member public.loyalty_members%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_limit integer := greatest (1, least (coalesce(p_limit, 20), 100));
  v_has_more boolean := false;
  v_next_before timestamptz;
  v_next_before_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_member from public.loyalty_members m where m.auth_user_id = v_uid;
  if v_member.id is null or v_member.status = 'closed' then
    return jsonb_build_object ('ok', false, 'error', 'not_a_member');
  end if;

  select
    coalesce(jsonb_agg (entry order by created_at desc, row_id desc), '[]'::jsonb),
    count (*)
  into v_items, v_count
  from (
    select
      t.id as row_id,
      t.created_at,
      jsonb_build_object (
        'id', t.id,
        'kind', t.kind,
        'cause', t.cause,
        'points', t.points,
        'balance_after', t.balance_after,
        'created_at', t.created_at,
        'shop', jsonb_build_object ('id', lk.shop_id, 'name', lk.shop_name),
        -- The member's own purchase value, from the authoritative sale.
        'sale_total_ugx', s.total_ugx,
        -- Redemption detail, so the member sees WHAT they spent points on.
        'reward_name', r.name,
        'reward_points_required', r.points_required
      ) as entry
    from public.loyalty_transactions t
    join (
      select l.account_id, l.shop_id, sh.name as shop_name
      from public.loyalty_member_links l
      join public.shops sh on sh.id = l.shop_id
      where l.member_id = v_member.id
        and l.status = 'active'
    ) lk on lk.account_id = t.account_id and lk.shop_id = t.shop_id
    left join public.sales s on s.id = t.source_sale_id
    left join public.loyalty_redemptions rd on rd.ledger_transaction_id = t.id
    left join public.loyalty_rewards r on r.id = rd.reward_id
    where (
      p_before is null
      or (t.created_at, t.id) < (p_before, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))
    )
    -- Phase C filters (all optional; each narrows rows the caller already owns).
    and (p_from is null or t.created_at >= p_from)
    and (p_to is null or t.created_at < p_to)
    and (p_shop_id is null or t.shop_id = p_shop_id)
    and (p_kind is null or t.kind = p_kind)
    order by t.created_at desc, t.id desc
    limit v_limit + 1
  ) page;

  -- One extra row was fetched purely to answer "is there another page?".
  if v_count > v_limit then
    v_has_more := true;
    select coalesce(jsonb_agg (e order by i), '[]'::jsonb)
    into v_items
    from jsonb_array_elements (v_items) with ordinality as x (e, i)
    where i <= v_limit;
  end if;

  if jsonb_array_length (v_items) > 0 then
    v_next_before := (v_items -> -1 ->> 'created_at')::timestamptz;
    v_next_before_id := (v_items -> -1 ->> 'id')::uuid;
  end if;

  return jsonb_build_object (
    'ok', true,
    'member_id', v_member.id,
    'items', v_items,
    'has_more', v_has_more,
    'next_before', v_next_before,
    'next_before_id', v_next_before_id,
    'meta', jsonb_build_object ('generated_at', now (), 'projection_version', 2)
  );
end;
$fn$;

-- Superseded shape: same name with different identity arguments would otherwise
-- leave BOTH functions installed and bind existing callers to the unfiltered one.
drop function if exists public.loyalty_member_activity (integer, timestamptz, uuid);

-- Same posture as before: authenticated members only, never PUBLIC, never anon.
do $g$
begin
  execute 'revoke all on function public.loyalty_member_activity (integer, timestamptz, uuid, timestamptz, timestamptz, uuid, text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_member_activity (integer, timestamptz, uuid, timestamptz, timestamptz, uuid, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_member_activity (integer, timestamptz, uuid, timestamptz, timestamptz, uuid, text) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.loyalty_member_activity (integer, timestamptz, uuid, timestamptz, timestamptz, uuid, text) to service_role';
  end if;
end;
$g$;

comment on function public.loyalty_member_activity (integer, timestamptz, uuid, timestamptz, timestamptz, uuid, text) is
  'A member''s own loyalty activity, resolved from auth.uid() with no identity parameters. '
  'Optional filters (date window, own-shop, kind) only narrow rows already gated by the '
  'caller''s own active links. Joins the authoritative sales table for purchase values and '
  'redemptions/rewards for reward detail. Excludes staff notes and every token. '
  'Keyset-paginated on (created_at, id).';

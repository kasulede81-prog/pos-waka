-- ============================================================================
-- LOYALTY PHASE A — MEMBER ACTIVITY
-- ============================================================================
-- An authenticated member can finally see their own points activity.
--
-- WHY THIS IS A NEW RPC AND NOT AN RLS CHANGE. `loyalty_transactions` has exactly
-- one policy — `loyalty_transactions_select USING (user_can_access_shop(shop_id))`
-- — and `user_can_access_shop` resolves through `shop_members` and
-- organisation owner/admin. It answers "is this staff?", never "is this the
-- customer whose points these are". A loyalty member holds ordinary SELECT
-- privilege with no matching policy, which is why they currently read zero rows.
-- Relaxing that policy to admit members would give EVERY customer of a shop the
-- shop's ENTIRE ledger. So the read goes through a SECURITY DEFINER projection
-- with the same shape as `loyalty_member_dashboard()`: NO parameters that name a
-- person, and identity taken from `auth.uid()` alone.
--
-- AUTHORITY
--   auth.uid() -> loyalty_members.auth_user_id
--              -> loyalty_member_links (status='active')
--              -> loyalty_transactions for those accounts
--
-- The ledger rows are joined to the member's own active links on BOTH account_id
-- AND shop_id, so a row can only be read if it belongs to an account this member
-- is actually linked to. There is no parameter by which a caller could name
-- another member, account or shop — cross-member reads are structurally
-- impossible rather than merely checked.
--
-- WHAT A MEMBER SEES, and what they deliberately do not:
--   * their own ledger rows: signed points, kind, cause, balance_after, timestamp
--   * the merchant each row belongs to (name + id), so a multi-merchant member can
--     tell their balances apart — merchant identity is never collapsed
--   * for a purchase, the sale's total from the authoritative `sales` table,
--     joined INSIDE this definer function (the member has no other read path to
--     sales, and needs none)
--   * for a redemption, the reward's name and points cost
--   * NEVER `note` — that column carries staff free text written about the member,
--     which is internal commentary rather than member-facing history
--   * NEVER a public-card or QR token, and no `public_card_token`/`qr_token`
--     column is referenced anywhere below
--
-- PAGINATION is keyset, not OFFSET: `(created_at, id)` descending. The row `id` is
-- returned as the cursor because timestamps can tie, and OFFSET paging over a
-- ledger that keeps growing would duplicate and skip rows. A ledger row id
-- authorises nothing: no read path in this schema takes a transaction id.
--
-- Two bounded parameters, neither of which is an identity:
--   p_limit      1..100, default 20
--   p_before / p_before_id   the cursor from the previous page (exclusive)

create or replace function public.loyalty_member_activity (
  p_limit integer default 20,
  p_before timestamptz default null,
  p_before_id uuid default null
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
    'meta', jsonb_build_object ('generated_at', now (), 'projection_version', 1)
  );
end;
$fn$;

-- Same posture as loyalty_member_dashboard(): authenticated members only, never
-- PUBLIC, never anon. No client role may execute it without a session.
revoke all on function public.loyalty_member_activity (integer, timestamptz, uuid) from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_member_activity (integer, timestamptz, uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_member_activity (integer, timestamptz, uuid) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.loyalty_member_activity (integer, timestamptz, uuid) to service_role';
  end if;
end;
$g$;

comment on function public.loyalty_member_activity (integer, timestamptz, uuid) is
  'A member''s own loyalty activity, resolved from auth.uid() with no identity parameters. '
  'Joins the authoritative sales table for purchase values and redemptions/rewards for '
  'reward detail. Excludes staff notes and every token. Keyset-paginated on (created_at, id).';

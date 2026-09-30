-- ============================================================================
-- LOYALTY PHASE C — CUSTOMER 360 (merchant-side)
-- ============================================================================
-- A merchant can see one customer's relationship with THEIR shop: identity, loyalty
-- standing, what they have spent, and what they have redeemed.
--
-- NO SECOND FINANCIAL SOURCE OF TRUTH. Every figure is derived on read from the
-- authoritative tables — `sales`, `sale_returns`, `loyalty_accounts`,
-- `loyalty_transactions`, `loyalty_redemptions`. Nothing is cached, duplicated, or
-- written. There is no new ledger, no spend counter, and no revenue table.
--
-- SPENDING SEMANTICS (established by inspection, not assumed):
--   * A VOIDED sale is `sales.status = 'void'` and is excluded by status. Its
--     `sale_voids` row is therefore NOT subtracted again — doing so would double-count
--     a sale that has already left the population.
--   * A RETURNED sale KEEPS `status = 'completed'`. The refund lives beside it in
--     `sale_returns.refund_amount_ugx` — `shop_push_sale_return` never touches
--     `sales.status`, and nothing in this schema writes `status = 'refunded'` at all.
--     So a customer's spend must SUBTRACT returns, or a fully-returned sale would count
--     as permanent spend forever. This is the trap the phase brief warns about.
--   * Returns are only counted against sales that are STILL `completed` and belong to
--     this customer and shop, so a return stranded by a later void cannot drive net
--     spend negative.
--   * `shop_get_customer_insights` (061) is the existing precedent for "a purchase is a
--     completed sale"; its status filter is reused here. It is a windowed top-N
--     leaderboard for the reports UI, so it is not extended — this is a profile read.
--
-- LOYALTY comes from `loyalty_accounts` / `loyalty_transactions` — the existing cached
-- counters and the existing ledger. No balance is recomputed from rewards or sales.
--
-- REWARD ELIGIBILITY IS NOT DUPLICATED. The states are computed with the same canonical
-- helpers the redemption path and the member view use — `loyalty_account_reward_granted`
-- and `loyalty_reward_unexpired` — and the same redemption-limit predicate.
--
-- MERCHANT AUTHORIZATION, NOT MEMBER. These are shop-scoped functions: the caller must
-- satisfy `user_can_access_shop (p_shop_id)`, which is the SAME boundary the `customers`
-- SELECT policy already uses, so no privacy boundary is widened. `p_customer_id` is
-- accepted because this is merchant-side, and the server then requires the customer to
-- belong to that shop — a customer id from another shop resolves to `not_found` rather
-- than to somebody else's data.
--
-- A merchant sees ONLY their own shop's relationship. Every read is filtered by
-- `p_shop_id`: the loyalty account is `(shop_id, customer_id)`, sales and returns are
-- shop-scoped, and redemptions are filtered by both shop and account. A customer who
-- also shops elsewhere contributes nothing of the other shop's to this payload.
--
-- NOT EXPOSED: `qr_token`, `public_card_token`, `auth_user_id`, notes written about the
-- customer, debt balances, or any authentication internal.

-- ---------------------------------------------------------------------------
-- The one index this read model needs.
-- ---------------------------------------------------------------------------
-- No existing index leads with `sales.customer_id` — `sales_shop_created_idx` and
-- `sales_status_idx` both lead with `shop_id`, so a per-customer aggregation would walk
-- every sale the shop has ever made. Partial, because only attributed sales matter here
-- and most sales in a kiosk flow carry no customer.
create index if not exists sales_shop_customer_status_idx
  on public.sales (shop_id, customer_id, status)
  where customer_id is not null;

-- ============================================================================
-- 1. SEARCH — find the customer to open
-- ============================================================================
-- Searches the shop's OWN customers, not a loyalty-only subset: a customer with
-- purchases and no loyalty account is still a customer the merchant must be able to
-- look up (and the profile handles that case).
create or replace function public.shop_customer_search (
  p_shop_id uuid,
  p_query text default null,
  p_limit integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $fn$
declare
  v_query text := nullif (btrim (coalesce(p_query, '')), '');
  v_limit integer := greatest (1, least (coalesce(p_limit, 25), 100));
  v_rows jsonb;
begin
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select coalesce(jsonb_agg (entry order by name, customer_id), '[]'::jsonb)
  into v_rows
  from (
    select
      c.name,
      c.id as customer_id,
      jsonb_build_object (
        'id', c.id,
        'name', c.name,
        'phone_e164', c.phone_e164,
        'has_loyalty_account', (a.id is not null),
        'balance_points', a.balance_points,
        'account_status', a.status
      ) as entry
    from public.customers c
    left join public.loyalty_accounts a
      on a.customer_id = c.id and a.shop_id = c.shop_id
    where c.shop_id = p_shop_id
      and (
        v_query is null
        or c.name ilike '%' || v_query || '%'
        or (c.phone_e164 is not null and c.phone_e164 ilike '%' || v_query || '%')
      )
    order by c.name
    limit v_limit
  ) t;

  return jsonb_build_object ('ok', true, 'customers', v_rows);
end;
$fn$;

revoke all on function public.shop_customer_search (uuid, text, integer) from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.shop_customer_search (uuid, text, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.shop_customer_search (uuid, text, integer) to authenticated';
  end if;
end;
$g$;

-- ============================================================================
-- 2. PROFILE — the Customer 360 read
-- ============================================================================
create or replace function public.shop_customer_360 (
  p_shop_id uuid,
  p_customer_id uuid,
  p_activity_limit integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $fn$
declare
  v_customer public.customers%rowtype;
  v_account public.loyalty_accounts%rowtype;
  v_limit integer := greatest (1, least (coalesce(p_activity_limit, 10), 50));
  v_gross bigint := 0;
  v_returned bigint := 0;
  v_completed integer := 0;
  v_voided integer := 0;
  v_first timestamptz;
  v_last timestamptz;
  v_rewards jsonb := '[]'::jsonb;
  v_rewards_truncated boolean := false;
  v_purchases jsonb := '[]'::jsonb;
  v_activity jsonb := '[]'::jsonb;
  v_redemptions jsonb := '[]'::jsonb;
  v_redemption_count integer := 0;
  v_points_redeemed bigint := 0;
  v_link_status text;
begin
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  -- The customer must belong to THIS shop. A customer id from another shop is not
  -- found here, which is what stops the id being used as a cross-tenant probe.
  select * into v_customer
  from public.customers c
  where c.id = p_customer_id and c.shop_id = p_shop_id;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  -- ---------------------------------------------------------------- spending
  select
    coalesce(sum (s.total_ugx), 0)::bigint,
    count (*)::int,
    min (coalesce (s.completed_at, s.created_at)),
    max (coalesce (s.completed_at, s.created_at))
  into v_gross, v_completed, v_first, v_last
  from public.sales s
  where s.shop_id = p_shop_id
    and s.customer_id = p_customer_id
    and s.status = 'completed';

  -- Refunds recorded against sales that are STILL completed. A voided sale is already
  -- absent from both sides of the arithmetic above and below.
  select coalesce(sum (r.refund_amount_ugx), 0)::bigint
  into v_returned
  from public.sale_returns r
  join public.sales s on s.id = r.sale_id
  where r.shop_id = p_shop_id
    and s.shop_id = p_shop_id
    and s.customer_id = p_customer_id
    and s.status = 'completed';

  -- Reported for transparency: sales this customer made that no longer count, because
  -- `void` removed them from the population rather than reducing a total.
  select count (*)::int into v_voided
  from public.sales s
  where s.shop_id = p_shop_id
    and s.customer_id = p_customer_id
    and s.status = 'void';

  -- ---------------------------------------------------------------- loyalty
  select * into v_account
  from public.loyalty_accounts a
  where a.shop_id = p_shop_id and a.customer_id = p_customer_id;

  if v_account.id is not null then
    select l.status into v_link_status
    from public.loyalty_member_links l
    where l.account_id = v_account.id and l.shop_id = p_shop_id
    limit 1;

    select coalesce(jsonb_agg (entry order by created_at desc), '[]'::jsonb)
    into v_activity
    from (
      select
        t.created_at,
        jsonb_build_object (
          'kind', t.kind,
          'cause', t.cause,
          'points', t.points,
          'balance_after', t.balance_after,
          'created_at', t.created_at
        ) as entry
      from public.loyalty_transactions t
      where t.shop_id = p_shop_id and t.account_id = v_account.id
      order by t.created_at desc
      limit v_limit
    ) a2;

    select
      count (*)::int,
      coalesce(sum (rd.points_spent), 0)::bigint
    into v_redemption_count, v_points_redeemed
    from public.loyalty_redemptions rd
    where rd.shop_id = p_shop_id
      and rd.account_id = v_account.id
      and rd.status = 'completed';

    select coalesce(jsonb_agg (entry order by created_at desc), '[]'::jsonb)
    into v_redemptions
    from (
      select
        rd.created_at,
        jsonb_build_object (
          -- Phase H — the redemption's own id, so the merchant UI can offer Phase D's
          -- reversal on it. This is this shop's own row, reached only through
          -- `user_can_access_shop`, and it authorises nothing on its own: the reversal RPC
          -- re-checks the shop, the status and the lock before it moves a single point.
          'id', rd.id,
          'reward_name', r.name,
          'points_spent', rd.points_spent,
          'status', rd.status,
          'redeemed_at', rd.created_at,
          -- Phase E — the benefit THIS redemption was worth, from the redemption's own
          -- SNAPSHOT (never from loyalty_rewards, so re-pricing a reward cannot rewrite
          -- this history), and whether a sale actually received it.
          'benefit_kind', rd.benefit_kind,
          'benefit_amount_ugx', rd.benefit_amount_ugx,
          'benefit_percent', rd.benefit_percent,
          'applied_amount_ugx', rd.applied_amount_ugx,
          'applied_sale_id', rd.sale_id,
          'applied_at', rd.applied_at
        ) as entry
      from public.loyalty_redemptions rd
      join public.loyalty_rewards r on r.id = rd.reward_id
      where rd.shop_id = p_shop_id and rd.account_id = v_account.id
      order by rd.created_at desc
      limit v_limit
    ) r2;

    -- Rewards this customer may have, computed with the SAME canonical helpers the
    -- redemption path uses. Visible when the shop still offers it, or it was granted to
    -- this account, or the customer already redeemed it.
    select coalesce(jsonb_agg (entry order by name), '[]'::jsonb), count (*) > 50
    into v_rewards, v_rewards_truncated
    from (
      select
        r.name,
        jsonb_build_object (
          'id', r.id,
          'name', r.name,
          'points_required', r.points_required,
          'reward_kind', r.reward_kind,
          'personal', r.requires_offer_grant,
          'active', r.active,
          'expires_on', r.expires_on,
          'times_redeemed', g.times_redeemed,
          'max_redemptions_per_account', r.max_redemptions_per_account,
          'redemptions_remaining', case
            when r.max_redemptions_per_account is null then null
            else greatest (r.max_redemptions_per_account - g.times_redeemed, 0)
          end,
          'state', case
            when not r.active then 'inactive'
            when not g.unexpired then 'expired'
            when r.max_redemptions_per_account is not null
                 and g.times_redeemed >= r.max_redemptions_per_account then 'limit_reached'
            when v_account.balance_points < r.points_required then 'insufficient_points'
            else 'available'
          end
        ) as entry
      from public.loyalty_rewards r
      cross join lateral (
        select
          public.loyalty_account_reward_granted (v_account.id, r.id, now ()) as granted,
          public.loyalty_reward_unexpired (r.expires_on, now ()) as unexpired,
          (
            select count (*) from public.loyalty_redemptions rd
            where rd.account_id = v_account.id
              and rd.reward_id = r.id
              and rd.status = 'completed'
          ) as times_redeemed
      ) g
      where r.shop_id = p_shop_id
        and (
          (r.active and not r.requires_offer_grant)
          or (r.requires_offer_grant and g.granted)
          or g.times_redeemed > 0
        )
      order by r.name
      limit 51
    ) rw;
  end if;

  -- ---------------------------------------------------------------- purchases
  select coalesce(jsonb_agg (entry order by created_at desc), '[]'::jsonb)
  into v_purchases
  from (
    select
      coalesce (s.completed_at, s.created_at) as created_at,
      jsonb_build_object (
        'total_ugx', s.total_ugx,
        'completed_at', coalesce (s.completed_at, s.created_at),
        'payment_status', s.payment_status,
        -- What came back from THIS sale, so a merchant is not shown a figure they
        -- cannot reconcile against the refunds they issued.
        'returned_ugx', coalesce ((
          select sum (r.refund_amount_ugx) from public.sale_returns r
          where r.sale_id = s.id and r.shop_id = p_shop_id
        ), 0)
      ) as entry
    from public.sales s
    where s.shop_id = p_shop_id
      and s.customer_id = p_customer_id
      and s.status = 'completed'
    order by coalesce (s.completed_at, s.created_at) desc
    limit v_limit
  ) p2;

  return jsonb_build_object (
    'ok', true,
    'customer', jsonb_build_object (
      'id', v_customer.id,
      'name', v_customer.name,
      'phone_e164', v_customer.phone_e164,
      'email', v_customer.email,
      'customer_since', v_customer.created_at
    ),
    'loyalty', case when v_account.id is null then null else jsonb_build_object (
      'has_account', true,
      'account_status', v_account.status,
      'member_since', v_account.enrolled_at,
      'membership_expires_at', v_account.membership_expires_at,
      'membership_active', public.loyalty_account_membership_active (
        v_account.status, v_account.membership_expires_at, now ()
      ),
      'balance_points', v_account.balance_points,
      'lifetime_earned_points', v_account.lifetime_earned_points,
      'lifetime_redeemed_points', v_account.lifetime_redeemed_points,
      -- This shop's own relationship, not a global identity: the merchant learns
      -- whether THEIR link is active, and nothing about other merchants.
      'member_link_status', v_link_status
    ) end,
    'spending', jsonb_build_object (
      'completed_purchases', v_completed,
      'gross_spend_ugx', v_gross,
      'returned_ugx', v_returned,
      'net_spend_ugx', greatest (v_gross - v_returned, 0),
      -- DERIVED STATISTIC, not an authoritative figure: net spend spread over completed
      -- purchases, rounded down. Labelled as such wherever it is displayed.
      'average_purchase_ugx', case
        when v_completed > 0 then greatest (v_gross - v_returned, 0) / v_completed
        else null
      end,
      'voided_purchases', v_voided,
      'first_purchase_at', v_first,
      'last_purchase_at', v_last
    ),
    'rewards', jsonb_build_object (
      'visible_count', jsonb_array_length (v_rewards),
      'truncated', v_rewards_truncated,
      'items', v_rewards,
      'redemption_count', v_redemption_count,
      'points_redeemed', v_points_redeemed
    ),
    'recent_purchases', v_purchases,
    'recent_loyalty_activity', v_activity,
    'recent_redemptions', v_redemptions,
    'meta', jsonb_build_object ('generated_at', now (), 'activity_limit', v_limit)
  );
end;
$fn$;

revoke all on function public.shop_customer_360 (uuid, uuid, integer) from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.shop_customer_360 (uuid, uuid, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.shop_customer_360 (uuid, uuid, integer) to authenticated';
  end if;
end;
$g$;

comment on function public.shop_customer_360 (uuid, uuid, integer) is
  'Merchant-side Customer 360 for one customer of one shop. Every figure is derived on '
  'read from sales/sale_returns/loyalty_* — no cached spend counter and no second ledger. '
  'Net spend subtracts refunds, because a returned sale keeps status=completed. '
  'Authorized by user_can_access_shop, and the customer must belong to that shop.';

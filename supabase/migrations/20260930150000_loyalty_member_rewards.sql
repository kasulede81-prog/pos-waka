-- ============================================================================
-- LOYALTY PHASE B — MEMBER REWARDS (read model)
-- ============================================================================
-- An authenticated member can finally see the rewards available to them, across every
-- merchant they are linked to.
--
-- WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT.
--
-- This is a READ. It does not add a claim flow, because the schema has no claim
-- concept for rewards: `loyalty_member_claim_start/review` are the ACCOUNT claim queue
-- (linking an existing shop customer to a WAKA member), not rewards, and redemption is
-- merchant-driven — `loyalty_redeem_reward` is gated by `user_can_redeem_loyalty`,
-- which admits shop owner/manager/cashier and org owner/admin, and no member.
--
-- So there is no server-side path by which a customer redeems their own points, and
-- inventing one here would be inventing a way for a browser to spend points. Instead
-- this RPC reports the AUTHORITATIVE state, including whether a reward is redeemable
-- right now, and the member is told to ask the shop — which is what actually happens at
-- the counter. A later phase may add a member-initiated redemption; it must be a
-- deliberate server-side operation with its own design, not a client decrement.
--
-- ELIGIBILITY IS NOT REIMPLEMENTED. The canonical helpers are called, not copied:
--   * `loyalty_account_reward_granted (account, reward, now)` — D026 offer OR D029
--     assignment. This is the same test `loyalty_redeem_reward` applies, so the read
--     and the redemption can never disagree about who may have what.
--   * `loyalty_reward_unexpired (expires_on, now)` — the C2 Kampala-day expiry rule.
--   * `loyalty_assignment_active (status, expires_at, now)` — assignment liveness.
-- The redemption limit is the same predicate the redeem RPC enforces: completed
-- redemptions for this account and reward against `max_redemptions_per_account`.
--
-- IDENTITY IS THE SESSION. No parameter names a member, account, shop or customer, so
-- another person's rewards cannot be requested — the only inputs are a page bound.
-- `loyalty_member_links` decides which accounts the caller may see, exactly as
-- `loyalty_member_dashboard()` does, and a revoked link removes that merchant
-- immediately.
--
-- BALANCE IS THE EXISTING ONE. `loyalty_accounts.balance_points` is read, never
-- recomputed from rewards, and nothing here writes to any ledger.
--
-- NO MONETARY VALUE. `loyalty_rewards` has no money or percentage column, so none is
-- reported. `reward_kind` is exposed as it is stored ('product' | 'voucher' | 'custom')
-- and no cashback figure is invented — that belongs to the later monetary phase.
--
-- NO BEARER TOKEN. `public_card_token` and `qr_token` are not referenced anywhere
-- below. The public-card Edge Function is not involved: its authority is a token this
-- projection deliberately never has.

create or replace function public.loyalty_member_rewards (p_limit integer default 100)
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
  v_limit integer := greatest (1, least (coalesce(p_limit, 100), 200));
  v_truncated boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_member from public.loyalty_members m where m.auth_user_id = v_uid;
  if v_member.id is null or v_member.status = 'closed' then
    return jsonb_build_object ('ok', false, 'error', 'not_a_member');
  end if;

  select coalesce(jsonb_agg (entry order by shop_name, sort_order, reward_name), '[]'::jsonb), count (*)
  into v_items, v_count
  from (
    select
      lk.shop_name,
      r.sort_order,
      r.name as reward_name,
      jsonb_build_object (
        'id', r.id,
        'shop', jsonb_build_object ('id', r.shop_id, 'name', lk.shop_name),
        'name', r.name,
        'description', r.description,
        'reward_kind', r.reward_kind,
        'points_required', r.points_required,
        -- Phase E — what the reward is worth. These columns arrive in
        -- 20260930230000_loyalty_reward_benefits.sql; a plpgsql body resolves them at
        -- execution, and every caller runs after all migrations have been applied.
        -- A member is told the benefit so "500 points" reads as what it actually buys.
        'benefit_kind', r.benefit_kind,
        'benefit_amount_ugx', r.benefit_amount_ugx,
        'benefit_percent', r.benefit_percent,
        -- The member's authoritative balance at THIS merchant, from the existing
        -- cached counter — never derived from the reward list.
        'balance_points', lk.balance_points,
        'points_needed', greatest (r.points_required - lk.balance_points, 0),
        'personal', r.requires_offer_grant,
        'granted_until', granted_until,
        'expires_on', r.expires_on,
        'active', r.active,
        'max_redemptions_per_account', r.max_redemptions_per_account,
        'times_redeemed', times_redeemed,
        'redemptions_remaining', case
          when r.max_redemptions_per_account is null then null
          else greatest (r.max_redemptions_per_account - times_redeemed, 0)
        end,
        -- THE SERVER DECIDES. The client renders this; it never computes it.
        'state', case
          when not r.active then 'inactive'
          when not unexpired then 'expired'
          when r.max_redemptions_per_account is not null
               and times_redeemed >= r.max_redemptions_per_account then 'limit_reached'
          when lk.balance_points < r.points_required then 'insufficient_points'
          else 'available'
        end
      ) as entry
    from public.loyalty_rewards r
    join (
      select l.account_id, l.shop_id, sh.name as shop_name, a.balance_points
      from public.loyalty_member_links l
      join public.shops sh on sh.id = l.shop_id
      join public.loyalty_accounts a on a.id = l.account_id and a.shop_id = l.shop_id
      where l.member_id = v_member.id
        and l.status = 'active'
    ) lk on lk.shop_id = r.shop_id
    cross join lateral (
      select
        public.loyalty_account_reward_granted (lk.account_id, r.id, now ()) as granted,
        public.loyalty_reward_unexpired (r.expires_on, now ()) as unexpired,
        (
          select count (*) from public.loyalty_redemptions rd
          where rd.account_id = lk.account_id
            and rd.reward_id = r.id
            and rd.status = 'completed'
        ) as times_redeemed,
        (
          select a2.expires_at
          from public.loyalty_reward_assignments a2
          where a2.account_id = lk.account_id
            and a2.reward_id = r.id
            and public.loyalty_assignment_active (a2.status, a2.expires_at, now ())
          order by a2.expires_at nulls last
          limit 1
        ) as granted_until
    ) g
    where
      -- Shop-wide catalogue: advertised while the merchant still offers it. EXPIRY does
      -- not hide it — a reward that lapsed is reported with state 'expired', which is
      -- information the member is entitled to (and which they cannot act on). Only
      -- `active = false` removes it, because that is the merchant withdrawing it.
      (r.active and not r.requires_offer_grant)
      -- A personal reward is visible ONLY to the member it was granted to. Without this
      -- clause one member's assignment would show up in every other member's list.
      or (r.requires_offer_grant and g.granted)
      -- Any reward this member has actually redeemed stays visible as their own history,
      -- even after the merchant retires it.
      or g.times_redeemed > 0
    order by lk.shop_name, r.sort_order, r.name
    limit v_limit + 1
  ) page;

  -- The extra row exists only to answer "was the list cut short?" — which is NOT the
  -- same question as "are there exactly v_limit rows", so the answer is this flag.
  if v_count > v_limit then
    v_truncated := true;
    v_count := v_limit;
    v_items := (
      select coalesce(jsonb_agg (e order by i), '[]'::jsonb)
      from jsonb_array_elements (v_items) with ordinality as x (e, i)
      where i <= v_limit
    );
  end if;

  return jsonb_build_object (
    'ok', true,
    'member_id', v_member.id,
    'rewards', v_items,
    'truncated', v_truncated,
    'meta', jsonb_build_object ('generated_at', now (), 'projection_version', 1)
  );
end;
$fn$;

-- Deliberate grants: members only. anon/PUBLIC hold nothing.
revoke all on function public.loyalty_member_rewards (integer) from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_member_rewards (integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_member_rewards (integer) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.loyalty_member_rewards (integer) to service_role';
  end if;
end;
$g$;

comment on function public.loyalty_member_rewards (integer) is
  'Rewards visible to the calling member, resolved from auth.uid() with no identity '
  'parameters. Eligibility reuses loyalty_account_reward_granted/loyalty_reward_unexpired '
  'rather than restating the rules; the server computes each reward''s state and the '
  'client only renders it. Read-only: member redemption is merchant-driven today, so no '
  'claim path is offered here.';

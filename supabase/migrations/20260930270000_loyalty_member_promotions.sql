-- ============================================================================
-- LOYALTY PHASE G — CUSTOMER VISIBILITY OF PROMOTIONS
-- ============================================================================
-- A member can now see the promotions running for them: what it is, what they get, when it
-- ends, and whether they have already received it.
--
-- THIS ADDS NO PROMOTION MECHANISM. The promotion system is D026
-- (`loyalty_customer_offers`) and it already provides earn multipliers, flat bonus points,
-- reward grants, badges, campaign bundles, start/end windows, priority, active/paused/revoked
-- state, per-account targeting and an auditable snapshot on every ledger row it touches.
-- Phase G's job for the customer half is to EXPOSE that — not to restate its rules.
--
-- THE RULES ARE NOT COPIED HERE. Whether an offer applies is decided by the same functions
-- the earn engine uses: `loyalty_resolve_customer_offers` (status + window) and
-- `loyalty_offer_window_open`. If this projection ever disagreed with the engine, the member
-- would be told about a promotion they cannot actually receive.
--
-- WHY IT IS NOT THE MERCHANT VIEW. It exposes only what a customer needs — the shop, the
-- promotion's own title, what it gives them, when it ends and whether it has already paid
-- out. No offer config, no priority, no target lists, no eligibility internals, no tokens,
-- and nothing a member could use to mutate anything: the function is `stable`.
--
-- "ALREADY RECEIVED" COMES FROM THE LEDGER, not a counter: a promotional award is a
-- `kind='promotional'` row whose `rule_snapshot` names the offer that produced it. That is
-- the same record the merchant's own history shows, so the customer and the shop are reading
-- one source of truth.

create or replace function public.loyalty_member_promotions ()
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
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_member from public.loyalty_members m where m.auth_user_id = v_uid;
  if v_member.id is null or v_member.status = 'closed' then
    return jsonb_build_object ('ok', false, 'error', 'not_a_member');
  end if;

  select coalesce(jsonb_agg (entry order by shop_name, title), '[]'::jsonb)
  into v_items
  from (
    select
      lk.shop_name,
      o.title,
      jsonb_build_object (
        'shop', jsonb_build_object ('id', lk.shop_id, 'name', lk.shop_name),
        'title', o.title,
        'kind', o.offer_kind,
        -- The benefit, described from the offer's own config — the same numbers the engine
        -- pays out. Nothing is inferred and nothing is computed here.
        'bonus_points', case
          when o.offer_kind = 'earn_bonus_flat' then (o.config ->> 'points')::integer
          else null
        end,
        'multiplier', case
          when o.offer_kind = 'earn_multiplier' then (o.config ->> 'multiplier')::numeric
          else null
        end,
        'granted_reward_count', case
          when o.offer_kind = 'reward_grant'
            then jsonb_array_length (coalesce(o.config -> 'reward_ids', '[]'::jsonb))
          else null
        end,
        'ends_at', o.ends_at,
        -- Whether the offer can still be used is the SAME window test the engine applies,
        -- so "still running" here cannot disagree with "still paying out" there.
        'active_now', true,
        -- Paid already? Answered from the ledger, per offer, for THIS account.
        'rewarded', exists (
          select 1
          from public.loyalty_transactions t
          where t.account_id = lk.account_id
            and t.cause = 'promotion'
            and t.rule_snapshot ->> 'offer_id' = o.id::text
        )
      ) as entry
    from public.loyalty_customer_offers o
    join (
      select l.account_id, l.shop_id, sh.name as shop_name
      from public.loyalty_member_links l
      join public.shops sh on sh.id = l.shop_id
      where l.member_id = v_member.id
        and l.status = 'active'
    ) lk on lk.account_id = o.account_id and lk.shop_id = o.shop_id
    -- THE ENGINE'S OWN TEST, not a restatement of it: `loyalty_offer_window_active` checks
    -- the status AND the start/end window in one place, so a promotion shown here is exactly
    -- one the earn engine would pay out on.
    where public.loyalty_offer_window_active (o.status, o.starts_at, o.ends_at, now ())

    union all

    -- Phase G — spend-threshold promotions, with the member's own progress. The spend figure
    -- is informational: the SERVER decides when the threshold is crossed, at the till, from
    -- the same authoritative sales. This only tells the customer how far along they are.
    select
      lk.shop_name,
      p.title,
      jsonb_build_object (
        'shop', jsonb_build_object ('id', lk.shop_id, 'name', lk.shop_name),
        'title', p.title,
        'kind', 'spend_bonus',
        'bonus_points', p.bonus_points,
        'multiplier', null,
        'granted_reward_count', null,
        'ends_at', p.ends_at,
        'active_now', true,
        'threshold_ugx', p.threshold_ugx,
        'qualifying_spend_ugx', (
          select greatest (
            coalesce((
              select sum (s.total_ugx) from public.sales s
              where s.shop_id = lk.shop_id and s.customer_id = lk.customer_id and s.status = 'completed'
                and (p.starts_at is null or coalesce (s.completed_at, s.created_at) >= p.starts_at)
                and (p.ends_at is null or coalesce (s.completed_at, s.created_at) < p.ends_at)
            ), 0)
            - coalesce((
              select sum (r.refund_amount_ugx) from public.sale_returns r
              join public.sales rs on rs.id = r.sale_id
              where rs.shop_id = lk.shop_id and rs.customer_id = lk.customer_id and rs.status = 'completed'
                and (p.starts_at is null or coalesce (rs.completed_at, rs.created_at) >= p.starts_at)
                and (p.ends_at is null or coalesce (rs.completed_at, rs.created_at) < p.ends_at)
            ), 0), 0)
        ),
        'remaining_ugx', greatest (
          p.threshold_ugx - (
            select greatest (
              coalesce((
                select sum (s.total_ugx) from public.sales s
                where s.shop_id = lk.shop_id and s.customer_id = lk.customer_id and s.status = 'completed'
                  and (p.starts_at is null or coalesce (s.completed_at, s.created_at) >= p.starts_at)
                  and (p.ends_at is null or coalesce (s.completed_at, s.created_at) < p.ends_at)
              ), 0)
              - coalesce((
                select sum (r.refund_amount_ugx) from public.sale_returns r
                join public.sales rs on rs.id = r.sale_id
                where rs.shop_id = lk.shop_id and rs.customer_id = lk.customer_id and rs.status = 'completed'
                  and (p.starts_at is null or coalesce (rs.completed_at, rs.created_at) >= p.starts_at)
                  and (p.ends_at is null or coalesce (rs.completed_at, rs.created_at) < p.ends_at)
              ), 0), 0)
          ),
          0
        ),
        'rewarded', exists (
          select 1 from public.loyalty_transactions t
          where t.account_id = lk.account_id
            and t.cause = 'promotion'
            and t.rule_snapshot ->> 'promotion_id' = p.id::text
        )
      ) as entry
    from public.loyalty_spend_promotions p
    join (
      select l.account_id, l.shop_id, sh.name as shop_name, a.customer_id
      from public.loyalty_member_links l
      join public.shops sh on sh.id = l.shop_id
      join public.loyalty_accounts a on a.id = l.account_id and a.shop_id = l.shop_id
      where l.member_id = v_member.id
        and l.status = 'active'
    ) lk on lk.shop_id = p.shop_id
      and (p.account_id is null or p.account_id = lk.account_id)
    where public.loyalty_offer_window_active (p.status, p.starts_at, p.ends_at, now ())
  ) page;

  return jsonb_build_object (
    'ok', true,
    'promotions', v_items,
    'meta', jsonb_build_object ('generated_at', now (), 'projection_version', 1)
  );
end;
$fn$;

-- Members only, exactly like the other member projections.
revoke all on function public.loyalty_member_promotions () from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_member_promotions () from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_member_promotions () to authenticated';
  end if;
end;
$g$;

comment on function public.loyalty_member_promotions () is
  'Promotions currently running for the calling member, resolved from auth.uid() with no '
  'identity parameters. Visibility reuses the engine''s own window test; "rewarded" is read '
  'from the ledger. Read-only, and exposes no merchant controls or internal identifiers.';

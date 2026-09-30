-- ============================================================================
-- LOYALTY PHASE D — REDEMPTION REVERSAL
-- ============================================================================
-- A redemption can be undone: the customer's points come back, and the ledger records
-- why. Until now `loyalty_redemptions.status` allowed 'void' and NOTHING could ever write
-- it — a mistaken redemption was permanent.
--
-- THE LEDGER STAYS APPEND-ONLY. Nothing is updated and nothing is deleted:
--   * the original `redeemed` ledger row keeps its points and stays visible;
--   * the redemption row keeps its `points_spent`, so the historical cost survives;
--   * the reversal is a NEW row, linked to the original through the EXISTING
--     `reversal_of_id` column (no new linkage field is invented).
--
-- THE AMOUNT IS HISTORICAL. The reversal credits `loyalty_redemptions.points_spent` — the
-- figure snapshotted when the redemption happened. It never reads
-- `loyalty_rewards.points_required`, the earn rule, the account balance, eligibility or
-- the redemption limit, so a merchant who re-prices a reward afterwards cannot change what
-- a past reversal is worth. (The old price is recorded in `rule_snapshot` beside the new
-- one, so the difference is visible rather than silent.)
--
-- WHY THE BALANCE TRIGGER CHANGES. `trg_loyalty_tx_balance` derives the counters from the
-- SIGN of a ledger row: any positive row increments `lifetime_earned_points`. A reversal
-- is positive — it returns points — but those points were never earned, and the brief
-- requires lifetime earned not to be inflated by a reversal. The documented invariant
-- (`balance = lifetime_earned - lifetime_redeemed`) leaves exactly one other place for
-- them: the redemption is un-counted, so `lifetime_redeemed_points` DECREASES by the
-- restored amount. The trigger is extended for this one cause and is otherwise
-- unchanged; `loyalty_assert_balance_invariant` is extended identically, so the invariant
-- checker still tells the truth after a reversal.
--
-- WHY NOTHING ELSE NEEDS TO MOVE. `loyalty_allocate_fifo` treats `kind = 'adjusted' AND
-- points > 0` as a consumable credit lot, so the reversal row IS a lot: the restored
-- points are immediately spendable and the next redemption allocates from them normally.
-- That is why the allocation table is untouched — and why a reversal cannot leave a
-- customer holding points they are unable to spend (`loyalty_redeem_reward` allocates
-- strictly, so an un-lotted balance would raise `loyalty_fifo_shortfall`).
--
-- NOT A SALE EVENT. `cause = 'redemption_reversal'` is deliberately distinct from
-- 'return' and 'void', which belong to SALES. No sales logic, `sale_returns`, `sale_voids`
-- or award/reversal path for sales is touched, and no reversal is triggered automatically
-- from a sale return — that linkage is not defined by the current architecture.

-- ---------------------------------------------------------------------------
-- 1. A distinct cause, so the audit trail can tell this apart from a manual adjustment
-- ---------------------------------------------------------------------------
-- The existing `cause` CHECK is an inline column constraint, so its generated name is
-- discovered rather than assumed.
do $c$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'loyalty_transactions'
      and con.contype = 'c'
      and pg_get_constraintdef (con.oid) ilike '%cause%'
  loop
    execute format ('alter table public.loyalty_transactions drop constraint %I', v_name);
  end loop;
end;
$c$;

alter table public.loyalty_transactions
  add constraint loyalty_transactions_cause_check check (
    cause in (
      'sale', 'return', 'void', 'redemption', 'expiration',
      'manual_adjustment', 'promotion', 'enrollment',
      'redemption_reversal'
    )
  );

-- A reversal only ever credits. Encoding it means the counter arithmetic below cannot be
-- reached with a negative amount, whatever a future caller does.
alter table public.loyalty_transactions
  add constraint loyalty_transactions_reversal_positive_check check (
    cause <> 'redemption_reversal' or points > 0
  );

-- ---------------------------------------------------------------------------
-- 2. One reversal per redemption, enforced by the database
-- ---------------------------------------------------------------------------
-- The status check in the RPC is not the guarantee — this is. Two concurrent callers can
-- both read `status = 'completed'`; only one can insert against this index, and the loser
-- gets `already_reversed` instead of a second credit.
create unique index if not exists loyalty_tx_redemption_reversal_once
  on public.loyalty_transactions (reversal_of_id)
  where cause = 'redemption_reversal';

-- ---------------------------------------------------------------------------
-- 3. The counters, for this cause only
-- ---------------------------------------------------------------------------
create or replace function public.trg_loyalty_tx_balance ()
returns trigger
language plpgsql
as $function$
declare
  v_balance integer;
  -- A redemption reversal returns points that were spent, not points that were earned.
  v_reversal boolean := (new.cause = 'redemption_reversal');
begin
  update public.loyalty_accounts
  set balance_points = balance_points + new.points,
      lifetime_earned_points = lifetime_earned_points
        + case when v_reversal then 0 else greatest (new.points, 0) end,
      lifetime_redeemed_points = lifetime_redeemed_points
        + case when v_reversal then -new.points else greatest (-new.points, 0) end
  where id = new.account_id
  returning balance_points into v_balance;

  if v_balance is null then
    raise exception 'loyalty account % does not exist', new.account_id;
  end if;

  new.balance_after := v_balance;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. The invariant checker, taught the same arithmetic
-- ---------------------------------------------------------------------------
-- Without this the checker would report drift on every account that had ever reversed a
-- redemption — a false alarm that would eventually be ignored, which is worse than none.
create or replace function public.loyalty_assert_balance_invariant (p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $function$
declare
  v_account public.loyalty_accounts%rowtype;
  v_sum bigint;
  v_positive bigint;
  v_negative bigint;
begin
  select * into v_account from public.loyalty_accounts where id = p_account_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;

  if not public.user_can_access_shop (v_account.shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select
    coalesce(sum (points), 0)::bigint,
    -- What the trigger added to lifetime_earned / lifetime_redeemed, by the same rule.
    coalesce(sum (case when cause = 'redemption_reversal' then 0 else greatest (points, 0) end), 0)::bigint,
    coalesce(sum (case when cause = 'redemption_reversal' then -points else greatest (-points, 0) end), 0)::bigint
  into v_sum, v_positive, v_negative
  from public.loyalty_transactions
  where account_id = p_account_id;

  return jsonb_build_object(
    'ok', true,
    'holds', (
      v_account.balance_points::bigint = v_sum
      and v_account.lifetime_earned_points::bigint = v_positive
      and v_account.lifetime_redeemed_points::bigint = v_negative
    ),
    'balance_points', v_account.balance_points,
    'ledger_sum', v_sum,
    'lifetime_earned_points', v_account.lifetime_earned_points,
    'ledger_positive_sum', v_positive,
    'lifetime_redeemed_points', v_account.lifetime_redeemed_points,
    'ledger_negative_sum', v_negative
  );
end;
$function$;

-- ============================================================================
-- 5. THE REVERSAL
-- ============================================================================
create or replace function public.loyalty_reverse_redemption (
  p_shop_id uuid,
  p_redemption_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $fn$
declare
  v_rd public.loyalty_redemptions%rowtype;
  v_ledger public.loyalty_transactions%rowtype;
  v_next_required integer;
  v_tx_id uuid;
  v_balance integer;
  v_note text := nullif (btrim (coalesce(p_note, '')), '');
begin
  if auth.uid () is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  -- The SAME authority that may redeem may un-redeem: owner/manager/cashier, or the
  -- organisation owner/admin. Nothing wider is granted, and a member is refused.
  if not public.user_can_redeem_loyalty (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  -- Locked for the whole transaction: a concurrent reversal waits here, then re-reads the
  -- status below and is refused.
  select * into v_rd
  from public.loyalty_redemptions
  where id = p_redemption_id and shop_id = p_shop_id
  for update;

  if not found then
    -- Also covers another shop's redemption: it simply is not here.
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  if v_rd.status <> 'completed' then
    return jsonb_build_object ('ok', false, 'error', 'already_reversed');
  end if;

  if v_rd.ledger_transaction_id is null then
    return jsonb_build_object ('ok', false, 'error', 'no_ledger_transaction');
  end if;

  select * into v_ledger from public.loyalty_transactions where id = v_rd.ledger_transaction_id;
  if not found or v_ledger.kind <> 'redeemed' or v_ledger.account_id <> v_rd.account_id then
    return jsonb_build_object ('ok', false, 'error', 'ledger_mismatch');
  end if;

  begin
    insert into public.loyalty_transactions (
      shop_id, account_id, kind, points, cause,
      reversal_of_id, idempotency_key, actor, actor_source, note, rule_snapshot
    )
    values (
      v_rd.shop_id,
      v_rd.account_id,
      -- 'adjusted' with positive points is already a consumable credit lot, so the
      -- restored points are spendable without touching the allocation tables.
      'adjusted',
      v_rd.points_spent,
      'redemption_reversal',
      v_rd.ledger_transaction_id,
      'redemption-reversal:' || v_rd.id::text,
      auth.uid (),
      'staff',
      v_note,
      jsonb_build_object (
        'reversal_basis', 'historical_redemption_snapshot',
        'redemption_id', v_rd.id,
        'reward_id', v_rd.reward_id,
        'points_restored', v_rd.points_spent,
        'original_transaction_id', v_rd.ledger_transaction_id,
        -- Recorded so the audit trail SHOWS that the reversal did not use today's price.
        'reward_points_required_at_reversal',
          (select r.points_required from public.loyalty_rewards r where r.id = v_rd.reward_id)
      )
    )
    returning id into v_tx_id;
  exception when unique_violation then
    -- The unique index fired: somebody reversed this redemption first.
    return jsonb_build_object ('ok', false, 'error', 'already_reversed');
  end;

  -- Only after the ledger row is in place. Both statements are in one function, so they
  -- commit or roll back together — the caller cannot half-reverse a redemption.
  update public.loyalty_redemptions
  set status = 'void',
      note = coalesce (v_note, note)
  where id = v_rd.id;

  select balance_points into v_balance from public.loyalty_accounts where id = v_rd.account_id;

  return jsonb_build_object (
    'ok', true,
    'reversed', true,
    'redemption_id', v_rd.id,
    'points_restored', v_rd.points_spent,
    'transaction_id', v_tx_id,
    'balance_points', v_balance
  );
end;
$fn$;

revoke all on function public.loyalty_reverse_redemption (uuid, uuid, text) from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_reverse_redemption (uuid, uuid, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_reverse_redemption (uuid, uuid, text) to authenticated';
  end if;
end;
$g$;

comment on function public.loyalty_reverse_redemption (uuid, uuid, text) is
  'Merchant-side reversal of a redemption. Credits exactly the historically snapshotted '
  'loyalty_redemptions.points_spent as a NEW ledger row linked by reversal_of_id; the '
  'original row is never rewritten. Lifetime earned is untouched and lifetime redeemed is '
  'reduced, so balance = earned - redeemed still holds. One reversal per redemption is '
  'enforced by a unique index. Authority: user_can_redeem_loyalty.';

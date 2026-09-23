-- Loyalty redemption hardening (Step A):
-- 1) Authoritative RPC auth: counter roles only (owner/manager/cashier + org manage)
-- 2) Concurrent over-redemption: lock account row before balance decision
-- 3) Defense-in-depth: loyalty_accounts.balance_points cannot go negative
--
-- Does NOT change POS UI, award engine, QR, Wallet, or public card.

-- ---------- Backend redeem capability (mirrors FE loyalty.redeem) ----------
create or replace function public.user_can_redeem_loyalty (p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  -- Trusted counter roles that may redeem points for a shop member.
  -- Explicitly excludes waiter / stock_keeper / viewer / kitchen / bar.
  select exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = p_shop
      and sm.user_id = auth.uid ()
      and sm.role in ('owner', 'manager', 'cashier')
  )
  or exists (
    select 1
    from public.shops sh
    join public.organization_members om on om.organization_id = sh.organization_id
    where sh.id = p_shop
      and om.user_id = auth.uid ()
      and om.role in ('owner', 'admin')
  );
$fn$;

comment on function public.user_can_redeem_loyalty (uuid) is
  'True when the caller may redeem loyalty rewards for the shop (owner/manager/cashier or org owner/admin).';

revoke all on function public.user_can_redeem_loyalty (uuid) from public;
revoke all on function public.user_can_redeem_loyalty (uuid) from anon;
grant execute on function public.user_can_redeem_loyalty (uuid) to authenticated;

-- Defense-in-depth: cached balance must never go negative via any ledger path.
do $chk$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'loyalty_accounts_balance_nonnegative'
      and conrelid = 'public.loyalty_accounts'::regclass
  ) then
    -- Fail migration loudly if existing rows are already negative (should not happen).
    if exists (
      select 1 from public.loyalty_accounts where balance_points < 0
    ) then
      raise exception 'loyalty_accounts has negative balance_points; refuse CHECK';
    end if;
    alter table public.loyalty_accounts
      add constraint loyalty_accounts_balance_nonnegative
      check (balance_points >= 0);
  end if;
end;
$chk$;

-- Clients must not INSERT redemptions directly (SECURITY DEFINER still can).
revoke insert on table public.loyalty_redemptions from authenticated;
revoke insert on table public.loyalty_redemptions from anon;
-- Keep audit reads for shop members.
grant select on table public.loyalty_redemptions to authenticated;

-- ---------- Hardened loyalty_redeem_reward ----------
create or replace function public.loyalty_redeem_reward (
  p_shop_id uuid,
  p_account_id uuid,
  p_reward_id uuid,
  p_idempotency_key text,
  p_note text default null,
  p_sale_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_account public.loyalty_accounts%rowtype;
  v_reward public.loyalty_rewards%rowtype;
  v_existing public.loyalty_redemptions%rowtype;
  v_redemption_id uuid;
  v_tx_id uuid;
  v_prior_count integer;
begin
  -- Authoritative permission (UI cannot bypass).
  if not public.user_can_redeem_loyalty (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  if p_idempotency_key is null or btrim (p_idempotency_key) = '' then
    return jsonb_build_object ('ok', false, 'error', 'idempotency_key_required');
  end if;

  -- Fast-path idempotency (no lock yet).
  select * into v_existing
  from public.loyalty_redemptions
  where shop_id = p_shop_id
    and idempotency_key = btrim (p_idempotency_key)
    and status = 'completed';
  if found then
    return jsonb_build_object (
      'ok', true,
      'redemption_id', v_existing.id,
      'already_redeemed', true,
      'points_spent', v_existing.points_spent,
      'balance', (
        select balance_points from public.loyalty_accounts where id = v_existing.account_id
      )
    );
  end if;

  select * into v_reward
  from public.loyalty_rewards
  where id = p_reward_id and shop_id = p_shop_id;
  if not found then
    return jsonb_build_object ('ok', false, 'error', 'reward_not_found');
  end if;
  if not v_reward.active then
    return jsonb_build_object ('ok', false, 'error', 'reward_inactive');
  end if;

  -- Lock the authoritative account row BEFORE balance decision.
  select * into v_account
  from public.loyalty_accounts
  where id = p_account_id and shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object ('ok', false, 'error', 'account_not_found');
  end if;
  if v_account.status <> 'active' then
    return jsonb_build_object ('ok', false, 'error', 'account_disabled');
  end if;

  -- Re-check idempotency after lock (concurrent same-key waiter).
  select * into v_existing
  from public.loyalty_redemptions
  where shop_id = p_shop_id
    and idempotency_key = btrim (p_idempotency_key)
    and status = 'completed';
  if found then
    return jsonb_build_object (
      'ok', true,
      'redemption_id', v_existing.id,
      'already_redeemed', true,
      'points_spent', v_existing.points_spent,
      'balance', v_account.balance_points
    );
  end if;

  if v_reward.max_redemptions_per_account is not null then
    select count(*) into v_prior_count
    from public.loyalty_redemptions
    where account_id = v_account.id
      and reward_id = v_reward.id
      and status = 'completed';
    if v_prior_count >= v_reward.max_redemptions_per_account then
      return jsonb_build_object ('ok', false, 'error', 'redemption_limit_reached');
    end if;
  end if;

  -- Balance check against locked cached counter (ledger remains audit source).
  if v_account.balance_points < v_reward.points_required then
    return jsonb_build_object (
      'ok', false,
      'error', 'insufficient_points',
      'balance', v_account.balance_points,
      'required', v_reward.points_required
    );
  end if;

  insert into public.loyalty_redemptions (
    shop_id, account_id, reward_id, points_spent, idempotency_key, actor, note, sale_id
  )
  values (
    p_shop_id,
    v_account.id,
    v_reward.id,
    v_reward.points_required,
    btrim (p_idempotency_key),
    auth.uid (),
    nullif (btrim (coalesce (p_note, '')), ''),
    p_sale_id
  )
  returning id into v_redemption_id;

  insert into public.loyalty_transactions (
    shop_id, account_id, kind, points, cause, actor, actor_source, note, idempotency_key
  )
  values (
    p_shop_id,
    v_account.id,
    'redeemed',
    -v_reward.points_required,
    'redemption',
    auth.uid (),
    'staff',
    nullif (btrim (coalesce (p_note, '')), ''),
    'redemption:' || v_redemption_id::text
  )
  returning id into v_tx_id;

  update public.loyalty_redemptions
  set ledger_transaction_id = v_tx_id
  where id = v_redemption_id;

  return jsonb_build_object (
    'ok', true,
    'redemption_id', v_redemption_id,
    'transaction_id', v_tx_id,
    'already_redeemed', false,
    'points_spent', v_reward.points_required,
    'balance', (select balance_points from public.loyalty_accounts where id = v_account.id)
  );
end;
$function$;

-- Preserve execute grants (authenticated only; no anon).
revoke all on function public.loyalty_redeem_reward (uuid, uuid, uuid, text, text, uuid) from public;
revoke all on function public.loyalty_redeem_reward (uuid, uuid, uuid, text, text, uuid) from anon;
grant execute on function public.loyalty_redeem_reward (uuid, uuid, uuid, text, text, uuid) to authenticated;

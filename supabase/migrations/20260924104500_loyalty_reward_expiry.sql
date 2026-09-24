-- C2 — Merchant-controlled loyalty REWARD expiry (not points expiry, not membership).
--
-- Default safety: expires_on NULL for all existing rewards (never expires).
-- Does NOT burn points, create ledger rows, or delete rewards on expiry.
-- Reuses C1 Kampala helper: loyalty_membership_expires_at_from_date.
-- Baseline: 20260924093000_loyalty_membership_expiry.sql (C1 redeem body).

-- ---------- Schema ----------
alter table public.loyalty_rewards
  add column if not exists expires_on date null;

comment on column public.loyalty_rewards.expires_on is
  'C2 inclusive Kampala calendar end date. NULL = never expires. Independent of active.';

create index if not exists loyalty_rewards_shop_active_expires_idx
  on public.loyalty_rewards (shop_id, active, expires_on, sort_order);

-- Thin wrapper: reward is within its Kampala window (does not check active).
create or replace function public.loyalty_reward_unexpired (
  p_expires_on date,
  p_now timestamptz default now()
)
returns boolean
language sql
stable
as $fn$
  select p_expires_on is null
    or coalesce(p_now, now()) < public.loyalty_membership_expires_at_from_date(p_expires_on);
$fn$;

revoke all on function public.loyalty_reward_unexpired (date, timestamptz) from public;
grant execute on function public.loyalty_reward_unexpired (date, timestamptz) to authenticated;

-- ---------- Redeem: C1 baseline + C2 reward expiry (re-read after lock) ----------
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
  -- 1. Authorization
  if not public.user_can_redeem_loyalty (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  -- 2. Idempotency required + fast completed lookup
  if p_idempotency_key is null or btrim (p_idempotency_key) = '' then
    return jsonb_build_object ('ok', false, 'error', 'idempotency_key_required');
  end if;

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

  -- 3. Reward lookup scoped to shop (early not-found; active/expiry re-checked after lock)
  select * into v_reward
  from public.loyalty_rewards
  where id = p_reward_id and shop_id = p_shop_id;
  if not found then
    return jsonb_build_object ('ok', false, 'error', 'reward_not_found');
  end if;

  -- 4. Account lock
  select * into v_account
  from public.loyalty_accounts
  where id = p_account_id and shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object ('ok', false, 'error', 'account_not_found');
  end if;

  -- 5. Account status + C1 membership expiry
  if v_account.status <> 'active' then
    return jsonb_build_object ('ok', false, 'error', 'account_disabled');
  end if;
  if not public.loyalty_account_membership_active(v_account.status, v_account.membership_expires_at, now()) then
    return jsonb_build_object ('ok', false, 'error', 'membership_expired');
  end if;

  -- 6. Idempotency re-check under lock
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

  -- 7. Re-read reward (close TOCTOU on active / expires_on / points)
  select * into v_reward
  from public.loyalty_rewards
  where id = p_reward_id and shop_id = p_shop_id;
  if not found then
    return jsonb_build_object ('ok', false, 'error', 'reward_not_found');
  end if;

  -- 8. Reward active
  if not v_reward.active then
    return jsonb_build_object ('ok', false, 'error', 'reward_inactive');
  end if;

  -- 9. Reward expiry (Kampala inclusive day via C1 helper)
  if not public.loyalty_reward_unexpired(v_reward.expires_on, now()) then
    return jsonb_build_object ('ok', false, 'error', 'reward_expired');
  end if;

  -- 10. Cap
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

  -- 11. Balance
  if v_account.balance_points < v_reward.points_required then
    return jsonb_build_object (
      'ok', false,
      'error', 'insufficient_points',
      'balance', v_account.balance_points,
      'required', v_reward.points_required
    );
  end if;

  -- 12. Redemption + ledger
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

revoke all on function public.loyalty_redeem_reward (uuid, uuid, uuid, text, text, uuid) from public;
revoke all on function public.loyalty_redeem_reward (uuid, uuid, uuid, text, text, uuid) from anon;
grant execute on function public.loyalty_redeem_reward (uuid, uuid, uuid, text, text, uuid) to authenticated;

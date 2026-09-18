-- Waka POS — Loyalty rewards & redemption (Phase 08)
--
-- Merchant-defined rewards + atomic, idempotent, auditable redemptions.
-- A redemption is: one row in loyalty_redemptions + one negative
-- 'redeemed' row in the immutable ledger, written in a single transaction.
-- Cached balances update via the existing trg_loyalty_tx_balance trigger,
-- so the balance invariant (balance = earned - redeemed) always holds.
--
-- Inventory/financial semantics are NOT touched here: fulfilling a
-- free-product reward happens at the POS through the existing product/sale
-- flow (the merchant rings up the product with their normal discount
-- practice); loyalty_redemptions.sale_id optionally links that sale for
-- audit. No second inventory ledger is created.

-- ---------- loyalty_rewards (merchant-defined catalog) ----------
create table if not exists public.loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  description text not null default '',
  points_required integer not null check (points_required > 0),
  reward_kind text not null default 'custom' check (reward_kind in ('product', 'voucher', 'custom')),
  -- Optional linkage to a shop product (for 'product' rewards); the
  -- redemption itself never moves inventory — fulfillment is a POS sale.
  product_id uuid references public.products (id) on delete set null,
  -- Per-account lifetime redemption cap; null = unlimited.
  max_redemptions_per_account integer check (max_redemptions_per_account is null or max_redemptions_per_account > 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists loyalty_rewards_shop_idx on public.loyalty_rewards (shop_id, active, sort_order);

drop trigger if exists trg_loyalty_rewards_updated on public.loyalty_rewards;
create trigger trg_loyalty_rewards_updated
  before update on public.loyalty_rewards
  for each row execute function public.set_updated_at ();

-- ---------- loyalty_redemptions (audit + idempotency) ----------
create table if not exists public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  account_id uuid not null references public.loyalty_accounts (id) on delete cascade,
  reward_id uuid not null references public.loyalty_rewards (id) on delete restrict,
  points_spent integer not null check (points_spent > 0),
  status text not null default 'completed' check (status in ('completed', 'void')),
  -- Client-generated per redemption intent; makes retries/replays safe.
  idempotency_key text not null,
  ledger_transaction_id uuid references public.loyalty_transactions (id) on delete restrict,
  -- Optional link to the POS sale that fulfilled the reward.
  sale_id uuid references public.sales (id) on delete set null,
  actor uuid references auth.users (id),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists loyalty_redemptions_account_idx
  on public.loyalty_redemptions (account_id, created_at desc);
create index if not exists loyalty_redemptions_reward_idx
  on public.loyalty_redemptions (reward_id);

-- Idempotency (Decision 007): one completed redemption per idempotency key.
create unique index if not exists loyalty_redemption_key_once
  on public.loyalty_redemptions (shop_id, idempotency_key)
  where status = 'completed';

-- Every redemption backs exactly one ledger row.
create unique index if not exists loyalty_redemption_ledger_once
  on public.loyalty_redemptions (ledger_transaction_id)
  where ledger_transaction_id is not null;

-- ---------- RLS ----------
alter table public.loyalty_rewards enable row level security;
alter table public.loyalty_redemptions enable row level security;

drop policy if exists loyalty_rewards_select on public.loyalty_rewards;
create policy loyalty_rewards_select
  on public.loyalty_rewards for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists loyalty_rewards_insert on public.loyalty_rewards;
create policy loyalty_rewards_insert
  on public.loyalty_rewards for insert
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists loyalty_rewards_update on public.loyalty_rewards;
create policy loyalty_rewards_update
  on public.loyalty_rewards for update
  using (public.user_can_manage_shop (shop_id));

-- Redemptions are readable by any shop member (audit), written ONLY through
-- the security-definer RPC below.
drop policy if exists loyalty_redemptions_select on public.loyalty_redemptions;
create policy loyalty_redemptions_select
  on public.loyalty_redemptions for select
  using (public.user_can_access_shop (shop_id));

revoke all on public.loyalty_rewards from anon;
revoke all on public.loyalty_redemptions from anon;

grant select, insert, update on public.loyalty_rewards to authenticated;
grant select, insert on public.loyalty_redemptions to authenticated;

-- ---------- Atomic redemption RPC ----------
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
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    return jsonb_build_object('ok', false, 'error', 'idempotency_key_required');
  end if;

  -- Idempotent retry: an existing completed redemption for this key is
  -- returned as-is — repeated taps/clicks/retries never deduct twice.
  select * into v_existing
  from public.loyalty_redemptions
  where shop_id = p_shop_id and idempotency_key = btrim(p_idempotency_key)
    and status = 'completed';
  if found then
    return jsonb_build_object(
      'ok', true, 'redemption_id', v_existing.id,
      'already_redeemed', true,
      'points_spent', v_existing.points_spent,
      'balance', (select balance_points from public.loyalty_accounts where id = v_existing.account_id)
    );
  end if;

  select * into v_account
  from public.loyalty_accounts
  where id = p_account_id and shop_id = p_shop_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;
  if v_account.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'account_disabled');
  end if;

  select * into v_reward
  from public.loyalty_rewards
  where id = p_reward_id and shop_id = p_shop_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'reward_not_found');
  end if;
  if not v_reward.active then
    return jsonb_build_object('ok', false, 'error', 'reward_inactive');
  end if;

  if v_reward.max_redemptions_per_account is not null then
    select count(*) into v_prior_count
    from public.loyalty_redemptions
    where account_id = v_account.id and reward_id = v_reward.id and status = 'completed';
    if v_prior_count >= v_reward.max_redemptions_per_account then
      return jsonb_build_object('ok', false, 'error', 'redemption_limit_reached');
    end if;
  end if;

  -- Balance check against the cached counter (maintained by the ledger
  -- trigger; the ledger itself is the audit source).
  if v_account.balance_points < v_reward.points_required then
    return jsonb_build_object(
      'ok', false, 'error', 'insufficient_points',
      'balance', v_account.balance_points,
      'required', v_reward.points_required
    );
  end if;

  -- Atomic pair: redemption row + negative ledger row. Any failure rolls
  -- back both (single transaction, single function call).
  insert into public.loyalty_redemptions (
    shop_id, account_id, reward_id, points_spent, idempotency_key, actor, note, sale_id
  )
  values (
    p_shop_id, v_account.id, v_reward.id, v_reward.points_required,
    btrim(p_idempotency_key), auth.uid (), nullif(btrim(coalesce(p_note, '')), ''), p_sale_id
  )
  returning id into v_redemption_id;

  insert into public.loyalty_transactions (
    shop_id, account_id, kind, points, cause, actor, actor_source, note, idempotency_key
  )
  values (
    p_shop_id, v_account.id, 'redeemed', -v_reward.points_required, 'redemption',
    auth.uid (), 'staff', nullif(btrim(coalesce(p_note, '')), ''),
    'redemption:' || v_redemption_id::text
  )
  returning id into v_tx_id;

  update public.loyalty_redemptions
  set ledger_transaction_id = v_tx_id
  where id = v_redemption_id;

  return jsonb_build_object(
    'ok', true,
    'redemption_id', v_redemption_id,
    'transaction_id', v_tx_id,
    'already_redeemed', false,
    'points_spent', v_reward.points_required,
    'balance', (select balance_points from public.loyalty_accounts where id = v_account.id)
  );
end;
$function$;

grant execute on function public.loyalty_redeem_reward (uuid, uuid, uuid, text, text, uuid) to authenticated;

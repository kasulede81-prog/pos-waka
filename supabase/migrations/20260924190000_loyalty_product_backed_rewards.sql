-- Decision 030 — Product-backed loyalty rewards
--
-- Additive only. Extends loyalty_rewards with product_quantity and enforces
-- same-shop product references. Extends loyalty_redeem_reward so that when a
-- reward has product_id, redemption:
--   1) validates eligibility / stock / points (server-side)
--   2) deducts points via existing FIFO redeem path
--   3) creates a zero-revenue completed sale + line on the EXISTING sales /
--      sale_line_items tables
--   4) calls apply_sale_stock_movements (canonical inventory engine)
--
-- Does NOT create a second financial ledger or inventory engine.
-- Does NOT redesign sales / inventory_movements / financial_correction schema.
-- Existing non-product rewards remain unchanged.

-- ---------- Schema: quantity + redemption fulfillment audit ----------
alter table public.loyalty_rewards
  add column if not exists product_quantity numeric(18, 4) not null default 1;

alter table public.loyalty_rewards
  drop constraint if exists loyalty_rewards_product_quantity_positive;

alter table public.loyalty_rewards
  add constraint loyalty_rewards_product_quantity_positive
  check (product_quantity > 0);

comment on column public.loyalty_rewards.product_id is
  'Optional canonical WAKA product (same shop). Null = non-product reward.';
comment on column public.loyalty_rewards.product_quantity is
  'Units of product_id to fulfill on claim. Ignored when product_id is null.';

alter table public.loyalty_redemptions
  add column if not exists fulfilled_product_id uuid references public.products (id) on delete set null;

alter table public.loyalty_redemptions
  add column if not exists fulfilled_quantity numeric(18, 4);

comment on column public.loyalty_redemptions.fulfilled_product_id is
  'Snapshot of product fulfilled for product-backed rewards (audit).';
comment on column public.loyalty_redemptions.fulfilled_quantity is
  'Snapshot of quantity fulfilled for product-backed rewards (audit).';

-- ---------- Same-shop product guard (merchant attach) ----------
create or replace function public.loyalty_rewards_product_shop_guard ()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_product_shop uuid;
begin
  if new.product_id is null then
    return new;
  end if;

  select shop_id into v_product_shop
  from public.products
  where id = new.product_id;

  if v_product_shop is null then
    raise exception 'loyalty_reward_product_not_found';
  end if;
  if v_product_shop is distinct from new.shop_id then
    raise exception 'loyalty_reward_product_cross_shop';
  end if;

  if new.reward_kind is distinct from 'product' then
    new.reward_kind := 'product';
  end if;

  if new.product_quantity is null or new.product_quantity <= 0 then
    new.product_quantity := 1;
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_loyalty_rewards_product_shop on public.loyalty_rewards;
create trigger trg_loyalty_rewards_product_shop
  before insert or update of product_id, shop_id, product_quantity, reward_kind
  on public.loyalty_rewards
  for each row execute function public.loyalty_rewards_product_shop_guard ();

revoke all on function public.loyalty_rewards_product_shop_guard () from public;
revoke all on function public.loyalty_rewards_product_shop_guard () from anon;

-- ---------- Redeem: product-backed fulfill via existing sale + stock path ----------
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
  v_product public.products%rowtype;
  v_redemption_id uuid;
  v_tx_id uuid;
  v_prior_count integer;
  v_qty numeric(18, 4);
  v_sale_id uuid;
  v_unit_cost bigint;
  v_line_meta jsonb;
  v_stock_result jsonb;
begin
  if not public.user_can_redeem_loyalty (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

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
      'sale_id', v_existing.sale_id,
      'fulfilled_product_id', v_existing.fulfilled_product_id,
      'fulfilled_quantity', v_existing.fulfilled_quantity,
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

  select * into v_account
  from public.loyalty_accounts
  where id = p_account_id and shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object ('ok', false, 'error', 'account_not_found');
  end if;
  if v_account.status = 'revoked' then
    return jsonb_build_object ('ok', false, 'error', 'account_revoked');
  end if;
  if v_account.status = 'suspended' then
    return jsonb_build_object ('ok', false, 'error', 'account_suspended');
  end if;
  if v_account.status <> 'active' then
    return jsonb_build_object ('ok', false, 'error', 'account_disabled');
  end if;
  if not public.loyalty_account_membership_active (v_account.status, v_account.membership_expires_at, now ()) then
    return jsonb_build_object ('ok', false, 'error', 'membership_expired');
  end if;

  -- Re-check idempotency after account lock (concurrency).
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
      'sale_id', v_existing.sale_id,
      'fulfilled_product_id', v_existing.fulfilled_product_id,
      'fulfilled_quantity', v_existing.fulfilled_quantity,
      'balance', v_account.balance_points
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
  if not public.loyalty_reward_unexpired (v_reward.expires_on, now ()) then
    return jsonb_build_object ('ok', false, 'error', 'reward_expired');
  end if;

  -- Decision 026 + 029: grant-only rewards need D026 reward_grant OR active D029 assignment.
  if coalesce (v_reward.requires_offer_grant, false) then
    if not public.loyalty_account_reward_granted (v_account.id, v_reward.id, now ()) then
      if exists (
        select 1
        from public.loyalty_reward_assignments a
        where a.account_id = v_account.id
          and a.reward_id = v_reward.id
          and a.status = 'active'
          and a.expires_at is not null
          and now () >= a.expires_at
      ) then
        return jsonb_build_object ('ok', false, 'error', 'assignment_expired');
      end if;
      return jsonb_build_object ('ok', false, 'error', 'reward_grant_required');
    end if;
  end if;

  perform public.loyalty_expire_due_points (v_account.id);
  select * into v_account from public.loyalty_accounts where id = p_account_id;

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

  if v_account.balance_points < v_reward.points_required then
    return jsonb_build_object (
      'ok', false,
      'error', 'insufficient_points',
      'balance', v_account.balance_points,
      'required', v_reward.points_required
    );
  end if;

  -- ---------- Product-backed validation (before any points write) ----------
  v_sale_id := p_sale_id;
  v_qty := null;

  if v_reward.product_id is not null then
    v_qty := coalesce (v_reward.product_quantity, 1);
    if v_qty is null or v_qty <= 0 then
      return jsonb_build_object ('ok', false, 'error', 'invalid_product_quantity');
    end if;

    select * into v_product
    from public.products
    where id = v_reward.product_id
      and shop_id = p_shop_id
    for update;
    if not found then
      return jsonb_build_object ('ok', false, 'error', 'product_not_found');
    end if;
    if coalesce (v_product.is_active, true) is not true then
      return jsonb_build_object ('ok', false, 'error', 'product_inactive');
    end if;
    if coalesce (v_product.stock_on_hand, 0) < v_qty then
      return jsonb_build_object (
        'ok', false,
        'error', 'product_out_of_stock',
        'stock_on_hand', v_product.stock_on_hand,
        'required', v_qty
      );
    end if;

    -- Cost snapshot from canonical product columns (prefer modern name).
    v_unit_cost := greatest (
      0,
      round (
        coalesce (
          nullif ((to_jsonb (v_product) ->> 'cost_price_per_unit_ugx'), '')::numeric,
          nullif ((to_jsonb (v_product) ->> 'cost_ugx'), '')::numeric,
          0
        )
      )
    )::bigint;

    -- Client-supplied sale_id is ignored for product-backed claims: fulfillment
    -- creates its own zero-revenue sale so inventory stays on the canonical path.
    v_sale_id := null;
  end if;

  insert into public.loyalty_redemptions (
    shop_id, account_id, reward_id, points_spent, idempotency_key, actor, note, sale_id,
    fulfilled_product_id, fulfilled_quantity
  )
  values (
    p_shop_id,
    v_account.id,
    v_reward.id,
    v_reward.points_required,
    btrim (p_idempotency_key),
    auth.uid (),
    nullif (btrim (coalesce (p_note, '')), ''),
    v_sale_id,
    case when v_reward.product_id is not null then v_reward.product_id else null end,
    v_qty
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

  perform public.loyalty_allocate_fifo (
    v_account.id, v_tx_id, v_reward.points_required, 'redeemed', false, true
  );

  update public.loyalty_redemptions
  set ledger_transaction_id = v_tx_id
  where id = v_redemption_id;

  -- ---------- Product fulfillment via existing sale + inventory engine ----------
  if v_reward.product_id is not null then
    if to_regprocedure ('public.apply_sale_stock_movements(uuid)') is null then
      raise exception 'apply_sale_stock_movements_required_for_product_reward';
    end if;

    insert into public.sales (
      shop_id,
      customer_id,
      status,
      payment_status,
      subtotal_ugx,
      tax_ugx,
      discount_ugx,
      total_ugx,
      currency,
      cash_amount_ugx,
      created_by,
      completed_at,
      metadata
    )
    values (
      p_shop_id,
      v_account.customer_id,
      'completed',
      'paid',
      0,
      0,
      0,
      0,
      'UGX',
      0,
      auth.uid (),
      now (),
      jsonb_build_object (
        'source', 'loyalty_reward',
        'loyalty_redemption_id', v_redemption_id,
        'reward_id', v_reward.id,
        'loyalty_account_id', v_account.id
      )
    )
    returning id into v_sale_id;

    v_line_meta := jsonb_build_object (
      'name', v_product.name,
      'unitCostUgx', v_unit_cost,
      'cogsUgx', round (v_unit_cost * v_qty),
      'netRevenueUgx', 0,
      'grossProfitUgx', -round (v_unit_cost * v_qty),
      'estimatedProfitUgx', -round (v_unit_cost * v_qty),
      'lineIndex', 0,
      'source', 'loyalty_reward',
      'loyalty_redemption_id', v_redemption_id,
      'reward_id', v_reward.id
    );

    insert into public.sale_line_items (
      sale_id,
      product_id,
      quantity,
      unit_price_ugx,
      line_discount_ugx,
      line_total_ugx,
      metadata
    )
    values (
      v_sale_id,
      v_reward.product_id,
      v_qty,
      0,
      0,
      0,
      v_line_meta
    );

    -- Canonical inventory movement (idempotent per sale × product).
    v_stock_result := public.apply_sale_stock_movements (v_sale_id);

    update public.loyalty_redemptions
    set sale_id = v_sale_id
    where id = v_redemption_id;
  end if;

  return jsonb_build_object (
    'ok', true,
    'redemption_id', v_redemption_id,
    'transaction_id', v_tx_id,
    'already_redeemed', false,
    'points_spent', v_reward.points_required,
    'sale_id', v_sale_id,
    'fulfilled_product_id', case when v_reward.product_id is not null then v_reward.product_id else null end,
    'fulfilled_quantity', v_qty,
    'balance', (select balance_points from public.loyalty_accounts where id = v_account.id)
  );
end;
$function$;

revoke all on function public.loyalty_redeem_reward (uuid, uuid, uuid, text, text, uuid) from public;
revoke all on function public.loyalty_redeem_reward (uuid, uuid, uuid, text, text, uuid) from anon;
grant execute on function public.loyalty_redeem_reward (uuid, uuid, uuid, text, text, uuid) to authenticated;

-- ============================================================================
-- LOYALTY PHASE E — REWARD BENEFITS (monetary rewards)
-- ============================================================================
-- A reward can now be worth money at the counter: "500 points → UGX 5,000 off" or
-- "1,000 points → 10% off".
--
-- POINTS ARE NOT MONEY, AND THIS MIGRATION DOES NOT MAKE THEM MONEY.
--   * `loyalty_accounts.balance_points` stays a points counter. Nothing converts it to UGX.
--   * There is no customer cash balance, no withdrawable wallet, no stored value, and no
--     WAKA liability. WAKA never owes a customer money and never pays cash out.
--   * The only thing a benefit does is reduce what a customer pays on a WAKA SALE, through
--     the sale the merchant already records — `sales.discount_ugx`. The sale remains the
--     single source of truth for every monetary effect.
--   * The points movement stays a loyalty ledger row. The benefit is a SNAPSHOT of what
--     the reward was worth, not a second currency.
--
-- WHY A SNAPSHOT AND NOT A LOOKUP. A merchant will re-price a reward. Every redemption
-- therefore copies the benefit it was redeemed under onto the redemption row, and the
-- application below reads THAT copy. Re-pricing a reward cannot rewrite what an old
-- redemption was worth. (Phase D established the same discipline for `points_spent`.)
--
-- THE BENEFIT IS A SALE DISCOUNT. Phase E deliberately does NOT invent a second monetary
-- mechanism, a fake payment method, or a loyalty-only total. What it adds is the ability to
-- record, server-side and authoritatively, that a redemption's benefit WAS the discount a
-- particular sale carries — and to refuse the claim when the two disagree.
--
-- WHAT THIS MIGRATION DOES NOT DO, ON PURPOSE:
--   * It does not touch `saleFinancialEngine`, `finalizeDraftSale`, `shop_push_sale_complete`
--     or any sale arithmetic. Sales keep computing their own money.
--   * It does not reverse a benefit automatically on return or void. That relationship is
--     not defined by the current architecture, so it is documented rather than invented
--     (see the note on `loyalty_apply_redemption_to_sale`).
--   * It does not modify `loyalty_redeem_reward` — the snapshot is taken by a trigger, so
--     every insert path (including a future one) snapshots identically.

-- ---------------------------------------------------------------------------
-- 1. The benefit a reward is worth (merchant-authored)
-- ---------------------------------------------------------------------------
alter table public.loyalty_rewards
  add column if not exists benefit_kind text not null default 'none';
alter table public.loyalty_rewards
  add column if not exists benefit_amount_ugx bigint null;
alter table public.loyalty_rewards
  add column if not exists benefit_percent numeric(5, 2) null;

do $c$
begin
  alter table public.loyalty_rewards drop constraint if exists loyalty_rewards_benefit_kind_check;
  alter table public.loyalty_rewards add constraint loyalty_rewards_benefit_kind_check
    check (benefit_kind in ('none', 'fixed_discount', 'percentage_discount'));

  -- Integer UGX, strictly positive. No zero-value benefit can be sold for points.
  alter table public.loyalty_rewards drop constraint if exists loyalty_rewards_benefit_amount_check;
  alter table public.loyalty_rewards add constraint loyalty_rewards_benefit_amount_check
    check (benefit_amount_ugx is null or benefit_amount_ugx > 0);

  -- `numeric` cannot hold NaN or infinity, and the bound makes >100% unrepresentable at
  -- the storage layer — not merely rejected by a form.
  alter table public.loyalty_rewards drop constraint if exists loyalty_rewards_benefit_percent_check;
  alter table public.loyalty_rewards add constraint loyalty_rewards_benefit_percent_check
    check (benefit_percent is null or (benefit_percent > 0 and benefit_percent <= 100));

  -- The kind decides which field is populated, so an ambiguous reward cannot exist.
  alter table public.loyalty_rewards drop constraint if exists loyalty_rewards_benefit_shape_check;
  alter table public.loyalty_rewards add constraint loyalty_rewards_benefit_shape_check
    check (
      (benefit_kind = 'none' and benefit_amount_ugx is null and benefit_percent is null)
      or (benefit_kind = 'fixed_discount' and benefit_amount_ugx is not null and benefit_percent is null)
      or (benefit_kind = 'percentage_discount' and benefit_percent is not null and benefit_amount_ugx is null)
    );

  -- A reward is either a product or a monetary benefit. Both at once would make "what did
  -- the customer actually get?" unanswerable at the counter.
  alter table public.loyalty_rewards drop constraint if exists loyalty_rewards_benefit_excludes_product_check;
  alter table public.loyalty_rewards add constraint loyalty_rewards_benefit_excludes_product_check
    check (benefit_kind = 'none' or product_id is null);
end;
$c$;

comment on column public.loyalty_rewards.benefit_kind is
  'none | fixed_discount | percentage_discount. A discount benefit reduces a WAKA sale via '
  'sales.discount_ugx. It is NOT stored value, a wallet, or a WAKA liability.';

-- ---------------------------------------------------------------------------
-- 2. What the redemption was actually worth, and whether a sale received it
-- ---------------------------------------------------------------------------
alter table public.loyalty_redemptions
  add column if not exists benefit_kind text not null default 'none';
alter table public.loyalty_redemptions
  add column if not exists benefit_amount_ugx bigint null;
alter table public.loyalty_redemptions
  add column if not exists benefit_percent numeric(5, 2) null;
-- How much discount this redemption actually accounted for on the sale below, decided by
-- the server from the snapshot. Null until applied.
alter table public.loyalty_redemptions
  add column if not exists applied_amount_ugx bigint null;
alter table public.loyalty_redemptions
  add column if not exists applied_at timestamptz null;

do $c$
begin
  alter table public.loyalty_redemptions drop constraint if exists loyalty_redemptions_benefit_shape_check;
  alter table public.loyalty_redemptions add constraint loyalty_redemptions_benefit_shape_check
    check (
      (benefit_kind = 'none' and benefit_amount_ugx is null and benefit_percent is null)
      or (benefit_kind = 'fixed_discount' and benefit_amount_ugx is not null and benefit_percent is null)
      or (benefit_kind = 'percentage_discount' and benefit_percent is not null and benefit_amount_ugx is null)
    );

  -- A benefit application is characterised by `applied_amount_ugx` + `applied_at`, which
  -- always appear together. `sale_id` is NOT part of that pair: the product-backed path
  -- already sets `sale_id` on its own to link the zero-revenue fulfilment sale it creates,
  -- and such a row carries no monetary benefit. Requiring all three together would have
  -- broken every product redemption.
  alter table public.loyalty_redemptions drop constraint if exists loyalty_redemptions_applied_shape_check;
  alter table public.loyalty_redemptions add constraint loyalty_redemptions_applied_shape_check
    check (
      (applied_amount_ugx is null and applied_at is null)
      or (applied_amount_ugx > 0 and applied_at is not null and sale_id is not null)
    );
end;
$c$;

-- One redemption is applied to at most one sale — it is a single column, and this index
-- makes the reverse direction explicit too: a sale may carry several redemptions, but the
-- same redemption can never be recorded twice.
create unique index if not exists loyalty_redemptions_applied_once
  on public.loyalty_redemptions (id, sale_id)
  where sale_id is not null and applied_amount_ugx is not null;

-- An application, once recorded, is IMMUTABLE. Without this a privileged writer could
-- re-point a recorded benefit at a different sale — the row shape would still satisfy the
-- CHECK above, so the constraint alone does not forbid it, and "which sale did this reward
-- discount?" would stop having one answer.
--
-- Keyed on `applied_amount_ugx`, NOT on `sale_id`: the product-backed path legitimately sets
-- `sale_id` when it creates its zero-revenue fulfilment sale, and every such row has
-- `applied_amount_ugx = NULL`, so it is untouched by this guard.
create or replace function public.loyalty_redemptions_guard_application ()
returns trigger
language plpgsql
set search_path = 'public'
as $fn$
begin
  if old.applied_amount_ugx is not null then
    if new.sale_id is distinct from old.sale_id
       or new.applied_amount_ugx is distinct from old.applied_amount_ugx
       or new.applied_at is distinct from old.applied_at then
      raise exception 'a recorded reward benefit cannot be re-pointed (redemption %)', old.id
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_loyalty_redemptions_guard_application on public.loyalty_redemptions;
create trigger trg_loyalty_redemptions_guard_application
  before update on public.loyalty_redemptions
  for each row execute function public.loyalty_redemptions_guard_application ();

revoke all on function public.loyalty_redemptions_guard_application () from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_redemptions_guard_application () from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.loyalty_redemptions_guard_application () from authenticated';
  end if;
end;
$g$;

comment on column public.loyalty_redemptions.benefit_kind is
  'Snapshot of the reward benefit AT REDEMPTION. Never re-read from loyalty_rewards, so '
  're-pricing a reward cannot rewrite what a past redemption was worth.';
comment on column public.loyalty_redemptions.applied_amount_ugx is
  'The discount this redemption accounted for on sale_id, derived by the server and clamped '
  'to the discount the sale actually records. Not stored value — no balance is carried.';

-- ---------------------------------------------------------------------------
-- 3. Snapshot the benefit at redemption time
-- ---------------------------------------------------------------------------
-- A BEFORE INSERT trigger rather than an edit to `loyalty_redeem_reward`: the snapshot rule
-- then holds for every insert path, present and future, instead of only the one that
-- happened to be edited. An explicit kind passed by a caller is respected (used by tests);
-- the normal path leaves it at the default and the trigger fills all three fields.
create or replace function public.loyalty_redemptions_snapshot_benefit ()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $fn$
begin
  if new.benefit_kind = 'none' then
    select r.benefit_kind, r.benefit_amount_ugx, r.benefit_percent
    into new.benefit_kind, new.benefit_amount_ugx, new.benefit_percent
    from public.loyalty_rewards r
    where r.id = new.reward_id;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_loyalty_redemptions_snapshot_benefit on public.loyalty_redemptions;
create trigger trg_loyalty_redemptions_snapshot_benefit
  before insert on public.loyalty_redemptions
  for each row execute function public.loyalty_redemptions_snapshot_benefit ();

revoke all on function public.loyalty_redemptions_snapshot_benefit () from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_redemptions_snapshot_benefit () from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.loyalty_redemptions_snapshot_benefit () from authenticated';
  end if;
end;
$g$;

-- ============================================================================
-- 4. APPLY A REDEMPTION'S BENEFIT TO THE SALE THAT CARRIED IT
-- ============================================================================
-- This is the record that joins the loyalty side to the financial side, and it is the only
-- money-related mutation Phase E adds.
--
-- THE CLIENT PROPOSES NO AMOUNT. It names a redemption and a sale; the server derives the
-- benefit from the redemption's own snapshot and then clamps it to the discount that sale
-- actually records (`sales.discount_ugx`). So a claim can never exceed the money the sale
-- really gave away — which is what stops this becoming a way to manufacture discounts.
--
-- WHY IT DOES NOT WRITE TO THE SALE. `sales` is the financial source of truth and its
-- totals are computed by the protected financial engine during finalize. Loyalty records
-- what happened; it does not author sale arithmetic. If the sale's own discount is smaller
-- than the benefit, the smaller figure is what gets recorded and the difference is visible
-- to the merchant rather than silently invented.
--
-- RETURNS AND VOIDS ARE NOT AUTO-COUPLED. A voided sale is excluded from spend by its
-- status and a returned sale keeps its discount; whether the customer should get their
-- points back in those cases is a POLICY decision the current architecture does not define.
-- Rather than guess, the supported remedy is Phase D: `loyalty_reverse_redemption` returns
-- the points and marks the redemption void, and this function then refuses to apply it.
create or replace function public.loyalty_apply_redemption_to_sale (
  p_shop_id uuid,
  p_redemption_id uuid,
  p_sale_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $fn$
declare
  v_rd public.loyalty_redemptions%rowtype;
  v_sale public.sales%rowtype;
  v_account_customer uuid;
  v_requested bigint;
  v_applied bigint;
begin
  if auth.uid () is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  -- The same authority that may redeem may record the application.
  if not public.user_can_redeem_loyalty (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  -- Locked: two cashiers applying the same redemption serialize here, and the second sees
  -- sale_id already set below.
  select * into v_rd
  from public.loyalty_redemptions
  where id = p_redemption_id and shop_id = p_shop_id
  for update;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  if v_rd.status <> 'completed' then
    return jsonb_build_object ('ok', false, 'error', 'redemption_voided');
  end if;

  if v_rd.sale_id is not null or v_rd.applied_amount_ugx is not null then
    return jsonb_build_object ('ok', false, 'error', 'already_applied');
  end if;

  if v_rd.benefit_kind not in ('fixed_discount', 'percentage_discount') then
    return jsonb_build_object ('ok', false, 'error', 'no_monetary_benefit');
  end if;

  select * into v_sale
  from public.sales
  where id = p_sale_id and shop_id = p_shop_id;

  if not found then
    -- Another shop's sale is simply not here.
    return jsonb_build_object ('ok', false, 'error', 'sale_not_found');
  end if;

  if v_sale.status <> 'completed' then
    return jsonb_build_object ('ok', false, 'error', 'sale_not_eligible');
  end if;

  -- A reward belongs to the customer who earned it: the sale must be that customer's.
  select a.customer_id into v_account_customer
  from public.loyalty_accounts a where a.id = v_rd.account_id;

  if v_account_customer is null or v_sale.customer_id is distinct from v_account_customer then
    return jsonb_build_object ('ok', false, 'error', 'customer_mismatch');
  end if;

  -- Derive the benefit from the SNAPSHOT. Integer UGX arithmetic; the percentage is floored
  -- so a fractional result can never exceed what the customer is owed.
  v_requested := case
    when v_rd.benefit_kind = 'fixed_discount' then v_rd.benefit_amount_ugx
    else floor (v_sale.subtotal_ugx::numeric * v_rd.benefit_percent / 100)::bigint
  end;

  -- Clamp to what the sale actually gave away. Never the client's number, never more than
  -- the sale records, never negative.
  v_applied := least (greatest (coalesce (v_requested, 0), 0), greatest (coalesce (v_sale.discount_ugx, 0), 0));

  if v_applied <= 0 then
    return jsonb_build_object (
      'ok', false,
      'error', 'no_discount_on_sale',
      'requested_ugx', coalesce (v_requested, 0),
      'sale_discount_ugx', coalesce (v_sale.discount_ugx, 0)
    );
  end if;

  update public.loyalty_redemptions
  set sale_id = p_sale_id,
      applied_amount_ugx = v_applied,
      applied_at = now ()
  where id = v_rd.id;

  return jsonb_build_object (
    'ok', true,
    'applied', true,
    'redemption_id', v_rd.id,
    'sale_id', p_sale_id,
    'benefit_kind', v_rd.benefit_kind,
    'benefit_amount_ugx', v_rd.benefit_amount_ugx,
    'benefit_percent', v_rd.benefit_percent,
    'requested_ugx', coalesce (v_requested, 0),
    'applied_amount_ugx', v_applied,
    'clamped', coalesce (v_requested, 0) > v_applied
  );
end;
$fn$;

revoke all on function public.loyalty_apply_redemption_to_sale (uuid, uuid, uuid) from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_apply_redemption_to_sale (uuid, uuid, uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_apply_redemption_to_sale (uuid, uuid, uuid) to authenticated';
  end if;
end;
$g$;

comment on function public.loyalty_apply_redemption_to_sale (uuid, uuid, uuid) is
  'Records that a redemption''s monetary benefit was the discount carried by one sale. The '
  'amount is derived from the redemption SNAPSHOT and clamped to sales.discount_ugx — never '
  'taken from the client. One redemption applies once. Refuses a voided redemption, another '
  'shop''s sale, a sale belonging to a different customer, and a non-monetary reward.';

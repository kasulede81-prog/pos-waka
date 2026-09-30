-- ============================================================================
-- LOYALTY PHASE G — SPEND-TRIGGERED PROMOTIONS
-- ============================================================================
-- "Spend UGX 50,000 or more during this period → receive 100 bonus points."
--
-- WHY THIS IS NOT IN `loyalty_customer_offers.config`. That table was the first choice, but
-- every offer row is addressed to ONE `account_id` (NOT NULL, composite FK to the account), so
-- a SHOP-WIDE promotion cannot be expressed there at all — it would mean materialising a row
-- per customer. Making that column nullable would put a NULL case into the resolver the earn
-- engine calls on every award. So the smallest justified structure is its own small table,
-- which the earn engine never sees: `loyalty_spend_promotions` is read only by the trigger
-- below, and cannot change how any existing offer is composed.
--
-- THE EARN ENGINE IS NOT MODIFIED. `loyalty_award_for_sale`, `loyalty_compose_offer_points`
-- and `loyalty_resolve_customer_offers` are untouched, so multiplier/flat-bonus stacking,
-- priority and every existing promotion keep their exact semantics. Nothing here can multiply
-- a multiplier or alter a flat bonus: promotions award their own separate ledger row.
--
-- QUALIFYING SPEND IS READ, NEVER STORED. It is summed on demand from `sales` (completed only)
-- minus `sale_returns` on those same sales, inside the promotion's window. There is no second
-- spending ledger and no counter to drift: a later return reduces FUTURE qualifying spend
-- automatically, and no historical ledger row is ever rewritten.
--
-- IDEMPOTENCY IS THE LEDGER'S OWN UNIQUE INDEX. Each award writes
-- `idempotency_key = 'spend-promo:<promotion>:<account>:<ordinal>'` into
-- `loyalty_transactions`, which already carries `loyalty_tx_idempotency_key_once (shop_id,
-- idempotency_key)`. A duplicate checkout, a retry, a refresh or two simultaneous sales can
-- therefore produce at most one row per ordinal — enforced by the database, never by the
-- client or by a status check. With the default `max_awards = 1` the ordinal is always 1, so
-- the same one-time award can never be paid twice.
--
-- NO CLAWBACK. If a qualifying sale is later returned, the award stands: the points are in an
-- immutable ledger row, and the architecture has no defined rule for taking promotional
-- points back. Phase D remains the merchant-controlled remedy, exactly as with Phase E.

create table if not exists public.loyalty_spend_promotions (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  -- NULL = shop-wide. Non-null is targeted, and the composite FK keeps it inside this shop.
  account_id uuid null,
  title text not null check (char_length (btrim (title)) between 1 and 80),
  threshold_ugx bigint not null check (threshold_ugx > 0),
  bonus_points integer not null check (bonus_points > 0),
  -- One-time by default: a threshold bonus that repeats on every later sale is an open
  -- liability, so the safe value is the default one.
  max_awards integer not null default 1 check (max_awards > 0),
  starts_at timestamptz null,
  ends_at timestamptz null,
  status text not null default 'active' check (status in ('active', 'paused', 'revoked')),
  created_by uuid null references auth.users (id),
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  constraint loyalty_spend_promotions_window_chk
    check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint loyalty_spend_promotions_account_shop_fk
    foreign key (account_id, shop_id) references public.loyalty_accounts (id, shop_id) on delete cascade
);

create index if not exists loyalty_spend_promotions_shop_idx
  on public.loyalty_spend_promotions (shop_id, status, account_id);

comment on table public.loyalty_spend_promotions is
  'Spend-threshold promotions: cumulative NET eligible spend inside the window triggers a '
  'bonus. account_id NULL = shop-wide. Read only by loyalty_apply_spend_promotions (trigger).';

alter table public.loyalty_spend_promotions enable row level security;

drop policy if exists loyalty_spend_promotions_select on public.loyalty_spend_promotions;
create policy loyalty_spend_promotions_select on public.loyalty_spend_promotions
  for select using (public.user_can_access_shop (shop_id));

drop policy if exists loyalty_spend_promotions_insert on public.loyalty_spend_promotions;
create policy loyalty_spend_promotions_insert on public.loyalty_spend_promotions
  for insert with check (public.user_can_manage_shop (shop_id));

drop policy if exists loyalty_spend_promotions_update on public.loyalty_spend_promotions;
create policy loyalty_spend_promotions_update on public.loyalty_spend_promotions
  for update using (public.user_can_manage_shop (shop_id));

-- Same posture as loyalty_rewards: the browser may read and edit, but never delete — a
-- promotion that has awarded points is history. Retire it with status = 'revoked'.
revoke all on public.loyalty_spend_promotions from anon;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select, insert, update on public.loyalty_spend_promotions to authenticated';
    execute 'revoke delete, truncate, references, trigger on public.loyalty_spend_promotions from authenticated';
  end if;
  execute 'revoke delete, truncate, references, trigger on public.loyalty_spend_promotions from public';
end;
$g$;

-- ============================================================================
-- The award path
-- ============================================================================
create or replace function public.loyalty_apply_spend_promotions (p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $fn$
declare
  v_sale public.sales%rowtype;
  v_account public.loyalty_accounts%rowtype;
  v_promo record;
  v_spend bigint;
  v_awards integer;
  v_ordinal integer;
  v_awarded integer := 0;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if not found or v_sale.status <> 'completed' or v_sale.customer_id is null then
    return jsonb_build_object ('ok', true, 'awarded', 0, 'reason', 'not_eligible');
  end if;

  select * into v_account
  from public.loyalty_accounts a
  where a.shop_id = v_sale.shop_id and a.customer_id = v_sale.customer_id;
  if v_account.id is null then
    return jsonb_build_object ('ok', true, 'awarded', 0, 'reason', 'no_account');
  end if;

  for v_promo in
    select p.*
    from public.loyalty_spend_promotions p
    where p.shop_id = v_sale.shop_id
      -- Targeted promotions apply only to the account they name; shop-wide to everyone.
      and (p.account_id is null or p.account_id = v_account.id)
      and p.status = 'active'
      -- The SAME window test the offer engine uses.
      and public.loyalty_offer_window_active (p.status, p.starts_at, p.ends_at, now ())
    for update
  loop
    -- Cumulative NET qualifying spend for this promotion's window, from authoritative sales.
    select
      coalesce((
        select sum (s.total_ugx)
        from public.sales s
        where s.shop_id = v_promo.shop_id
          and s.customer_id = v_sale.customer_id
          and s.status = 'completed'
          and (v_promo.starts_at is null or coalesce (s.completed_at, s.created_at) >= v_promo.starts_at)
          and (v_promo.ends_at is null or coalesce (s.completed_at, s.created_at) < v_promo.ends_at)
      ), 0)
      - coalesce((
        select sum (r.refund_amount_ugx)
        from public.sale_returns r
        join public.sales rs on rs.id = r.sale_id
        where rs.shop_id = v_promo.shop_id
          and rs.customer_id = v_sale.customer_id
          and rs.status = 'completed'
          and (v_promo.starts_at is null or coalesce (rs.completed_at, rs.created_at) >= v_promo.starts_at)
          and (v_promo.ends_at is null or coalesce (rs.completed_at, rs.created_at) < v_promo.ends_at)
      ), 0)
    into v_spend;

    if v_spend < v_promo.threshold_ugx then
      continue;
    end if;

    select count (*) into v_awards
    from public.loyalty_transactions t
    where t.account_id = v_account.id
      and t.cause = 'promotion'
      and t.rule_snapshot ->> 'promotion_id' = v_promo.id::text;

    if v_awards >= v_promo.max_awards then
      continue;
    end if;

    v_ordinal := v_awards + 1;

    begin
      insert into public.loyalty_transactions (
        shop_id, account_id, kind, points, cause,
        idempotency_key, actor, actor_source, rule_snapshot
      )
      values (
        v_promo.shop_id,
        v_account.id,
        'promotional',
        v_promo.bonus_points,
        'promotion',
        -- Deterministic per promotion+account+ordinal: the unique index makes a second award
        -- for the SAME ordinal impossible, whatever the concurrency or the retry.
        'spend-promo:' || v_promo.id::text || ':' || v_account.id::text || ':' || v_ordinal::text,
        auth.uid (),
        'promotion',
        jsonb_build_object (
          'source', 'spend_promotion',
          'promotion_id', v_promo.id,
          'promotion_title', v_promo.title,
          'threshold_ugx', v_promo.threshold_ugx,
          'qualifying_spend_ugx', v_spend,
          'bonus_points', v_promo.bonus_points,
          'award_ordinal', v_ordinal,
          'max_awards', v_promo.max_awards,
          'window_starts_at', v_promo.starts_at,
          'window_ends_at', v_promo.ends_at,
          'awarded_at', now ()
        )
      );
      v_awarded := v_awarded + 1;
    exception when unique_violation then
      -- Somebody awarded this ordinal first (a concurrent sale, a retry). Nothing to do.
      null;
    end;
  end loop;

  return jsonb_build_object ('ok', true, 'awarded', v_awarded);
end;
$fn$;

revoke all on function public.loyalty_apply_spend_promotions (uuid) from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_apply_spend_promotions (uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.loyalty_apply_spend_promotions (uuid) from authenticated';
  end if;
end;
$g$;

-- The trigger: the ONLY change to the award path, and it is additive. The existing award call
-- is untouched; the new one sits in its own exception guard, so a promotion defect can no more
-- break a sale than a loyalty award can (Decision 013).
create or replace function public.trg_loyalty_sales_status ()
returns trigger
language plpgsql
as $function$
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    begin
      perform public.loyalty_award_for_sale (new.id);
    exception when others then
      raise warning 'loyalty award skipped for sale %: %', new.id, sqlerrm;
      begin
        perform public.loyalty_note_award_failure (new.id, sqlerrm, 'award');
      exception when others then
        raise warning 'loyalty failure record skipped for sale %: %', new.id, sqlerrm;
      end;
    end;
    -- Phase G — spend-triggered promotions, after the base award so the account exists.
    begin
      perform public.loyalty_apply_spend_promotions (new.id);
    exception when others then
      raise warning 'spend promotions skipped for sale %: %', new.id, sqlerrm;
    end;
  elsif new.status = 'void'
        and (tg_op = 'INSERT' or old.status is distinct from 'void') then
    begin
      perform public.loyalty_reverse_for_sale (new.id);
    exception when others then
      raise warning 'loyalty void reversal skipped for sale %: %', new.id, sqlerrm;
      begin
        perform public.loyalty_note_award_failure (new.id, sqlerrm, 'reversal');
      exception when others then
        raise warning 'loyalty failure record skipped for sale %: %', new.id, sqlerrm;
      end;
    end;
  end if;
  return new;
end;
$function$;

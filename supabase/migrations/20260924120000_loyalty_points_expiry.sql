-- C3 — Rolling earn-lot POINTS expiry (FIFO).
-- Baseline: C1 membership + C2 reward expiry migrations.
--
-- Default: points_expiry_mode='never'. Existing earned rows keep expires_at NULL
-- (never expire). New earns under rolling_months stamp expires_at (Kampala EOD).
-- Expiry writes immutable kind='expired' rows; never mutates historical txs.
-- FIFO allocations table answers which lots funded redeems/expiries.
-- Decision 013 preserved: finance never blocked by loyalty.

-- ---------- Program config ----------
alter table public.loyalty_programs
  add column if not exists points_expiry_mode text not null default 'never',
  add column if not exists points_expiry_months integer null;

do $chk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'loyalty_programs_points_expiry_mode_chk'
      and conrelid = 'public.loyalty_programs'::regclass
  ) then
    alter table public.loyalty_programs
      add constraint loyalty_programs_points_expiry_mode_chk
      check (points_expiry_mode in ('never', 'rolling_months'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'loyalty_programs_points_expiry_shape_chk'
      and conrelid = 'public.loyalty_programs'::regclass
  ) then
    alter table public.loyalty_programs
      add constraint loyalty_programs_points_expiry_shape_chk
      check (
        (
          points_expiry_mode = 'never'
          and points_expiry_months is null
        )
        or (
          points_expiry_mode = 'rolling_months'
          and points_expiry_months is not null
          and points_expiry_months > 0
        )
      );
  end if;
end;
$chk$;

comment on column public.loyalty_programs.points_expiry_mode is
  'C3: never | rolling_months. Affects NEW earned lots only; never rewrites history.';

-- ---------- Earn-lot expiry stamp (earned rows) ----------
alter table public.loyalty_transactions
  add column if not exists expires_at timestamptz null;

comment on column public.loyalty_transactions.expires_at is
  'C3 exclusive Kampala upper bound for kind=earned. NULL = never expires (grandfather / never mode).';

create index if not exists loyalty_tx_account_expires_idx
  on public.loyalty_transactions (account_id, expires_at)
  where kind = 'earned' and expires_at is not null;

-- ---------- FIFO lot allocations (immutable; no historical tx mutation) ----------
create table if not exists public.loyalty_point_lot_allocations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  account_id uuid not null references public.loyalty_accounts (id) on delete cascade,
  earn_transaction_id uuid not null references public.loyalty_transactions (id) on delete restrict,
  consumer_transaction_id uuid not null references public.loyalty_transactions (id) on delete restrict,
  points integer not null check (points > 0),
  kind text not null check (kind in ('redeemed', 'expired')),
  created_at timestamptz not null default now(),
  unique (earn_transaction_id, consumer_transaction_id)
);

create index if not exists loyalty_lot_alloc_earn_idx
  on public.loyalty_point_lot_allocations (earn_transaction_id);
create index if not exists loyalty_lot_alloc_consumer_idx
  on public.loyalty_point_lot_allocations (consumer_transaction_id);
create index if not exists loyalty_lot_alloc_account_idx
  on public.loyalty_point_lot_allocations (account_id, created_at);

-- At most one expiry consumption per earn lot (full remaining when due).
create unique index if not exists loyalty_lot_alloc_expire_once
  on public.loyalty_point_lot_allocations (earn_transaction_id)
  where kind = 'expired';

alter table public.loyalty_point_lot_allocations enable row level security;

drop policy if exists loyalty_lot_alloc_select on public.loyalty_point_lot_allocations;
create policy loyalty_lot_alloc_select
  on public.loyalty_point_lot_allocations for select
  using (public.user_can_access_shop (shop_id));

revoke all on public.loyalty_point_lot_allocations from anon;
grant select on public.loyalty_point_lot_allocations to authenticated;

comment on table public.loyalty_point_lot_allocations is
  'C3 FIFO: which earn/credit lot funded which redeemed/expired consumer tx. Append-only.';

-- ---------- Remaining capacity for a credit lot ----------
create or replace function public.loyalty_earn_lot_remaining (p_credit_tx_id uuid)
returns integer
language sql
stable
set search_path = public
as $fn$
  select greatest (
    0,
    coalesce((
      select t.points
      from public.loyalty_transactions t
      where t.id = p_credit_tx_id
        and (
          t.kind = 'earned'
          or t.kind = 'promotional'
          or (t.kind = 'adjusted' and t.points > 0)
        )
    ), 0)
    + coalesce((
      select sum(r.points)
      from public.loyalty_transactions r
      where r.reversal_of_id = p_credit_tx_id
        and r.kind = 'reversed'
    ), 0)
    - coalesce((
      select sum(a.points)
      from public.loyalty_point_lot_allocations a
      where a.earn_transaction_id = p_credit_tx_id
    ), 0)
  )::integer;
$fn$;

revoke all on function public.loyalty_earn_lot_remaining (uuid) from public;
grant execute on function public.loyalty_earn_lot_remaining (uuid) to authenticated;

-- Outstanding points still reversible for a sale = remaining on that sale's earn lot.
create or replace function public.loyalty_outstanding_for_sale (p_sale_id uuid)
returns integer
language sql
stable
set search_path = public
as $fn$
  select coalesce((
    select public.loyalty_earn_lot_remaining(t.id)
    from public.loyalty_transactions t
    where t.source_sale_id = p_sale_id
      and t.kind = 'earned'
    order by t.created_at, t.id
    limit 1
  ), 0)::integer;
$fn$;

-- Stamp expires_at for a new earn from current program rule (non-retroactive).
create or replace function public.loyalty_compute_earn_expires_at (
  p_mode text,
  p_months integer,
  p_from timestamptz default now()
)
returns timestamptz
language plpgsql
stable
set search_path = public
as $fn$
declare
  v_mode text := lower(btrim(coalesce(p_mode, 'never')));
  v_from timestamptz := coalesce(p_from, now());
  v_start date;
  v_end date;
begin
  if v_mode is distinct from 'rolling_months' then
    return null;
  end if;
  if p_months is null or p_months <= 0 then
    return null;
  end if;
  v_start := timezone('Africa/Kampala', v_from)::date;
  v_end := (v_start + make_interval(months => p_months))::date;
  return public.loyalty_membership_expires_at_from_date(v_end);
end;
$fn$;

revoke all on function public.loyalty_compute_earn_expires_at (text, integer, timestamptz) from public;

-- FIFO allocate points from oldest credit lots onto a consumer tx.
-- FIFO allocate points from oldest credit lots onto a consumer tx.
drop function if exists public.loyalty_allocate_fifo (uuid, uuid, integer, text, boolean);
drop function if exists public.loyalty_allocate_fifo (uuid, uuid, integer, text, boolean, boolean);

create or replace function public.loyalty_allocate_fifo (
  p_account_id uuid,
  p_consumer_tx_id uuid,
  p_points integer,
  p_kind text,
  p_only_due boolean default false,
  p_strict boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_need integer := p_points;
  v_lot record;
  v_take integer;
  v_shop uuid;
  v_now timestamptz := now();
begin
  if p_points is null or p_points <= 0 then
    return;
  end if;
  if p_kind not in ('redeemed', 'expired') then
    raise exception 'invalid_allocation_kind';
  end if;

  select shop_id into v_shop from public.loyalty_accounts where id = p_account_id;
  if v_shop is null then
    raise exception 'account_not_found';
  end if;

  for v_lot in
    select t.id, public.loyalty_earn_lot_remaining(t.id) as rem, t.expires_at
    from public.loyalty_transactions t
    where t.account_id = p_account_id
      and (
        t.kind = 'earned'
        or t.kind = 'promotional'
        or (t.kind = 'adjusted' and t.points > 0)
      )
      and (
        case
          when p_only_due then
            t.kind = 'earned'
            and t.expires_at is not null
            and v_now >= t.expires_at
          else
            (t.expires_at is null or v_now < t.expires_at)
        end
      )
    order by t.created_at asc, t.id asc
  loop
    exit when v_need <= 0;
    if v_lot.rem is null or v_lot.rem <= 0 then
      continue;
    end if;
    v_take := least(v_need, v_lot.rem);
    insert into public.loyalty_point_lot_allocations (
      shop_id, account_id, earn_transaction_id, consumer_transaction_id, points, kind
    )
    values (v_shop, p_account_id, v_lot.id, p_consumer_tx_id, v_take, p_kind);
    v_need := v_need - v_take;
  end loop;

  -- Default non-strict: used by historical migration backfill callers / tools.
  -- Post-C3 loyalty_redeem_reward passes p_strict := true so new spends must
  -- fully allocate; grandfather gaps must not silently under-allocate.
  if v_need > 0 and coalesce(p_strict, false) then
    raise exception 'loyalty_fifo_shortfall need=% remaining=%', p_points, v_need;
  end if;
end;
$fn$;

revoke all on function public.loyalty_allocate_fifo (uuid, uuid, integer, text, boolean, boolean) from public;
revoke all on function public.loyalty_allocate_fifo (uuid, uuid, integer, text, boolean, boolean) from anon;
revoke all on function public.loyalty_allocate_fifo (uuid, uuid, integer, text, boolean, boolean) from authenticated;

-- Expire all due earn lots for an account (caller must hold account lock).
create or replace function public.loyalty_expire_due_points (p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_account public.loyalty_accounts%rowtype;
  v_lot record;
  v_rem integer;
  v_tx_id uuid;
  v_total integer := 0;
  v_lots integer := 0;
  v_now timestamptz := now();
begin
  select * into v_account
  from public.loyalty_accounts
  where id = p_account_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;

  for v_lot in
    select t.id
    from public.loyalty_transactions t
    where t.account_id = p_account_id
      and t.kind = 'earned'
      and t.expires_at is not null
      and v_now >= t.expires_at
    order by t.created_at asc, t.id asc
  loop
    v_rem := public.loyalty_earn_lot_remaining(v_lot.id);
    if v_rem is null or v_rem <= 0 then
      continue;
    end if;
    -- Cap by live balance so we never go negative (defense in depth).
    if v_account.balance_points < v_rem then
      v_rem := v_account.balance_points;
    end if;
    if v_rem <= 0 then
      exit;
    end if;

    begin
      insert into public.loyalty_transactions (
        shop_id, account_id, kind, points, cause, actor, actor_source,
        rule_snapshot, note
      )
      values (
        v_account.shop_id, v_account.id, 'expired', -v_rem, 'expiration',
        null, 'system',
        jsonb_build_object('earn_transaction_id', v_lot.id, 'policy', 'fifo'),
        'points_expiry'
      )
      returning id into v_tx_id;

      insert into public.loyalty_point_lot_allocations (
        shop_id, account_id, earn_transaction_id, consumer_transaction_id, points, kind
      )
      values (v_account.shop_id, v_account.id, v_lot.id, v_tx_id, v_rem, 'expired');

      v_total := v_total + v_rem;
      v_lots := v_lots + 1;
      select balance_points into v_account.balance_points
      from public.loyalty_accounts where id = p_account_id;
    exception
      when unique_violation then
        -- Concurrent/retry: lot already expired.
        null;
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'expired_points', v_total,
    'lots', v_lots,
    'balance', (select balance_points from public.loyalty_accounts where id = p_account_id)
  );
end;
$fn$;

revoke all on function public.loyalty_expire_due_points (uuid) from public;
revoke all on function public.loyalty_expire_due_points (uuid) from anon;
revoke all on function public.loyalty_expire_due_points (uuid) from authenticated;

-- ---------- Backfill FIFO allocations for pre-C3 redeems (no new ledger rows) ----------
-- Non-strict: shortfalls are left unallocated but MUST be visible via NOTICE.
do $backfill$
declare
  v_account record;
  v_redeem record;
  v_need integer;
  v_lot record;
  v_take integer;
  v_alloc_this integer;
  v_redeemed_tx_count integer := 0;
  v_redeemed_pts integer := 0;
  v_allocated_pts integer := 0;
  v_shortfall_pts integer := 0;
  v_shortfall_accounts text := '';
  v_shortfall_txs text := '';
begin
  for v_account in
    select id, shop_id from public.loyalty_accounts
  loop
    for v_redeem in
      select t.id, abs(t.points) as pts
      from public.loyalty_transactions t
      where t.account_id = v_account.id
        and t.kind = 'redeemed'
        and not exists (
          select 1 from public.loyalty_point_lot_allocations a
          where a.consumer_transaction_id = t.id
        )
      order by t.created_at asc, t.id asc
    loop
      v_redeemed_tx_count := v_redeemed_tx_count + 1;
      v_redeemed_pts := v_redeemed_pts + v_redeem.pts;
      v_need := v_redeem.pts;
      v_alloc_this := 0;
      for v_lot in
        select t.id, public.loyalty_earn_lot_remaining(t.id) as rem
        from public.loyalty_transactions t
        where t.account_id = v_account.id
          and (
            t.kind = 'earned'
            or t.kind = 'promotional'
            or (t.kind = 'adjusted' and t.points > 0)
          )
        order by t.created_at asc, t.id asc
      loop
        exit when v_need <= 0;
        if v_lot.rem is null or v_lot.rem <= 0 then
          continue;
        end if;
        v_take := least(v_need, v_lot.rem);
        insert into public.loyalty_point_lot_allocations (
          shop_id, account_id, earn_transaction_id, consumer_transaction_id, points, kind
        )
        values (v_account.shop_id, v_account.id, v_lot.id, v_redeem.id, v_take, 'redeemed');
        v_need := v_need - v_take;
        v_alloc_this := v_alloc_this + v_take;
      end loop;
      v_allocated_pts := v_allocated_pts + v_alloc_this;
      if v_need > 0 then
        v_shortfall_pts := v_shortfall_pts + v_need;
        if length(v_shortfall_accounts) < 800
           and position(v_account.id::text in v_shortfall_accounts) = 0 then
          v_shortfall_accounts := v_shortfall_accounts || v_account.id::text || ',';
        end if;
        if length(v_shortfall_txs) < 1200 then
          v_shortfall_txs := v_shortfall_txs || v_redeem.id::text || ',';
        end if;
      end if;
    end loop;
  end loop;

  raise notice
    'C3 FIFO backfill: redeemed_transactions=% redeemed_points=% allocated_points=% shortfall_points=%',
    v_redeemed_tx_count, v_redeemed_pts, v_allocated_pts, v_shortfall_pts;
  if v_shortfall_pts > 0 then
    raise notice
      'C3 FIFO backfill shortfalls: accounts=% txs=%',
      nullif(rtrim(v_shortfall_accounts, ','), ''),
      nullif(rtrim(v_shortfall_txs, ','), '');
  end if;
end;
$backfill$;

-- ---------- Award: stamp expires_at on NEW earned rows only ----------
create or replace function public.loyalty_award_for_sale (p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale public.sales%rowtype;
  v_program public.loyalty_programs%rowtype;
  v_account public.loyalty_accounts%rowtype;
  v_account_id uuid;
  v_tx_id uuid;
  v_points integer;
  v_eligible bigint;
  v_new boolean := false;
  v_expires timestamptz;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'sale_not_found');
  end if;
  if v_sale.status is distinct from 'completed' then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'sale_not_completed');
  end if;
  if v_sale.customer_id is null then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'no_customer');
  end if;

  select * into v_program from public.loyalty_programs where shop_id = v_sale.shop_id;
  if not found or not v_program.enabled then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'program_disabled');
  end if;

  insert into public.loyalty_accounts (shop_id, customer_id, enrolled_by)
  values (v_sale.shop_id, v_sale.customer_id, auth.uid ())
  on conflict (shop_id, customer_id) do nothing
  returning id into v_account_id;
  if v_account_id is not null then
    v_new := true;
    perform public.loyalty_stamp_new_account_membership(v_account_id, v_sale.shop_id);
  else
    select id into v_account_id
    from public.loyalty_accounts
    where shop_id = v_sale.shop_id and customer_id = v_sale.customer_id;
  end if;

  select * into v_account from public.loyalty_accounts where id = v_account_id;

  if not public.loyalty_account_membership_active(v_account.status, v_account.membership_expires_at, now()) then
    return jsonb_build_object(
      'ok', true,
      'awarded', false,
      'reason', 'membership_expired',
      'account_id', v_account_id
    );
  end if;

  v_eligible := greatest (v_sale.total_ugx - v_program.min_eligible_spend_ugx, 0);
  v_points := (v_eligible / v_program.earn_unit_ugx) * v_program.earn_points_per_unit;

  if v_points <= 0 then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'below_threshold', 'account_id', v_account_id);
  end if;

  v_expires := public.loyalty_compute_earn_expires_at(
    v_program.points_expiry_mode,
    v_program.points_expiry_months,
    now()
  );

  begin
    insert into public.loyalty_transactions (
      shop_id, account_id, kind, points, cause, source_sale_id,
      rule_snapshot, actor, actor_source, expires_at
    )
    values (
      v_sale.shop_id, v_account_id, 'earned', v_points, 'sale', v_sale.id,
      jsonb_build_object(
        'rule_kind', v_program.rule_kind,
        'earn_unit_ugx', v_program.earn_unit_ugx,
        'earn_points_per_unit', v_program.earn_points_per_unit,
        'eligible_spend_ugx', v_eligible,
        'points_expiry_mode', v_program.points_expiry_mode,
        'points_expiry_months', v_program.points_expiry_months
      ),
      auth.uid (), 'system', v_expires
    )
    returning id into v_tx_id;
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'already_awarded', 'account_id', v_account_id);
  end;

  perform public.loyalty_apply_pending_reversals(v_sale.id);

  return jsonb_build_object(
    'ok', true,
    'awarded', true,
    'points', v_points,
    'transaction_id', v_tx_id,
    'account_id', v_account_id,
    'new_account', v_new,
    'expires_at', v_expires
  );
end;
$function$;

revoke all on function public.loyalty_award_for_sale (uuid) from public;
revoke all on function public.loyalty_award_for_sale (uuid) from anon;
revoke all on function public.loyalty_award_for_sale (uuid) from authenticated;

-- ---------- Reverse for return (cap by remaining after FIFO allocations) ----------
create or replace function public.loyalty_reverse_for_return (p_return_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_return public.sale_returns%rowtype;
  v_program public.loyalty_programs%rowtype;
  v_account_id uuid;
  v_earned_id uuid;
  v_points integer;
  v_outstanding integer;
  v_tx_id uuid;
begin
  select * into v_return from public.sale_returns where id = p_return_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'return_not_found');
  end if;
  if v_return.sale_id is null then
    return jsonb_build_object('ok', true, 'reversed', false, 'reason', 'return_not_linked_to_sale');
  end if;

  select * into v_program from public.loyalty_programs where shop_id = v_return.shop_id;
  if not found then
    return jsonb_build_object('ok', true, 'reversed', false, 'reason', 'no_program');
  end if;

  if exists (
    select 1 from public.loyalty_transactions
    where shop_id = v_return.shop_id
      and kind = 'reversed'
      and source_return_id = v_return.id
  ) then
    return jsonb_build_object('ok', true, 'reversed', false, 'reason', 'already_reversed');
  end if;

  select t.id, t.account_id into v_earned_id, v_account_id
  from public.loyalty_transactions t
  where t.shop_id = v_return.shop_id
    and t.kind = 'earned'
    and t.source_sale_id = v_return.sale_id
  limit 1;

  if v_earned_id is null then
    return jsonb_build_object('ok', true, 'reversed', false, 'reason', 'no_earned_row');
  end if;

  -- Remaining respects reversals + FIFO redeem/expire allocations (C3).
  v_outstanding := public.loyalty_outstanding_for_sale(v_return.sale_id);
  if v_outstanding <= 0 then
    return jsonb_build_object('ok', true, 'reversed', false, 'reason', 'nothing_outstanding');
  end if;

  v_points := (v_return.refund_amount_ugx / v_program.earn_unit_ugx) * v_program.earn_points_per_unit;
  v_points := least (greatest (v_points, 0), v_outstanding);
  -- Never drive account balance negative (Decision 013: finance already committed).
  v_points := least (
    v_points,
    greatest(0, (select balance_points from public.loyalty_accounts where id = v_account_id))
  );
  if v_points <= 0 then
    return jsonb_build_object('ok', true, 'reversed', false, 'reason', 'below_unit');
  end if;

  begin
    insert into public.loyalty_transactions (
      shop_id, account_id, kind, points, cause,
      source_sale_id, source_return_id, reversal_of_id,
      rule_snapshot, actor, actor_source
    )
    values (
      v_return.shop_id, v_account_id, 'reversed', -v_points, 'return',
      v_return.sale_id, v_return.id, v_earned_id,
      jsonb_build_object(
        'rule_kind', v_program.rule_kind,
        'earn_unit_ugx', v_program.earn_unit_ugx,
        'refund_amount_ugx', v_return.refund_amount_ugx
      ),
      auth.uid (), 'system'
    )
    returning id into v_tx_id;
  exception when check_violation then
    return jsonb_build_object('ok', true, 'reversed', false, 'reason', 'balance_floor');
  end;

  return jsonb_build_object('ok', true, 'reversed', true, 'points', -v_points, 'transaction_id', v_tx_id);
end;
$function$;

create or replace function public.loyalty_reverse_for_sale (p_sale_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_earned public.loyalty_transactions%rowtype;
  v_outstanding integer;
  v_points integer;
  v_void_id uuid;
begin
  select * into v_earned
  from public.loyalty_transactions
  where kind = 'earned' and source_sale_id = p_sale_id
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'reversed', false, 'reason', 'no_earned_row');
  end if;

  if exists (
    select 1 from public.loyalty_transactions
    where kind = 'reversed' and source_sale_id = p_sale_id and source_return_id is null
  ) then
    return jsonb_build_object('ok', true, 'reversed', false, 'reason', 'already_reversed');
  end if;

  v_outstanding := public.loyalty_outstanding_for_sale(p_sale_id);
  if v_outstanding <= 0 then
    return jsonb_build_object('ok', true, 'reversed', false, 'reason', 'nothing_outstanding');
  end if;
  v_points := least (v_earned.points, v_outstanding);
  v_points := least (
    v_points,
    greatest(0, (select balance_points from public.loyalty_accounts where id = v_earned.account_id))
  );
  if v_points <= 0 then
    return jsonb_build_object('ok', true, 'reversed', false, 'reason', 'nothing_outstanding');
  end if;

  select id into v_void_id
  from public.sale_voids
  where sale_id = p_sale_id
  order by created_at asc
  limit 1;

  begin
    insert into public.loyalty_transactions (
      shop_id, account_id, kind, points, cause,
      source_sale_id, source_void_id, reversal_of_id,
      actor, actor_source, note
    )
    values (
      v_earned.shop_id, v_earned.account_id, 'reversed', -v_points, 'void',
      p_sale_id, v_void_id, v_earned.id,
      auth.uid (), 'system', p_note
    );
  exception when check_violation then
    return jsonb_build_object('ok', true, 'reversed', false, 'reason', 'balance_floor');
  end;

  return jsonb_build_object('ok', true, 'reversed', true, 'points', -v_points);
end;
$function$;

-- ---------- Redeem: C2 order + C3 due-point expiry + FIFO redeem allocation ----------
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
  if v_account.status <> 'active' then
    return jsonb_build_object ('ok', false, 'error', 'account_disabled');
  end if;
  if not public.loyalty_account_membership_active(v_account.status, v_account.membership_expires_at, now()) then
    return jsonb_build_object ('ok', false, 'error', 'membership_expired');
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
  if not public.loyalty_reward_unexpired(v_reward.expires_on, now()) then
    return jsonb_build_object ('ok', false, 'error', 'reward_expired');
  end if;

  -- C3: expire due points under the same account lock before balance decision.
  perform public.loyalty_expire_due_points(v_account.id);
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

  -- Post-C3 redemptions: strict FIFO (full allocation required). Historical
  -- migration backfill remains non-strict and does not call this path.
  perform public.loyalty_allocate_fifo(
    v_account.id, v_tx_id, v_reward.points_required, 'redeemed', false, true
  );

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

-- ---------- Program update (+ points expiry; drop prior 8-arg overload) ----------
drop function if exists public.loyalty_update_program (
  uuid, boolean, bigint, integer, bigint, text, date, integer
);

create or replace function public.loyalty_update_program (
  p_shop_id uuid,
  p_enabled boolean,
  p_earn_unit_ugx bigint,
  p_earn_points_per_unit integer,
  p_min_eligible_spend_ugx bigint,
  p_membership_expiry_mode text default 'never',
  p_membership_fixed_expires_on date default null,
  p_membership_duration_months integer default null,
  p_points_expiry_mode text default 'never',
  p_points_expiry_months integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_mode text := lower(btrim(coalesce(p_membership_expiry_mode, 'never')));
  v_fixed date := p_membership_fixed_expires_on;
  v_months integer := p_membership_duration_months;
  v_pts_mode text := lower(btrim(coalesce(p_points_expiry_mode, 'never')));
  v_pts_months integer := p_points_expiry_months;
begin
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_earn_unit_ugx is null or p_earn_unit_ugx <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_earn_unit');
  end if;
  if p_earn_points_per_unit is null or p_earn_points_per_unit <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_points_per_unit');
  end if;
  if p_min_eligible_spend_ugx is null or p_min_eligible_spend_ugx < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_min_spend');
  end if;

  if v_mode not in ('never', 'fixed_date', 'duration') then
    return jsonb_build_object('ok', false, 'error', 'invalid_membership_mode');
  end if;
  if v_mode = 'never' then
    v_fixed := null;
    v_months := null;
  elsif v_mode = 'fixed_date' then
    if v_fixed is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_membership_fixed_date');
    end if;
    v_months := null;
  elsif v_mode = 'duration' then
    if v_months is null or v_months <= 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid_membership_duration');
    end if;
    v_fixed := null;
  end if;

  if v_pts_mode not in ('never', 'rolling_months') then
    return jsonb_build_object('ok', false, 'error', 'invalid_points_expiry_mode');
  end if;
  if v_pts_mode = 'never' then
    v_pts_months := null;
  elsif v_pts_months is null or v_pts_months <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_points_expiry_months');
  end if;

  insert into public.loyalty_programs (
    shop_id, enabled, earn_unit_ugx, earn_points_per_unit, min_eligible_spend_ugx,
    membership_expiry_mode, membership_fixed_expires_on, membership_duration_months,
    points_expiry_mode, points_expiry_months
  )
  values (
    p_shop_id, coalesce(p_enabled, false), p_earn_unit_ugx,
    p_earn_points_per_unit, p_min_eligible_spend_ugx,
    v_mode, v_fixed, v_months,
    v_pts_mode, v_pts_months
  )
  on conflict (shop_id) do update
  set enabled = coalesce(p_enabled, false),
      earn_unit_ugx = p_earn_unit_ugx,
      earn_points_per_unit = p_earn_points_per_unit,
      min_eligible_spend_ugx = p_min_eligible_spend_ugx,
      membership_expiry_mode = v_mode,
      membership_fixed_expires_on = v_fixed,
      membership_duration_months = v_months,
      points_expiry_mode = v_pts_mode,
      points_expiry_months = v_pts_months;
  -- Intentionally does NOT rewrite historical earn expires_at or membership_expires_at.

  return jsonb_build_object('ok', true);
end;
$function$;

grant execute on function public.loyalty_update_program (
  uuid, boolean, bigint, integer, bigint, text, date, integer, text, integer
) to authenticated;

-- Overview exposes points expiry config
create or replace function public.loyalty_shop_overview (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_result jsonb;
begin
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select jsonb_build_object(
    'ok', true,
    'program', (
      select jsonb_build_object(
        'enabled', p.enabled,
        'earn_unit_ugx', p.earn_unit_ugx,
        'earn_points_per_unit', p.earn_points_per_unit,
        'min_eligible_spend_ugx', p.min_eligible_spend_ugx,
        'rule_kind', p.rule_kind,
        'membership_expiry_mode', p.membership_expiry_mode,
        'membership_fixed_expires_on', p.membership_fixed_expires_on,
        'membership_duration_months', p.membership_duration_months,
        'points_expiry_mode', p.points_expiry_mode,
        'points_expiry_months', p.points_expiry_months,
        'updated_at', p.updated_at
      )
      from public.loyalty_programs p
      where p.shop_id = p_shop_id
    ),
    'members_total', (
      select count(*) from public.loyalty_accounts a where a.shop_id = p_shop_id
    ),
    'members_active', (
      select count(*) from public.loyalty_accounts a
      where a.shop_id = p_shop_id
        and public.loyalty_account_membership_active(a.status, a.membership_expires_at, now())
    ),
    'points_issued', (
      select coalesce(sum(t.points), 0)
      from public.loyalty_transactions t
      where t.shop_id = p_shop_id and t.points > 0
    ),
    'points_redeemed', (
      select coalesce(-sum(t.points), 0)
      from public.loyalty_transactions t
      where t.shop_id = p_shop_id and t.kind in ('redeemed', 'expired')
    ),
    'points_reversed', (
      select coalesce(-sum(t.points), 0)
      from public.loyalty_transactions t
      where t.shop_id = p_shop_id and t.kind = 'reversed'
    ),
    'recent_activity', (
      select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb)
      from (
        select
          t.id, t.account_id, t.kind, t.points, t.balance_after, t.cause, t.note,
          t.created_at, c.name as customer_name
        from public.loyalty_transactions t
        join public.loyalty_accounts a on a.id = t.account_id
        join public.customers c on c.id = a.customer_id
        where t.shop_id = p_shop_id
        order by t.created_at desc
        limit 10
      ) x
    )
  )
  into v_result;

  return v_result;
end;
$function$;

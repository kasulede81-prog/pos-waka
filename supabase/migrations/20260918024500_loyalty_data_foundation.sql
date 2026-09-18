-- Waka POS — Loyalty data foundation (Phase 02)
--
-- Auditable multi-merchant loyalty layer. Design decisions (see
-- docs/waka-loyalty-prompts/docs/loyalty/DECISIONS.md):
--   003/011 — immutable ledger; reversals are new rows, never deletes
--   007/010 — idempotency enforced in the DB: partial unique indexes make a
--             source sale able to produce at most one 'earned' row and at most
--             one reversal per return/void, and awards fire from the
--             sales status -> 'completed' transition trigger
--   009     — legacy customers.loyalty_points is NEVER written by this system
--   012     — customer hard-delete cascades to their loyalty history (WAKA
--             already hard-deletes customers by design; the ledger does not
--             outlive the customer it belongs to)
--
-- Money is integer bigint UGX throughout (same representation as sales).
-- Points are integers with a sign convention:
--   earned / promotional / positive adjusted  -> positive
--   redeemed / reversed / expired / negative adjusted -> negative
-- Invariant: balance_points = lifetime_earned_points - lifetime_redeemed_points.

-- ---------- loyalty_programs (one per shop) ----------
create table if not exists public.loyalty_programs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null unique references public.shops (id) on delete cascade,
  enabled boolean not null default false,
  -- Spend rule: points = floor(eligible_spend_ugx / earn_unit_ugx) * earn_points_per_unit
  earn_unit_ugx bigint not null default 1000 check (earn_unit_ugx > 0),
  earn_points_per_unit integer not null default 1 check (earn_points_per_unit > 0),
  min_eligible_spend_ugx bigint not null default 0 check (min_eligible_spend_ugx >= 0),
  -- Future rule extensibility without checkout hard-coding (visit/product/promo).
  rule_kind text not null default 'spend' check (rule_kind in ('spend', 'visit', 'product', 'promotional')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_loyalty_programs_updated on public.loyalty_programs;
create trigger trg_loyalty_programs_updated
  before update on public.loyalty_programs
  for each row execute function public.set_updated_at ();

-- ---------- loyalty_accounts (membership; one per shop + customer) ----------
create table if not exists public.loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'disabled')),
  -- Cached counters; the ledger in loyalty_transactions is the audit source.
  balance_points integer not null default 0,
  lifetime_earned_points integer not null default 0,
  lifetime_redeemed_points integer not null default 0,
  -- Opaque identification token for QR passes (never sequential, never a
  -- customer id — scanning it identifies the account without leaking data).
  qr_token text not null unique default md5 (random ()::text || clock_timestamp ()::text),
  enrolled_at timestamptz not null default now(),
  enrolled_by uuid references auth.users (id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, customer_id)
);

create index if not exists loyalty_accounts_shop_idx on public.loyalty_accounts (shop_id);
create index if not exists loyalty_accounts_customer_idx on public.loyalty_accounts (customer_id);

drop trigger if exists trg_loyalty_accounts_updated on public.loyalty_accounts;
create trigger trg_loyalty_accounts_updated
  before update on public.loyalty_accounts
  for each row execute function public.set_updated_at ();

-- ---------- loyalty_transactions (immutable auditable ledger) ----------
create table if not exists public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  account_id uuid not null references public.loyalty_accounts (id) on delete cascade,
  kind text not null check (kind in ('earned', 'redeemed', 'reversed', 'expired', 'adjusted', 'promotional')),
  points integer not null check (points <> 0),
  balance_after integer,
  cause text not null default 'sale' check (
    cause in ('sale', 'return', 'void', 'redemption', 'expiration', 'manual_adjustment', 'promotion', 'enrollment')
  ),
  source_sale_id uuid references public.sales (id) on delete set null,
  source_return_id uuid references public.sale_returns (id) on delete set null,
  source_void_id uuid references public.sale_voids (id) on delete set null,
  reversal_of_id uuid references public.loyalty_transactions (id) on delete restrict,
  rule_snapshot jsonb not null default '{}'::jsonb,
  idempotency_key text,
  actor uuid references auth.users (id),
  actor_source text not null default 'system' check (actor_source in ('system', 'staff', 'customer', 'promotion', 'admin')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists loyalty_transactions_account_idx
  on public.loyalty_transactions (account_id, created_at desc);
create index if not exists loyalty_transactions_shop_idx
  on public.loyalty_transactions (shop_id, created_at desc);
create index if not exists loyalty_transactions_sale_idx
  on public.loyalty_transactions (source_sale_id) where source_sale_id is not null;

-- Idempotency (Decision 007): at most one earned row per source sale,
-- at most one reversal per source sale (void path) and per source return.
create unique index if not exists loyalty_tx_earn_sale_once
  on public.loyalty_transactions (shop_id, source_sale_id)
  where kind = 'earned';
create unique index if not exists loyalty_tx_reversal_sale_once
  on public.loyalty_transactions (shop_id, source_sale_id)
  where kind = 'reversed' and source_return_id is null;
create unique index if not exists loyalty_tx_reversal_return_once
  on public.loyalty_transactions (shop_id, source_return_id)
  where kind = 'reversed' and source_return_id is not null;
create unique index if not exists loyalty_tx_idempotency_key_once
  on public.loyalty_transactions (shop_id, idempotency_key)
  where idempotency_key is not null;

-- ---------- Cached balance maintenance ----------
-- BEFORE insert so balance_after can be stamped on the ledger row itself.
create or replace function public.trg_loyalty_tx_balance ()
returns trigger
language plpgsql
as $function$
declare
  v_balance integer;
begin
  update public.loyalty_accounts
  set balance_points = balance_points + new.points,
      lifetime_earned_points = lifetime_earned_points + greatest (new.points, 0),
      lifetime_redeemed_points = lifetime_redeemed_points + greatest (-new.points, 0)
  where id = new.account_id
  returning balance_points into v_balance;

  if v_balance is null then
    raise exception 'loyalty account % does not exist', new.account_id;
  end if;

  new.balance_after := v_balance;
  return new;
end;
$function$;

drop trigger if exists trg_loyalty_tx_balance on public.loyalty_transactions;
create trigger trg_loyalty_tx_balance
  before insert on public.loyalty_transactions
  for each row execute function public.trg_loyalty_tx_balance ();

-- ---------- Award engine ----------
create or replace function public.loyalty_award_for_sale (p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale public.sales%rowtype;
  v_program public.loyalty_programs%rowtype;
  v_account_id uuid;
  v_tx_id uuid;
  v_points integer;
  v_eligible bigint;
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

  -- Membership is implicit on first qualifying sale (no separate enrollment
  -- step required to start earning).
  insert into public.loyalty_accounts (shop_id, customer_id, enrolled_by)
  values (v_sale.shop_id, v_sale.customer_id, auth.uid ())
  on conflict (shop_id, customer_id) do nothing
  returning id into v_account_id;
  if v_account_id is null then
    select id into v_account_id
    from public.loyalty_accounts
    where shop_id = v_sale.shop_id and customer_id = v_sale.customer_id;
  end if;

  v_eligible := greatest (v_sale.total_ugx - v_program.min_eligible_spend_ugx, 0);
  v_points := (v_eligible / v_program.earn_unit_ugx) * v_program.earn_points_per_unit;

  if v_points <= 0 then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'below_threshold', 'account_id', v_account_id);
  end if;

  begin
    insert into public.loyalty_transactions (
      shop_id, account_id, kind, points, cause, source_sale_id,
      rule_snapshot, actor, actor_source
    )
    values (
      v_sale.shop_id, v_account_id, 'earned', v_points, 'sale', v_sale.id,
      jsonb_build_object(
        'rule_kind', v_program.rule_kind,
        'earn_unit_ugx', v_program.earn_unit_ugx,
        'earn_points_per_unit', v_program.earn_points_per_unit,
        'eligible_spend_ugx', v_eligible
      ),
      auth.uid (), 'system'
    )
    returning id into v_tx_id;
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'already_awarded', 'account_id', v_account_id);
  end;

  -- Offline ordering gap: returns/voids can sync before the sale they belong
  -- to. Apply any already-known reversals immediately so points never stand
  -- awarded against a refunded/voided sale. Reversal fns are idempotent.
  perform public.loyalty_apply_pending_reversals(v_sale.id);

  return jsonb_build_object('ok', true, 'awarded', true, 'points', v_points, 'transaction_id', v_tx_id, 'account_id', v_account_id);
end;
$function$;

-- ---------- Reversal engine ----------
-- Outstanding = earned points for the sale minus everything already reversed.
create or replace function public.loyalty_outstanding_for_sale (p_sale_id uuid)
returns integer
language sql
stable
set search_path to 'public'
as $function$
  select coalesce (sum(points), 0)::integer
  from public.loyalty_transactions
  where source_sale_id = p_sale_id
    and kind in ('earned', 'reversed');
$function$;

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

  -- Idempotency: a return reverses at most once across retries/restarts.
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

  v_outstanding := public.loyalty_outstanding_for_sale(v_return.sale_id);
  if v_outstanding <= 0 then
    return jsonb_build_object('ok', true, 'reversed', false, 'reason', 'nothing_outstanding');
  end if;

  v_points := (v_return.refund_amount_ugx / v_program.earn_unit_ugx) * v_program.earn_points_per_unit;
  v_points := least (greatest (v_points, 0), v_outstanding);
  if v_points <= 0 then
    return jsonb_build_object('ok', true, 'reversed', false, 'reason', 'below_unit');
  end if;

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

  -- Cap at what is still outstanding so a void after partial returns can
  -- never reverse more points than the sale originally earned.
  v_outstanding := public.loyalty_outstanding_for_sale(p_sale_id);
  if v_outstanding <= 0 then
    return jsonb_build_object('ok', true, 'reversed', false, 'reason', 'nothing_outstanding');
  end if;
  v_points := least (v_earned.points, v_outstanding);

  -- sale_voids is line-level (one row per voided line); link the reversal to
  -- at most one of them — the ledger reversal itself is per-sale, not per-line.
  select id into v_void_id
  from public.sale_voids
  where sale_id = p_sale_id
  order by created_at asc
  limit 1;

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

  return jsonb_build_object('ok', true, 'reversed', true, 'points', -v_points);
end;
$function$;

-- Applies all known returns/voids for a sale. Called by the award RPC to
-- close the offline ordering gap; idempotent via unique indexes + caps.
create or replace function public.loyalty_apply_pending_reversals (p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_return record;
  v_void record;
begin
  for v_return in
    select id from public.sale_returns where sale_id = p_sale_id
  loop
    perform public.loyalty_reverse_for_return(v_return.id);
  end loop;

  select id into v_void from public.sale_voids where sale_id = p_sale_id limit 1;
  if v_void.id is not null then
    perform public.loyalty_reverse_for_sale(p_sale_id);
  end if;
end;
$function$;

-- ---------- Client-facing RPCs ----------
-- Idempotent enrollment (works for offline-created customers syncing later).
create or replace function public.loyalty_enroll_customer (p_shop_id uuid, p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_account public.loyalty_accounts%rowtype;
begin
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not exists (
    select 1 from public.customers where id = p_customer_id and shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'customer_not_in_shop');
  end if;

  insert into public.loyalty_accounts (shop_id, customer_id, enrolled_by)
  values (p_shop_id, p_customer_id, auth.uid ())
  on conflict (shop_id, customer_id) do nothing
  returning id into v_account_id;

  if v_account_id is null then
    select * into v_account
    from public.loyalty_accounts
    where shop_id = p_shop_id and customer_id = p_customer_id;
  else
    select * into v_account from public.loyalty_accounts where id = v_account_id;
  end if;

  return jsonb_build_object('ok', true, 'account_id', v_account.id, 'qr_token', v_account.qr_token, 'already_enrolled', v_account_id is null);
end;
$function$;

-- Manual adjustment (manager+ only). Points may be positive or negative.
create or replace function public.loyalty_adjust_points (p_account_id uuid, p_points integer, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account public.loyalty_accounts%rowtype;
  v_tx_id uuid;
begin
  select * into v_account from public.loyalty_accounts where id = p_account_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;
  if not public.user_can_manage_shop (v_account.shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_points is null or p_points = 0 then
    return jsonb_build_object('ok', false, 'error', 'points_required');
  end if;

  insert into public.loyalty_transactions (
    shop_id, account_id, kind, points, cause, actor, actor_source, note
  )
  values (
    v_account.shop_id, v_account.id, 'adjusted', p_points, 'manual_adjustment',
    auth.uid (), 'staff', p_note
  )
  returning id into v_tx_id;

  return jsonb_build_object('ok', true, 'transaction_id', v_tx_id, 'balance', v_account.balance_points + p_points);
end;
$function$;

-- ---------- Award / reversal triggers on the financial tables ----------
-- Loyalty must NEVER block a financial write: every trigger body is wrapped
-- so a loyalty failure logs a warning and lets the sale/return/void proceed.
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
    end;
  elsif new.status = 'void'
        and (tg_op = 'INSERT' or old.status is distinct from 'void') then
    begin
      perform public.loyalty_reverse_for_sale (new.id);
    exception when others then
      raise warning 'loyalty void reversal skipped for sale %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_loyalty_sales_status on public.sales;
create trigger trg_loyalty_sales_status
  after insert or update of status on public.sales
  for each row execute function public.trg_loyalty_sales_status ();

create or replace function public.trg_loyalty_sale_returns ()
returns trigger
language plpgsql
as $function$
begin
  begin
    perform public.loyalty_reverse_for_return (new.id);
  exception when others then
    raise warning 'loyalty return reversal skipped for return %: %', new.id, sqlerrm;
  end;
  return new;
end;
$function$;

drop trigger if exists trg_loyalty_sale_returns on public.sale_returns;
create trigger trg_loyalty_sale_returns
  after insert on public.sale_returns
  for each row execute function public.trg_loyalty_sale_returns ();

create or replace function public.trg_loyalty_sale_voids ()
returns trigger
language plpgsql
as $function$
begin
  if new.sale_id is not null then
    begin
      perform public.loyalty_reverse_for_sale (new.sale_id);
    exception when others then
      raise warning 'loyalty void reversal skipped for void %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_loyalty_sale_voids on public.sale_voids;
create trigger trg_loyalty_sale_voids
  after insert on public.sale_voids
  for each row execute function public.trg_loyalty_sale_voids ();

-- ---------- RLS (mirrors the customers policy pattern) ----------
alter table public.loyalty_programs enable row level security;
alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_transactions enable row level security;

drop policy if exists loyalty_programs_select on public.loyalty_programs;
create policy loyalty_programs_select
  on public.loyalty_programs for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists loyalty_programs_write on public.loyalty_programs;
create policy loyalty_programs_write
  on public.loyalty_programs for insert
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists loyalty_programs_update on public.loyalty_programs;
create policy loyalty_programs_update
  on public.loyalty_programs for update
  using (public.user_can_manage_shop (shop_id));

drop policy if exists loyalty_accounts_select on public.loyalty_accounts;
create policy loyalty_accounts_select
  on public.loyalty_accounts for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists loyalty_accounts_write on public.loyalty_accounts;
create policy loyalty_accounts_write
  on public.loyalty_accounts for insert
  with check (public.user_is_cashier_or_above (shop_id));

drop policy if exists loyalty_accounts_update on public.loyalty_accounts;
create policy loyalty_accounts_update
  on public.loyalty_accounts for update
  using (public.user_can_manage_shop (shop_id));

drop policy if exists loyalty_transactions_select on public.loyalty_transactions;
create policy loyalty_transactions_select
  on public.loyalty_transactions for select
  using (public.user_can_access_shop (shop_id));

-- Ledger writes are server-only: no insert/update/delete policies. All
-- writes go through the security-definer functions above, which bypass RLS
-- as function owner — clients can never credit points themselves
-- (Decision: do not trust client-submitted points).

-- ---------- Grants / revokes ----------
-- Supabase default privileges grant public tables to anon + authenticated;
-- lock anon out explicitly (same hardening pattern as 184/185).
revoke all on public.loyalty_programs from anon;
revoke all on public.loyalty_accounts from anon;
revoke all on public.loyalty_transactions from anon;

grant select on public.loyalty_programs to authenticated;
grant select on public.loyalty_accounts to authenticated;
grant select on public.loyalty_transactions to authenticated;
grant insert on public.loyalty_accounts to authenticated;

grant execute on function public.loyalty_enroll_customer (uuid, uuid) to authenticated;
grant execute on function public.loyalty_adjust_points (uuid, integer, text) to authenticated;

-- ---------- Internal admin reset integration ----------
-- A full shop reset wipes business history deliberately; loyalty ledger and
-- accounts go with it (transactions first — the ledger's account FK and the
-- accounts' customer FK must not block the wipe), while the program config
-- (loyalty_programs) is shop configuration and survives, like shop settings.
-- Definitions reproduced from 196 (current live state) with only the
-- loyalty additions, following that migration's own convention.

create or replace function public.admin_shop_reset_preview_counts(p_shop_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not public.is_waka_internal_role(array['super_admin','operations_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  return jsonb_build_object(
    'products', (select count(*) from public.products where shop_id = p_shop_id),
    'inventory_movements', (select count(*) from public.inventory_movements where shop_id = p_shop_id),
    'sales', (select count(*) from public.sales where shop_id = p_shop_id),
    'sale_line_items', (select count(*) from public.sale_line_items sli join public.sales s on s.id = sli.sale_id where s.shop_id = p_shop_id),
    'sale_payments', (select count(*) from public.sale_payments sp join public.sales s on s.id = sp.sale_id where s.shop_id = p_shop_id),
    'sale_voids', (select count(*) from public.sale_voids where shop_id = p_shop_id),
    'sale_returns', (select count(*) from public.sale_returns where shop_id = p_shop_id),
    'receipts', (select count(*) from public.receipts where shop_id = p_shop_id),
    'customers', (select count(*) from public.customers where shop_id = p_shop_id),
    'customer_debt_payments', (select count(*) from public.customer_debt_payments where shop_id = p_shop_id),
    'audit_logs', (select count(*) from public.audit_logs where shop_id = p_shop_id),
    'ai_generation_usage_log', (select count(*) from public.ai_generation_usage_log where shop_id = p_shop_id),
    'shop_day_closes', (select count(*) from public.shop_day_closes where shop_id = p_shop_id),
    'shop_day_drawer_opens', (select count(*) from public.shop_day_drawer_opens where shop_id = p_shop_id),
    'shop_shifts', (select count(*) from public.shop_shifts where shop_id = p_shop_id),
    'shop_purchases', (select count(*) from public.shop_purchases where shop_id = p_shop_id),
    'shop_supplier_payments', (select count(*) from public.shop_supplier_payments where shop_id = p_shop_id),
    'shop_cash_drawer_adjustments', (select count(*) from public.shop_cash_drawer_adjustments where shop_id = p_shop_id),
    'shop_inventory_count_sessions', (select count(*) from public.shop_inventory_count_sessions where shop_id = p_shop_id),
    'shop_cloud_snapshots', (select count(*) from public.shop_cloud_snapshots where shop_id = p_shop_id),
    'financial_correction_requests', (select count(*) from public.financial_correction_requests where shop_id = p_shop_id),
    'sale_line_item_corrections', (select count(*) from public.sale_line_item_corrections where shop_id = p_shop_id),
    'loyalty_transactions', (select count(*) from public.loyalty_transactions where shop_id = p_shop_id),
    'loyalty_accounts', (select count(*) from public.loyalty_accounts where shop_id = p_shop_id)
  );
end;
$function$;

create or replace function public.admin_reset_shop_business_data(p_shop_id uuid, p_phase text DEFAULT 'preview'::text, p_confirmation text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phase text := lower(trim(coalesce(p_phase, 'preview')));
  v_confirm text := upper(trim(coalesce(p_confirmation, '')));
  v_shop_name text;
  v_shop_number text;
  v_before jsonb;
  v_after jsonb;
  v_deleted jsonb;
  v_reset_at timestamptz := now();
  n_sale_line_items int := 0;
  n_sale_payments int := 0;
  n_receipts int := 0;
  n_sale_voids int := 0;
  n_sale_returns int := 0;
  n_customer_debt_payments int := 0;
  n_sales int := 0;
  n_inventory_movements int := 0;
  n_cash_adjustments int := 0;
  n_count_sessions int := 0;
  n_supplier_payments int := 0;
  n_purchases int := 0;
  n_products int := 0;
  n_customers int := 0;
  n_ai_usage int := 0;
  n_day_closes int := 0;
  n_drawer_opens int := 0;
  n_shifts int := 0;
  n_snapshots int := 0;
  n_audit_logs int := 0;
  n_correction_requests int := 0;
  n_corrections int := 0;
  n_loyalty_transactions int := 0;
  n_loyalty_accounts int := 0;
begin
  if not public.is_waka_internal_role(array['super_admin','operations_admin']::text[]) then
    return jsonb_build_object('ok', false, 'error', 'forbidden', 'detail', 'WAKA internal admin (super_admin or operations_admin) only.');
  end if;

  if p_shop_id is null then
    return jsonb_build_object('ok', false, 'error', 'shop_id_required');
  end if;

  select sh.name, sh.shop_number into v_shop_name, v_shop_number
  from public.shops sh where sh.id = p_shop_id;

  if v_shop_name is null then
    return jsonb_build_object('ok', false, 'error', 'shop_not_found');
  end if;

  v_before := public.admin_shop_reset_preview_counts(p_shop_id);

  if v_phase = 'preview' then
    insert into public.internal_ops_admin_audit (actor, action, target_shop_id, payload)
    values (auth.uid(), 'shop_reset_preview', p_shop_id, jsonb_build_object('shop_name', v_shop_name, 'counts', v_before));

    return jsonb_build_object(
      'ok', true, 'phase', 'preview', 'shop_id', p_shop_id,
      'shop_name', v_shop_name, 'shop_number', v_shop_number, 'counts', v_before
    );
  end if;

  if v_phase <> 'execute' then
    return jsonb_build_object('ok', false, 'error', 'invalid_phase');
  end if;

  if v_confirm <> 'RESET SHOP' then
    insert into public.internal_ops_admin_audit (actor, action, target_shop_id, payload)
    values (auth.uid(), 'shop_reset_failed', p_shop_id, jsonb_build_object('error', 'confirmation_required', 'shop_name', v_shop_name));

    return jsonb_build_object('ok', false, 'error', 'confirmation_required', 'detail', 'Type RESET SHOP to confirm.');
  end if;

  begin
    -- Loyalty goes with the business-data wipe (ledger first — its account
    -- FK and the accounts' customer FK must not block the customers delete
    -- below). Program configuration (loyalty_programs) survives, like shop
    -- settings.
    delete from public.loyalty_transactions where shop_id = p_shop_id;
    get diagnostics n_loyalty_transactions = row_count;

    delete from public.loyalty_accounts where shop_id = p_shop_id;
    get diagnostics n_loyalty_accounts = row_count;

    delete from public.financial_correction_requests where shop_id = p_shop_id;
    get diagnostics n_correction_requests = row_count;

    delete from public.sale_line_item_corrections where shop_id = p_shop_id;
    get diagnostics n_corrections = row_count;

    with target_sales as (select id from public.sales where shop_id = p_shop_id)
    delete from public.sale_line_items where sale_id in (select id from target_sales);
    get diagnostics n_sale_line_items = row_count;

    with target_sales as (select id from public.sales where shop_id = p_shop_id)
    delete from public.sale_payments where sale_id in (select id from target_sales);
    get diagnostics n_sale_payments = row_count;

    delete from public.receipts where shop_id = p_shop_id;
    get diagnostics n_receipts = row_count;

    delete from public.sale_voids where shop_id = p_shop_id;
    get diagnostics n_sale_voids = row_count;

    delete from public.sale_returns where shop_id = p_shop_id;
    get diagnostics n_sale_returns = row_count;

    delete from public.customer_debt_payments where shop_id = p_shop_id;
    get diagnostics n_customer_debt_payments = row_count;

    delete from public.sales where shop_id = p_shop_id;
    get diagnostics n_sales = row_count;

    delete from public.inventory_movements where shop_id = p_shop_id;
    get diagnostics n_inventory_movements = row_count;

    delete from public.shop_cash_drawer_adjustments where shop_id = p_shop_id;
    get diagnostics n_cash_adjustments = row_count;

    delete from public.shop_inventory_count_sessions where shop_id = p_shop_id;
    get diagnostics n_count_sessions = row_count;

    delete from public.shop_supplier_payments where shop_id = p_shop_id;
    get diagnostics n_supplier_payments = row_count;

    delete from public.shop_purchases where shop_id = p_shop_id;
    get diagnostics n_purchases = row_count;

    delete from public.products where shop_id = p_shop_id;
    get diagnostics n_products = row_count;

    delete from public.customers where shop_id = p_shop_id;
    get diagnostics n_customers = row_count;

    delete from public.ai_generation_usage_log where shop_id = p_shop_id;
    get diagnostics n_ai_usage = row_count;

    delete from public.shop_day_closes where shop_id = p_shop_id;
    get diagnostics n_day_closes = row_count;

    delete from public.shop_day_drawer_opens where shop_id = p_shop_id;
    get diagnostics n_drawer_opens = row_count;

    delete from public.shop_shifts where shop_id = p_shop_id;
    get diagnostics n_shifts = row_count;

    delete from public.shop_cloud_snapshots where shop_id = p_shop_id;
    get diagnostics n_snapshots = row_count;

    delete from public.audit_logs where shop_id = p_shop_id;
    get diagnostics n_audit_logs = row_count;

    insert into public.sync_health (shop_id, pending_outbound, last_error, last_pull_at, last_push_ok_at, updated_at)
    values (p_shop_id, 0, null, null, null, v_reset_at)
    on conflict (shop_id) do update
      set pending_outbound = 0, last_error = null, last_pull_at = null, last_push_ok_at = null, updated_at = v_reset_at;

    insert into public.shop_recovery_signals (shop_id, force_full_resync_at, updated_at)
    values (p_shop_id, v_reset_at, v_reset_at)
    on conflict (shop_id) do update
      set force_full_resync_at = v_reset_at, updated_at = v_reset_at;

  exception when others then
    insert into public.internal_ops_admin_audit (actor, action, target_shop_id, payload)
    values (auth.uid(), 'shop_reset_failed', p_shop_id, jsonb_build_object(
      'error', 'reset_failed', 'detail', sqlerrm, 'shop_name', v_shop_name, 'before_counts', v_before
    ));
    return jsonb_build_object('ok', false, 'error', 'reset_failed', 'detail', sqlerrm);
  end;

  v_deleted := jsonb_build_object(
    'sale_line_items', n_sale_line_items,
    'sale_payments', n_sale_payments,
    'receipts', n_receipts,
    'sale_voids', n_sale_voids,
    'sale_returns', n_sale_returns,
    'customer_debt_payments', n_customer_debt_payments,
    'sales', n_sales,
    'inventory_movements', n_inventory_movements,
    'shop_cash_drawer_adjustments', n_cash_adjustments,
    'shop_inventory_count_sessions', n_count_sessions,
    'shop_supplier_payments', n_supplier_payments,
    'shop_purchases', n_purchases,
    'products', n_products,
    'customers', n_customers,
    'ai_generation_usage_log', n_ai_usage,
    'shop_day_closes', n_day_closes,
    'shop_day_drawer_opens', n_drawer_opens,
    'shop_shifts', n_shifts,
    'shop_cloud_snapshots', n_snapshots,
    'audit_logs', n_audit_logs,
    'financial_correction_requests', n_correction_requests,
    'sale_line_item_corrections', n_corrections,
    'loyalty_transactions', n_loyalty_transactions,
    'loyalty_accounts', n_loyalty_accounts
  );

  v_after := public.admin_shop_reset_preview_counts(p_shop_id);

  insert into public.internal_ops_admin_audit (actor, action, target_shop_id, payload)
  values (auth.uid(), 'shop_reset_executed', p_shop_id, jsonb_build_object(
    'shop_name', v_shop_name, 'shop_number', v_shop_number,
    'before_counts', v_before, 'deleted_counts', v_deleted, 'after_counts', v_after
  ));

  return jsonb_build_object(
    'ok', true, 'phase', 'execute', 'shop_id', p_shop_id,
    'shop_name', v_shop_name, 'shop_number', v_shop_number,
    'deleted', v_deleted, 'verification', v_after
  );
end;
$function$;

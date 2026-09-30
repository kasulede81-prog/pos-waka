-- ============================================================================
-- LOYALTY PHASE 0 — INTEGRITY PASS
-- ============================================================================
-- The six issues raised by the architecture audit, each settled explicitly.
-- Four are corrected here; two are settled WITHOUT a code change, and the
-- reasoning is recorded so neither is re-opened as a defect later.
--
--   1. Return reversals used the CURRENT earn rate            -> FIXED (below)
--   2. min_eligible_spend_ugx is subtractive, not a gate      -> INTENTIONAL, documented
--   3. The ledger could be UPDATEd by non-owner roles         -> GUARDED (below)
--   4. No way to assert the balance invariant                 -> ADDED (below)
--   5. A failed award was only a warning                      -> RECORDED + RETRYABLE (below)
--   6. Wallet outbox has no scheduler                         -> DEFERRED, documented
--
-- NOTHING HERE CHANGES THE EARN ENGINE. The rule stays
-- `floor(greatest(total - min_eligible_spend, 0) / earn_unit_ugx) * earn_points_per_unit`,
-- the ledger keeps its shape, and FIFO/idempotency/reversal mechanics are
-- untouched apart from item 1, which was computing the wrong number.
--
-- ---------------------------------------------------------------------------
-- 2. min_eligible_spend_ugx — INTENTIONAL, NOT A DEFECT (no code change)
-- ---------------------------------------------------------------------------
-- The audit flagged this as possibly a bug because the column NAME reads like a
-- gate ("minimum spend to earn"). It is not a gate, and that is deliberate:
--
--     eligible = greatest(sale_total - min_eligible_spend_ugx, 0)
--     points   = floor(eligible / earn_unit_ugx) * earn_points_per_unit
--
-- So the threshold is DEDUCTED: with a 5,000 minimum, a 4,999 sale earns 0 and a
-- 6,000 sale earns on 1,000 — not on 6,000. Evidence that this is the intended,
-- coherent behaviour rather than an accident:
--   * the table comment has documented this formula since the foundation migration;
--   * the client mirror `computeEarnedPoints` (src/lib/loyalty/loyaltyMath.ts:93)
--     implements the identical arithmetic, so preview and server cannot disagree;
--   * the merchant-facing label is "Minimum spend before points (UGX)" — which
--     describes a deductible, and does NOT promise a pass/fail gate;
--   * two suites pin it (`loyaltyEngine.sql.integration.test.ts`,
--     `loyaltyMath.test.ts`).
--
-- Changing it to a gate would alter what merchants actually pay out, for customers
-- with a configured threshold, with no defect to justify it. What was genuinely
-- missing was the semantics being stated where a schema reader will meet it, so
-- that is what this migration adds — a column comment, and no arithmetic change.

comment on column public.loyalty_programs.min_eligible_spend_ugx is
  'DEDUCTIBLE threshold, NOT a gate. eligible = greatest(sale_total - this, 0); '
  'points = floor(eligible / earn_unit_ugx) * earn_points_per_unit. A sale at or below this '
  'value earns nothing; a sale above it earns on the amount ABOVE it. Merchant label: '
  '"Minimum spend before points (UGX)". Verified intentional in the Phase 0 integrity pass.';

-- ---------------------------------------------------------------------------
-- 6. Wallet outbox scheduling — DEFERRED (no code change)
-- ---------------------------------------------------------------------------
-- `loyalty_wallet_sync_outbox` has no scheduler: rows are enqueued by ledger and
-- lifecycle triggers, but drained only when a client happens to call the
-- `loyalty-wallet-sync` Edge Function (POS after a confirmed award, the merchant
-- hub, or the wallet button). A pass can therefore show a stale balance until
-- something pokes it.
--
-- This is an INFRASTRUCTURE task, not a Loyalty feature defect, and Wallet is
-- explicitly out of scope for this release (no issuer credentials exist yet, so
-- the path fails closed with `wallet_not_configured`). Recorded here, at the point
-- of confusion, rather than expanded into scope:

comment on table public.loyalty_wallet_sync_outbox is
  'Wallet sync work queue. Drained ONLY on demand — there is no scheduler: the '
  'loyalty-wallet-sync Edge Function is invoked opportunistically by clients (POS '
  'after a confirmed award, merchant hub, wallet button). Until a scheduled drain '
  'exists, a pass can lag its ledger. Deferred infrastructure task (Phase 0 audit); '
  'not a defect in the ledger.';

-- ============================================================================
-- 1. RETURN REVERSALS REVERSE THE ORIGINAL AWARD, NOT THE CURRENT RATE
-- ============================================================================
-- THE DEFECT. The previous body computed the clawback from the shop's CURRENT
-- program row:
--
--     v_points := (v_return.refund_amount_ugx / v_program.earn_unit_ugx)
--                 * v_program.earn_points_per_unit;
--
-- A merchant who edits their earn rule between the sale and the return changes
-- how many points that return claws back — and the number no longer corresponds
-- to anything the customer was ever awarded. It also ignored offer multipliers
-- and the min-spend deductible entirely, so even without a rate change a partial
-- return could reverse MORE than the original award (the caps caught it, but the
-- arithmetic was wrong).
--
-- THE FIX. Reverse a PROPORTION OF WHAT WAS ACTUALLY AWARDED:
--
--     reversed = floor(earned_points * refund_amount / sale_total)
--
-- This is rate-independent by construction: a rate edit cannot change it, a
-- multiplier or a min-spend deductible is already baked into `earned_points`, a
-- full return reverses exactly the original award, and successive partial returns
-- sum to it (still capped by `loyalty_outstanding_for_sale`, which respects FIFO
-- redemptions and expiries).
--
-- The ORIGINAL rule snapshot is preserved: the reversal row records the earned
-- row's own snapshot under `original_rule_snapshot`, plus the figures the
-- proportional basis was computed from, so the arithmetic is auditable after the
-- fact even if the merchant later edits the rule.
--
-- Unchanged: idempotency (`already_reversed`), the outstanding cap, the balance
-- floor (Decision 013 — a return can never drive a balance negative), the
-- `balance_floor` check_violation branch, the `no_program` guard, and the void
-- path (which already reversed the original awarded amount and stays as it is).

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
  v_earned_points integer;
  v_earned_snapshot jsonb;
  v_sale_total bigint;
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

  -- The ORIGINAL award, and the sale total it was earned against. Both come from
  -- the earned row itself, never from the current program configuration.
  select t.id, t.account_id, t.points, t.rule_snapshot, s.total_ugx
    into v_earned_id, v_account_id, v_earned_points, v_earned_snapshot, v_sale_total
  from public.loyalty_transactions t
  join public.sales s on s.id = t.source_sale_id
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

  -- Proportional to the original award. A sale total of zero cannot have earned
  -- anything (points require spend above the deductible), so the fallback is
  -- defensive only.
  if v_sale_total is null or v_sale_total <= 0 then
    v_points := v_outstanding;
  else
    v_points := ((v_earned_points::bigint * v_return.refund_amount_ugx) / v_sale_total)::integer;
  end if;

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
        'rule_kind', coalesce(v_earned_snapshot ->> 'rule_kind', v_program.rule_kind),
        'reversal_basis', 'proportional_to_original_award',
        'earned_points', v_earned_points,
        'sale_total_ugx', v_sale_total,
        'refund_amount_ugx', v_return.refund_amount_ugx,
        'original_rule_snapshot', coalesce(v_earned_snapshot, '{}'::jsonb)
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

-- Trigger-only, exactly as before.
revoke all on function public.loyalty_reverse_for_return (uuid) from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_reverse_for_return (uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.loyalty_reverse_for_return (uuid) from authenticated';
  end if;
end;
$g$;

-- ============================================================================
-- 3. THE LEDGER IS APPEND-ONLY FOR EVERY NON-OWNER ROLE
-- ============================================================================
-- Grants already stop the browser: `authenticated`/`anon` lost INSERT/UPDATE/
-- DELETE on `loyalty_transactions` in the Phase 0 hardening. What remained open
-- was every PRIVILEGED path — `service_role` (what the Edge Functions use to
-- bypass RLS) and any non-owner role holding a grant — which could rewrite
-- history. No code does, but nothing stopped it.
--
-- This guard refuses UPDATE from any role that is not a member of the table's
-- owner. Migrations, admin operations owned by the owner, and SECURITY DEFINER
-- functions owned by the owner therefore keep their controlled write path —
-- which is what "without blocking legitimate controlled reversal/adjustment
-- functions" requires — while service_role can no longer mutate the ledger.
--
-- DELETE IS DELIBERATELY NOT BLOCKED, and that is a considered limit rather than
-- an oversight. Two documented behaviours delete ledger rows and both matter:
--   * Decision 012 — the ledger cascades from `customers`/`shops`, and WAKA
--     hard-deletes customers by design (managers hold `customers_delete`). A
--     DELETE guard would break customer deletion.
--   * the internal-admin shop reset removes a shop's loyalty rows explicitly.
-- Those are destructive admin paths, not Loyalty mutations. Append-only holds for
-- every ordinary operation: nothing in this codebase updates or deletes an
-- individual ledger row.

create or replace function public.loyalty_tx_guard_update ()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
declare
  v_owner oid;
begin
  select c.relowner into v_owner
  from pg_class c
  where c.oid = 'public.loyalty_transactions'::regclass;

  if v_owner is not null and not pg_has_role (current_user, v_owner, 'MEMBER') then
    raise exception 'loyalty_transactions is append-only: row % cannot be updated', old.id
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_loyalty_tx_no_update on public.loyalty_transactions;
create trigger trg_loyalty_tx_no_update
  before update on public.loyalty_transactions
  for each row execute function public.loyalty_tx_guard_update ();

revoke all on function public.loyalty_tx_guard_update () from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_tx_guard_update () from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.loyalty_tx_guard_update () from authenticated';
  end if;
end;
$g$;

-- ============================================================================
-- 4. THE BALANCE INVARIANT CAN BE ASSERTED
-- ============================================================================
-- `balance_points` is a cached counter maintained by `trg_loyalty_tx_balance`.
-- By construction it equals the signed sum of the account's ledger rows, and
-- `lifetime_earned - lifetime_redeemed` equals the same number. Nothing verified
-- that at runtime, and the only DB constraint is `balance_points >= 0`.
--
-- This is a read-only CHECKER, not a trigger. A hot-path trigger recomputing the
-- ledger sum on every account write would add cost to every award and redemption
-- to defend against a drift the trigger already prevents; a checker can be run by
-- tests, by an admin, or on suspicion, at zero cost to the write path.
--
-- It answers one question — do the cached counters still match the ledger? — and
-- reports both sides so drift is diagnosable rather than merely detected.

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

  -- Shop-scoped, like every other merchant read (Decision 015).
  if not public.user_can_access_shop (v_account.shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select
    coalesce(sum(points), 0)::bigint,
    coalesce(sum(greatest (points, 0)), 0)::bigint,
    coalesce(sum(greatest (-points, 0)), 0)::bigint
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

revoke all on function public.loyalty_assert_balance_invariant (uuid) from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_assert_balance_invariant (uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_assert_balance_invariant (uuid) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.loyalty_assert_balance_invariant (uuid) to service_role';
  end if;
end;
$g$;

-- ============================================================================
-- 5. A FAILED AWARD IS RECORDED AND RETRYABLE, NOT JUST A WARNING
-- ============================================================================
-- Decision 013 is right: loyalty must never abort a sale. But "never block the
-- sale" was implemented as `raise warning`, which is not a signal — it reaches a
-- log the merchant will never read, and a completed sale that silently awarded no
-- points looks identical to one that did. The failure was neither visible nor
-- recoverable.
--
-- This keeps Decision 013 exactly intact and adds two things:
--   * a durable record of WHICH sale failed and WHY, written from inside the
--     trigger's own exception handler (itself guarded, so recording a failure can
--     never become a second way to break a sale);
--   * a manager-gated retry that re-runs the award for the sales that failed —
--     safe because `loyalty_award_for_sale` is idempotent (one `earned` row per
--     sale, enforced by `loyalty_tx_earn_sale_once`), so a sale that quietly
--     succeeded in the meantime resolves to `already_awarded` rather than paying
--     twice.
--
-- The same treatment covers the void/return reversal paths, which swallowed their
-- failures identically. A missed clawback is a merchant loss, so it belongs in
-- the same queue.

create table if not exists public.loyalty_award_failures (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  sale_id uuid not null references public.sales (id) on delete cascade,
  -- Which loyalty operation failed. Award failures are the primary case; reversal
  -- failures use the same queue because both are silent point discrepancies.
  operation text not null default 'award' check (operation in ('award', 'reversal')),
  error_message text not null,
  attempts integer not null default 1 check (attempts > 0),
  first_failed_at timestamptz not null default now (),
  last_failed_at timestamptz not null default now (),
  resolved_at timestamptz null,
  constraint loyalty_award_failures_sale_once unique (sale_id)
);

create index if not exists loyalty_award_failures_open_idx
  on public.loyalty_award_failures (shop_id, last_failed_at desc)
  where resolved_at is null;

comment on table public.loyalty_award_failures is
  'Sales whose loyalty award/reversal failed inside the exception-guarded trigger. '
  'Decision 013 keeps the sale authoritative, so the discrepancy is recorded here and '
  'recoverable through loyalty_retry_failed_awards() — never by re-running the sale.';

alter table public.loyalty_award_failures enable row level security;

drop policy if exists loyalty_award_failures_select on public.loyalty_award_failures;
create policy loyalty_award_failures_select
  on public.loyalty_award_failures for select
  using (public.user_can_access_shop (shop_id));

revoke all on public.loyalty_award_failures from anon;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on public.loyalty_award_failures to authenticated';
    execute 'revoke insert, update, delete, truncate, references, trigger '
         || 'on public.loyalty_award_failures from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'public') then
    execute 'revoke insert, update, delete, truncate, references, trigger '
         || 'on public.loyalty_award_failures from public';
  end if;
end;
$g$;

-- Recorder. Self-contained and self-guarded: the caller wraps it again, so a
-- failure to record can never escalate into a failure to complete a sale.
create or replace function public.loyalty_note_award_failure (
  p_sale_id uuid,
  p_error text,
  p_operation text default 'award'
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_shop_id uuid;
  v_operation text := case when p_operation = 'reversal' then 'reversal' else 'award' end;
begin
  select shop_id into v_shop_id from public.sales where id = p_sale_id;
  if v_shop_id is null then
    return;
  end if;

  insert into public.loyalty_award_failures (shop_id, sale_id, operation, error_message)
  values (v_shop_id, p_sale_id, v_operation, left (coalesce(p_error, 'unknown'), 500))
  on conflict (sale_id) do update
  set attempts = public.loyalty_award_failures.attempts + 1,
      last_failed_at = now (),
      error_message = excluded.error_message,
      operation = excluded.operation,
      resolved_at = null;
end;
$function$;

revoke all on function public.loyalty_note_award_failure (uuid, text, text) from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_note_award_failure (uuid, text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.loyalty_note_award_failure (uuid, text, text) from authenticated';
  end if;
end;
$g$;

-- The trigger: Decision 013 preserved verbatim (still `raise warning`, still never
-- aborts the financial write), plus the record.
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

-- Retry. Manager-gated, shop-scoped, bounded, and safe to run repeatedly.
create or replace function public.loyalty_retry_failed_awards (
  p_shop_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_row record;
  v_res jsonb;
  v_retried integer := 0;
  v_resolved integer := 0;
  v_failed integer := 0;
  v_limit integer := greatest (1, least (coalesce(p_limit, 50), 200));
begin
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  for v_row in
    select sale_id, operation
    from public.loyalty_award_failures
    where shop_id = p_shop_id
      and resolved_at is null
    order by last_failed_at asc
    limit v_limit
    for update skip locked
  loop
    v_retried := v_retried + 1;
    begin
      -- Both entry points are idempotent, so a sale that succeeded since being
      -- recorded resolves rather than paying twice.
      v_res := case
        when v_row.operation = 'reversal' then public.loyalty_reverse_for_sale (v_row.sale_id)
        else public.loyalty_award_for_sale (v_row.sale_id)
      end;

      if coalesce((v_res ->> 'ok')::boolean, false) then
        update public.loyalty_award_failures
        set resolved_at = now ()
        where sale_id = v_row.sale_id;
        v_resolved := v_resolved + 1;
      else
        update public.loyalty_award_failures
        set attempts = attempts + 1,
            last_failed_at = now (),
            error_message = left (coalesce(v_res ->> 'error', 'unknown'), 500)
        where sale_id = v_row.sale_id;
        v_failed := v_failed + 1;
      end if;
    exception when others then
      update public.loyalty_award_failures
      set attempts = attempts + 1,
          last_failed_at = now (),
          error_message = left (sqlerrm, 500)
      where sale_id = v_row.sale_id;
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object (
    'ok', true,
    'retried', v_retried,
    'resolved', v_resolved,
    'still_failing', v_failed
  );
end;
$function$;

revoke all on function public.loyalty_retry_failed_awards (uuid, integer) from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_retry_failed_awards (uuid, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_retry_failed_awards (uuid, integer) to authenticated';
  end if;
end;
$g$;

-- ============================================================================
-- WAKA Loyalty Program public code — WPL2026001
-- ============================================================================
-- Every `loyalty_programs` row (already exactly one per shop) carries ONE permanent,
-- customer-facing code that identifies the merchant's Loyalty Program:
--
--     WPL 2026 001
--     |   |    └─ sequence for that year, minimum 3 digits, zero padded
--     |   └────── issuance year, Africa/Kampala
--     └────────── WAKA POS Loyalty
--
-- This is a PUBLIC IDENTIFIER, NOT A CREDENTIAL. It says WHICH merchant; it never authorises
-- anything. It is not the shop id, the organization id, an account id, or a token, and it must
-- never be treated as a secret — the enrollment-link and card tokens remain the only bearers.
--
-- NO NEW TABLE for the program itself: `loyalty_programs` is already 1:1 with a shop
-- (`shop_id uuid not null unique`), already carries the `enabled` flag the enrollment RPCs gate
-- on, and is already the entity the merchant edits and the admin control plane reports on.
-- `shops.code` was rejected (nullable, not unique, no reader anywhere). `shops.shop_number`
-- (A001) is an internal support reference and must not be conflated with this.
--
-- Generation follows the existing WAKA sequential-counter pattern (055_waka_shop_numbers.sql):
-- a counter table plus ONE atomic statement. Deliberately NOT max(code)+1, which two concurrent
-- sessions can read at the same value.
--
-- Wallet: `trg_loyalty_wallet_enqueue_on_program_change` enqueues only when one of
-- enabled / earn_unit_ugx / earn_points_per_unit / rule_kind / min_eligible_spend_ugx changes.
-- Adding and issuing `public_code` touches none of them, so no Wallet sync is triggered.

-- ============================================================================
-- 1) Counter — one row per issuance year
-- ============================================================================
create table if not exists public.waka_loyalty_program_counter (
  year integer primary key check (year between 2000 and 9999),
  -- The NEXT number to hand out. Never decremented: a consumed number is never reissued, even
  -- if the shop closes or the program is deactivated.
  next_seq integer not null default 1 check (next_seq >= 1)
);

comment on table public.waka_loyalty_program_counter is
  'Per-year sequence for WAKA Loyalty Program public codes. Monotonic; a number is never reused.';

alter table public.waka_loyalty_program_counter enable row level security;

-- ============================================================================
-- 2) Formatter
-- ============================================================================
create or replace function public.format_waka_loyalty_program_code (p_year integer, p_seq integer)
returns text
language sql
immutable
as $$
  -- The width is `greatest(3, length(...))`, NOT a flat 3, because lpad() TRUNCATES to its width
  -- when the input is longer: lpad('1000', 3, '0') is '100', which would have silently turned
  -- sequence 1000 into WPL2026100 — a code that collides with sequence 100. Padding only when
  -- the value is genuinely shorter keeps 3 digits as a MINIMUM, so 1000 formats as WPL20261000.
  select 'WPL'
       || lpad (
            greatest (coalesce (p_year, 0), 0)::text,
            greatest (4, length (greatest (coalesce (p_year, 0), 0)::text)),
            '0'
          )
       || lpad (
            greatest (coalesce (p_seq, 0), 1)::text,
            greatest (3, length (greatest (coalesce (p_seq, 0), 1)::text)),
            '0'
          );
$$;

-- The shape the column CHECK enforces, exposed so callers/tests share one definition.
create or replace function public.is_waka_loyalty_program_code (p_code text)
returns boolean
language sql
immutable
as $$
  select coalesce (p_code, '') ~ '^WPL[0-9]{4}[0-9]{3,9}$';
$$;

-- ============================================================================
-- 3) Allocator — concurrency safe
-- ============================================================================
create or replace function public.next_waka_loyalty_program_code (p_year integer default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := coalesce (
    p_year,
    extract (year from (now () at time zone 'Africa/Kampala'))::integer
  );
  v_seq integer;
begin
  if v_year is null or v_year < 2000 or v_year > 9999 then
    raise exception 'invalid issuance year for a WAKA Loyalty Program code';
  end if;

  -- ONE atomic statement. Concurrent allocators serialise on the row: the loser waits for the
  -- winner's row lock, then re-reads the committed value, so two callers can never receive the
  -- same number. `next_seq - 1` is the number being handed out (the insert seeds 2 so that the
  -- very first allocation of a year is 001).
  insert into public.waka_loyalty_program_counter (year, next_seq)
  values (v_year, 2)
  on conflict (year) do update
    set next_seq = public.waka_loyalty_program_counter.next_seq + 1
  returning next_seq - 1 into v_seq;

  if v_seq is null then
    raise exception 'could not allocate a WAKA Loyalty Program code';
  end if;

  return public.format_waka_loyalty_program_code (v_year, v_seq);
end;
$$;

-- Never client-callable. A merchant burning codes would be a denial-of-identity, and the ONLY
-- caller is the BEFORE INSERT trigger below (which runs as the table owner).
do $g$
begin
  execute 'revoke all on function public.next_waka_loyalty_program_code (integer) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.next_waka_loyalty_program_code (integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.next_waka_loyalty_program_code (integer) from authenticated';
  end if;
  execute 'revoke all on function public.next_waka_loyalty_program_code (integer) from service_role';
end;
$g$;

-- ============================================================================
-- 4) The code column
-- ============================================================================
alter table public.loyalty_programs
  add column if not exists public_code text;

comment on column public.loyalty_programs.public_code is
  'Permanent public WAKA Loyalty Program code (WPL2026001). Immutable. A public identifier, never a credential.';

-- Partial unique index: unique among issued codes while the column is still being backfilled.
create unique index if not exists loyalty_programs_public_code_key
  on public.loyalty_programs (public_code)
  where public_code is not null;

-- The public_code shape CHECK is deliberately NOT added here. It is added in section 10, AFTER the
-- backfill has given every existing row a code. See that section for why the order is load-bearing.

-- ============================================================================
-- 5) Assignment on insert
-- ============================================================================
create or replace function public.trg_loyalty_programs_assign_public_code ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.public_code is null or btrim (new.public_code) = '' then
    new.public_code := public.next_waka_loyalty_program_code ();
  else
    new.public_code := upper (btrim (new.public_code));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_loyalty_programs_public_code on public.loyalty_programs;
create trigger trg_loyalty_programs_public_code
  before insert on public.loyalty_programs
  for each row execute function public.trg_loyalty_programs_assign_public_code ();

-- ============================================================================
-- 6) Immutability
-- ============================================================================
-- "Immutable" means immutable ONCE ASSIGNED, and the `old.public_code is not null` guard is what
-- expresses that. Without it the trigger also blocks the NULL -> code transition — which is not a
-- change but the one-time ASSIGNMENT, and is exactly what section 7's backfill performs. Guarding
-- on `is not null` lets that through while still refusing every real change:
--
--   NULL -> WPL2026001   allowed   (the assignment: backfill, or a first write)
--   WPL2026001 -> same   allowed   (not a change; ordinary programme saves rewrite the row)
--   WPL2026001 -> other  REFUSED
--   WPL2026001 -> NULL   REFUSED   (so the column can never be cleared and re-issued)
--
-- This was the second defect the production attempt was hiding: it failed earlier, on the CHECK, so
-- the backfill never ran and this never surfaced. Only a test that seeds rows BEFORE the migration
-- finds it — see `loyaltyProgramCodeBackfill.sql.integration.test.ts`.
create or replace function public.trg_loyalty_programs_public_code_immutable ()
returns trigger
language plpgsql
as $$
begin
  if old.public_code is not null and new.public_code is distinct from old.public_code then
    raise exception 'loyalty_programs.public_code is immutable (% -> %)',
      old.public_code, new.public_code;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_loyalty_programs_public_code_frozen on public.loyalty_programs;
create trigger trg_loyalty_programs_public_code_frozen
  before update on public.loyalty_programs
  for each row execute function public.trg_loyalty_programs_public_code_immutable ();

-- ============================================================================
-- 7) Backfill existing programs
-- ============================================================================
-- Issued in registration order, so the oldest program on the platform receives WPL<year>001 —
-- the same convention 055 used for A001. The YEAR is the issuance year (when the code is handed
-- out, i.e. now), not the program's creation year: a code is issued once, and this is that moment.
do $bf$
declare
  v_year integer := extract (year from (now () at time zone 'Africa/Kampala'))::integer;
begin
  with ordered as (
    select
      lp.id,
      row_number() over (order by lp.created_at asc, lp.id asc) as rn
    from public.loyalty_programs lp
    where lp.public_code is null
  )
  update public.loyalty_programs p
  set public_code = public.format_waka_loyalty_program_code (v_year, o.rn::integer)
  from ordered o
  where p.id = o.id;
end;
$bf$;

-- ============================================================================
-- 8) Resync the counter from what is actually on disk
-- ============================================================================
-- One-time reconciliation, NOT the allocation path. For every year present, the counter is
-- lifted to max(sequence)+1 so the next allocation cannot collide with a backfilled code. It is
-- never lowered, so a counter that is already ahead stays ahead and no number is reissued.
insert into public.waka_loyalty_program_counter (year, next_seq)
select
  substring (p.public_code from 4 for 4)::integer as year,
  max (substring (p.public_code from 8)::bigint) + 1 as next_seq
from public.loyalty_programs p
where public.is_waka_loyalty_program_code (p.public_code)
group by 1
on conflict (year) do update
  set next_seq = greatest (
    public.waka_loyalty_program_counter.next_seq,
    excluded.next_seq
  );

-- ============================================================================
-- 9) Tighten the column
-- ============================================================================
do $nn$
begin
  if not exists (select 1 from public.loyalty_programs where public_code is null) then
    alter table public.loyalty_programs alter column public_code set not null;
  end if;
end;
$nn$;

-- ============================================================================
-- 10) The shape constraint — added LAST, and that ordering is load-bearing
-- ============================================================================
-- This MUST run after the backfill (section 7) and after `set not null` (section 9), never before.
--
-- A PostgreSQL CHECK rejects a row whose expression evaluates to FALSE. `is_waka_loyalty_program_code`
-- returns false — not NULL — for a NULL input, because it coalesces to '' first. So adding this
-- constraint while pre-existing rows still hold a NULL public_code fails the whole migration with
-- SQLSTATE 23514:
--
--   ERROR: check constraint "loyalty_programs_public_code_shape_chk" of relation
--          "loyalty_programs" is violated by some row
--
-- That is exactly what happened on the first production attempt; it is not a theoretical hazard.
-- On a database whose loyalty_programs table happens to be EMPTY the constraint validates fine,
-- which is why an empty-database test cannot catch this and a seeded one is required
-- (`loyaltyProgramCodeBackfill.sql.integration.test.ts` seeds rows BEFORE this file is applied).
--
-- The constraint stays STRICT: no NULL allowance, no NOT VALID. By this point every row holds a
-- valid code, so strictness costs nothing and the invariant is enforced for all future writes.
do $chk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'loyalty_programs_public_code_shape_chk'
      and conrelid = 'public.loyalty_programs'::regclass
  ) then
    -- 4-digit issuance year + MINIMUM 3 sequence digits, so WPL20261000 is valid rather than a
    -- constraint violation: 1000+ extends the code instead of breaking it.
    alter table public.loyalty_programs
      add constraint loyalty_programs_public_code_shape_chk
      check (public.is_waka_loyalty_program_code (public_code));
  end if;
end;
$chk$;

-- ============================================================================
-- 11) Privileges
-- ============================================================================
-- `authenticated` already holds NO insert/update/delete on loyalty_programs (revoked by
-- 20260926096000 and never re-granted), so no client role can write this column at all: every
-- write goes through the SECURITY DEFINER `loyalty_update_program`, whose upsert never mentions
-- public_code. The triggers above then guard the definer path as well.
--
-- The counter is server-only. Nothing outside a SECURITY DEFINER function may read or advance it.
do $g$
begin
  execute 'revoke all on table public.waka_loyalty_program_counter from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.waka_loyalty_program_counter from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.waka_loyalty_program_counter from authenticated';
  end if;
end;
$g$;

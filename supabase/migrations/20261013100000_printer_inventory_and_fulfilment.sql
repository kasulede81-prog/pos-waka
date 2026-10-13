-- ============================================================================
-- WAKA PRINTER INVENTORY AND FULFILMENT — Phase 1 (backend only)
-- ============================================================================
-- WHAT THIS IS. A registry of the physical WAKA POS WP-58 printers we hand to
-- customers, and an append-only record of every fulfilment attempt against one.
-- Two tables, no UI, no marketing, no pricing.
--
-- WHAT IT IS DELIBERATELY NOT.
--   * Not merchant inventory. Neither table references `products`,
--     `inventory_movements`, `shop_stock_movements` or anything sales touches.
--     There is no FK path from merchant stock to these tables and no trigger
--     bridges them, so a printer cannot reach a sale, a COGS line, a stock
--     valuation or a platform metric. Isolation is structural, not careful.
--   * Not a promotion switch. `subscription_plans.is_active` is untouched: it
--     gates `bootstrap_owner_workspace`, `resolve_shop_device_limit`, the RLS
--     `plans_select` policy and the public price book, so it is not a
--     promotional visibility control and must not become one.
--   * Not a pricing or checkout change. Eligibility READS the subscription row
--     through the existing `_subscription_latest_for_org` resolver. No
--     subscription, payment or discount function is redefined here.
--
-- ----------------------------------------------------------------------------
-- SCOPE: THE ASSIGNMENT IS ORGANIZATION-SCOPED, LIKE BILLING
-- ----------------------------------------------------------------------------
-- Subscriptions are organization-scoped — one live row per org
-- (`subscriptions_one_active_per_org`, 017) — so a printer is owed to the
-- ORGANIZATION, not to one branch. The branch is recorded too, but as the place
-- the handover actually happened, supplied by the operator who performed it.
--
-- There is deliberately NO "main branch" assumption anywhere in this file. The
-- audit found no main-branch flag on `shops`, and choosing one by convention
-- (first branch, oldest branch, a hard-coded id) would be inventing a fact about
-- a customer's business. Phase 1 records the branch that was actually used; a
-- designation belongs with the Phase 2 console that needs one.
--
-- ----------------------------------------------------------------------------
-- SERIAL NUMBERS — ONLY WHAT IS ON A REAL LABEL
-- ----------------------------------------------------------------------------
-- Units are created one at a time by an authorized operator typing the serial
-- printed on the physical label. There is no generator, no sequence, no seed
-- data and no test fixture that lands in production. Uniqueness is a database
-- constraint, not a convention.
--
-- The CHECK is deliberately STRUCTURAL, not batch-specific. The confirmed first
-- batch is `WP58-2609-NNN`, but what `2609` encodes is not established and the
-- format is not guaranteed for future batches, so the constraint accepts any
-- uppercase alphanumeric-and-hyphen serial that could plausibly be printed on a
-- label, and `batch_code` carries `2609` as DATA the operator supplies. When a
-- new batch format is confirmed, it needs no migration — only a test case.
--
-- ----------------------------------------------------------------------------
-- RESERVATIONS EXPIRE AFTER 14 DAYS, RECLAIMED LAZILY
-- ----------------------------------------------------------------------------
-- A reservation holds a unit for 14 days. Expiry is reclaimed during the claim
-- and list RPCs themselves, with `for update skip locked`, so correctness never
-- depends on a scheduler — the same shape `loyalty_expire_stale_enrollment_requests`
-- uses ("correct with or without a scheduled job"). A cron tick could be added
-- later as housekeeping and nothing here would change.

-- ----------------------------------------------------------------------------
-- 0. The confirmed batch segment of a serial
-- ----------------------------------------------------------------------------
/**
 * The batch segment of a CURRENT-BATCH serial, or NULL for anything else.
 *
 * The confirmed batch prints as `WP58-2609-001`. What `2609` ENCODES is not
 * established and this function does not guess: it returns the segment verbatim
 * so the caller can check the operator's batch code agrees with the label, and
 * nothing more.
 *
 * Returning NULL for any other shape is the whole point. A future batch format
 * is not this format, so no batch agreement is imposed on it — a new format
 * needs no migration, only a test. Meanwhile a serial that DOES look like the
 * confirmed batch must carry a matching batch code, so a typo in either field
 * cannot register a self-contradicting unit.
 *
 * IMMUTABLE so it can be used in a CHECK constraint.
 */
create or replace function public._printer_batch_code_from_serial (p_serial_number text)
returns text
language sql
immutable
as $$
  select case
    when upper (coalesce (p_serial_number, '')) ~ '^WP58-[0-9]{4}-[0-9]{3}$'
      then substring (upper (p_serial_number) from '^WP58-([0-9]{4})-')
    else null
  end
$$;

comment on function public._printer_batch_code_from_serial (text) is
  'The batch segment of a confirmed-format serial (WP58-2609-001 -> 2609), or '
  'NULL for any other format. Does not interpret the segment.';

revoke all on function public._printer_batch_code_from_serial (text) from public;
revoke all on function public._printer_batch_code_from_serial (text) from anon;
revoke all on function public._printer_batch_code_from_serial (text) from authenticated;

-- ----------------------------------------------------------------------------
-- 1. The physical units
-- ----------------------------------------------------------------------------
create table if not exists public.waka_printer_units (
  id uuid primary key default gen_random_uuid (),

  -- The serial printed on the unit's own label. IMMUTABLE after creation: it
  -- identifies a physical object, and rewriting it would detach the record from
  -- the printer in the customer's hands.
  serial_number text not null,

  model text not null default 'WP-58',
  paper_width_mm int not null default 58 check (paper_width_mm > 0),

  -- The batch the serial came from ('2609' for WP58-2609-001). Operator-supplied
  -- data, never derived — see the header.
  batch_code text,

  condition text not null default 'new'
    check (condition in ('new', 'refurbished', 'damaged', 'retired')),

  status text not null default 'available'
    check (status in ('available', 'reserved', 'assigned', 'damaged', 'retired')),

  -- Where the unit physically sits while it is ours. Nullable: stock may be in
  -- transit or not yet placed. `set null` so retiring a branch never blocks on
  -- stock records.
  held_at_shop_id uuid references public.shops (id) on delete set null,

  notes text,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now (),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now (),

  -- Structural, not batch-specific. Rejects blanks, lowercase, spaces and
  -- punctuation; accepts WP58-2609-001 and any future uppercase batch format.
  constraint waka_printer_units_serial_shape
    check (serial_number ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),

  -- THE BATCH AGREEMENT. For a serial in the confirmed format, the operator's
  -- batch code must equal the serial's own batch segment — writing the check
  -- this way round (`is null or ...`) is what makes it require the code to be
  -- PRESENT, rather than letting NULL slip through as unknown.
  --
  -- A future format returns NULL from the helper and is left unconstrained, so
  -- this rule can never reject a batch we have not been told about.
  constraint waka_printer_units_batch_matches_serial
    check (
      public._printer_batch_code_from_serial (serial_number) is null
      or (batch_code is not null
          and batch_code = public._printer_batch_code_from_serial (serial_number))
    ),

  -- A unit can only be reserved or assigned while it is fit to issue.
  constraint waka_printer_units_condition_status
    check (
      (status in ('damaged', 'retired') and condition in ('damaged', 'retired'))
      or (status in ('available', 'reserved', 'assigned') and condition in ('new', 'refurbished'))
    )
);

comment on table public.waka_printer_units is
  'WAKA-owned physical printer registry. One row per unit, identified by the '
  'serial on its own label. NEVER merchant inventory: no FK to products or '
  'inventory_movements, and no reporting path reads it.';
comment on column public.waka_printer_units.serial_number is
  'The serial printed on the physical label, verified by the operator who '
  'registered the unit. Globally unique. Immutable after creation.';

create unique index if not exists waka_printer_units_serial_uq
  on public.waka_printer_units (serial_number);

-- The allocation pool: available, fit-to-issue units in serial order, so the
-- lowest serial goes out first.
create index if not exists waka_printer_units_pool_idx
  on public.waka_printer_units (serial_number)
  where status = 'available';

create index if not exists waka_printer_units_held_idx
  on public.waka_printer_units (held_at_shop_id);

-- ----------------------------------------------------------------------------
-- 2. Fulfilment attempts — append-only history
-- ----------------------------------------------------------------------------
create table if not exists public.waka_printer_assignments (
  id uuid primary key default gen_random_uuid (),

  unit_id uuid not null references public.waka_printer_units (id) on delete restrict,

  -- NULLABLE, and `set null` rather than `cascade`, so a COMPLETED handover
  -- survives the organization being hard-deleted. Closing an account must stay
  -- possible, but it must not erase the record that a physical printer was
  -- issued — see the retention trigger below, which removes only the attempts
  -- that never became a handover.
  organization_id uuid references public.organizations (id) on delete set null,
  -- What the organization and the branch were CALLED at the moment of handover.
  -- A recorded fact, so the surviving record can still be read after the
  -- organizations row is gone.
  organization_name_snapshot text,
  shop_name_snapshot text,

  -- The branch that actually holds or handed over the unit. Supplied by the
  -- operator; never assumed.
  shop_id uuid references public.shops (id) on delete set null,
  -- The subscription that qualified the org, kept as evidence. `set null` so a
  -- subscription row can never be blocked by a fulfilment record.
  subscription_id uuid references public.subscriptions (id) on delete set null,

  -- What was being claimed. Separates "one printer per promotion" from "one
  -- printer ever", so a second promotion is a second claim.
  promotion_code text not null default 'business_annual_printer_v1',

  status text not null default 'reserved'
    check (status in ('reserved', 'ready_for_collection', 'handed_over',
                      'cancelled', 'failed_collection')),

  fulfilment_method text
    check (fulfilment_method in ('branch_collection', 'whatsapp_request', 'dispatched')),

  reserved_at timestamptz not null default now (),
  -- The lease. Every reservation carries one; see the 14-day policy above.
  reserved_until timestamptz,
  ready_at timestamptz,

  -- Handover evidence. Recorded separately from stock registration, because
  -- registering a unit and giving it to a customer are different acts by
  -- potentially different people.
  handed_over_at timestamptz,
  handed_over_by uuid references auth.users (id) on delete set null,
  received_by_name text,
  received_by_phone text,
  evidence_reference text,

  -- Why a claim ended without a handover.
  reason text,

  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),

  -- A handover is only a handover when all of it is present.
  constraint waka_printer_assignments_handover_complete
    check (
      status <> 'handed_over'
      or (handed_over_at is not null
          and handed_over_by is not null
          and received_by_name is not null
          and length (trim (received_by_name)) > 0
          and fulfilment_method is not null
          -- The snapshot is part of the record, so a surviving handover can
          -- always be attributed to a named account.
          and organization_name_snapshot is not null)
    ),

  -- A live claim must name its organization; only a completed handover may
  -- outlive it, which is the single case `organization_id` may be NULL in.
  constraint waka_printer_assignments_org_required_while_open
    check (status = 'handed_over' or organization_id is not null),

  -- An open claim always has a lease, so nothing can be held forever by accident.
  constraint waka_printer_assignments_open_has_lease
    check (status not in ('reserved', 'ready_for_collection') or reserved_until is not null)
);

comment on table public.waka_printer_assignments is
  'One row per fulfilment attempt against a physical printer. APPEND-ONLY '
  'history: a cancelled or expired claim is never rewritten, a fresh attempt is '
  'a new row. Customer-visible only through my_org_printer_assignments().';

-- THE TWO INVARIANTS THAT MUST NEVER BREAK.
-- One open printer per organization per promotion.
create unique index if not exists waka_printer_assignments_one_open_per_org
  on public.waka_printer_assignments (organization_id, promotion_code)
  where status in ('reserved', 'ready_for_collection', 'handed_over');

-- One open claim per physical unit.
create unique index if not exists waka_printer_assignments_one_open_per_unit
  on public.waka_printer_assignments (unit_id)
  where status in ('reserved', 'ready_for_collection', 'handed_over');

create index if not exists waka_printer_assignments_org_idx
  on public.waka_printer_assignments (organization_id, created_at desc);

-- The lazy-reclaim sweep's index.
create index if not exists waka_printer_assignments_expiry_idx
  on public.waka_printer_assignments (reserved_until)
  where status in ('reserved', 'ready_for_collection');

-- ----------------------------------------------------------------------------
-- 3. The state machine, enforced in the database
-- ----------------------------------------------------------------------------
-- The RPCs are the only writers, but a guard here is the backstop that does not
-- depend on any writer remembering — the same reasoning as
-- `subscription_payment_state_guard` and the loyalty enrollment transition
-- guard. It also makes the business rules true of the TABLE, not just of the
-- code path that happens to be current.
create or replace function public.waka_printer_assignment_guard ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'reserved' then
      raise exception 'printer_assignment_invalid_initial_status'
        using detail = format ('status=%s', new.status),
              hint = 'A fulfilment attempt starts as a reservation.';
    end if;
    if new.reserved_until is null then
      raise exception 'printer_assignment_reservation_requires_expiry';
    end if;
    -- A unit is only ever claimed out of the available pool.
    if not exists (
      select 1 from public.waka_printer_units u
      where u.id = new.unit_id and u.status = 'reserved' and u.condition in ('new', 'refurbished')
    ) then
      raise exception 'printer_unit_not_reservable'
        using detail = format ('unit_id=%s', new.unit_id);
    end if;
    return new;
  end if;

  -- Identity is immutable, so history cannot be rewritten onto another unit or
  -- another customer's organization.
  --
  -- THE ONE PERMITTED EXCEPTION is the organization being deleted: the FK's
  -- `on delete set null` detaches a COMPLETED handover, which arrives here as
  -- `organization_id -> null` on a handed_over row. Without this, the retention
  -- design would be blocked by the guard that protects it — the delete failed
  -- with `printer_assignment_is_immutable` until this clause existed. Only that
  -- exact direction is allowed: a null can never be filled back in, and an open
  -- claim still cannot be re-pointed at another account.
  if new.unit_id is distinct from old.unit_id
     or new.promotion_code is distinct from old.promotion_code
     or new.created_at is distinct from old.created_at
     or (new.organization_id is distinct from old.organization_id
         and not (old.status = 'handed_over'
                  and old.organization_id is not null
                  and new.organization_id is null)) then
    raise exception 'printer_assignment_is_immutable';
  end if;

  if new.status is distinct from old.status then
    -- `reserved -> handed_over` is legal: a customer who walks in and collects
    -- the printer does not need an intermediate "ready" step recorded first.
    if old.status = 'reserved'
       and new.status in ('ready_for_collection', 'handed_over', 'cancelled', 'failed_collection') then
      null; -- legal
    elsif old.status = 'ready_for_collection'
       and new.status in ('handed_over', 'cancelled', 'failed_collection') then
      null; -- legal
    else
      -- Includes every attempt to move a handed_over row: a completed handover
      -- is a historical fact and no later update may reverse it.
      raise exception 'printer_assignment_invalid_transition: % -> %', old.status, new.status;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.waka_printer_assignment_guard () is
  'Enforces the fulfilment state machine and the immutability of a completed '
  'handover. The backstop behind the RPCs, not a replacement for them.';

drop trigger if exists trg_waka_printer_assignment_guard on public.waka_printer_assignments;
create trigger trg_waka_printer_assignment_guard
  before insert or update on public.waka_printer_assignments
  for each row execute function public.waka_printer_assignment_guard ();

/**
 * When a fulfilment row disappears, hand the unit back ONLY if it was still only
 * reserved. A unit already handed over is left exactly as it is: the customer
 * physically has that printer, and the row's removal (an organization
 * hard-delete cascading) cannot un-issue it. Staff then correct that unit
 * deliberately rather than the database pretending it never left.
 */
create or replace function public.waka_printer_assignment_release_on_delete ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.waka_printer_units u
     set status = 'available', updated_at = now ()
   where u.id = old.unit_id
     and u.status = 'reserved';
  return old;
end;
$$;

drop trigger if exists trg_waka_printer_assignment_release on public.waka_printer_assignments;
create trigger trg_waka_printer_assignment_release
  after delete on public.waka_printer_assignments
  for each row execute function public.waka_printer_assignment_release_on_delete ();

/**
 * RETENTION ON ORGANIZATION DELETION.
 *
 * Two kinds of row, two different answers, and the difference is whether
 * anything physically happened to a customer:
 *
 *   * An UNFULFILLED attempt (reserved, ready_for_collection, cancelled,
 *     failed_collection) is not a record of an issued printer. It goes with the
 *     account, and the unit returns to the pool — via
 *     `waka_printer_assignment_release_on_delete`, which releases only a unit
 *     that is STILL `reserved` and therefore never left.
 *
 *   * A COMPLETED HANDOVER stays. The customer has the printer; deleting the
 *     account does not un-issue it. `organization_id` is `on delete set null`,
 *     so the row is detached rather than destroyed, and the name snapshot taken
 *     at handover keeps it readable.
 *
 * This runs BEFORE the organization row is deleted, so the FK action that
 * follows only ever sees the completed handovers.
 *
 * It deliberately does NOT block the delete: account closure must stay possible
 * without an operator first resolving a lapsed reservation.
 */
create or replace function public.waka_printer_org_delete_retain_history ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.waka_printer_assignments a
   where a.organization_id = old.id
     and a.status <> 'handed_over';
  return old;
end;
$$;

comment on function public.waka_printer_org_delete_retain_history () is
  'Drops unfulfilled printer attempts with their organization and detaches '
  'completed handovers (FK set null), so issued-printer history survives '
  'account deletion without blocking it.';

drop trigger if exists trg_waka_printer_org_delete_retain on public.organizations;
create trigger trg_waka_printer_org_delete_retain
  before delete on public.organizations
  for each row execute function public.waka_printer_org_delete_retain_history ();

revoke all on function public.waka_printer_org_delete_retain_history () from public;
revoke all on function public.waka_printer_org_delete_retain_history () from anon;
revoke all on function public.waka_printer_org_delete_retain_history () from authenticated;

-- ----------------------------------------------------------------------------
-- 4. Access posture — no client touches these tables directly
-- ----------------------------------------------------------------------------
alter table public.waka_printer_units enable row level security;
alter table public.waka_printer_assignments enable row level security;

-- No policies on purpose, and the table privileges are revoked too, so a future
-- policy cannot accidentally expose them (same posture as admin_plan_discounts
-- and subscription_free_activations). Every read goes through an RPC that has
-- already checked the caller.
revoke all on table public.waka_printer_units from public;
revoke all on table public.waka_printer_units from anon;
revoke all on table public.waka_printer_units from authenticated;
revoke all on table public.waka_printer_assignments from public;
revoke all on table public.waka_printer_assignments from anon;
revoke all on table public.waka_printer_assignments from authenticated;

-- ----------------------------------------------------------------------------
-- 5. Authorization — TWO SEPARATE GATES
-- ----------------------------------------------------------------------------
-- Registering stock and giving a printer to a customer are different acts with
-- different blast radius, so they get different gates. Neither invents a role.

/**
 * STOCK. super_admin + operations_admin — exactly `is_waka_internal_admin()`,
 * the narrowest existing gate that covers inventory. Registers units, corrects
 * them and retires them; never touches a customer.
 */
create or replace function public._printer_require_stock_admin ()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_admin () then
    raise exception 'forbidden';
  end if;
end;
$$;

comment on function public._printer_require_stock_admin () is
  'Gate for printer STOCK management: super_admin | operations_admin '
  '(is_waka_internal_admin). Deliberately narrower than the fulfilment gate.';

/**
 * FULFILMENT. Three roles, named explicitly — NOT delegated to
 * `_pricing_require_billing_admin()`.
 *
 * WHY IT IS NOT THE BILLING GATE. That gate admits four roles including
 * `finance_admin`. Handing a customer a physical printer worth real money is a
 * different act from pricing a subscription, and the billing array is the right
 * gate for the latter, not for this. `finance_admin` is therefore excluded by
 * name rather than inherited by accident.
 *
 * The roles here are the existing ones, not new ones:
 *   super_admin       — every internal control
 *   operations_admin  — runs field operations and branches, which is where a
 *                       handover physically happens
 *   subscriptions_admin — owns the subscription a claim is made against
 *
 * `support_admin` and `field_agent` are NOT included: they answer questions and
 * visit shops; neither issues hardware. That also keeps this array a strict
 * subset of the billing gate, so nobody gains access they did not already have.
 *
 * PHASE 2 MUST MIRROR THIS IN `src/components/internal-admin/v2/adminRoles.ts`
 * as a dedicated flag (e.g. `canManagePrinterFulfilment`) with this exact array
 * — not by reusing `canManageBillingOffers`, which would show the console to a
 * finance_admin the server then refuses.
 */
create or replace function public._printer_require_fulfilment_admin ()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_role (
    array['super_admin', 'subscriptions_admin', 'operations_admin']::text[]
  ) then
    raise exception 'forbidden';
  end if;
end;
$$;

comment on function public._printer_require_fulfilment_admin () is
  'Gate for printer FULFILMENT (assign / ready / handover / cancel): '
  'super_admin | subscriptions_admin | operations_admin. Deliberately excludes '
  'finance_admin, support_admin and field_agent.';

create or replace function public._printer_audit (p_action text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Checks the caller itself, like `_pricing_audit`: an audit row can only be
  -- written by an authorized internal admin, whoever calls this.
  --
  -- The UNION of the stock and fulfilment gates, which is exactly the set of
  -- roles that can reach a printer RPC at all — so the audit trail can never be
  -- written by a role that has no printer permission. `finance_admin` is absent
  -- on purpose: it holds neither gate.
  if not public.is_waka_internal_role (
    array['super_admin', 'subscriptions_admin', 'operations_admin']::text[]
  ) then
    raise exception 'forbidden';
  end if;

  insert into public.internal_ops_admin_audit (actor, action, payload)
  values (auth.uid (), p_action, coalesce (p_payload, '{}'::jsonb) || jsonb_build_object ('at', now ()));
end;
$$;

-- Internal only. Clients reach these through the RPCs below.
revoke all on function public._printer_require_stock_admin () from public;
revoke all on function public._printer_require_stock_admin () from anon;
revoke all on function public._printer_require_stock_admin () from authenticated;
revoke all on function public._printer_require_fulfilment_admin () from public;
revoke all on function public._printer_require_fulfilment_admin () from anon;
revoke all on function public._printer_require_fulfilment_admin () from authenticated;
revoke all on function public._printer_audit (text, jsonb) from public;
revoke all on function public._printer_audit (text, jsonb) from anon;
revoke all on function public._printer_audit (text, jsonb) from authenticated;
revoke all on function public.waka_printer_assignment_guard () from public;
revoke all on function public.waka_printer_assignment_guard () from anon;
revoke all on function public.waka_printer_assignment_guard () from authenticated;
revoke all on function public.waka_printer_assignment_release_on_delete () from public;
revoke all on function public.waka_printer_assignment_release_on_delete () from anon;
revoke all on function public.waka_printer_assignment_release_on_delete () from authenticated;

-- ----------------------------------------------------------------------------
-- 6. Eligibility — ONE definition, read from the subscription row
-- ----------------------------------------------------------------------------
/**
 * Is this subscription the qualifying promotion purchase?
 *
 * A purchase qualifies when it is ACTIVE, BILLED ANNUALLY, on BUSINESS, and has
 * a future period end. Read from the SUBSCRIPTION ROW, which matters:
 *
 *   * a default monthly Business trial is `status='trial'` → ineligible;
 *   * an expired or past-due subscription → ineligible;
 *   * a PROMOTIONAL GRANT cannot qualify anyone on its own, because a grant is
 *     an overlay resolved by `shop_effective_plan_code` and never changes this
 *     row's plan or interval. A Starter shop granted Business is still Starter
 *     here, and is correctly refused.
 *
 * Deliberately not `shop_effective_plan_code()`: that answers "what can this
 * shop use", and this must answer "what did this organization actually buy".
 */
create or replace function public._printer_promotion_eligible (p_subscription_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.subscriptions s
    join public.subscription_plans sp on sp.id = s.plan_id
    where s.id = p_subscription_id
      and s.status = 'active'
      and s.billing_interval = 'year'
      and s.current_period_end is not null
      and s.current_period_end > now ()
      and lower (sp.code) = 'business'
  );
$$;

comment on function public._printer_promotion_eligible (uuid) is
  'The single eligibility rule: active + annual + business + future period end, '
  'read from the subscription ROW so a promotional grant alone cannot qualify.';

revoke all on function public._printer_promotion_eligible (uuid) from public;
revoke all on function public._printer_promotion_eligible (uuid) from anon;
revoke all on function public._printer_promotion_eligible (uuid) from authenticated;

-- ----------------------------------------------------------------------------
-- 7. Lazy reclamation of expired reservations
-- ----------------------------------------------------------------------------
/**
 * Release reservations whose 14-day lease has passed.
 *
 * Called at the top of the claim and list RPCs so the system is correct with or
 * without a scheduled job. `for update skip locked` so a sweep never blocks on a
 * live contender and two sweeps cannot fight over one row.
 *
 * The unit is released ONLY when it is still `reserved` — i.e. the physical
 * printer has demonstrably not left. A unit that is `assigned` is never touched
 * here, so an expiry can never take back a printer that was already handed over.
 */
create or replace function public._printer_reclaim_expired_reservations ()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_released int := 0;
  v_now timestamptz := now ();
begin
  for v_row in
    select a.id, a.unit_id, a.organization_id, a.promotion_code, a.status
      from public.waka_printer_assignments a
     where a.status in ('reserved', 'ready_for_collection')
       and a.reserved_until is not null
       and a.reserved_until < v_now
       for update skip locked
  loop
    update public.waka_printer_assignments a
       set status = 'failed_collection',
           reason = coalesce (nullif (trim (a.reason), ''), 'reservation_expired'),
           updated_at = v_now
     where a.id = v_row.id
       and a.status in ('reserved', 'ready_for_collection');

    -- Only a unit still merely reserved goes back in the pool.
    update public.waka_printer_units u
       set status = 'available', updated_at = v_now
     where u.id = v_row.unit_id
       and u.status = 'reserved';

    v_released := v_released + 1;
  end loop;

  if v_released > 0 then
    insert into public.internal_ops_admin_audit (actor, action, payload)
    values (auth.uid (), 'printer_reservation_expired',
            jsonb_build_object ('released', v_released, 'at', v_now));
  end if;

  return v_released;
end;
$$;

comment on function public._printer_reclaim_expired_reservations () is
  'Lazy sweep: expires reservations past reserved_until, releasing the unit only '
  'when it is still merely reserved. Called from the claim and list RPCs.';

revoke all on function public._printer_reclaim_expired_reservations () from public;
revoke all on function public._printer_reclaim_expired_reservations () from anon;
revoke all on function public._printer_reclaim_expired_reservations () from authenticated;

-- ----------------------------------------------------------------------------
-- 8. STOCK RPCs — register, correct, retire
-- ----------------------------------------------------------------------------
create or replace function public.internal_ops_printer_unit_create (
  p_serial_number text,
  p_batch_code text default null,
  p_held_at_shop_id uuid default null,
  p_notes text default null,
  p_model text default 'WP-58',
  p_paper_width_mm int default 58,
  p_condition text default 'new'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_serial text := upper (trim (coalesce (p_serial_number, '')));
  v_condition text := lower (trim (coalesce (p_condition, 'new')));
  v_batch text := nullif (trim (coalesce (p_batch_code, '')), '');
  v_expected_batch text;
  v_unit_id uuid;
  v_shop_status text;
begin
  perform public._printer_require_stock_admin ();

  -- The operator types what is printed on the label. Nothing is generated.
  if v_serial = '' then
    return jsonb_build_object ('ok', false, 'error', 'serial_required');
  end if;
  if v_serial !~ '^[A-Z0-9][A-Z0-9-]{2,31}$' then
    return jsonb_build_object (
      'ok', false,
      'error', 'serial_malformed',
      'hint', 'Uppercase letters, digits and hyphens only, as printed on the label.'
    );
  end if;

  if v_condition not in ('new', 'refurbished') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_condition');
  end if;

  if p_paper_width_mm is null or p_paper_width_mm <= 0 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_paper_width');
  end if;

  -- The batch code must agree with the serial's OWN batch segment when the
  -- serial is in the confirmed format. Checked here for a readable refusal; the
  -- table CHECK is the backstop. A future format yields NULL and is not
  -- constrained, so a new batch is never rejected by a rule written for this one.
  v_expected_batch := public._printer_batch_code_from_serial (v_serial);
  if v_expected_batch is not null and v_batch is distinct from v_expected_batch then
    return jsonb_build_object (
      'ok', false,
      'error', 'batch_code_mismatch',
      'expected_batch_code', v_expected_batch,
      'hint', 'The batch code must match the batch segment of the serial on the label.'
    );
  end if;

  -- A unit may only be recorded as held at a branch that exists and is not
  -- archived. No branch is ever assumed.
  if p_held_at_shop_id is not null then
    select s.branch_status into v_shop_status from public.shops s where s.id = p_held_at_shop_id;
    if v_shop_status is null then
      return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
    end if;
    if v_shop_status <> 'active' then
      return jsonb_build_object ('ok', false, 'error', 'shop_not_active');
    end if;
  end if;

  begin
    insert into public.waka_printer_units (
      serial_number, model, paper_width_mm, batch_code, condition, status,
      held_at_shop_id, notes, created_by, updated_by
    )
    values (
      v_serial, coalesce (nullif (trim (p_model), ''), 'WP-58'), p_paper_width_mm,
      v_batch, v_condition, 'available',
      p_held_at_shop_id, nullif (trim (coalesce (p_notes, '')), ''), auth.uid (), auth.uid ()
    )
    returning id into v_unit_id;
  exception
    when unique_violation then
      return jsonb_build_object ('ok', false, 'error', 'serial_exists', 'serial_number', v_serial);
  end;

  perform public._printer_audit (
    'printer_unit_registered',
    jsonb_build_object (
      'unit_id', v_unit_id, 'serial_number', v_serial,
      'batch_code', nullif (trim (coalesce (p_batch_code, '')), ''),
      'condition', v_condition, 'held_at_shop_id', p_held_at_shop_id
    )
  );

  return jsonb_build_object (
    'ok', true, 'unit_id', v_unit_id, 'serial_number', v_serial, 'status', 'available'
  );
end;
$$;

/**
 * Correct permitted unit metadata. The SERIAL is not in the parameter list and
 * cannot be changed: it identifies a physical object, and rewriting it would
 * detach the record from the printer in the customer's hands.
 *
 * Refused while the unit is out with a customer (`assigned`), because that is a
 * record of something that physically happened.
 */
create or replace function public.internal_ops_printer_unit_update (
  p_unit_id uuid,
  p_reason text,
  p_condition text default null,
  p_batch_code text default null,
  p_held_at_shop_id uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.waka_printer_units;
  v_condition text := nullif (lower (trim (coalesce (p_condition, ''))), '');
  v_reason text := nullif (trim (coalesce (p_reason, '')), '');
  v_batch text := nullif (trim (coalesce (p_batch_code, '')), '');
  v_expected_batch text;
  v_shop_status text;
begin
  perform public._printer_require_stock_admin ();

  if v_reason is null or length (v_reason) < 3 then
    return jsonb_build_object ('ok', false, 'error', 'reason_required');
  end if;

  select * into v_unit from public.waka_printer_units u where u.id = p_unit_id;
  if v_unit.id is null then
    return jsonb_build_object ('ok', false, 'error', 'unit_not_found');
  end if;

  if v_unit.status = 'assigned' then
    return jsonb_build_object ('ok', false, 'error', 'unit_assigned');
  end if;

  -- The serial cannot change, so the batch agreement is checked against the
  -- serial already on the row. Clearing the batch code on a confirmed-format
  -- serial is refused here rather than surfacing a raw constraint violation.
  v_expected_batch := public._printer_batch_code_from_serial (v_unit.serial_number);
  if v_expected_batch is not null and v_batch is distinct from v_expected_batch then
    return jsonb_build_object (
      'ok', false,
      'error', 'batch_code_mismatch',
      'expected_batch_code', v_expected_batch
    );
  end if;

  if v_condition is not null then
    if v_condition not in ('new', 'refurbished', 'damaged') then
      return jsonb_build_object ('ok', false, 'error', 'invalid_condition');
    end if;
    if v_unit.status in ('reserved', 'assigned') and v_condition = 'damaged' then
      return jsonb_build_object ('ok', false, 'error', 'unit_reserved');
    end if;
  end if;

  if p_held_at_shop_id is not null then
    select s.branch_status into v_shop_status from public.shops s where s.id = p_held_at_shop_id;
    if v_shop_status is null then
      return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
    end if;
    if v_shop_status <> 'active' then
      return jsonb_build_object ('ok', false, 'error', 'shop_not_active');
    end if;
  end if;

  update public.waka_printer_units u
     set condition = coalesce (v_condition, u.condition),
         batch_code = v_batch,
         held_at_shop_id = p_held_at_shop_id,
         notes = nullif (trim (coalesce (p_notes, '')), ''),
         updated_by = auth.uid (),
         updated_at = now ()
   where u.id = p_unit_id;

  perform public._printer_audit (
    'printer_unit_updated',
    jsonb_build_object (
      'unit_id', p_unit_id, 'serial_number', v_unit.serial_number, 'reason', v_reason,
      'before', jsonb_build_object (
        'condition', v_unit.condition, 'batch_code', v_unit.batch_code,
        'held_at_shop_id', v_unit.held_at_shop_id, 'notes', v_unit.notes
      ),
      'after', jsonb_build_object (
        'condition', coalesce (v_condition, v_unit.condition),
        'batch_code', v_batch,
        'held_at_shop_id', p_held_at_shop_id,
        'notes', nullif (trim (coalesce (p_notes, '')), '')
      )
    )
  );

  return jsonb_build_object ('ok', true, 'unit_id', p_unit_id);
end;
$$;

create or replace function public.internal_ops_printer_unit_retire (p_unit_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.waka_printer_units;
  v_reason text := nullif (trim (coalesce (p_reason, '')), '');
begin
  perform public._printer_require_stock_admin ();

  if v_reason is null or length (v_reason) < 3 or length (v_reason) > 300 then
    return jsonb_build_object ('ok', false, 'error', 'reason_required');
  end if;

  select * into v_unit from public.waka_printer_units u where u.id = p_unit_id for update;
  if v_unit.id is null then
    return jsonb_build_object ('ok', false, 'error', 'unit_not_found');
  end if;

  if v_unit.status = 'retired' then
    return jsonb_build_object ('ok', true, 'idempotent', true, 'unit_id', p_unit_id);
  end if;

  -- An open claim, or a unit already out with a customer, must be resolved
  -- first: retiring it silently would leave a live assignment pointing at a
  -- printer the business believes it has withdrawn.
  if v_unit.status in ('reserved', 'assigned') then
    return jsonb_build_object ('ok', false, 'error', 'unit_committed');
  end if;

  update public.waka_printer_units u
     set status = 'retired', condition = 'retired', updated_by = auth.uid (), updated_at = now ()
   where u.id = p_unit_id;

  perform public._printer_audit (
    'printer_unit_retired',
    jsonb_build_object ('unit_id', p_unit_id, 'serial_number', v_unit.serial_number,
                        'previous_status', v_unit.status, 'reason', v_reason)
  );

  return jsonb_build_object ('ok', true, 'unit_id', p_unit_id, 'status', 'retired');
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. FULFILMENT RPCs
-- ----------------------------------------------------------------------------
/**
 * Claim one printer for an eligible organization.
 *
 * ATOMIC. The candidate is taken with `for update skip locked`, so two
 * concurrent claims take two DIFFERENT units instead of one blocking the other;
 * the status predicate on the update is the actual gate; and the two partial
 * unique indexes are the durable backstop if anything ever raced past the lock.
 * Everything — expiry sweep, unit reservation, assignment insert — is one
 * transaction.
 */
create or replace function public.internal_ops_printer_assign (
  p_shop_id uuid,
  p_promotion_code text default 'business_annual_printer_v1',
  p_reservation_days int default 14
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_shop_status text;
  v_sub_id uuid;
  v_promo text := coalesce (nullif (trim (p_promotion_code), ''), 'business_annual_printer_v1');
  v_days int := greatest (coalesce (p_reservation_days, 14), 1);
  v_unit_id uuid;
  v_unit_status text;
  v_claimed uuid;
  v_assignment_id uuid;
  v_constraint text;
  v_expired int;
begin
  perform public._printer_require_fulfilment_admin ();

  select s.organization_id, s.branch_status into v_org, v_shop_status
    from public.shops s where s.id = p_shop_id;

  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;
  if v_shop_status <> 'active' then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_active');
  end if;

  -- Expired reservations are reclaimed before we look at the pool, so a lapsed
  -- claim never keeps a printer out of circulation.
  v_expired := public._printer_reclaim_expired_reservations ();

  -- THE SHARED RESOLVER, not a re-implementation: the same row the money paths
  -- price from.
  v_sub_id := public._subscription_latest_for_org (v_org);

  if v_sub_id is null then
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  if not public._printer_promotion_eligible (v_sub_id) then
    return jsonb_build_object ('ok', false, 'error', 'not_eligible');
  end if;

  -- One open printer per organization per promotion. The unique index enforces
  -- it; this returns a readable refusal instead of a constraint error.
  if exists (
    select 1 from public.waka_printer_assignments a
    where a.organization_id = v_org
      and a.promotion_code = v_promo
      and a.status in ('reserved', 'ready_for_collection', 'handed_over')
  ) then
    return jsonb_build_object ('ok', false, 'error', 'already_assigned');
  end if;

  -- Lowest serial first, so units leave the shelf in order.
  select u.id, u.status into v_unit_id, v_unit_status
    from public.waka_printer_units u
   where u.status = 'available'
     and u.condition in ('new', 'refurbished')
   order by u.serial_number
   limit 1
   for update skip locked;

  if v_unit_id is null then
    return jsonb_build_object ('ok', false, 'error', 'no_unit_available');
  end if;

  -- The status predicate IS the gate: if another session claimed this unit
  -- between the select and here, nothing matches and we refuse.
  update public.waka_printer_units u
     set status = 'reserved', updated_by = auth.uid (), updated_at = now ()
   where u.id = v_unit_id
     and u.status = 'available'
  returning u.id into v_claimed;

  if v_claimed is null then
    return jsonb_build_object ('ok', false, 'error', 'unit_taken');
  end if;

  begin
    insert into public.waka_printer_assignments (
      unit_id, organization_id, shop_id, subscription_id, promotion_code,
      status, reserved_at, reserved_until
    )
    values (
      v_unit_id, v_org, p_shop_id, v_sub_id, v_promo,
      'reserved', now (), now () + make_interval (days => v_days)
    )
    returning id into v_assignment_id;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- Roll the reservation back by refusing; the transaction unwinds with us.
      if v_constraint = 'waka_printer_assignments_one_open_per_org' then
        return jsonb_build_object ('ok', false, 'error', 'already_assigned');
      end if;
      return jsonb_build_object ('ok', false, 'error', 'unit_taken');
  end;

  perform public._printer_audit (
    'printer_assigned',
    jsonb_build_object (
      'assignment_id', v_assignment_id, 'unit_id', v_unit_id,
      'organization_id', v_org, 'shop_id', p_shop_id,
      'subscription_id', v_sub_id, 'promotion_code', v_promo,
      'reservation_days', v_days, 'expired_reclaimed', v_expired
    )
  );

  return jsonb_build_object (
    'ok', true, 'assignment_id', v_assignment_id, 'unit_id', v_unit_id,
    'organization_id', v_org, 'promotion_code', v_promo, 'status', 'reserved',
    'reserved_until', now () + make_interval (days => v_days)
  );
end;
$$;

create or replace function public.internal_ops_printer_mark_ready (
  p_assignment_id uuid,
  p_shop_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.waka_printer_assignments;
  v_shop_status text;
begin
  perform public._printer_require_fulfilment_admin ();

  select * into v_row from public.waka_printer_assignments a where a.id = p_assignment_id for update;
  if v_row.id is null then
    return jsonb_build_object ('ok', false, 'error', 'assignment_not_found');
  end if;

  if v_row.status <> 'reserved' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_state', 'status', v_row.status);
  end if;

  if p_shop_id is not null then
    select s.branch_status into v_shop_status from public.shops s where s.id = p_shop_id;
    if v_shop_status is null then
      return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
    end if;
    if v_shop_status <> 'active' then
      return jsonb_build_object ('ok', false, 'error', 'shop_not_active');
    end if;
  end if;

  update public.waka_printer_assignments a
     set status = 'ready_for_collection',
         shop_id = coalesce (p_shop_id, a.shop_id),
         ready_at = now (),
         updated_at = now ()
   where a.id = p_assignment_id;

  perform public._printer_audit (
    'printer_ready_for_collection',
    jsonb_build_object ('assignment_id', p_assignment_id, 'unit_id', v_row.unit_id,
                        'organization_id', v_row.organization_id,
                        'shop_id', coalesce (p_shop_id, v_row.shop_id))
  );

  return jsonb_build_object ('ok', true, 'assignment_id', p_assignment_id, 'status', 'ready_for_collection');
end;
$$;

/**
 * Record the ACTUAL handover. This is the only path that makes a unit `assigned`.
 *
 * The branch is supplied by the operator who performed the handover, and is
 * required — we record where the printer was really collected from, and never
 * infer it. Recipient, actor, timestamp, method and an evidence reference are
 * stored separately from stock registration, because registering a unit and
 * giving it away are different acts.
 */
create or replace function public.internal_ops_printer_handover (
  p_assignment_id uuid,
  p_shop_id uuid,
  p_received_by_name text,
  p_fulfilment_method text,
  p_received_by_phone text default null,
  p_evidence_reference text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.waka_printer_assignments;
  v_recipient text := nullif (trim (coalesce (p_received_by_name, '')), '');
  v_method text := lower (trim (coalesce (p_fulfilment_method, '')));
  v_shop_status text;
  v_shop_name text;
  v_org_name text;
begin
  perform public._printer_require_fulfilment_admin ();

  if v_recipient is null then
    return jsonb_build_object ('ok', false, 'error', 'recipient_required');
  end if;
  if v_method not in ('branch_collection', 'whatsapp_request', 'dispatched') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_fulfilment_method');
  end if;
  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'collection_branch_required');
  end if;

  -- The branch name is read here so it can be SNAPSHOT onto the record below:
  -- once a handover survives its organization, the shops row is gone and the
  -- name has to have been captured at the moment of the physical event.
  select s.branch_status, s.name into v_shop_status, v_shop_name
    from public.shops s where s.id = p_shop_id;
  if v_shop_status is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;
  if v_shop_status <> 'active' then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_active');
  end if;

  select * into v_row from public.waka_printer_assignments a where a.id = p_assignment_id for update;
  if v_row.id is null then
    return jsonb_build_object ('ok', false, 'error', 'assignment_not_found');
  end if;

  if v_row.status = 'handed_over' then
    return jsonb_build_object ('ok', false, 'error', 'already_handed_over');
  end if;
  if v_row.status not in ('reserved', 'ready_for_collection') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_state', 'status', v_row.status);
  end if;

  -- The organization of the receiving branch must be the organization the
  -- printer is owed to, so a unit cannot be handed to the wrong customer.
  if not exists (
    select 1 from public.shops s
    where s.id = p_shop_id and s.organization_id = v_row.organization_id
  ) then
    return jsonb_build_object ('ok', false, 'error', 'collection_branch_not_organization');
  end if;

  -- The account name at the moment of handover.
  select o.name into v_org_name from public.organizations o where o.id = v_row.organization_id;

  update public.waka_printer_assignments a
     set status = 'handed_over',
         shop_id = p_shop_id,
         -- Written once, here, and never updated afterwards: they record what the
         -- account and branch were called when the printer changed hands.
         organization_name_snapshot = coalesce (v_org_name, 'unknown account'),
         shop_name_snapshot = v_shop_name,
         fulfilment_method = v_method,
         handed_over_at = now (),
         handed_over_by = auth.uid (),
         received_by_name = v_recipient,
         received_by_phone = nullif (trim (coalesce (p_received_by_phone, '')), ''),
         evidence_reference = nullif (trim (coalesce (p_evidence_reference, '')), ''),
         reason = nullif (trim (coalesce (p_note, '')), ''),
         updated_at = now ()
   where a.id = p_assignment_id;

  -- The unit leaves the pool. The status predicate makes this a no-op if it was
  -- already taken out of `reserved` by something else, instead of overwriting a
  -- state we do not understand.
  update public.waka_printer_units u
     set status = 'assigned', updated_by = auth.uid (), updated_at = now ()
   where u.id = v_row.unit_id
     and u.status = 'reserved';

  perform public._printer_audit (
    'printer_handed_over',
    jsonb_build_object (
      'assignment_id', p_assignment_id, 'unit_id', v_row.unit_id,
      'organization_id', v_row.organization_id, 'collection_shop_id', p_shop_id,
      'fulfilment_method', v_method, 'received_by_name', v_recipient,
      'received_by_phone', nullif (trim (coalesce (p_received_by_phone, '')), ''),
      'evidence_reference', nullif (trim (coalesce (p_evidence_reference, '')), ''),
      'previous_status', v_row.status
    )
  );

  return jsonb_build_object (
    'ok', true, 'assignment_id', p_assignment_id, 'unit_id', v_row.unit_id,
    'status', 'handed_over', 'collection_shop_id', p_shop_id
  );
end;
$$;

/**
 * Cancel an UNFULFILLED claim. Staff-authorized in Phase 1: a customer who
 * changes their mind reaches support through the documented WhatsApp route.
 *
 * A handed-over claim can never be cancelled — the physical printer is with the
 * customer and a completed handover is a historical fact. The unit returns to
 * the pool ONLY when it is still `reserved`, which proves it never left.
 */
create or replace function public.internal_ops_printer_assignment_cancel (
  p_assignment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.waka_printer_assignments;
  v_reason text := nullif (trim (coalesce (p_reason, '')), '');
  v_released uuid;
begin
  perform public._printer_require_fulfilment_admin ();

  if v_reason is null or length (v_reason) < 3 or length (v_reason) > 300 then
    return jsonb_build_object ('ok', false, 'error', 'reason_required');
  end if;

  select * into v_row from public.waka_printer_assignments a where a.id = p_assignment_id for update;
  if v_row.id is null then
    return jsonb_build_object ('ok', false, 'error', 'assignment_not_found');
  end if;

  if v_row.status = 'handed_over' then
    return jsonb_build_object ('ok', false, 'error', 'already_handed_over');
  end if;
  if v_row.status not in ('reserved', 'ready_for_collection') then
    return jsonb_build_object ('ok', true, 'idempotent', true, 'status', v_row.status);
  end if;

  update public.waka_printer_assignments a
     set status = 'cancelled', reason = v_reason, updated_at = now ()
   where a.id = p_assignment_id;

  update public.waka_printer_units u
     set status = 'available', updated_by = auth.uid (), updated_at = now ()
   where u.id = v_row.unit_id
     and u.status = 'reserved'
  returning u.id into v_released;

  perform public._printer_audit (
    'printer_assignment_cancelled',
    jsonb_build_object (
      'assignment_id', p_assignment_id, 'unit_id', v_row.unit_id,
      'organization_id', v_row.organization_id, 'previous_status', v_row.status,
      'unit_released', v_released is not null, 'reason', v_reason
    )
  );

  return jsonb_build_object (
    'ok', true, 'assignment_id', p_assignment_id, 'status', 'cancelled',
    'unit_released', v_released is not null
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. Reads
-- ----------------------------------------------------------------------------
/**
 * A customer's own fulfilment records, and nothing else. Scoped by
 * `organization_members` exactly like `my_org_billing_offers()`, so it can only
 * ever answer for the caller's own organizations.
 */
create or replace function public.my_org_printer_assignments ()
returns jsonb
language plpgsql
-- VOLATILE, deliberately. This read SWEEPS expired reservations before it
-- answers (see the reclaim call below), so it writes. Marking it STABLE would
-- promise the planner it does not, which is how a statement gets cached or
-- short-circuited around a side effect that the 14-day policy depends on.
security definer
set search_path = public
as $$
declare
  v_orgs uuid[];
  v_rows jsonb;
begin
  if auth.uid () is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  perform public._printer_reclaim_expired_reservations ();

  select array_agg (om.organization_id)
    into v_orgs
    from public.organization_members om
   where om.user_id = auth.uid ();

  if v_orgs is null then
    return jsonb_build_object ('ok', true, 'assignments', '[]'::jsonb);
  end if;

  select coalesce (jsonb_agg (
           jsonb_build_object (
             'assignment_id', a.id,
             'status', a.status,
             'promotion_code', a.promotion_code,
             'serial_number', u.serial_number,
             'model', u.model,
             'paper_width_mm', u.paper_width_mm,
             'reserved_at', a.reserved_at,
             'reserved_until', a.reserved_until,
             'ready_at', a.ready_at,
             'handed_over_at', a.handed_over_at,
             'fulfilment_method', a.fulfilment_method,
             'collection_shop_id', a.shop_id,
             'collection_shop_name', s.name
           )
           order by a.created_at desc
         ), '[]'::jsonb)
    into v_rows
    from public.waka_printer_assignments a
    join public.waka_printer_units u on u.id = a.unit_id
    left join public.shops s on s.id = a.shop_id
   where a.organization_id = any (v_orgs);

  return jsonb_build_object ('ok', true, 'assignments', v_rows);
end;
$$;

/**
 * Internal inventory view: units, counts, and the open assignments a console
 * needs to act on. No customer can reach this.
 */
create or replace function public.internal_ops_printer_inventory (
  p_status text default null,
  p_limit int default 200
)
returns jsonb
language plpgsql
-- VOLATILE for the same reason as my_org_printer_assignments: the console's
-- view of the pool reclaims expired reservations first, so a "reserved" row it
-- shows is one that is genuinely still held.
security definer
set search_path = public
as $$
declare
  v_status text := nullif (lower (trim (coalesce (p_status, ''))), '');
  v_limit int := least (greatest (coalesce (p_limit, 200), 1), 1000);
  v_counts jsonb;
  v_units jsonb;
  v_assignments jsonb;
begin
  perform public._printer_require_fulfilment_admin ();

  if v_status is not null
     and v_status not in ('available', 'reserved', 'assigned', 'damaged', 'retired') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_status');
  end if;

  -- Reclaim before reading, so the counts and the open list the console acts on
  -- reflect reality rather than a lease that lapsed yesterday.
  perform public._printer_reclaim_expired_reservations ();

  select jsonb_object_agg (t.status, t.n)
    into v_counts
    from (
      select u.status, count(*)::int as n
        from public.waka_printer_units u
       group by u.status
    ) t;

  select coalesce (jsonb_agg (
           jsonb_build_object (
             'unit_id', u.id, 'serial_number', u.serial_number, 'model', u.model,
             'paper_width_mm', u.paper_width_mm, 'batch_code', u.batch_code,
             'condition', u.condition, 'status', u.status,
             'held_at_shop_id', u.held_at_shop_id, 'notes', u.notes,
             'created_at', u.created_at, 'updated_at', u.updated_at
           )
           order by u.serial_number
         ), '[]'::jsonb)
    into v_units
    from (
      select * from public.waka_printer_units u2
       where v_status is null or u2.status = v_status
       order by u2.serial_number
       limit v_limit
    ) u;

  select coalesce (jsonb_agg (
           jsonb_build_object (
             'assignment_id', a.id, 'status', a.status,
             'unit_id', a.unit_id, 'serial_number', u.serial_number,
             'organization_id', a.organization_id, 'shop_id', a.shop_id,
             'promotion_code', a.promotion_code, 'reserved_until', a.reserved_until,
             'created_at', a.created_at
           )
           order by a.created_at
         ), '[]'::jsonb)
    into v_assignments
    from public.waka_printer_assignments a
    join public.waka_printer_units u on u.id = a.unit_id
   where a.status in ('reserved', 'ready_for_collection');

  return jsonb_build_object (
    'ok', true,
    'counts', coalesce (v_counts, '{}'::jsonb),
    'units', v_units,
    'open_assignments', v_assignments,
    'as_of', now ()
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 11. Grants
-- ----------------------------------------------------------------------------
do $grants$
declare
  sig text;
begin
  foreach sig in array array[
    'public.internal_ops_printer_unit_create (text, text, uuid, text, text, integer, text)',
    'public.internal_ops_printer_unit_update (uuid, text, text, text, uuid, text)',
    'public.internal_ops_printer_unit_retire (uuid, text)',
    'public.internal_ops_printer_assign (uuid, text, integer)',
    'public.internal_ops_printer_mark_ready (uuid, uuid)',
    'public.internal_ops_printer_handover (uuid, uuid, text, text, text, text, text)',
    'public.internal_ops_printer_assignment_cancel (uuid, text)',
    'public.my_org_printer_assignments ()',
    'public.internal_ops_printer_inventory (text, integer)'
  ] loop
    execute format ('revoke all on function %s from public', sig);
    execute format ('revoke all on function %s from anon', sig);
    execute format ('grant execute on function %s to authenticated', sig);
  end loop;
end;
$grants$;

notify pgrst, 'reload schema';

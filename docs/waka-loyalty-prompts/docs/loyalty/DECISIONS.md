# WAKA POS Loyalty — Architecture Decisions

This file records important decisions made during implementation.

## Decision 001 — Loyalty Is Separate From Financial Accounting

**Status:** Accepted

WAKA's existing sales, inventory, COGS, payment, refund, void, and financial systems remain the financial source of truth.

Loyalty consumes completed POS events and maintains its own auditable points ledger.

## Decision 002 — Completed Sales Trigger Points

**Status:** Accepted

Points are awarded only after the applicable POS sale is successfully completed.

A cart or pending payment does not earn points.

## Decision 003 — Points Are Auditable

**Status:** Accepted

The system must retain historical points transactions for earning, redemption, reversal, expiration, adjustment, and promotion where implemented.

A mutable balance alone is insufficient.

## Decision 004 — Spend-Based Is the Initial Default

**Status:** Accepted

The initial loyalty model is spend-based points, such as:

`UGX 1,000 eligible spend = 1 point`

The architecture must remain extensible for visit, product, and promotional rules.

## Decision 005 — QR Is the Universal Fallback

**Status:** Accepted

NFC may provide a faster tap experience where technically supported, but QR remains available for broad device compatibility.

## Decision 006 — Wallet Means Loyalty Pass

**Status:** Accepted

Google Wallet and Apple Wallet are treated as loyalty-card/pass destinations. Apple Pay payment functionality is outside the initial scope.

## Decision 007 — Idempotency Is Mandatory

**Status:** Accepted

A source sale must not create duplicate points because of retries, offline sync, concurrency, app restarts, or repeated callbacks.

Enforcement must not depend solely on frontend state.

## Decision 008 — Merchant Isolation

**Status:** Accepted

Loyalty data is merchant/shop scoped unless a future explicitly designed cross-merchant program changes this model.

## Additional Decisions

Add new numbered decisions below as implementation progresses.

## Decision 009 — Legacy `customers.loyalty_points` Is Deprecated

**Status:** Accepted (Phase 01 audit finding)

The base schema (`005_customers_and_sales.sql`) ships a
`loyalty_points numeric(18,4)` column, but no application code reads or
writes it (verified by repository-wide grep). The new loyalty system uses an
auditable ledger (`loyalty_transactions`) with a cached balance on
`loyalty_accounts` as the only source of truth. New code must never write
`customers.loyalty_points`; whether it is later mirrored or dropped is a
Phase 09 cleanup decision.

## Decision 010 — Award Trigger Is a DB Trigger on the Completed-Sale Transition

**Status:** Accepted (Phase 01 recommendation)

Points are awarded by a database trigger on `public.sales` that fires on the
`status → 'completed'` transition (the same transition
`shop_push_sale_complete` already detects via `v_was_completed`), invoking a
definer RPC that evaluates the shop's rule and appends a ledger row guarded
by `UNIQUE (shop_id, source_sale_id)` for earned rows. Rationale: works for
online and offline-originated sales uniformly, enforces idempotency
server-side (Decision 007), and does not modify the financial core RPC.

## Decision 011 — Reversals Are Ledger Entries, Never Deletes

**Status:** Accepted (Phase 01 recommendation)

Refunds (`sale_returns` inserts, partial supported) and voids (`sale_voids`
/ `status → 'void'`) produce `reversed`/`adjusted` rows in
`loyalty_transactions` referencing the original earned row and the
return/void source. Historical activity is never deleted, per Decision 003.

## Decision 012 — Customer Hard-Delete Cascades to Loyalty History

**Status:** Accepted (Phase 02)

`loyalty_accounts` and `loyalty_transactions` use `ON DELETE CASCADE` from
`customers`/`shops`. WAKA already hard-deletes customers by design
(`customers_delete` policy, manager+), so loyalty history does not outlive
the customer it belongs to and can never block a customer deletion. The
internal admin shop reset deletes loyalty rows explicitly before customers
(program configuration in `loyalty_programs` survives, like shop settings).

## Decision 013 — Loyalty Can Never Block a Financial Write

**Status:** Accepted (Phase 02)

Every loyalty trigger body (`trg_loyalty_sales_status`,
`trg_loyalty_sale_returns`, `trg_loyalty_sale_voids`) wraps its work in an
exception handler that downgrades any failure to `raise warning`. A loyalty
defect can log a warning but can never abort or roll back a sale, return,
or void.

## Decision 014 — Eligible Spend Is the Gross Sale Total

**Status:** Accepted (Phase 02)

The spend rule divides `sales.total_ugx` (gross, after cart discount,
including service charge/tax) by `earn_unit_ugx`, floored. Rationale: it is
the amount the customer actually paid, it requires no per-line recomputation,
and `tax_ugx` is rarely nonzero in current WAKA usage. If merchants later
need net-of-tax rules, add a rule option — do not reinterpret retroactively
(rule snapshots are stored on every ledger row).

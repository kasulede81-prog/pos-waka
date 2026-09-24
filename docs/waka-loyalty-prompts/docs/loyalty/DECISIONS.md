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

## Decision 015 — Merchant Reads Go Through Aggregating RPCs

**Status:** Accepted (Phase 04)

Merchant dashboard data (member counts, issued/redeemed aggregates, recent
activity, member search) is exposed through security-definer RPCs
(`loyalty_shop_overview`, `loyalty_search_accounts`) that re-check
`user_can_access_shop` / `user_can_manage_shop` internally, rather than
client-side table scans. Rationale: aggregates and name/phone search are
cheaper server-side, the authorization check lives next to the data, and no
new RLS surface is invented. The ledger remains server-only-write (no insert
policies).

## Decision 016 — Program Configuration Is a Manager-Only RPC Upsert

**Status:** Accepted (Phase 04)

`loyalty_update_program` performs the upsert (with spend-rule validation:
positive earn unit, positive integer points per unit, non-negative minimum
spend) after a `user_can_manage_shop` check, instead of letting the client
write `loyalty_programs` rows directly. Although a `loyalty_programs_update`
RLS policy exists for the table, the RPC keeps validation and authorization
in one auditable place; the UI additionally guards with the `settings.shop`
permission. After a successful save the client invalidates the offline
program cache so checkout previews cannot show a stale rule.

## Decision 017 — Enrollment Is Merchant-Mediated With Recorded Consent

**Status:** Accepted (Phase 05)

Membership is created by a shop member through `loyalty_enroll_customer`
(cashier-or-above via `user_can_access_shop`), never by the customer
directly — WAKA has no customer-facing auth, and an open self-enrollment
endpoint would be an enumeration/abuse vector. Consent is explicit: the UI
requires a consent checkbox and records `{accepted, accepted_at, accepted_by,
note}` into `loyalty_accounts.metadata`. Duplicate membership is impossible
(`unique(shop_id, customer_id)`; RPC reports `already_enrolled`).

## Decision 018 — The Membership QR Carries Only an Opaque Token

**Status:** Accepted (Phase 05)

The QR payload is `WAKA-LOYALTY:<qr_token>` — the account's unguessable
`qr_token` (md5 of random + clock timestamp) behind a distinguishing
prefix. No name, phone, balance, or customer id is encoded. Scanning
resolves the token server-side via `loyalty_account_by_token`, which
re-checks shop access, so a code scanned at the wrong shop resolves to
nothing and a forged token resolves to `not_found`. QR rendering uses the
`qrcode` npm package (no native code, browser + Capacitor safe).

## Decision 019 — Wallet Signing Is Server-Side Only, With Injected Signers

**Status:** Accepted (Phase 06)

Wallet pass signing material (Google service account key, Apple pass
certificate + WWDR + private key) lives exclusively in Supabase Edge Function
secrets (`loyalty-wallet-pass`). All crypto modules are pure TypeScript +
WebCrypto under `supabase/functions/_shared/loyaltyWallet/` so the same code
runs in Deno (edge) and Node (vitest); signers are injected interfaces, the
edge function supplies the secret-backed implementations. The function fails
closed with `wallet_not_configured` when secrets are absent. Passes carry only
the opaque `qr_token` barcode (same identifier as the QR fallback), member
name, balance, and earning rule — no phone numbers. No Wallet UI ships until
platform credentials exist.

## Decision 020 — Wallet Credential Gap Is Documented, Not Faked

**Status:** Accepted (Phase 06)

WAKA has no Google Wallet issuer/service account and no Apple Developer Pass
Type ID certificate today. Per the phase rule, the internal abstraction is
implemented and unit-tested (PKCS#7 SignedData verified against the manifest
with a real RSA-2048 key; ES256 JWT verified with a WebCrypto-generated key)
while the missing external credentials are documented as blockers in
WALLET-INTEGRATION.md with a concrete setup checklist. No claim of real-time
Wallet balance updates is made (Apple requires webServiceURL + push; Google
requires REST patches) — both are specified as follow-up work.

## Decision 021 — NFC Is NDEF Tag Reading for Identification Only

**Status:** Accepted (Phase 07)

The supported phone-to-credential mechanism is **NDEF tag reading** (the
merchant device reads a sticker/card carrying `WAKA-LOYALTY:<qr_token>` via
Web NFC where the platform exposes it). Phone-to-phone HCE is not practical
(customer would need a custom app), Apple Wallet NFC requires Apple's VAS
entitlement, and Google Smart Tap is for certified terminals — all three are
documented as external dependencies in NFC-FEASIBILITY.md, not implemented.
The Android manifest declares NFC as optional (`required=false`) so installs
never block; unsupported devices keep QR/phone identification. Raw NFC bytes
are never trusted: only prefixed payloads resolve, through the same
shop-scoped `loyalty_account_by_token` lookup as QR, and points still come
exclusively from the completed-sale trigger.

## Decision 022 — Redemption Is a Paired, Idempotent, Atomic Write

**Status:** Accepted (Phase 08)

A redemption is exactly two rows written in one transaction: one
`loyalty_redemptions` row (audit + idempotency) and one negative `redeemed`
row in the immutable ledger, linked both ways with unique indexes
(`loyalty_redemption_ledger_once`, and one completed redemption per
idempotency key via `loyalty_redemption_key_once`). The cached
`balance_points` is updated only by the existing ledger trigger, so the
invariant `balance = earned - redeemed` holds by construction. The client
generates one idempotency key per user intent (on Redeem, reused by Confirm
and any retry), making double taps and network replays return the original
redemption (`already_redeemed`) instead of deducting twice. Redemption writes
go only through the security-definer `loyalty_redeem_reward` RPC; the
redemptions table has no client insert policy.

## Decision 023 — Free-Product Rewards Are Fulfilled at the POS, Not by Loyalty

**Status:** Accepted (Phase 08)

Loyalty never moves inventory or money. A `product`-kind reward records the
points redemption (`loyalty_redemptions`, optionally linked to the fulfilling
`sale_id` for audit); the actual free item is rung up by the merchant through
the existing product/sale flow with their normal discount practice. This
keeps the Retail/Kiosk Duka financial engine as the single source of truth —
no second inventory ledger, no restaurant/POS-specific finalizer, and no
financial behavior change from redeeming points.

## Decision 024 — E2E Proof Is One Continuous Journey, Not a Checklist of Suites

**Status:** Accepted (Phase 10)

Final acceptance is evidenced by `loyaltyE2E.sql.integration.test.ts`: a
single sequential story (merchant setup → enrollment → QR → sale → replay →
return → void → redeem → replay → cross-shop attack → financial untouched)
executed against real migration files in PGlite. Per-step suites from Phases
02–08 remain as the detailed regression net, but the E2E file is the
authoritative "the system works as one" proof and must stay green. External
dependencies (Wallet issuer/certs, NFC hardware) are excluded from the
journey by design and tracked as documented blockers, not hidden failures.

## Decision 025 — Points Expiry Is Rolling Earn-Lot FIFO (C3)

**Status:** Accepted (C3)

Points expiry is **not** an account-wide wipe and **not** membership/reward
expiry. Configuration lives on `loyalty_programs`:

- `points_expiry_mode`: `never` (default) | `rolling_months`
- `points_expiry_months`: positive integer when rolling

**Grandfathering:** Existing `earned` rows keep `expires_at = NULL` (never
expire). Changing the merchant rule stamps **new** earns only and never
rewrites historical `expires_at`.

**Kampala:** New earn lots under rolling mode set
`expires_at = loyalty_membership_expires_at_from_date(Kampala_start + months)`
(reuse C1 helper; inclusive calendar day; exclusive timestamptz bound;
server `now()`).

**Immutable ledger:** Expiry appends `kind='expired'`, `cause='expiration'`,
negative points. Historical rows are never updated/deleted. Balances move
only via `trg_loyalty_tx_balance`.

**FIFO (sole consumption policy):** Oldest credit lots (earned, then any
positive promotional/adjusted credits) are consumed first for redemptions and
expiries. Remaining capacity per lot =

`credit_points + sum(reversals of that credit) − sum(FIFO allocations)`.

Allocations are stored append-only in `loyalty_point_lot_allocations` so the
system can answer which lot funded which redeem/expire without mutating
ledger history. Pre-C3 redeems are backfilled into that table once at
migration time (no new ledger rows).

**Returns/voids:** `loyalty_outstanding_for_sale` uses lot remaining (respects
expiry/redeem allocations). Already-expired or redeemed capacity cannot be
reversed again. Decision 013 stands: finance commits even if loyalty reverse
is a no-op / balance-floored.

**Privileges:** `loyalty_expire_due_points` is SECURITY DEFINER and **not**
granted to `anon`/`authenticated`; redeem (and trusted internal callers)
invoke it under the account `FOR UPDATE` lock.

## Decision 026 — Additive Customer Offers (Model B)

**Status:** Accepted

Customer-specific loyalty treatment is an **additive offer layer** on top of
the shop’s single `loyalty_programs` row. There is **no**
`loyalty_customer_programs` clone of the merchant program.

**Table:** `loyalty_customer_offers` (shop_id + account_id, shop-isolated).
Kinds: `earn_multiplier`, `earn_bonus_flat`, `reward_grant`, `status_badge`,
`campaign` (non-recursive bundle of the first four).

**Stacking:**
- At most **one** effective earn multiplier: highest wins; ties break by
  priority desc then offer id asc. Multipliers are never multiplied together.
- Flat bonuses **sum**.
- Badges and reward grants may coexist.
- Default effective multiplier is **1** when no multiplier offer applies.

**Composition:** `effective_points = floor(base_points × multiplier) + flat_bonuses`
where `base_points` comes from the merchant spend rule. Client never submits
points.

**Lifecycle:** `active` | `paused` | `revoked`; `starts_at` inclusive,
`ends_at` exclusive; null means open-ended. Revoked rows are retained for
history.

**Snapshot:** New earns append offer fields onto `rule_snapshot`
(`base_points`, `effective_multiplier`, `flat_bonus_*`, `applicable_offers`,
`effective_points`, …) without rewriting historical snapshots.

**C1/C2/C3:** Unchanged engines. Membership gate runs **before** offer
resolution. Grant-only rewards (`loyalty_rewards.requires_offer_grant`) need
an applicable `reward_grant`; C2 expiry and C3 FIFO still apply. Offer points
are ordinary earned lots.

**Auth:** Manage via `user_can_manage_shop` RPCs; cashiers consume only;
SELECT RLS for shop access. No direct client writes to the offers table.

**Rejected:** Per-customer program clones (Model A / Option 3) — they fight
the single-program UNIQUE, weaken reporting, and duplicate C1/C3 config.

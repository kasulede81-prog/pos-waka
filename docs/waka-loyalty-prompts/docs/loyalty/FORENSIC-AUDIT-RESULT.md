# Phase 01 — Forensic Audit Result

Every name below was verified against the repository in this working tree on
2026-09-18. Nothing is assumed.

## 1. Merchant / Shop Architecture

- Tables (`supabase/migrations/003_organizations_and_shops.sql`):
  - `public.organizations` (id, owner, name…)
  - `public.organization_members`
  - `public.shops` — the merchant tenant boundary; every business table carries `shop_id`
  - `public.shop_members` — staff membership + role
- RLS (`supabase/migrations/008_row_level_security.sql`): `shops_select`,
  `shops_write`, `shops_update`, `shops_delete`, `shop_members_*`,
  `organizations_*`. Tenant isolation is `shop_id`-scoped throughout.
- Internal admin is a separate surface: `internal_admin` schema + RPCs
  (migrations `018`–`022`, `053`, `187`, `188`) — not part of the merchant
  loyalty scope except for future support views.
- Staff roles (`src/lib/permissions.ts`): `owner`, `manager`, `cashier`,
  `stock_keeper`, `supervisor`, `waiter`, `kitchen`, `bar`.
  `FAIL_CLOSED_ROLE = "waiter"` — unresolved membership fails closed.
  Permission keys are strings like `"pos.sell"`, `"customers.debt"`,
  `"enterprise.access"`; matrix versioned via `PERM_MATRIX_VERSION = 23`.
  Authorization enforcement helpers: `src/lib/storeAuthorization.ts`
  (`denyUnlessEffectivePermission`), `src/lib/actorAuthorization.ts`.

## 2. Customers

- Table (`supabase/migrations/005_customers_and_sales.sql`):
  `public.customers(id, shop_id → shops ON DELETE CASCADE, name, phone_e164,
  email, notes, loyalty_points numeric(18,4) DEFAULT 0, metadata jsonb,
  created_at, updated_at)`.
  - `CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+256[0-9]{9}$')` — Uganda E.164 only.
  - Indexes: `customers_shop_idx (shop_id)`, partial `customers_phone_idx (phone_e164)`.
  - **`loyalty_points` already exists as a legacy mutable balance column. No
    application code reads or writes it** (verified by grep). Loyalty must not
    dual-write silently to it; see Decision 009.
- RLS: `customers_select/write/update/delete` (008), re-hardened in `095`.
- App code: `src/pages/CustomersPage.tsx`, `src/lib/customerDebt.ts`,
  `customerDebtActivity.ts`, `customerAccountDocuments.ts`.
  Debt permission key: `"customers.debt"`.

## 3. Sales — Finalization Path (the loyalty trigger surface)

- Tables (`005`):
  - `public.sales(id, shop_id, customer_id → customers ON DELETE SET NULL,
    status CHECK IN ('draft','completed','void','refunded'),
    payment_status CHECK IN ('pending','partial','paid','refunded'),
    subtotal_ugx, tax_ugx, discount_ugx, total_ugx (bigint ≥ 0), currency,
    cash_amount_ugx, mtn_momo_reference, airtel_money_reference,
    internal_note, created_by → auth.users, completed_at, timestamps)`
  - `public.sale_line_items(id, sale_id, product_id, quantity, unit_price_ugx,
    line_discount_ugx, line_total_ugx, metadata)`
  - `public.sale_payments(id, sale_id, method CHECK IN ('cash','mtn_momo',
    'airtel_money','card','other'), amount_ugx, external_reference,
    provider_payload, recorded_by, recorded_at)`
- **Local completion entry point**: `finalizeDraftSale` in
  `src/store/usePosStore.ts:4968`. Guards, in order: permission `pos.sell` →
  business-date lock (`denyIfBusinessDateLocked`) → pending-sale target
  resolution (`resolveFinalizeCompletionTarget`, idempotent
  `already_completed` short-circuit) → in-flight lock
  (`finalizeInFlightKeys`) → active shift → non-empty cart → plan-tier
  product access → pharmacy expiry/controlled gates → combined discount
  policy → stock registration gate (`assertCanFinalizeStockSale`) → debt
  permission (`customers.debt`) → sale construction.
- Cloud push: `pushSaleToCloud` (`src/offline/cloudSync.ts:1362`) builds the
  payload and calls RPC **`public.shop_push_sale_complete(p_shop_id,
  p_payload)`** (`supabase/migrations/063_shop_push_sale_transactional.sql`).
  The RPC is transactional and idempotent: it detects the
  `status = 'completed'` transition (`v_was_completed`), and returns
  `already_completed` for repeats. Returns `product_stocks` for local stock
  patching.
- Sale status helpers: `src/lib/saleStatus.ts`, `saleLifecycle.ts`.

## 4. Refunds and Voids

- `public.sale_returns` (`062_sale_returns.sql`): **line-level partial
  returns are supported** — `quantity numeric(18,4)`, `refund_amount_ugx`,
  `reason`, `note`, `created_by`, `stock_applied_at`. RLS `sale_returns_*`.
- `public.sale_voids` (`179_sale_void_financial_ledger.sql`): full-sale void
  financial ledger.
- App code: `src/lib/voidCompletedSale.ts`, `saleReturnCeilings.ts`,
  `resolveLocalSaleForReturn.ts`, `salesSyncReturnVoidProcessor.test.ts`.
- Sale header transitions to `'void'` / `'refunded'` exist on `public.sales`.
- Loyalty implication: refunds/voids must produce **auditable reversal
  ledger entries**, never deletes (matches Decision 003).

## 5. Financial / Inventory Core — PROTECTED

Do not modify. Verified components:

- `src/lib/saleFinancialEngine.ts` — pure financial functions:
  `finalizeSaleLineFinancials`, `resolveSaleLineFinancials`,
  `sumSaleLinesFinancials`, `resolveReturnFinancials`,
  `resolveReturnCogsFromSaleLine` (historical COGS), profit invariants.
- `src/lib/saleLineFinancialHydration.ts` — historical cost snapshots.
- Stock: `stockMovementCloudSync.ts`, `stockDurableSync.ts`,
  `purchaseStockSyncIdempotency.ts`, `saleVoidStock*`, migration `082`.
- Reporting: `src/features/business-analytics`, `salesDayIndex.ts`,
  `todaySalesSummary.ts`.
- Guards: closed-business-date guards (`175`/`176`), idempotency fences
  (`170`, `165`, `166`, `172`, `173`, `174`).

**Boundary decision: loyalty hooks must live outside these files; the only
touch-points allowed are (a) a new dedicated loyalty module, (b) DB-side
loyalty triggers on `sales`/`sale_returns`/`sale_voids` transitions that only
write to new `loyalty_*` tables, and (c) call-sites that *notify* loyalty
after successful finalize/push without changing financial semantics.**

## 6. Offline / Sync Architecture

- Local persistence: `src/offline/localDb.ts` (IndexedDB),
  `entityStore.ts`, `incrementalPersist.ts`, `draftStorage.ts`.
- Queue: `src/offline/syncEngine.ts` — `enqueueSync`, `flushSyncQueue` /
  `flushSyncQueueInner` with retry, quarantine (`retryQuarantined`),
  `nextQueueRetryMs` backoff. Global mutex: `globalSyncMutex.ts`.
- Cloud sync: `src/offline/cloudSync.ts` (push/pull, cursors, authoritative
  replace), `realtimeSyncPull.ts`, `immediateSync.ts`, `autoSync.ts`,
  `foregroundSync.ts`.
- Test matrix: `vitest.offline.config.ts` + `*.offline.test.ts` suites
  (queue RAM-miss, stale-reset guard, merge, cursor tests).
- Loyalty implication: the award write must be **server-authoritative with a
  unique (shop_id, source_sale_id) constraint** so offline retries /
  multi-device sync can never double-award (Decision 007). The client never
  credits points locally as source of truth.

## 7. RLS / Security Model

- All merchant tables: `ENABLE ROW LEVEL SECURITY` + shop-member policies
  (pattern from `008`, hardened across `076`–`095` and later).
- Auth users: profiles (`002`), trust hardening (`095`), `184`/`185` definer
  revokes. New loyalty tables must follow the same pattern:
  `is_shop_member`-style helper checks + `shop_id` scoping, with `revoke`
  statements like `184`/`185` where definer functions are added.
- Staff permissions are client-enforced (`storeAuthorization.ts`) **and**
  must be re-checked in RPCs (definer security) — never UI-only (Decision 008).

## 8. Mobile / Capacitor

- Capacitor 8 (`@capacitor/core 8.4.2`, `android 8.4.1`, `ios 8.4.2`).
- Android permissions (`android/app/src/main/AndroidManifest.xml`):
  CAMERA, BLUETOOTH / BLUETOOTH_ADMIN / BLUETOOTH_CONNECT / BLUETOOTH_SCAN
  (printer hardware), location, storage/media. **No NFC permission declared.**
- Capabilities (`src/platform/capabilities.ts`): `barcodeScannerHid` (web),
  `barcodeScannerCamera: true`. Hardware adapters:
  `src/services/hardware/barcodeAdapter.ts`, `hardwareCapabilities.ts`,
  `paymentTerminalAdapter.ts`.
- **NFC: no existing capability** — Phase 07 must add
  `android.permission.NFC` + a plugin/capability probe before implementing.

## 9. Wallet / QR / Existing Loyalty Code

- **Google Wallet / Apple Wallet: zero existing implementation.** No pass
  generation, no Wallet REST client, no push-update infrastructure. Only
  architecture placeholders in `src/types.ts`
  (`RestaurantPaymentFutureHooks.digitalWalletId`, `.loyaltyRedemptionId`,
  marked "Phase 6.5+ future hooks — architecture only, do not implement").
- **QR: universal fallback is feasible today** — camera scanning already
  works (`barcodeScannerCamera: true`, `barcodeAdapter.ts`). Customer QR can
  encode a signed/opaque customer token rendered in-app.
- Existing loyalty code: none beyond the unused `customers.loyalty_points`
  column (see §2).

## 10. Tests / Tooling

- `npm test` → `vitest run`; offline suites → `npm run test:offline`.
- `npm run build` → `tsc -b && vite build --mode production`.
- `npm run lint` → eslint.
- Integration SQL tests: `*.sql.integration.test.ts` (Supabase-linked).

## 11. Integration-Point Recommendation (input to Phase 02)

1. **New `loyalty` tables** (all `shop_id`-scoped, RLS like `customers`):
   - `loyalty_accounts` — one per (shop_id, customer_id): cached balance,
     enrollment state, pass tokens.
   - `loyalty_transactions` — the **auditable ledger** (kind:
     earned/redeemed/reversed/expired/adjusted/promotional; points; cause;
     source_sale_id / source_return_id; rule snapshot; actor; timestamps).
   - `loyalty_rules` — spend-based default (e.g. 1 pt / UGX 1,000 eligible
     spend), extensible kind column for visit/product/promo.
   - `loyalty_rewards` + `loyalty_redemptions` — Phase 08.
2. **Idempotency**: `UNIQUE (shop_id, source_sale_id) WHERE kind = 'earned'`
   (+ matching redemption reversal pairs in Phase 08). Enforcement in DB.
3. **Award trigger**: DB trigger on `public.sales` firing on the
   `status → 'completed'` transition (the same transition
   `shop_push_sale_complete` uses), calling a definer RPC
   `loyalty_award_for_sale(p_sale_id)` that evaluates the shop's rule and
   writes the ledger row. Non-invasive to the financial RPC.
4. **Reversals**: trigger on `sale_returns` insert (proportional reversal)
   and on `sale_voids` insert / sales status → void (full reversal), each
   writing `reversed`/`adjusted` ledger rows — never deleting history.
5. **Admin reset**: shop data reset RPCs (`191`–`196`) wipe merchant data;
   Phase 02 must decide + document whether loyalty ledgers are in reset scope
   (recommendation: reset accounts/balances but preserve an audit tombstone,
   or explicitly include — recorded in DECISIONS.md).
6. **Client**: read-only balance display + enrollment from existing customer
   flows; award computation is never trusted from the client.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Double award via offline retry / multi-device | Unique `(shop_id, source_sale_id)` + server-side award only |
| `customers.loyalty_points` legacy column drifts from ledger | Never write it in new code; document as deprecated (Decision 009) |
| Financial-core contamination | Loyalty only writes `loyalty_*` tables; trigger code reviewed to never mutate financial rows |
| RLS gap on new tables | Mirror `customers` policy pattern + definer revokes like `184`/`185` |
| Historical financial correction (`191`–`196`) rewriting past sales | Award trigger must key on the completed transition and be re-entrant; corrections only add reversals, never re-awards |
| Wallet/NFC platform assumptions | Phase 06/07 must probe capabilities before building (Decision 005/006) |

## Acceptance Checklist

- [x] Merchant/shop architecture mapped
- [x] Customer architecture mapped
- [x] Sale finalization mapped
- [x] Refund/void behavior mapped
- [x] Financial core boundaries mapped
- [x] Offline/sync architecture mapped
- [x] RLS/security model mapped
- [x] Android/Capacitor capabilities mapped
- [x] Existing QR/NFC/Wallet capabilities checked
- [x] Integration point recommendation documented
- [x] No financial-core modifications (none made)
- [x] Relevant existing tests identified (`vitest run`, `test:offline`, `sql.integration`)

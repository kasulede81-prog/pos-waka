# WAKA POS — Phase 0 Forensic Audit (read-only)

- **Repo:** kasulede81-prog/pos-waka
- **HEAD:** `6b6ed11` (2026-09-08)
- **Source:** 2,449 TS/TSX files · 376,113 LOC
- **Tests:** 640 test files
- **Backend:** 183 Supabase migrations · 110 tables · ~200 RPCs · 13 edge functions
- **Live project checked:** Waka-pos (`ljaedextsenbkxzzgxcg`, eu-west-1) — security advisor only, read-only
- **No repository files were modified.**

---

## HEADLINE

The server side of WAKA is in better shape than the client side. The Postgres RPC layer has real idempotency fences, row locks, durable movement IDs and genuine SQL integration tests. The **client sync orchestration** is where the business risk lives, and three of its defects are the kind that quietly cost a shop money.

The single most important finding is **WAKA-01**: a temporal-dead-zone `ReferenceError` in `pullCloudAndMergeIntoStore` that aborts *every* cloud merge as soon as a customer that already exists locally is changed on another device. It has been in `main` since 2026-06-18, TypeScript cannot catch it, and no test in the suite executes that function.

Second: the production database exposes unauthenticated `SECURITY DEFINER` RPCs that read any shop's financial totals and write any shop's stock. Confirmed against the live project by the Supabase security advisor, not inferred.

**Counts:** 6 × P0 confirmed · 6 × P1 confirmed · 8 high-confidence risks · 5 runtime checks required.

Every item below is backed by a file, a line range, and either executed proof or a live production advisor reading. Speculative findings were deliberately excluded.

---

# A. ARCHITECTURE SUMMARY

WAKA is a single-page React 18 + TypeScript app built with Vite, shipped four ways from one bundle: web/PWA, Capacitor Android, Capacitor iOS, and Electron for Windows. There is no server tier of its own — Supabase Postgres is the backend, reached through `@supabase/supabase-js` with the anon key and RLS, plus ~200 `SECURITY DEFINER` RPCs, plus 13 edge functions for AI, EFRIS and account deletion.

## Correction to the assumed diagram

The stated flow (`UI → state → logic → local DB → queue → Supabase → device B`) is **directionally right but incomplete in three ways**:

1. Business logic is **not** a layer below state — it is *inside* the Zustand store. `usePosStore.ts` is 391 KB / ~9,600 lines and contains sale finalization, stock deduction, debt math, pharmacy compliance and shift accounting.
2. There are **two** local persistence schemes running side by side: a whole-store KV snapshot blob, and a per-entity `records` store, plus a manifest that indexes them.
3. Push and pull are **separate, independently scheduled pipelines** that do not share a cursor, a mutex, or a success definition.

### Actual flow

```
DEVICE A
  Pages / components (126 pages)
      ↓
  usePosStore (Zustand) — state + ALL business logic, 9.6k lines
      ↓                              ↓
  kv snapshot                  records + manifest
  (whole-store blob)           (per-entity rows)
      └──────────────┬──────────────┘
        IndexedDB "waka-pos-offline" v5
        namespace = sb:<uid>:<shopId>
                     ↓
  ┌──────────────────┴──────────────────┐
  │ syncQueue (PUSH only)               │  backoff 2s→5m, attempts cap 100
  │ checkpoints (PULL only)             │  localStorage, 19 client-clock cursors
  └──────────────────┬──────────────────┘
                     ↓
        SUPABASE POSTGRES
        RLS + ~200 SECURITY DEFINER RPCs
        shop_push_*  (idempotent)
        shop_pull_* / direct table reads
        inventory_movements (durable ids)
        realtime channel → triggers a pull only
                     ↓
DEVICE B
  pullShopDataFromCloud (18 entities, per-entity cursors)
      ↓
  pullCloudAndMergeIntoStore   ← *** WAKA-01 THROWS HERE ***
      ↓                          (whole merge discarded)
  Device B store + IndexedDB
      ↓
  Device B UI
```

## Primary files by domain

| Domain | Primary files | Key functions |
|---|---|---|
| Entry / routing | `src/main.tsx`, `src/App.tsx` (1,433 L) | `initCapacitorShell`, `warmupLocalDb`, route tree |
| Auth | `hooks/useAuth.ts` (42 KB), `lib/supabase.ts`, `lib/authConfig.ts` | PKCE flow, `resolveAuthRole` |
| Authorization | `lib/permissions.ts`, `lib/actorAuthorization.ts`, `lib/storeAuthorization.ts` | `ROLE_PERMISSIONS` (v23), `denyUnlessEffectivePermission` |
| Shop / account scope | `offline/accountScope.ts`, `offline/shopScope.ts`, `offline/shopScopeMigration.ts` | `getPersistenceNamespace`, `migrateLegacyPersistenceToShop` |
| State + business logic | `store/usePosStore.ts` (391 KB) | `finalizeDraftSale`, `addDebtPayment`, `voidSaleLine`, `returnProduct` |
| Local database | `offline/localDb.ts`, `offline/entityStore.ts`, `offline/incrementalPersist.ts` | `writeSnapshot`, `putEntitiesBatch`, `flushIncrementalPersist` |
| Sync queue | `offline/syncEngine.ts`, `lib/autoSync.ts`, `lib/syncQueuePriority.ts` | `enqueueSync`, `flushSyncQueueInner`, `computeSyncBackoffMs` |
| Cloud sync | `offline/cloudSync.ts` (187 KB / 4,963 L) | `pullShopDataFromCloud`, `pullCloudAndMergeIntoStore`, `pushSaleToCloud` |
| Checkpoints | `lib/syncCheckpoints.ts` | `markBootstrapSyncComplete`, `updateCheckpointsAfterIncrementalPull` |
| Offline detection | `lib/deviceOnline.ts` (30 L), `hooks/useOfflineStatus.ts` | `getDeviceOnline`, `initDeviceOnlineTracking` |
| Sync scheduling | `hooks/useSyncStatus.tsx`, `lib/immediateSync.ts`, `lib/foregroundSync.ts`, `lib/realtimeSyncPull.ts` | `runFlush`, `scheduleIncrementalCloudPull` |
| POS / sales | `pages/PosPage.tsx` (128 KB), `components/pos/PosCheckoutPanel.tsx` | checkout, tender, split payment |
| Inventory | `pages/StockPage.tsx` (68 KB), `lib/stockDurableSync.ts`, `lib/stockMovementLedger.ts` | `pushR3DurableStockRpc` |
| Debts | `pages/CustomersPage.tsx`, `lib/customerDebt.ts`, `lib/customerDebtReconciliation.ts`, `lib/debtPaymentPush.ts` | `computeExpectedCustomerDebt`, `mergeCustomerFromCloudPull` |
| Reporting | `lib/localReporting.ts`, `lib/shopReporting.ts`, `lib/monthlyBusinessReport.ts` | `localGetDailySalesSummary` |
| Printing | `services/hardware/printerAdapter.ts`, `lib/receiptPrint.ts`, `lib/printQueue.ts` | ESC/POS, BLE + native transports |
| Platform | `main.cjs` (Electron), `android/`, `ios/`, `capacitor.config.ts`, `lib/capacitorInit.ts` | — |
| Backend | `supabase/migrations` (183), `supabase/functions` (13) | `shop_push_sale_complete`, `shop_push_debt_payment`, `_apply_durable_stock_delta` |

---

# B. CRITICAL DATA FLOWS

## 1 · Completed sale, device A → device B

```
PosPage checkout
  → usePosStore.finalizeDraftSale()          [synchronous, atomic in memory]
      guards: permission · business-date lock · in-flight lock key · shift · stock
      math:   integer UGX only, Math.floor throughout
      set({ sales, products, customers, stockMovements, auditLogs })
  → queueRemote("pending_sales", {saleId})   fire-and-forget, not awaited
  → putEntity("sale", ...) + flushPendingPersist()   [NOT awaited — returns before durable]
  → flushSyncQueueInner → processOne → pushSaleToCloud
  → rpc shop_push_sale_complete              [idempotent: already-completed fence, mig. 170]
      → apply_sale_stock_movements           [idempotent: inventory_movement_uuid]
  ————— device B —————
  → scheduleIncrementalCloudPull("realtime")
  → pullSalesIncremental(since = lastSalesSyncAt)   .gt(updated_at, cursor)
  → pullCloudAndMergeIntoStore                [THROWS if a pulled customer exists locally]
  → usePosStore.setState → UI
```

## 2 · Debt payment

```
CustomersPage → addDebtPayment(customerId, amount)
  → tryBeginDebtPaymentSubmit(lockKey)       double-submit guard
  → re-reads live state, clamps pay = min(amount, balance)
  → set({ customers: balance - pay, debtPayments: [payment, ...] })
  → queueRemote("customer", {kind:"debt_payment", paymentId})
  → pushDebtPaymentToCloud
      *** if payment not found in RAM → return true (op ACKed and DELETED) ***
  → rpc shop_push_debt_payment               [idempotent by payment_id + FOR UPDATE, mig. 174]
      stores created_at = CLIENT CLOCK
      updates customers.metadata.debtBalanceUgx, updated_at = now()
  ————— device B —————
  → pullDebtPaymentsIncremental  .gt(created_at, lastDebtPaymentsSyncAt)  [CLIENT-CLOCK CURSOR]
  → mergeCustomerFromCloudPull(..., {ledgerAuthoritative:true})
      *** recomputes balance from local sales − local payments, overwrites server value ***
```

**The two flaws in flow 2 compound.** A debt payment written with a past client timestamp can fall behind another device's cursor and never arrive. That device's ledger-authoritative recompute then restores the balance to its pre-payment value and pushes it back up. The customer is re-billed for money they already paid. Today this is masked by WAKA-01 crashing before the recompute runs — which is why the cursor fix must land *with or before* the crash fix.

---

# C. SOURCE-OF-TRUTH MAP

| Entity | Created | Local store | Remote store | Authority | Conflict rule |
|---|---|---|---|---|---|
| **Sale** | `finalizeDraftSale` | `records/sale` + kv snapshot | `sales` | Server (fenced) | Already-completed = no-op ACK; header never overwritten |
| **Sale line** | `normalizeSaleLine` | embedded in sale | `sale_line_items` | Server | Deleted + reinserted wholesale on each non-completed push |
| **Product / stock** | `addProduct`, sale, purchase | `records/product` | `products` + `inventory_movements` | **Server for quantity**, local for catalog | Durable movement id; client adopts `product_stocks` from RPC reply |
| **Customer** | `resolveDebtorForSale` | `records/customer` | `customers` (balance in `metadata`) | **AMBIGUOUS** | LWW on *client-written* `updated_at`, then overridden by local ledger recompute |
| **Debt payment** | `addDebtPayment` | `records/debtPayment` | `customer_debt_payments` | Server (PK idempotent) | Insert-only; balance from RPC reply |
| **Debt balance** | derived | customer row | customer metadata | **CONTESTED** | Server returns `new_balance_ugx`; client may recompute and overwrite it |
| **Cash expense** | `addCashExpense` | `records/cashExpense` | `expenses` (cash_drawer) | Server | Upsert by id; `deleted_at` soft delete |
| **Void / return** | `voidSaleLine` / `returnProduct` | `records/voidRecord`, `returnRecord` | `sale_voids`, `sale_returns` | Server | Stable derived ids; ceilings validated server-side |
| **Day close** | `recordDayClose` | `records/dayClose` | `shop_day_closes` | Server | One active close per shop-date (mig. 150); supersede chain |
| **Staff / roles** | owner console | `staffCache` store | `shop_pos_staff` + `shop_members` | Server | Version-vector pull; offline cache for PIN login |
| **Shop / business** | onboarding | preferences in manifest | `shops`, `shop_policy` | Server | `shop_policy_lww_wins` |
| **Receipt number** | `scanTodaySalesHead` | derived from local sales | — | **LOCAL ONLY** | **None — collides across devices (WAKA-10)** |

---

# D. SYNCHRONIZATION MODEL

Push and pull are two unrelated machines that happen to talk to the same database.

## Push
- Durable FIFO in IndexedDB `syncQueue`, one row per operation, tagged with `accountKey` (= `sb:<uid>:<shopId>`) and `shopId`.
- Ordered by kind priority (P0 operational → P1 catalog/people → P2 settings) then `createdAt`; sale uploads drained before sale adjustments.
- Exponential backoff `2s · 2^attempts` capped at 5 minutes. Concurrency via `mapPool`. Global mutex separates push from pull.
- Idempotency is **server-side and well built**: stable client-generated UUIDs, an already-completed fence for sales, `inventory_movement_uuid(shop, ref_type, ref_id, product)` for stock, PK + `FOR UPDATE` for debt payments.
- **Failure handling is where it breaks down:** ops past 100 attempts are neither retried-with-update nor removed; ops belonging to a non-active shop return `retry` forever; and ops whose entity is absent from RAM are **ACKed and deleted**.

## Pull
- Two modes. *Full/bootstrap* — offset pagination over every entity. *Incremental* — keyset pagination on `updated_at` (or `created_at` for debt payments and audit logs), max 40 pages × 200–500 rows.
- 19 per-entity cursors in `localStorage`, keyed by persistence namespace, written as ISO strings.
- Triggered by: startup idle, Supabase realtime notification (coalesced), foreground/visibility change, reconnect, and a safety interval.
- Per-entity failures are isolated by `pullEntitySafe` and the corresponding cursor is correctly *not* advanced.
- **The cursors themselves are the weak point:** they are client-clock values compared against server timestamps, they advance to local `now()` on an empty page, and they use `.gt()` with no tiebreaker.

## Conflict resolution
Per entity, not global. Products use a version-aware merge with pending-local guards; sales use a lifecycle-aware merge that absorbs void/return ledgers; day drawer opens have a dedicated resolution module; shop policy is server LWW. **Customers are the exception and the problem** — last-write-wins on a client-written timestamp, then optionally overridden by a local ledger recompute that has no idea whether it has seen all the payments.

---

# E. CRITICAL BUSINESS RISKS

| Risk to the shop | Mechanism | Finding |
|---|---|---|
| Second device stops receiving *anything* — sales, stock, prices | Merge throws before `setState`; checkpoints never advance; retries re-crash | WAKA-01 |
| A customer is charged twice for a debt they paid | Missed debt payment + ledger-authoritative recompute pushes the balance back up | WAKA-05 + R1 |
| Sales made on Windows/web never reach the cloud | Sync engine's online flag frozen at boot; UI still shows "online" | WAKA-04 |
| Queued money operations silently deleted | `if (!row) return true` ACKs the op when the entity is not in memory | WAKA-06 |
| Any shop's daily takings readable by anyone with the app bundle | Unauthenticated `SECURITY DEFINER` report RPCs | WAKA-03 |
| Any shop's stock levels writable by anyone | `_apply_durable_stock_delta` has no auth check and is anon-executable | WAKA-02 |
| Branch B shows branch A's products and sales | Legacy namespace KV rows copied, never deleted, into each new shop namespace | WAKA-08 |
| Duplicate receipt numbers on the same day | Receipt sequence derived from local sales only | WAKA-10 |
| Bulk price/stock import partially invisible to other devices | Keyset pagination with no tiebreaker; Postgres `now()` is transaction-time | WAKA-07 |
| "Everything is synced" shown while sales failed to download | Pull result discarded; health derived from push only | WAKA-12 |

---

# F. CONFIRMED BUGS

---

## WAKA-01

- **SEVERITY:** P0
- **AREA:** Cloud sync / merge
- **PLATFORM:** All platforms
- **CLASSIFICATION:** CONFIRMED BUG

**TITLE:** Temporal-dead-zone `ReferenceError` aborts every cloud merge once a locally-known customer changes remotely.

**REPRODUCTION SCENARIO:**
1. Device A and device B are both signed into the same shop and have completed a bootstrap pull, so both hold customer `C`.
2. On device A, take a credit sale for `C`, or record a debt payment — anything that bumps the customer row.
3. Device A pushes; `customers.updated_at` moves.
4. Device B runs any incremental pull. `cloud.customers` now contains `C`, and `state.customers` also contains `C`.

**EXPECTED:** Device B merges the customer, the sales, the products and everything else in that pull, and advances its cursors.

**ACTUAL / RISK:** `ReferenceError: Cannot access 'sales' before initialization` is thrown inside `mergeByIdChunked`'s `pick` callback. Execution never reaches `usePosStore.setState` (line 4512) or the checkpoint update (line 4557). **The entire pull is discarded** — products, sales, stock, expenses, everything. Cursors are not advanced, so the next pull returns the same customer and crashes identically. The error is swallowed by `.catch(() => undefined)` in `scheduleBackgroundCloudSync` and reported to the user as nothing at all.

**ROOT CAUSE:** The `pick` closure passed to `mergeByIdChunked` captures `sales`, but `const sales` is declared 40 lines *after* the awaited call that invokes the closure. TypeScript does not report TS2448 for identifiers captured inside a function body, so this compiles clean — verified with `tsc --noEmit --strict` on a minimal reproduction.

```ts
4440  const customers = await mergeByIdChunked(state.customers, cloud.customers, (a, b) =>
4441    mergeCustomerFromCloudPull(a, b, sales, debtPayments, { ledgerAuthoritative }),   // <-- TDZ
4442  );
        ⋮
4481  const sales = absorbCloudSaleAdjustmentLedgers(                                    // <-- declared here
4482    salesUnfiltered, ...
```

Note that `pick` is only invoked for ids present in *both* arrays — which is why a brand-new customer syncs fine and the second change to that customer does not.

**FILES:**
- `src/offline/cloudSync.ts:4440–4442, 4481–4485`
- `src/lib/customerDebtReconciliation.ts:54` (`mergeCustomerFromCloudPull`)
- `src/offline/cloudSync.ts:533–560` (`mergeByIdChunked`)

**FUNCTIONS:** `pullCloudAndMergeIntoStore`, `mergeByIdChunked`, `mergeById`, `mergeCustomerFromCloudPull`

**DATA FLOW:** Device B pull → `pullShopDataFromCloud` returns `cloud.customers` → `mergeByIdChunked(state.customers, cloud.customers, pick)` → `pick(l, existing)` → TDZ throw → propagates out of `pullCloudAndMergeIntoStore` → swallowed by caller.

**WHY IT HAPPENS:** `const` bindings are in the temporal dead zone until their declaration executes. The closure is created before that point and invoked synchronously inside the awaited `mergeByIdChunked` call, i.e. still before line 4481 runs.

**INTRODUCED:** `27e1f7d` · 2026-06-18 · "Enforce subscription limits, harden sync/restore, and add finance diagnostics."

**AFFECTED FEATURES:** All cross-device sync. Sales history, stock levels, price changes, customers, debts, expenses, purchases, day closes, reports on the second device.

**EXISTING TEST THAT SHOULD CATCH IT:** `src/lib/mobileSyncStarvation.test.ts`, `src/lib/recoveryIntegrityFix.test.ts`, `src/lib/multiDeviceDebtPayment.test.ts`

**DOES A TEST ACTUALLY CATCH IT:** **No.** `mobileSyncStarvation` reads the file as a *string* and asserts `toContain("flushIncrementalPersist")` — it never executes the function. `recoveryIntegrityFix` replaces `pullCloudAndMergeIntoStore` with a `vi.fn()`. `multiDeviceDebtPayment` calls `mergeCustomerFromCloudPull` directly, bypassing the caller. **No test in the repository executes `pullCloudAndMergeIntoStore`.**

**MINIMAL FIX RECOMMENDATION:** Move the `const sales = absorbCloudSaleAdjustmentLedgers(...)` declaration (and the `returnRecords` / `voidRecords` it depends on) above the customer merge. Do not reorder anything else. **Read R1 first — this fix unmasks a debt-rebilling path.**

**VERIFICATION REQUIRED:** Add an executable test that calls `pullCloudAndMergeIntoStore` with a hydrated store containing one customer and a cloud payload containing the same customer id. It fails today.

---

## WAKA-02

- **SEVERITY:** P0
- **AREA:** Security / inventory integrity
- **PLATFORM:** Backend (all clients affected)
- **CLASSIFICATION:** CONFIRMED BUG (verified against live production advisor)

**TITLE:** Unauthenticated callers can set any shop's stock to any value.

**REPRODUCTION SCENARIO:** `POST /rest/v1/rpc/_apply_durable_stock_delta` with the public anon key (shipped in the web bundle, the APK and the Windows build) and a body naming any `p_shop_id` / `p_product_id`, `p_reference_type: "adjustment"`, and any `p_delta`.

**EXPECTED:** An internal primitive, callable only by the domain RPCs that already established shop authority.

**ACTUAL / RISK:** The function is `SECURITY DEFINER` (bypasses RLS) and contains **no authentication or authorization check whatsoever** — `v_uid := auth.uid()` is captured but only written into `inventory_movements.created_by`, which is nullable. It performs `UPDATE public.products SET stock_on_hand = …` for the given shop and inserts a movement row. The Supabase security advisor on the live project `ljaedextsenbkxzzgxcg` reports it as executable by the `anon` role via `/rest/v1/rpc/_apply_durable_stock_delta`.

**ROOT CAUSE:** Migration 168 does `revoke all … from public` and `from authenticated` — but never `from anon`. Supabase grants `EXECUTE` to `anon` separately from `PUBLIC`, so that grant survives. The comment above the function ("Internal primitive — not granted to authenticated") shows the intent was understood; the revoke list was simply incomplete.

**FILES:**
- `supabase/migrations/168_adjustment_count_stock_durable_idempotency.sql:18–139`
- also re-revoked with the same incomplete list in `172:154`, `173:137`

**FUNCTIONS:** `public._apply_durable_stock_delta(uuid, uuid, text, uuid, numeric, text, text)`

**DATA FLOW:** anon key → PostgREST `/rpc/_apply_durable_stock_delta` → SECURITY DEFINER → `UPDATE public.products` + `INSERT public.inventory_movements`, bypassing RLS entirely.

**AFFECTED FEATURES:** Inventory integrity for every shop on the platform. Exploitation needs a valid shop + product UUID; **WAKA-03 supplies a way to enumerate shop UUIDs.**

**EXISTING TEST THAT SHOULD CATCH IT:** `src/lib/stockDurableSync.sql.integration.test.ts`

**DOES A TEST ACTUALLY CATCH IT:** **No.** That test exercises the function's *logic* under PGLite as a privileged role. Grants are not asserted anywhere in the repository.

**MINIMAL FIX RECOMMENDATION:** One migration: `revoke all on function public._apply_durable_stock_delta(…) from anon;` and add an explicit guard (`if auth.uid() is null then return not_authenticated`) as defence in depth. Then re-run the advisor. Apply the same revoke to the other 18 anon-exposed `_`-prefixed helpers.

**VERIFICATION REQUIRED:** Call the RPC with only the anon key against a staging project before and after. Re-run `get_advisors(type: "security")` and confirm the count drops.

---

## WAKA-03

- **SEVERITY:** P0
- **AREA:** Security / confidentiality (cross-tenant)
- **PLATFORM:** Backend
- **CLASSIFICATION:** CONFIRMED BUG (verified against live production advisor)

**TITLE:** Any shop's sales, cash, debt and expense totals are readable without signing in.

**REPRODUCTION SCENARIO:** With the anon key and a shop UUID, call any of:
- `_shop_completed_sales_count_for_day(p_shop_id, p_date_key)`
- `_report_cash_drawer_expenses_ugx(p_shop, p_start, p_end)`
- `_report_period_remaining_cash_debt(p_shop, p_start, p_end, …)`

Shop UUIDs are obtainable because `public.shop_pos_staff_revisions` has RLS disabled and is PostgREST-exposed.

**EXPECTED:** Financial aggregates readable only by members of that shop.

**ACTUAL / RISK:** All three are `SECURITY DEFINER` with **no auth check and no `revoke` at all** (the third revokes from `public` only). The live advisor lists 323 `SECURITY DEFINER` functions as anon-executable, 19 of them internal `_`-prefixed helpers.

Separately, the advisor flags three tables with RLS disabled — `shop_pos_staff_revisions`, `waka_shop_number_counter`, `waka_shop_number_released` — at **ERROR level, EXTERNAL-facing**. That matches the migrations exactly: those are the only three of 110 tables with no `enable row level security` statement.

Net effect: a competitor with the app installed can enumerate shops and read their daily takings; the revisions table is also writable, which can corrupt other shops' staff-version sync.

**FILES:**
- `supabase/migrations/069_cash_expenses.sql` (`_report_cash_drawer_expenses_ugx`)
- `supabase/migrations/106_shop_day_drawer_opens.sql` (`_shop_completed_sales_count_for_day`)
- `supabase/migrations/180_shop_summary_sale_voids.sql:496`
- `supabase/migrations/125_staff_version_distribution.sql:6–16` (table created, no RLS)

**DATA FLOW:** anon key → PostgREST `/rpc/_report_*` → SECURITY DEFINER aggregate over `public.sales` / `public.expenses` filtered only by the caller-supplied `p_shop` → returned.

**AFFECTED FEATURES:** Confidentiality of every shop's financial data on the platform.

**DOES A TEST ACTUALLY CATCH IT:** **No.** There is no grant/RLS assertion test, and the PGLite harness runs as a privileged role.

**MINIMAL FIX RECOMMENDATION:** One migration that (a) enables RLS with an owning-shop policy on the three tables, (b) revokes `EXECUTE` from `anon` and `authenticated` on every `_`-prefixed helper, (c) adds `user_can_access_shop(p_shop)` guards to the three report helpers. Also enable Auth leaked-password protection (advisor WARN) and set `search_path` on the 45 functions the advisor flags.

**VERIFICATION REQUIRED:** Re-run the Supabase security advisor; `rls_disabled_in_public` should be zero and the anon-executable count should drop to the intentionally public RPCs only.

---

## WAKA-04

- **SEVERITY:** P0
- **AREA:** Offline detection / sync scheduling
- **PLATFORM:** Web / PWA / Electron (Windows) ONLY — Android and iOS unaffected
- **CLASSIFICATION:** CONFIRMED BUG

**TITLE:** On web and Windows the sync engine never learns that the network came back.

**REPRODUCTION SCENARIO:**
1. Open WAKA on Windows (Electron) or in a browser while the connection is down.
2. Take sales — they queue correctly.
3. Restore the connection. The header indicator flips to "online".
4. Wait indefinitely.

**EXPECTED:** Reconnect triggers a push flush and an incremental pull.

**ACTUAL / RISK:** Nothing syncs until the app is restarted while online. Sales, debt payments and stock changes stay in the local queue; other devices and every report never see them.

The reconnect effect in `useSyncStatus.tsx` *does* fire — it listens to `useOfflineStatus`, which handles web `online`/`offline` events correctly — but the first line of `runPosPushFlush` and `runFlush` is `if (!getDeviceOnline() || syncingRef.current) return;`, and every push/pull branch in `syncShopWithCloudInner` is gated the same way.

**ROOT CAUSE:** `src/lib/deviceOnline.ts` is 30 lines. The module-level `deviceOnline` flag is initialised once from `navigator.onLine` and mutated only inside `initDeviceOnlineTracking`, which begins `if (!Capacitor.isNativePlatform()) return;`. There is no `window.addEventListener("online" | "offline")` anywhere that writes to it. The `waka:network-online` event that `useAuth` and `CloudRecoveryScreen` listen for is dispatched only from the Capacitor Network listener, so those recovery paths are also dead on web and Electron.

**FILES:**
- `src/lib/deviceOnline.ts:4–29`
- `src/hooks/useSyncStatus.tsx:137, 164, 268–290`
- `src/offline/cloudSync.ts:4767, 4863–4877`
- `src/lib/capacitorInit.ts:11, 19`

**FUNCTIONS:** `getDeviceOnline`, `initDeviceOnlineTracking`, `runPosPushFlush`, `runFlush`, `syncShopWithCloudInner`, `runIncrementalCloudPull`

**DATA FLOW:** network returns → browser `online` event → `useOfflineStatus` setState → reconnect effect → `runPosPushFlush` → `getDeviceOnline()` still `false` → early return → no push, no pull.

**AFFECTED FEATURES:** Every Windows/Electron terminal and every browser/PWA terminal that starts while offline.

**DOES A TEST ACTUALLY CATCH IT:** **No.** `vitest` runs with `environment: "node"` — there is no `window`, no `navigator.onLine`, and no DOM event test for this module.

**MINIMAL FIX RECOMMENDATION:** In `initDeviceOnlineTracking`, register web `online`/`offline` listeners on the non-native branch that update `deviceOnline` and dispatch the same `waka:network-online` / `waka:network-offline` events, instead of returning early.

**VERIFICATION REQUIRED:** In Electron and Chrome DevTools, toggle offline → make a sale → toggle online, and assert the queue drains without a reload.

---

## WAKA-05

- **SEVERITY:** P0
- **AREA:** Incremental pull / cursors
- **PLATFORM:** All platforms
- **CLASSIFICATION:** CONFIRMED BUG (code defect confirmed; trigger magnitude needs field measurement)

**TITLE:** Pull cursors are client-clock timestamps, so device clock skew silently and permanently deletes remote records from a device's view.

**REPRODUCTION SCENARIO:**
1. Device B's clock runs 10 minutes fast (common on low-cost Android terminals and on desktops without NTP).
2. B performs a pull that returns no rows. The cursor is set to `new Date().toISOString()` — a timestamp 10 minutes in the server's future.
3. Three minutes later (server time) device A completes a sale.
4. B pulls again with `.gt("updated_at", <future cursor>)`. A's sale is excluded, zero rows come back, and the cursor jumps forward again.

**EXPECTED:** Cursors track server time; nothing written on the server is skipped.

**ACTUAL / RISK:** Device A's sale is **never** returned to device B. The cursor only moves forward, so there is no self-healing path short of a forced full sync. The same pattern applies to all 19 cursors — sales, products, customers, debt payments, returns, voids, purchases, suppliers, stock movements.

Write-side skew is equally damaging in the other direction: `customerToRow` stamps `updated_at: new Date().toISOString()` from the client, and `shop_push_debt_payment` stores `created_at` from the client payload. A device with a *slow* clock writes rows that are already behind other devices' cursors.

**ROOT CAUSE:** Three compounding decisions, no server-time source anywhere in the sync path:

```ts
// cloudSync.ts — repeated for 12 entities
checkpointAt: checkpointAt > since ? checkpointAt : new Date().toISOString()

// syncCheckpoints.ts:163
export function markBootstrapSyncComplete(at = new Date().toISOString())

// cloudSync.ts:510 — client clock written into the server row
customerToRow: { …, updated_at: new Date().toISOString() }
```

```sql
-- migrations/174_debt_payment_durable_idempotency.sql:30
v_created_at := coalesce(nullif(p_payload ->> 'created_at', '')::timestamptz, now());
```

**FILES:**
- `src/offline/cloudSync.ts:2797, 2887, 2942, 3001, 3048, 3072, 3150, 3218, 3302, 3359, 3418, 3483, 3496, 3769`
- `src/offline/cloudSync.ts:510` (`customerToRow`)
- `src/lib/syncCheckpoints.ts:138–186`
- `supabase/migrations/174_debt_payment_durable_idempotency.sql:30`

**FUNCTIONS:** `pullSalesIncremental`, `pullProductsIncremental`, `pullCustomersIncremental`, `pullDebtPaymentsIncremental`, `markBootstrapSyncComplete`, `updateCheckpointsAfterIncrementalPull`, `customerToRow`

**AFFECTED FEATURES:** All cross-device consistency. Most damaging for debt payments, where a missed payment feeds the ledger recompute (see R1).

**DOES A TEST ACTUALLY CATCH IT:** **No.** `syncCheckpoints` has unit tests for read/write shape only; no test simulates skew or asserts that a cursor never exceeds the newest row seen.

**MINIMAL FIX RECOMMENDATION:**
1. When a page returns zero rows, **leave the cursor unchanged** rather than advancing it to local `now()`.
2. Take the checkpoint from a server-supplied timestamp — either the max `updated_at` actually observed (already computed) or a `select now()` returned alongside the page — never from `Date.now()`.
3. Server-side, stamp `updated_at`/`created_at` with `now()` and keep the client value only as a separate `client_created_at` column for business-date purposes.

**VERIFICATION REQUIRED:** Two-device test with device B's clock offset by +10 minutes; assert every row written by A appears on B.

---

## WAKA-06

- **SEVERITY:** P0
- **AREA:** Sync queue
- **PLATFORM:** All platforms
- **CLASSIFICATION:** CONFIRMED BUG

**TITLE:** Queued money operations are acknowledged and deleted when their record is not in memory.

**REPRODUCTION SCENARIO:**
1. Record a debt payment or a cash expense while offline.
2. Close the app. Reopen it, or switch shop — the store is reset and rehydrates asynchronously.
3. A queue flush runs before hydration finishes (startup idle flush, reconnect flush, or the safety interval).

**EXPECTED:** The operation waits for a state in which it can be pushed, or the entity is loaded from IndexedDB.

**ACTUAL / RISK:** The handler finds no matching row in `usePosStore.getState()`, returns `true`, and `flushSyncQueueInner` treats that as an ACK and calls `removeSyncOperation(op.id)`. **The operation is gone.** The local record still shows the payment; the cloud never receives it. This is the mechanism by which a shop's books and the cloud's books silently diverge.

Affected handlers, all of which touch money or stock:

| Op kind | Line | Record consulted |
|---|---|---|
| `customer` / `debt_payment` | 861, 862 | `state.debtPayments`, `state.customers` |
| `customer` | 2510 | `state.customers` |
| `pending_cash_expenses` | 2484 | `state.cashExpenses` |
| `pending_day_closes` | 2472 | `state.dayCloses` |
| `pending_shifts` | 2453 | `preferences.shifts` |
| `pending_inventory_counts` | 2437 | `state.inventoryCountSessions` |
| `product` | 2284, 2288 | `state.products` |
| `supplier` | 2334 | `state.suppliers` |
| `pending_expenses` (supplier payment) | 2422 | `state.supplierPayments` |

**ROOT CAUSE:** `true` is overloaded: it means both "pushed successfully" and "nothing to push". Sales avoid the trap because they use `resolveSaleForSync`, which falls back to `getEntitiesByIds("sale", …)` on disk; no other entity has that fallback. Compounding it, `pullCloudAndMergeIntoStore` guards on `if (!state._hydrated) return failMerge(...)` but **the entire push path has no `_hydrated` guard at all**.

**FILES:**
- `src/offline/cloudSync.ts:854–862, 2284–2340, 2422–2512`
- `src/offline/syncEngine.ts:156–158` (ACK → `removeSyncOperation`)

**FUNCTIONS:** `processCloudSyncOperationLegacy`, `pushDebtPaymentToCloud`, `flushSyncQueueInner`

**AFFECTED FEATURES:** Debt payments, cash expenses, day closes, shifts, inventory counts, product/supplier updates, supplier payments.

**DOES A TEST ACTUALLY CATCH IT:** **No — and it structurally cannot.** `src/test/vitest.setup.ts` globally mocks `../offline/localDb` so that `readSyncQueue` always resolves `[]`. Every test that exercises queue draining sees an empty queue.

**MINIMAL FIX RECOMMENDATION:** Add a `_hydrated` guard to `flushSyncQueueInner` (return `retry` for the whole pass when the store is not hydrated), and change every `if (!row) return true` to a disk lookup followed by `return "retry"`, reserving the ACK for a positively confirmed absence (e.g. a tombstone).

**VERIFICATION REQUIRED:** Requires the local-DB mock to be removed for sync tests (see section I). Then: enqueue an op, clear the store, flush, and assert the op survives.

---

## WAKA-07

- **SEVERITY:** P1
- **AREA:** Incremental pull / pagination
- **PLATFORM:** All platforms
- **CLASSIFICATION:** CONFIRMED BUG

**TITLE:** Keyset pagination has no tiebreaker, so bulk writes are truncated at the page boundary.

**REPRODUCTION SCENARIO:** Bulk-import or bulk-update more than 500 products (or more than 300 sales / 500 returns) in a single database transaction — for example an AI bulk-inventory run, a catalog import, or a price update applied with one `UPDATE`.

**EXPECTED:** All changed rows eventually reach every device.

**ACTUAL / RISK:** Postgres `now()` is transaction-start time, so every row touched by one transaction shares an identical `updated_at`. The pull loop returns a full page of rows all bearing that timestamp; `checkpointAt` equals the incoming `cursor`, so `cursor = checkpointAt` is a no-op and the next page is byte-identical. After 40 wasted round trips the loop stops and writes that timestamp as the new checkpoint. Every remaining row with the same `updated_at` is **skipped permanently**.

**ROOT CAUSE:**
```ts
.gt("updated_at", cursor).order("updated_at", {ascending:true}).limit(LIMIT)
…
checkpointAt = maxRowUpdatedAt(batch, checkpointAt);   // == cursor when all equal
cursor = checkpointAt;                                  // no progress
```
A composite `(updated_at, id)` keyset is needed. The same pattern appears in every incremental puller.

**FILES:** `src/offline/cloudSync.ts:2769–2798` (sales), `2858–2888` (products), `2921–2943` (customers), `3128–3152` (returns), `3196–3220` (voids), `3280–3306` (purchases), `3337–3363` (suppliers), `3396–3422` (supplier payments), `3461–3487` (debt payments)

**DOES A TEST ACTUALLY CATCH IT:** **No.** No test constructs a page of rows sharing one timestamp.

**MINIMAL FIX RECOMMENDATION:** Order by `(updated_at, id)` and page with `.or("updated_at.gt.X,and(updated_at.eq.X,id.gt.Y)")`, carrying the last row's id in the cursor. Alternatively add a monotonic `bigserial` sequence column per synced table and page on that — more invasive, but it also removes the clock dependency in WAKA-05.

**VERIFICATION REQUIRED:** Seed 600 products in one transaction, pull, assert 600 arrive.

---

## WAKA-08

- **SEVERITY:** P1
- **AREA:** Shop scoping / local persistence
- **PLATFORM:** Multi-branch deployments
- **CLASSIFICATION:** CONFIRMED BUG

**TITLE:** A second shop on the same device inherits the first shop's local snapshot.

**REPRODUCTION SCENARIO:**
1. Sign in and work in shop A on a device where `activeShopId` was null at some point (offline first sign-in, or an upgrade from a pre-MB-1 build). Data is written to the legacy namespace `sb:<uid>`.
2. Shop A is resolved; `migrateLegacyPersistenceToShop("A")` copies the legacy KV rows to `sb:<uid>:A`.
3. Later, switch to shop B on the same device.

**EXPECTED:** Shop B starts empty and bootstraps from B's cloud data. The file's own header says "Never assigns legacy data to an uncertain shop."

**ACTUAL / RISK:** The migration flag is keyed per `(accountKey, shopId)`, so it has not run for B. The legacy KV rows were **copied, not moved** — they still exist under `sb:<uid>::`. `legacyHasData` is still true and `scopedHasData` for B is false, so shop A's snapshot is copied into `sb:<uid>:B::snapshot`. Since `readSnapshotWithFallback` is the primary hydration source, **shop B's terminal displays shop A's products, sales, customers and debts.**

The `records` store and `syncQueue` are safe — those rows are *moved* (accountKey rewritten, old key deleted), so the second pass finds nothing. Only the KV branch copies.

**ROOT CAUSE:**
```ts
const txKv = db.transaction("kv", "readwrite");
for (const key of kvKeys) {
  if (!key.startsWith(legacyPrefix)) continue;
  const value = await txKv.store.get(key);
  if (value !== undefined) {
    await txKv.store.put(value, `${scopedPrefix}${suffix}`);  // copy…
  }
}                                                              // …never deleted
```

**FILES:**
- `src/offline/shopScopeMigration.ts:81–90`
- `src/lib/initializeActiveShop.ts:30, 65`

**DOES A TEST ACTUALLY CATCH IT:** **No.** The global `localDb` mock makes IndexedDB migration untestable in this suite.

**MINIMAL FIX RECOMMENDATION:** Delete the legacy keys inside the same transaction after copying them, and record a single global "legacy claimed by shop X" flag rather than a per-shop flag.

**VERIFICATION REQUIRED:** Needs a real IndexedDB (`fake-indexeddb`): seed legacy rows, migrate to A, then migrate to B, assert B's namespace is empty.

---

## WAKA-09

- **SEVERITY:** P1
- **AREA:** Full / bootstrap pull, recovery
- **PLATFORM:** All platforms
- **CLASSIFICATION:** CONFIRMED BUG

**TITLE:** Full/bootstrap pull queries a sale status that does not exist, so voided sales are never tombstoned on recovery.

**REPRODUCTION SCENARIO:** Void a completed sale on device A. On device B, run a cloud recovery or forced full sync while B still holds that sale locally.

**EXPECTED:** `voidedSaleIds` contains the sale, `addVoidedSaleTombstones` records it, and the sale is filtered out of B's history and totals.

**ACTUAL / RISK:** `pullSalesFull` collects live sales with `.in("status", ["completed","draft"])` and then runs a second query for `.eq("status", "voided")`. The `sales_status_check` constraint permits only `draft · completed · void · refunded · cancelled` — **`'voided'` is not a legal value**, so the second query always returns zero rows. `voidedSaleIds` comes back empty from every full pull, and B's local copy of the voided sale survives the merge and keeps contributing to revenue and profit totals.

The incremental path is correct: it has no status filter and `parseSaleRows` classifies `void`/`refunded` properly. So this bites specifically on recovery and forced-full paths — exactly when the shop is already in trouble.

**FILES:**
- `src/offline/cloudSync.ts:2733–2753` (dead query), `2688–2692` (`parseSaleRows`)
- `supabase/migrations/005_customers_and_sales.sql:28`, `071_pending_sales.sql:13`

**DOES A TEST ACTUALLY CATCH IT:** **No.** `cloudRecoveryDeviceE2E.test.ts` mocks the pull layer.

**MINIMAL FIX RECOMMENDATION:** Change the second query to `.in("status", ["void","refunded","cancelled"])`, or drop it and remove the status filter from the first query so `parseSaleRows` classifies everything.

**VERIFICATION REQUIRED:** Full-pull integration test with one voided sale present locally; assert it is tombstoned.

---

## WAKA-10

- **SEVERITY:** P1
- **AREA:** Receipts
- **PLATFORM:** Multi-device
- **CLASSIFICATION:** CONFIRMED BUG

**TITLE:** Receipt numbers are generated from local sales only and collide across terminals.

**REPRODUCTION SCENARIO:** Two terminals in one shop each complete a sale on the same Kampala calendar day before syncing.

**EXPECTED:** Receipt numbers are unique per shop per day.

**ACTUAL / RISK:** `receiptSeq = scanTodaySalesHead(state.sales, todayKey).nextReceiptSeq` — the maximum `receiptSeq` among the sales *this device* holds, plus one. Both terminals mint the same number. Two different customers walk out with receipt #14; reconciliation, customer lookups by receipt, and any EFRIS/compliance correlation break.

The server has a `build_receipt_code` function and a `create_receipt_for_sale` RPC — the client does not use them for this value.

**FILES:**
- `src/store/usePosStore.ts:5143, 5155`
- `src/lib/salesDayIndex.ts:185–204`

**DOES A TEST ACTUALLY CATCH IT:** **No.** `salesDayIndex` tests assert single-device sequencing only.

**MINIMAL FIX RECOMMENDATION:** Keep the local sequence for the offline receipt, but make the displayed identity device-qualified (terminal letter + sequence), or adopt a server-assigned receipt code on ACK and reprint. Whichever is chosen, it is a product decision as much as a code fix.

**VERIFICATION REQUIRED:** Two-device offline test asserting no duplicate `(dateKey, receiptSeq)` after both sync.

---

## WAKA-11

- **SEVERITY:** P1
- **AREA:** Sync queue lifecycle
- **PLATFORM:** All platforms
- **CLASSIFICATION:** CONFIRMED BUG

**TITLE:** Operations can become permanently stuck in the queue with no escalation and no exit.

**REPRODUCTION SCENARIO:** Two independent paths:
1. An op fails 100 times (a payload the server always rejects).
2. A multi-branch user has queued ops for shop A and switches the active shop to B.

**EXPECTED:** The op is quarantined, surfaced to the user, and stops consuming flush budget.

**ACTUAL / RISK:**
- **Path 1:** `if (op.attempts < 100)` guards the re-append. Once `attempts` reaches 100, the op is neither updated nor removed. `lastAttemptAt` stops moving, so `shouldRetrySyncOp` is permanently true past the 5-minute backoff cap, and the op is retried on *every* flush forever with no counter and no user-facing state.
- **Path 2:** `processOne` returns `"retry"` when `activeShop && opShopId !== activeShop`. Shop A's ops can never drain while B is active, and each pass counts them as failures — which degrades the reported queue health for shop B.
- Ops with no resolvable shop id are also quarantined into an infinite retry via `reportSyncIssue("sync_quarantined_no_shop")` + `"retry"`.

**FILES:**
- `src/offline/syncEngine.ts:58–67, 159–176`
- `src/lib/autoSync.ts:9–27, 43–52`

**DOES A TEST ACTUALLY CATCH IT:** **Partially.** `autoSync.test.ts` covers backoff maths. It does not cover the ≥100 branch, and the empty-queue mock prevents any real drain test.

**MINIMAL FIX RECOMMENDATION:** Introduce an explicit `quarantined` state: past a threshold, stop retrying, keep the row, and surface it in the sync health panel with a manual retry. Drain per-shop queues on shop switch rather than skipping them.

**VERIFICATION REQUIRED:** Assert queue depth and per-op attempts converge after N failing flushes.

---

## WAKA-12

- **SEVERITY:** P1
- **AREA:** Error surfacing / sync health
- **PLATFORM:** All platforms
- **CLASSIFICATION:** CONFIRMED BUG

**TITLE:** A pull that failed to download sales still reports a healthy, fully-synced state.

**REPRODUCTION SCENARIO:** Cause the sales pull to fail (RLS denial, timeout, malformed row) while pushes succeed.

**EXPECTED:** The user is told that sales could not be downloaded and that the figures on screen are incomplete.

**ACTUAL / RISK:** `pullEntitySafe` records the error in `entityErrors` and returns `undefined`. `pullCloudAndMergeIntoStore` still returns `true`. In `useSyncStatus.runFlush` the pull result is explicitly discarded — `void pulled;` — and health is written as `lastSuccessAt` whenever `push.fail === 0 && queueFailed === 0`. The indicator shows green while the day's sales are missing from every report on that device.

The cursor *is* correctly not advanced, so the data is recoverable — but the operator has no reason to think anything is wrong.

**FILES:**
- `src/lib/pullEntitySafe.ts:9–16`
- `src/offline/cloudSync.ts:3576–3714, 4557–4561`
- `src/hooks/useSyncStatus.tsx:198–212`

**DOES A TEST ACTUALLY CATCH IT:** **No.**

**MINIMAL FIX RECOMMENDATION:** Propagate `entityErrors` into `SyncHealthMeta` and render a partial-sync state ("sales not up to date") distinct from both "synced" and "offline".

**VERIFICATION REQUIRED:** Force one entity puller to throw; assert the UI does not show a healthy state.

---

# G. HIGH-CONFIDENCE RISKS

Supported by code evidence, but the trigger conditions have not been observed in this environment.

| ID | Sev | Risk | Evidence |
|---|---|---|---|
| **R1** | P0 | **Fixing WAKA-01 unmasks debt re-billing.** `mergeCustomerFromCloudPull` with `ledgerAuthoritative` recomputes the balance as `sum(sale.debtUgx) − sum(local debtPayments)` and overwrites the server value with `version+1`. Combined with WAKA-05, a device that never received a payment restores the pre-payment balance and pushes it back. `ledgerAuthoritative` is true in nearly all cases — it is satisfied by `lastDebtPaymentsSyncAt != null` alone. | `customerDebtReconciliation.ts:54–70`, `cloudSync.ts:4434–4442`, `customerDebt.ts:28–36` |
| **R2** | P1 | **Local sales history can be deleted from disk.** `persistArrayDelta` deletes every entity row whose id left the previous in-memory array. Any state where RAM holds a partial sales list and a persist runs without `runWithPersistSuspendedSync` permanently removes those sales from IndexedDB. The manifest's `salesOrder` is protected during hydration; the entity rows are not. | `incrementalPersist.ts:36–57, 111–113` |
| **R3** | P2 | **Legacy snapshot claim probably fails silently.** `claimLegacySnapshotForCurrentAccount` calls `db.get(...)` — which opens a *new* transaction — in the middle of an open `readwrite` transaction. The outer transaction auto-commits across that await, so the subsequent `put`/`delete` should throw `TransactionInactiveError`, caught by a bare `catch { return null }`. | `offline/localDb.ts:279–292` |
| **R4** | P2 | **Mixed ISO formats in lexicographic cursor comparison.** `maxIsoTimestamp` compares strings. Client cursors end in `Z` with 3 fractional digits; PostgREST returns `+00:00` with 6. At an equal-second boundary `'Z' > '1'`, so the cursor refuses to advance past the newest row and that page is re-pulled on every sync — wasted bandwidth, and a stalled cursor if the newest row sits at the boundary. | `cloudSync.ts:2663–2674` |
| **R5** | P2 | **Home KPI overlay failures are invisible.** `fetchShopHomeKpiOverlay(...).catch(() => setOverlay(null))` silently drops shop-wide figures back to this device's local subset with no indication. The effect also re-subscribes on every `pendingCount` change, refetching more often than the 30 s interval implies. | `hooks/useShopHomeKpiOverlay.ts:27–46` |
| **R6** | P2 | **Systemic error suppression.** 177 empty or comment-only `catch` blocks across 98 non-test files, plus 41 `.catch(() => undefined)` and 15 more returning a falsy default. Only four sync codes reach the user at all (`USER_FACING_SYNC_CODES`); everything else goes to Sentry or nowhere. | repo-wide, `lib/monitoring.ts:65–70` |
| **R7** | P3 | **Debt-payment submit lock is release-by-convention.** The success path deliberately keeps the lock; it is cleared only when `DebtReceivePaymentSheet` is (re)opened. Correct today, but any second caller of `addDebtPayment` would permanently block a repeat identical payment for the session with error key `"invalid"`. | `lib/debtPaymentSubmitGuard.ts:1–14`, `components/debts/DebtReceivePaymentSheet.tsx:25–31` |
| **R8** | P2 | **45 functions with mutable `search_path`** (live advisor). For `SECURITY DEFINER` functions this is a privilege-escalation vector if any caller can influence `search_path`. | Supabase advisor, `function_search_path_mutable` |

---

# H. RUNTIME VERIFICATION REQUIRED

Things this audit could not settle by reading code, ordered by how much they change the picture.

1. **Is WAKA-01 firing in the field?** Sentry is wired via `crashReporting.ts`. Search for `Cannot access 'sales' before initialization`. Its frequency tells you how much of the fleet has had broken cross-device sync since June, and how much divergence you are about to reconcile.
2. **Actual clock skew across the fleet.** Add a one-line diagnostic comparing `Date.now()` against a server `now()` at sign-in. This converts WAKA-05 from a theoretical to a measured risk and tells you how many shops need a forced full resync after the fix.
3. **Anon RPC exploitability end-to-end.** Against staging only: confirm that the anon key can in fact call `_apply_durable_stock_delta` and the `_report_*` helpers, and that `shop_pos_staff_revisions` is selectable. This decides whether WAKA-02/03 are a hotfix or a scheduled fix.
4. **Queue depth and stuck-op distribution.** Read `syncQueue` on a few real terminals: how many ops have `attempts >= 100`, and how many carry a `shopId` other than the active shop.
5. **Electron and iOS behaviour under WAKA-04.** Confirm the Electron renderer receives `navigator.onLine` transitions at all, and confirm iOS Capacitor Network events fire on cellular↔wifi handover (Android is the better-tested path).

---

# I. TEST INFRASTRUCTURE

640 test files. The distribution of what they actually prove is the most important thing in this section.

- Test files: **640**
- Source-text assertion files (`readFileSync`): **126**
- Mock-based files (`vi.mock`): **78**
- Real SQL integration (PGLite): **10**
- Files that never run (`.test.tsx` excluded by `include`): **1**
- Total assertions: 15,244 — of which **2,167 are `toContain`**

## What is genuinely tested

- **Pure business functions.** ~199 files with neither `readFileSync` nor `vi.mock` exercise real logic: money maths, discount policy, debt reconciliation, sale lifecycle, stock movement merge, permission matrix. This is solid work and should not be disturbed.
- **Server RPCs.** The 10 `*.sql.integration.test.ts` files run the actual migration SQL under PGLite with a seeded fixture and role switching — `debtPaymentConcurrency`, `saleVoidStock`, `purchaseVoidStock`, `stockDurableSync`, `stockTransferEngine`, `closedBusinessDateGuard`, `shopSummaryVoids`. This is the strongest coverage in the repository and is why the server side holds up.

## What is only unit-tested

Every merge function is tested in isolation but never through its caller. `mergeCustomerFromCloudPull`, `mergeSaleFromCloudPull`, `mergeDebtPaymentsFromCloudPull` and `mergeStockMovementsWithArchive` all have direct unit tests that pass — which is precisely why WAKA-01, a defect in the *call site*, was invisible.

## What is not tested at all

**The offline layer has no executable coverage, by construction.** `src/test/vitest.setup.ts` applies a global `vi.mock("../offline/localDb")` to **every test in the suite**. `readSyncQueue` always resolves `[]`; `appendSyncOperation`, `removeSyncOperation` and `writeSnapshot` are no-ops. There is no `fake-indexeddb` dependency and `environment: "node"` means no DOM. So IndexedDB persistence, the sync queue lifecycle, namespace migration, snapshot rotation and backup restore are all unreachable from the test suite — the layer the whole offline-first promise rests on.

## Tests that pass while the application is broken

| Test | Why it can't fail | Misses |
|---|---|---|
| `mobileSyncStarvation.test.ts` | `readFileSync` + `toContain("flushIncrementalPersist")` — asserts the source contains a substring, never runs it | WAKA-01 |
| `recoveryIntegrityFix.test.ts` | Replaces `pullCloudAndMergeIntoStore` with `vi.fn()` — tests the orchestration around the bug | WAKA-01, 09 |
| `multiDeviceDebtPayment.test.ts` | Reimplements `shop_push_debt_payment` in TypeScript (`applyServerDebtPayment`) and calls merge functions directly | WAKA-01, 05, R1 |
| `autoSync.test.ts` | Backoff arithmetic only; the queue it would drain is mocked empty | WAKA-06, 11 |
| `productionHardening.test.ts` | Source-text assertions across many files | everything behavioural |
| `enterpriseTypographyComponents.test.tsx` | `include: ["src/**/*.test.ts"]` excludes `.tsx` — this file has never executed | itself |

Source-text assertions are a legitimate tool for enforcing an invariant that has no runtime handle, but here they stand in for behavioural tests on the highest-risk code in the product.

## Critical paths with no meaningful coverage

- Sync queue enqueue → flush → ACK → removal (the money-durability path)
- `pullCloudAndMergeIntoStore` — the entire merge, on any input
- Cursor advancement, clock skew, page-boundary truncation
- IndexedDB namespace migration and multi-shop isolation
- Snapshot write/rotate/restore and backup integrity
- Online/offline transitions on web and Electron
- RLS and function grants (no test asserts a role *cannot* do something)
- Any DOM/component behaviour whatsoever

---

# HOMEPAGE INVENTORY

Structure and data sources only — per-card behaviour deferred to the systematic homepage pass, as instructed.

`HomePage` is a redirect shim: it resolves `resolveTerminalHomePath(preferences, role, permissions)` and, if the role has a dedicated terminal (pharmacy, hospitality, kitchen), navigates away. Otherwise it renders `DesktopHomePage` → `DesktopHomeTiles` + `DesktopLicenseBar`.

Twelve launcher tiles plus a dashboard region are defined in `lib/launcherTiles.ts`:
`sell · inventory · debts · shop · cash · cashPosition · commandCenter · salesHistory · reports · profit · investigation · settings · dashboard`

Around them sit ~28 home components — executive KPI strip, business-health section, live status rail, pulse sparkline, cash-drawer scene, reports preview, Ask Waka shortcut, status chips, subscription banner, and a separate mobile cockpit.

| Surface | Data source | Local / remote | Refresh | Offline |
|---|---|---|---|---|
| Executive KPIs, pulse, week trend | `useHomeDashboardMetrics` → `localReporting` over `useReportingSales` | Local store | Re-derives on every store change | Full function |
| Shop-wide KPI overlay | `fetchShopHomeKpiOverlay` → daily/monthly RPC | Remote | 30 s + visibilitychange + on `pendingCount`/health change | Cleared to `null`, falls back to this device's local subset — **silently** |
| Today's figures when the day is closed | `authoritativeCloseForDate` / `readClosedDayTotals` | Local (server-originated) | On day-close pull | Full function |
| Stable today KPI | `todayKpiSnapshot`, bumped inside `finalizeDraftSale` | Local, written to KV | Immediate on sale | Full function |
| Drawer cash | `useDrawerCashForDay` | Local | Store change | Full function |
| Low stock count | `products` | Local | Store change | Full function |
| Sync / license / subscription chips | `useSyncStatus`, `useSubscription` | Mixed | Queue poll interval | Shows cached entitlement |
| Tile visibility | `resolveVisibleHomeMetrics(role)`, `resolveProfitVisibility`, `permissionsHasEffective` | Local | On actor change | Full function |

Two structural observations to carry into the homepage pass:

- **Staleness is possible and unsignalled.** Every tile except the overlay reads the local store, so on a device affected by WAKA-01, WAKA-04 or WAKA-05 the home screen displays confidently wrong numbers with a green sync indicator.
- **Scope is role-dependent.** `homeMetrics.scope` switches between `shop_wide` and per-seller, and the shop-wide overlay is only requested for `authMode === "supabase"` — so an owner and a cashier on the same shop legitimately see different totals, which is easy to mistake for a sync fault when triaging.

---

# J. RECOMMENDED FIX ORDER

Ordered by the stated priority — data integrity, then financial correctness, then reliability — with one sequencing constraint that matters more than the priority list.

> **SEQUENCING CONSTRAINT:** Do not ship WAKA-01 alone. Restoring the merge re-enables the ledger-authoritative customer recompute on devices that may be missing debt payments because of WAKA-05. Fix the cursors, or disable `ledgerAuthoritative` behind a flag, in the same release.

| # | Work | Findings | Why here |
|---|---|---|---|
| 0 | **Test harness first.** Add `fake-indexeddb`, scope the global `localDb` mock to the tests that need it, add `.test.tsx` to the vitest include. Then write one executable test for `pullCloudAndMergeIntoStore` that fails today. | §I | Every fix below is unverifiable without it. This is a day of work that de-risks weeks. |
| 1 | **Security hotfix.** One migration: revoke `anon`/`authenticated` EXECUTE on all `_`-prefixed helpers, enable RLS on the three exposed tables, add shop guards to the report helpers. | WAKA-02, 03, R8 | Independent of the client, deployable immediately, and currently live. |
| 2 | **Cursor correctness + WAKA-01 together.** Never advance a cursor on an empty page; source checkpoints from server time; move the `sales` declaration. | WAKA-01, 05, R1 | Restores cross-device sync without opening the debt-rebilling path. |
| 3 | **Stop dropping queued work.** `_hydrated` guard on flush; replace `if (!row) return true` with a disk lookup and `retry`. | WAKA-06 | Direct money loss; the fix is mechanical once step 0 makes it testable. |
| 4 | **Web/Electron online detection.** Register web network listeners in `initDeviceOnlineTracking`. | WAKA-04 | Small, self-contained, and unblocks an entire platform's offline story. |
| 5 | **Pagination tiebreaker.** Composite `(updated_at, id)` keyset on all nine incremental pullers. | WAKA-07 | Same code paths as step 2 — do it while they are open. |
| 6 | **Multi-branch isolation.** Delete legacy KV rows after copying; single global claim flag. Consider a one-off repair for devices already contaminated. | WAKA-08 | Affects a subset of shops, but the failure is total for those shops. |
| 7 | **Queue quarantine + honest sync health.** Explicit terminal state with manual retry; propagate `entityErrors` into the indicator; add a partial-sync state. | WAKA-11, 12, R6 | Turns silent divergence into something a shopkeeper can act on. |
| 8 | **Recovery-path correctness.** Fix the `'voided'` status query; audit `persistArrayDelta` deletion against partial hydration. | WAKA-09, R2 | Matters most exactly when a shop is already recovering. |
| 9 | **Receipt identity.** Product decision, then implementation. | WAKA-10 | Real, but visible and worked around today. |
| 10 | **Homepage systematic pass** — with the sync layer trustworthy, so a wrong number on Home means a Home bug. | Homepage | Auditing the display layer over an unreliable data layer wastes the pass. |
| 11 | Legacy-claim transaction bug, ISO format normalisation, overlay error surfacing, debt-lock hardening. | R3, R4, R5, R7 | Low blast radius; batch them. |

## One structural note, not a fix

`usePosStore.ts` at 9,600 lines and `cloudSync.ts` at 4,963 lines are where all four P0 client bugs live, and all four are **ordering or scope mistakes rather than logic mistakes** — a declaration in the wrong place, a flag never updated, a guard on one path and not its twin. That is what file size costs. This is not an argument for refactoring now; it is an argument for extracting *only* the merge pipeline out of `cloudSync.ts` once steps 2, 3 and 5 have landed and are covered by tests, so the next mistake of this shape is caught.

---

*Phase 0 · read-only. No repository files were modified. Findings verified against `6b6ed11` and, for backend items, against the live Supabase project via the security advisor. Awaiting approval before any implementation.*

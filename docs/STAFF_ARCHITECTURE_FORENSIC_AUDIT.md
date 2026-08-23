# STAFF_ARCHITECTURE_FORENSIC_AUDIT

**Scope:** Staff identity, authentication, sale attribution, inventory coupling, dashboards, sync.  
**Mode:** Static forensic audit. No source, schema, or production changes.  
**Date:** 2026-08-22  
**Repo:** pos-waka (`main`)

Legend: **EVIDENCE** = proven from code. **INFERENCE** = logically follows but needs a live shop reproduction.

---

# 1. Executive Verdict

**C. ARCHITECTURE HAS FINANCIAL DATA INTEGRITY RISK — FREEZE NEW STAFF FEATURES**

Staff are not first-class cloud users. A cashier sale is attributed locally as `staff:<uuid>`, then **cannot** be stored that way on Supabase (`sales.created_by` is `uuid references auth.users`). Sync **rewrites** attribution to the signed-in owner’s `auth.uid()`. Cashier Home, POS today, and Receipts then filter with **exact string equality** on `staff:<id>`. After a cloud pull, that equality fails. Owner shop-wide totals can also miss the sale if the local replica is thin and the cloud overlay has not landed, while **stock can still move** (local `finalizeDraftSale` plus server `apply_sale_stock_movements`, or a later product pull).

This is not a single UI bug. It is a broken identity + ledger contract.

---

# 2. Confirmed Facts

1. **EVIDENCE** `SessionActor.userId` for PIN staff is always `` `staff:${staffId}` `` (`src/lib/sessionActor.ts` `resolveSessionActor`).
2. **EVIDENCE** Completed checkout writes `soldByUserId: state.sessionActor?.userId ?? null` (`src/store/usePosStore.ts` `finalizeDraftSale`).
3. **EVIDENCE** That value may be `null` if `sessionActor` is unset.
4. **EVIDENCE** Cloud push sets `created_by` only when `isUuid(sale.soldByUserId)`; otherwise it uses `ctx.userId` (`src/offline/cloudSync.ts` `buildSalePushPayload` / `buildPendingSalePushPayload`). `staff:…` is **not** a UUID.
5. **EVIDENCE** Cloud pull maps `soldByUserId` from `row.created_by` (`src/offline/cloudSync.ts` `rowToSale`).
6. **EVIDENCE** `public.sales.created_by` is `uuid references auth.users(id)` (`supabase/migrations/005_customers_and_sales.sql`). `shop_pos_staff.id` is a **different** UUID table (`095_identity_trust_hardening.sql`) and is **not** `auth.users`.
7. **EVIDENCE** Cashier Home filters `s.soldByUserId === actorUserId` (`src/lib/homeVisibility.ts` `filterSalesForHomeScope`). POS today does the same (`src/pages/PosPage.tsx` + `src/lib/todaySalesSummary.ts`). Receipts does the same (`src/pages/ReceiptsPage.tsx`).
8. **EVIDENCE** Owner Home shop-wide uses **local** `useReportingSales(false)` **and**, when online, **overwrites** today/month KPIs from `shop_get_daily_sales_summary` / `shop_get_monthly_sales_summary` (`src/hooks/useHomeDashboardMetrics.ts`, `src/lib/homeShopKpiOverlay.ts`).
9. **EVIDENCE** Local checkout deducts stock and inserts the sale in **one** `set({ products, sales, … })` (`finalizeDraftSale`). Cloud stock apply is **inside** `shop_push_sale_complete` after status becomes `completed` (`083_sale_stock_sync.sql`).
10. **EVIDENCE** Staff PIN login is offline (`src/lib/auth/staffAuthentication.ts` → `authenticateOfflineStaff`). `useAuth` then sets `mode: "local"` while `accountKey` is the **cached shop owner key** (`src/hooks/useAuth.ts`). Cloud sync still requires `supabase.auth.getSession()` (`resolveShopCtx`).
11. **EVIDENCE** Two staff stores exist: `preferences.staffAccounts` (local) and `public.shop_pos_staff` (cloud).
12. **EVIDENCE** Active sales in RAM (`usePosStore.sales`) are **not** the full history. Older synced sales move to `archivedSales` (`src/lib/activeSalesWindow.ts`). `useReportingSales(false)` **excludes** archived (`src/lib/recordArchive.ts` `salesForReporting`).
13. **EVIDENCE** POS “today” uses `scanTodaySalesHead`, which **stops at the first non-today row** assuming newest-first order (`src/lib/salesDayIndex.ts`).

---

# 3. Root Causes

## CONFIRMED ROOT CAUSE

**Staff actor IDs are not representable on the cloud sales ledger, and every staff-facing report assumes they are.**

| Step | What the code does |
|------|-------------------|
| Login | `userId = "staff:" + shop_pos_staff/client staff id` |
| Checkout | `sale.soldByUserId = that string` |
| Push | `created_by = isUuid(soldByUserId) ? soldByUserId : ctx.userId` → **owner UUID** |
| DB | `created_by` must be `auth.users.id` |
| Pull | `soldByUserId = created_by` (owner UUID) if remote metadata wins |
| Cashier UI | `soldByUserId === "staff:<id>"` → **false** |

Files: `sessionActor.ts`, `usePosStore.ts` `finalizeDraftSale`, `cloudSync.ts` `buildSalePushPayload` / `rowToSale` / `mergeSaleFromCloudPull`, `005_customers_and_sales.sql`, `homeVisibility.ts`, `todaySalesSummary.ts`, `ReceiptsPage.tsx`.

## HIGH-CONFIDENCE LIKELY CAUSE

**Staff-only device (PIN, no live owner `auth` session):** `resolveShopCtx()` returns `null`. Sale + stock stay in that device’s IndexedDB. Owner phone never receives the sale. Owner **can** still see stock later if another session eventually pushes products / sale RPC succeeds from a shared-session tablet — or the owner looks at a different replica. **Requires runtime confirmation** of how often cashier tablets hold an owner JWT.

## HIGH-CONFIDENCE LIKELY CAUSE

**Owner Home overlay vs thin local replica:** Owner KPIs prefer `shop_get_*_sales_summary` when the shop book is ahead (`pickShopOrLocalAhead`). Receipts / command-center staff rows still read **local** `sales[]`. If pull is delayed, truncated, or merge drops the row, **Home totals and receipts can disagree**. Products pull is a **separate** query from sales pull (`pullProductsFull` vs `pullSalesIncremental`).

## POSSIBLE CAUSE REQUIRING RUNTIME TEST

- `scanTodaySalesHead` misses today if `sales[]` is not newest-first after merge.
- Incremental sales pull truncation (`lastSalesPullTruncated`).
- Kampala day of `created_at` vs `completed_at` for overlay vs client (`080_reporting_consistency.sql` vs `saleReportingDayKey`).
- `sessionActor` stale/null at checkout → `soldByUserId` null → cashier filters hide the sale **immediately**, even before sync.
- Owner switched-user (`activeStaffId`) vs PIN `staffSession` producing different `userId` strings for the same human.

---

# 4. Full Staff Architecture Map

## A. Types / stores

| Symbol | File | Purpose | ID format |
|--------|------|---------|-----------|
| `SessionActor` | `src/lib/sessionActor.ts` | Live actor for permissions + attribution | `staff:<id>`, auth UUID, `local:<email>`, `local:anonymous` |
| `StaffAccount` | `src/types.ts` | Local staff row in preferences | `id` UUID/client id (no prefix) |
| `PersistedStaffSession` | `src/lib/staffOfflineAuth.ts` | PIN session in storage | `staffId` raw; accountKey `sb:…` / `local:…` |
| `preferences.staffAccounts` | Zustand / IDB snapshot | Offline staff list | raw ids |
| `preferences.activeStaffId` | same | Owner lock-screen switch | raw id → actor becomes `staff:<id>` |
| `public.shop_pos_staff` | `095_identity_trust_hardening.sql` | Cloud staff | `id` UUID, `client_id` UUID, **not** auth user |
| `shop_members` | earlier org migrations | Owner/manager cloud membership | `auth.users.id` + role |
| `useAuth.staffSession` | `src/hooks/useAuth.ts` | PIN login overlay | forces `mode: "local"` |

## B. Login paths (all reachable)

1. **Owner Supabase / Google** → `resolveSessionActor` without `staffSession` → `userId = auth.users.id`.
2. **Staff PIN login** → `authenticateStaffLogin` → `buildStaffSessionActor` → `userId = staff:<id>`.
3. **Owner lock-screen switch user** → `activeStaffId` → same `staff:<id>` prefix (`sessionActor.ts` lines 65–82).
4. **Local email mode** → `local:<email>`.
5. **Dev role simulator** → owner-only, not production cashiers.

Cloud RPCs (`shop_push_sale_complete`, `shop_pos_staff_*`) authorize via **`auth.uid()` + shop membership**, not via `staff:` actors.

## C. Permissions

`SessionActor.permissions` from `resolveStaffPermissions` / custom roles. Store mutations use `denyUnlessEffectivePermission`. Cloud uses `user_is_cashier_or_above(shop_id)` on **auth membership**, not PIN staff.

---

# 5. Full Sale Lifecycle (cashier retail checkout)

```
C1 PIN login
  → authenticateStaffLogin (staffAuthentication.ts)
  → staffSession in useAuth
  → AppShell resolveSessionActor → userId = "staff:<C1>"
  → usePosStore.setSessionActor

Add to cart
  → draftLines in usePosStore (not a sale yet)

Checkout
  → PosPage → finalizeDraftSale (usePosStore.ts)

In finalizeDraftSale (single set()):
  1. validate stock
  2. decrement product.stockOnHand in memory
  3. build Sale { status: completed, soldByUserId: actorId, pendingSync: true }
  4. saleStockMovementsFromSale → local stockMovements
  5. bump shift totals if sh.actorUserId === actor.userId
  6. bumpTodayKpiSnapshot
  7. persist sale + products to IndexedDB (putEntity)
  8. queueRemote("pending_sales", { saleId })
  9. broadcastInventoryStock (same-origin tabs only)

Cloud (if resolveShopCtx() has owner JWT):
  → pushSaleToCloud → shop_push_sale_complete
     created_by = owner auth UUID  (staff: prefix stripped)
     apply_sale_stock_movements (idempotent per sale+product)
  → markSaleSyncState(true)

Owner device:
  → pull products (stock)
  → pull sales (created_by = owner UUID)
  → Home overlay shop_get_daily_sales_summary
  → Receipts / command center from local sales[]

Cashier device after pull:
  → mergeSaleFromCloudPull may set soldByUserId to owner UUID
  → Home/Receipts filter staff:<C1> → miss
```

**Canonical sale object:** `Sale` in `src/types.ts`.  
**Shop id:** not on the local `Sale`. Cloud shop id comes from `resolveShopCtx().shopId` (primary org for **auth user**).  
**Idempotency:** sale UUID is the row id; inventory movement UUID v5(`shop|sale|product`) (`083_sale_stock_sync.sql`). Retries of the RPC are intended to be safe **if the same sale id** is used.  
**No DB transaction on the client.** Local `set()` is atomic in memory only.

---

# 6. Identity Matrix

| ID format | Example source | Produced by | Consumed by | Used for sales? | Used for dashboard? | Risk |
|-----------|----------------|-------------|-------------|-----------------|---------------------|------|
| `staff:<uuid>` | PIN / switch user | `resolveSessionActor` | `soldByUserId`, Home/Receipts filters, shifts | YES (local write) | YES (exact match) | **BROKEN / INCONSISTENT** vs cloud |
| auth UUID | `auth.users.id` | Supabase session, `ctx.userId` | `sales.created_by`, RPCs, payments.recorded_by | YES (cloud write) | Owner overlay (implicit) | **RISK** — all staff sales collapse to owner |
| `local:<email>` | local auth | `resolveSessionActor` | soldByUserId | YES | YES | **RISK** — not UUID, remapped on push |
| `local:anonymous` | missing user+email | `resolveSessionActor` | soldByUserId | YES if no actor | filters fail | **BROKEN** |
| `shop_pos_staff.id` | cloud staff table | insert staff | staff sync / cache | NO (not written to sales) | NO | **SAFE** as staff row only |
| `StaffAccount.id` | preferences | owner creates staff | login match | prefixed before sale | prefixed | **RISK** if prefix omitted anywhere |
| `null` | missing actor | `finalizeDraftSale` | soldByUserId | YES | cashier filters exclude | **BROKEN** |
| `unknown` | reporting fallback | command center / xReport | maps | display only | YES | **RISK** (bucket soup) |

### One cashier identity, step by step

| Step | Field | Expected format | Status |
|------|--------|-----------------|--------|
| LOGIN | `staffSession.staffId` | raw UUID | SAFE |
| SESSION ACTOR | `SessionActor.userId` | `staff:<uuid>` | SAFE locally |
| CHECKOUT | `sale.soldByUserId` | `staff:<uuid>` or null | RISK if null |
| LOCAL IDB | same | `staff:<uuid>` | SAFE until pull |
| SUPABASE ROW | `sales.created_by` | owner `auth.users.id` | **BROKEN / INCONSISTENT** |
| CASHIER FILTER | `=== actor.userId` | expects `staff:<uuid>` | **BROKEN** after pull |
| OWNER HOME OVERLAY | shop completed sales | no staff dimension | SAFE for shop total **if sale uploaded** |
| OWNER STAFF ROWS | `buildStaffControlRows` / cashierMap | groups by `soldByUserId` string | **RISK** — same person split across `staff:` vs UUID |

---

# 7. Data Source Matrix

**NO SINGLE CANONICAL SALES SOURCE EXISTS.**

Competing ledgers:

| Store | Class | Notes |
|-------|-------|--------|
| `usePosStore.sales` | A/B hybrid | Device RAM; incomplete history |
| IndexedDB `sale` / `archivedSale` | A for the device | Per `getActiveAccountKey()` |
| `public.sales` + line items | A for the shop **if synced** | `created_by` ≠ staff |
| `archivedSales` in RAM | B/C | Excluded from default reports |
| `todayKpiSnapshot` | C | Stabilizes Home during hydration |
| `shop_get_daily/monthly_sales_summary` | C | Owner Home overlay |
| `preferences.shifts[].salesTotalUgx` | C | Only if `actorUserId` matches |
| Sync queue `pending_sales` | D | Outbox |

| View | Data source | Shop filter | Staff filter | Archive | Local/cloud | Risk |
|------|-------------|-------------|--------------|---------|-------------|------|
| Owner Home KPIs | local reporting + overlay RPCs | implicit shop | none (shop_wide) | active only locally | **both** | P1 — overlay vs replica |
| Cashier Home | `filterSalesForHomeScope` | implicit | `soldByUserId === actor` | active only | local | **P0** identity |
| POS today tile | `summarizeTodaySales` + head scan | implicit | cashier only | active | local | P0 identity + head scan |
| Receipts | `useReportingSales` | implicit | cashier equality | opt-in | local | **P0** identity |
| Profit / analytics | `useReportingSales` | implicit | none | opt-in | local | P1 thin replica |
| Command center staff | `soldByUserId` grouping | implicit | group key | varies | local | P0 split identity |
| Cash position | `useReportingSales(false)` | implicit | cashier labels | no | local | P1 |
| Inventory list | `products.stockOnHand` | implicit | none | n/a | local + product pull | can move without visible sale |
| Shift card | `preferences.shifts` | implicit | `actorUserId === staff:` | n/a | local | P1 if actor mismatch |

---

# 8. Transaction Integrity Verdict

**RED — independent operations can diverge.**

| Question | Answer |
|----------|--------|
| Client DB transaction? | No. Zustand `set` + async IDB + async queue. |
| Atomic cloud RPC for sale+stock? | **Yes, if** `shop_push_sale_complete` runs (`083`). Stock apply only when `status = completed`. |
| Partial completion? | Yes: local sale+stock committed; cloud can fail (`pendingSync`). |
| Inventory without durable sale? | Local: same `set()` — sale is in RAM. If IDB `putEntity("sale")` fails after `set`, RAM has both until refresh. Cloud: stock apply is after sale complete — **not** without a sales row. **Product pull can show new stock on a device that never pulled the sale.** |
| Sale without inventory movement? | Yes: `shouldDeductFinishedProductStock` false (recipe/service). Cloud: RPC can complete sale then fail mid-loop (exception → `{ ok: false }` — **INFERENCE** on partial loop). |
| Local/cloud disagree? | **Yes** — attribution, pending sync, replica windows. |
| Recovery? | Retry queue; sale UUID + movement v5 idempotency. |
| Sync idempotent? | Intended yes for same sale id. |
| Two devices overwrite? | Product stock has `shop_push_product_stock` + versions. Sales merge is **not** last-write-wins on money (`mergeSaleFromCloudPull`) but **attribution follows newer metadata**. |

**Can stock change without a visible sale?**  
**YES.** Proven paths:

1. **EVIDENCE** Cashier UI hides the sale after identity remap (sale exists, not visible).
2. **EVIDENCE** Owner device can pull `products` independently of `sales`.
3. **EVIDENCE** Same-tab `broadcastInventoryStock` updates stock without sending sales (`finalizeDraftSale` + inventory channel).

---

# 9. Sync Integrity Verdict

```
finalizeDraftSale
  → IDB sale + products
  → queue kind pending_sales | sale
  → processQueue
       resolveShopCtx()  -- null if no owner JWT
       pushSaleToCloud
         shop_push_sale_complete
         created_by := owner uid
         apply_sale_stock_movements
  → other devices
       pull products (stock)
       pull sales (created_by = owner)
       Home RPC summaries (shop totals)
```

- **Offline sell:** yes. Stored in Zustand + IndexedDB. Inventory local.
- **Queue:** `pending_sales` / `sale` with `saleId`. Order is queue order, not a sale-then-stock pair (stock is inside the sale RPC).
- **Inventory before sales on another device:** product pull vs sales pull are **independent**.
- **Permanent fail:** `lastSyncError` on the sale; queue retries. User visibility is weak (not a blocking POS error).
- **Owner realtime:** no. Overlay polls 30s + visibility (`useShopHomeKpiOverlay`). Replica waits for pull.
- **Multiple engines:** cloudSync queue, inventory BroadcastChannel, hospitality queue, incremental persist.

`created_by` rewrite is **not** a sync “failure”. It is a **successful** sync that **destroys staff attribution**.

---

# 10. Legacy Architecture Map

| Piece | Reachable? | Role |
|-------|------------|------|
| `preferences.staffAccounts` | YES | Primary offline staff list |
| `shop_pos_staff` + RPCs | YES | Cloud staff cache |
| `staff:` prefix | YES | All PIN / switch-user actors |
| `activeStaffId` owner switch | YES | Second way to become `staff:` |
| `archivedSales` vs `sales` | YES | Two collections, default reports ignore archive |
| `todayKpiSnapshot` | YES | Home stabilizer |
| `shop_get_*_sales_summary` | YES | Second shop ledger for Home |
| Direct `sales` table reads | YES | Pull path |
| `shop_push_sale_complete` | YES | Push path |
| `local:` actors | YES | Local-only shops |
| `migrateLegacyStore` soldBy null | YES on upgrade | Legacy sales unattributed |
| Dev role override | DEV / no supabase | Not cashier prod path |

Do not delete any of these in a first pass. They are load-bearing.

---

# 11. Severity-Ranked Findings

### P0 — financial / data integrity

1. **Staff attribution cannot survive cloud.**  
   `cloudSync.ts` `buildSalePushPayload` + `005` FK + cashier equality filters.  
   Stock and shop totals can exist while **cashier and owner staff views disagree**.

2. **Cashier screens hide remapped sales.**  
   `homeVisibility.ts`, `todaySalesSummary.ts`, `ReceiptsPage.tsx`.

3. **`created_by` FK forbids `shop_pos_staff.id`.**  
   Even stripping `staff:` and writing the staff UUID would **fail FK** unless that person is an `auth.users` row.

### P1 — high risk

4. **Owner Home overlay ≠ Receipts replica.**  
   `useHomeDashboardMetrics.ts` / `homeShopKpiOverlay.ts` vs `useReportingSales`.

5. **Products pull without sales pull** can show stock drop on owner device.  
   `cloudSync.ts` `pullProductsFull` vs `pullSalesIncremental`.

6. **Staff PIN without `resolveShopCtx`** — sale never reaches shop book.  
   `useAuth.ts` + `resolveShopCtx`.

7. **`soldByUserId` nullable** at finalize.  
   Immediate cashier miss.

8. **Shift totals keyed on `staff:`** may not match remapped sales.

### P2 — architecture debt

9. Dual staff systems (preferences vs `shop_pos_staff`).  
10. Dual Home ledgers (local + RPC).  
11. `scanTodaySalesHead` order assumption.  
12. Command center groups raw `soldByUserId` strings (`ownerCommandCenterBuilders.ts`, `salesDayIndex.ts`).

### P3 — cleanup

13. `unknown` buckets in reports.  
14. `migrateLegacyStore` null `soldByUserId`.  
15. Payments `recorded_by` always `ctx.userId` (`buildSalePushPayload`).

---

# 12. Recommended Target Architecture

**DO NOT IMPLEMENT IN THIS AUDIT.**

- **One identity:** every actor is an `auth.users` UUID (or a first-class `shop_user` UUID that `sales.created_by` may reference). Never persist `staff:` on a ledger.
- **One session actor** derived only from that UUID + role snapshot.
- **One sales ledger:** `public.sales` is shop authority; devices hold a replica, not a second meaning of `soldByUserId`.
- **Attribution:** `created_by` / `sold_by_user_id` = same UUID everywhere. Display names are joins, not filters.
- **Inventory:** movements only, always `reference_type=sale` + sale id. Devices apply movement stream, not silent product LWW.
- **Cash/shift:** rows linked to `sale_id`.
- **Dashboards:** projections from the ledger (shop-wide or `WHERE created_by = :actor`). No string-prefix filters.
- **Offline:** enqueue the **same** UUID; sync is idempotent; never rewrite actor to “whoever is logged into Supabase”.
- **PIN staff** must mint or attach a real user id **before** they can sell, or the sale RPC must accept `shop_pos_staff.id` in a dedicated column.

---

# 13. Minimum Safe Migration Plan

### Phase 0 — Freeze

**GOAL:** No new staff login, roles, or dashboard filters.  
**AFFECTED:** product/staff feature work.  
**RISK:** Low.  
**COMPAT:** n/a.  
**VALIDATE:** this document + freeze checklist.  
**ROLLBACK:** unfreeze.

### Phase 1 — Observe (no behavior change)

**GOAL:** Log `sessionActor.userId`, `sale.soldByUserId`, `created_by` written, `created_by` pulled, filter result.  
**AFFECTED:** diagnostics only.  
**RISK:** Low.  
**COMPAT:** full.  
**VALIDATE:** one cashier sale on two devices.  
**ROLLBACK:** remove logs.

### Phase 2 — Persist staff id without breaking FK

**GOAL:** Add `sales.sold_by_staff_id` (nullable FK `shop_pos_staff`) **or** promote staff to `auth.users`. Keep writing `created_by` as today.  
**AFFECTED:** migrations, `buildSalePushPayload`, `rowToSale`.  
**RISK:** Medium.  
**COMPAT:** old clients ignore new column.  
**VALIDATE:** RPC round-trip preserves staff id.  
**ROLLBACK:** stop writing column.

### Phase 3 — Normalize filters

**GOAL:** Cashier/owner staff views match `sold_by_staff_id` **or** UUID, including legacy `staff:` local rows.  
**AFFECTED:** `homeVisibility.ts`, `todaySalesSummary.ts`, `ReceiptsPage.tsx`, command center.  
**RISK:** High (wrong filter = wrong money).  
**COMPAT:** accept both formats during window.  
**VALIDATE:** cashier sees own sale after pull; owner shop total includes it; owner staff row is one person.  
**ROLLBACK:** feature flag.

### Phase 4 — Stop remapping

**GOAL:** Never assign owner `ctx.userId` when a staff actor sold. Fail closed or write staff column.  
**AFFECTED:** `cloudSync.ts`.  
**RISK:** High (unsynced sales if RPC rejects).  
**COMPAT:** queue retries.  
**VALIDATE:** `created_by` / staff column correct; no silent owner attribution.  
**ROLLBACK:** restore remap behind flag.

### Phase 5 — Single ledger for Home

**GOAL:** Owner Home and Receipts from one projection (replica **or** RPC), same day key.  
**AFFECTED:** `useHomeDashboardMetrics.ts`, overlay.  
**RISK:** Medium.  
**VALIDATE:** two devices, same numbers.  
**ROLLBACK:** overlay flag.

### Phase 6 — Atomic device commit (later)

**GOAL:** Sale + movements + outbox in one IndexedDB transaction.  
**AFFECTED:** `finalizeDraftSale`, entityStore.  
**RISK:** High.  
**VALIDATE:** crash-mid-checkout tests.  
**ROLLBACK:** previous persist path.

---

# Quality gate

- This audit did **not** modify application source, migrations, or Supabase.
- Pre-existing dirty files (`android/app/build.gradle` versionCode 19, splash PNG, `supabase/.temp/*`, other inventory docs) are **not** from this audit.
- Items marked **INFERENCE** / **REQUIRES RUNTIME TEST** must be reproduced on a two-device shop before any Phase 4 remap removal.

---

# Appendix — Key symbols

| Function | File |
|----------|------|
| `resolveSessionActor` | `src/lib/sessionActor.ts` |
| `authenticateStaffLogin` | `src/lib/auth/staffAuthentication.ts` |
| `finalizeDraftSale` | `src/store/usePosStore.ts` |
| `buildSalePushPayload` / `rowToSale` / `pushSaleToCloud` / `resolveShopCtx` | `src/offline/cloudSync.ts` |
| `mergeSaleFromCloudPull` | `src/lib/saleFinancialMerge.ts` |
| `filterSalesForHomeScope` | `src/lib/homeVisibility.ts` |
| `summarizeTodaySales` | `src/lib/todaySalesSummary.ts` |
| `useHomeDashboardMetrics` | `src/hooks/useHomeDashboardMetrics.ts` |
| `fetchShopHomeKpiOverlay` | `src/lib/homeShopKpiOverlay.ts` |
| `shop_push_sale_complete` / `apply_sale_stock_movements` | `supabase/migrations/083_sale_stock_sync.sql` |
| `sales` schema | `supabase/migrations/005_customers_and_sales.sql` |
| `shop_pos_staff` | `supabase/migrations/095_identity_trust_hardening.sql` |

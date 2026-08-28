# WAKA POS — EFRIS Phase 0: Architecture Audit & Integration Boundary

**Date:** 2026-08-28  
**Mode:** ARCHITECTURE ONLY — no URA API, no migrations, no production coupling  
**Status:** WAKA currently has **no EFRIS integration**. This document is not a claim of EFRIS compliance, URA approval, accreditation, or API compatibility.

**Follow-on:** Phase 1 plumbing is documented in `docs/WAKA_EFRIS_PHASE_1_IMPLEMENTATION.md` (still no URA API). Contract intake: `docs/WAKA_EFRIS_URA_CONTRACT.md`.

**Objective:** Add EFRIS to WAKA without turning EFRIS into a dependency of WAKA POS. A shop with EFRIS disabled, disconnected, or not applicable must keep using WAKA normally.

---

## Safety rules (Phase 0)

1. EFRIS is **optional** at the shop that actually runs POS.
2. A WAKA sale completes **before** any EFRIS work. Failure of EFRIS must not reverse, delete, or rewrite the WAKA sale.
3. WAKA sale status and EFRIS submission status are **separate**.
4. Do **not** invent URA endpoints, auth, payloads, tax codes, item codes, FDN rules, credit/debit-note rules, sandbox behavior, or legal eligibility.
5. Do **not** auto-classify a WAKA customer as EFRIS-required from VAT flags, business type, or receipt TIN text.
6. Do **not** store URA credentials in `ShopPreferences`, IndexedDB snapshots, `localStorage`, or frontend bundles.

Anything that depends on official URA documentation is marked **UNKNOWN**.

---

# A. Current architecture

## A.1 Tenancy: organization → shop (POS runtime is the shop)

WAKA’s cloud tenant model is:

```text
auth.users
    └── organization_members (org role: owner | admin | billing | staff)
            └── organizations          ← billing / legal group
                    └── shops          ← POS location (shop_id)
                            └── shop_members (manager | cashier | viewer)
                            └── products, sales, customers, receipts, …
```

Source: `supabase/migrations/003_organizations_and_shops.sql`.

- **`organizations`** is the billing/group row. It already has unused-by-POS columns `legal_name` and `tin`. Those are **not** an EFRIS enrollment record. They must not be treated as proof that the shop must use EFRIS.
- **`shops`** is the operational POS unit. Almost all operational tables are keyed by `shop_id`. Client cache identity is `ShopPreferences.wakaShopId`.
- **`shops.settings`** is a JSONB bag (`default '{}'`). Prefer a dedicated EFRIS config table over stuffing secrets into this JSON.
- **Branches** (`ShopPreferences.activeBranchId` / `branchDisplayName`) are reserved for a future multi-branch model and are typically unset on a single-shop install. **EFRIS configuration belongs on the shop**, with an optional `branch_id` later if WAKA actually ships branches. Do not invent a branch-level EFRIS requirement now.

Client roles used at the till (`src/lib/permissions.ts`): owner, manager, cashier, stock_keeper, supervisor, waiter, kitchen, bar, plus custom roles. Settings writes that change shop identity use `settings.shop` (`src/lib/settingsAuthorization.ts`).

Cloud isolation is RLS via helpers such as `user_can_access_shop`, `user_can_manage_shop`, and `user_is_cashier_or_above` (see `008_row_level_security.sql` and RPCs such as `shop_push_sale_complete` in `063_shop_push_sale_transactional.sql`).

**EFRIS implication:** isolate every EFRIS row by `shop_id` with the same RLS helpers. Never key EFRIS only by `organization_id` — one org may have shops that need EFRIS and shops that do not.

## A.2 Products / catalog / inventory

Client `Product` (`src/types.ts`) carries name, SKU, category (shelf identity), selling/cost prices, stock, units, pharmacy/hospitality extras.

**There is no product-level VAT, tax class, or URA item code.** Retail pricing is UGX per base unit. Categories are WAKA shelves, not URA commodity codes.

Cloud: `public.products` (`004_product_catalog_inventory.sql`, `011_kiosk_products_sales.sql`), shop-scoped.

Inventory:

- Local `stockMovements` written at sale finalization.
- Cloud `inventory_movements` / stock RPCs.
- Purchases, counts, adjustments, enterprise transfers (`167_enterprise_stock_transfer_engine.sql`).
- Pharmacy batches / FEFO are WAKA compliance, not EFRIS.

**EFRIS implication:** item mapping (WAKA product → URA item identity) is a **future adapter table**, not a field on `Product` that the selling engine requires. Inventory movements are not the EFRIS source of truth.

## A.3 Customers

Client `Customer`: name, phone, location, debt, optional pharmacy profile. **No TIN / tax ID.**

Cloud `public.customers` (`005_customers_and_sales.sql`): shop-scoped; `metadata jsonb` exists but is not a tax register.

**EFRIS implication:** do not require customer TIN to complete an ordinary WAKA sale. If official URA docs later require buyer TIN on some invoices, that is a **mapped optional field**, not a WAKA checkout blocker for EFRIS-disabled shops. Exact buyer-TIN rules: **UNKNOWN**.

## A.4 Sales, payments, returns, documents

### Client sale (`Sale` in `src/types.ts`)

WAKA sale status:

| Value | Meaning |
|-------|---------|
| `completed` | Till sale is done; inventory and money are already applied locally |
| `pending` | Open table / held cart (hospitality) |
| `cancelled` | Held/pending sale cancelled |

This is **not** an EFRIS state. Fields of note: lines, subtotal/total, cash/debt, discounts, `paymentMethod`, frozen `receiptHeaderSnapshot` / `receiptFooterSnapshot`, `receiptSeq`, `pendingSync`, hospitality `taxUgx` / `serviceChargeUgx` / `tipUgx` / `billDraft`.

`RestaurantPaymentFutureHooks.taxAuthorityRef` / `fiscalPrinterJobId` are **architecture placeholders only** (“do not implement”). They must not become WAKA sale status.

### Cloud sale (`public.sales`)

Statuses: `draft | completed | void | refunded`. Money columns include `tax_ugx` (integer UGX). Line items have **no tax columns**. Payments are `sale_payments`.

Client retail path typically does **not** populate a general VAT amount; hospitality may send `taxUgx` as a bill framework figure.

### Returns / voids

- Client `ReturnRecord` / `VoidRecord`.
- Cloud `sale_returns` (`062_sale_returns.sql`) — stock restore + refund amount. **Not** a URA credit note.
- **No WAKA fiscal credit-note or debit-note document type exists.**

Purchase `invoiceNumber` is a **supplier invoice string**, not an EFRIS invoice.

Wholesale UI sometimes labels receipts as “invoices” (`src/lib/wholesaleTerms.ts`). That is copy, not a second fiscal document store.

## A.5 Receipts

**Client (what cashiers actually print):**

- Sequence: Kampala calendar day via `scanTodaySalesHead` / `src/lib/salesDayIndex.ts` (`001`, `002`, …) stored as `Sale.receiptSeq`.
- Branding frozen at sale time (`buildReceiptBrandingSnapshot`).
- Print/PDF: `src/lib/receiptPrint.ts`, `retailReceiptEscPos.ts`, `receiptPdfDocuments.ts`. Thermal / AirPrint / PDF already exist.
- Header TIN (`ReceiptHeaderConfig.tin`, Settings → Receipt) is **branding text**, not a tax-authority enrollment.

**Cloud:**

- `public.receipts` + `shop_counters` (`006_receipts_expenses_subscriptions.sql`).
- Trigger `create_receipt_for_sale` when completing **if** `issue_receipt` is true.
- Current client push sets `issue_receipt: false` (`src/offline/cloudSync.ts`). Kiosk/cloud receipt rows are therefore often unused; the **authoritative receipt for the till is the local `Sale`**.

**EFRIS implication:** do not replace WAKA receipts with URA documents. If official docs later require a fiscal QR / FDN / unique invoice number on the printed slip, that is an **overlay** on print templates after a successful EFRIS acceptance — **UNKNOWN** until URA confirms.

## A.6 Existing tax architecture (WAKA, not URA)

| Surface | What it is | What it is not |
|---------|------------|----------------|
| Hospitality `hospitalityTaxPercent` / `hospitalityTaxMode` (`exclusive` \| `inclusive`) / `hospitalityTaxEnabled` | Shop-level display tax on restaurant bills (`src/lib/restaurantBilling.ts`) | URA VAT, EFRIS tax codes, or legal classification |
| i18n `hospitalityTaxHint` | Explicitly: “Display-only tax % — not connected to URA.” | |
| `Sale.taxUgx` | Snapshot of that framework tax when hospitality is used | General retail VAT |
| Cloud `sales.tax_ugx` | Column exists; retail path typically `0` | Product tax engine |
| Receipt header `tin` | Print branding | EFRIS TIN validation |
| `organizations.tin` | Org profile field | EFRIS config |
| `saleFinancialEngine` | COGS / profit snapshots | Tax |

**There is no centralized VAT engine for retail/kiosk sales.** Product prices are not tax-inclusive/exclusive in the general catalog. Do not silently map hospitality tax % to EFRIS.

## A.7 Authentication / settings authorization

- Cloud: JWT + `shop_members` / `organization_members`. Local/offline: owner on that device.
- Session actor: `src/lib/actorAuthorization.ts`. Staff V2: PIN / invite (`docs/STAFF_V2_*`).
- Settings hub (`src/pages/SettingsHubPage.tsx`): Shop, Receipt, Selling, Devices, Pharmacy, Hospitality, … **No Tax & EFRIS page today.**
- Receipt settings: `settings.receipt`. Shop profile / selling: `settings.shop`.

EFRIS enablement must require a **shop-management** permission (`settings.shop` or a future dedicated `settings.efris`), never cashier-only.

## A.8 Existing integration pattern to copy (Ask WAKA / AI)

Documented in `docs/PHASE_ASK_WAKA_0_ARCHITECTURE_INVESTIGATION.md`.

- **Client** never holds provider API keys.
- **Edge Functions** read `DEEPSEEK_API_KEY` from function secrets.
- **Shop toggle** lives in `shop_ai_settings` (`ai_enabled` default false) — optional feature, fail-closed.
- Auth: Bearer JWT → `auth.getUser` → shop-scoped service-role RPCs + `aiGuard`.

Vision `credentialVault` (`src/features/vision/credentialVault.ts`) is a **device-local AES-GCM store for camera passwords**. It is **not** suitable for URA credentials (device-derived key, synced/local, wrong threat model).

**EFRIS must follow the AI pattern (server secrets + shop-scoped RPC), not the Vision vault pattern.**

---

# B. Current sale lifecycle (real implementation)

Retail / kiosk path — `finalizeDraftSale` in `src/store/usePosStore.ts`:

```text
Product (catalog + stockOnHand)
    ↓
Cart / draftLines  (+ optional cart discount, debt customer, pharmacy gates)
    ↓
Guards: pos.sell, shift, plan, stock, recipe ingredients
    ↓
Local mutate: deduct stock, FEFO batches, recipe ingredients, debt balance
    ↓
saleFinancialEngine snapshots (COGS / profit — not tax)
    ↓
Sale { status: "completed", receiptSeq, branding snapshots, pendingSync: true }
    ↓
StockMovement rows + audit "sale_completed"
    ↓
queueRemote("pending_sales", { saleId }) → IndexedDB sync queue
    ↓
Receipt print/PDF from the Sale object (not a separate fiscal store)
    ↓
(later, when online) pushSaleToCloud → RPC shop_push_sale_complete
```

**The WAKA sale is completed locally even if cloud sync fails.** `pendingSync` and `lastSyncError` describe **WAKA cloud upload**, not EFRIS.

Hospitality path: table session → bill draft (`restaurantBilling`) → `finalizeTableBill` → same completed `Sale` + `pending_sales` queue.

Returns: separate `ReturnRecord` + `shop_push_sale_return`. Voids adjust completed sales locally then sync.

```text
WAKA today:

  Sale completed locally
        ↓
  WAKA sync (optional connectivity)
        ↓
  Cloud sales row (idempotent if already completed)

EFRIS must remain a sibling, never a parent:

  Sale completed locally
        ↓
  WAKA sync                    EFRIS outbox (only if shop efris.enabled)
        ↓                              ↓
  Cloud sales                  Adapter / URA (UNKNOWN API)
```

---

# C. Current tax lifecycle

1. **Retail/kiosk:** no tax calculation. Line totals are quantity × price minus discounts. `saleFinancialEngine` computes profit from cost snapshots.
2. **Hospitality (optional):** `computeRestaurantBillTotals` applies a shop-configured percent. Inclusive mode backs tax out of menu prices; exclusive mode adds tax on (subtotal + service charge). Result stored on the sale as `taxUgx`. UI states this is **not connected to URA**.
3. **Receipt TIN:** cashier-editable branding; copied into `receiptHeaderSnapshot` at finalize.
4. **Cloud `tax_ugx`:** schema exists; not a product tax engine.

**There is nothing here that can legally decide EFRIS eligibility.** Configuration capability only.

---

# D. Current offline / synchronization architecture

WAKA is **offline-first**: Zustand + IndexedDB (`src/offline/`), `enqueueSync` / `syncEngine.ts` / `cloudSync.ts` / `immediateSync.ts`.

When connectivity is unavailable:

1. Cashier still finalizes the sale. Stock, money, receipt sequence, and audit are local.
2. A `SyncOperation` is appended (`kind` includes `pending_sales`, `sale`, stock, returns, …).
3. Flush retries with backoff (`autoSync.ts`). Signed-out or unconfigured Supabase: ops stay queued.
4. `shop_push_sale_complete` is **idempotent** if the sale is already completed on the server.
5. Product catalog uses LWW `version` / `updatedAt`. Sale merge helpers: `saleFinancialMerge.ts`.
6. Full-shop restore: `shop_cloud_snapshots` (`052_shop_cloud_snapshots.sql`) — **must never contain EFRIS secrets**.
7. New-device recovery: `docs/CLOUD_AUTHORITY_AUDIT.md`. Sales are class A (cloud pull). Preferences are class B (snapshot).

**WAKA technical offline behavior is already: complete locally, sync later.** EFRIS should reuse an **outbox**, not block the till.

**URA/legal offline rules** (whether a fiscal invoice may be issued while URA is unreachable, whether a local receipt is valid, duplicate-submission law): **UNKNOWN**. Do not invent them. Software can queue; law may forbid or require something else.

---

# E. Recommended EFRIS boundary

**Safest integration point:** after the WAKA sale row is **persisted locally with `status: "completed"`** (and independently of whether `shop_push_sale_complete` succeeded).

```text
finalizeDraftSale / finalizeTableBill
        │
        ├─► WAKA sale + stock + receiptSeq + audit     ← unchanged
        ├─► queueRemote(pending_sales)                 ← unchanged
        │
        └─► efrisOutbox.enqueue(saleId)  ONLY IF
              shop_efris_config.enabled === true
              AND eligibility is not decided by WAKA guesswork
              (explicit shop flag, not “has VAT” heuristics)
```

**Do not hook:**

- `saleFinancialEngine` (profit)
- checkout keypad / cart
- product create/edit as a hard requirement
- inventory movements as the fiscal event
- receipt print as a blocker (print WAKA receipt even if EFRIS is pending — unless URA later forbids that; **UNKNOWN**)

**Server adapter (when official docs exist):** Edge Function(s) with JWT + `shop_id` check, same family as `ai-*`. The function reads **server-only** credentials and talks to URA. The POS client sends `shop_id` + `sale_id` (and later a mapping DTO), never URA secrets.

**Client module (when implementation starts):** `src/lib/efris/` for gates, types, and WAKA→adapter mapping. Keep URA wire types behind the Edge Function until docs exist. Do not scatter `if (efris)` through `usePosStore` beyond a single post-complete enqueue call.

Conceptual layout (create only when implementing, not in Phase 0):

```text
src/lib/efris/
  types.ts            WAKA-side states; no invented URA payloads
  config.ts           enabled? — read shop flag only
  gate.ts             fail-closed: disabled ⇒ no enqueue, no API
  outbox.ts           enqueue after completed sale
  mapping.ts          WAKA Sale → adapter DTO (fields UNKNOWN until URA docs)

supabase/functions/efris-submit/     later — secrets live here
supabase/migrations/*_efris_*.sql    later — after docs, not now
```

This matches existing WAKA conventions (`src/lib/ai/` + `supabase/functions/ai-*`) and avoids a parallel POS.

---

# F. Files that may eventually need modification

| Area | Paths | Why |
|------|--------|-----|
| Sale complete (one hook) | `src/store/usePosStore.ts` (`finalizeDraftSale`, `finalizeTableBill`) | Enqueue outbox **after** local complete; never inside financial calc |
| Sync kinds | `src/types.ts` (`SyncOperationKind`), `src/offline/syncEngine.ts`, `src/offline/cloudSync.ts` | Optional `pending_efris` kind |
| Settings nav | `src/pages/SettingsHubPage.tsx`, `src/lib/permissions.ts`, `src/lib/settingsAuthorization.ts` | Optional Tax & EFRIS entry for shop managers |
| Receipt print (overlay only) | `src/lib/receiptPrint.ts`, `retailReceiptEscPos.ts`, `receiptPdfDocuments.ts` | **If** URA requires fiscal text/QR after acceptance — UNKNOWN |
| Hospitality bill types | `src/types.ts` (`RestaurantPaymentFutureHooks`) | Do **not** overload `taxAuthorityRef` as WAKA status; may store a display ref after ACCEPTED |
| i18n | `src/lib/i18n.ts` | Settings copy; keep non-EFRIS shops free of URA chrome |
| Cloud | new tables + RLS + RPCs (not yet) | Config, mapping, submissions, attempts |
| Edge | `supabase/functions/efris-*` (not yet) | Credential isolation |
| Tests | new `src/lib/efris/*.test.ts` plus existing sale tests proving no API when disabled | |

---

# G. Files / modules that should remain untouched (no EFRIS coupling)

Keep these free of URA types, endpoints, and “sale incomplete until EFRIS”:

- `src/lib/saleFinancialEngine.ts` — COGS/profit
- `src/lib/sellingEngine.ts`, `src/lib/draftCart.ts` — cart math
- `src/lib/catalogHierarchy.ts` / catalog folders — shelves
- `src/lib/restaurantBilling.ts` — hospitality **display** tax (may later *feed* mapping, must not *become* EFRIS)
- Pharmacy compliance (`pharmacyCompliance*`, controlled register) — NDA/pharmacy, not URA EFRIS
- `src/lib/ai/**` — unrelated
- Vision vault / camera credentials
- Device activation, remote support
- Subscription / billing (`subscriptions`, plan entitlements) — do not force EFRIS as a plan feature unless product later decides; even then it must stay opt-in per shop
- Signup / onboarding (`completeShopOnboardingWizard`, auth pages) — **no EFRIS credentials required to create a WAKA account**

Core rule: **WAKA POS business logic must not import a URA client.**

---

# H. Risks and unknowns

| Risk | Detail |
|------|--------|
| Legal eligibility | WAKA must not decide who is required to use EFRIS. Official URA rules: **UNKNOWN**. |
| Offline fiscal validity | WAKA can complete sales offline. Whether URA allows that: **UNKNOWN**. |
| Duplicate submission | WAKA retries sync aggressively. EFRIS outbox must be idempotent per `sale.id`. URA idempotency keys: **UNKNOWN**. |
| Snapshot leakage | `shop_cloud_snapshots` would leak TIN/credentials if they were put in `ShopPreferences`. |
| Hospitality tax confusion | Staff may think restaurant tax % = URA VAT. Keep copy explicit. |
| Receipt TIN vs EFRIS TIN | Branding TIN may differ from enrolled TIN; do not auto-sync without an explicit settings design. |
| Multi-device | Two tills could enqueue the same `sale.id`. Server unique `(shop_id, sale_id)` is the lock. |
| Disable-after-enable | Must not rewrite historical sales; audit rows stay. |
| `organizations.tin` | Tempting to reuse; it is not enrollment and is org-scoped, not shop-scoped. |
| Cloud vs client receipt numbers | Local `receiptSeq` ≠ cloud `receipts.receipt_number` (often unused). URA invoice numbering: **UNKNOWN**. |
| Returns | WAKA returns are stock+money, not credit notes. Credit/debit note API: **UNKNOWN**. |

---

# I. Optional-EFRIS architecture

```text
shops
  └── shop_efris_config.enabled  DEFAULT false

enabled = false | missing row
  → gate returns NOT_REQUIRED
  → no Edge call
  → no outbox
  → POS identical to today

enabled = true
  → after WAKA completed sale, enqueue outbox
  → adapter runs when online; WAKA sale already done

enabled flipped true → false
  → stop new enqueues
  → do not delete shop_efris_submissions / attempts
  → do not mutate historical Sale rows
```

Disconnected / misconfigured (enabled but no credentials / last handshake failed): show a **configuration status** on the Tax & EFRIS settings page (and optionally a non-blocking staff notice). **Do not lock the till** unless official URA rules later require it (**UNKNOWN**).

Registration / ordinary POS: no TIN, no EFRIS, no URA environment required.

---

# J. Database proposal (document only — no migration in Phase 0)

All tables: `shop_id` FK → `shops(id)`, RLS `user_can_access_shop` / `user_can_manage_shop`, **never** cross-shop selects. Credentials **not** selected by ordinary client APIs.

### J.1 `shop_efris_config`

| Column | Purpose |
|--------|---------|
| `shop_id` PK/FK | Tenant boundary |
| `enabled` boolean default false | Master switch |
| `environment` text | e.g. sandbox/production **labels only until URA docs** — do not invent URLs |
| `ura_identifier` text nullable | TIN or official enrollee id **when known** — UNKNOWN format |
| `connection_status` text | `not_configured` \| `disconnected` \| `connected` \| `error` (WAKA status, not URA enum) |
| `last_handshake_at` timestamptz | Last successful config check |
| `updated_at`, `updated_by` | Audit |

Do **not** store API keys, passwords, certificates, or tokens in this table if the client can SELECT it. Non-secret flags may be readable by shop managers.

### J.2 `shop_efris_secrets` (server-only)

| Column | Purpose |
|--------|---------|
| `shop_id` PK | Isolation |
| `credential_ref` / encrypted payload | Ciphertext or vault pointer — **UNKNOWN** exact URA auth scheme |
| `rotated_at` | |

Access: Edge Function service role **or** a SECURITY DEFINER RPC that never returns plaintext to `authenticated` clients. Not in snapshots. Not in `shops.settings` JSON that the app round-trips.

### J.3 `shop_efris_item_mappings`

| Column | Purpose |
|--------|---------|
| `shop_id`, `product_id` unique | One mapping per WAKA product when EFRIS is on |
| `efris_item_ref` | Official item identity — **UNKNOWN** |
| `sync_status` | `unmapped` \| `pending` \| `synced` \| `error` |
| `last_synced_at`, `last_error` | |

Unmapped products must **not** block WAKA sales. Whether they block EFRIS submission: **UNKNOWN** (URA may require codes).

### J.4 `shop_efris_submissions`

Logical **one row per WAKA sale** (unique `(shop_id, sale_id)`).

| Column | Purpose |
|--------|---------|
| `sale_id` | WAKA sale UUID — idempotency key on WAKA’s side |
| `efris_state` | See state machine below |
| `ura_reference` | FDN or equivalent **if/when** URA returns one — UNKNOWN |
| `idempotency_key` | Send to URA if they support it — UNKNOWN |
| `last_error_code`, `last_error_message` | Sanitized; **no secrets** |
| `submitted_at`, `accepted_at` | |

`efris_state = NOT_REQUIRED` for shops with EFRIS off (either no row, or explicit row). Prefer **no row** when disabled so disabled shops stay empty.

### J.5 `shop_efris_submission_attempts`

| Column | Purpose |
|--------|---------|
| `submission_id` | Parent |
| `attempt_no` | 1, 2, … |
| `status` | `started` \| `succeeded` \| `failed` \| `uncertain` |
| `http_or_transport` | WAKA-side; not invented URA codes |
| `request_hash` | Detect duplicate payloads without storing secrets |
| `response_excerpt` | Redacted |
| `created_at`, `actor` / `device_id` | Audit |

### J.6 What not to do

- Do not add `efris_status` onto `public.sales` as the WAKA sale status.
- Do not put credentials in `ShopPreferences` or snapshot JSON.
- Do not create URA payload columns whose names guess official schemas.

---

# K. Transaction state machine (WAKA vs EFRIS)

## K.1 WAKA sale (unchanged)

```text
pending (held / table)
    │
    ├─► cancelled
    └─► completed  ← money + stock + receiptSeq  (source of truth for POS)
```

Cloud may later show `void` / `refunded` for WAKA returns. That still is not EFRIS.

## K.2 EFRIS submission (WAKA-owned labels until URA confirms)

These are **software states**. Official URA names may differ (**UNKNOWN**).

```text
WAKA sale completed
        │
        ▼
  [shop efris.enabled?]
        │
   no   └─ yes
    │         │
    ▼         ▼
NOT_REQUIRED  PENDING  (outbox; sale already completed)
                │
         ┌──────┴──────┐
         ▼             ▼
     SUBMITTED      FAILED / transport timeout
     (request left     │
      WAKA; waiting)   ▼
         │         RETRY_REQUIRED
         ▼             │
     ACCEPTED          └── re-attempt same sale_id (idempotent)
     + store URA ref     or UNCERTAIN (sent, unknown outcome)
     (FDN or equivalent   → reconcile, do not blindly resubmit
      if API provides it)     until URA idempotency is known)
```

| EFRIS state | WAKA sale |
|-------------|-----------|
| `NOT_REQUIRED` | Unchanged completed sale |
| `PENDING` | Unchanged completed sale |
| `SUBMITTED` | Unchanged completed sale |
| `ACCEPTED` | Unchanged completed sale; optional display of URA ref on receipt **if required** |
| `FAILED` / `RETRY_REQUIRED` | Unchanged completed sale; settings/ops UI shows error |
| `UNCERTAIN` | Unchanged completed sale; reconciliation, not a second new sale |

A temporary EFRIS failure **must not** set `Sale.status` to cancelled, pending, or incomplete, and **must not** restock or un-take payment.

Disable-after-enable: existing submission rows remain `ACCEPTED` / `FAILED` / etc. New sales get `NOT_REQUIRED` (no enqueue).

---

# L. Security model

## L.1 Credentials

| Store | Verdict for URA secrets |
|-------|-------------------------|
| Git / frontend bundle / env in Vite | Forbidden |
| `localStorage` / IndexedDB preferences / snapshots | Forbidden |
| Vision `credentialVault` | Forbidden (device-local, wrong key) |
| `ShopPreferences` | Forbidden (syncs to every till) |
| Supabase Edge secrets + per-shop ciphertext table readable only by Edge | **Recommended**, same family as `DEEPSEEK_API_KEY` + shop rows |
| Logs / Sentry / `reportSyncIssue` | Redact; never log tokens or full payloads that contain secrets |

Client APIs may return `enabled`, `connection_status`, masked identifier (e.g. last 3 of TIN), never secrets.

## L.2 Tenant isolation

- Every EFRIS table filtered by `shop_id`.
- RPCs take `p_shop_id` and call `user_can_manage_shop` / `user_is_cashier_or_above` as appropriate (cashiers may **see** “pending fiscal” if product wants; they must not **read** other shops).
- Edge Function: after JWT, resolve shop membership **before** loading that shop’s secrets.
- Tests: shop A cannot SELECT shop B’s config, mappings, submissions, or attempts.

## L.3 Least privilege

- Enable/disable + credentials: `settings.shop` (owner/manager).
- Cashier: sell as today; optional read-only fiscal badge on a receipt after ACCEPTED.
- Do not grant service-role keys to the browser.

---

# M. Offline, duplicates, reconciliation (technical vs legal)

## M.1 WAKA technical behavior (can implement)

| Event | WAKA technical behavior |
|-------|-------------------------|
| Internet gone | Complete WAKA sale; leave EFRIS row `PENDING` |
| WAKA backend gone | Same; both WAKA sync and EFRIS outbox wait |
| URA API down (once it exists) | WAKA sale stays completed; EFRIS `RETRY_REQUIRED` |
| Slow URA | Do not block checkout UI; work is async |
| App close mid-submit | Attempt row `UNCERTAIN` if request may have left the device; do not create a second `sale_id` |
| Device restart | Outbox durable in IndexedDB **or** (preferred) cloud outbox after WAKA sale is synced — prefer **server outbox** keyed by `sale_id` so two devices cannot double-submit |
| Duplicate local enqueue | Unique `(shop_id, sale_id)` |

**Preferred idempotency:** the WAKA `Sale.id` (UUID) is the only client-generated key. After the sale exists in cloud, the Edge Function inserts/upserts `shop_efris_submissions` uniquely on that id, then calls URA **at most one in-flight attempt**. Retry uses the same row.

URA’s own idempotency header/field: **UNKNOWN** — when docs arrive, store and send it; until then, WAKA still serializes on `sale_id`.

## M.2 Legal / URA (do not implement from guesswork)

- Whether goods may leave the shop without an accepted fiscal invoice: **UNKNOWN**
- Whether a WAKA thermal receipt is valid without FDN: **UNKNOWN**
- Retry windows, void vs credit note: **UNKNOWN**
- Sandbox vs production URLs: **UNKNOWN**

## M.3 Future reconciliation (design only)

Job (Edge or scheduled RPC), shop-scoped:

| WAKA | EFRIS row | Action (once API known) |
|------|-----------|-------------------------|
| completed | missing + enabled | enqueue PENDING |
| completed | PENDING stale | retry or probe URA |
| completed | FAILED but URA accepted | set ACCEPTED + store ref (do not resubmit) |
| completed | ACCEPTED twice / unknown ref | flag duplicate for ops; do not auto-void WAKA sale |
| EFRIS ACCEPTED | WAKA missing | should not happen if EFRIS only runs after local complete; if found, ops alert |

Do not implement probes until official query APIs exist.

---

# N. User experience

Settings hub today has no tax/EFRIS item. **Ordinary shops must not see URA chrome.**

Recommended:

```text
Settings  (existing hub)
  └── Tax & EFRIS     ← only if actorHasPermission(settings.shop)
         ├── Note: WAKA tax (hospitality) is separate; not URA
         └── EFRIS
               ├── Disabled  (default)  — one switch, no credential fields
               └── Enabled
                     ├── Connection status
                     ├── Environment (once official)
                     └── Credentials entered via a server-backed form
                         that does not echo secrets back
```

Do **not** put EFRIS on the cashier Sell screen as a blocking modal. Optional later: a small “Fiscal: pending/accepted” on receipt reprint for enabled shops only.

Do not add EFRIS to signup, shop onboarding wizard, or Receipt TIN as a hidden enablement.

Hospitality Settings tax block stays as display tax. Cross-link (“URA EFRIS is configured separately”) only when EFRIS UI exists.

---

# O. Testing strategy (required when implementation starts)

### EFRIS disabled (must remain the default CI path)

- `finalizeDraftSale` completes; receipt prints; stock moves; reports include the sale.
- Zero calls to any `efris` Edge Function / outbox insert.
- Settings hub has no required EFRIS step.
- Existing sale / sync / hospitality / pharmacy tests still pass.

### EFRIS enabled (adapter stub first, no real URA)

- Config isolated by `shop_id`.
- Completed sale creates exactly one submission row `PENDING`.
- Stub adapter records ACCEPTED/FAILED without changing `Sale.status`.
- Shop B cannot read shop A rows (RLS tests).

### Failure

- Timeout, network error, malformed response, duplicate callback, app restart mid-flight, retry of same `sale_id` only.
- `UNCERTAIN` does not spawn a second submission row.

### Security

- Secrets absent from snapshots, logs, and REST responses.
- Unauthorized role cannot enable EFRIS or fetch credentials.

### Historical data

- Disable after enable: old WAKA sales unchanged; old EFRIS rows still readable by shop managers.
- Reports still run on WAKA totals, not on EFRIS acceptance.

Unit: gates, uniqueness, state transitions.  
Integration: RPC + RLS.  
E2E: disabled shop full sale; enabled shop sale completes while adapter is down.

---

# P. URA unknowns (cannot be decided in Phase 0)

Do **not** guess:

- API hostnames, paths, versions, sandbox vs production
- Authentication (certificates, tokens, API keys, headers)
- Request/response JSON/XML schemas
- Item codes, tax codes, commodity classification
- FDN / fiscal invoice number meaning and print rules
- Whether every invoice, credit note, debit note, or stock movement must be sent
- Buyer TIN / B2C vs B2B rules
- Official retry, timeout, and duplicate-document rules
- Legal requirement to block sales when URA is down
- Who is legally required to use EFRIS (VAT vs non-VAT vs thresholds)
- Whether WAKA `receiptSeq` may appear on a fiscal document

When documentation and credentials arrive, map them into `supabase/functions/efris-*` and `mapping.ts` only.

---

# Q. Exact next step (after official URA documentation and credentials)

**Next implementation step — still not “go live on URA”:**

1. Add `shop_efris_config` (`enabled` default **false**) + RLS. No secrets column on that table.
2. Add `src/lib/efris/gate.ts`: `isEfrisEnabled(shopId) === false` ⇒ no-op.
3. After `finalizeDraftSale` / `finalizeTableBill` persist, call `efrisOutbox.consider(saleId)` which **returns immediately** when disabled.
4. Add unique `shop_efris_submissions (shop_id, sale_id)` and a no-op Edge Function that **refuses** to call any invented URL (returns `not_implemented` until mapping is written from official docs).
5. Settings: Tax & EFRIS page with a single Disabled/Enabled switch and status `not_configured`.
6. Tests proving disabled shops never enqueue.

**Only after** official API spec exists: implement mapping, `shop_efris_secrets`, real submit, print overlay, item mapping UI, reconciliation probes.

Do **not** claim EFRIS integration complete, EFRIS compliant, URA approved, or production-ready at that stub stage either.

---

# Appendix — files inspected (Phase 0)

### Tenancy, RLS, sales, receipts, inventory

- `supabase/migrations/003_organizations_and_shops.sql`
- `supabase/migrations/004_product_catalog_inventory.sql` (referenced)
- `supabase/migrations/005_customers_and_sales.sql`
- `supabase/migrations/006_receipts_expenses_subscriptions.sql`
- `supabase/migrations/008_row_level_security.sql`
- `supabase/migrations/011_kiosk_products_sales.sql` (referenced)
- `supabase/migrations/052_shop_cloud_snapshots.sql`
- `supabase/migrations/062_sale_returns.sql`
- `supabase/migrations/063_shop_push_sale_transactional.sql` (referenced)
- `supabase/migrations/167_enterprise_stock_transfer_engine.sql` (referenced)
- `docs/CLOUD_AUTHORITY_AUDIT.md`

### Client domain and POS core

- `src/types.ts` — `Product`, `Sale`, `SaleStatus`, `Customer`, `ReceiptHeaderConfig`, `ShopPreferences`, hospitality tax, `RestaurantPaymentFutureHooks`, `SyncOperation`
- `src/store/usePosStore.ts` — `finalizeDraftSale`, `queueRemote`, receipt snapshots
- `src/lib/saleFinancialEngine.ts`
- `src/lib/restaurantBilling.ts`
- `src/lib/salesDayIndex.ts` (referenced)
- `src/lib/receiptPrint.ts`
- `src/lib/permissions.ts`
- `src/lib/settingsAuthorization.ts`
- `src/lib/actorAuthorization.ts` (referenced)
- `src/lib/i18n.ts` — hospitality tax “not connected to URA”
- `src/lib/wholesaleTerms.ts` (referenced)

### Sync / offline

- `src/offline/syncEngine.ts`
- `src/offline/cloudSync.ts` — `pushSaleToCloud`, `issue_receipt: false`
- `src/offline/immediateSync.ts` (referenced)
- `src/lib/syncDiagnostics.ts` (referenced)

### Settings / UX

- `src/pages/SettingsHubPage.tsx`
- `src/pages/SettingsReceiptPage.tsx`
- `src/pages/SettingsShopPage.tsx` (referenced)

### Existing integrations (pattern)

- `docs/PHASE_ASK_WAKA_0_ARCHITECTURE_INVESTIGATION.md`
- `src/lib/ai/shopAiSettings.ts`
- `supabase/functions/_shared/aiGuard.ts`
- `supabase/functions/ai-ask-waka/index.ts` (referenced)
- `src/features/vision/credentialVault.ts` (anti-pattern for URA secrets)

### Pharmacy (out of EFRIS scope)

- `src/lib/pharmacyComplianceOps.ts` (referenced) — separate regulatory register

---

**Phase 0 deliverable:** this architecture report only.  
**Not delivered:** URA client, migrations, settings UI, compliance claims.

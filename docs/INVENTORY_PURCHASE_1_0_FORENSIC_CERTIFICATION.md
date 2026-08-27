# INVENTORY-PURCHASE-1.0 FORENSIC CERTIFICATION

Audit date: 2026-08-20  
Mode: **AUDIT ONLY** — no coding, migrations, UI, or business-logic changes.  
Pilot: *“If I receive new stock but I have not paid the supplier fully, where do I record the unpaid balance?”*  
Method: repository evidence only (screens → `recordPurchase` / `addSupplierPayment` → IndexedDB → `081_shop_purchases.sql` / RPCs).

```
SOURCE MODIFIED: NO
MIGRATIONS CREATED: NO
DEPLOYMENT: NONE
```

---

## Executive verdict

**OPTION A — FEATURE EXISTS** (UI exposure / documentation missing)

Unpaid supplier stock is already recorded in WAKA. This is **not** OPTION C (do not build a Purchase + Supplier Payables system). OPTION B improvements (invoice number, Restock trap, cash-at-receive) are optional follow-ons, not a missing module.

**Customer answer:** Stock → **Receive stock** (or New purchase) → **named supplier** → **Paid today** (less than total, or empty) → save. Remaining amount is that supplier’s **owed** balance. Pay later: Stock → **Payments**.

---

## Score /100

| Area | Score |
|------|------:|
| Inventory receiving | 16 |
| Supplier management | 14 |
| Purchase tracking | 12 |
| Payables | 12 |
| Reports | 10 |
| Mobile | 8 |
| Accounting / cash split | 8 |
| **Total (normalized)** | **80 / 100** |

(Raw 80 / 100 against equal weights on the rows above.)

---

## Current architecture map

```
Stock hub                 src/pages/InventoryPurchasingPage.tsx
   ↓
Receive stock             src/pages/RestockPage.tsx
   SupplierSelector       src/components/inventory/receive/SupplierSelector.tsx
   ReceiveTotalsPanel     Paid today / Still owe
   ↓
usePosStore.recordPurchase    src/store/usePosStore.ts  (~6460)
   stockOnHand +=
   weightedCostAfterStockInPrecise    src/lib/costPrecision.ts
   Purchase { totalCostUgx, amountPaidUgx, balanceDeltaUgx }
   Supplier.balanceOwedUgx += (total − paid)
   StockMovement kind purchase_in
   ↓
IndexedDB                 entityStore buckets purchase, supplier, supplierPayment
   ↓
RPC                       shop_push_purchase, shop_push_supplier
                          shop_push_supplier_payment (later)
   ↓
Postgres                  shop_purchases, shop_suppliers, shop_supplier_payments
   ↓
Reports                   PurchasesTab, PaymentsTab, OfficeSupplierSummaryCard,
                          owner payablesUgx
```

**Not this map:** `StockAdjustmentSheet` → `adjustStock`.

---

## Customer question answer

Record it on **Receive stock**, not on expenses, not on customer debt, not on Adjust stock.

Example 5,000,000 purchase / 2,000,000 paid / 3,000,000 unpaid: named supplier, Paid today = 2,000,000. Supplier owed += 3,000,000.

---

# 1. Inventory receiving audit

| # | Question | Answer |
|---|----------|--------|
| 1 | Receive stock from a supplier? | **Yes** — `RestockPage`, overview **Receive stock** (`src/lib/inventoryWorkspaceTiles.ts`) |
| 2 | Separate from manual adjustment? | **Yes** — `adjustStock` vs `recordPurchase` |
| 3 | Does receiving require payment? | **No** for named suppliers. **Yes (forced full pay)** for Town and SKU Restock |
| 4 | Stock in while supplier unpaid? | **Yes** — Paid today = 0 still increases `stockOnHand` |
| 5 | Where is purchase cost stored? | `Purchase.totalCostUgx` / lines; product `costPricePerUnitUgx` (weighted average) |
| 6 | Supplier attached? | **Yes** — `supplierId`, `supplierName` |
| Import tools | None found as a separate “stock import” payable path | |

```
Current flow:
  Receive stock → named supplier → lines + cost → Paid today → recordPurchase
  → inventory + purchase + supplier owed
  OR Town / Restock → inventory + purchase marked fully paid
  OR Adjust stock → inventory only

Expected business flow:
  Supplier → Receive stock → inventory + invoice → partial/zero pay → supplier owed → later payments
```

No stock-import tool in this path (`ai-bulk-inventory` is catalog/AI, not supplier AP).

---

# 2. Supplier / vendor system audit

| Feature | Exists | Location | Works |
|---------|--------|----------|-------|
| Supplier profile | Yes | `Supplier` `src/types.ts`; `SuppliersTab.tsx`; `shop_suppliers` | Yes |
| Purchase history | Yes | `PurchasesTab.tsx`; `PurchaseDetailPage.tsx`; `shop_purchases` | Yes |
| Supplier debt | Yes | `balanceOwedUgx`; Office / owner payables | Yes |
| Supplier payment | Yes | `addSupplierPayment`; `PaymentsTab.tsx`; `shop_supplier_payments` | Yes |
| Outstanding balance | Yes | supplier row + Payments owing list | Yes |

`vendor` = copy alias. Customer `debt` ≠ supplier owed. `expense` ≠ supplier payment ledger.

---

# 3. Purchase transaction audit

| Concept | Exists separately? |
|---------|-------------------|
| **PO #1001** Pending / Received / Cancelled | **No** in shop UI. `enterprise_purchase_orders` + Coming Soon page only |
| **Goods received** +100 inventory, payment pending | **Yes** as one save: receive **is** the purchase; payment pending = Paid today 0 |
| **Invoice** 5M / paid 2M / balance 3M | **Yes** as fields on the same `Purchase` (not a second invoice document). Invoice **number** not written |

---

# 4. Accounts payable audit (5M / 1M / 4M)

| | |
|--|--|
| Where is 4,000,000 stored? | `balanceDeltaUgx` on the purchase; `balanceOwedUgx` on the supplier (`shop_suppliers.balance_owed_ugx`) |
| Calculated? | At save: total − paid; also rebuildable from history (`purchaseRecovery.ts`) |
| Reported? | Yes — purchase Balance, supplier list, Payments, Office, owner dashboard |
| Paid later? | Yes — `addSupplierPayment` |
| Payment history? | Yes — `supplierPayments` |

---

# 5. Database audit (no migrations)

| Table | Purpose | Relationships | Missing (report only) | Risk |
|-------|---------|---------------|----------------------|------|
| `shop_suppliers` | Master + owed | `shop_id` → shops | due date | Last-write-wins on `balance_owed_ugx` |
| `shop_purchases` | Receive/invoice | `shop_id`; `supplier_id` no FK; `lines` jsonb | `invoice_number` | Snapshot remainder after later pays |
| `shop_supplier_payments` | Later pays | no `purchase_id` | method, receipt | Payment push does not update owed column |
| `shop_stock_movements` | Movement JSON | `refId` in payload | FK to purchase | |
| products catalog | `stock_on_hand`, cost | | | |
| cash expenses | Owner expenses | **Not** AP | | Do not confuse with supplier pay |

Adding a new payable **module** would **duplicate** these tables. Pilot needs **no** new tables.

---

# 6. Financial impact audit

If stock received 5M unpaid:

| Book | Does WAKA understand? |
|------|------------------------|
| Inventory value + (~5M at average cost) | **Yes** |
| Cash −0 | **Yes** — unpaid receive does not drain drawer |
| Supplier debt +5M | **Yes** |
| Profit at receive | **No P&L event** — later sales use new average cost (COGS) |
| Owner dashboard | **Yes** — `payablesUgx` |
| Paid today 2M then remaining 3M | Purchase stores 2M paid; **drawer does not subtract 2M** |

---

# 7. Permission audit

| | Receive / purchase | Pay supplier | View debt |
|--|-------------------|--------------|-----------|
| Owner | Yes | Yes | Yes |
| Manager | Yes | Yes | Yes |
| Stock keeper | Yes | Yes | Yes |
| Cashier | No | No | Tabs hidden |

`src/lib/permissions.ts`. RLS write is coarser (`user_is_cashier_or_above`).

---

# 8. Mobile audit (~390px)

Receive is a full page; **Paid today** after lines exist; purchase cards show Total / Paid / Balance; footer is keyboard-safe (`ReceiveFooter.tsx`). Usable. Trap: product Restock is easier to tap and records **no** unpaid balance. Electron = same React hub.

---

# 9. Offline / sync audit

Purchases work offline (`pendingSync`, `pending_purchases`). Supplier balances push with `shop_push_supplier`. Later payments: `shop_push_supplier_payment` (owed on server may lag). Same UUID idempotent; two UUIDs can double-pay. Do not change sync here.

---

# 10. Final classification

## OPTION A

```
FEATURE EXISTS
Only UI exposure/documentation missing
```

**This is the verdict.**

OPTION B (payable *improvements*) is optional later, not the reason to build a module.  
OPTION C is **rejected**.

---

## Existing capabilities

Named-supplier receive, cost, qty, unpaid/partial/full at receive, supplier owed, later payments, purchase history, payable KPIs, offline receive, cashier blocked.

## Missing capabilities (not P0 for the pilot)

Invoice number field; PO; Restock/Town credit; payment method; invoice-allocated pays; due dates; Paid today → drawer.

## Database impact

**None required.** Do not add parallel `suppliers` / `purchases` / `supplier_payments` tables.

## Security / RLS impact

No change required for the pilot. Note only: API write wider than POS; supervisor omitted from SQL helper.

## Recommended next phase

**Not** `INVENTORY-PURCHASE-1.1 Supplier Credit & Payables Module`.

If approved after review: **INVENTORY-PURCHASE-1.1 — Credit receive discoverability** (copy + optional Restock/Town warning on **existing** `recordPurchase`). No migrations. No checkout/sales/sync/RLS work.

Until then: **document the receive path for the pilot. Do not implement.**

# INVENTORY-PURCHASE-1.0 FORENSIC AUDIT

Audit date: 2026-08-20  
Mode: **AUDIT ONLY — NO CODE CHANGES**  
Pilot: *“When I receive new stock from a supplier but I have not paid the supplier fully, where do I record the unpaid balance?”*

Evidence from repository inspection (UI → `usePosStore` → IndexedDB → `shop_*` tables / RPCs). No source, schema, or UI was modified.

---

# Executive Verdict

**GO**

WAKA already records unpaid supplier stock. A **Supplier Credit / Payables module is not required** to answer the pilot.

The unpaid amount is stored when receiving on **Stock → Receive stock** (Purchases → **New purchase**) with a **named supplier**, using **Paid today** below the invoice total (empty = unpaid in full). The remainder is `Supplier.balanceOwedUgx`. Later payment is Stock → **Payments**.

```
SOURCE MODIFIED: NO
MIGRATIONS CREATED: NO
DEPLOYMENT: NONE
```

---

## Score /100

| Area | Score |
|------|------:|
| Inventory receiving | 16 / 18 |
| Supplier management | 14 / 16 |
| Purchase tracking | 12 / 16 |
| Payables | 12 / 16 |
| Reports | 10 / 12 |
| Mobile usability | 8 / 12 |
| Accounting readiness | 8 / 10 |
| **Total** | **80 / 100** |

---

# Current Capability

**Today in WAKA POS, a shop owner can record unpaid supplier stock by opening Stock → Receive stock (or New purchase), choosing a named supplier (not Town / market), entering the products and costs, putting what was paid in Paid today (or leaving it empty), and saving. The unpaid remainder is stored on that supplier as owed. Later they record payment under Stock → Payments (or the supplier page).**

They **cannot** record that unpaid balance via **Adjust stock**, product **Restock**, or **Town / market**.

---

# 1. Inventory receiving flow

| Question | Answer | Evidence |
|----------|--------|----------|
| Receive from a supplier? | **Yes** | `src/pages/RestockPage.tsx`; hub `src/pages/InventoryPurchasingPage.tsx`; action Receive stock in `src/lib/inventoryWorkspaceTiles.ts` |
| Supplier captured? | **Yes** (named) | `SupplierSelector` `src/components/inventory/receive/SupplierSelector.tsx`; `recordPurchase` `src/store/usePosStore.ts` |
| Purchase cost recorded? | **Yes** | `PurchaseLine.costPerBuyingUnitUgx`, `Purchase.totalCostUgx` `src/types.ts`; weighted average `weightedCostAfterStockInPrecise` `src/lib/costPrecision.ts` |
| Invoice/reference stored? | **Partial** | Optional notes on `RestockPage`. `Purchase.invoiceNumber` is never set by `recordPurchase`. Search can use notes (`src/lib/purchaseReporting.ts`) |
| Stock increases immediately? | **Yes** (local) | `stockOnHand +=` in `recordPurchase`; movement `kind: "purchase_in"` |

**Not receive:** `src/components/stock/StockAdjustmentSheet.tsx` → `adjustStock` — qty only, no supplier payable.

SKU restock: `StockPage.handleSimpleRestock` always sets `amountPaidUgx` to the line total.

---

# 2. Purchase management

Purchases **are separate records** (`purchases[]` / `shop_purchases`), not only adjustments.

```
Purchase lifecycle:

Supplier              EXISTS   Stock → Suppliers
Purchase Order        MISSING  shop UI; unused enterprise_purchase_orders (Coming Soon)
Stock Received        EXISTS   RestockPage → recordPurchase
Invoice               PARTIAL  Purchase row; no invoice number write
Payment               EXISTS   Paid today + addSupplierPayment
Outstanding Balance   EXISTS   supplier.balanceOwedUgx
```

Statuses unpaid / partial / paid: `purchaseStatusKind` in `src/features/inventory-purchasing/lib/overviewStats.ts`. Voided: `voidPurchase`.

---

# 3. Supplier / vendor system

```
Table: public.shop_suppliers
Purpose: Supplier master + outstanding owed
Relations: shop_id → shops; NO FK from purchases/payments
Permissions: POS suppliers.view / suppliers.manage;
             RLS SELECT user_can_access_shop, WRITE user_is_cashier_or_above
Migration: supabase/migrations/081_shop_purchases.sql

Table: public.shop_purchases
Purpose: Goods received / shop invoice
Relations: shop_id → shops; supplier_id uuid without FK; lines jsonb
Permissions: purchases.record / purchases.view / purchases.void
RPC: shop_push_purchase (081, void fields 104)

Table: public.shop_supplier_payments
Purpose: Later payments
Relations: shop_id; supplier_id without FK; no purchase_id
RPC: shop_push_supplier_payment
```

UI: `SuppliersTab.tsx`, `PaymentsTab.tsx`, `SupplierDetailPage.tsx`. Vendor = hospitality label only.

---

# 4. Accounts payable (5,000,000 / 2,000,000 / 3,000,000)

| Question | Answer |
|----------|--------|
| Where is 3,000,000 stored? | `Purchase.balanceDeltaUgx` **and** `Supplier.balanceOwedUgx` (+= 3,000,000). Cloud: `balance_delta_ugx`, `balance_owed_ugx` |
| Calculated or stored? | **Both** — computed at save as total − paid; persisted on purchase and supplier. Recovery can rebuild from history (`src/lib/purchaseRecovery.ts`) |
| Reported? | Yes — purchase Balance column, supplier list, Payments outstanding, Office Supplier payables, owner `payablesUgx` |
| Partial payments? | **Yes** at receive (Paid today). **Yes** later (`addSupplierPayment`, capped at owed) |
| Payment history? | **Yes** — `supplierPayments[]` / `shop_supplier_payments` |

Later pays do **not** rewrite that purchase’s paid/partial badge.

---

# 5. Inventory accounting

On receive, `costPricePerUnitUgx` becomes a **quantity-weighted average** (`src/lib/costPrecision.ts`), not “last purchase price only.”

Example: 10 units @ 10,000 then 10 @ 12,000 → **11,000** average, not 12,000 last.

Later sales use that average for COGS / estimated profit. Receive itself is not a profit event. Adjust stock does **not** change average cost.

---

# 6. Permissions

| | Receive / create purchase | Record supplier payment | View supplier debt |
|--|---------------------------|-------------------------|--------------------|
| Owner | Yes `purchases.record` | Yes `suppliers.manage` | Yes `suppliers.view` |
| Manager | Yes | Yes | Yes |
| Stock keeper | Yes | Yes | Yes |
| Cashier | **No** | **No** | Tabs hidden |

Source: `src/lib/permissions.ts`.

---

# 7. Reports

| Report | Present |
|--------|---------|
| Supplier debt | Office card, owner dashboard `payablesUgx`, Payments KPI |
| Purchase history | Purchases tab + CSV/PDF |
| Stock valuation | Inventory KPI at cost |
| Expenses | Separate cash expenses — **not** the supplier AP ledger |
| Cash flow / drawer | Later `SupplierPayment` reduces expected cash; **Paid today does not** |

---

# 8. Mobile / Electron

Phone: `RestockPage` + keyboard-safe `ReceiveFooter`; purchase **cards** with Total / Paid / Balance. Usable. Hidden if the owner uses product Restock instead.

Tablet / desktop / Electron: same hub; desktop purchases table (`PurchasesDesktopTable`).

Offline: `recordPurchase` local-first, then `pending_purchases` + supplier push. Payments sync via `shop_push_supplier_payment`; cloud owed can lag until next `shop_push_supplier`. Do not change sync in this audit.

---

# 9. Database safety

Adding supplier payable **does not require new tables**. Extending existing columns is **optional**, not required for the pilot.

| Approach | Required for unpaid stock? |
|----------|----------------------------|
| New tables (`suppliers`, `purchases`, `supplier_payments`) | **No** — would duplicate `shop_*` |
| Existing table extension (invoice_number, payment_method, purchase_id) | **No** for pilot |
| No database changes | **Yes** — current schema already stores the 3,000,000 |

---

# Missing Features

**P0 — Critical for pilot**  
None, if the owner uses Receive stock + named supplier.

**P1 — Important**  
- Product Restock / Town/market do not create unpaid balances (`StockPage.tsx`, `RestockPage.tsx`).  
- Paid today does not hit the cash drawer (`src/lib/cashReconciliation.ts`).  
- No labelled “Credit / not paid” control (empty Paid today is the mechanism).

**P2 — Nice to have**  
- Invoice number on save.  
- Payment method on later pay.  
- Purchase-order step; payment allocated to one invoice.  
- Due dates.

---

# Recommended Phase

**Do not start `SUPPLIER-PAYABLES-1.0` as a new module.** That would duplicate `shop_suppliers` / `shop_purchases` / `shop_supplier_payments`.

If a follow-on is approved after this audit, name it **INVENTORY-PURCHASE-1.1 — Credit receive discoverability** (UI only):

| | |
|--|--|
| UI | Make Paid today / unpaid obvious on `RestockPage`; optional warn on SKU Restock / Town |
| Database | **None** |
| Migration risk | **None** if no schema |
| Permissions | Keep existing `purchases.record` / `suppliers.*`; cashier stays out |
| Reports | No new report required; existing payables KPIs |

Until that phase is explicitly approved: **no coding**.

---

# Decision for the product

WAKA **already supports** this. **Do not build** a Supplier Credit / Payables module to answer the pilot. Train: **Stock → Receive stock → named supplier → Paid today**.

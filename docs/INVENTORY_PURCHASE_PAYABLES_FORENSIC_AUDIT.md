# WAKA POS — Inventory receiving & supplier unpaid balance

**Mode:** Forensic audit only  
**Date:** 2026-08-20  
**Constraint:** No source changes, no migrations, no schema changes  
**Pilot question:** *“When I receive new stock but I have not fully paid the supplier, where do I record the unpaid balance?”*

---

## Executive verdict

**GO**

WAKA already supports recording unpaid supplier stock. The unpaid amount is **not** a missing feature. It is recorded on **Stock → Receive stock / New purchase**, using a **named supplier** and the **Paid today** field. The remainder is stored as that supplier’s **owed** balance and can be paid later under **Payments**.

The workflow is **easy to miss**. Product-level **Restock**, **Town / market**, and **Adjust stock** do not create supplier debt. An untrained owner can receive stock and still have nowhere obvious to put the unpaid balance.

This is **GO for capability**, not a claim that accounts payable is complete (no due dates, no invoice-number field on save, later payments are not tied to one invoice).

---

## Score /100

| Category | Score | Max |
|----------|------:|----:|
| Inventory receiving | 17 | 20 |
| Supplier management | 16 | 18 |
| Purchase workflow | 12 | 18 |
| Accounts payable | 13 | 18 |
| Reports | 10 | 13 |
| Mobile usability | 10 | 13 |
| **Total** | **78** | **100** |

---

## Where the unpaid balance goes (actual)

```
Stock
  → Receive stock  (or Purchases → New purchase)
  → pick a named supplier  (not Town / market)
  → enter qty and buying price
  → Paid today = what was paid now  (blank = unpaid in full)
  → Still owe UGX {remainder}  (shown before save)
  → Save
      stock increases
      purchase row saved
      supplier owed += remainder

Later:
  Stock → Payments  (or open the supplier)
  → record payment
  → supplier owed decreases
```

**Wrong screens for this question**

| Screen | What it does | Unpaid balance |
|--------|----------------|----------------|
| Adjust stock | Qty only | Not recorded |
| Product Restock (one SKU) | Receive + purchase | Always treated as **fully paid** |
| Town / market | Receive + purchase | Always treated as **fully paid** |

---

# 1. Inventory module

Stock lives in one hub: `/stock` (`InventoryPurchasingPage`). Pharmacy uses `/pharmacy/inventory`. Legacy `/restock` opens the same receive form.

| Flow | Component | Store action | Inventory effect |
|------|-----------|--------------|------------------|
| Receive / new purchase | `RestockPage` | `recordPurchase` | Qty up, weighted average cost, `purchase_in` movement |
| One-product restock | `SimpleProductRestockModal` | `recordPurchase` | Same, but paid = full total |
| Pharmacy batch receive | `PharmacyReceiveBatchSheet` | `recordPurchase` | Same + batch; paid = full total |
| Adjust | `StockAdjustmentSheet` | `adjustStock` | Qty only; no purchase, no supplier, no cost average |
| Count | Inventory count sessions | count apply | Variance movements, not purchases |

**Cost:** `recordPurchase` sets `costPricePerUnitUgx` to a quantity-weighted average (`weightedCostAfterStockInPrecise`). Later sales use that cost for estimated profit.

**History:** Purchases tab lists receives. Movements with `kind: "purchase_in"` and `refId` = purchase id. Adjustments appear as `adjust_*`, not as purchases.

**Can stock be received from a supplier?** Yes.

---

# 2. Supplier / vendor system

**Exists.** Not a separate “vendor app”; hospitality copy may say vendor.

| Layer | Evidence |
|-------|----------|
| Type | `Supplier` in `src/types.ts` — `balanceOwedUgx`, `totalPurchasesUgx`, `lastSupplyAt` |
| Store | `addSupplier`, `updateSupplier`, `removeSupplier`, `addSupplierPayment` |
| Pages | Stock → **Suppliers**; `SupplierDetailPage` (statement, pay, export) |
| Cloud | `public.shop_suppliers` (`081_shop_purchases.sql`) |

Profiles: name, phone, location, notes. Outstanding balance is a first-class field. Walk-in / town is a reserved supplier id that **does not** carry debt.

---

# 3. Purchase workflow

```
Supplier                 EXISTS     Stock → Suppliers
   ↓
Purchase order           MISSING    Shop receive is not a PO. Enterprise PO tables exist; UI is Coming Soon.
   ↓
Stock received           EXISTS     Receive stock / New purchase
   ↓
Invoice                  PARTIAL    The saved Purchase is the invoice. Invoice number is not filled on save. Notes used as reference.
   ↓
Payment                  EXISTS     Paid today at receive; later Payments tab
   ↓
Outstanding balance      EXISTS     supplier.balanceOwedUgx
```

There is no separate purchase-order step in the live shop product. Receive **is** the purchase.

---

# 4. Accounts payable

Search hits that matter: `balanceOwedUgx`, `amountPaidUgx`, `balanceDeltaUgx`, `payablesUgx`, `SupplierPayment`, `addSupplierPayment`, purchase status `paid` / `partial` / `unpaid`.

Customer **debt** is a different module (money customers owe the shop).

| Question | Answer |
|----------|--------|
| Can a purchase be marked partially paid? | **Yes**, at receive, named supplier only (`Paid today` < total) |
| Can remaining balance be recorded? | **Yes**, on the supplier (`balanceOwedUgx`) |
| Can payment happen later? | **Yes**, `addSupplierPayment` |
| Is payment history stored? | **Yes**, `supplierPayments` / `shop_supplier_payments`, with `createdAt` |

Later payments reduce **supplier** owed. They do **not** rewrite that purchase’s paid/partial badge.

---

# 5. Database (exists only — no change proposed)

| Table | Role |
|-------|------|
| `shop_suppliers` | Supplier + `balance_owed_ugx` |
| `shop_purchases` | Receive/invoice: cost, `amount_paid_ugx`, `balance_delta_ugx`, `lines` JSON, notes, void fields |
| `shop_supplier_payments` | Later payments |
| `shop_stock_movements` | Movement JSON (`purchase_in` + `refId`) |

RLS: SELECT if `user_can_access_shop`; WRITE if `user_is_cashier_or_above`. RPCs: `shop_push_purchase`, `shop_push_supplier`, `shop_push_supplier_payment`.

No `accounts_payable` table. No purchase-order in the shop receive path. Fields that exist are enough to store the pilot’s 5,000,000 / 2,000,000 / 3,000,000 example when the named-supplier receive form is used.

---

# 6. UI / UX — can an owner find this?

**The feature exists. It is not labelled “unpaid supplier stock” or “supplier credit”.**

What an owner **does** see:

- Overview primary action **Receive stock** (`ipActionReceiveStock`)
- Header **New purchase**
- On the receive form, after lines are added: **Paid today** and **Still owe UGX {amount}**
- Office card titled **Supplier payables** / **Total owed**
- Stock tabs **Purchases**, **Suppliers**, **Payments**
- Purchase cards: Total / Paid / **Balance**

What makes it **hidden or confusing**:

1. **Receive stock** sounds like qty-in, not “record what we still owe.”
2. The easier product **Restock** control records a purchase with **no unpaid field**.
3. Default source is often **Town / market**, which cannot hold debt.
4. **Adjust stock** sits next to Receive and looks like “add stock.”
5. Unpaid lives on the **supplier**, not as a POS “pay later” sale (that is customer credit).

**Missing workflow?** No missing module. Missing **discoverability** and two **trap paths** (Restock, Town).

**Would a first-time owner know where unpaid stock goes without training?** Unlikely. After one correct receive, **Still owe** and **Supplier payables** make it obvious.

---

# 7. Mobile

Receive is a full page (`ReceiveOperationShell` variant page), not a nested modal. Footer stays usable when the keyboard is open (`ReceiveFooter`). Paid today uses numeric input.

Phone purchases list uses **cards** with total, paid, and balance — readable. Payments table hides date / recorded-by on small screens; amount stays visible.

Electron uses the same screens; desktop gets a purchases table.

**Usable on phone:** yes for credit receive. **Risk on phone:** Restock on a product card is fewer taps than New purchase.

---

# 8. Reports impact

| Question | Shown today? |
|----------|----------------|
| Supplier debts | Yes — Office **Supplier payables**, owner `payablesUgx`, Payments outstanding, supplier list |
| Purchase costs | Yes — purchase list/detail, export |
| Inventory value | Yes — stock hub KPI at **cost** (`stockValueAtCostUgx`) |
| Profit impact | Indirect — new average cost feeds sale COGS / estimated profit. No separate “this credit purchase changed margin” report |
| Unpaid invoice after later payment | Purchase still shows original remainder |

---

## Findings

| ID | Severity | Finding | Evidence | Recommendation |
|----|----------|---------|----------|----------------|
| IP-01 | P1 | Product Restock saves a purchase as fully paid, so unpaid stock entered there never becomes supplier owed | `StockPage.handleSimpleRestock` sets `amountPaidUgx` to line total | Train: use **Receive stock / New purchase** for credit. Do not use product Restock for unpaid invoices |
| IP-02 | P1 | Town / market receive cannot store unpaid balance | `RestockPage`: walk-in `paid = totals.sum`, `balanceOwed = 0` | Train: pick the **named supplier** |
| IP-03 | P2 | Adjust stock increases qty with no payable | `adjustStock` vs `recordPurchase`; no supplier on adjust movements | Train: Adjust is damage/count/use, not supplier deliveries |
| IP-04 | P2 | Receive action is named “Receive stock”, not “record unpaid purchase”; Paid today appears only after lines are added | `ipActionReceiveStock`; `ReceiveTotalsPanel` gated on `lines.length > 0` | Training + keep **Paid today / Still owe** copy; owners must add products before the unpaid field shows |
| IP-05 | P2 | Later supplier payments do not change that purchase’s paid/partial/unpaid badge | `purchaseStatusKind` uses receive-time `amountPaidUgx` / `balanceDeltaUgx` | Use **supplier owed** and Payments history as the live debt; purchase Balance is the amount added at receive |
| IP-06 | P2 | Cash paid at receive is stored on the purchase but does not leave the cash drawer | Drawer uses `SupplierPayment` and expenses, not `Purchase.amountPaidUgx` | If drawer cash must match, record the same cash via Payments or an expense after receive — as the product works today |
| IP-07 | P3 | Invoice number is not captured on the main receive form | `recordPurchase` does not set `invoiceNumber`; notes used as reference | Put the supplier bill number in **notes** if needed |
| IP-08 | P3 | No due date on supplier debt | No due fields in types or schema | Track due dates outside WAKA for now; live balance is still on the supplier |
| IP-09 | P3 | Cashiers cannot record purchases or see supplier tabs; they can open Stock overview | `permissions.ts`; `InventoryPurchasingPage` tab gates | Owner/manager/stock keeper must enter unpaid stock |

No P0: the pilot can record unpaid stock on the correct screen.

---

## Recommendation (process, not build)

1. **Answer the client:** record unpaid stock on **Stock → Receive stock**, named supplier, **Paid today** less than the invoice, then **Payments** later.
2. **Do not** start a new supplier-payable module. It already exists.
3. **Do not** change schema for this decision.
4. Train against the three traps: Restock, Town/market, Adjust.

---

*Audit only. No implementation, migrations, or database changes.*

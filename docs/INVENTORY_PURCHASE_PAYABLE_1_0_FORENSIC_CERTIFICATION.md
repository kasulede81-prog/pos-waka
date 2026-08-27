# INVENTORY-PURCHASE-PAYABLE-1.0 — Forensic certification

**Mode:** Forensic audit only  
**Date:** 2026-08-20  
**No source, database, migrations, UI, or business-logic changes.**  
**Pilot question:** *“When I receive new stock from a supplier but I have not paid the full amount, where do I record the unpaid balance?”*

---

## Executive verdict

**GO**

WAKA already records unpaid supplier stock. It is **not** a missing Supplier Credit / Payables module.

The unpaid amount is stored when stock is received on **Stock → Receive stock / New purchase**, with a **named supplier**, using **Paid today** less than the invoice (empty = unpaid in full). The remainder is that supplier’s **owed** balance. Later money is **Stock → Payments**.

The capability is **easy to miss**. Product **Restock**, **Town / market**, and **Adjust stock** do not create supplier debt. There is no button named “Credit / Pay later.”

**Do not build a new payables module to answer this pilot.** Expose and train the existing receive form.

---

## Score /100

| Category | Score | Max |
|----------|------:|----:|
| Inventory receiving | 16 | 18 |
| Supplier management | 14 | 16 |
| Purchase workflow | 10 | 16 |
| Payables | 12 | 16 |
| Reporting | 10 | 12 |
| Permissions | 8 | 10 |
| Mobile usability | 8 | 12 |
| **Total** | **78** | **100** |

---

## Current architecture map

```
Stock hub  /stock   (InventoryPurchasingPage)
   ↓
Receive stock / New purchase   (RestockPage)
   SupplierSelector  (named supplier vs Town)
   ReceiveTotalsPanel  (“Paid today” / “Still owe”)
   ↓
usePosStore.recordPurchase   (permission: purchases.record)
   products.stockOnHand += qty
   costPricePerUnitUgx = weighted average
   purchases[] += { totalCostUgx, amountPaidUgx, balanceDeltaUgx }
   suppliers.balanceOwedUgx += (total − paid)   // named supplier only
   stockMovements[] += { kind: "purchase_in", refId: purchaseId }
   ↓
IndexedDB   buckets: purchase, supplier, supplierPayment, stockMovement
   ↓
RPC
   shop_push_purchase      → public.shop_purchases
   shop_push_supplier      → public.shop_suppliers.balance_owed_ugx
   shop_push_supplier_payment  (later pays only)
   ↓
UI
   Purchases tab / Purchase detail
   Suppliers tab / Supplier statement
   Payments tab
   Office “Supplier payables”
   Owner payablesUgx
```

Later payment:

```
Payments tab or Supplier detail
   ↓
usePosStore.addSupplierPayment   (suppliers.manage)
   supplier.balanceOwedUgx -= pay
   supplierPayments[] += row
   ↓
shop_push_supplier_payment
```

**Not this flow:** `StockAdjustmentSheet` → `adjustStock` (qty only, no payable).

---

# 1. Inventory receiving

| Question | Answer | Evidence |
|----------|--------|----------|
| Can stock be received from a supplier? | **Yes** | `RestockPage` + `recordPurchase` |
| Is receiving different from manually adding stock? | **Yes** | Receive = purchase + cost + supplier. Adjust = `adjustStock` only |
| Does the system record who supplied the stock? | **Yes** if named supplier. Town/walk-in stores a display name, **not** debt | `Purchase.supplierId` / `supplierName`; walk-in sentinel |
| Is purchase cost stored? | **Yes** | Line costs + `totalCostUgx`; product average cost updated |

Immediate payment is **not** required for named suppliers. SKU Restock and Town **force** paid = full total.

---

# 2. Supplier / vendor management

| Layer | What exists |
|-------|-------------|
| Table | `public.shop_suppliers` (`081_shop_purchases.sql`) — `balance_owed_ugx`, phone, location, notes |
| Model | `Supplier` in `src/types.ts` |
| Pages | Stock → Suppliers; `SupplierDetailPage` |
| History | Purchases by supplier; `buildSupplierStatement`; Payments tab |
| Outstanding | `balanceOwedUgx` |
| RPC | `shop_push_supplier`, `shop_push_supplier_payment` |
| Permissions | `suppliers.view`, `suppliers.manage` |

Vendor is a label alias, not a second entity. No due-date field.

---

# 3. Purchase lifecycle vs enterprise expected

```
Supplier              MATCH
Purchase Order        DIFFER  — no shop PO UI (enterprise tables unused / Coming Soon)
Receive Stock         MATCH  — this save is the purchase
Inventory Increase    MATCH
Supplier Invoice      PARTIAL — Purchase row; invoice number not written
Partial Payment       MATCH  — Paid today
Remaining Balance     MATCH  — supplier owed
```

---

# 4. Accounts payable

**Can 5,000,000 / paid 2,000,000 / remaining 3,000,000 exist?**  
**Yes**, on Receive stock + named supplier + Paid today = 2,000,000.

| Item | Exists? |
|------|---------|
| Supplier debt | Yes |
| Partial payment at receive | Yes |
| Later installments | Yes (`addSupplierPayment`, capped at owed) |
| Due dates | **No** |
| Credit purchases | Yes (Paid today &lt; total); no “credit” label |
| Supplier statements | Yes (on-screen + CSV/PDF) |

Later installments do **not** change that purchase’s paid/partial badge; live debt is the supplier total.

---

# 5. Accounting impact

| Question | Answer |
|----------|--------|
| Unpaid stock vs cash reports | Unpaid receive does **not** reduce drawer cash. **Paid today** also does **not** hit the drawer. Later supplier payments **do**. |
| Profit | Unpaid receive does not post profit. New **average cost** affects later sale COGS / estimated profit. |
| COGS vs purchase cost | Sales use weighted `costPricePerUnitUgx` after receive, not a live link to that invoice’s unpaid portion. |
| Supplier debts in reports | Yes — Office Supplier payables, owner `payablesUgx`, Payments outstanding, analytics `supplierDebtTotal`. |

WAKA **does** store stock received ≠ money paid on the purchase and supplier. Cash reports **do not** treat Paid today as cash out.

---

# 6. Permissions

| | Receive / create purchase | Record supplier payment | View supplier debt |
|--|---------------------------|-------------------------|--------------------|
| Owner | Yes (`purchases.record`) | Yes (`suppliers.manage`) | Yes (`suppliers.view`) |
| Manager | Yes | Yes | Yes |
| Stock keeper | Yes | Yes | Yes |
| Cashier | **No** | **No** | Tabs hidden; may see overview unpaid **counts** |

---

# 7. Mobile / desktop / Electron

Same React surfaces on phone, tablet, desktop, and Electron.

- Phone: receive is a full page; Paid today after lines exist; purchase **cards** show Total / Paid / Balance.
- Desktop: purchases table when viewport is desktop band.
- Fastest wrong path on phone: product **Restock** (fully paid).

Accessible where shops work: **yes**, if they open Receive stock, not Adjust or SKU Restock.

---

# 8. Database safety (gaps only — no migrations)

**Existing:** `shop_suppliers`, `shop_purchases` (JSONB `lines`), `shop_supplier_payments`, `shop_stock_movements`. Sync: local-first, then those RPCs. RLS: shop-scoped SELECT; write via `user_is_cashier_or_above`.

**Gaps (report only):** no PO in shop path; no invoice_number column; no payment→purchase FK; no due_at; `shop_push_supplier_payment` does not update `balance_owed_ugx`; POS permissions finer than RLS (waiter can write via API; supervisor may fail push).

---

## Findings table

| ID | Severity | Finding | Evidence | Recommendation |
|----|----------|---------|----------|----------------|
| IP-01 | P1 | Unpaid stock is on Receive stock, not labelled credit | `RestockPage` Paid today; no “Pay later” copy | Train owners; keep using this screen — do not add a new module |
| IP-02 | P1 | Product Restock always marks the purchase paid in full | `StockPage.handleSimpleRestock` `amountPaidUgx: total` | Do not use Restock for unpaid invoices |
| IP-03 | P1 | Town / market cannot hold supplier owed | Walk-in `paid = totals.sum` | Choose the named supplier |
| IP-04 | P2 | Adjust stock is not payables | `adjustStock` vs `recordPurchase` | Adjust = damage/count, not deliveries |
| IP-05 | P2 | Paid today does not change cash drawer | Drawer uses `SupplierPayment`, not purchase `amountPaidUgx` | Treat drawer vs supplier owed as separate today |
| IP-06 | P2 | Later pays do not update purchase unpaid badge | `purchaseStatusKind` uses receive snapshot | Read live debt on the supplier / Payments |
| IP-07 | P3 | No due dates | No due fields in types or schema | Out of scope for this decision |
| IP-08 | P3 | Cashiers cannot record this | Role matrix `permissions.ts` | Owner / manager / stock keeper enter credit receives |

No P0: the 5M / 2M / 3M example works on the correct screen.

---

## Final recommendation

**A. Already supported but hidden**

Do **not** choose C (missing module) or D (database extension) to answer the pilot. The tables, store, and UI already implement supplier credit receive + later payment.

**B** is optional later (clearer “unpaid / credit” wording on Receive stock). It is not required to store the balance.

**Decision for the pilot:** expose and train **Stock → Receive stock → named supplier → Paid today**. Do not start a Supplier Credit / Payables build.

---

## Pilot answer

Record the unpaid amount on **Stock → Receive stock**. Pick the supplier, enter the goods and cost, put what you paid in **Paid today** (or leave it empty). The rest is saved as that supplier’s **owed** balance. Pay the rest later under **Payments**.

---

*Audit only. POS, checkout, sync, and inventory logic were not changed.*

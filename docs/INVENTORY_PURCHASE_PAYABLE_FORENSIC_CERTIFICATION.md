# INVENTORY-PURCHASE-PAYABLE forensic certification

Audit date: 2026-08-20  
Mode: **AUDIT ONLY** — no source, migrations, UI, checkout, sales, sync, auth, RLS, database, or POS logic changes.  
Pilot question: *“When I receive new stock from a supplier but I have not paid the full amount, where do I record the unpaid balance?”*

---

## Executive verdict

**GO**

Stock receiving **and** supplier payable tracking both exist. This is **not** “receiving exists but payables are missing.”

The unpaid balance is recorded on **Stock → Receive stock** (same as **New purchase**), by choosing a **named supplier** and entering **Paid today** below the invoice (empty = unpaid in full). The remainder is stored as that supplier’s **owed** amount. Later payments are **Stock → Payments**.

It is **easy to use the wrong screen**. Product **Restock**, **Town / market**, and **Adjust stock** increase quantity without creating supplier debt. There is no button labelled “supplier credit.”

**Foundation:** already in the product.  
**Next premium feature:** not required to answer the pilot. Optional later: clearer wording, not a new payable module.

---

## Score /100

| Category | Score | Max |
|----------|------:|----:|
| Inventory receiving | 16 | 18 |
| Purchase tracking | 12 | 16 |
| Supplier management | 14 | 16 |
| Payables | 12 | 16 |
| Reports | 10 | 12 |
| Permissions | 8 | 10 |
| Mobile usability | 8 | 12 |
| **Total** | **80** | **100** |

---

## Current workflow diagram

**Current (actual code):**

```
Supplier profile          EXISTS  Stock → Suppliers
        ↓
Receive stock             EXISTS  RestockPage (named supplier or Town)
        ↓
Purchase record           EXISTS  recordPurchase → shop_purchases
        ↓
Inventory + avg cost      EXISTS
        ↓
Partial / zero / full pay EXISTS  “Paid today”  (named supplier only)
        ↓
Outstanding balance       EXISTS  supplier.balanceOwedUgx
        ↓
Supplier settlement       EXISTS  Payments tab / addSupplierPayment
```

**Expected (from this audit prompt):**

```
Supplier
 ↓
Receive Stock
 ↓
Purchase Record
 ↓
Partial Payment
 ↓
Outstanding Balance
 ↓
Supplier Settlement
```

**Match:** the expected chain is the live named-supplier receive path.  
**Differ:** no purchase-order step before receive; Town and SKU Restock skip outstanding balance.

---

# 1. Inventory receiving

| Question | Answer |
|----------|--------|
| Can stock be received from a supplier? | **Yes** — Receive stock / New purchase |
| Is supplier information captured? | **Yes** — `supplierId`, `supplierName` |
| Is purchase cost captured? | **Yes** — line cost + `totalCostUgx`; weighted average on the product |
| Is invoice/reference captured? | **Partial** — optional **notes**; `invoiceNumber` is not written |
| Is received stock linked to a transaction? | **Yes** — `Purchase` + `purchase_in` movement `refId` |

Add stock is **not** one flow: receive (purchase), SKU restock (purchase, always paid), adjust (no purchase).

---

# 2. Supplier / vendor system

| Question | Answer |
|----------|--------|
| Supplier entity? | **Yes** — `Supplier` / `shop_suppliers` |
| Supplier balances? | **Yes** — `balanceOwedUgx` |
| Supplier history? | **Yes** — purchases + statement |
| Supplier payments recorded? | **Yes** — `SupplierPayment` / `shop_supplier_payments` |

`vendor` is copy, not a second model. Customer **debt** is AR, not AP.

---

# 3. Purchase accounting (5M / 2M / 3M)

**Can it exist?** **Yes** on named-supplier Receive stock.

| Field | Stored |
|-------|--------|
| Total purchase | `totalCostUgx` = 5,000,000 |
| Amount paid | `amountPaidUgx` = 2,000,000 |
| Remaining | `balanceDeltaUgx` = 3,000,000 added to supplier owed |
| Future payments | `addSupplierPayment` until owed is 0 |

---

# 4. Database audit (no migrations)

```
Table: shop_suppliers
Purpose: Supplier master + owed
Current capability: balance_owed_ugx, contacts, lifetime purchases
Missing fields: due date, ageing (report only)

Table: shop_purchases
Purpose: Receive / shop invoice
Current capability: cost, amount_paid, balance_delta, lines jsonb, notes, void
Missing fields: invoice_number column, purchase_order_id (report only)

Table: shop_supplier_payments
Purpose: Later settlement
Current capability: amount, date, supplier_id
Missing fields: purchase_id, payment_method (report only)

Table: shop_stock_movements
Purpose: Movement payload
Current capability: purchase_in linked by JSON refId
Missing fields: relational FK to purchases (report only)
```

RLS: shop-scoped; WRITE `user_is_cashier_or_above`. RPCs: `shop_push_purchase`, `shop_push_supplier`, `shop_push_supplier_payment`.

---

# 5. UI audit — where an owner would look

| Place they might go | What it actually does |
|---------------------|------------------------|
| **Stock / Inventory — Receive stock** | **Correct** — Paid today + Still owe |
| Purchases | History of those receives; Balance column is receive-time remainder |
| Suppliers | Owed total + pay |
| Payments | Later settlement |
| Expenses | **Wrong** — cash expenses are not supplier AP |
| Cash / drawer | Later supplier payments reduce expected cash; **Paid today does not** |
| Reports / Office / Owner | **Supplier payables** / `payablesUgx` |

**Natural expectation:** Inventory or Purchases while receiving. That is the right place. The unpaid field is named **Paid today**, not “record supplier debt,” so it is easy to miss.

---

# 6. Permission audit

| | Receive / create purchase | Record supplier payment | View supplier balances |
|--|---------------------------|-------------------------|------------------------|
| Owner | Yes | Yes | Yes |
| Manager | Yes | Yes | Yes |
| Stock keeper | Yes | Yes | Yes |
| Cashier | **No** | **No** | Tabs hidden |

---

# 7. Reporting audit

| Shown today? | |
|--------------|--|
| Supplier debts | Yes — Office, owner dashboard, Payments, supplier list |
| Outstanding purchases | Partial — filter unpaid/partial from **receive snapshot** |
| Cost liabilities | Supplier owed; inventory **value at cost** is a separate KPI |
| Purchase history | Yes |
| Stock valuation | Yes — at average cost after receives |

---

## Findings

| ID | Severity | Finding |
|----|----------|---------|
| IP-01 | P2 | Unpaid balance is on Receive stock as **Paid today**, not labelled supplier debt |
| IP-02 | P1 | Product Restock always saves paid = full invoice — no remaining balance |
| IP-03 | P1 | Town / market cannot store unpaid balance |
| IP-04 | P2 | Adjust stock is not a payable |
| IP-05 | P1 | Paid today does not reduce cash drawer |
| IP-06 | P2 | Later payments do not update that purchase’s unpaid badge |
| IP-07 | P3 | No due dates; invoice number not saved on main form |

No **P0**: the 5M / 2M / 3M case is possible on the correct screen.

---

## Recommendations (do not implement)

| Option | Verdict |
|--------|---------|
| **Reuse existing system** | **Yes** — `recordPurchase` + `addSupplierPayment` |
| **Expose hidden feature** | **Yes** — train Receive stock + named supplier + Paid today |
| Add supplier payable module | **No** — would duplicate `shop_suppliers` / payments |
| Improve purchase flow | Optional later copy only — not required to store the balance |

---

## Pilot answer

Record it on **Stock → Receive stock**. Pick the supplier, enter the stock and 5,000,000 cost, put 2,000,000 in **Paid today**. The 3,000,000 is that supplier’s unpaid balance. Pay more later under **Payments**.

```
SOURCE MODIFIED: NO
MIGRATIONS CREATED: NO
DEPLOYMENT: NONE
```

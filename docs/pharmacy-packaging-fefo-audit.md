# Pharmacy packaging — FEFO foundation audit (PH-PACK-19)

**Scope:** Audit only. No FEFO picking or batch UI in this sprint.

## Current model

- **Inventory truth:** `Product.stockOnHand` in **base units** (tablet, capsule, etc.).
- **Packaging:** `Product.pharmacyPackaging` — levels, sell units, optional `priceStripUgx` / `priceBoxUgx`. No stock duplicated per level.
- **Sales:** `SaleLine.quantity` is base units; optional `saleUnitType` + `saleUnitQty` for receipts only.
- **Restock:** Purchases update base stock and weighted `costPricePerUnitUgx` per base unit.
- **Reserved scaffold:** `PharmacyPackaging.batches[]` with `PharmacyBatchRecord` (batch number, supplier batch, expiry, quantityBase, cost).

## FEFO readiness

| Concern | Status | Notes |
|--------|--------|--------|
| Stock always in base units | OK | Batches can store `quantityBase` per batch; sum should equal `stockOnHand` when FEFO ships. |
| Cost per sellable unit | OK | `costPricePerUnitUgx` is per base unit; batch cost can roll into weighted average on receive. |
| Packaging conversions | OK | `calcTotalBaseUnits`, `baseUnitsPerStrip/Box` are pure functions — batch qty uses same base unit. |
| Sale lines | OK | Adding `batchId` later is optional metadata; `quantity` stays base. |
| Restock / purchase | OK | `recordPurchase` supports `baseUnitsIn` + `costPerBaseUnitUgx` for pharmacy; batch receive can split one invoice across batches. |
| Expiry on product | OK | Product-level `expiryDate` today; batch-level `expiryDate` on `PharmacyBatchRecord` ready. |
| Cloud sync | OK | Packaging in product `metadata.pharmacyPackaging`; batches array can sync with product JSON. |

## Risks before FEFO implementation

1. **Dual expiry:** Product `expiryDate` vs batch expiry — need rule: block sale from earliest batch or product field.
2. **Negative batch qty:** Enforce batch deductions on sale in one transaction with `stockOnHand`.
3. **Strip/box display:** FEFO pick is always base deduction; UI labels unchanged.

## Recommended next steps (not in 1.1)

1. Receive stock into `batches[]` with `quantityBase` and batch cost.
2. On sale, allocate from batches (FEFO by `expiryDate`) and decrement `stockOnHand`.
3. Margin report: optional batch-level inventory value.

**Conclusion:** Phase 1.1 packaging does not block batch/FEFO work. Keep `batches[]` append-only on receive; avoid storing parallel strip/box stock counts.

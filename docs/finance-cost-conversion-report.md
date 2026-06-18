# Waka POS — Cost Conversion Report (Audit)

Read-only audit of how pack/buying prices become per-base-unit cost (`costPricePerUnitUgx`).  
**No code changes in this sprint** — this document defines paths for a future single standard.

---

## Summary

| Source | Formula | Rounding | Used by |
|--------|---------|----------|---------|
| Simple add wizard | `floor(packPrice ÷ piecesPerPack)` | **floor** | `SimpleAddProductWizard` → `buildProductFromSimpleWizard` |
| Product edit (pack track) | `floor(packPrice ÷ piecesInside)` | **floor** | `StockProductEditModal.onSubmit` |
| Product edit prefill (display) | `floor(unitCost × conversionRate)` | **floor** | `productToWizardPrefill`, `StockProductEditModal` load |
| Restock / purchase | `round(packCostPerBuyingUnit ÷ conversionRate)` then weighted average | **round** + weighted **round** | `costPerBaseFromBuyingUnitCost` → `recordPurchase` |
| Quick add (stock page) | `floor(packTotal ÷ stockQty)` | **floor** | `costPerUnitFromPackAndStock` → `StockPage.submitQuick` |
| Pharmacy restock / add | `round(invoiceTotal ÷ totalBaseUnits)` | **round** | `calcCostPerBaseUnitUgx` in `pharmacyPackaging.ts` |
| Default guess (no buy price) | `min(sell, floor(sell × 0.72))` | **floor** on 72% | `quickAddProduct` in `usePosStore.ts` |
| Cloud / DB | Stored field only | n/a | `products.cost_price_per_unit_ugx` |

---

## Detail by path

### 1. Simple add wizard (retail)

**Files:** `src/lib/simpleProductWizard.ts`, `src/components/stock/SimpleAddProductWizard.tsx`

```
costPricePerUnitUgx = floor(buyPackPrice / piecesPerPack)
stockOnHand = stockCount × piecesPerPack   (when pack enabled)
conversionRate = piecesPerPack
```

**Risk:** User typo on pack price (e.g. 1,992 vs 19,992) divides correctly but from wrong input.

---

### 2. Product edit modal (pack tracking)

**Files:** `src/components/StockProductEditModal.tsx`

On save when pack fields filled:

```
costPricePerUnitUgx = floor(buyPackPrice / piecesInside)
```

On load, pack price is **reconstructed** (not stored separately):

```
displayPackPrice = floor(costPricePerUnitUgx × conversionRate)
```

**Risk:** Default `conversionRate = 24` in wizard prefill when missing can mis-display pack cost.

---

### 3. Restock / purchase

**Files:** `src/lib/sellingEngine.ts`, `src/store/usePosStore.ts` (`recordPurchase`)

```
incomingCostPerBase = round(costPerBuyingUnitUgx / conversionRate)
newCost = round((prevStock×prevCost + incomingBase×incomingCost) / (prevStock + incomingBase))
```

**Risk:** Differs from wizard **floor** — same pack can yield ±1 UGX per unit vs wizard entry.

---

### 4. Quick add (stock page, no pieces-per-pack)

**Files:** `src/lib/quickAddProductForm.ts`, `src/pages/StockPage.tsx`

```
costPerUnit = floor(packTotalUgx / stockQty)
```

**Risk:** Does not divide by pieces inside pack — if user enters “1 crate” as stock qty instead of 24 bottles, unit cost is wrong by ~24×.

---

### 5. Pharmacy packaging

**Files:** `src/lib/pharmacyPackaging.ts`

```
totalBaseUnits = boxes × strips × tablets (hierarchy)
costPerBaseUnitUgx = round(invoiceTotal / totalBaseUnits)
```

**Risk:** Low if hierarchy matches physical packs; otherwise similar to retail pack errors.

---

### 6. Profit / valuation consumption

All downstream uses **`Product.costPricePerUnitUgx`** as stored — no re-conversion at sale or stock value time.

**Files:** `sellingEngine.ts` (line profit), `purchaseRecovery.ts` (stock value), `homeProfit.ts` (reports).

---

## Recommended future standard (not implemented)

1. **Single rounding rule:** `round(packPrice ÷ baseUnitsPerPack)` everywhere, or document why wizard uses floor.
2. **Store pack invoice price** optionally for audit trail (display currently derived).
3. **Deprecate** `costPerUnitFromPackAndStock` or require `piecesPerPack` on quick add.
4. **Validation guard** (P0) already warns on suspicious margin — extend to block save optionally in P2.

---

*Generated as part of Finance Integrity Sprint P1 — report only.*

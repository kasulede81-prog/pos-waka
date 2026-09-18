# PHARMACY PHASE 2 — FINAL REPORT

Scope: production-grade hardening of Pharmacy's batch/lot/expiry/FEFO model and the void/return/write-off reversal paths around it. No new pharmacy financial engine, ledger, or sale-finalization path was created — every fix is either confined to the pharmacy batch layer (`pharmacyBatches.ts`/`pharmacyStoreBatch.ts`) or a narrowly pharmacy-gated addition inside `usePosStore.ts` that is structurally inert for retail/hospitality sales.

## Architecture

- **Pharmacy financial source of truth:** none — pharmacy has no financial engine of its own. Every pharmacy sale (OTC or prescription) is finalized through the exact same `finalizeDraftSale()` retail and hospitality use. Confirmed by re-reading the current code, not assumed.
- **Pharmacy inventory source of truth:** `Product.stockOnHand` / `Product.costPricePerUnitUgx` / `Product.packCostUnitsDepleted` — the same core fields every business type uses.
- **Batch source of truth:** `Product.pharmacyPackaging.batches[]` (`PharmacyBatchRecord[]`) — operational sub-ledger, not authoritative for quantity or cost. Now with an explicit written boundary (doc comments) and a safe reconciliation path (`reconcileBatchQuantitiesToStock`, from Phase 1).
- **FEFO source:** `sortBatchesFefo` / `allocateFefo` in `pharmacyBatches.ts` — determines *which batch*, never *how much it costs*.
- **Prescription source:** `PharmacyPrescription` — clinical/operational record, zero money fields, links to `Sale` via `saleId`.
- **Controlled-register source:** `pharmacyControlledRegister[]` — compliance log, references `saleId`/`prescriptionId`, no financial fields.

### Source-of-truth matrix

| Domain | Authoritative source | Batch data's role |
|---|---|---|
| Total stock on hand | `Product.stockOnHand` | Batches "should" sum to it; never consulted for stock checks |
| Stock movements | `StockMovement[]` (core) | Batch `timeline[]` is a parallel, richer per-batch log — not a replacement |
| Inventory valuation | `inventoryValueAtCostUgx` (core cost only) | Never reads batch `unitCostUgx` |
| Sale COGS / historical line cost | `lineCostForProductQuantity` (core cost only) | Never reads batch `unitCostUgx` — reconfirmed this phase with a multi-batch test |
| Lot/expiry/provenance | — | `PharmacyBatchRecord` (batchNumber, expiryDate, supplier, timeline) |
| FEFO ordering | — | `sortBatchesFefo`/`allocateFefo` |
| Prescription | `PharmacyPrescription` (clinical, no money fields, links via `saleId`) | — |
| Controlled register | `pharmacyControlledRegister[]` (compliance log, references `saleId`) | — |

## Genuine Defects Found and Fixed

1. **Batch dispense audit `refId` was wrong for the common case.** `finalizeDraftSale`'s FEFO call passed `existingPending?.id ?? "draft"` — for any sale that isn't resuming a held/pending sale (the normal walk-in case), this baked the literal string `"draft"` into the batch's timeline event forever, instead of the real `Sale` UUID (computed later, via a second, unrelated `crypto.randomUUID()` call). Batch history was uncorrelatable to its sale.
   - **Fix:** `saleId` is now computed once, before the per-line loop, and reused for both the batch-dispense audit trail and the `Sale` itself.
2. **`SaleLine.pharmacyBatchNumber`/`pharmacyBatchExpiry` were stale.** Set at draft/add-to-cart time from a *preview* allocation, never updated with the *real* allocation computed at finalize — which can differ if stock changed between add-to-cart and checkout. This wasn't just cosmetic: the existing `resolveControlledReturnBatch` mechanism (already shipped, used for controlled-substance returns) *reads exactly this field* to decide which batch to restore units to — the bug could misdirect a real inventory correction, not just a receipt display.
   - **Fix:** the FEFO deduction is computed *before* the `SaleLine` is built (reordered, not recomputed), and its real `allocations[0]` populates the SaleLine's batch fields.
3. **Multi-batch dispenses could automatically select expired stock.** `sortBatchesFefo` included `status === "expired"` batches in the *default* pool. Since expired batches always sort earliest, a product with both expired and active stock would have FEFO draw from the expired batch first for an ordinary sale — even under a shop's `"block"` expired-sale policy, because that policy's store-level guard (which does exist and does run inside `finalizeDraftSale` — correcting my Phase 1 report's claim that this enforcement was UI-only) checks *product*-level expiry, which is `false` whenever *any* non-expired stock exists for that product, regardless of what FEFO would actually reach for this specific sale.
   - **Fix:** `sortBatchesFefo`/`allocateFefo` gain an `includeExpired` option, default `false`. An explicit `overrideBatchId` still bypasses status checks entirely (unchanged — a pharmacist can always deliberately target a specific batch). Write-offs explicitly opt back in (`{ includeExpired: true }`) — removing expired stock is their entire purpose, and this is the one legitimate exception.
4. **Void and return never reversed batch quantity, only core stock.** `voidSaleLine` and `returnProduct` both correctly restore `stockOnHand`/`packCostUnitsDepleted`/`Sale` totals/COGS via the authoritative mechanism — but neither called `applyBatchRestorations`. Every pharmacy void/return silently drifted the batch ledger versus `stockOnHand`, the exact class of drift `computeBatchIntegrity()` exists to catch, caused by an incomplete reversal rather than a data-entry error.
   - **Fix:** new `restoreSaleLineBatchQuantity` (mirrors the existing `resolveControlledReturnBatch` pattern — resolve the batch from the sale line's own reference, restore via the existing `applyBatchRestorations`), wired into both `voidSaleLine` and `returnProduct`, gated behind `isPharmacyMode`, always *after* and *independent of* the unconditional core `stockOnHand` reversal. Silent no-op (never an invented fallback batch) when the original batch can no longer be resolved — any resulting drift stays visible to `computeBatchIntegrity`, exactly as any other cause of drift already is.

**Verified correct, no change made:** write-off (`writeOffExpiredStock`) already uses the authoritative `StockMovement` mechanism, never touches `Sale`, and captures product/batch/qty/reason/actor/timestamp/note in full. Pack/unit conversion already bridges to core `conversionRate`/`buyingPackCostUgx` and reuses `costPrecision.ts` — no separate conversion-to-cost formula exists. Unbatched/legacy stock is already explicitly modeled (`batches.length === 0` short-circuits both FEFO deduction and integrity checking to safe no-ops, never a false mismatch).

## Financial Integrity

- Revenue duplication: **NONE**
- COGS duplication: **NONE** — reconfirmed this phase with a dedicated multi-batch test: a 15-unit sale spanning two batches still produces exactly one `cogsUgx: 3,000` from the core formula, never per-batch cost.
- Stock duplication: **NONE**
- Historical cost mutation: **NONE** — reconfirmed with a post-finalize cost-edit test; stored `SaleLine.cogsUgx` is unaffected.
- `finalizeDraftSale` preserved: **YES** — its COGS/revenue computation lines are byte-identical to before; only a later, unrelated statement (`preCartLines.push`) moved position relative to the (also-unchanged) stock/batch mutation block.

## Batch Integrity

- **FEFO:** hardened — expired batches excluded from automatic allocation by default; explicit override and write-off paths unaffected.
- **Expiry:** existing d30/d60/d90/expired thresholds preserved untouched (no invented thresholds); the store-level "block" gate (already existed) is now actually reachable in every case, not bypassable via a mixed expired/active-stock product.
- **Multi-batch:** verified — Batch A(8)+Batch B(7) for a 15-unit dispense produces one `Sale`, correct split, correct pooled COGS.
- **Reconciliation:** `computeBatchIntegrity`/`reconcileBatchQuantitiesToStock` (Phase 1) unchanged, now with broader test coverage (both drift directions, not-batch-tracked, already-synced).
- **Unbatched stock:** explicitly modeled as a safe no-op everywhere (integrity check, FEFO deduction, reconciliation) — never a false mismatch.

## Prescription Integrity

- **Partial dispensing:** cumulative and correct across a multi-batch boundary (15 then +5 = 20, spanning Batch A into Batch B correctly).
- **Over-dispensing:** rejected before any mutation, including mid-multi-batch dispense.
- **Completion:** status correctly becomes `"dispensed"` only when every line is fully covered.
- **Remaining quantity:** derived, never asserted; verified at each step of a multi-visit, multi-batch scenario.

## Tests

| Domain | Result |
|---|---|
| Pharmacy | 14/14 files, 122/122 tests |
| Inventory | 6/6 files, 103/103 tests |
| Sale lifecycle / financial certification / void / return / debt | 7/7 files, 106/106 tests |
| Offline | 19/19 files, 184/184 tests |
| Full suite | 652/668 files, 5246/5281 tests — same 16 pre-existing, unrelated failures as every prior baseline this session (byte-for-byte identical file list); zero new failures |
| Build | `tsc -b && vite build` succeeds (1m27s) |

Mandated test items A–Q, split between `pharmacyBatches.test.ts` (unit-level FEFO/expiry/unbatched: B, B2, C, E, I, write-off-still-reaches-expired) and `pharmacyPartialDispense.test.ts` (store-level, through the real `finalizeDraftSale`/`writeOffExpiredStock`/`voidSaleLine`: A/D, F, G, J, K, L, M, N, O, P, Q, plus the two defect-specific regression tests for the refId and real-allocation fixes). H is covered by Phase 1's `computeBatchIntegrity`/`reconcileBatchQuantitiesToStock` tests, extended this phase.

## Files Changed

| File | Why |
|---|---|
| `src/lib/pharmacyBatches.ts` | `sortBatchesFefo`/`allocateFefo` gain `includeExpired` (default `false`, excluding expired batches from automatic allocation); write-off's fallback path opts back in explicitly. |
| `src/lib/pharmacyStoreBatch.ts` | `applySaleBatchFefo` now returns `allocations` (previously discarded); new `restoreSaleLineBatchQuantity` shared by void and return. |
| `src/store/usePosStore.ts` | `saleId` hoisted once and reused (refId fix); FEFO deduction reordered before the `SaleLine` push (real-allocation capture); `voidSaleLine`/`returnProduct` wired to `restoreSaleLineBatchQuantity`, gated behind `isPharmacyMode`. |
| `src/lib/pharmacyBatches.test.ts` | New Phase 2 tests (B/B2/C/E/I + write-off exception, 8 tests); 3 pre-existing tests fixed to pass an explicit `at` anchor to `createBatchOnReceive` — their implicit "now"-relative fixture dates had silently drifted into "expired" territory since they were originally written, which only became behaviorally consequential once expired batches stopped being auto-included in FEFO. |
| `src/lib/pharmacyPartialDispense.test.ts` | New Phase 2 store-level describe block (9 tests): multi-batch dispense, refId/real-allocation regression tests, write-off-no-revenue, void/return batch restoration, offline-shape check, pack-conversion sale. |

**Not touched:** `src/types.ts`, `src/lib/costPrecision.ts`, `src/lib/saleFinancialEngine.ts`, any Hospitality file, EFRIS, AI, auth, product import, the Pharmacy UI/dashboard.

## Remaining Issues

| Severity | Issue |
|---|---|
| MEDIUM | `SaleLine` batch fields still only record the *primary* (first) batch of a multi-batch dispense — the full split is reconstructable from each batch's own timeline (`refId === saleId`) but not denormalized onto the sale line itself. |
| MEDIUM | Void/return batch restoration always targets the single primary batch, not a proportional multi-batch split — total quantity is always conserved (verified by test), but the *distribution* across batches after voiding a multi-batch original sale is an approximation, consistent with the pre-existing `resolveControlledReturnBatch` pattern (which has the same single-batch simplification already). |
| LOW | `effectiveProductExpiry`'s "active-only" batch filter can leave `product.expiryDate` frozen at a stale-but-still-past date if a product's last active batch expires with no newer batch received — self-consistent (still correctly reads as expired), not proven broken, not touched this phase. |
| FUTURE | Cloud sync for `pharmacyPrescriptions`/`pharmacyDoctors`/`pharmacyControlledRegister` (local-IndexedDB-only, per Phase 1's audit) — explicitly out of scope for this phase. |

## Financial Core Status

**GREEN** — Pharmacy remains fully downstream of the shared WAKA financial core. No duplicate engine, ledger, or COGS calculation exists or was introduced; every fix is confined to the pharmacy batch/expiry operational layer plus narrowly pharmacy-gated additions inside `usePosStore.ts` that are structurally inert for retail/hospitality sales — confirmed by zero new failures across the entire test suite (652/668 files, 5246/5281 tests, exact same 16 pre-existing failures as the established baseline).

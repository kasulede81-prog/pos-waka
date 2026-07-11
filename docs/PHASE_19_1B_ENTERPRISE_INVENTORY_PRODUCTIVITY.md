# Phase 19.1B — Enterprise Inventory Productivity Suite

**Status:** Implemented  
**Prerequisite:** Phase 19.1A — Enterprise Inventory View Engine

---

## Objective

Transform Waka POS Inventory from a product list into an **enterprise inventory management workspace** focused on large-catalog merchant productivity — without changing inventory business logic, stock calculations, purchases, pharmacy workflows, permissions, or sync.

---

## Architecture

```
StockPage
  └── InventoryViewProvider (19.1A)
        └── InventorySelectionProvider (19.1B)
              ├── InventoryFilterBar + saved presets
              ├── queryInventoryProducts (indexed search + advanced filters)
              ├── InventoryProductList → UnifiedProductRow / EnterpriseInventoryTable
              │     ├── Selection checkboxes (virtualization-safe)
              │     ├── Long-press selection (compact/mobile)
              │     └── Desktop hover quick actions (table)
              ├── InventorySelectionToolbar
              ├── InventoryBulkToolbar (floating)
              └── useInventoryKeyboardShortcuts
```

---

## Selection Engine (`src/features/inventory/selection/`)

| Module | Role |
|--------|------|
| `InventorySelectionEngine.ts` | Pure Set-based selection state |
| `InventorySelectionProvider.tsx` | React context; persists while scrolling |
| `useInventorySelection.ts` | Hook |
| `InventorySelectionToolbar.tsx` | Select page / filtered / clear |
| `InventorySelectionModeButton.tsx` | Enter/exit selection mode |

**Capabilities:** single select, multi-select, select page (visible virtual rows), select filtered results, clear, Esc to exit.

---

## Bulk Operations Framework (`InventoryBulkOperations.ts`)

Single orchestration path via `runInventoryBulkOperation()` + existing store mutations:

| Action | Implementation |
|--------|----------------|
| Bulk category / shelf | `updateProduct({ category })` |
| Bulk selling price / cost | `updateProduct` price fields |
| Bulk stock increase/reduce/set | `adjustStock(delta, reason)` |
| Bulk archive / unarchive | `preferences.inventoryArchivedProductIds` overlay |
| Bulk activate / deactivate | unarchive + `menu.hideFromMenu` |
| Bulk tags / supplier tag | `preferences.inventoryProductTags` overlay |
| Export / labels | `productCatalogExport.ts`, `productLabelPrint.ts` |

No duplicated stock math — all adjustments go through certified store paths.

---

## Advanced Filters

`InventoryAdvancedFilters` combines: category, shelf, supplier (from movements + tags), brand (pharmacy), stock (all/low/out), active/archived/inactive, price/cost ranges, recently edited.

Applied in **one pipeline** with indexed search in `queryInventoryProducts()`.

---

## Saved Filters

Stored in `ShopPreferences.inventorySavedFilters` per shop. Presets save current filter + query (e.g. Low Stock, Medicines, Warehouse A).

---

## Enterprise Search

Extended inventory haystack in `buildInventorySearchIndex()` — still built on certified `posProductSearch.ts` core:

- Product name, SKU, barcode (existing)
- Category, shelf (existing)
- Brand, supplier name, productivity tags (inventory enrichment)

---

## Desktop Productivity

- **Table:** sticky selection column, hover quick actions (Edit, Stock, Sell, Barcode, More)
- **Keyboard:** Ctrl+A select filtered, Esc clear, Delete archive, Ctrl+F focus search, Ctrl+Shift+E export, Ctrl+P print labels

---

## Mobile Productivity

- **Long-press** (~480ms) on compact rows enters selection mode
- **Floating bulk toolbar** when selection > 0
- **44px** overflow / checkbox touch targets

---

## Performance

- Virtualization unchanged (`@tanstack/react-virtual`)
- Single memoized `buildInventorySearchIndex` per catalog revision
- Selection uses `Set<string>` — O(1) lookup, no row component state duplication
- Advanced filters applied in same pass as search (no duplicate pipelines)

---

## Test Results

```text
npm run build   ✅
npm test        ✅ (selection engine + inventory query tests)
```

New tests:
- `InventorySelectionEngine.test.ts`
- `inventoryProductListQuery.test.ts` (extended)

---

## Success Criteria

| Criterion | Status |
|-----------|--------|
| Enterprise multi-select | ✅ |
| Unified bulk operations | ✅ |
| Advanced filtering | ✅ |
| Saved filters | ✅ |
| Bulk stock reuses adjustStock | ✅ |
| Label/barcode batch workflows | ✅ |
| Desktop ERP-style table actions | ✅ |
| Mobile long-press selection | ✅ |
| Single indexed search engine | ✅ |
| Build / tests pass | ✅ |

---

## Files

**New:** `src/features/inventory/selection/*`, `filters/*`, `bulk/*`, `export/*`, `keyboard/*`, `StockInventoryProductivityChrome.tsx`

**Modified:** `StockPage.tsx`, `inventoryProductListQuery.ts`, `InventoryProductList.tsx`, `EnterpriseInventoryTable.tsx`, `UnifiedProductRow.tsx`, `types.ts`, `i18n.ts`

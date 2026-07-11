# Phase 19.0 — Enterprise Inventory Experience & Product List Certification

**Mode:** Read-only architecture + UX + functional audit (no code changes)  
**Date:** 2026-07-11  
**Scope:** Inventory module across Retail, Pharmacy, Hospitality, Wholesale, Desktop, Tablet, Mobile  
**Baseline:** `StockPage.tsx`, `VirtualizedStockProductList.tsx`, `posProductSearch.ts`, `enterprisePerformanceScalability.test.ts`  
**Verdict:** **Conditionally certified for sell-side up to ~20k products; not certified for enterprise inventory management at 10k–100k without Phase 19.1 view-system work**

---

## Executive Summary

Waka POS inventory is architecturally **unified at the hub level** (`InventoryPurchasingPage` + embedded `StockPage`) but **fragmented at the product-list layer**. Two virtualized primitives exist (`VirtualizedProductGrid` for sell, `VirtualizedStockProductList` for inventory), yet **15+ independent listing implementations** remain across POS, pharmacy dispense, hospitality table order, purchases, counts, profit, and admin.

**Performance is bifurcated:**

| Surface | Search at 20k | Virtualization | Certified scale |
|---------|---------------|----------------|-----------------|
| **POS / Dispense** | Indexed, ≤220 ms | Yes | **~20k products** ✅ |
| **Stock / Inventory list** | Non-indexed O(n) | Yes | **~1k filter** (simplified test only) 🟡 |
| **Inventory counts** | Non-indexed O(n) | **No** | **~500 lines** practical 🟡 |
| **Purchase picker** | Capped at 80 | No | Small catalogs only |

**Answer to the certification questions:**

| Question | Answer |
|----------|--------|
| Suitable for 10,000–100,000 products? | **No for inventory UX** — sell path tolerates ~20k; stock/count/purchase paths do not |
| Should cards remain default on mobile? | **Yes for POS sell** (grid density OK); **No as sole inventory mode** (single-column cards waste scan speed) |
| Should compact lists be introduced? | **Yes** — highest ROI for StockPage mobile + tablet |
| Should desktop switch to enterprise tables? | **Yes for inventory** — desktop uses same card list as mobile; horizontal space unused |
| Should Waka support multiple view modes? | **Yes** — adaptive Card / Compact / Table by breakpoint + catalog size |
| Most scalable UX without losing ease? | **Search-first + shelf navigation + compact/table on desktop** — not infinite card scroll |

---

# PART 1 — Inventory Architecture

## 1.1 Complete ecosystem map

```
Home (/) ──launcher──► /stock  OR  /pharmacy/inventory
Office (/office) ──daily card──► /stock

┌─────────────────────────────────────────────────────────────────────────────┐
│  INVENTORY HUB — InventoryPurchasingPage                                     │
│  /stock (retail/hospitality/wholesale) | /pharmacy/inventory (pharmacy)     │
├─────────────────────────────────────────────────────────────────────────────┤
│  ?tab=overview    → InventoryWorkspaceOverview (stats, quick actions, search) │
│  ?tab=products    → StockPage (embedded, workspaceEmbed)                      │
│       ├─ stockView: overview | products | shelves | low | movements           │
│       ├─ ?q= search · ?productId= detail (pharmacy barcode)                   │
│       └─ Modals: StockProductEditModal, SimpleAddProductWizard,               │
│                  PharmacyAddMedicineWizard, StockAdjustmentSheet,             │
│                  BulkInventoryAiModal, batch sheets (pharmacy)                 │
│  ?tab=purchases   → PurchasesTab → NewPurchaseSheet → RestockPage             │
│  ?tab=suppliers   → SuppliersTab → SupplierDetailSheet                        │
│  ?tab=payments    → PaymentsTab                                               │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ├── /stock/count              → InventoryCountSessionsPage
         │    └── /stock/count/:id     → InventoryCountSessionPage
         ├── /stock/transfer           → InventoryTransferPage (placeholder)
         │
         ├── Pharmacy satellites
         │    ├── /pharmacy/expiry
         │    ├── /pharmacy/reports/inventory
         │    └── /pharmacy/compliance/register
         │
         └── Settings-adjacent
              ├── /settings/shelves     → SettingsShelvesPage
              └── /settings/menu        → MenuBuilderPage (hospitality recipes)

SELL / PICK (not under /stock but inventory-adjacent)
├── /pos (PosPage) — product catalog grid
├── /pharmacy/dispense — SellProductBrowsePanel
├── /hospitality/table/:id — TableOrderPage inline product cards
└── RestockProductPicker — purchase line add (max 80)

ENTERPRISE HQ (separate, placeholder)
├── /enterprise/transfers
└── /enterprise/purchasing → links to /stock?tab=purchases

LEGACY REDIRECTS → hub
/inventory → /stock · /restock → purchases · /suppliers → suppliers tab
```

## 1.2 Architecture SSOT map

| Layer | Primary files |
|-------|---------------|
| Hub page | `src/pages/InventoryPurchasingPage.tsx` |
| Products workspace | `src/pages/StockPage.tsx` |
| Overview | `src/components/inventory/workspace/InventoryWorkspaceOverview.tsx` |
| Purchases | `src/features/inventory-purchasing/components/PurchasesTab.tsx` |
| Count | `src/pages/InventoryCountSessionPage.tsx` |
| Tile/nav config | `src/lib/inventoryWorkspaceTiles.ts`, `launcherTiles.ts` |
| POS catalog | `src/pages/PosPage.tsx` |
| Indexed search | `src/lib/posProductSearch.ts` |
| Stock search (legacy) | `src/lib/productCategories.ts` → `productMatchesSellSearch` |

## 1.3 Architecture strengths

- **Single inventory hub** with tab-based IA — no duplicate purchase/supplier routes in production
- **Mode-aware labels** (pharmacy/wholesale/hospitality terms) without separate route trees
- **Virtualized stock list** always on `StockPage` products tab
- **Indexed POS search** certified at 20k with automated tests
- **Shelf-first navigation** on POS and stock shelves tab reduces raw list exposure
- **Rich pharmacy extensions** (batches, expiry, controlled) integrated into shared `StockProductCard`

## 1.4 Architecture gaps

- **No unified Product List primitive** — sell vs stock vs count vs purchase each own markup
- **Stock search not indexed** despite certified indexer existing for POS
- **No view-mode system** — card-only inventory on all breakpoints
- **Count sessions not virtualized** — full DOM for every line
- **Transfer workspace placeholder** — `TransferProductSelector` unused
- **`resolveInventoryNavTiles()` defined but not wired** in overview UI

---

# PART 2 — Product List Certification

## 2.1 Complete implementation inventory

| # | Surface | File | Component | Layout | Virtualized |
|---|---------|------|-----------|--------|-------------|
| 1 | **Inventory products** | `StockPage.tsx` | `VirtualizedStockProductList` → `StockProductCard` | Card list | ✅ Always |
| 2 | **POS catalog** | `PosPage.tsx` | `VirtualizedProductGrid` / inline cards | Card grid | ✅ If >10 items |
| 3 | **Pharmacy dispense** | `PharmacyDispenseWorkspace.tsx` | `SellProductBrowsePanel` | Card grid | ✅ Via panel |
| 4 | **Hospitality table order** | `TableOrderPage.tsx` | Inline `map` buttons | Card grid 2–4 col | ❌ |
| 5 | **Purchase picker** | `RestockProductPicker.tsx` | Row list | Rows | ❌ Cap 80 |
| 6 | **Inventory count** | `InventoryCountSessionPage.tsx` | `CountProductCard` | Expandable cards | ❌ |
| 7 | **Menu builder** | `MenuBuilderPage.tsx` | Row list | Rows in scroll | ❌ |
| 8 | **Profit products** | `ProfitPage.tsx` | `ProfitProductCard` + `ProfitLowMarginList` | Cards + rows | ❌ |
| 9 | **Dashboard low stock** | `DashboardPage.tsx` | Simple rows | Rows | ❌ |
| 10 | **Pharmacy expiry** | `PharmacyExpiryCenterPage.tsx` | Inline batch cards | Cards | ❌ |
| 11 | **Stock adjustment** | `StockAdjustmentSheet.tsx` | `<select>` dropdown | Dropdown | N/A |
| 12 | **Return modal** | `ReturnProductModal.tsx` | `<select>` | Dropdown | N/A |
| 13 | **Transfer selector** | `TransferProductSelector.tsx` | Row list | Rows | ❌ Unused |
| 14 | **POS quick chips** | `PosQuickProductChips.tsx` | Horizontal chips | Chips | ❌ |
| 15 | **Admin preview** | `AdminShopInventoryPanel.tsx` | Row list | Rows | ❌ |

**No components named** `ProductList`, `ProductBrowser`, or `ProductRow`. Only picker: `RestockProductPicker`.

## 2.2 Reuse vs duplication

### Shared trees (good)

```
SellProductBrowsePanel → VirtualizedProductGrid → PosSellProductCard | PosDesktopProductCard | PharmacySellMedicineCard
VirtualizedStockProductList → StockProductCard
```

### Critical duplication (bad)

| Duplicate | Locations |
|-----------|-----------|
| POS browse logic | `PosPage.tsx` reimplements shelf/search vs `useSellProductBrowseEngine` (dispense reuses engine) |
| Default sell card markup | `VirtualizedProductGrid` inline button **and** `PosPage.tsx` legacy branch (`min-h-[132px]`) |
| Virtual threshold fork | `PosPage` renders identical grid twice based on `VIRTUAL_PRODUCT_THRESHOLD = 10` |
| Row-list pickers | `RestockProductPicker` ≈ `TransferProductSelector` (latter dead) |
| Search haystack build | Indexed (`posProductSearch.ts`) vs per-keystroke (`productMatchesSellSearch`) |
| Profit density | `ProfitProductCard` vs `ProfitLowMarginList` same data, different layouts |

## 2.3 Certification verdict

**Product list layer: NOT certified as unified.** Two virtualized cores exist but **13+ surfaces bypass them**.

---

# PART 3 — Scalability Certification

## 3.1 Simulated scale matrix

Estimates based on code paths, test thresholds, and virtualizer row heights — not live device profiling at every scale.

| Catalog size | POS sell | Stock inventory | Count session | Purchase picker | Grouping |
|--------------|----------|-----------------|---------------|-----------------|----------|
| **10** | Instant | Instant | Instant | Instant | Off |
| **100** | Instant | Instant | Instant | Instant | Auto-on if >12 |
| **500** | <50 ms search | ~50–150 ms filter* | Scroll OK | Picker caps at 80 | Grouping on |
| **1,000** | <100 ms | ≤300 ms (test)** | Laggy DOM | Broken UX | Grouping on |
| **5,000** | <220 ms | 1–3 s filter* | Unusable DOM | N/A | Grouping off (>250) |
| **20,000** | ≤220 ms ✅ | 5–15 s filter* | Unusable | N/A | Off |
| **100,000** | ~220 ms search*** | Memory + multi-second filter | Crash risk | N/A | Off |

\*Stock uses `productMatchesSellSearch` O(n) per filter pass, not indexed path.  
\*\*`androidPerformanceSprint.test.ts` — simplified 1k name/sku filter, ≤300 ms — not full StockPage path.  
\*\*\*Search certified; full in-memory catalog still ~100k Product objects in Zustand.

## 3.2 Scroll fatigue & interaction cost

| Scale | Avg visible (stock mobile) | Scroll to item #500 | Search required? |
|-------|---------------------------|---------------------|------------------|
| 100 | ~4 cards | ~125 screen heights | Optional |
| 1,000 | ~4 cards | ~250 screens | **Expected** |
| 20,000 | ~4 cards | ~5,000 screens | **Mandatory** |
| 100,000 | ~4 cards | ~25,000 screens | **Mandatory + indexed** |

**Stock row estimate:** 118 px (`VirtualizedStockProductList`) + action row ≈ **140 px effective** → **~4 products visible** on typical mobile viewport after chrome.

**POS mobile grid:** 2 columns × ~120 px rows → **~6–8 products visible** — materially better density than inventory.

## 3.3 Memory & rendering

- **Virtualization caps DOM nodes** on POS and Stock — scrolling stays smooth at 20k+ *once filtered list is built*
- **Bottleneck is filter/sort**, not paint — building `listableProducts` scans entire catalog every keystroke on Stock
- **100k in-memory products** — feasible on desktop; mobile WebView may pressure RAM during full-catalog operations
- **Grouped stock view** spins **one virtualizer per shelf group** — multiplies overhead when grouping auto-enabled (13–250 products)

## 3.4 Scalability certification verdict

| Range | Certified? |
|-------|------------|
| 10–500 products | ✅ Comfortable |
| 500–5,000 products | 🟡 Sell OK; inventory search degrades |
| 5,000–20,000 products | 🟡 Sell certified; inventory **not certified** |
| 10,000–100,000 products | ❌ **Not certified** for inventory management UX |

---

# PART 4 — Mobile UX Certification

## 4.1 Stock card anatomy (`StockProductCard`)

| Element | Height / size | Assessment |
|---------|---------------|------------|
| Card padding | `p-2.5` | Reasonable |
| Shelf icon | 40×40 px | Good touch target for detail tap |
| Name + badges | 1–3 lines | Pharmacy badges add vertical noise |
| Shelf + stock + price | 2 lines | Required info |
| Action row | `min-h-[36px]` × 2–3 buttons | **Below 44px enterprise minimum** |
| More menu | 36×36 px | Borderline |
| **Total card** | ~118–140 px | **~4 products/screen** |

## 4.2 Mobile UX findings

| Criterion | Status | Evidence |
|-----------|--------|----------|
| One product excessive vertical space? | **Yes on inventory** | Single-column cards with 2–3 always-visible action buttons |
| Repeated buttons reduce density? | **Yes** | Sell + Edit + More on every row; low-stock tab adds Restock CTA |
| Quick scan hundreds? | **No** | Requires search; scroll impractical beyond ~200 |
| Touch targets | 🟡 | Action buttons 36px; action sheet items 48px ✅ |
| FAB / quick add | ✅ | Workspace overview quick actions |
| Search pinned | ✅ | `StockPinnedSearch` on products tab |
| Filters accessible | ✅ | Chip filters + sort dropdowns in `StockListToolbar` |

## 4.3 POS mobile comparison

POS sell cards (`min-h-[108px]`, 2+ columns) achieve **~2× visual density** vs inventory list. Pharmacy medicine cards (`min-h-[168px]`) are **less dense** — justified by regulatory fields.

## 4.4 Mobile certification verdict

**POS mobile: certified** for sell workflows.  
**Inventory mobile: conditionally certified** up to ~500 products; **not certified** for large-catalog merchants without compact list mode.

---

# PART 5 — Desktop Certification

## 5.1 Current desktop inventory

- `StockPage` embedded in hub — **same single-column card list** as mobile
- `workspaceEmbed` adjusts page container padding only — **no desktop layout fork**
- `StockListToolbar` uses responsive grid for filters — not product layout
- **No table view, no multi-column inventory grid, no split-pane master/detail**

## 5.2 Desktop assessment

| Question | Answer |
|----------|--------|
| Should desktop remain card-based? | **Not as only mode** — wastes 60–80% horizontal space on ≥1024 px |
| Should desktop use tables? | **Yes for inventory** — enterprise standard (Square, Lightspeed, Odoo) |
| Should there be compact mode? | **Yes** — optional toggle or auto by width |
| Should there be multiple layouts? | **Yes** — adaptive Card / Compact / Table |

## 5.3 POS desktop contrast

`PosPage` **does** adapt: `PosDesktopProductCard`, multi-column `VirtualizedProductGrid`, favorites column — inventory lacks parity.

## 5.4 Desktop certification verdict

**Not certified for enterprise desktop inventory.** Sell desktop is ahead; inventory desktop is mobile-layout stretched wide.

---

# PART 6 — Inventory Density Audit

## 6.1 Density estimates (typical phone, ~420 px wide)

| View | Products visible | Products per 100 px vertical |
|------|------------------|-------------------------------|
| Stock card (current) | **~4** | ~2.9 |
| Stock compact (estimated 72 px) | **~7** | ~5.6 |
| POS sell 2-col | **~6–8** | ~4.5 |
| Enterprise table row (estimated 40 px) | **~12–15** | ~10 |
| POS desktop 5-col | **~15–20** | N/A (grid) |

## 6.2 Productivity impact (qualitative)

| Task | Current | Compact | Table |
|------|---------|---------|-------|
| Find product by scroll | Poor at 1k+ | Fair | Good with sort |
| Compare stock across items | Poor | Fair | **Excellent** |
| Batch restock triage | Low-stock tab helps | Good | **Excellent** |
| One-hand mobile restock | Good (big buttons) | Good | Poor |

**Optimal strategy:** Adaptive — **compact/table on desktop**, **compact list on mobile inventory**, **card grid retained for POS sell**.

---

# PART 7 — Product Card Audit (`StockProductCard`)

| Field | Shown | Required | Optional | Redundant |
|-------|-------|----------|----------|-----------|
| Image | ❌ Emoji icon | — | Photo would help recognition | Icon OK for MVP |
| Product name | ✅ | ✅ | | |
| Pharmacy brand/generic | ✅ pharmacy | ✅ pharmacy | | |
| Category/shelf | ✅ | ✅ | | Repeated in grouped headers |
| Barcode/SKU | ❌ card | | ✅ detail sheet | Hidden opportunity |
| Stock | ✅ | ✅ | | |
| Price | ✅ | ✅ | | |
| Cost | ❌ card | | ✅ detail | Correct |
| Expiry/batch badges | ✅ pharmacy | ✅ pharmacy | | |
| Controlled/cold badges | ✅ pharmacy | ✅ pharmacy | | |
| Low-stock badge | ✅ low tab | Contextual | | |
| Locked badge | ✅ | ✅ | | |
| Sell button | ✅ | Contextual | | Always visible = density cost |
| Edit button | ✅ | Contextual | | Could be overflow-only |
| More menu | ✅ | ✅ | | Correct pattern |

**Spacing:** `p-2.5`, `gap-1.5` — consistent with design system.  
**Redundancy:** Sell + Edit + More when More duplicates Edit/Restock/Duplicate/Remove.

---

# PART 8 — Action Audit

## 8.1 Stock product actions

| Action | Primary surface | Frequency (est.) | Always visible? | Recommendation |
|--------|-----------------|------------------|-----------------|----------------|
| **Sell / Dispense** | Card button | High | OK on POS; debatable on inventory | Inventory: overflow or swipe |
| **Edit** | Card + sheet | Medium | **No** — move to sheet/detail | Reduce card chrome |
| **Restock** | Card (low tab) + sheet | Medium | Contextual ✅ on low tab | Keep |
| **Duplicate** | Sheet only | Low | ✅ hidden | OK |
| **Remove** | Sheet only | Low | ✅ hidden | OK |
| **Open detail** | Tap card body | Medium | ✅ | OK |
| **Adjust stock** | Detail / sheets | Medium | Via detail | OK |
| **Print label** | ❌ not on card | Low | N/A | Future bulk labels |
| **Barcode scan** | Search wedge | High | ✅ search | OK |

## 8.2 Swipe actions

**Not implemented anywhere** in inventory lists. Enterprise apps (Square, Loyverse) use swipe-to-edit or swipe-to-adjust on mobile tables/lists.

## 8.3 Action certification

**Partially certified** — action sheet pattern is sound; **primary card buttons over-exposed** for inventory (vs sell context where tap-to-add dominates).

---

# PART 9 — Search Certification

## 9.1 Search implementations

| Surface | Engine | Indexed | Barcode | Incremental |
|---------|--------|---------|---------|-------------|
| POS | `filterIndexedProductsForSellView` | ✅ | ✅ pharmacy | ✅ per keystroke |
| Dispense | `useSellProductBrowseEngine` | ✅ | ✅ | ✅ |
| Stock | `productMatchesSellSearch` | ❌ | ✅ opens detail | ✅ per keystroke |
| Count | `filterInventoryCountLines` | ❌ | ❌ | ✅ |
| Purchase picker | Client filter on capped list | ❌ | ❌ | ✅ |

## 9.2 Filter & sort (Stock)

| Capability | Status |
|------------|--------|
| Text search | ✅ broad haystack (name, SKU, barcodes, medicine fields) |
| Low-stock filter | ✅ |
| Category/shelf filter | ✅ dropdown |
| Sort (name, stock, updated) | ✅ |
| Group by category | ✅ auto 13–250 products |
| Favorites | ❌ inventory (POS only) |

## 9.3 Search certification verdict

**POS search: certified** (20k, tested).  
**Inventory search: not certified at scale** — must adopt indexed path + shelf-first UX so users **never scroll unfiltered lists above ~200 items**.

---

# PART 10 — Enterprise Inventory Table Audit

## 10.1 View modes today

| Mode | Exists? |
|------|---------|
| Card View | ✅ Only mode (stock) |
| Compact List | ❌ |
| Enterprise Table | ❌ |
| Adaptive View | ❌ (POS sell only) |
| Responsive View | 🟡 Toolbar responsive; list is not |

## 10.2 Recommended adaptive rules (Phase 19.1 — not implemented)

| Condition | Default view |
|-----------|--------------|
| Mobile + inventory | Compact list |
| Mobile + POS sell | Card grid (keep) |
| Tablet landscape + inventory | Compact list or 2-col cards |
| Desktop ≥1024 px + inventory | Enterprise table |
| Desktop + POS | Multi-column grid (keep) |
| Catalog > 5,000 | Force search/shelf; disable unfiltered scroll messaging |
| Pharmacy mode | Table with expiry/batch columns |

---

# PART 11 — Bulk Operations

| Operation | Status | Evidence |
|-----------|--------|----------|
| Bulk add (AI import) | ✅ | `BulkInventoryAiModal`, `bulkQuickAddProducts` |
| Bulk add (starter pack) | ✅ | `StockPage.applyStarter()` |
| Bulk add (multi-row form) | ✅ | `bulkQuickAddProducts` sequential |
| Bulk edit | ❌ | No multi-select |
| Bulk delete/archive | ❌ | |
| Bulk shelf move | ❌ | Shelf = category; per-product only |
| Bulk category change | ❌ | |
| Bulk stock adjustment | ❌ | Single-product adjustment sheet |
| Bulk labels | ❌ | |
| Bulk export (CSV) | ❌ | Count variance export only |
| Bulk import (CSV) | ❌ | AI import only |

**Bulk certification: add-only.** Not enterprise-ready for catalog maintenance at scale.

---

# PART 12 — Virtualization

## 12.1 Current virtualization

| Component | Library | Row estimate | Overscan |
|-----------|---------|--------------|----------|
| `VirtualizedProductGrid` | `@tanstack/react-virtual` | 112–168 px by variant | 5 |
| `VirtualizedStockProductList` | `@tanstack/react-virtual` | 118 px | 6 |

## 12.2 Not virtualized (risk list)

- `InventoryCountSessionPage` — all `CountProductCard` in DOM
- `TableOrderPage` product grid
- `MenuBuilderPage`, `ProfitPage`, `DashboardPage` low stock
- `RestockProductPicker` (capped 80 — moot)
- Grouped stock: **N virtualizers** (one per category group)

## 12.3 Maximum safe dataset

| Surface | Safe without UX collapse |
|---------|--------------------------|
| Virtualized stock list | **20k+** DOM-safe; filter build is bottleneck |
| Virtualized POS grid | **20k+** certified |
| Count session | **~200–300 lines** practical |
| Purchase picker | **80** hard cap |

---

# PART 13 — Performance

## 13.1 Measured thresholds (automated tests)

| Test file | Scenario | Threshold |
|-----------|----------|-----------|
| `enterprisePerformanceScalability.test.ts` | POS indexed search 20k | **220 ms** |
| `posProductSearch.test.ts` | Category + text 20k | **220 ms** |
| `androidPerformanceSprint.test.ts` | Inventory filter 1k (simplified) | **300 ms** |
| `enterprisePerformanceScalability.test.ts` | Reports 100k sales | 4,000 ms |
| `backOfficePerformanceOptimization.test.ts` | Owner command center 10k | <900 ms |

Production comment in tests: POS search target **~100 ms**; CI allows 220 ms.

## 13.2 Performance gaps

1. Stock does not call `buildProductSellSearchIndex` / `filterIndexedProductsForSellView`
2. No 20k benchmark for stock filter path
3. Count sessions O(n) render + O(n) filter
4. Sort on every `listableProducts` rebuild copies full array

## 13.3 Enterprise readiness

| Dimension | Score component |
|-----------|-----------------|
| Sell-side performance | Strong |
| Inventory filter performance | Weak at 5k+ |
| Count performance | Weak |
| Bulk throughput | Weak (sequential add) |

---

# PART 14 — Visual Consistency

| Surface | Product UI | Design system | Consistency |
|---------|------------|---------------|-------------|
| Retail stock | `StockProductCard` | Waka tokens | Baseline |
| Pharmacy stock | Same + badges | + pharmacy tokens | Good |
| Wholesale stock | Same + terms | Label overrides | Good |
| Hospitality stock | Same | Menu categories | Good |
| POS sell | Different cards | `pos-ds-product-card` | Intentional |
| Dispense | Pharmacy sell card | Aligned with POS | Good |
| Table order | Inline cards | **Different** — aspect-ratio images | **Drift** |
| Count | `CountProductCard` | Overlapping fields | Partial |
| Purchases | Line cards, not product browser | Different IA | OK |

**Component reuse score: medium** — stock modes consistent; sell vs inventory vs hospitality table intentionally diverge.

---

# PART 15 — Accessibility

| Criterion | Status | Notes |
|-----------|--------|-------|
| Touch targets (inventory actions) | 🟡 | 36px buttons on card; sheet 48px ✅ |
| Touch targets (toolbar) | 🟡 | 32px filter chips |
| Keyboard navigation | 🟡 | POS has shortcuts; stock list no row roving tabindex |
| Focus management | ✅ | Modals/sheets use `AppModalOverlay` |
| Screen readers | 🟡 | `sr-only` on More button; cards lack row semantics |
| Large fonts / display scale | ✅ | POS grid scales via `DISPLAY_SCALE_META` |
| Landscape tablet | 🟡 | No layout adaptation for inventory |
| Color / low-stock | ✅ | Rose badges + text contrast |

---

# PART 16 — Duplicate Components Report

| Category | Duplicates | Consolidation target |
|----------|------------|----------------------|
| Product cards | `StockProductCard`, `PosSellProductCard`, `PosDesktopProductCard`, `PharmacySellMedicineCard`, `CountProductCard`, `ProfitProductCard`, inline TableOrder | **`UnifiedProductRow` + density variants** |
| Virtualized lists | 2 cores (OK) | Wrap in `EnterpriseInventoryList` adapter |
| Search bars | `StockPinnedSearch`, POS search, picker search | **`InventorySearchBar` shared shell** |
| Filters | `StockListToolbar` vs POS shelf grid | Shared filter chip component |
| Pickers | `RestockProductPicker`, `TransferProductSelector` | Single **`ProductPickerSheet`** |
| Browse engine | `PosPage` vs `useSellProductBrowseEngine` | POS should reuse engine |
| Action menus | `StockProductActionSheet` vs POS actions | **`ProductActionMenu` registry** |
| Dialogs | Edit modals per mode (retail/pharmacy wizards) | Keep mode forks; unify shell |

---

# PART 17 — Enterprise Benchmark

Comparison against common POS/inventory UX patterns (qualitative — not live app testing).

| Criterion | Square | Shopify POS | Lightspeed | Loyverse | Odoo | **Waka POS** |
|-----------|--------|-------------|------------|----------|------|--------------|
| Information density (inventory) | Table + mobile list | Grid sell; list inventory | Table-heavy | Compact list | Full table | **Low (cards only)** |
| Navigation (large catalog) | Search + categories | Search + collections | Search + filters | Search + groups | Search + facets | **Search + shelves** ✅ |
| Speed at 10k+ | Cloud-dependent | Cloud-dependent | Strong desktop | Moderate | Strong | **Sell strong; stock weak** |
| Professional desktop | ✅ Table | ✅ | ✅ | 🟡 | ✅ | **❌ Mobile layout** |
| Bulk catalog ops | ✅ | ✅ | ✅ | 🟡 | ✅ | **Add-only** |
| Mobile scan workflow | ✅ | ✅ | ✅ | ✅ | ✅ | **✅ Barcode wedge** |
| Enterprise scalability | ✅ | ✅ | ✅ | 🟡 | ✅ | **🟡 Sell only** |

**Waka strengths:** Offline-first, pharmacy depth, shelf metaphor, indexed POS search, virtualization on primary surfaces.  
**Waka gaps:** Inventory desktop table, compact mobile list, bulk maintenance, count virtualization.

---

# PART 18 — Inventory Readiness Score

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| **Architecture** | **7.2 / 10** | Unified hub; fragmented list layer |
| **Performance** | **6.8 / 10** | POS 20k certified; stock unindexed |
| **Scalability** | **5.4 / 10** | 100k not viable for inventory UX |
| **UX** | **6.5 / 10** | Good for SMB; poor large-catalog scan |
| **Accessibility** | **6.8 / 10** | Sheets good; card targets small |
| **Consistency** | **6.9 / 10** | Stock modes aligned; sell/count drift |
| **Desktop** | **4.8 / 10** | No inventory desktop layout |
| **Mobile** | **7.4 / 10** | POS strong; inventory cards tall |
| **Tablet** | **6.0 / 10** | No adaptive inventory layout |
| **Enterprise Readiness** | **6.1 / 10** | **Not certified 10k–100k inventory** |

### Mode-specific sub-scores

| Mode | Inventory readiness |
|------|---------------------|
| Retail sell (POS) | **8.6 / 10** ✅ |
| Retail stock management | **6.3 / 10** |
| Pharmacy (dispense + stock) | **7.5 / 10** |
| Hospitality (table order) | **5.8 / 10** (no virtualization) |
| Wholesale | **6.2 / 10** (labels only; same UI) |

---

# PART 19 — Phase 19.1 Implementation Blueprint

**Do NOT implement in 19.0.** Recommended roadmap if redesign is approved.

## 19.1.1 — Enterprise Inventory View System

Create `src/lib/inventoryViews/` + `src/components/inventory/views/`:

| Module | Role |
|--------|------|
| `InventoryViewEngine.ts` | Selects card / compact / table by breakpoint + catalog size + user preference |
| `UnifiedProductRow.tsx` | Single row renderer with density prop (`comfortable` \| `compact` \| `table`) |
| `UnifiedProductActions.tsx` | Action registry; context-aware visible vs overflow |
| `EnterpriseInventoryTable.tsx` | Desktop sortable columns (name, SKU, shelf, stock, price, status) |
| `InventorySearchBar.tsx` | Shared search + barcode + filter chips |

## 19.1.2 — Performance hardening (no UI change required first)

1. Wire `StockPage.listableProducts` through `buildProductSellSearchIndex` / `filterIndexedProductsForSellView`
2. Add 20k stock filter benchmark test
3. Virtualize `InventoryCountSessionPage`
4. Refactor `PosPage` to use `SellProductBrowsePanel` / `useSellProductBrowseEngine` (remove duplicate grid branches)

## 19.1.3 — Adaptive layout rules

| Breakpoint | Inventory default | POS default |
|------------|-------------------|-------------|
| `<768 px` | Compact list | Card grid |
| `768–1023 px` | Compact list | Card grid |
| `≥1024 px` | Enterprise table | Multi-column grid |

Persist user override in shop preferences.

## 19.1.4 — Bulk Operations Framework

- Multi-select mode on table/compact views
- Batch actions: shelf move, category, archive, export CSV, print labels
- Transactional batch with progress toast (pattern: `executeShopAction`)

## 19.1.5 — Consolidation order

```
1. Indexed stock search (performance — low risk)
2. UnifiedProductRow + compact mode on StockPage mobile
3. Enterprise table on desktop StockPage
4. InventoryViewEngine + preferences
5. Virtualize count sessions
6. Unify PosPage browse with SellProductBrowsePanel
7. Bulk ops framework
8. Hospitality TableOrderPage → shared grid primitive
```

## 19.1.6 — Explicit non-goals

- No product photo CDN pipeline in 19.1
- No server-side catalog pagination (offline-first preserved)
- No replacement of pharmacy batch/expiry modals

## 19.1.7 — Success criteria (Phase 19.1)

| Criterion | Target |
|-----------|--------|
| Stock search 20k | ≤220 ms (match POS) |
| Products visible (mobile inventory) | ≥7 compact rows |
| Desktop inventory | Table default ≥1024 px |
| Count session 5k lines | Virtualized; scroll smooth |
| Duplicate list implementations | −50% |
| Enterprise readiness | **8.5+ / 10** |

---

# Deliverables Checklist

| Deliverable | Section |
|-------------|---------|
| Enterprise Inventory Certification Report | Parts 1, 18 |
| Product List Certification | Part 2 |
| Scalability Report | Part 3 |
| Mobile UX Report | Part 4 |
| Desktop UX Report | Part 5 |
| Product Card Audit | Part 7 |
| Search Certification | Part 9 |
| Performance Report | Part 13 |
| Duplicate Component Report | Part 16 |
| Enterprise Benchmark | Part 17 |
| Inventory Readiness Score | Part 18 |
| Phase 19.1 Implementation Blueprint | Part 19 |

---

# Verification Statement

| Success criterion | Met? |
|-------------------|------|
| Complete inventory architecture mapped | ✅ |
| Every product listing located | ✅ |
| Scalability simulated with evidence | ✅ |
| Mobile/desktop/tablet audited | ✅ |
| Duplicates identified | ✅ |
| Certification questions answered | ✅ |
| No code changes | ✅ |

**Phase 19.0: Audit complete.**

---

## Appendix — Key file index

```
src/pages/InventoryPurchasingPage.tsx
src/pages/StockPage.tsx
src/pages/PosPage.tsx
src/pages/InventoryCountSessionPage.tsx
src/pages/RestockPage.tsx
src/components/stock/StockProductCard.tsx
src/components/stock/VirtualizedStockProductList.tsx
src/components/stock/StockListToolbar.tsx
src/components/stock/RestockProductPicker.tsx
src/components/pos/VirtualizedProductGrid.tsx
src/components/pos/SellProductBrowsePanel.tsx
src/hooks/useSellProductBrowseEngine.ts
src/lib/posProductSearch.ts
src/lib/productCategories.ts
src/lib/enterprisePerformanceScalability.test.ts
src/lib/androidPerformanceSprint.test.ts
src/features/inventory-purchasing/
```

---

*End of Phase 19.0 read-only audit. No application code was modified.*

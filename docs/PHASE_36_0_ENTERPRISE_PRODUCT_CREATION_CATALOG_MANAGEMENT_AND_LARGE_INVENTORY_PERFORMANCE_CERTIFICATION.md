# Phase 36.0 — Enterprise Product Creation, Catalog Management & Large Inventory Performance Certification

**Mode:** Read-only enterprise audit (**NO code changes, NO CSS, NO SQL, NO migrations, NO dependency updates**)  
**Date:** 2026-08-04  
**Scope:** Product creation pipeline, catalog management UX, and large-inventory performance (save → local commit → queue → search/list refresh)  
**Out of scope:** Sell grid polish (Phases 32–33), Home (34), EOD wizard (35), rewriting sync algorithms  
**Related prior work:**  
- Phase 19.x — inventory experience / view engine  
- Phase 24.0 — performance & sync (20k search certified; 50k+ unverified)  
- Phase 30.0 — desktop tables / virtualization  
- Phase 31.0 — inventory module architecture  

**Core question:**

> Can WAKA support small shops through wholesalers adding and managing thousands of products without freezing, degrading search, or losing offline integrity?

---

## Executive Summary

WAKA’s catalog architecture is a **full in-memory + IndexedDB product array** with **indexed text search**, **virtualized inventory/sell lists**, and **local-first create** (`quickAddProduct` → Zustand → debounced entity persist → coalesced cloud push). There is **no product image pipeline**, so image decoding is not a save bottleneck today.

**Strengths**

- Retail / pharmacy wizards with clear step validation (`SimpleAddProductWizard`, `PharmacyAddMedicineWizard`)  
- Sell & inventory DOM scale via `@tanstack/react-virtual`  
- POS/inventory search indexes certified for **~20k SKUs** in CI benchmarks (Phase 24)  
- Offline-first: create succeeds locally; sync is async  

**Weaknesses (enterprise-scale)**

1. **Save is synchronous on the UI thread** — `addProduct` prepends a new full `products[]` array in Zustand.  
2. **Any catalog mutation rebuilds search indexes** and re-renders every full-`products` subscriber (Stock, POS if mounted, etc.).  
3. **Bulk import / starter packs loop `quickAddProduct` sequentially** — N full array copies on the main thread.  
4. **Barcode lookup is O(n)** (`findProductByBarcode`) — no barcode→id map.  
5. **50k+ catalogs unverified**; mid-market certification stops at ≤20k SKUs.

| Business type | Fit |
|---------------|-----|
| Small retail / salon | **Strong** |
| Pharmacy (hundreds–low thousands + medicine fields) | **Good** |
| Hardware / electronics (~1–5k) | **Good** with care on bulk add |
| Supermarket / wholesale (5–20k) | **Conditional** — browse OK; bulk create & stock-tick fan-out risky |
| Warehouse 50k+ SKUs | **Not certified** |

**Overall certification status: CONDITIONALLY CERTIFIED for mid-market catalogs (≤~5–20k SKUs depending on workload). NOT CERTIFIED for warehouse-scale or high-frequency bulk creation without Phase 36.1 work.**

**Freeze recommendation:** Do **not** freeze product-create performance. Phase 36.1 should target **non-blocking save orchestration, incremental indexing, and bulk-create batching** without changing pricing/stock business rules.

---

## Score Table

| Category | Score | Verdict |
|----------|------:|---------|
| Product Creation | **7.0** | Solid wizards; sync save path |
| Save Performance | **6.0** | Local OK for single adds; bulk freezes risk |
| Large Catalog | **6.8** | Virtualization strong; CPU cliffs |
| Search | **7.2** | Indexed text good; barcode linear |
| Categories & Shelves | **6.5** | Usable; count/filter O(n) |
| Sync | **7.0** | Coalesced push; bulk queue pressure |
| Desktop | **7.5** | Virtualized tables |
| Mobile | **6.6** | Wizard OK; native persist lag / memory |
| Offline | **7.5** | Local-first create resilient |
| Scalability | **6.4** | Mid-market yes; 50k+ no |
| Accessibility | **6.5** | Step wizards; long forms |
| **Overall** | **6.8 / 10** | Conditional mid-market |

---

## Certification Methodology

1. Static forensics of create UI → `quickAddProduct` / `addProduct` → persist → sync.  
2. Catalog consumers: StockPage, sell browse engine, inventory virtualizers, barcode path.  
3. Prior Phase 24/30/31 certification thresholds (not re-run as live device lab).  
4. Architecture inference for 100 / 500 / 1k / 5k / 10k (no new Systrace in this phase).  

**Not performed:** Live Android Systrace; heap snapshots at 50k; timed wizard save on production devices.

---

## Workflow Map (product create)

```
Add Product (FAB / ?add=1 / shelf)
  → SimpleAddProductWizard | PharmacyAddMedicineWizard
  → Step validation (name, shelf, price, stock, …)
  → buildProductFromSimpleWizard / pharmacy payload
  → quickAddProduct (permission + validateCanAddProduct + plan caps)
  → addProduct
       • crypto.randomUUID + normalizeProduct
       • Zustand: products = [new, ...products]  ← SYNC UI THREAD
       • optional opening stock movement
       • shelf layout patch
       • void queueRemote("product", { id, isNew: true })
       • audit product_add
  → subscribe → schedulePersist (500ms web / 3500ms native)
       → flushIncrementalPersist → putEntitiesBatch("product")
  → coalesced cloud push (product:{id})
  → StockPage / POS memos rebuild (search index, filters)
```

| Stage | Blocking UI? | Evidence |
|-------|--------------|----------|
| Form entry | No | Controlled inputs |
| Validation | Sync, cheap | `canNext` / `quickAddProduct` |
| Zustand commit | **Yes** | Full array prepend |
| IndexedDB | No (debounced async) | `incrementalPersist` |
| Cloud enqueue | No (`void`) | `queueRemote` |
| Catalog refresh | Indirect | Subscribers + index rebuild |

---

# PART 1 — Product Creation Workflow

| Stage | Status | Notes |
|-------|--------|-------|
| Add Product entry | Strong | FAB, empty state, shelf context, deep link |
| Enter details | Strong | Multi-step retail (8) / pharmacy (3) |
| Category / shelf | Good | `CategoryShelfPicker` choose/existing/new |
| Price / stock | Good | Validated; opening movement if stock &gt; 0 |
| Save | Conditional | Sync store mutation |
| Local commit | Good | Debounced entity persist |
| Cloud queue | Good | Coalesced by product id |
| Catalog refresh | Costly at scale | Full list/index invalidation |

**Product Creation: 7.0 / 10**

---

# PART 2 — Save Performance

| Factor | Finding |
|--------|---------|
| Save latency (single SKU) | Dominated by sync Zustand `set` + React fan-out; IDB not on critical path |
| IndexedDB writes | Debounced; native **3.5s** debounce (Phase 24 P2) |
| Zustand updates | New `products` array every create |
| React renders | StockPage `usePosStore((s) => s.products)` — full page |
| Queue enqueue | Async; coalesce `product:{id}` |
| Cloud sync scheduling | Immediate coalesced push; P2 priority |

**Single-product save:** Usually feels fine on desktop.  
**Bulk N products:** Main-thread risk scales with N × catalog size (array copy + set each time).

**Save Performance: 6.0 / 10**

---

# PART 3 — Large Catalog Performance

Projected from architecture + Phase 24/30 gates (not a new device lab):

| Catalog size | Save (single) | Search | Scroll (inv/sell) | Filter/sort | Shelf browse |
|--------------|---------------|--------|-------------------|-------------|--------------|
| **100** | Excellent | Excellent | Excellent | Excellent | Excellent |
| **500** | Excellent | Excellent | Excellent | Excellent | Excellent |
| **1,000** | Good | Good (certified inv filter) | Excellent | Good | Good |
| **5,000** | Good; bulk bad | Good if index warm | Excellent DOM | Hitch risk | Count rebuild cost |
| **10,000** | OK single; bulk poor | OK; rebuild costly | Excellent DOM | Likely hitch | Filter cost |

DOM virtualization holds through 10k+. **CPU + memory + subscriber fan-out** fail first.

**Large Catalog: 6.8 / 10**

---

# PART 4 — Form Performance

| Control | Finding |
|---------|---------|
| Typing | Standard controlled inputs — fine |
| Category/shelf picker | Maps `options` to choice grid; large shelf lists = long scroll (not virtualized picker) |
| Barcode entry | Text field; match uses linear scan when searching |
| Validation | Per-step; cheap |
| Keyboard | Wizard next/back; desktop forms OK |

**Form Performance (within Product Creation score):** Adequate for typical shelf counts; picker UX degrades if shops create hundreds of shelves.

---

# PART 5 — Image Handling

| Question | Answer |
|----------|--------|
| Product images in model? | **No** (`Product` has no image/thumbnail fields) |
| Upload / decode / thumbs? | **N/A** |
| Impact on save? | **None today** |
| Placeholders? | Category/shelf icons only (`shelfIconFor`) |

Absence of images is a **performance advantage** today and a **feature gap** for visual catalogs later.

---

# PART 6 — Category & Shelf Performance

| Concern | Finding |
|---------|---------|
| Loading options | Derived from products + saved layout + presets |
| Sorting/filtering products by shelf | O(n) over catalog |
| Rendering shelf tiles (Sell) | Masonry **not** virtualized (Phase 32) — OK for tens–hundreds of shelves |
| Large shelf product grids | Virtualized after drill-down |
| Count badges | Full product scan (`buildPosShelfDisplayCards`) |

**Categories & Shelves: 6.5 / 10**

---

# PART 7 — Search Index

| Concern | Finding |
|---------|---------|
| Index type | Haystack strings per product (`buildProductSellSearchIndex` / inventory wrap) |
| Incremental indexing | **No** — rebuild when `products` reference changes |
| After save | Index rebuilds via `useMemo([products])` |
| Barcode / SKU | SKU in haystack; barcode exact via **O(n)** `findProductByBarcode` |
| Latency | Phase 24: 20k indexed filter ~300ms CI |

**Search: 7.2 / 10**

---

# PART 8 — Inventory Synchronization

| Mode | Behavior |
|------|----------|
| Online | Local set → queue → coalesced push → `pushProductCatalogToCloud` |
| Offline | Create succeeds; ops wait in syncQueue |
| Reconnect | Immediate sync scheduler + pull |
| Queue growth | Bulk creates enqueue many `product` ops; coalesce by id helps edits, not N new ids |
| Batching pull | Incremental products page 500; ~20k/session soft cap |
| Duplicate protection | Cloud upsert `onConflict: id`; queue **append** (no hard dedupe of duplicate creates) |
| Kind name | `"product"` — **not** `pending_products` |

**Sync: 7.0 / 10**

---

# PART 9 — Desktop Performance

| Surface | Virtualized? | Notes |
|---------|--------------|-------|
| `EnterpriseInventoryTable` | Yes | Overscan 8; full filtered array in memory |
| Inventory cards/compact | Yes | Always |
| Sell product grid (≥10 / browse panel) | Yes | |
| Count session lines | **No** | Phase 31 debt |

Keyboard: enterprise table selection/keyboard hooks exist (Phase 30). Sort/filter still CPU-bound on full arrays.

**Desktop: 7.5 / 10**

---

# PART 10 — Mobile Performance

| Concern | Finding |
|---------|---------|
| Wizard | Modal/sheet; large touch targets |
| Memory | Full catalog in RAM — pressure rises 5k→10k especially pharmacy metadata |
| Scrolling | Virtualized lists help |
| Keyboard | Soft keyboard + long wizards — acceptable |
| Persist | Native debounce **3.5s** — save feels instant, durability delayed |

**Mobile: 6.6 / 10**

---

# PART 11 — React Rendering

| Hotspot | Evidence |
|---------|----------|
| Full `products` subscription | StockPage, PosPage, dashboards, etc. |
| Search index rebuild | `useMemo(..., [products])` |
| Opening stock on create | Also updates `stockMovements` → more deps |
| Bulk AI / starter | N synchronous `set`s |
| Memoized rows | Virtualizer + memo rows mitigate DOM, not CPU |

**Unnecessary renders:** High blast radius on any stock/catalog write.  
**Virtualization boundaries:** Correct for inventory/sell product DOM; missing for count sessions & shelf masonry.

---

# PART 12 — Database & Store

| Layer | Finding |
|-------|---------|
| Zustand | Full `products: Product[]` always loaded |
| IndexedDB | Entity bucket `"product"`; incremental `diffById` |
| Transaction size | Upserts batch changed entities; not full rewrite every time |
| Normalization | Product records; pharmacy master nested |
| Persistence overhead | Debounced; native slower flush schedule |
| Pagination | **None** for catalog load |

Architecture scales to mid-market; not warehouse-scale without partitioning/paging.

---

# PART 13 — Failure Recovery

| Scenario | Behavior |
|----------|----------|
| App closed mid-save after Zustand set | Debounced persist may lose last ~500ms–3.5s window if killed before flush |
| Offline save | Product in memory + eventually persisted; sync queued |
| Reconnect | Push coalesced |
| Duplicate submit | Wizard “saved” flash; no strong idempotent client token — double-tap can create two SKUs |
| Partial sync | Local remains source until push OK |
| Restart | Hydrate from entity store / snapshot |

**Resilience:** Good offline-first posture; **kill-during-debounce** and **double-submit** are the main integrity UX risks.

**Offline: 7.5 / 10** (create path); durability nuance lowers absolute confidence slightly.

---

# PART 14 — Enterprise Benchmark

| Segment | Suitability |
|---------|-------------|
| Grocery (large SKU) | Conditional — need bulk-create hardening |
| Pharmacy | Good for typical Ugandan pharmacy scale |
| Hardware | Good–conditional |
| Electronics | Good |
| Supermarket | Conditional at 5k+ with frequent stock edits |
| Wholesale | Conditional; 50k+ not ready |

Focus: scalability & workflow — not visual parity with Square/Shopify.

---

# PART 15 — Root Cause Register

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| **RC-1** | **P0** | Product save mutates full `products[]` on UI thread | `addProduct` → `[normalized, ...s.products]` |
| **RC-2** | **P0** | Bulk create = N sequential sync `quickAddProduct` calls | `bulkQuickAddProducts` for-loop |
| **RC-3** | **P0** | Full-catalog Zustand subscriptions fan out on every create/stock write | `usePosStore((s) => s.products)` on Stock/POS/etc. |
| **RC-4** | **P1** | Search index fully rebuilt on products reference change | `buildProductSellSearchIndex` / inventory wrap in `useMemo([products])` |
| **RC-5** | **P1** | Barcode lookup O(n) | `findProductByBarcode` → `.find` |
| **RC-6** | **P1** | Empty-query / “all” still sorts entire catalog | Sell filter pipeline |
| **RC-7** | **P1** | Inventory count session not virtualized | Phase 31 RC |
| **RC-8** | **P1** | Native persist debounce 3.5s — kill window | `persistDebounceMs` |
| **RC-9** | **P2** | No product images (feature gap; perf win) | No fields on `Product` |
| **RC-10** | **P2** | 50k+ catalog unverified | Phase 24 |
| **RC-11** | **P2** | Category picker not virtualized for huge shelf lists | `CategoryShelfPicker` maps options |
| **RC-12** | **P2** | Double-submit can create duplicate products | No client idempotency key |

---

# PART 16 — Improvement Roadmap (Phase 36.1+)

### P0 — Daily operations performance

1. **Batch bulk create** — single Zustand commit for N products (preserve per-row validation).  
2. **Reduce subscriber blast radius** — shallow/selected slices; avoid StockPage full recompute on every add where possible.  
3. **Yield between bulk iterations** (if batch commit deferred) — `yieldUiTick` so UI stays interactive.  
4. **Flush persist on critical create** (or shorter native debounce for product adds) to shrink kill window.

### P1 — Workflow & usability

5. Incremental or dirty-flag search index updates.  
6. `Map` for barcode → productId.  
7. Virtualize inventory count lines; virtualize category picker if options ≫ 100.  
8. Stronger double-submit guard on wizard Save.  
9. Progress UI for bulk AI / starter import.

### P2 — Future enterprise

10. Background indexing worker.  
11. Optional product images with off-main-thread thumbs.  
12. 50k certification suite + memory budgets.  
13. Paged/partial catalog hydration for extreme shops.

### Explicit non-goals for early 36.1

- Do not change selling price / stock math.  
- Do not rewrite cloud sync merge algorithms wholesale.  
- Do not require images for create.

---

## Performance Scorecard (summary)

| Workload | Freeze risk | Notes |
|----------|-------------|-------|
| Add 1 product @ 500 SKUs | Low | |
| Add 1 product @ 5k SKUs | Low–medium | Index + Stock recompute |
| Bulk add 200 @ 5k | **High** | N sync sets |
| Search @ 10k | Low if warm | Rebuild after edits costly |
| Scroll inventory @ 10k | Low | Virtualized |
| Sale stock tick @ 10k with Stock open | Medium | Fan-out |

---

## Desktop / Mobile / Offline / Large Catalog Findings

| Area | Strength | Defect |
|------|----------|--------|
| Desktop | Virtual tables; wizard | Bulk create CPU |
| Mobile | Touch wizard | RAM + native persist delay |
| Offline | Local-first create | Debounce durability window |
| Large catalog | DOM virtualization | Full RAM + sync save + index rebuild |

---

## Accessibility Findings

- Wizard steps and validation banners support guided creation.  
- Long multi-step retail wizard is cognitively heavy but operable.  
- Category grid may be lengthy for SR users with many shelves.  
- No dedicated live region announcing “product saved” beyond visual flash.

**Accessibility: 6.5 / 10**

---

## Regression Risk Assessment (for Phase 36.1)

| Change type | Risk to data integrity |
|-------------|------------------------|
| Batch Zustand commit for bulk | Medium — must preserve validation, movements, audit, queue |
| Selector narrowing | Low if same data |
| Barcode Map | Low |
| Persist flush on add | Low–medium (write amplification) |
| Sync algorithm rewrite | **High — out of scope** |

---

## Freeze Recommendation

| Surface | Freeze? |
|---------|---------|
| Sell UI / EOD wizard presentation | Per prior phases |
| **Product create performance architecture** | **No** |
| Pricing / stock engines | Freeze unless bug |

---

## Success Criteria — Answers

| Question | Answer |
|----------|--------|
| Does adding many products freeze the UI? | **Single adds rarely; bulk/starter/AI loops can.** |
| Does search slow down? | **Steady-state OK to ~20k; rebuild-after-save costs grow with N.** |
| Images block save? | **No — images not implemented.** |
| IndexedDB bottleneck? | **Secondary** (debounced); Zustand/React primary. |
| Sync large catalogs affect UX? | **Pull/merge chunked; create enqueue usually fine; bulk floods queue.** |
| Ready for thousands of products? | **Yes for browse/manage mid-market; conditional for bulk onboarding at 5k+.** |

---

## Manual Certification Checklist (for Phase 36.1 acceptance)

### Create
- [ ] Single add remains &lt;1 perceived second on mid-range phone @ 2k SKUs  
- [ ] Bulk 100 add shows progress and keeps UI interactive  

### Catalog
- [ ] Search remains usable @ 5k / 10k  
- [ ] Inventory scroll stays virtualized  

### Integrity
- [ ] Offline create survives restart after persist  
- [ ] No duplicate on single Save tap  
- [ ] Cloud eventually receives new SKUs  

### Regression
- [ ] Prices / stock / permissions unchanged  

---

*End of Phase 36.0 certification — read-only; no implementation in this phase.*

---

# Phase 36.1 — Product Creation Performance Optimization

**Mode:** Surgical implementation  
**Date:** 2026-08-04  
**Scope:** P0/P1 hotspots from Phase 36.0 — save pipeline, incremental indexing, barcode lookup, bulk create, light subscription hygiene  
**Non-goals preserved:** Product form UX redesign, pricing/stock math, sync merge protocol, schema/migrations, image pipeline

## Before vs after — save pipeline

| Stage | Before (36.0) | After (36.1) |
|-------|---------------|--------------|
| Validate | Sync in wizard + `quickAddProduct` | Unchanged rules via `buildQuickAddProductDraft` |
| Local commit | `addProduct` → full array prepend per SKU | `commitNewProducts` — **one Zustand `set` for N SKUs** |
| Dialog close | Retail immediate after sync commit; pharmacy **+600ms** | Both close **immediately after local commit** |
| Persist | Debounced only | Debounced + **`flushPendingPersist` microtask** after create commit |
| Sync enqueue | Per product `queueRemote("product")` | Same (per id; no protocol change) |
| Search refresh | Full index rebuild on `products` ref change | **Incremental reconcile** (upsert/remove; full rebuild only on large diffs) |

## Incremental indexing strategy

- `reconcileProductSellSearchIndex` / `reconcileInventorySearchIndex` compare previous vs next product object identity.
- Small diffs (typical single create/edit/delete) upsert haystacks + barcode map keys only.
- Large diffs (hydrate / mass rewrite, threshold ~48 or ~12% of catalog) fall back to full `build*SearchIndex`.
- Hooks: `useReconciledProductSellSearchIndex` (Sell browse), `useReconciledInventorySearchIndex` (Stock).

## Bulk creation improvements

- `bulkQuickAddProducts` prepares all drafts, then **one** `commitNewProducts` (opening movements merged once; shelf layout once).
- Order preserved vs legacy N× prepend (last prepared appears first).
- Starter pack apply + onboarding AI starter pack now call the batch API.
- Plan caps still enforced per accepted row inside the batch.

## Barcode lookup optimization

- New `src/lib/productBarcodeIndex.ts`: `code → productId` map, WeakMap-cached per `products[]` identity.
- `findProductByBarcode` uses the cache (O(1) after build).
- Sell/inventory search indexes carry `byBarcode` and keep it updated on reconcile upserts.

## Store subscription optimization

- StockPage bundles `products` / `suppliers` / `stockMovements` / `preferences` via `useShallow` (single subscription equality).
- Primary win remains cheaper post-commit work (batch set + incremental index), not a full store rewrite.

## Responsive verification

| Check | Result |
|-------|--------|
| `npm run build` | Pass |
| Focused unit tests (barcode, reconcile, bulk, pharmacy quick-add, inventory query, sell search benches) | Pass |
| `npm test` | **1786 passed**; 1 unrelated failure: `pharmacyPatientProfile` age-from-DOB expectation (timezone/date fixture — not in Phase 36.1 touch set) |

## Regression summary

| Area | Status |
|------|--------|
| Product schema | Unchanged |
| Pricing / inventory calculations | Unchanged |
| Sync kind/payload shape (`product` + `{ id, isNew }`) | Unchanged |
| Offline local-first create | Preserved (+ earlier persist flush) |
| Desktop virtualization / sort / keyboard | Untouched surfaces |
| Mobile wizard steps / validation rules | Untouched (close timing only on pharmacy) |

## Manual certification (still recommended on device)

### Product Creation
- [ ] Add 100 products consecutively — no UI freeze
- [ ] Dialog closes immediately after save
- [ ] Typing remains responsive

### Large Catalog
- [ ] 5,000 products searchable
- [ ] Filters / category / shelf browse remain smooth

### Bulk Creation
- [ ] Quick Add / starter / AI bulk no longer blocks for N commits
- [ ] Search updates correctly after bulk
- [ ] Sync queue receives one op per new id

### Desktop / Mobile
- [ ] Inventory table updates without visible lag
- [ ] Sorting / keyboard unchanged
- [ ] Soft keyboard + repeated saves stay smooth

## Phase 36.1 outcome

Product creation is no longer dominated by **N synchronous catalog commits** or **full search rebuilds on every add**. Barcode resolve is map-backed. Inventory business rules and sync integrity paths were not rewritten — only scheduling, batching, and index maintenance were optimized toward mid-market (5k–20k SKU) responsiveness.

*End of Phase 36.1 implementation notes.*


# Phase 31.0 — Enterprise Inventory Module Architecture, UX & Workflow Certification

**Mode:** Read-only forensic audit (**NO code changes, NO CSS changes, NO SQL, NO migrations, NO dependency updates**)  
**Date:** 2026-08-03  
**Scope:** Entire Inventory / Purchasing domain surface — architecture, UX, workflows, design-system adoption, responsive + desktop/tablet/mobile, dialogs, navigation, duplication, performance, accessibility  

**Related prior work (do not re-litigate as substitutes for this audit):**  
- Phase 27.x — Inventory **mobile usability**  
- Phase 29.x — Global visual language / theme  
- Phase 30.x — Cross-app **desktop tables**; Inventory products already table-first ≥1024  

This audit asks a different question:

> Is the **whole Inventory module** architecturally coherent and enterprise-consistent — or a collage of early UI, operation shells, and new primitives?

---

## Executive Summary

Inventory is one of WAKA’s largest domains (~**147** UI files across `stock` / `inventory` / `features/inventory*` plus 9 pages). It already contains **world-class islands**:

- Purchasing hub with `EnterprisePageHeader` / `WakaButton`  
- Product list **view engine** (compact → card → table)  
- Selection / bulk / keyboard productivity on products  
- Phase 30.1 `EnterpriseDataTable` consumer for desktop products  
- Workspace KPIs via `EnterpriseKpiCard`  

It is **not certified as a unified enterprise inventory module** because:

1. **Dual hubs / dual tab systems** — `InventoryPurchasingPage` tabs + embedded `StockPage` section tabs both expose overview/products.  
2. **Design-system partial migration** — enterprise shell over legacy guts (`font-black` **223** hits, `rounded-2xl` **131**, `bg-waka-600` **21** in inventory paths).  
3. **Dialog stack fragmentation** — `ModalSheet` + `AppModalOverlay` shells + `ConfirmationDialog` + action sheets for the same domain.  
4. **Parallel receive paths** — multi-line purchase vs single-product restock.  
5. **Dead / gated surface area** — unused `OverviewTab`, `InventoryHeroCard`, `VirtualizedStockProductList`; transfer UI built but `INVENTORY_TRANSFER_ENABLED=false`.  
6. **Incomplete table coverage** — products/purchases/suppliers ahead; count, shelves, movements, reports still card/panel-first.  
7. **Categories are shelves**, not a first-class admin module.  

| Category | Score |
|----------|------:|
| Architecture | **6.2** |
| Workflow | **6.5** |
| Mobile UX | **7.4** |
| Tablet UX | **6.8** |
| Desktop UX | **7.1** |
| Design System Adoption | **5.0** |
| Tables | **7.0** |
| Dialogs | **5.4** |
| Performance | **6.6** |
| Accessibility | **5.8** |
| **Overall** | **6.4 / 10** |

**Verdict:** Inventory is **production-capable and partially enterprise-grade**, especially products + purchasing hub. It is **not** yet a single cohesive enterprise inventory system. Phase 31.1 should be a **consolidation phase** (architecture + dialogs + DS adoption), not another isolated UI patch.

---

## Success Criteria — Answers

| Question | Answer |
|----------|--------|
| Every remaining UI issue? | Dual navigation, DS debt, dialog fragmentation, parallel receive, orphan UI, incomplete tables outside products, header inconsistency, a11y gaps. |
| Legacy components to consolidate? | Operation shells’ visual chrome, purchase/count pills, multiple search/filter bars, StatCard variants, ModalSheet vs AppModalOverlay mix. |
| Workflow friction? | Nested purchase sheet→page; remove uses ModalSheet not ConfirmationDialog; count is deep + card-only; categories lack admin surface. |
| Design system gaps? | Low `enterpriseType` / `enterpriseSpace` / `EnterpriseCard` / `WakaButton` outside hub products; heavy `font-black` / ad-hoc cards. |
| Desktop/mobile still needing work? | Desktop: count/shelves/movements/reports; Mobile: sticky chrome already tuned (Phase 27) but purchase CTAs still legacy. |
| Smallest plan to world-class? | See P0–P3 roadmap — unify navigation, consolidate dialogs, finish DS on high-traffic tabs, table-ize count on desktop, delete orphans. |

---

# PART 1 — Inventory Folder Architecture

## Logical tree

```text
Inventory / Purchasing
├── Hub entry: InventoryPurchasingPage  (/stock, /pharmacy/inventory)
│   ├── overview → InventoryWorkspaceOverview
│   │   ├── InventoryDashboardCards (EnterpriseKpiCard)
│   │   ├── InventoryQuickActions / InventoryNavigationTiles
│   │   └── StockAdjustmentSheet
│   ├── purchases → PurchasesTab (+ PurchasesDesktopTable @ ≥1024)
│   │   ├── NewPurchaseSheet → RestockPage (embedded)
│   │   └── PurchaseDetailSheet → PurchaseDetailPage
│   ├── suppliers → SuppliersTab (EnterpriseResponsiveTable)
│   │   └── SupplierDetailSheet → SupplierDetailPage
│   ├── products → StockPage (workspaceEmbed)
│   │   ├── StockSectionTabs: overview | products | shelves | low | movements
│   │   ├── View engine: compact / card / table
│   │   ├── Selection + bulk + keyboard
│   │   └── Dialogs: add / edit / remove / restock / detail / AI / pharmacy batch
│   └── payments → PaymentsTab (EnterpriseResponsiveTable)
├── Count
│   ├── /stock/count → InventoryCountSessionsPage
│   └── /stock/count/:sessionId → InventoryCountSessionPage
├── Reports (pharmacy)
│   └── /pharmacy/reports/inventory → PharmacyInventoryReportsPage
├── Legacy redirects
│   └── /inventory, /suppliers, /restock, /office/purchases*, /stock/transfer→/stock
└── Gated / orphan
    └── InventoryTransferPage + transfers/* (INVENTORY_TRANSFER_ENABLED=false)
```

## File corpus (non-test, approx.)

| Area | Files |
|------|------:|
| `src/components/stock` | **47** |
| `src/components/inventory` | **63** |
| `src/features/inventory` | **25** |
| `src/features/inventory-purchasing` | **12** |
| Pages (stock/inventory/purchase/supplier/count/reports/transfer) | **9** |
| Related libs (`inventory*`, `purchase*`, `stock*`, categories, selling) | **~40** |

## Classification

| Class | Examples |
|-------|----------|
| **Pages / routes** | `InventoryPurchasingPage`, count pages, pharmacy inventory reports; embedded `StockPage`, `RestockPage`, detail pages |
| **Dialogs / sheets** | ModalSheet purchase/supplier/product detail; AppModalOverlay wizard/editor/receive/adjust/count shells; ConfirmationDialog count approval |
| **Reusable enterprise** | `EnterpriseKpiCard` dashboard, `EnterpriseDataTable` products, ERT suppliers/payments, `WakaButton` hub |
| **Legacy / ad-hoc** | `StockSectionTabs` pills, PurchasesTab cards/CTAs, count cards, pharmacy report tiles |
| **Orphan / dead** | `OverviewTab.tsx`, `InventoryHeroCard.tsx`, `VirtualizedStockProductList.tsx` |

---

# PART 2 — Design System Adoption

## Metrics (inventory-related paths only)

| Primitive | Files | Hits | Verdict |
|-----------|------:|-----:|---------|
| `EnterprisePageContainer` | 8 | 26 | Strong on hub |
| `EnterprisePageHeader` | 3 | 7 | Hub/stock only; count still `PageHeader` |
| `EnterpriseCard` | 1 | 7 | Underused |
| `EnterpriseKpiCard` | 5 | 28 | Dashboard + some grids |
| `EnterpriseResponsiveTable` | 2 | 4 | Suppliers / payments |
| `EnterpriseDataTable` | 2 | 5 | Products (+ purchasing desktop table stack) |
| `WakaButton` | 6 | 80 | Concentrated; many raw CTAs remain |
| `enterpriseTypeClass` | 2 | 4 | Weak |
| `enterpriseSpace` | 1 | 3 | Weak |
| `statusTokens` | 4 | 15 | Partial |
| `ModalSheet` | 8 | 32 | Common |
| `ConfirmationDialog` | 2 | 6 | Rare |
| `AppModalOverlay` | 9 | 27 | Operation shells dominant |

## Legacy residue (same paths)

| Pattern | Files | Hits |
|---------|------:|-----:|
| `font-black` | 77 | **223** |
| `bg-waka-600` | 16 | **21** |
| Ad-hoc `rounded-2xl` shells | ~69 | **~131** |

## Remaining legacy components (high priority)

- `StockSectionTabs` — pill chrome, not enterprise segmented control  
- `PurchasesTab` — raw buttons / status chips / mobile cards  
- Count session UI — `CountProductCard`, `PageHeader`, window.alert errors  
- Pharmacy inventory reports — ad-hoc tiles, weak page chrome  
- Operation shells’ typography (`font-black`) vs Phase 29.1 `font-bold` roles  
- Multiple search inputs without shared `EnterpriseListToolbar`

**Adoption score: 5.0 / 10** — architecture primitives exist; majority of leaf UI still pre-system.

---

# PART 3 — Workflow Certification

| Workflow | Path | Depth | Friction |
|----------|------|------:|----------|
| **Add Product** | Hub → Products → FAB/CTA → retail/pharmacy wizard | 2–3 | Mode fork; plan locks; multi-step OK |
| **Edit Product** | Row/detail → Edit → `ProductEditorShell` | 2–3 | Long form; pharmacy density |
| **Delete Product** | More → Remove → ModalSheet + reason | 3 | Not ConfirmationDialog; audit reason required |
| **Receive (PO)** | Overview/Purchases → NewPurchaseSheet → RestockPage | 2 | Nested sheet + page-scale form |
| **Receive (SKU)** | Product → Restock modal | 2 | Parallel UX to PO receive |
| **Adjustment** | Overview Adjust / quick ± | 1–2 | Count reason blocked (correct); ConfirmDialog unused here |
| **Inventory Count** | Tile → `/stock/count` → session | 2–3+N | Card lines; deep; approve dialog OK |
| **Suppliers** | Hub tab → table/detail sheets | 1–2 | Strongest entity tab after products |
| **Purchases** | Hub tab → cards/table → detail | 1–2 | Mobile cards; desktop table (30.1) |
| **Categories** | Shelves tab / CategoryShelfPicker | 2 | No dedicated category admin |
| **Units** | Inside add/edit sections | — | Embedded, not a module |
| **Reports** | Pharmacy reports route / retail → `/reports` | 1–2 | Split by business mode |

**Workflow score: 6.5 / 10** — core paths work; navigation depth and dual receive create avoidable cognitive load.

---

# PART 4 — Dialog Audit

| Dialog / shell | Overlay | Keyboard / footer / scroll | Should become |
|----------------|---------|----------------------------|---------------|
| Product wizards / editor | `AppModalOverlay` + shells | Sticky header/footer outside scroll — **good pattern** | Keep; visual DS pass |
| Receive / Adjust shells | `AppModalOverlay` | Footer outside scroll | Keep; unify tokens |
| Count modal shell | `AppModalOverlay` | Page variant for sessions | Prefer ConfirmationDialog for destructive |
| `NewPurchaseSheet` | `ModalSheet` → embeds `RestockPage` | **Highest risk** nested scroll | Flatten or full-page route |
| Purchase/Supplier detail | `ModalSheet` | Thin wrappers | Keep |
| Remove product | `ModalSheet` | Manual footer | **ConfirmationDialog** |
| Count approval | `ConfirmationDialog` | Correct | Keep |
| `AdjustmentConfirmDialog` | `ConfirmationDialog` | Used outside stock hub primarily | Wire consistently |
| Product action menu | `EnterpriseActionSheet` | OK | Keep |
| AI assist / bulk AI | `AppModalOverlay` | Dense | Keep |

**Dialog score: 5.4 / 10** — shells are thoughtful; **three overlay systems** + nested purchase sheet block certification.

---

# PART 5 — Responsive Audit (code-forensic)

Breakpoints: 320–412 phone · 768 tablet · 1024+ desktop (`responsiveBreakpoints.ts`).

| Viewport | Expected / observed patterns |
|----------|------------------------------|
| **320–412** | Compact product list; non-sticky stock chrome on phone (Phase 27.1 intentional); hub sticky tabs; FAB/control-bar CTAs |
| **768** | Auto **card** product view; purchases still cards; filters denser |
| **1024+** | Auto **table** products; purchases desktop table; suppliers ERT |
| Risks | Purchase nested sheet height; table quick actions 32px; filter chip overflow on narrow; count cards don’t densify |

**Known intentional mobile choices:** Stock products chrome is **not** sticky on phone to preserve vertical space (`StockPage` comments). Hub tabs remain sticky.

No live device lab in this audit — findings are **code-path forensics**. Manual matrix (320/360/390/412/768/1024/1440) remains required for Phase 31.1 QA.

---

# PART 6 — Desktop Workspace

| Page / surface | Should use | Today | Productivity |
|----------------|------------|-------|--------------|
| Products | Table | **Table** (auto ≥1024) | High |
| Purchases | Table | **Table** desktop / cards mobile | High / med |
| Suppliers | Table | **ERT** | Med–high |
| Payments | Table | **ERT** | Med |
| Count session | Table or hybrid | **Cards only** | Low |
| Shelves | Hybrid grid | Grid | Med |
| Movements | Table | Panel/list | Med |
| Overview | Cards / KPIs | Cards + KPIs | Appropriate |
| Pharmacy reports | Cards + table details | Tiles | Med |

**Desktop UX score: 7.1 / 10** — products/purchases lead the app; count/shelves/movements lag Phase 30.1 standard.

---

# PART 7 — Navigation

```text
Office / Home / Pharmacy nav
        ↓
InventoryPurchasingPage  (overview | purchases | suppliers | products | payments)
        ↓ (products)
   StockPage embed       (overview | products | shelves | low | movements)
        ↓
   Count (/stock/count) · Reports (pharmacy) · Sheets (purchase/supplier/product)
```

| Finding | Impact |
|---------|--------|
| Two “overview” concepts | Users may not know which overview is canonical |
| Categories tile → shelves | Label mismatch vs mental model |
| Transfer in tiles when enabled flag false | Dead end risk if flag flipped without polish |
| Back: hub Enterprise back to Office; count uses legacy PageHeader | Inconsistent chrome |
| Deep links (`?tab=`, `stockView=`, `new=1`) | Powerful but many surface combinations |

**Navigation intuitiveness: mixed** — power users OK; new operators face hub-in-hub.

---

# PART 8 — Component Duplication

| Pattern | Duplicates | Consolidation target |
|---------|------------|----------------------|
| KPI / stats | DashboardCards, InventoryStatGrid, orphan OverviewTab StatCard, pharmacy report tiles, unused HeroCard | `EnterpriseKpiCard` only |
| Search | PinnedSearch, ProductsControlBar, FilterBar, InventorySearchBar, CountSearchBar, raw purchase/supplier inputs | `EnterpriseListToolbar` |
| Filter chips | Section tabs, purchase status, supplier alpha, advanced filters, date chips | Shared chip recipe + statusTokens |
| Product rows | StockProductCard, UnifiedProductRow, table cells, dead VirtualizedStockProductList | View engine only |
| Toolbars | StockListToolbar, ProductsControlBar, BulkToolbar, SelectionToolbar | One productivity chrome |
| Empty states | EnterpriseEmptyState vs dashed `<p>` vs EmptyShelfPanel | `EnterpriseEmptyState` |
| Receive | RestockPage vs SimpleProductRestockModal | Shared receive engine, two entry intents documented |

---

# PART 9 — Performance

| Signal | Status |
|--------|--------|
| Product compact/card virtualization | **Yes** (`InventoryProductList`) |
| Product desktop table virtualization | **Yes** (`EnterpriseDataTable` via `EnterpriseInventoryTable`) |
| Count session virtualization | **No** — maps filtered lines to cards |
| Selection engine | ID-set based; virtualization-safe |
| Deferred list React APIs | Not used on inventory lists |
| Hard caps | Restock picker `slice(0, 80)`; label/export slices (~50) |
| Auto group-by category | Only when `12 < n ≤ 250` |
| Dead virtualizer | `VirtualizedStockProductList` unused |
| Hub overview stats | Full-array recomputes — watch large shops |

**Performance score: 6.6 / 10** — products path is solid; count + hub aggregates are the cliffs.

---

# PART 10 — Accessibility

| Area | Finding |
|------|---------|
| Touch targets | Many 40–44px; table quick actions **32px** |
| Contrast | Relies on Phase 29.1 tokens where adopted; legacy emerald/rose chips remain in places |
| Typography | `font-black` still dominant vs enterprise roles |
| Keyboard | Product table + inventory shortcuts strong; count/purchases weak |
| Semantics | Shells often have `aria-modal` / labels; purchase search often unlabeled |
| Focus order | Overlay shells generally OK; nested purchase sheet riskier |

**Accessibility score: 5.8 / 10**

---

# PART 11 — Enterprise Benchmark (workflows only)

Compared to Shopify Admin, Zoho Inventory, Lightspeed, Dynamics 365 BC, Odoo Inventory — **workflows**, not UI clones:

| Expectation | Industry norm | WAKA Inventory |
|-------------|---------------|----------------|
| Single inventory home | One hub | Dual tab layers |
| Product grid/table + bulk | Standard | **Met** (products) |
| PO / receive pipeline | Clear purchase → receive | Split PO vs SKU restock |
| Cycle count | Dedicated dense UI | Present but card-heavy |
| Supplier master | Tabular | **Met** (ERT) |
| Category admin | First-class | Shelves / free-text only |
| Transfer between locations | Common in mid-market | Built, **disabled** |
| Consistent dialogs | Confirm patterns | Fragmented |

WAKA is competitive on **product catalog operations** for SMB retail/pharmacy. It trails on **module coherence** and **count/category/transfer completeness**.

---

# PART 12 — Root Cause Register

| ID | Finding | Severity | Evidence |
|----|---------|----------|----------|
| **RC-1** | Dual hub / dual tab systems | **P0** | `InventoryPurchasingPage` + embedded `StockPage` / `StockSectionTabs` |
| **RC-2** | Design-system partial migration | **P0** | 223× `font-black`, 21× `bg-waka-600`, weak `enterpriseSpace`/`enterpriseType` |
| **RC-3** | Dialog stack fragmentation | **P0** | ModalSheet + AppModalOverlay + ConfirmationDialog; nested `NewPurchaseSheet`→`RestockPage` |
| **RC-4** | Parallel receive / restock surfaces | **P1** | `NewPurchaseSheet` vs `SimpleProductRestockModal` |
| **RC-5** | Dead / orphan / gated UI | **P1** | `OverviewTab`, `InventoryHeroCard`, `VirtualizedStockProductList`; `INVENTORY_TRANSFER_ENABLED=false` |
| **RC-6** | Incomplete desktop tables outside products | **P1** | Count/shelves/movements/reports card-first |
| **RC-7** | Count performance & density cliff | **P1** | Non-virtualized `CountProductCard` lists |
| **RC-8** | Categories not first-class | **P2** | Shelves deep-link; `CategoryShelfPicker` free-text |
| **RC-9** | Header/back inconsistency | **P2** | Count/restock still `PageHeader` |
| **RC-10** | Accessibility uneven (32px actions, unlabeled search) | **P2** | Table actions; PurchasesTab inputs |

---

# PART 13 — Enterprise Inventory Maturity Score

| Category | Score | Notes |
|----------|------:|-------|
| Architecture | **6.2** | Powerful but dual-hub / orphans |
| Workflow | **6.5** | Works; receive + count friction |
| Mobile UX | **7.4** | Phase 27 strength |
| Tablet UX | **6.8** | Card defaults OK; less specialized |
| Desktop UX | **7.1** | Products/purchases strong |
| Design System Adoption | **5.0** | Shell yes, leaves no |
| Tables | **7.0** | Products lead; count lags |
| Dialogs | **5.4** | Three systems |
| Performance | **6.6** | Products virtualized; count not |
| Accessibility | **5.8** | Partial |
| **Overall** | **6.4 / 10** | **Not certified** as unified enterprise inventory |

### Target after Phase 31.1 consolidation

| Category | Target |
|----------|-------:|
| Architecture | **8.5+** |
| Design System Adoption | **8.5+** |
| Dialogs | **8.5+** |
| Desktop UX | **8.8+** |
| Overall | **≈ 8.4–8.8 / 10** |

---

# PART 14 — Implementation Roadmap

## P0 — Critical coherence blockers

1. **Unify navigation IA** — one overview story; clarify products embed vs purchasing tabs (collapse or clearly nest).  
2. **Dialog policy** — destructive → `ConfirmationDialog`; page-scale create → route or single shell (flatten `NewPurchaseSheet`→`RestockPage`).  
3. **Design-system pass on high-traffic leaves** — PurchasesTab, StockSectionTabs, count headers → `WakaButton` / type roles / statusTokens.  
4. **Remove or quarantine orphans** — `OverviewTab`, `InventoryHeroCard`, unused virtualizer (or wire deliberately).

## P1 — Architecture cleanup

1. Document dual receive intents (PO vs SKU) with shared chrome.  
2. Desktop table for **count session** lines (Phase 30.1 platform).  
3. Promote suppliers ERT → `EnterpriseDataTable` when sort/bulk needed.  
4. Standardize all inventory pages on `EnterprisePageHeader` + `EnterprisePageContainer`.  
5. Consolidate search/filter into `EnterpriseListToolbar` recipes.

## P2 — Visual consistency

1. Eradicate remaining `font-black` / `bg-waka-600` in inventory paths.  
2. `enterpriseSpace` rhythm on overview + count.  
3. Empty states → `EnterpriseEmptyState` everywhere.  
4. Table action targets ≥40px; aria-labels on search fields.

## P3 — Future enhancements

1. First-class Categories admin (optional).  
2. Enable Transfer only with full DS + desktop table certification.  
3. Deferred querying / windowing for 50k SKU shops.  
4. Inventory reports parity retail ↔ pharmacy.

---

## Before / after architecture (target)

### Before (today)

```text
Office → Purchasing Hub (5 tabs)
              └─ products embed → StockPage (5 section tabs)
              └─ sheets → RestockPage / details
         → /stock/count (separate chrome)
         → orphans / gated transfer
```

### After (Phase 31.1 target)

```text
Office → Inventory Workspace (single IA)
              ├─ Overview (KPIs + quick actions)
              ├─ Products (view engine + EnterpriseDataTable)
              ├─ Purchases / Suppliers / Payments (shared table platform)
              ├─ Count (desktop table / mobile cards)
              └─ One dialog policy (ModalSheet | Confirmation | OperationShell)
         Dead code removed · Transfer optional certified module
```

---

## Appendix A — Key files

| File | Role |
|------|------|
| `src/pages/InventoryPurchasingPage.tsx` | Canonical hub |
| `src/pages/StockPage.tsx` | Products embed + dialogs |
| `src/features/inventory/viewEngine/*` | View modes + table |
| `src/features/inventory/selection/*` | Bulk selection |
| `src/features/inventory-purchasing/components/*` | Tabs, purchases, suppliers |
| `src/components/inventory/{count,receive,adjustments,transfers,workspace}/*` | Operation domains |
| `src/components/stock/*` | Product UI, wizards, shelves |
| `src/lib/inventoryWorkspaceTiles.ts` | Nav tiles + transfer flag |

## Appendix B — Adoption snapshot (2026-08-03)

| Metric | Value |
|--------|------:|
| Inventory UI files (stock+inventory+features) | **~147** |
| `font-black` hits (inventory paths) | **223** |
| `WakaButton` files | **6** |
| `EnterpriseDataTable` files | **2** |
| Orphan OverviewTab / HeroCard / VirtualizedStockProductList | **Present unused** |
| Transfer feature flag | **false** |

## Appendix C — What this audit is not

- Not a re-run of Phase 27 mobile-only inventory UX  
- Not a re-run of Phase 30 cross-app desktop tables  
- Not permission to redesign brand or copy Shopify/Zoho layouts  
- Not an instruction to enable Transfer without a dedicated certification  

---

**Certified by:** Phase 31.0 Enterprise Inventory Module Architecture, UX & Workflow read-only forensic audit — 2026-08-03  

**Decision:** Inventory is a **powerful multi-surface domain with enterprise footholds** (products table, hub KPIs, suppliers table). It is **not certified** as a single cohesive enterprise inventory module due to dual navigation, design-system debt, dialog fragmentation, and incomplete submodule parity.

**Recommended next step:** **Phase 31.1 — Inventory Module Consolidation** — unify IA, enforce one dialog policy, finish DS adoption on purchases/count/tabs, desktop-table count, delete orphans — preserving mobile card excellence and product desktop tables already shipped.

---

## Phase 31.1 Inventory Consolidation

**Mode:** Surgical implementation (presentation + architecture only)  
**Date:** 2026-08-03  
**Scope:** Consolidate Inventory into one coherent enterprise module — no new inventory features, no stock/purchase/sync/DB/API logic changes.

### Before / after architecture

#### Before (Phase 31.0)

```text
Office → Purchasing Hub (5 tabs)
              └─ products embed → StockPage (5 section tabs incl. overview)
              └─ NewPurchaseSheet (ModalSheet) → RestockPage
         → /stock/count (PageHeader + cards only)
         → AppModalOverlay shells + ModalSheet + ConfirmationDialog
         → Orphans: OverviewTab, InventoryHeroCard, VirtualizedStockProductList
```

#### After (Phase 31.1)

```text
Office → Inventory Hub (single IA)
              ├─ Overview (KPIs + quick actions ≤2 taps)
              ├─ Purchases (inline RestockPage when ?new=1 — no nested sheet)
              ├─ Suppliers / Payments
              ├─ Products embed → StockPage (no nested overview; shelves/products/low/movements)
              ├─ Count (desktop EnterpriseDataTable / mobile cards)
              └─ Dialog policy: ModalSheet (complex) | ConfirmationDialog (simple)
         Orphans removed · NewPurchaseSheet deleted · Shared receive chrome
```

### Navigation simplification

| Entry | Path |
|-------|------|
| One Inventory Hub | `InventoryPurchasingPage` (`/stock`, `/pharmacy/inventory`) |
| Purchasing | Hub tab `purchases` |
| Stock / products | Hub tab `products` → embedded `StockPage` (overview tab hidden) |
| Shelves / low / movements | ≤2 taps: Products → section tab |
| Receive | Hub CTA or Purchases → `?tab=purchases&new=1` → inline `RestockPage` |
| Count | Hub nav tile → `/stock/count` |
| Reports (pharmacy) | Extension tile → pharmacy inventory reports (enterprise header + tables) |
| Suppliers / categories (shelves) | Hub suppliers tab; shelves under Products |

Users reach major workflows in **≤2 taps** from the hub overview (quick actions + nav tiles + primary tabs).

### Dialog consolidation

**Policy** (`src/components/inventory/inventoryDialogPolicy.ts`):

- **ModalSheet** — complex workflows (receive, adjust, product wizard/editor, count modal variant, transfer, AI assist, bulk ops)
- **ConfirmationDialog** — simple confirmations
- **Forbidden in inventory feature code:** direct `AppModalOverlay` import

Migrated to ModalSheet:

- Operation shells: receive, adjust, product wizard/editor, count, transfer
- `AiProductAssistSheet`, `BulkInventoryAiModal`, `InventoryBulkToolbar` bulk sheets

`ModalSheet` may still wrap `AppModalOverlay` internally (platform primitive). Inventory code no longer imports the overlay directly.

### Receive workflow unification

Documented in `src/components/inventory/receive/receiveWorkflow.ts`:

| Entry point | Surface | Shared stack |
|-------------|---------|--------------|
| Purchase / multi-line | `RestockPage` (inline on hub) | `ReceiveOperationShell` → validation / totals / stock update / audit |
| Quick SKU restock | `SimpleProductRestockModal` | Same shell + confirmation chrome |

Only entry point and line cardinality differ. Nested purchase sheet→page removed (`NewPurchaseSheet` deleted).

### Desktop completion

| Area | Desktop (≥1024) | Mobile |
|------|-----------------|--------|
| Products | Existing `EnterpriseDataTable` | Cards |
| Purchases / Suppliers | Existing tables | Cards |
| Inventory Count | `CountDesktopTable` | `CountProductCard` |
| Shelves | `ShelvesDesktopTable` | Folder grid |
| Pharmacy inventory reports | KPI + list tables | KPI + list cards |

### Legacy component removal

| Component | Action |
|-----------|--------|
| `OverviewTab` | Deleted (orphan) |
| `InventoryHeroCard` | Deleted (orphan) |
| `VirtualizedStockProductList` | Deleted (orphan) |
| `NewPurchaseSheet` | Deleted (replaced by inline `RestockPage`) |

### Design system adoption (delta)

- Hub + stock section tabs: `bg-primary` / `font-bold` / `shadow-elev`
- Count + pharmacy reports: `EnterprisePageHeader`
- Purchases CTAs / exports: `WakaButton` + `statusTokens`
- Pharmacy reports: `EnterpriseKpiCard`, `EnterpriseCard`, `EnterpriseDataTable`
- Inventory dialogs: ModalSheet policy enforced
- Remaining debt: residual `font-black` in older stock cards/wizards; movements still panel-first; transfer UI gated (`INVENTORY_TRANSFER_ENABLED=false`)

### Remaining technical debt (post-31.1)

1. Gradual `font-black` → `font-bold` / `enterpriseType` on older product wizard steps (non-blocking).
2. Stock movements desktop table (optional P2).
3. First-class Categories admin (still shelves-as-categories).
4. Transfer module certification before enablement.
5. Deeper a11y pass on dense table cells (labels already present on count inputs).

### Success criteria — status

| Criterion | Status |
|-----------|--------|
| Single cohesive Inventory module | **Met** — one hub IA, no nested overview hub |
| One clear entry + interaction model per workflow | **Met** for receive / dialogs / nav |
| Full enterprise DS + dialog policy | **Met** for high-traffic paths; residual typography debt noted |
| Desktop tables / mobile cards without logic duplication | **Met** for count, shelves, pharmacy reports |
| Legacy / duplicate nav removed | **Met** |

**Verdict:** Inventory is **architecturally complete** for enterprise consolidation. Future Inventory work should be feature additions or incremental refinements, not another large-scale cleanup phase.

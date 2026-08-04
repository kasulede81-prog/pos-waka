# Phase 30.0 — Enterprise Desktop Workspace & Data Table Certification

**Mode:** Read-only forensic audit (**NO code changes, NO CSS changes, NO SQL, NO migrations, NO dependency updates**)  
**Date:** 2026-08-03  
**Scope:** Desktop productivity across WAKA POS — tables vs cards, widescreen utilization, bulk/keyboard workflows, large-dataset readiness  
**Related prior work:**  
- Phase 22.x — design system / `EnterpriseResponsiveTable` introduction  
- Phase 27.x–28.x — POS desktop sell density (`PosDesktop*`, wide checkout)  
- Phase 29.x — theme + visual language (mobile-enterprise calm; **not** desktop data-grid certification)  

This audit asks a different question than Phase 29:

> Does WAKA on a 24-inch monitor feel like enterprise **desktop software**, or like a well-polished **mobile app stretched wide**?

---

## Executive Summary

WAKA’s **POS sell surface** and **inventory product list** already demonstrate real desktop intent. Almost every other **entity-browse** module (customers, purchases, sales history, staff, devices) still presents **mobile/card lists on large screens**.

The shared table primitive `EnterpriseResponsiveTable` is a **responsive presentation shell** (sticky header + mobile card flip). It is **not** an enterprise data grid: no sort API, no filter API, no bulk selection, no virtualization, no pagination, no keyboard row navigation.

| Dimension | Score | Verdict |
|-----------|------:|---------|
| Desktop productivity (entity work) | **5.4 / 10** | Inventory yes; most modules no |
| Table adoption | **3.8 / 10** | 3 production `EnterpriseResponsiveTable` call sites |
| Information density | **5.1 / 10** | Inventory dense; cards waste vertical space elsewhere |
| Keyboard productivity | **3.2 / 10** | No row-grid keyboard model outside POS habits |
| Responsive desktop quality | **5.8 / 10** | Breakpoints exist; many layouts only stretch |
| Large-dataset readiness (UI) | **6.0 / 10** | Virtualization in key lists; shared table has none |
| **Overall desktop workspace** | **5.2 / 10** | **Not certified** as enterprise desktop |

**Bottom line:** Mobile excellence is real. Desktop enterprise completeness is not. The gap is **adoption + capability of table workspaces**, not inventing a new brand system.

**Reference desktop for the product:** `EnterpriseInventoryTable` (sort, bulk select, sticky header, `@tanstack/react-virtual`, auto-enabled at ≥1024px). Phase 30.1 should generalize that pattern — not copy Square/Shopify/Lightspeed layouts.

---

## Success Criteria — Answers

| Question | Answer |
|----------|--------|
| Which desktop screens should use tables instead of cards? | Customers, Purchases, Sales History, Staff, Devices; optionally Pharmacy patients directory. Inventory already tables on desktop. Suppliers / payments / cash expenses already tabled. |
| Are desktop users losing productivity to mobile-first layouts? | **Yes** — card rows dominate entity browse; widescreen underused; bulk ops rare outside inventory. |
| How much is `EnterpriseResponsiveTable` used? | **3** business JSX sites (+ 4 deprecated `ResponsiveDataTable` wrappers, mostly admin/diagnostics). |
| Where is widescreen wasted? | Oversized card lists; KPI/dashboard packing is fine; entity modules lack multi-column data density. |
| Minimum path to “true desktop enterprise”? | Promote inventory table capabilities into a shared desktop data-grid primitive; migrate P0 entity modules; keep mobile cards via responsive flip. |

---

# PART 1 — Desktop Workspace Inventory

Canonical bands (`src/lib/responsiveBreakpoints.ts`):

| Band | Width |
|------|------:|
| Mobile | ≤767 |
| Tablet | 768–1023 |
| Desktop | ≥1024 |
| POS wide / ultra | 1280 / 1920+ |

| Module | Primary browse / work UI | Desktop layout | Cards / Tables / Lists / Mixed |
|--------|--------------------------|----------------|--------------------------------|
| **Home** | Tile launcher (`DesktopHomePage` path) | Full-width tiles | Cards / tiles |
| **Inventory / Products** | `InventoryProductList` → auto **table** on desktop | Dense virtualized table | **Mixed** (table default ≥1024) |
| **Customers** | `VirtualizedCustomerDebtList` → `DebtCustomerCard` | Same cards, wider | **Cards** |
| **Suppliers** | `EnterpriseResponsiveTable` in `SuppliersTab` | Table ≥sm; cards &lt;sm | **Tables** (responsive) |
| **Purchases** | Card `<ul>` in `PurchasesTab` | Same cards | **Cards** |
| **Sales History** | `VirtualizedReceiptList` → `SalesHistoryRow` | Same card articles | **Cards / list** |
| **Reports** | KPI / charts / leaderboards | Multi-column grids | **Cards** (appropriate) |
| **Staff** | `StaffTeamList` card rows | Same cards | **Cards** |
| **Devices** | `DeviceFleetCard` buckets | Same cards | **Cards** |
| **Hospitality** | Dashboard KPIs + floor plan cards | Floor grid / KPIs | **Cards** (domain-appropriate) |
| **Pharmacy** | Patients card grid; compliance raw `<table>` | Patient grid denser at `lg` | **Mixed** |
| **Finance** | Cash sections + expenses table | Expenses tabled | **Mixed** |
| **Command Center** | Widget cards in shell | `lg`/`xl` packing | **Cards** (appropriate) |
| **Settings** | Hub nav cards; some diagnostics tables | Hub cards | **Mixed** |
| **Investigation** | Virtualized activity timeline | Timeline, not data grid | **Lists** |
| **POS Sell** | Desktop catalog + checkout dock | Purpose-built desktop | **Shelf / panels** (not entity table) |

---

# PART 2 — Enterprise Table Certification (Critical)

## Capability matrix

| Capability | `EnterpriseResponsiveTable` | `ResponsiveDataTable` (deprecated) | `EnterpriseInventoryTable` |
|------------|:---------------------------:|:----------------------------------:|:--------------------------:|
| Desktop table available | Yes (`hidden sm:block`) | Yes (always) | Yes (CSS grid “table”) |
| Information-dense rows | Moderate | Moderate | **High** (~44px estimate) |
| Sorting | **No** | **No** | **Yes** (`sort` / `onSort`) |
| Filtering | External only | External only | External only |
| Bulk actions / selection | **No** | **No** | **Yes** (checkbox + page select) |
| Keyboard row navigation | **No** | **No** | **No** |
| Sticky headers | **Yes** (default) | **Yes** (default) | **Yes** |
| Virtualization | **No** (full `rows.map`) | **No** | **Yes** (`@tanstack/react-virtual`) |
| Column visibility | `hideOnMobile` only | None | Fixed columns |
| Pagination | **No** | **No** | **No** (windowed full array) |
| Mobile card fallback | **Yes** | **No** | Via view engine modes |

**Source of truth:** `src/components/shared/ResponsiveDataTable.tsx` (lines 4–117); `src/features/inventory/viewEngine/EnterpriseInventoryTable.tsx`.

## Data-heavy screen certification

| Screen | Desktop table? | Dense? | Sort | Filter | Bulk | Keyboard | Responsive |
|--------|:--------------:|:------:|:----:|:------:|:----:|:--------:|:----------:|
| Products / Inventory | **Yes** (auto) | Yes | Yes | Toolbar | Yes | No | Yes (view modes) |
| Customers | **No** | Low | Select only | Chips/search | No | No | Stretch cards |
| Suppliers | **Yes** (ERT) | Med | No in table | Search/chips | No | No | Table/cards |
| Purchases | **No** | Low | Limited | Status chips | No | No | Stretch cards |
| Sales History | **No** | Low–med | Limited | Filters | No | No | Virtual cards |
| Expenses | **Yes** (ERT) | Med | No in table | Page filters | No | No | Table/cards |
| Staff | **No** | Low | Search | Search | No | No | Stretch cards |
| Devices | **No** | Low | Filters | Filters | Limited | No | Stretch cards |
| Reports | N/A (analytics) | Med | N/A | Period | N/A | No | Grids OK |
| Investigation | Timeline | Med | Filters | Filters | No | No | Virtual list |
| Payments (supplier) | **Yes** (ERT) | Med | No | Limited | No | No | Table/cards |
| Pharmacy patients | Card grid | Low | Toolbar | Toolbar | No | No | Grid denser |
| Pharmacy compliance | Raw `<table>` | Med | No | Limited | No | No | Truncate 200 |

---

# PART 3 — Card vs Table Decision Audit

## Cards are appropriate

| Surface | Why cards are correct |
|---------|----------------------|
| Home launcher | Navigation / actions |
| Command Center | KPI / widget dashboard |
| Reports overview | Charts + summary tiles |
| Hospitality floor | Spatial table map |
| Inventory KPI strip | Metrics, not entity rows |
| Settings hub | Section navigation |

## Tables are expected (desktop professionals)

| Surface | Current | Expected |
|---------|---------|----------|
| Inventory products | **Table** (desktop auto) | Keep / generalize |
| Customers | Cards | Dense table + mobile cards |
| Suppliers | Table (ERT) | Keep; add sort/bulk later |
| Purchases | Cards | Dense table |
| Sales history | Card list | Dense table |
| Staff | Cards | Dense table |
| Devices | Cards | Dense table / fleet grid-table |
| Expenses | Table (ERT) | Keep; harden capabilities |
| Pharmacy patient directory | Card grid | Optional table for clinics with large rosters |

## High-confidence mismatches (desktop users forced into cards)

1. **Customers** — `CustomersPage.tsx` → `VirtualizedCustomerDebtList` / `DebtCustomerCard`  
2. **Purchases** — `PurchasesTab.tsx` card `<ul>` (while Suppliers/Payments already use ERT)  
3. **Sales History** — `ReceiptsPage.tsx` → `VirtualizedReceiptList` / `SalesHistoryRow`  
4. **Staff** — `StaffTeamList.tsx` `rounded-3xl` card rows  
5. **Devices** — `DeviceManagementPage.tsx` → `DeviceFleetCard`  

Inventory is **not** a mismatch when preference is `auto` (`defaultViewForBand` → `"table"` on desktop).

---

# PART 4 — EnterpriseResponsiveTable Adoption

## Production adoption (JSX)

| Primitive | Call sites | Primary consumers |
|-----------|----------:|-------------------|
| `EnterpriseResponsiveTable` | **3** | `SuppliersTab`, `PaymentsTab`, `CashExpensesPage` |
| `ResponsiveDataTable` (deprecated) | **4** | `OpenShiftsPage`, `SettingsFinanceDiagnosticsPage`, Shop Console audit/developer tabs |
| `EnterpriseInventoryTable` | **1** path | Via `InventoryProductList` when mode is `table` |
| Raw `<table` in `src/**/*.tsx` | **~10** | Diagnostics, compliance, AI bulk preview, admin |

## Remaining card replacements (P0/P1)

| Priority | Module | Replace with |
|----------|--------|--------------|
| P0 | Customers | Desktop data table + keep mobile cards |
| P0 | Purchases | Same (parity with Suppliers) |
| P0 | Sales History | Same |
| P1 | Staff | Dense roster table |
| P1 | Devices | Fleet table |
| P2 | Pharmacy patients | Optional directory table |

## Infrastructure gap

`EnterpriseListToolbar` exists (`src/components/enterprise/EnterpriseListToolbar.tsx`) but has **one** production consumer (`PharmacyPatientsPage`). Entity modules reinvent sticky chip/search bars instead of a shared desktop list chrome.

**Enforcement note:** `scripts/design-system-enforcement.mjs` still flags raw `min-w-full text-left text-sm` tables — good for migration pressure, insufficient without a capable shared grid.

---

# PART 5 — Desktop Productivity

| Measure | Inventory (reference) | Typical entity module (customers/purchases/sales/staff) |
|---------|----------------------|---------------------------------------------------------|
| Information density | High (~10 columns, ~44px rows) | Low (multi-line cards, large padding) |
| Rows visible (1080p) | ~15–20+ | ~4–8 cards |
| Column visibility control | Fixed | N/A |
| Bulk editing / selection | Yes | Rare / none |
| Batch selection | Page + filtered select | No |
| Keyboard friendliness | Weak (mouse/touch primary) | Weak |
| Sticky filter chrome | Yes (`md:sticky` on Stock) | Partial sticky bars |
| Compare to enterprise desktop ERP/admin | Competitive for products | Far behind for other entities |

**Verdict:** Desktop productivity is **inventory-local**. Other modules do not take advantage of horizontal space for scan/compare/act workflows that supermarket, wholesale, warehouse, pharmacy, and multi-counter operators expect.

---

# PART 6 — Responsive Behaviour

## What works

- Canonical breakpoint contract (`responsiveBreakpoints.ts`)  
- Inventory view engine: compact → card → table by band  
- `EnterpriseResponsiveTable` mobile card flip at `sm`  
- POS desktop surfaces (`PosDesktopCompactHeader`, catalog/checkout split, wide tiers)  
- Bottom nav hidden on larger chrome (`md:hidden` patterns)

## Mobile-first artifacts on desktop

| Artifact | Evidence / effect |
|----------|-------------------|
| Card lists with no `lg` table alternate | Customers, purchases, sales, staff, devices |
| Oversized card radius/padding | `rounded-3xl` staff rows; large sales history articles |
| Underused horizontal space | Single-column entity lists on 1440–1920px |
| Shared table not virtualized | Large supplier/expense lists render all rows in DOM |
| No persistent left workspace nav for back-office entities | Full-width content + top sticky filters (phone pattern scaled up) |
| `EnterpriseListToolbar` unused | Inconsistent desktop filter density |

**Verdict:** Many desktop screens **stretch mobile layouts**. Inventory and POS are the exceptions that prove a denser model is possible inside this codebase.

---

# PART 7 — Desktop Navigation

| Concern | Finding |
|---------|---------|
| App sidebar | No persistent left entity sidebar for Stock/Customers/Purchases — hub + routes |
| Headers | Page headers + sticky filter strips; inventory strongest |
| Filters / search | Per-module; often chip + search (mobile pattern) |
| Bulk actions | Inventory selection toolbar is the model; missing elsewhere |
| Unnecessary clicks | Card → expand/detail common; tables would expose compare fields in-row |
| Pharmacy | `PharmacyDesktopNav` horizontal strip — desktop-aware exception |

Desktop users still perform **extra navigation** to compare fields that should be columns (balance, last sale, status, device last seen, purchase total, etc.).

---

# PART 8 — Information Hierarchy

| Topic | Status |
|-------|--------|
| Column priority | Only inventively defined in inventory grid template |
| Table readability | Good where ERT/inventory exist; cards bury secondary fields |
| Density | Inventory calibrated; shared ERT medium; cards low |
| Typography in tables | Inherits app type; Phase 29.1 helps, not density |
| Sticky headers | ERT + inventory yes |
| Pagination | Mostly absent in UI; investigation/compliance truncate (~200) |
| Virtualization | Inventory, receipts, customers, investigation yes; **ERT no** |

---

# PART 9 — Large Dataset Certification

Assumptions: data already local/synced; UI must remain usable.

| Scenario | Likely UI behavior today | Usable? |
|----------|--------------------------|:-------:|
| 10,000 products | Inventory virtualized table | **Yes** (reference path) |
| 50,000 products | Same; memory/filter cost dominates vs DOM | **Conditional** — virtualization helps; heavy filters may hitch |
| 500 staff | Card list (no table, no virtualization found) | **Poor** scan/compare |
| 100,000 sales | `VirtualizedReceiptList` (threshold 12) | **Scroll OK**; **compare/export weak** without table |
| 5,000 customers | `VirtualizedCustomerDebtList` | **Scroll OK**; **desktop productivity poor** (cards) |
| Large supplier/expense tables via ERT | Full DOM `rows.map` | **Risk** as lists grow |

**Shared table certification for large datasets: FAIL** (no virtualization).  
**Inventory path: PASS with caveats** (virtualized, no pagination, full array in memory).

---

# PART 10 — Enterprise Benchmark (workflows, not UI clones)

Compared **workflows** to Square Dashboard, Shopify Admin, Lightspeed Retail, Zoho Inventory, Dynamics 365 Business Central:

| Workflow expectation | Industry desktop norm | WAKA today |
|----------------------|----------------------|------------|
| Scan many SKUs in columns | Dense product grid/table | **Met** (inventory desktop) |
| Customer ledger browse | Sortable table + filters | **Unmet** (cards) |
| PO / purchase register | Tabular status + totals | **Unmet** (cards; suppliers OK) |
| Sales register / history | Tabular receipt list | **Unmet** (virtual cards) |
| Staff roster admin | Compact table | **Unmet** |
| Device fleet | Table or dense grid | **Unmet** |
| Bulk select → action | Checkbox column + toolbar | **Met in inventory only** |
| Keyboard operate lists | Arrow/enter patterns | **Unmet** broadly |
| Widescreen utilization | Multi-pane or wide tables | POS yes; back-office mixed |

Do **not** copy those products’ layouts. Adopt their **productivity contracts**: density, columns, sort, filter, bulk.

---

# PART 11 — Root Cause Register

| ID | Finding | Severity | Evidence |
|----|---------|----------|----------|
| **RC-1** | Desktop uses cards where tables are expected | **P0** | Customers, Purchases, Sales, Staff, Devices card browse |
| **RC-2** | `EnterpriseResponsiveTable` underused | **P0** | 3 production JSX sites vs many entity modules |
| **RC-3** | Shared table lacks enterprise grid capabilities | **P0** | No sort/filter/bulk/virtualization/keyboard API in `ResponsiveDataTable.tsx` |
| **RC-4** | Best desktop table is inventory-private | **P0** | `EnterpriseInventoryTable` not generalized |
| **RC-5** | Missing bulk operations outside inventory | **P1** | Selection toolbar inventory-scoped |
| **RC-6** | Mobile layouts stretched onto desktop | **P1** | No `lg` table alternate on major entity pages |
| **RC-7** | Underutilized widescreen space | **P1** | Single-column card lists on ≥1024 |
| **RC-8** | `EnterpriseListToolbar` orphaned | **P1** | 1 consumer (pharmacy patients) |
| **RC-9** | Keyboard productivity not designed | **P2** | No row-grid keyboard model |
| **RC-10** | Large ERT lists not virtualized | **P1** | Full `rows.map` in shared primitive |
| **RC-11** | Raw legacy tables remain | **P2** | ~10 `<table` sites; 3 enforcement-pattern hits |
| **RC-12** | No left workspace nav for entity modules | **P2** | Hub-route model; sticky top filters only |

---

# PART 12 — Enterprise Desktop Roadmap

## P0 — Critical desktop productivity blockers

1. **Define a shared Desktop Data Workspace primitive** (extract inventory capabilities):  
   sticky header, sort, selection, virtualization, column defs, mobile card fallback.  
   Keep brand/visual language from Phase 29 — this is structure, not restyle.
2. **Migrate Customers** to desktop table + preserve mobile cards.  
3. **Migrate Purchases** to desktop table (parity with Suppliers).  
4. **Migrate Sales History** to desktop table (virtualized).  
5. **Upgrade `EnterpriseResponsiveTable`** or formally deprecate it in favor of the inventory-grade primitive (avoid two half-systems).

## P1 — Table adoption & desktop workflows

1. Staff roster table  
2. Device fleet table  
3. Wire `EnterpriseListToolbar` as default desktop chrome for entity modules  
4. Bulk actions for customers / purchases / sales where business rules allow  
5. Virtualize any remaining shared table path used for large lists  
6. Column priority presets (phone / tablet / desktop)

## P2 — Density tuning & polish

1. Keyboard navigation (↑/↓, Enter, Space select)  
2. Optional column visibility  
3. Pagination or “load window” for extreme catalogs (50k+)  
4. Optional multi-pane master–detail on ultrawide  
5. Replace residual raw admin/diagnostics tables incrementally  
6. Density tokens (comfortable / compact) for desktop preferences

---

## Scorecard (detailed)

| Dimension | Score | Notes |
|-----------|------:|-------|
| Desktop productivity | **5.4** | Inventory + POS carry the score |
| Table adoption | **3.8** | ERT ≈ 3 sites; inventory private |
| Information density | **5.1** | Cards dominate entity browse |
| Keyboard productivity | **3.2** | Not a first-class model |
| Responsive desktop | **5.8** | Breakpoints real; many stretch |
| Large-dataset UI | **6.0** | Virtualization islands; ERT gap |
| Navigation efficiency | **5.0** | Extra clicks into card detail |
| Benchmark workflow parity | **4.8** | Behind admin-console norms outside inventory |
| **Overall** | **5.2 / 10** | **Not certified** |

### Target after Phase 30.1 (implementation)

| Dimension | Target |
|-----------|-------:|
| Desktop productivity | **8.8+** |
| Table adoption (P0 modules) | **9.0+** |
| Information density | **8.7+** |
| Keyboard productivity | **7.0+** (foundation) |
| Responsive desktop | **9.0+** (table desktop / card mobile) |
| Overall | **≈ 8.6–9.0 / 10** |

---

## Appendix A — Key files

| File | Role |
|------|------|
| `src/components/shared/ResponsiveDataTable.tsx` | Shared ERT + deprecated wrapper |
| `src/features/inventory/viewEngine/EnterpriseInventoryTable.tsx` | Desktop reference table |
| `src/features/inventory/viewEngine/InventoryResponsiveLayout.ts` | Auto table ≥1024 |
| `src/features/inventory/viewEngine/InventoryProductList.tsx` | Mode switch |
| `src/features/inventory/selection/*` | Bulk selection model |
| `src/components/enterprise/EnterpriseListToolbar.tsx` | Under-adopted list chrome |
| `src/pages/CustomersPage.tsx` | Card browse (gap) |
| `src/features/inventory-purchasing/components/PurchasesTab.tsx` | Card browse (gap) |
| `src/pages/ReceiptsPage.tsx` | Sales card browse (gap) |
| `src/components/staff/StaffTeamList.tsx` | Staff cards (gap) |
| `src/pages/DeviceManagementPage.tsx` | Device cards (gap) |
| `src/lib/responsiveBreakpoints.ts` | Band contract |
| `scripts/design-system-enforcement.mjs` | Flags raw tables |

## Appendix B — Adoption snapshot (2026-08-03)

| Metric | Value |
|--------|------:|
| `<EnterpriseResponsiveTable` JSX | **3** |
| `<ResponsiveDataTable` JSX | **4** |
| Raw `<table` occurrences (`src/**/*.tsx`) | **~10** |
| `EnterpriseListToolbar` production consumers | **1** |
| Inventory desktop default view | **table** |
| Customers / Purchases / Sales / Staff / Devices desktop table | **0** (pre-30.1) → **migrated in Phase 30.1 via `EnterpriseDataTable`** |

## Appendix C — What this audit is not

- Not a visual redesign (Phase 29 owns visual language)  
- Not a demand to remove mobile cards  
- Not permission to clone Square/Shopify/Lightspeed UI  
- Not a claim that dashboards should become tables  

---

**Certified by:** Phase 30.0 Enterprise Desktop Workspace & Data Table read-only forensic audit — 2026-08-03  

**Decision:** Desktop **POS sell** and **inventory products** demonstrate enterprise desktop intent. **Back-office entity browse is not certified** as desktop-enterprise — card-first layouts and an under-powered shared table primitive leave supermarket, wholesale, warehouse, pharmacy, and multi-counter operators without the table productivity they expect on large monitors.

**Recommended next step:** **Phase 30.1 — Enterprise Desktop Data Workspace** — generalize the inventory table model into a shared primitive; migrate Customers, Purchases, and Sales History first; preserve mobile card experiences via responsive fallback.

---

# Phase 30.1 — Enterprise Desktop Data Workspace (Implementation)

**Date:** 2026-08-03  
**Mode:** Surgical presentation layer — no business logic, sync, payments, schema, or permission model changes.

## Shared table architecture

Extracted inventory desktop capabilities into a reusable platform:

| Piece | Path |
|-------|------|
| `EnterpriseDataTable` | `src/components/enterprise/data-table/EnterpriseDataTable.tsx` |
| Selection hook | `useEnterpriseTableSelection` |
| Keyboard nav | `useEnterpriseTableKeyboard` (↑/↓, Space, Ctrl/Cmd+A, Enter, Esc; skips inputs) |
| Bulk bar | `EnterpriseDesktopBulkBar` |
| Band gate | `useWakaLayoutBand() === "desktop"` (≥1024) |

**Capabilities:** sticky header, virtualization (`@tanstack/react-virtual`), sortable columns, bulk selection, row actions, keyboard focus, responsive column hide (`hideBelow`), loading/empty slots, status-token-friendly cells.

**Inventory** is now a **consumer**: `EnterpriseInventoryTable` renders via `EnterpriseDataTable` (same product columns / inventory selection adapter).

`EnterpriseListToolbar` gained optional `bulkActions` for consistent desktop chrome.

## Modules migrated

| Module | Desktop (≥1024) | Phone / tablet |
|--------|-----------------|----------------|
| Inventory products | Shared table (existing path) | Compact / card (unchanged) |
| Customers | `CustomersDesktopTable` | `VirtualizedCustomerDebtList` cards |
| Purchases | `PurchasesDesktopTable` | Card `<ul>` unchanged |
| Sales History | `SalesHistoryDesktopTable` + action sheet host | `VirtualizedReceiptList` cards |
| Staff | `StaffDesktopTable` + manage card when selected | Card list unchanged |
| Devices | `DevicesDesktopTable` | Bucketed `DeviceFleetCard` list |

## Desktop productivity improvements

- Dense multi-column scan instead of oversized cards on widescreen  
- Sortable headers where sort already existed (customers / inventory)  
- Bulk select + export selected (customers text share, purchases CSV selected, sales print/PDF when one selected)  
- Row activate opens existing detail/action flows (no new business APIs)

## Keyboard support

On focused table grid:

- ↑ / ↓ / Home / End — row focus  
- Space — toggle selection (when selection enabled)  
- Ctrl/Cmd+A — select visible rows  
- Enter — open row  
- Esc — clear selection  

Does not capture when focus is in inputs/textareas.

## Bulk action support

Desktop selection enabled by default on Customers, Purchases, Sales History. Actions respect existing callbacks/permissions (repay, export, print). Destructive batch delete not added where product rules were unclear.

## Responsive verification

| Band | Behavior |
|------|----------|
| Phone | Cards / lists only — shared desktop tables not mounted |
| Tablet (768–1023) | Cards (same as pre-30.1 entity browse) |
| Desktop (≥1024) | Table-first for migrated modules |

## Regression summary

| Area | Status |
|------|--------|
| Business logic / inventory calc | Untouched |
| Permissions / payments / reports / sync / offline / APIs / schema | Untouched |
| `npm run build` | **Pass** |
| `npm test` | **1739 pass**; 1 pre-existing fail: `pharmacyPatientProfile` age/DOB (unrelated) |
| New unit tests | `selectionHelpers.test.ts` |

## Success criteria

- Desktop users get high-density data workspaces on Customers, Purchases, Sales History, Staff, Devices, and Inventory.  
- Mobile retains card-first experiences.  
- One shared platform (`EnterpriseDataTable`) owns table behavior; inventory is a consumer.  
- Future Accounting / CRM / HQ modules can adopt the same workspace without inventing a second table system.

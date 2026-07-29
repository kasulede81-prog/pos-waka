# Phase 27.0 — Enterprise Inventory Experience & Mobile Usability Certification

**Mode:** Read-only forensic certification (**NO code changes, NO CSS changes, NO SQL, NO migrations, NO dependency updates**)  
**Date:** 2026-07-29  
**Scope:** Inventory / Stock / Purchasing module — architecture, mobile–desktop usability, action discoverability, dialogs, tables, workflows  
**Primary focus:** Why important inventory functions are hard to reach on phones  
**Next phase:** Single focused implementation (suggested Phase 27.1) addressing clustered root causes below  

---

## Executive Summary

WAKA POS consolidates inventory into a **single hub** (`/stock`, pharmacy twin `/pharmacy/inventory`) with a solid local-first data spine and a deliberate mobile view engine (**compact ≤767 → card 768–1023 → table ≥1024**). Core loops — add product, restock/receive, adjust, search — are **reachable** on mobile and use enterprise sheets (`ModalSheet` with visual-viewport keyboard handling).

The module is **not yet enterprise-certified for mobile POS inventory** because:

1. **Designed navigation surfaces are unwired** — full nav tiles, business-extension tiles, and an expanded quick-action set exist in code but are **not mounted** on the live overview.  
2. **Chrome density is extreme on small screens** — nested sticky tab bars + filter + sort chips + view switcher consume vertical space before the first product.  
3. **Several advertised actions are dead-ends or low-discoverability** — Transfer is a placeholder; export/labels lean on keyboard shortcuts / selection mode; categories/units live outside the hub.  
4. **Duplicate filter toolbars** on the Products tab increase cognitive load without improving task completion.

| Surface | Score | Verdict |
|---------|-------|---------|
| **Mobile usability (≤767 px)** | **5.4 / 10** | Not certified — task completion possible, discovery & chrome fail enterprise bar |
| **Tablet usability (768–1023)** | **7.1 / 10** | Conditionally certified for browsing; same discoverability gaps |
| **Desktop usability (≥1024)** | **8.0 / 10** | Conditionally certified — table + hover actions strong; transfer still incomplete |

**Overall Inventory Experience Readiness: 6.2 / 10**

Target after a clustered Phase 27.1: **≥ 8.5 mobile / ≥ 8.5 tablet / ≥ 9.0 desktop** without redesigning the desktop table experience.

---

## Certification Methodology

1. Static route & entry-point map (`App.tsx`, launcher, office hub, search catalog, pharmacy nav).  
2. Architecture trace of hub tabs → sheets → store mutations.  
3. Code presence vs mount analysis (`inventoryWorkspaceTiles.ts` consumers).  
4. Layout forensics: sticky, FAB, bottom chrome (`enterpriseBottomChrome`), overflow, breakpoints (`InventoryResponsiveLayout.ts`).  
5. Action inventory: every CTA path (visible / overflow / unreachable).  
6. Dialog / sheet review (`ModalSheet`, receive/adjust/count shells).  
7. Table vs card adaptation (`InventoryProductList`, `EnterpriseInventoryTable`, `EnterpriseResponsiveTable`).  
8. Workflow tap counts (nominal happy paths).  
9. Benchmark against Square / Lightspeed / Shopify / Zoho **practices** (not UI clones).  

**Not performed:** Live device lab on every width with real shop data; eye-tracking; A/B of FAB vs header CTA.

---

## PART 1 — Inventory Architecture

### Live spine

```text
Entry points
  Home launcher tile (inventory → /stock | /pharmacy/inventory)
  Office hub Daily card → /stock
  Back-office search → /stock
  Pharmacy mobile/desktop nav → /pharmacy/inventory
  Command Center / POS empty states → /stock deep links
        ↓
/stock  OR  /pharmacy/inventory
        ↓
InventoryPurchasingPage
  ├─ overview  → InventoryWorkspaceOverview
  │                 Search → products?q=
  │                 KPI cards → low / purchases / suppliers / pharmacy expiry
  │                 Quick actions (4): Receive · Adjust · Count · Transfer
  │                 StockAdjustmentSheet
  ├─ purchases → card list + NewPurchaseSheet / PurchaseDetailSheet
  ├─ suppliers → EnterpriseResponsiveTable (cards <sm, table ≥sm) + SupplierDetailSheet
  ├─ products  → StockPage (workspaceEmbed)
  │                 overview | products | shelves | low | movements
  │                 FAB Add · filters · selection · view engine
  └─ payments  → EnterpriseResponsiveTable
        ↓ satellites
/stock/count[/:sessionId]     Inventory count
/stock/transfer               PLACEHOLDER (“coming soon”)
/pharmacy/reports/inventory   Pharmacy inventory KPIs
/settings/shelves             Shelf / category arrange (outside hub)
```

### Route register (authoritative)

| Path | Gate | Component | Status |
|------|------|-----------|--------|
| `/stock` | `InventoryPurchasingProtectedRoute` | `InventoryPurchasingPage` | **Live hub** |
| `/pharmacy/inventory` | Pharmacy + same gate | Same page | **Live hub** |
| `/stock/count` | `stock.count` | `InventoryCountSessionsPage` | Live |
| `/stock/count/:sessionId` | `stock.count` | `InventoryCountSessionPage` | Live |
| `/stock/transfer` | `stock.view` | `InventoryTransferPage` | **Placeholder** |
| `/pharmacy/reports/inventory` | `reports.view` | `PharmacyInventoryReportsPage` | Live |
| `/inventory`, `/restock`, `/suppliers*`, `/office/purchases*` | — | Redirects into hub query params | Legacy |

### Query contract

- Hub `tab`: `overview` \| `purchases` \| `suppliers` \| `products` \| `payments`  
- Deep links: `supplierId`, `purchaseId`, `new=1`, products `stockView` / `q`  
- Products sub-views: `overview`, `products`, `shelves`, `low`, `movements`

### Conceptual map vs product reality

| Certification diagram node | WAKA reality |
|----------------------------|--------------|
| Inventory Dashboard | Hub **overview** tab |
| Products / Stock List / Stock Details | Hub **products** → `StockPage` + detail sheet |
| Stock Movement | Products **movements** sub-tab |
| Adjustments | Overview quick action → `StockAdjustmentSheet` |
| Purchases / Suppliers | Hub tabs + sheets |
| Categories | **Shelves** sub-tab + `/settings/shelves` (not a hub tab named Categories) |
| Units | **No inventory Units page** — unit fields live in add/edit product wizards |
| Reports | Pharmacy: dedicated report; Retail: deep link to general `/reports` |
| Dialogs / Quick Actions | Sheets + overview/product quick grids |

### Critical architecture finding (RC-1)

| Symbol | Defined | Mounted on live overview? |
|--------|---------|---------------------------|
| `resolveInventoryNavTiles` | Yes (`inventoryWorkspaceTiles.ts`) | **No** |
| `resolveInventoryExtensionTiles` | Yes | **No** |
| `InventoryBusinessExtension` / `InventoryNavigationTiles` | Yes | **No importers outside themselves** |
| `resolveInventoryQuickActions` (7–10 actions incl. Add Product) | Yes | **No** |
| `resolveInventoryOverviewQuickActions` (4 actions) | Yes | **Yes** — only this is used |

Users therefore cannot discover hub destinations (Products, Purchases, Movements, Categories/Shelves, Reports, pharmacy extensions) from a dedicated navigation tile grid — only via top tabs, KPI taps, or search.

---

## PART 2 — Mobile Layout Certification (Critical)

Breakpoints audited against code: **320 / 360 / 390 / 412 / 768** (layout bands: mobile ≤767, tablet 768–1023, desktop ≥1024 — `responsiveBreakpoints.ts` / `InventoryResponsiveLayout.ts`).

### Shared chrome conflicts

| Mechanism | Evidence | Risk on 320–412 |
|-----------|----------|-----------------|
| Hub sticky tab bar | `InventoryPurchasingPage` `sticky top-0 z-20` | Always consumes ~48–56 px |
| Nested sticky (Products) | `StockPage` second `sticky top-0 z-20` with section tabs + pinned search | **Double sticky** when `tab=products` — severe viewport loss |
| Module-exit / pharmacy bottom bar | `enterpriseBottomChrome` → `--waka-module-exit-h` / `--waka-pharmacy-nav-h` | Content + FAB must clear bar |
| FAB | `StockFab` `fixed bottom-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom)+0.75rem)]` | Correctly offset; can still overlap last list rows without scroll gutter awareness |
| Horizontal tab scroll | `InventoryPurchasingTabs` / `StockSectionTabs` `overflow-x-auto` + `min-w-max` | Tabs not clipped; **discoverability** of off-screen tabs weak (no fade hint in code) |

### Per-width verdict (Products hub path)

| Width | Hidden / clipped CTAs | Horizontal scroll | Overflow | Bottom nav conflict | Sticky | Dialogs | Safe-area |
|-------|----------------------|-------------------|----------|---------------------|--------|---------|-----------|
| **320** | Header “+ New Purchase” stacks full-width (OK); off-screen hub tabs likely; toolbar chips wrap heavily | Hub + section tabs yes (intentional) | Filter panel dense; dual toolbars | FAB + module-exit managed | Double sticky | ModalSheet uses `dvh` + visual viewport | Footer `env(safe-area-inset-bottom)` on receive |
| **360** | Same | Same | Same | Same | Same | Same | Same |
| **390** | Same; slightly less wrap | Same | Improved wrap | Same | Same | Same | Same |
| **412** | Same | Same | Same | Same | Same | Same | Same |
| **768** | Tablet band → **card** default; single sticky still + hub sticky | Tabs usually fit | Better | Desktop layout may hide module-exit (`isDesktopLayout`) | Sticky remains | Centered `sm:` sheets | Less keyboard pressure |

### Page-specific notes

- **Overview:** 2-col quick actions (`grid-cols-2`) — OK ergonomics; KPI grids `grid-cols-2`.  
- **Purchases / Payments / Suppliers:** Card-first on phone — **good**. Suppliers/Payments flip to table at `sm` (`EnterpriseResponsiveTable`).  
- **Products list:** Default **compact** rows with ⋯ overflow — good for density; primary edit/restock **not** inline.  
- **Count session:** Card list + footer buttons (not fixed on page variant) — lower keyboard risk than receive sheet.  
- **Transfer:** Empty state only — no layout failure, **functional failure**.

---

## PART 3 — Action Accessibility

| Action | Where exposed | Mobile visibility | Taps (typical) | Verdict |
|--------|---------------|-------------------|----------------|---------|
| **Add Product** | FAB (products), Stock overview quick grid, wizard sheet | FAB visible on products; **not** on hub overview quick actions | 1–2 from products; 3+ from overview (tab → overview → add) | Reachable; **inconsistent entry** |
| **Edit Product** | Card buttons / ⋯ sheet / detail sheet | Compact: **behind ⋯**; Card: inline Edit | 2–3 | OK; compact hides edit |
| **Delete / Remove** | ⋯ action sheet | Behind overflow | 2–3 | OK |
| **Duplicate** | ⋯ sheet | Behind overflow | 2–3 | Low discoverability |
| **Restock / Receive** | Overview Receive; purchases `new=1`; product ⋯ Restock; Stock overview Restock | Primary on overview | 1–2 | **Strong** |
| **Stock Adjustment** | Overview Adjust quick action | Visible | 1 | **Strong** |
| **Barcode** | Table hover actions (copy + detail); labels via bulk/keyboard | **Desktop-biased**; mobile weak | N/A / many | **Hidden on phone** |
| **Search** | Overview search → products; Products `InventoryFilterBar` + pinned search | Visible | 1 | Strong |
| **Filter** | `InventoryFilterBar` collapsible + `StockListToolbar` chips | Visible but **duplicated** | 1–2 | Confusing |
| **Category / Shelf** | Shelves sub-tab; filter category; `/settings/shelves` | Multi-path; settings outside hub | 2–4 | Fragmented |
| **Units** | Product create/edit fields only | Form-only | N/A | No inventory Units screen |
| **Export CSV** | Bulk toolbar / **keyboard** shortcut in productivity chrome | Selection mode required; shortcuts useless on phone | 3–5 | **Low discoverability** |
| **Import** | Stock overview AI import (flag-gated) | Only if AI assistant enabled | 2+ | Conditional |
| **Print labels** | Bulk / keyboard | Same as export | 3–5 | Low discoverability |
| **History / Movements** | Products → Movements sub-tab | Behind nested tabs | 2–3 | Easy to miss |
| **Inventory Count** | Overview quick action | Visible | 1 | Strong |
| **Transfer** | Overview quick action → `/stock/transfer` | Visible CTA → **dead end** | 1 → fail | **Critical false affordance** |
| **Suppliers / Purchases / Payments** | Hub tabs | Horizontal scroll may hide Payments | 1 | OK with tab discoverability risk |
| **Reports** | Unwired nav tile; pharmacy report route; retail → `/reports` | Not on overview grid | 2+ | Hidden |
| **Bulk select** | Long-press 480 ms / selection mode button | Long-press **undocumented** in UI | 1 long-press | Low discoverability |
| **View mode switch** | Toolbar / inline switcher | Visible on products | 1 | OK |

---

## PART 4 — Dialog Certification

| Dialog / sheet | Pattern | Height / width | Keyboard | Footer / buttons | Safe-area | Close | Mobile risk |
|----------------|---------|----------------|----------|------------------|-----------|-------|-------------|
| `ModalSheet` (base) | Bottom / center | `max-h` ≤ 92% visual viewport | `useVisualViewportBounds` + scroll-into-view on focus | Sticky `footer` prop | Overlay tracks VV | Backdrop / explicit | **Good baseline** |
| `EnterpriseActionSheet` | Bottom | `max-h-[min(88dvh,42rem)]` | Via ModalSheet | Action rows 48 px + cancel | Via ModalSheet | Cancel / backdrop | Good |
| `NewPurchaseSheet` / purchase detail | Sheet | `sm:max-w-lg` | Depends on receive shell | Receive footer may be `fixed` above bottom nav | `pb-[max(1rem,env(safe-area-inset-bottom))]` | Explicit | Medium — long forms |
| `ReceiveOperationShell` + `ReceiveFooter` | Bottom sheet → centered `sm:` | Fixed footer on mobile | Keyboard vs fixed footer | Dual Cancel/Primary | Yes | Cancel | **Watch:** fixed footer + keyboard + bottom chrome stacking |
| `StockAdjustmentSheet` | Shell pattern | Same family | Same | Footer actions | Yes | Close | Medium |
| `StockProductEditModal` / quick add | ModalSheet | Centered option | VV-aware | Footer on quick add | Yes | Close | Medium on small phones (long forms) |
| `CountApprovalDialog` / `AdjustmentConfirmDialog` | Confirm | Short | Low risk | Visible | Standard | Cancel | Low |
| Pharmacy batch sheets | Sheet family | Same | Same | Same | Same | Close | Medium |
| Bulk category/stock/price sheets | `AppModalOverlay` sheets inside bulk toolbar | Short forms | Variable | Inline | Partial | Close | Medium |

**Certification:** Shared `ModalSheet` architecture is **enterprise-capable**. Residual risk is **stacked chrome** (fixed receive footer + module-exit + keyboard), not missing close affordances.

---

## PART 5 — Data Tables

| Surface | Mobile adaptation | Card conversion | Horizontal scroll | Column strategy |
|---------|-------------------|-----------------|-------------------|-----------------|
| Products (`InventoryProductList`) | Default **compact**; table demoted below 1024 (`isTableViewAllowed`) | Card at tablet | Table wrapper `overflow-x-auto` + **`min-w-[980px]`** if table forced | Table has 10-col grid; hover quick actions `hidden … md:flex` |
| Purchases | **Cards only** | N/A | None | Appropriate |
| Suppliers / Payments | `EnterpriseResponsiveTable`: cards `sm:hidden`, table `hidden sm:block` | Yes | Table `minWidthPx` ~720+ | Appropriate |
| Movements | Panel list (not wide table) | List | Unlikely | Appropriate |
| Count lines | Cards | Yes | None | Appropriate |

**Finding:** Product table is correctly **not the mobile default**, but forcing table (or desktop zoom) creates enterprise-hostile horizontal scroll. Compact mode correctly moves actions to ⋯.

---

## PART 6 — Workflow Certification

### Add Product (from home tile)

| Step | Screen | Tap |
|------|--------|-----|
| 1 | Home → Inventory | 1 |
| 2 | Hub lands overview — must switch to Products **or** open products overview sub-tab | 1 |
| 3 | FAB or Stock overview Add | 1 |
| 4 | Complete wizard / quick add → Save | 1+ form |

**Nominal taps:** ~4–6 before save.  
**Friction:** Overview does not expose Add Product in its 4 quick actions (though `resolveInventoryQuickActions` defined it). FAB only appears under Products tab content.

### Edit Product

Compact list → ⋯ → Edit → save: **3 taps + form**. Card mode can be **2**. Acceptable; compact hides edit.

### Receive Stock

Overview → Receive → sheet → save: **2 + form**. Strong.

### Adjust Stock

Overview → Adjust → sheet: **2 + form**. Strong.

### Search Product

Overview search OR Products filter: **1–2**. Strong.

### Delete Product

⋯ → Remove → confirm: **3**. OK.

### View History

Hub Products tab → Movements sub-tab: **2–3**. Nested IA reduces discovery.

### Transfer Stock

Overview → Transfer → **Coming soon**: **1 tap to failure**. Critical.

### Unnecessary navigation patterns

- Hub tab **plus** Stock section tabs for products (two IA layers).  
- Filter bar **plus** list toolbar chips (duplicate filters).  
- Categories conceptually split across shelves tab, filters, and Settings → Shelves.

---

## PART 7 — Responsive Behaviour

| Band | Width | Default product view | Bottom chrome | Notes |
|------|-------|----------------------|---------------|-------|
| Phone | ≤767 | `compact` | module-exit / pharmacy | Double sticky + FAB |
| Foldable / large phone | ~800 (if ≥768) | `card` | Often desktop layout if `usePosDesktopLayout` | Band jump at 768 |
| Small tablet | 768–1023 | `card` | Often none if desktop layout | Good browsing |
| Large tablet / desktop | ≥1024 | `table` | none | Strong |

**Inconsistencies**

- Hub uses `sm:` for supplier tables; product view engine uses **768 / 1024** WAKA bands — two breakpoint systems.  
- `resolveInventoryNavTiles` “categories” href uses `stockView=shelves` while retail extension points to `/settings/shelves` — dual destinations.  
- Transfer UI kit under `components/inventory/transfers/` is built but page is placeholder — responsive shells unused.

---

## PART 8 — Visual Hierarchy

| Dimension | Assessment | Score |
|-----------|------------|-------|
| Typography | Enterprise tokens / black weights consistent | 8/10 |
| Spacing | Cards/sheets coherent; products tab crowded | 6/10 |
| Card hierarchy | Overview KPIs + quick actions clear | 7.5/10 |
| Icons | Lucide consistent | 8/10 |
| Action prominence | Receive primary styled; Add inconsistent | 6/10 |
| Empty states | Present (transfer, low stock, empty shelf) | 7/10 |
| Error / loading | Standard patterns; not inventory-unique failures | 7/10 |

**Enterprise visual quality (inventory):** **7.0 / 10** — language is premium; **density and false affordances** undercut trust.

---

## PART 9 — Mobile Ergonomics

| Topic | Finding |
|-------|---------|
| Thumb reach | FAB bottom-right — good for right-hand; conflicts possible with exit bar |
| One-handed | Compact rows + ⋯ OK; double sticky forces mid-screen hunting |
| Primary action | Receive on overview strong; Add not on overview |
| Bottom sheets | Preferred pattern — correct for POS |
| Long forms | Receive / edit / pharmacy medicine — rely on VV scroll; still taxing on 320 px |
| Action density | Products tab: filter + selection + sort chips + view switcher = **high** |
| Long-press select | 480 ms — power-user only |

**Hard-to-reach / hard-to-find controls:** Payments tab (scroll), Movements, Export, Barcode, Settings shelves, Transfer (reachable but useless), Add Product from overview.

---

## PART 10 — Hidden Feature Register

| Feature | Why hidden / confusing |
|---------|------------------------|
| Full inventory nav tile grid | Implemented, **never mounted** |
| Business extension tiles (pharmacy expiry, shelf labels, recipes, bulk stock) | Implemented, **never mounted** |
| Expanded quick actions (Add Product, Purchases, Suppliers, pharmacy batch) | `resolveInventoryQuickActions` unused |
| Transfer | Mounted CTA → placeholder page |
| Export / print labels | Selection + bulk / keyboard — no obvious mobile Export button on idle list |
| Barcode copy / print | Desktop table hover cluster |
| Units management | No dedicated screen |
| Categories vs Shelves naming | Label “Categories” in unwired tiles maps to shelves |
| Inventory Count | Visible on overview but buried if user lives only in Products tab |
| AI Import | Flag-gated; only on Stock overview sub-panel |
| Office hub supplier/restock cards | Hub passes `showSuppliers={false}` / `showRestock={false}` |
| Duplicate filters | Two filter UIs on same products list |
| Long-press multi-select | No instructional UI |

**Duplicate / redundant controls**

- Overview Receive vs Purchases “New purchase” vs Restock links vs product Restock.  
- Overview search vs Products search/filter.  
- Stock overview quick grid vs hub overview quick actions (parallel IA).

---

## PART 11 — Enterprise Benchmark

Practices relevant to WAKA (not UI clones):

| Practice (Square / Lightspeed / Shopify / Zoho) | WAKA today | Gap |
|-----------------------------------------------|------------|-----|
| One primary “Add item” always visible in inventory home | FAB only inside Products | Expose Add on hub overview |
| Inventory home = actionable directory (Items, PO, Counts, Transfers) | Tabs exist; **tile directory unwired** | Mount nav tiles |
| Transfers as first-class or hidden until ready | CTA live, feature not | Hide CTA or ship MVP |
| Mobile lists: swipe/overflow actions with clear Edit | ⋯ sheet | OK; prefer swipe later |
| Filters in one panel | Two systems | Consolidate |
| Export from visible overflow menu | Keyboard/bulk-centric | Add mobile overflow Export |
| Consistent breakpoints | Mixed `sm` vs 768/1024 | Align documentation + chrome |

WAKA’s **local-first + sheet** approach is appropriate for Uganda POS offline reality; the gap is **information architecture completion**, not visual language.

---

## PART 12 — Root Cause Register

Ranked by user impact on mobile inventory task completion:

### RC-1 — Unwired inventory navigation & extension surfaces  
**Evidence:** `InventoryWorkspaceOverview` only calls `resolveInventoryOverviewQuickActions`; `InventoryBusinessExtension` / `resolveInventoryNavTiles` / `resolveInventoryExtensionTiles` / `resolveInventoryQuickActions` have no live parents.  
**Effect:** Movements, reports, shelves/categories, pharmacy extensions, Add-from-overview feel “missing.”

### RC-2 — Nested sticky chrome + toolbar density on Products  
**Evidence:** Dual `sticky top-0 z-20` on hub + `StockPage`; FilterBar + SelectionToolbar + StockListToolbar + ViewSwitcher stack.  
**Effect:** On 320–412 px, first product sits far below fold; perceived “can’t find actions.”

### RC-3 — Transfer false affordance  
**Evidence:** Quick action `href: "/stock/transfer"`; page renders `notifyComingSoonTransfers` only; transfer components unused.  
**Effect:** Users believe Transfer works; trust loss.

### RC-4 — Split / duplicate filtering & category IA  
**Evidence:** `InventoryFilterBar` + `StockListToolbar` on same tab; categories ≡ shelves ≡ settings.  
**Effect:** Extra taps, inconsistent mental model.

### RC-5 — Export / barcode / bulk power tools not mobile-primary  
**Evidence:** `useInventoryKeyboardShortcuts`; table hover actions `hidden … group-hover:flex md:flex`; bulk toolbar only when `count > 0`.  
**Effect:** Enterprise ops (labels, CSV) feel desktop-only.

### RC-6 — Add Product entry inconsistency  
**Evidence:** FAB gated to products content; overview quick actions omit Add though alternate resolver includes it.  
**Effect:** From Inventory home, Add is non-obvious.

### RC-7 — Breakpoint dualism (`sm` vs WAKA 768/1024)  
**Evidence:** Suppliers table at `sm`; product view engine at 768/1024; bottom chrome uses tablet min.  
**Effect:** Foldables / small tablets get uneven table vs card behavior across tabs.

### RC-8 — Receive fixed footer vs keyboard / bottom chrome stack  
**Evidence:** `ReceiveFooter` `fixed bottom-[calc(var(--waka-bottom-nav-h)+…)]`; ModalSheet VV-aware but fixed footer is separate.  
**Effect:** Intermittent primary-button occlusion on long receive forms (device-dependent).

---

## PART 13 — Enterprise Improvement Roadmap

Cluster into **one implementation phase** (recommended **Phase 27.1**) rather than per-screen CSS patches.

### P0 — Critical (block trust / task failure)

| ID | Work | Addresses |
|----|------|-----------|
| P0-1 | Hide Transfer quick action **or** ship minimal transfer MVP; remove dead-end CTA | RC-3 |
| P0-2 | Mount inventory **nav tile directory** on overview (wire `resolveInventoryNavTiles` + permissions) | RC-1 |
| P0-3 | Add **Add Product** to hub overview primary actions (reuse existing resolver) | RC-6 |

### P1 — High (workflow efficiency)

| ID | Work | Addresses |
|----|------|-----------|
| P1-1 | Collapse Products chrome: single sticky region; merge FilterBar + list toolbar into one mobile filter sheet | RC-2, RC-4 |
| P1-2 | Mobile overflow on product list: Export / Labels when selection idle (⋯ menu on list header) | RC-5 |
| P1-3 | Mount business-extension strip where mode requires (pharmacy expiry, etc.) | RC-1 |
| P1-4 | Audit receive footer vs VV keyboard on device; prefer ModalSheet sticky footer over separate fixed footer where possible | RC-8 |

### P2 — Medium (responsive consistency)

| ID | Work | Addresses |
|----|------|-----------|
| P2-1 | Align supplier/payments card/table breakpoint with WAKA tablet band (768) | RC-7 |
| P2-2 | Tab scroll affordance (edge fade / “more” hint) for hub & section tabs | Part 2 |
| P2-3 | Document Units as product-field-only; optional deep link from nav “Categories” → shelves with clear label | RC-4 |
| P2-4 | Long-press hint / “Select” education chip when selection available | Part 9 |

### P3 — Low (polish)

| ID | Work |
|----|------|
| P3-1 | Re-enable office hub supplier/restock summary cards when metrics ready |
| P3-2 | Retail inventory report entry distinct from generic `/reports` |
| P3-3 | Compact-row swipe actions (future) instead of only ⋯ |
| P3-4 | FAB collision QA matrix vs pharmacy nav heights |

---

## Scores (recap)

| Dimension | Score |
|-----------|-------|
| Mobile usability | **5.4 / 10** |
| Tablet usability | **7.1 / 10** |
| Desktop usability | **8.0 / 10** |
| Workflow efficiency | **6.0 / 10** |
| Dialog / keyboard readiness | **7.5 / 10** |
| Table responsiveness | **8.0 / 10** (defaults good) |
| Discoverability | **4.5 / 10** |
| **Overall** | **6.2 / 10** |

---

## Success Criteria — Phase 27.0 Outcome

At end of Phase 27.0 we know:

- **Every major mobile blockage:** double sticky + toolbar density; unwired nav; Transfer dead-end; export/barcode desktop bias; Add Product inconsistent; duplicate filters.  
- **Hidden / hard features:** nav tiles, extensions, expanded quick actions, export/labels, long-press select, units-as-page, office deferred cards.  
- **High-tap / wasteful flows:** Products nested IA; Transfer false path; settings shelves detour for categories.  
- **Dialogs/tables/forms:** ModalSheet solid; receive fixed footer residual risk; product table correctly demoted on phone.  
- **Minimum change set:** P0-1…P0-3 + P1-1…P1-4 as a **single Phase 27.1** cluster — wire designed surfaces, remove false CTAs, collapse mobile chrome — without sacrificing desktop table UX.

**Certification status:** Inventory module **NOT certified** for enterprise mobile POS rollout until P0 items are resolved.

---

## Key file index (forensic)

| Path | Role |
|------|------|
| `src/pages/InventoryPurchasingPage.tsx` | Hub shell + sticky tabs |
| `src/components/inventory/workspace/InventoryWorkspaceOverview.tsx` | Live overview (partial wiring) |
| `src/lib/inventoryWorkspaceTiles.ts` | Nav / quick / extension definitions |
| `src/pages/StockPage.tsx` | Products workspace + nested sticky + FAB |
| `src/features/inventory/viewEngine/*` | Responsive view engine + table |
| `src/components/stock/StockFab.tsx` | Mobile add FAB |
| `src/components/layout/ModalSheet.tsx` | Sheet/keyboard baseline |
| `src/components/inventory/receive/ReceiveFooter.tsx` | Fixed footer risk |
| `src/pages/InventoryTransferPage.tsx` | Placeholder |
| `src/lib/enterpriseBottomChrome.ts` | Bottom bar modes |
| `src/App.tsx` | Routes ~608–642, 785–794 |

---

*End of Phase 27.0 forensic certification.*

---

## Phase 27.1 Implementation

**Date:** 2026-07-29  
**Mode:** Surgical navigation / discoverability / responsive chrome only — **no** stock/purchase calculation, sync, offline, schema, or API changes.

### Before vs after — Inventory Hub navigation

| Surface | Before (27.0) | After (27.1) |
|---------|---------------|--------------|
| Overview quick actions | Receive · Adjust · Count · **Transfer (Coming Soon)** | Receive · **Add Product** · Adjust · Count |
| Hub directory tiles | Defined in `inventoryWorkspaceTiles.ts` but **not mounted** | Mounted via `InventoryNavigationTiles` (products, purchases, count, movements, categories, suppliers, reports) |
| Transfer | Visible → placeholder | Hidden (`INVENTORY_TRANSFER_ENABLED = false`); `/stock/transfer` redirects to `/stock` |
| Business extensions | Unwired / incomplete tiles | Pharmacy: expiry + compliance; Retail: shelf labels; Hospitality: recipe/menu; Wholesale: none (no dead ends) |
| Add Product from hub | Not on overview (FAB only after Products) | Primary quick action → `?tab=products&add=1` opens wizard |

### Inventory Hub improvements

- `InventoryWorkspaceOverview` mounts Quick Actions + Navigation Tiles + Business Extensions.
- Overview search still deep-links to Products with `q=`.
- KPI cards retain existing destinations (low stock, purchases, suppliers, pharmacy expiry/compliance).

### Mobile workflow improvements (≤768 px)

**Part 4 + 4A — control density**

| Class | Phone behavior |
|-------|----------------|
| Primary | Search always visible; FAB Add on Products; hub Add Product CTA |
| Secondary | Filters / sort / view / selection → single **Filter & view** sheet; export / labels → **⋯ overflow** |
| Advanced | Full inline FilterBar + StockListToolbar + ViewSwitcher + export button on tablet/desktop only |

- Products phone chrome: `InventoryProductsControlBar` replaces stacked FilterBar + toolbar + view switcher.
- Nested sticky softened: section tabs sticky from `md:` up; phone products uses control-bar search (no duplicate pinned search).
- Desktop/tablet toolbars unchanged in richness.

**Receive dialog (Part 7)**

- `ReceiveOperationShell` modal pins to `visualViewport` (same pattern as `ModalSheet`).
- `ReceiveFooter` disables `fixed` positioning when keyboard gap ≥ 80 px so Save/Submit stays reachable.

### Workflow metrics (target)

| Workflow | Target | Implementation path |
|----------|--------|---------------------|
| Add Product | ≤ 2 taps | Hub → Add Product (opens wizard) |
| Receive Stock | ≤ 2 taps | Hub → Receive |
| Stock Adjustment | ≤ 2 taps | Hub → Adjust |
| Search Product | Immediate | Hub search bar or Products search |
| Export | ≤ 2 taps | Products → ⋯ → Export |
| Filter | One control | **Filter & view** |
| List visibility | ≥ 5 rows @ 390 px | Reduced sticky + consolidated chrome |
| Primary CTA vs keyboard | Never hidden | VV-aware receive shell + footer |
| Horizontal scroll | None | No new horizontal chrome |

### Responsive verification results

| Width | Expected result |
|------:|-----------------|
| 320 / 360 / 390 / 412 | Single-column hub; Filter & view + overflow; no Transfer; list not buried under multi-row sticky filters |
| 768 (tablet) | Inline filter/sort/view/export toolbar retained |
| Desktop (≥1024) | Full toolbar + table view engine unchanged |

*Automated:* `npm run build`, `npm test` (includes `inventoryWorkspaceTiles.test.ts`).  
*Manual device lab (Web + Android):* checklist in Phase 27.1 plan — certify on device before production sign-off.

### Regression summary

| Area | Changed? |
|------|----------|
| Stock / purchase calculations | No |
| Sync / offline / DB schema / APIs | No |
| Inventory business mutations | No |
| Navigation / discoverability / chrome layout | Yes |
| Receive shell keyboard pinning | Yes (presentation only) |

### Expected score uplift (post-implementation)

| Surface | Before | Expected after |
|---------|-------:|---------------:|
| Mobile | 5.4/10 | **8.8–9.2/10** |
| Tablet | 7.1/10 | **8.6–8.9/10** |
| Desktop | 8.0/10 | **8.2–8.5/10** |
| Overall | 6.2/10 | **≈8.8/10** |

### Key files touched

| Path | Change |
|------|--------|
| `src/lib/inventoryWorkspaceTiles.ts` | Transfer gate; Add Product on overview; production-safe extensions |
| `src/components/inventory/workspace/InventoryWorkspaceOverview.tsx` | Mount nav + extensions; `onAddProduct` |
| `src/features/inventory/InventoryProductsControlBar.tsx` | Phone Filter & view + overflow; desktop toolbar |
| `src/pages/StockPage.tsx` | Control bar; `add=1` deep link; phone sticky density |
| `src/components/inventory/receive/ReceiveOperationShell.tsx` | Visual viewport overlay |
| `src/components/inventory/receive/ReceiveFooter.tsx` | Keyboard-aware fixed footer |
| `src/App.tsx` | Transfer → redirect to hub |
| `src/lib/inventoryWorkspaceTiles.test.ts` | Nav / transfer / extension guards |

*End of Phase 27.1 implementation notes.*

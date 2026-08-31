# WAKA POS — CSV Import UI Visibility Audit

**Date:** 2026-08-29  
**Scope:** Inspection only. No code was changed.  
**Question:** Why is **Import CSV** not visible on the live Stock screen, given that CSV product import was implemented?

---

## Verdict

**HIDDEN**

CSV import **is fully implemented and wired** into `StockPage`. It is **not** a library-only stub.

It is **not** shown on the screen users actually land on when they open Stock.

The implementation report’s path `Stock → Import CSV` describes a tile on Stock **Overview**. Production `/stock` never renders that Overview. The remaining live control sits on the **Products** catalog toolbar — and on phones it is inside the overflow (`⋯`) menu, not beside Add Product.

---

## 1. Actual production Stock screen

| Item | Fact |
|------|------|
| Route | `/stock` (pharmacy: `/pharmacy/inventory`) |
| Page | `src/pages/InventoryPurchasingPage.tsx` |
| Title | “Inventory & Purchasing” (`ipPageTitle`) |
| Default tab | **Overview** (`?tab=` unset → `"overview"`) |
| Overview body | `InventoryWorkspaceOverview` — hub cards + quick actions |
| Product catalog | `StockPage` **only** when hub tab is `products`, with `workspaceEmbed` |

`App.tsx` does **not** mount `StockPage` as the `/stock` element. It mounts `InventoryPurchasingPage`, which embeds:

```tsx
{tab === "products" && canStock ? <StockPage lang={lang} workspaceEmbed /> : null}
```

That is the only `<StockPage />` in the app.

`StockPage` still has a standalone Overview (`StockOverviewPanel` / `StockQuickActionsGrid`) with a visible **Import CSV** tile. Production never shows it:

- `workspaceEmbed` is always `true` on `/stock`.
- Nested overview is explicitly forbidden: “hub owns overview; never show nested overview inside products embed.”
- `StockSectionTabs` in embed mode **omits** the nested Overview tab.

So the documented first-class tile is **unreachable**.

---

## 2. Current Add Product entry point

Add Product is a **separate** action from CSV import. Design places CSV **beside** Add Product on the (now-dead) nested Overview grid — not inside the wizard.

**Production Add Product paths**

1. Hub Overview → quick action **Add Product** (`stockAddProductBtn`)  
   → `setTab("products", { add: "1" })`  
   → `SimpleAddProductWizard` / `PharmacyAddMedicineWizard`  
   **No CSV control in the wizard.**
2. Products tab → floating **+** FAB (`StockFab`) → same wizard.
3. Empty catalog → **Add Product** button on `EnterpriseEmptyState` (CSV is a second button here).

CSV is **not** inside Add Product. It is **not** on the hub Overview next to Add Product. It is a **separate Stock / Products-list action**.

---

## 3. CSV importer files (library)

All under `src/lib/productImport/`:

| File | Role |
|------|------|
| `parseProductImportCsv.ts` | Parse `.csv` text/file |
| `csvColumns.ts` | Official headers + aliases |
| `csvTemplate.ts` | Downloadable WAKA template |
| `types.ts` | `NormalizedProductImportRow`, source `"csv"` |
| `commitNormalizedProductImport.ts` | Review → `bulkQuickAddProducts` |
| `mapNormalizedRowsToBulkQuickAdd.ts` | Row mapping |
| `evaluateNormalizedProductRows.ts` | Review issues |
| `createNormalizedRow.ts` | Shared row factory |
| `index.ts` | Public exports |

Commit path (unchanged):  
`parseProductImportCsv` → `ProductImportReviewSheet` → `commitNormalizedProductImport` → `bulkQuickAddProducts` → `buildQuickAddProductDraft` → `commitNewProducts`.

---

## 4. CSV UI files

| File | Role |
|------|------|
| `src/components/stock/ProductCsvImportSheet.tsx` | File picker / template download |
| `src/components/stock/ProductImportReviewSheet.tsx` | Review + commit |
| `src/components/stock/ProductImportReviewTable.tsx` | Editable review table |
| `src/components/stock/StockQuickActionsGrid.tsx` | **Import CSV** tile (nested Overview — unused in production) |
| `src/components/stock/StockOverviewPanel.tsx` | Pass-through to the grid |
| `src/features/inventory/InventoryProductsControlBar.tsx` | **Live** Products-tab entry |
| `src/pages/StockPage.tsx` | State, `openCsvImport`, sheet mount |

Copy: `stockQuickImportCsv` = “Import CSV” / Luganda “Yingiza CSV”.

---

## 5. Whether the UI is wired

**Yes.** `StockPage` imports and mounts:

- `ProductCsvImportSheet` (gated by `canAdd`)
- `ProductImportReviewSheet`

Handlers: `openCsvImport` → parse → `handleCsvParsed` → review sheet.

**Not wired to:**

- Inventory hub Overview (`InventoryWorkspaceOverview` / `resolveInventoryOverviewQuickActions`)
- Add Product wizard
- POS Sell
- Hub header (header is **+ New purchase**, not CSV)

---

## 6. Exact path a user should take (current code)

Must have `products.add`. Catalog must not be at the free-plan product cap.

### A. Shop already has products (typical)

1. Open **Stock** (`/stock` or `/pharmacy/inventory`).
2. You land on hub **Overview**. **There is no Import CSV here.**
3. Tap hub tab **Products** (`ipTabProducts`).
4. Then:

**Desktop / tablet (≥ 768px)**  
Toolbar next to Export: **Import CSV**.

**Phone (≤ 767px)**  
Search + Filter & View + **⋯** (`stockMoreActions`).  
Open **⋯** → **Import CSV**.  
Not on the first row. Easy to miss.

5. Sheet: download template or choose `.csv` → review → save.

### B. Empty catalog (zero unlocked products)

On Products tab, empty state shows **Add Product** and **Import CSV** as full-width buttons. This is the only production surface where CSV is as obvious as Add Product.

### C. Documented path (dead)

`Stock → Import CSV` on nested Overview / `StockQuickActionsGrid` — **cannot be reached** because `/stock` always embeds `StockPage`.

---

## 7. If hidden — exact reasons

Not a CSV feature flag. Not a shop-mode gate (retail / pharmacy / wholesale / hospitality all use the same StockPage wiring).

| Condition | Effect |
|-----------|--------|
| Production IA: `/stock` = hub Overview | Nested **Import CSV** tile never mounts. |
| Hub Overview quick actions omit CSV | User looking at “Stock home” never sees it. |
| Phone Products toolbar | CSV moved into **⋯** overflow. |
| `!canAdd` (`products.add`) | No sheet, no toolbar item, no empty-state CSV button. |
| Free plan at 7 products | Control present but **disabled**; `openCsvImport` no-ops. |
| Hub tab ≠ Products | `StockPage` unmounted; no CSV UI at all. |
| Nested tab Shelves / Low / Movements | Control bar not shown (only Products tab). |
| Add Product wizard | No CSV. Opening Add Product does not reveal import. |

**Most likely inspector experience:** Owner opens Stock, sees Overview (Receive stock, Add Product, Count, …), never opens Products **⋯**. Looks like CSV was never shipped.

---

## 8. Required permission

**`products.add`** — same as Add Product / quick add.

`openCsvImport` requires `canAdd`. Sheet mounts only if `canAdd`. Control bar uses `canImportCsv={canAdd}`.

Store still denies `bulkQuickAddProducts` / `quickAddProduct` / `addProduct` without `products.add`.

CSV import is **not** gated by `hasEffectivePermission` / plan for `products.add` itself. `products.add` is not in Starter/Business/Waka+ permission sets. Free-plan **product count** (7) can still disable the control.

### Built-in roles with `products.add`

| Role | Has `products.add`? |
|------|---------------------|
| owner | Yes |
| manager | Yes |
| supervisor | Yes |
| stock_keeper | Yes |
| cashier | **No** |
| waiter | **No** |
| kitchen | **No** |
| bar | **No** |

Cashiers **can** open Stock (`stock.view`) and the Products tab, but they **cannot** see Import CSV.

Custom staff roles: if `authPermissions` is set, that list wins over the matrix. A custom role without `products.add` hides CSV even for a “manager” label.

Local/offline sign-in is owner → CSV allowed (unless free cap).

---

## 9. Feature flag conditions

**None for CSV.**

Related, easy to confuse:

- **AI bulk import** (`aiBulkBtn` / `BulkInventoryAiModal`) — `useAiFeatureGate("inventory_assistant")` **and** `products.add`. Separate tile on dead nested Overview.
- **AI product assist** — `product_assistant` gate.
- **Free product limit** — not a flag; disables add **and** CSV when `products.length >= maxProductsForTier`.
- **`INVENTORY_TRANSFER_ENABLED`** — transfers only.

---

## 10. Routes / navigation

| Path | What you see |
|------|----------------|
| `/stock` | Hub Overview. No CSV. |
| `/stock?tab=products` | Embedded `StockPage` Products. CSV in toolbar / ⋯. |
| `/stock?tab=products&add=1` | Opens Add Product wizard, **not** CSV. |
| `/pharmacy/inventory` | Same hub as `/stock`. |
| `/inventory` | Redirect to `/stock`. |
| Deep links to `/stock?tab=overview` | Hub Overview (`InventoryPurchasingPage` tab), not `StockPage` Overview. |

Bottom nav: Home / Sell / Shop (or Stock for stock-only roles) → `/stock` Overview.

Office / launcher / command center “Stock” and “Add Product” go to `/stock` or `/stock` without `tab=products` — still no CSV on first paint.

---

## 11. Missing wiring

The pipeline is connected. The **hub** is not.

1. **Inventory hub Overview** has Add Product, not Import CSV (`src/lib/inventoryWorkspaceTiles.ts` `resolveInventoryOverviewQuickActions` / `resolveInventoryQuickActions`).
2. Documented **Stock Overview** tile is dead because of `workspaceEmbed`.
3. **Add Product** (hub + FAB + wizard) does not mention CSV.
4. **Phone** hides the live control behind ⋯.

This is an IA / discoverability gap, not a missing import of `ProductCsvImportSheet`.

---

## 12. Recommended minimal fix (do not implement here)

Smallest change that matches the report (“Stock → Import CSV”) and Add Product:

**Add an Inventory hub Overview quick action** “Import CSV” (`stockQuickImportCsv`), permission `products.add`, that:

- switches to `tab=products`, and
- opens `ProductCsvImportSheet` (query flag e.g. `import=csv`, or lift sheet state to `InventoryPurchasingPage`).

Optional one-liners (still later):

- Keep a visible **Import CSV** on the phone Products row (not only ⋯), beside Filter.
- Do **not** put CSV inside the single-product wizard unless product asks for it; design is a **sibling** of Add Product.

Do not add a second create engine. Keep `products.add` and the existing review/commit path.

---

## Answers to inspection questions

### A. Is the UI entry point present?

**Yes, but not where the report says.**

Live: `InventoryProductsControlBar` on embedded Products tab.  
Dead: `StockQuickActionsGrid` on nested Overview.  
Empty catalog: empty-state **Import CSV** on Products when there are no products.

### B. Present but hidden?

**Yes.** Hidden from Stock home by hub IA. Further hidden on phone by overflow. Hidden without `products.add`. Disabled at free product cap.

### C. Not present?

Do **not** conclude: “CSV backend exists, but no user-facing entry point is currently wired.”

The entry point **is** wired to the Products catalog. It is **not** wired to the production Stock landing screen.

### D. Permissions

`products.add` on owner, manager, supervisor, stock_keeper. Not cashier / waiter / kitchen / bar. UI matches: `canAdd` gates every CSV control. Custom snapshots can hide it.

### E. Add Product relationship

**Beside** Add Product on the unused nested Overview grid. **Not inside** Add Product. **Not** a hub Overview sibling today. **Separate** Products-list action (toolbar / ⋯).

### F. Production Stock screen

`InventoryPurchasingPage` at `/stock`. Product list is embedded `StockPage` with `workspaceEmbed`. Pharmacy uses the same page at `/pharmacy/inventory`.

### G. Build / import wiring

`StockPage.tsx` imports `ProductCsvImportSheet`, `ProductImportReviewSheet`, and `NormalizedProductImportRow`. `InventoryPurchasingPage` imports `StockPage`. CSV parser is used by `ProductCsvImportSheet`. This is not unused library code.

---

## Verdict (repeat)

**HIDDEN**

Wired. Permission-correct for `products.add`. No CSV feature flag. Unreachable on Stock Overview; buried on Products (especially phone ⋯). That is why inspecting the actual WAKA Stock UI does not show Import CSV.

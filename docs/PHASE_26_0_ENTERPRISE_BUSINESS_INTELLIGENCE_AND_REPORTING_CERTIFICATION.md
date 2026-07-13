# Phase 26.0 — Enterprise Business Intelligence & Reporting Certification

**Mode:** Read-only forensic certification (no code changes, no SQL, no migrations, no dependency updates)  
**Date:** 2026-07-13  
**Scope:** Investigation Center, Reports, Profit Center, Command Center — accuracy, performance, exports, printing, charts, filters, offline behavior, cross-device consistency  
**Next phase:** [Phase 26.1 blueprint](#part-17--phase-261-implementation-blueprint)

---

## Executive Summary

The Business Intelligence layer is **architecturally sound** — all four modules read from a shared local-first store (`usePosStore`) with a centralized financial engine (`saleFinancialEngine` → `homeProfit` / `financialMetrics` → `localReporting`). Calculation consistency tests exist and the core gross-profit math is **correct and unified**.

However, the BI layer is **not production-ready for enterprise rollout** because **export and print are broken on Android** across most surfaces, several KPIs and labels are misleading, and a number of report actions are no-ops or mislabeled.

| Module | Calculation accuracy | Export / print | Enterprise readiness |
|--------|---------------------|----------------|----------------------|
| **Investigation Center** | Good (with KPI bugs) | 🔴 Broken on Android | Not certified |
| **Reports** | Good (labeling/scoping bugs) | 🔴 Broken / mislabeled | Not certified |
| **Profit Center** | Good (gross labeled as net) | 🔴 No file export | Not certified |
| **Command Center** | Good (heuristic health) | 🔴 Share-text only | Partially certified (view-only) |

**Overall BI Readiness: 5.4 / 10**  
- Calculation core: **8.5 / 10**  
- Export / print reliability: **2.5 / 10**  
- UX / labeling / filters: **6.0 / 10**  
- Performance at scale: **6.5 / 10** (benchmarks exist; cache fingerprint weak)

**Primary root cause of export/print failure:** The codebase has a **correct unified native path** (`saveExportedFile` → Capacitor Filesystem + Share) but **most BI buttons still call legacy browser paths** (`anchor.click()` blob download, `window.print()`, clipboard-as-CSV). Android Capacitor WebView has **no `DownloadListener`** in `MainActivity.java` and **iframe `window.print()` is explicitly a no-op** on native platforms.

Target after Phase 26.1: **9.0+ / 10** — reliable CSV/PDF/Excel/print on Web, Android, and Windows/Electron with accurate KPIs and consistent labeling.

---

## Certification Methodology

1. Static architecture trace: UI → selectors/hooks → store → calculations → charts → export/print for each module  
2. Export path audit: every button → handler → generator → delivery mechanism  
3. Print path audit: iframe print, PDF share fallback, Electron bridge, ESC/POS thermal  
4. Android audit: `MainActivity.java`, Capacitor plugins, WebView download/print behavior  
5. Electron/Windows audit: `electron/main.cjs`, `preload.cjs`, IPC print bridge  
6. Calculation cross-check: `reportingConsistency.test.ts`, `homeProfit.ts`, `localReporting.ts`  
7. Permission audit: route gates, widget gates, export gates  
8. Performance review: deferred values, computation cache, virtualization, scalability tests  
9. Dead code scan: unused server RPC layer, legacy components, duplicate handlers  

**Not performed:** Live device export/print on production APK, systrace on 100k-sale datasets, side-by-side benchmark against Shopify/Square/Lightspeed/Toast.

---

## PART 1 — Module Architecture

### Shared spine (all four modules)

```
UI (Page / Enterprise Shell)
  ↓
Hooks: useReportingSales, useReportingDateFilter, useShopReportBundle, useDeferredReporting*
  ↓
usePosStore (Zustand) — sales, products, customers, returns, auditLog, shifts, purchases, cashExpenses
  ↓
IndexedDB hydration: ensureAllActiveSalesLoaded, hydrateEntityRemainderFromManifest
  ↓
Calculations:
  saleFinancialEngine.ts → homeProfit.ts / financialMetrics.ts → localReporting.ts
  analyticsPageView.ts / commandCenterPageView.ts / activityPresentation.ts (view-layer)
  ↓
Charts: custom SVG (MiniSparkline, AnalyticsTrendChart, ProfitTrendChart) — no Recharts
  ↓
Export / Print:
  ✅ saveExportedFile (fileDownload.ts) — native Filesystem + Share
  ✅ printDocumentNativeFallback (nativePrintFallback.ts) — native PDF share
  ❌ Legacy: anchor.click blob, window.print(), clipboard-as-export
```

**Data source:** All four modules are **100% client-side local store**. Server RPC layer in `shopReporting.ts` exists but has **zero consumers** in the UI.

### Module entry points

| Module | Route | Page | Shell / orchestrator |
|--------|-------|------|----------------------|
| Investigation Center | `/office/audit-center` | `AuditCenterPage.tsx` | `EnterpriseInvestigationShell.tsx` |
| Reports | `/reports` | `ReportsPage.tsx` | `EnterpriseReportsShell.tsx` |
| Profit Center | `/profit` | `ProfitPage.tsx` | (standalone + embedded in Reports) |
| Command Center | `/owner` | `OwnerDashboardPage.tsx` | `EnterpriseDashboardShell.tsx` |

**Naming collision:** `EnterpriseAuditCenterPage` (`/enterprise/audit`) is a separate multi-org Supabase RPC viewer — not the shop Investigation Center.

### Widget registry pattern

Investigation Center and Command Center both use a **widget registry + slot renderer** pattern:

- Investigation: `enterpriseInvestigationRegistry.tsx` → `retailWidgets.tsx`, `pharmacyWidgets.tsx`
- Command Center: `enterpriseDashboardRegistry.tsx` → `retailDashboardWidgets.tsx` + mode extensions

Reports uses a similar registry: `enterpriseReportsRegistry.tsx` → `retailReportWidgets.tsx`.

---

## PART 2 — Investigation Center Audit

**Entry:** `App.tsx` → `RoleProtectedRoute permission="owner.activity"` + `SensitiveActionGate kind="access_reports"` → `AuditCenterPage` → `EnterpriseInvestigationShell`

### Filters, search, pagination

| Mechanism | Status | Notes |
|-----------|--------|-------|
| Date presets / custom range | ✅ Working | `InvestigationDateFilter.tsx`; URL sync for `from`/`to` |
| Advanced filters (staff, action, product, customer, supplier) | ✅ Working | Live-apply on change; footer "Apply" is cosmetic close only |
| Free-text search | ✅ Working | Debounced 250ms; indexed via `auditSearch.ts` |
| Category chips | ✅ Working | URL `category` param |
| KPI filter | ✅ Working | Narrows timeline after base filter |
| Include archived | ✅ Working | Deferred via `useDeferredReportingAuditLogs` |
| Pagination | ⚠️ Hard cap | `AUDIT_FILTER_RESULT_LIMIT = 200`; no load-more |
| URL sync gaps | ⚠️ Partial | `productId`/`customerId`/`supplierId` not in URL |

### KPIs

| KPI | Status | Issue |
|-----|--------|-------|
| Activity counts by category | ✅ | Memoized via `computeInvestigationKpis` |
| Refunds KPI | 🔴 Bug | Uses `.slice(0, 25)` count — **caps at 25**, not true period total |
| Pharmacy KPIs | ⚠️ | `near_expiry` and `expired_medicines` share same audit filter |
| Refund integrity | ✅ | Separate from KPI count via `auditRefundIntegrity` |

### Export and print

| Action | Handler | Android status |
|--------|---------|----------------|
| CSV | `downloadBlob` → raw anchor | 🔴 **BROKEN** |
| Excel (BOM CSV) | `downloadBlob` → raw anchor | 🔴 **BROKEN** |
| PDF (jsPDF, max 500 rows) | `downloadBlob` → raw anchor | 🔴 **BROKEN** |
| JSON | `downloadBlob` → raw anchor | 🔴 **BROKEN** |
| Print | `printHtmlDocument` → iframe | 🔴 **BROKEN** (returns false on native) |
| Share | `shareText` → Web Share API | ⚠️ Unreliable (not Capacitor Share) |

**Export scope risk:** All bulk exports use `filtered` array capped at **200 rows** — exports do not bypass the filter limit.

### Drill-down, navigation, loading

- Timeline: virtualized when rows > 24 (`VirtualizedActivityTimeline.tsx`)
- Staff tab: one virtualizer per staff group (performance risk at scale)
- No polling — data refreshes via store updates from sync
- Side effect on mount: `useMarkOwnerRisksReviewed` patches `ownerRisksReviewedAt`

### Broken / no-op actions

| Action | Location | Issue |
|--------|----------|-------|
| Bookmark | `ActivityActionsSheet.tsx:43` | Closes sheet only — no bookmark logic |
| Report issue | `retailWidgets.tsx:189` | Duplicate of share, not distinct flow |
| Filters "Apply" | `InvestigationFiltersSheet.tsx` | Cosmetic close; filters already live-applied |

### Permissions

- Route: `owner.activity` (owner, manager, supervisor — not cashier/waiter)
- Sensitive step-up: `access_reports` biometric gate
- Export: **no separate export permission** — anyone passing route gates can export all visible rows

### Dead code

- Empty widget arrays: `hospitalityWidgets.ts`, `wholesaleWidgets.ts`
- Unpopulated slots: `alerts`, `quick-actions`, `timeline-categories`
- Legacy drawer: `AuditDetailDrawer.tsx` — zero imports
- Non-indexed filter: `filterAuditLogs` in `auditSearch.ts` — tests only

---

## PART 3 — Reports Audit

**Entry:** `ReportsPage.tsx` → `EnterpriseReportsShell.tsx`  
**Permission:** `reports.view`; profit tab/KPI gated by `reports.profit`

### Report types and calculation sources

| Category | Calculation source | Status |
|----------|-------------------|--------|
| Overview (KPIs, sparkline, payment mix) | `useShopReportBundle` → `localGetRangeSummary`; `computeRangeAnalytics` | ✅ |
| Sales (revenue, count, trend) | `localGetRangeSummary`; `trendBars` | ✅ |
| Profit | `computeTodayProfitBreakdown`; embedded `ProfitPage` | ✅ (gross, not net) |
| Products (top/slow sellers) | `rankProducts` / `localGetTopProducts` | ✅ |
| Inventory (stock value, low/out-of-stock) | `localGetInventoryInsights` → `inventoryValueAtCostUgx` | ✅ |
| Customers | `localGetCustomerInsights` | ✅ |
| Debts | `report.debtOutstanding` | ✅ |
| Expenses | `sumCashExpensesInBounds` | ⚠️ Label says "today" regardless of filter |
| Purchases | `purchasesTodayUgx` (day-scoped); `purchaseTotal` (all-time) | ⚠️ Ignores date range for totals |
| Cash flow | Revenue, expenses, purchases, cash | ✅ |
| Employees (top cashiers) | `computeTopCashiers` | ✅ |
| Taxes | `taxesUgx` | 🔴 **Always 0** — stub |
| Performance (monthly) | `buildMonthlyBusinessReport` | ✅ |
| Forecast | — | 🔴 Empty placeholder |

Mode-specific panels (pharmacy expiry, wholesale receivables, hospitality) have working PDF/CSV via dedicated export modules.

### Calculations

**COGS method:** Snapshot-at-sale via `finalizeSaleLineFinancials` / `resolveSaleLineFinancials` — reporting reads frozen line snapshots, not live product cost.

**Profit formula (shared across Reports and Profit Center):**

```
grossProfit = sum(saleLine.amount - saleLine.cogs) - returnReversals
revenue = computeCanonicalRevenueUgx (net of external refunds)
```

**Consistency:** `reportingConsistency.test.ts` certifies alignment across `getCompletedFinancials`, `localGetDailySalesSummary`, `computeProfitGroupedByCategory`, and `buildDailyReportText`.

**Known inconsistencies:**

1. **"Net profit" vs gross profit** — Reports KPI and Profit tab show gross margin; only Monthly report computes `netProfitUgx = profitUgx - cashExpensesUgx`
2. **Taxes hard-coded to 0** — `localReporting.ts:209,466`
3. **Purchases/expenses date labels** — say "today" while filter may be week/month
4. **Legacy financial lines** — `financialDataStatus === "legacy"|"needs_repair"` → COGS/profit forced to 0

### Filters

| Filter | Status | Issue |
|--------|--------|-------|
| Date range (presets + custom) | ✅ | Default: month-to-date |
| Archived sales auto-enable | ✅ | When range requires archived data |
| Compare prior period | ✅ | Second `localGetRangeSummary` pass |
| Category tabs | ✅ | Profit tab hidden without `canProfit` |
| Search box | 🔴 **Non-functional** | UI state only — not connected to report data |

### Export paths

| Button | Actual behavior | Android status |
|--------|-----------------|----------------|
| PDF | `downloadDailyReportPdf` → jsPDF → `saveExportedFile` | ✅ **Single-day only**; multi-day shows hint |
| CSV | `navigator.clipboard.writeText` | 🔴 **Mislabeled** — not a file |
| Excel | Same clipboard copy | 🔴 **Mislabeled** — not a file |
| Print | `printHtmlDocument` → iframe | 🔴 **BROKEN** on native |
| Share | `shareText` → Web Share API | ⚠️ Unreliable |
| Copy | Clipboard | ✅ |

**Monthly Reports panel (Performance tab):** Real PDF/CSV/Excel/Word via `monthlyBusinessReport.ts` — PDF native branch uses `doc.save()` (broken on Android); CSV/Word OK.

### Charts

All custom SVG/CSS — no Recharts/Chart.js:

- `MiniSparkline` — KPI grid sparklines
- `AnalyticsTrendChart` — overview trend (SVG)
- `AnalyticsBarChart` — sales bar trend (CSS gradient)
- `AnalyticsDonutChart` — payment mix (CSS conic-gradient)

Responsive via `viewBox` + `w-full`; horizontal scroll on KPI grid.

---

## PART 4 — Profit Center Audit

**Entry:** `ProfitPage.tsx` (standalone) + embedded in Reports → Profit category  
**Permission:** `reports.profit` (route + `resolveProfitVisibility`)

### Calculations

| View | Function | Status |
|------|----------|--------|
| Profit totals | `computeTodayProfitBreakdown` | ✅ Aligned with Reports |
| By shelf/category | `computeProfitGroupedByCategory` | ✅ |
| Product ranking | `flattenProfitProducts` | ✅ |
| Daily trend | `computeDailyProfitTrend` | ✅ |
| Margin % | `marginPercent` | ✅ |
| Low margin list | Threshold 10% | ✅ |
| Missing cost lines | `unitCostUgx <= 0` banner | ✅ |

**Naming bug:** UI says "Net Profit" (`ProfitStatGrid.tsx:70`) but value is **gross profit before expenses**.

### Filters

Same date infrastructure as Reports plus:
- Quick filters: all / highest / lowest / loss / shelves / products
- Search: name, shelf, barcode/SKU
- Include archived returns + sales

### Export

| Trigger | Behavior | Android status |
|---------|----------|----------------|
| Export button | `shareText` only (Web Share API) | 🔴 **Not a file download** |
| Multi-day | Manual text lines via share | 🔴 Same |
| Link to Reports | `/reports?tab=profit` (legacy param stripped) | — |

**No PDF/CSV/Excel/print** on standalone Profit page.

### Charts

`ProfitTrendChart` — custom SVG area/line chart; requires ≥2 days of data.

---

## PART 5 — Command Center Audit

**Entry:** `OwnerDashboardPage.tsx` → `EnterpriseDashboardShell.tsx`  
**Permission:** `owner.dashboard` (**owner role only** — manager cannot access)

### Dashboard KPIs and widgets

| Widget | Source | Status |
|--------|--------|--------|
| Health hero (score ring) | `computeHealthScore` heuristic | ✅ |
| KPI grid (revenue, profit, sales, customers, avg sale, cash) | `buildOwnerCommandCenterBundle` | ✅ |
| Financial grid (payment mix bar) | Bundle financial section | ✅ |
| Attention section (critical/warning/info) | Bundle attention items | ✅ |
| Inventory widgets | Bundle inventory section | ✅ |
| Sync status | `useSyncStatus` (toolbar label) | ✅ Display only |
| Device health | `useOwnerDeviceHealth` (60s poll) | ✅ |
| Integrity cards | `buildCloudRecoverySnapshotFromStore` | ✅ |

### Refresh behavior

- Bundle cached via `getCachedOwnerCommandCenterBundle` fingerprint
- Deferred sales/audit via `useDeferredValue`
- Auto-include archived when date range requires it
- **No explicit refresh button**
- Device health polls every 60s; sync is global via `SyncStatusProvider`

### Export

| Button | Handler | Android status |
|--------|---------|----------------|
| Header Export | `buildCommandCenterExportText` → `shareText` | 🔴 Not a file |
| Footer Export | Same handler | 🔴 Duplicate |
| Footer Share | Same handler | 🔴 Duplicate |

**No print button.** No CSV/PDF export.

### Broken search

`filterAttentionByQuery` matches `item.titleKey` (i18n key string like `"ownerAttentionShiftShortage"`), **not translated title or detail text** — user-facing search misses most items.

### Permission asymmetry

Investigation Center requires biometric step-up (`access_reports`); Command Center does not.

---

## PART 6 — Export System Certification (P0)

### Canonical path (correct)

```
Button → saveExportedFile(filename, blob, mime)
  ↓
Capacitor.isNativePlatform()?
  YES → Filesystem.writeFile (Cache) → Filesystem.getUri → Share.share (system sheet)
  NO  → navigator.share({files}) OR anchor.click(blob URL)
```

**File:** `src/lib/fileDownload.ts:81-128`

### Legacy paths (broken on Android)

| Pattern | Files | Why it fails |
|---------|-------|--------------|
| `URL.createObjectURL` + `anchor.click()` | Investigation shell, X Report CSV, shift CSV, inventory count CSV, pharmacy expiry | WebView has no DownloadListener; click is no-op |
| `window.print()` / iframe print | Reports, Investigation, monthly report, shifts, pharmacy, stock | Explicitly returns false on native; WebView print unsupported |
| `window.open().print()` | Shift PDF, pharmacy patient/prescription print | Popup blocked or print unsupported |
| `jsPDF.doc.save()` | Monthly report PDF native branch | Browser download semantics — same as anchor |
| `navigator.clipboard.writeText` as "CSV" | Reports CSV/Excel buttons | Not a file; may fail without permission |
| `shareText` / `navigator.share({text})` | Profit, Command Center, Reports share | Web Share API, not Capacitor Share; may be absent |

### Export status matrix

| Surface | CSV | PDF | Excel | Print | Share |
|---------|-----|-----|-------|-------|-------|
| Investigation Center | 🔴 | 🔴 | 🔴 | 🔴 | ⚠️ |
| Reports (toolbar) | 🔴 clipboard | ✅ daily only | 🔴 clipboard | 🔴 | ⚠️ |
| Reports (monthly panel) | ✅ | 🔴 native | ✅ | 🔴 | — |
| Profit Center | — | — | — | — | 🔴 |
| Command Center | — | — | — | — | 🔴 |
| Cash Position | ✅ | ✅ | ✅ | ✅ | ✅ |
| Receipts | — | ✅ | — | ✅ | ✅ |
| X Report | 🔴 | ✅ | — | ✅ | ✅ |
| Open Shifts | 🔴 | 🔴 | — | — | — |

### Dependencies

- **Present:** `jspdf` (^3.0.4), `@capacitor/filesystem` (^8.1.2), `@capacitor/share` (^8.0.1)
- **Absent:** `xlsx`, `papaparse`, `pdfmake` — "Excel" exports are CSV with `.xls` mime or BOM-prefixed CSV
- `vite.config.ts` references `xlsx` chunk but package not installed

---

## PART 7 — Print Certification

### Print paths

| Path | Mechanism | Web | Android | Electron |
|------|-----------|-----|---------|----------|
| iframe print | `printHtmlDocument` → hidden iframe → `win.print()` | ✅ | 🔴 no-op | ✅ |
| Native PDF share | `printDocumentNativeFallback` → jsPDF blob → Share sheet | — | ✅ | — |
| Electron IPC | `waka-print` → `webContents.print` | — | — | ✅ (diagnostics only) |
| ESC/POS thermal | `escPosBuilder` → printer adapter (WebUSB/BT/network) | ⚠️ | ⚠️ | ⚠️ network broken |
| Receipt fallback chain | ESC/POS → plain PDF share → sale PDF share | ✅ | ✅ | ✅ |

### Print status by surface

| Surface | Web | Android | Electron |
|---------|-----|---------|----------|
| Reports print | ✅ | 🔴 | ✅ |
| Investigation print | ✅ | 🔴 | ✅ |
| Profit print | — | — | — |
| Monthly report print | ✅ | 🔴 | ✅ |
| Shift summary PDF | ✅ | 🔴 | ✅ |
| Receipts | ✅ | ✅ (PDF share) | ✅ |
| X Report | ✅ | ✅ (native fallback) | ✅ |
| Cash Position | ✅ | ✅ (native fallback) | ✅ |
| Pharmacy compliance | ✅ | 🔴 direct window.print | ✅ |
| Stock page | ✅ | 🔴 direct window.print | ✅ |

### Electron print bridge

```53:68:electron/main.cjs
ipcMain.handle("waka-print", async (_event, opts) => {
  win.webContents.print({ silent: Boolean(opts?.silent), printBackground: true }, ...);
});
```

**Not wired into BI export sheets.** Only used in `HardwareSettingsPage.tsx` diagnostics.

**`escPosNetwork` declared in global types but NOT exposed in `preload.cjs`** — LAN thermal print from Electron is dead.

---

## PART 8 — Performance Certification

### Optimizations present

| Technique | Where | Impact |
|-----------|-------|--------|
| `useDeferredValue` on sales/audit | All BI modules | Prevents UI freeze during store updates |
| `getCachedComputation` fingerprint cache | `useShopReportBundle`, owner bundle | Avoids recomputation on unchanged inputs |
| `createReportFinancialCache` | Week/month daily loops | Memoizes per-day financials |
| Virtualized timeline | Investigation Center (>24 rows) | Handles large audit logs |
| `timedComputation` wrapper | Reporting hooks | Profiling support |
| Scalability test | `enterprisePerformanceScalability.test.ts` | 100k sales target < 4s for range summary |

### Performance risks at enterprise scale (100k sales, 50k products, 20k customers)

| Risk | Location | Severity |
|------|----------|----------|
| Weak cache fingerprint (`length:firstId:lastId`) | `computationResultCache.ts:33-37` | 🔴 Stale cache hits after mid-array edits |
| Full audit index rebuild on log change | Investigation shell | ⚠️ O(n log n) per change |
| Sparkline 7× sales scan | `commandCenterPageView.ts:122-129` | ⚠️ Per recompute |
| `computeDailyProfitTrend` per-day breakdown | Profit page | ⚠️ O(days × sales_in_day) |
| Double `localGetRangeSummary` when compare enabled | Reports analytics | ⚠️ 2× cost |
| All sales loaded into memory | `ensureAllActiveSalesLoaded` | ⚠️ Memory pressure at 100k+ |
| Investigation export capped at 200 rows | `auditSearch.ts` | ⚠️ Incomplete exports |
| Staff tab N virtualizers | Investigation staff section | ⚠️ At many staff members |
| Filter sheet full catalog sort | Investigation filters | ⚠️ On each render |

### Estimated bottlenecks at scale

- **Report generation:** Acceptable (< 4s certified) but heavy on filter change
- **Chart rendering:** Lightweight (custom SVG) — not a bottleneck
- **Export generation:** jsPDF on 500+ rows may block main thread
- **Filtering/sorting:** Indexed audit search is efficient; product/customer sorts are not

---

## PART 9 — Charts Certification

| Chart | Component | Library | Responsive | Print | Export |
|-------|-----------|---------|------------|-------|--------|
| KPI sparkline | `MiniSparkline` | Custom SVG | ✅ viewBox | ⚠️ via print HTML | — |
| Overview trend | `AnalyticsTrendChart` | Custom SVG | ✅ | ⚠️ | — |
| Sales bar trend | `AnalyticsBarChart` | CSS gradient | ✅ | ⚠️ | — |
| Payment donut | `AnalyticsDonutChart` | CSS conic-gradient | ✅ | ⚠️ | — |
| Profit trend | `ProfitTrendChart` | Custom SVG | ✅ | — | — |
| Health ring | `CommandCenterHealthHero` | Custom SVG | ✅ | — | — |
| Financial payment bar | `CommandCenterFinancialGrid` | CSS bar | ✅ | — | — |

**No animation libraries.** Charts are static SVG/CSS — performant but no interactivity (hover tooltips, drill-down).

**Print compatibility:** Charts render in DOM but print paths use preformatted text (`<pre>`) — charts are **not included in print output**.

---

## PART 10 — Offline Certification

| Module | Offline data source | Stale risk |
|--------|-------------------|------------|
| Investigation Center | Local store + IndexedDB | Low — store is authoritative; pending sync sales included |
| Reports | Local store via `useShopReportBundle` (`source: "local"`) | Low — same |
| Profit Center | Local store | Low — same |
| Command Center | Local store + 60s device health poll | Low for financials; device health stale when offline |

**No network dependency** for calculations or display in any module.

**Stale risks:**
- Weak computation cache fingerprint may serve stale results after partial sales mutations
- Archived data requires explicit include toggle
- Device health poll fails silently when offline
- `shopReporting.ts` server RPC returns `{ data: null, error: "offline" }` but is unused

**Reconnect behavior:** Store updates from `SyncStatusProvider` realtime pull refresh all modules automatically. No explicit "refresh" action needed but also no "last updated" timestamp shown.

---

## PART 11 — Permissions Certification

| Permission | Investigation | Reports | Profit | Command Center |
|------------|--------------|---------|--------|----------------|
| `owner.activity` | ✅ Route gate | — | — | — |
| `owner.dashboard` | — | — | — | ✅ Route gate (owner only) |
| `reports.view` | — | ✅ Route gate | — | — |
| `reports.profit` | — | ✅ Tab/KPI/export | ✅ Route gate | — |
| `access_reports` (biometric) | ✅ SensitiveActionGate | — | — | — |
| Export permission | ❌ None | ❌ None | ❌ None | ❌ None |

**Role access:**

| Role | Investigation | Reports | Profit | Command Center |
|------|--------------|---------|--------|----------------|
| Owner | ✅ | ✅ | ✅ | ✅ |
| Manager | ✅ | ✅ | ✅ (if entitled) | ❌ |
| Supervisor | ✅ | ✅ | ❌ | ❌ |
| Cashier | ❌ | ❌ | ❌ | ❌ |

**Subscription gating:** Free tier blocks `reports.profit` (`subscriptionEntitlements.ts:57`).

**Export is not separately permission-gated** in any module — anyone who can view can export.

---

## PART 12 — Large Dataset Certification

| Dataset size | Operation | Estimated performance | Bottleneck |
|-------------|-----------|----------------------|------------|
| 100k sales | `localGetRangeSummary` | < 4s (certified) | Full array scan |
| 100k sales | Profit grouped by category | 2-4s | Per-line COGS resolution |
| 100k sales | Daily profit trend (30 days) | 3-6s | 30 × daily breakdown |
| 50k products | Product rank / inventory insights | 1-2s | Product map lookup |
| 20k customers | Customer insights | 1-2s | Customer sales index |
| 20k audit logs | Investigation index build | 1-3s | Sort + haystack per entry |
| 20k audit logs | Investigation export | **200 rows max** | Hard cap |

**Memory:** All active sales loaded into Zustand store — ~100k sales × ~2KB/line ≈ 200MB+ in memory.

**Virtualization:** Investigation timeline virtualized; Reports/Profit/Command Center lists are not virtualized (attention cards, product rankings).

---

## PART 13 — Android Certification

### Capacitor setup

```8:18:android/app/src/main/java/ug/waka/pos/MainActivity.java
public class MainActivity extends BridgeActivity {
  // registerPlugin, edge-to-edge only
  // NO DownloadListener
  // NO WebViewClient download handler
  // NO print service
}
```

### What works on Android

- `saveExportedFile` → Filesystem + Share sheet (Cash Position, receipt PDFs, daily report PDF single-day, purchases/supplier exports)
- `printDocumentNativeFallback` → PDF share (X Report print, Cash Position print, receipt print chain)
- ESC/POS via Bluetooth (if paired printer)

### What fails on Android

- All Investigation Center exports (raw anchor)
- Reports CSV/Excel (clipboard, not file)
- Reports print (iframe no-op)
- Profit/Command Center export (shareText only)
- Shift summary CSV/PDF (raw anchor + popup print)
- X Report CSV (raw anchor)
- Monthly report PDF (doc.save()) and print (iframe)
- Pharmacy compliance/expiry print (direct window.print)
- Stock page print (direct window.print)

### File saving

No silent "Save to Downloads" — user must pick destination via system share sheet. This is by design but may confuse users expecting automatic download.

### Storage permissions

Capacitor Filesystem uses `Directory.Cache` — no external storage permission needed. Share sheet handles file handoff.

---

## PART 14 — Windows / Electron Certification

### Electron wrapper

- Entry: `electron/main.cjs` loads `dist/index.html`
- Build: `npm run build:electron` → `npm run package:windows`
- Print: IPC `waka-print` → `webContents.print` — works but **not wired into BI**
- Downloads: Standard Chromium — anchor blob downloads work
- ESC/POS network: **Broken** — `escPosNetwork` not in preload

### Windows behavior

- All web export/print paths work via Chromium
- Electron print bridge available but unused by BI modules
- No Windows-specific file save dialog — uses browser download

---

## PART 15 — Dead Code Register

| Item | Path | Notes |
|------|------|-------|
| Server RPC reporting | `shopReporting.ts` | Full Supabase RPC layer; zero UI consumers |
| Deprecated profit gates | `homeProfit.ts:10-18` | `canSeeOfficeProfit`, `canSeeHomeProfit` |
| Deprecated analytics composer | `AnalyticsModeReports.tsx:298` | Replaced by registry widgets |
| Legacy tab URL param | `EnterpriseReportsShell.tsx:254-259` | Strips `?tab=` |
| `downloadBlobFile` | `fileDownload.ts:131-134` | Deprecated; always returns false |
| `printHtmlDocumentWithDesktop` | `documentPrint.ts:83-89` | Misnamed — no Electron integration |
| `printElectronWindow` | `documentPrint.ts:92-99` | Diagnostics only |
| `buildCoachInsights` | `commandCenterPageView.ts:138-154` | Exported but never called |
| Legacy owner sections | `OwnerAttentionCenterSection.tsx`, etc. | Zero imports |
| Legacy audit drawer | `AuditDetailDrawer.tsx` | Zero imports |
| EnterpriseReportsPage | Stub — links to `/reports`, no calculations |
| EnterpriseAuditCenterPage | Separate cloud RPC viewer |
| `xlsx` vite chunk | `vite.config.ts:54` | Package not installed |
| `enterpriseReporting.ts` exportMimeType | Declares `.xlsx` mime | No xlsx generator |
| Investigation bookmark action | `ActivityActionsSheet.tsx:43` | No-op |
| Reports search box | Toolbar state | Not connected to data |
| Forecast category | Empty placeholder | No implementation |
| Duplicate share/export handlers | Command Center footer | Same handler wired twice |

---

## PART 16 — Root Cause Register

### RC-1: Legacy blob download on Android (P0)

**Symptom:** Export buttons appear to do nothing on Android.  
**Cause:** Multiple BI export handlers use `URL.createObjectURL` + `anchor.click()` instead of `saveExportedFile`. Capacitor WebView has no `DownloadListener`.  
**Evidence:** `EnterpriseInvestigationShell.tsx:277-284`, `shiftReportExport.ts:67-75`, `xReportExport.ts:67-76`, `inventoryCountExport.ts:93-102`  
**Affected:** Investigation Center (all formats), Open Shifts, X Report CSV, inventory count, pharmacy expiry.

### RC-2: iframe window.print() blocked on native (P0)

**Symptom:** Print buttons do nothing on Android.  
**Cause:** `printHtmlDocument` explicitly returns `false` on native platforms. Other print paths call `window.print()` directly without native guard.  
**Evidence:** `documentPrint.ts:34-35`, `EnterpriseInvestigationShell.tsx:321-325`, `EnterpriseReportsShell.tsx:317-323`, `monthlyBusinessReport.ts:237-268`, `shiftReportExport.ts:122`  
**Affected:** Reports print, Investigation print, monthly report print, shift PDF, pharmacy/stock print.

### RC-3: CSV/Excel mislabeled as clipboard copy (P0)

**Symptom:** User taps "Export CSV" expecting a file; gets clipboard copy or nothing.  
**Cause:** Reports CSV/Excel handlers call `navigator.clipboard.writeText` instead of `saveExportedFile`.  
**Evidence:** `EnterpriseReportsShell.tsx:307-315`  
**Affected:** Reports toolbar CSV and Excel buttons.

### RC-4: Profit/Command Center export is share-text only (P0)

**Symptom:** Export button opens share sheet with plain text or does nothing.  
**Cause:** `exportReport` and `exportDashboard` call `shareText` (Web Share API) with no file generation.  
**Evidence:** `ProfitPage.tsx:171-196`, `OwnerDashboardPage.tsx:245-256`, `reportExport.ts:87-98`  
**Affected:** Profit Center, Command Center.

### RC-5: Monthly report PDF uses doc.save() on native (P0)

**Symptom:** Monthly PDF export fails silently on Android.  
**Cause:** Native branch calls `jsPDF.doc.save()` (browser download) instead of `doc.output("blob")` + `saveExportedFile`.  
**Evidence:** `monthlyBusinessReport.ts:327-329`  
**Affected:** Reports → Performance → Monthly PDF.

### RC-6: Refunds KPI capped at 25 (P1)

**Symptom:** Refunds KPI shows ≤25 even when period has more returns.  
**Cause:** `returnsInRange` passed to KPI computation is `.slice(0, 25)`.  
**Evidence:** `EnterpriseInvestigationShell.tsx:126`  
**Affected:** Investigation Center refunds KPI card.

### RC-7: Export scope capped at 200 rows (P1)

**Symptom:** Investigation exports contain at most 200 entries regardless of filter.  
**Cause:** `AUDIT_FILTER_RESULT_LIMIT = 200` in indexed filter; exports use same capped array.  
**Evidence:** `auditSearch.ts:17,212-233`, `EnterpriseInvestigationShell.tsx:286-318`  
**Affected:** Investigation Center all bulk exports.

### RC-8: Gross profit labeled as "Net Profit" (P1)

**Symptom:** Profit Center shows "Net Profit" but value excludes cash expenses.  
**Cause:** UI label in `ProfitStatGrid.tsx:70` does not match calculation (gross only).  
**Evidence:** `ProfitStatGrid.tsx:70`, `homeProfit.ts:52-97` vs `monthlyBusinessReport.ts:103-105`  
**Affected:** Profit Center, Reports profit KPI.

### RC-9: Purchases/expenses ignore date range (P1)

**Symptom:** Purchases tab shows "today" totals when filter is week/month; purchase total is all-time.  
**Cause:** `purchasesTodayUgx` is day-scoped; `purchaseTotal` sums all purchases ever.  
**Evidence:** `EnterpriseReportsShell.tsx:106-108`, `AnalyticsCategoryContent.tsx:212-221`  
**Affected:** Reports purchases and expenses tabs.

### RC-10: Taxes report non-functional (P2)

**Symptom:** Taxes category always shows 0.  
**Cause:** `taxesUgx` hard-coded to 0 in range summary.  
**Evidence:** `localReporting.ts:209,466`  
**Affected:** Reports taxes tab.

### RC-11: Reports search box non-functional (P2)

**Symptom:** Search input in Reports toolbar has no effect.  
**Cause:** `searchQuery` state is not connected to any data filter.  
**Evidence:** `AnalyticsPageToolbar.tsx:32-38`  
**Affected:** Reports toolbar.

### RC-12: Command Center attention search matches i18n keys (P2)

**Symptom:** Attention search misses items unless query matches internal key string.  
**Cause:** `filterAttentionByQuery` matches `titleKey` not translated text.  
**Evidence:** `commandCenterPageView.ts:327-334`  
**Affected:** Command Center attention search.

### RC-13: Weak computation cache fingerprint (P1)

**Symptom:** Stale report data after partial sales mutations at scale.  
**Cause:** Fingerprint uses `length:firstId:lastId` only.  
**Evidence:** `computationResultCache.ts:33-37`  
**Affected:** All cached report computations.

### RC-14: shareText uses Web Share API not Capacitor Share (P1)

**Symptom:** Share buttons fail silently on Android WebView.  
**Cause:** `shareText` calls `navigator.share({text})` without Capacitor fallback.  
**Evidence:** `reportExport.ts:87-98`  
**Affected:** Profit, Command Center, Reports share, Investigation share.

---

## PART 17 — Enterprise Comparison

| Capability | WAKA POS (current) | Shopify Analytics | Square Dashboard | Lightspeed Reports | Toast Reporting |
|------------|-------------------|-------------------|------------------|--------------------|-----------------|
| **Dashboard KPIs** | ✅ Local, fast | ✅ Cloud, real-time | ✅ Cloud | ✅ Cloud | ✅ Cloud |
| **Date range filters** | ✅ Presets + custom | ✅ | ✅ | ✅ | ✅ |
| **Drill-down** | ⚠️ Limited (KPI filter) | ✅ Deep | ✅ | ✅ | ✅ |
| **CSV export** | 🔴 Broken/mislabeled | ✅ | ✅ | ✅ | ✅ |
| **PDF export** | ⚠️ Partial (daily only) | ✅ | ✅ | ✅ | ✅ |
| **Excel export** | 🔴 Clipboard only | ✅ | ✅ | ✅ | ✅ |
| **Print** | 🔴 Broken on mobile | ✅ | ✅ | ✅ | ✅ |
| **Offline reports** | ✅ Full local | ❌ | ⚠️ Limited | ⚠️ Limited | ❌ |
| **Profit/margin** | ✅ Gross (mislabeled) | ✅ | ✅ | ✅ | ✅ |
| **Inventory reports** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Staff/shift reports** | ✅ | ⚠️ | ✅ | ✅ | ✅ |
| **Tax reports** | 🔴 Stub (always 0) | ✅ | ✅ | ✅ | ✅ |
| **Compare periods** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Mobile export** | 🔴 Broken | ✅ | ✅ | ✅ | ✅ |
| **Charts** | ⚠️ Static SVG | ✅ Interactive | ✅ | ✅ | ✅ |
| **Audit trail** | ✅ Investigation Center | ⚠️ | ✅ | ✅ | ✅ |
| **Permissions** | ✅ Role-based | ✅ | ✅ | ✅ | ✅ |
| **Large dataset** | ⚠️ 100k certified | ✅ Cloud-scale | ✅ | ✅ | ✅ |

**WAKA POS advantages:** Offline-first (full BI without network), Investigation Center audit trail, local data sovereignty.  
**WAKA POS gaps:** Export/print on mobile, mislabeled actions, no real Excel, no interactive charts, taxes stub, no deep drill-down.

---

## PART 18 — Phase 26.1 Implementation Blueprint

### P0 — Export & Print (must fix before production rollout)

| # | Task | Files | Effort |
|---|------|-------|--------|
| 1 | Replace all raw `downloadBlob` / anchor patterns with `saveExportedFile` | Investigation shell, shiftReportExport, xReportExport, inventoryCountExport, PharmacyExpiryCenterPage | 1 day |
| 2 | Route all print buttons through `printDocumentNativeFallback` on native | EnterpriseReportsShell, EnterpriseInvestigationShell, monthlyBusinessReport, shiftReportExport | 1 day |
| 3 | Fix Reports CSV/Excel to generate real files via `saveExportedFile` | EnterpriseReportsShell.tsx | 0.5 day |
| 4 | Fix monthly report PDF native branch: `doc.output("blob")` + `saveExportedFile` | monthlyBusinessReport.ts:327-329 | 0.5 day |
| 5 | Add file export to Profit Center (CSV/PDF via existing generators) | ProfitPage.tsx | 0.5 day |
| 6 | Add file export to Command Center (text/CSV via `buildCommandCenterExportText`) | OwnerDashboardPage.tsx | 0.5 day |
| 7 | Route `shareText` through Capacitor `Share.share({ text })` on native | reportExport.ts | 0.5 day |
| 8 | Fix direct `window.print()` calls (pharmacy, stock) to use native fallback | PharmacyComplianceReportsPage, PharmacyExpiryCenterPage, StockPage | 0.5 day |

**P0 total: ~5 days**

### P1 — Accuracy, Performance, Filters

| # | Task | Files | Effort |
|---|------|-------|--------|
| 9 | Fix refunds KPI cap (remove `.slice(0, 25)` from count) | EnterpriseInvestigationShell.tsx:126 | 0.5 day |
| 10 | Allow Investigation exports to bypass 200-row filter cap (or paginate) | auditSearch.ts, EnterpriseInvestigationShell.tsx | 1 day |
| 11 | Rename "Net Profit" to "Gross Profit" or compute true net | ProfitStatGrid.tsx, Reports KPI | 0.5 day |
| 12 | Fix purchases/expenses date range scoping and labels | AnalyticsCategoryContent.tsx, EnterpriseReportsShell.tsx | 1 day |
| 13 | Strengthen computation cache fingerprint | computationResultCache.ts | 0.5 day |
| 14 | Wire Reports search box to filter data | AnalyticsPageToolbar.tsx, EnterpriseReportsShell.tsx | 1 day |
| 15 | Fix Command Center attention search to match translated text | commandCenterPageView.ts:327-334 | 0.5 day |
| 16 | Deduplicate Command Center export/share handlers | CommandCenterExecutiveFooter.tsx | 0.5 day |

**P1 total: ~5.5 days**

### P2 — BI Polish & Advanced Analytics

| # | Task | Files | Effort |
|---|------|-------|--------|
| 17 | Implement taxes report (or hide category until ready) | localReporting.ts, AnalyticsCategoryContent.tsx | 2 days |
| 18 | Add interactive chart tooltips and drill-down | AnalyticsCharts.tsx, ProfitTrendChart.tsx | 2 days |
| 19 | Include charts in print/PDF output | dailyReportPdf.ts, print paths | 1 day |
| 20 | Remove dead code (shopReporting.ts RPC, legacy components) | Multiple | 1 day |
| 21 | Add "last updated" timestamp to BI modules | All shells | 0.5 day |
| 22 | Virtualize attention lists and product rankings at scale | CommandCenterAttentionSection, profit rankings | 1 day |
| 23 | Wire Electron print bridge into BI export sheets | documentPrint.ts, electron/preload.cjs | 1 day |
| 24 | Implement Forecast category or remove from navigation | enterpriseReportsRegistry.tsx | 1 day |
| 25 | Add export permission gate separate from view permission | All shells | 1 day |

**P2 total: ~10.5 days**

### Phase 26.1 success criteria

After Phase 26.1:

- [ ] All export buttons produce downloadable files on Android (via Share sheet)
- [ ] All print buttons open print dialog or PDF share on Android
- [ ] Reports CSV/Excel generate real files, not clipboard copies
- [ ] Profit Center and Command Center have file export (not share-text only)
- [ ] Refunds KPI shows true period count
- [ ] Investigation exports include all filtered rows (not capped at 200)
- [ ] Profit labeled correctly (gross vs net)
- [ ] Purchases/expenses respect date range filter
- [ ] Build and all tests pass with no business logic changes

**Target outcome:** Increase BI layer reliability from **5.4 → 9.0+ / 10**, delivering export/print/calculation behavior comparable to leading enterprise POS analytics platforms while preserving WAKA POS's offline-first advantage.

---

## Appendix — Key file index

| Purpose | Path |
|---------|------|
| Canonical file save | `src/lib/fileDownload.ts` |
| Print (iframe + PDF share) | `src/lib/documentPrint.ts` |
| Native print fallback | `src/lib/nativePrintFallback.ts` |
| Native platform detection | `src/lib/nativePrintPlatform.ts` |
| Financial engine | `src/lib/saleFinancialEngine.ts` |
| Profit calculations | `src/lib/homeProfit.ts` |
| Local reporting | `src/lib/localReporting.ts` |
| Report export text | `src/lib/reportExport.ts` |
| Daily report PDF | `src/lib/dailyReportPdf.ts` |
| Monthly report | `src/lib/monthlyBusinessReport.ts` |
| Audit export | `src/lib/auditExport.ts` |
| Audit search | `src/lib/auditSearch.ts` |
| Investigation shell | `src/features/investigation-center/EnterpriseInvestigationShell.tsx` |
| Reports shell | `src/features/business-analytics/EnterpriseReportsShell.tsx` |
| Profit page | `src/pages/ProfitPage.tsx` |
| Command Center page | `src/pages/OwnerDashboardPage.tsx` |
| Owner bundle engine | `src/lib/ownerDashboardCommandCenter.ts` |
| Command Center view | `src/lib/commandCenterPageView.ts` |
| Electron main | `electron/main.cjs` |
| Electron preload | `electron/preload.cjs` |
| Android MainActivity | `android/app/src/main/java/ug/waka/pos/MainActivity.java` |
| Consistency tests | `src/lib/reportingConsistency.test.ts` |
| Scalability tests | `src/lib/enterprisePerformanceScalability.test.ts` |

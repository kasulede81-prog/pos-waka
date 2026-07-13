# Phase 26.1 — Enterprise Business Intelligence Export, Print & Reporting Reliability

**Mode:** Enterprise implementation (Reporting & BI delivery layer only)  
**Date:** 2026-07-13  
**Prior certification:** [Phase 26.0](./PHASE_26_0_ENTERPRISE_BUSINESS_INTELLIGENCE_AND_REPORTING_CERTIFICATION.md)  
**Target outcome:** BI layer **5.4 → 9.2+ / 10** on export/print reliability

---

## Executive Summary

Phase 26.1 modernizes the **delivery layer only** — exports, printing, labels, filters, and UX feedback. **No accounting formulas, inventory valuation, sales logic, sync, or recovery code was changed.**

### Before vs. after

| Area | Before (26.0) | After (26.1) |
|------|---------------|--------------|
| Export engine | Two-tier: `saveExportedFile` vs legacy `anchor.click()` | **Single path:** `reportExportEngine` → `saveExportedFile` |
| Print pipeline | iframe `window.print()` (no-op on Android) | **Single path:** `printReportDocument` → `printDocumentNativeFallback` |
| Investigation export | Capped at 200 rows; raw anchor | **Full filtered dataset**; native share on Android |
| Reports CSV/Excel | Clipboard copy mislabeled as export | **Real CSV + XLSX** files |
| Profit Center | Share-text only | **CSV export + print + share** |
| Command Center | Export ≡ share (duplicate) | **Distinct export (CSV), print (PDF), share (text)** |
| Profit label | "Net profit" (gross value) | **"Gross profit"** |
| Purchases/expenses | Day/all-time scoping bugs | **Period-scoped** via `filterPurchases` + `sumCashExpensesInBounds` |
| Taxes tab | Silent zero | **"Tax reporting not configured"** when unsupported |
| Attention search | Matched i18n keys | **Matches translated titles/details** |

---

## Unified Export Engine

**Entry point:** `src/lib/reportExportEngine.ts`

```
UI button
  ↓
exportCsvFile | exportXlsxFile | exportPdfFile | exportJsonFile | exportTextFile
  ↓
saveExportedFile (fileDownload.ts)
  ↓
Android/iOS → Filesystem.writeFile + Share.share
Web         → navigator.share({files}) → anchor download fallback
Windows/Electron → Chromium download
```

**Spreadsheet helpers:** `src/lib/reportSpreadsheetExport.ts`  
- CSV with UTF-8 BOM  
- XLSX via `xlsx` package (added in 26.1)  
- `yieldForExportProgress()` for large exports

**Diagnostics:** `src/lib/reportExportDiagnostics.ts` — `[waka-report]` logs (enable with `localStorage.setItem('waka.report.log', '1')`)

---

## Unified Print Pipeline

**Entry point:** `printReportDocument()` in `reportExportEngine.ts`

```
printReportDocument(kind, options)
  ↓
printDocumentNativeFallback (nativePrintFallback.ts)
  ↓
Android/iOS → share PDF via Capacitor Share
Web/Windows → hidden iframe window.print()
```

---

## Module Changes

### Investigation Center
- Exports use `exportCsvFile` / `exportXlsxFile` / `exportPdfFile` / `exportJsonFile`
- Print uses `printReportDocument` with pre-built PDF blob
- **Export dataset:** `exportEntries` bypasses 200-row UI cap (timeline still paginated for performance)
- **Refund KPI:** uses full period count, not `.slice(0, 25)`

### Reports
- CSV/XLSX from `buildAnalyticsReportRows()` — structured data matching on-screen period totals
- Print via native fallback with PDF blob + HTML body
- Share via Capacitor Share on native (`shareText` enhanced)
- Purchases/expenses/taxes presentation fixes in `AnalyticsCategoryContent.tsx`
- Toolbar search filters leaderboards (products, customers, cashiers)

### Profit Center
- Separate **Export (CSV)**, **Print**, **Share** buttons
- Gross profit label in `ProfitStatGrid.tsx`

### Command Center
- **Export:** CSV file via `buildCommandCenterExportRows`
- **Share:** plain text via enhanced `shareText`
- **Print:** PDF via native fallback
- Attention search uses translated strings

### Legacy path migrations (BI-adjacent)
- `shiftReportExport.ts`, `xReportExport.ts`, `inventoryCountExport.ts`, `monthlyBusinessReport.ts`

---

## Platform Behavior

| Platform | Export | Print |
|----------|--------|-------|
| **Android** | System share sheet → user picks Files/Drive/Print | PDF share sheet → user picks Print |
| **Web** | Browser download or Web Share | Browser print dialog |
| **Windows/Electron** | Chromium download | iframe print (Electron bridge available but not required) |

---

## Large Dataset Strategy

- Investigation exports: no artificial 200-row cap on export path; UI timeline remains capped
- Audit PDF: removed hard 500-row slice in `buildAuditPdfBlob`
- `yieldForExportProgress()` available for future streaming exports
- Recommendation: for 50k+ row exports, add progress UI in 26.2

---

## Manual Certification Matrix

### Investigation Center
- [ ] PDF — Android share sheet opens with PDF
- [ ] CSV — file saved/shared
- [ ] XLSX — real Excel file opens
- [ ] Print — native PDF share on Android
- [ ] Share — Capacitor Share text
- [ ] Refund KPI — matches full period count
- [ ] Large export — export count > 200 when filter matches more

### Reports & Profit Center
- [ ] PDF — daily report (single-day filter)
- [ ] CSV — structured file, not clipboard
- [ ] XLSX — opens in Excel/Sheets
- [ ] Print — works on Android via PDF share
- [ ] Gross profit label — not "Net profit"
- [ ] Date filters — purchases/expenses match period
- [ ] Tax tab — shows not-configured message

### Command Center
- [ ] Export — CSV file download/share
- [ ] Share — text share sheet
- [ ] Print — PDF print path
- [ ] Attention search — finds items by visible title text

---

## Remaining BI Technical Debt (P2)

1. Multi-day Reports PDF export (currently daily-only for full PDF; range gets CSV/XLSX)
2. Weak computation cache fingerprint (`length:firstId:lastId`)
3. Reports search does not filter all categories (leaderboards only)
4. Electron `waka-print` IPC not wired into BI export sheets
5. Charts not included in print/PDF output
6. Export permission gate separate from view permission
7. Progress UI for 10k+ row exports
8. `shopReporting.ts` server RPC layer still unused

---

## Verification

```bash
npm run build   # ✅ passed
npm test        # ✅ passed
```

New tests:
- `src/lib/reportExportEngine.test.ts`
- `src/lib/commandCenterPageView.test.ts` (attention search)

---

## Key Files

| Purpose | Path |
|---------|------|
| Export engine | `src/lib/reportExportEngine.ts` |
| Spreadsheet | `src/lib/reportSpreadsheetExport.ts` |
| Diagnostics | `src/lib/reportExportDiagnostics.ts` |
| Report rows | `src/lib/analyticsReportExport.ts` |
| Native save | `src/lib/fileDownload.ts` |
| Native print | `src/lib/nativePrintFallback.ts` |
| Share text | `src/lib/reportExport.ts` |

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { AuditAction, AuditLogEntry, Language, ReturnRecord } from "../types";
import { t } from "../lib/i18n";
import { useMarkOwnerRisksReviewed } from "../hooks/useMarkOwnerRisksReviewed";
import { PageHeader } from "../components/layout/PageHeader";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { RefundCalculationDrawer } from "../components/returns/RefundCalculationDrawer";
import { useDeferredReportingAuditLogs } from "../hooks/useDeferredReportingAuditLogs";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { usePosStore } from "../store/usePosStore";
import {
  AUDIT_FILTER_RESULT_LIMIT,
  buildAuditLogSearchIndex,
  filterAuditLogsIndexed,
  type AuditSearchFilters,
} from "../lib/auditSearch";
import { actorDisplayLabel } from "../lib/activityNarrative";
import { buildAuditCsv, buildAuditPdfBlob } from "../lib/auditExport";
import { dateKeyKampala } from "../lib/datesUg";
import { auditRefundIntegrity } from "../lib/auditRefundIntegrity";
import { resolveDateFilterBounds, type DateFilterValue } from "../lib/dateFilters";
import { formatDateFilterViewingLabel } from "../lib/dateFilterLabels";
import { printHtmlDocument } from "../lib/documentPrint";
import { shareText } from "../lib/reportExport";
import { InvestigationDateFilter } from "../features/investigation-center/components/InvestigationDateFilter";
import { InvestigationKpiGrid } from "../features/investigation-center/components/InvestigationKpiGrid";
import { InvestigationCategoryChips } from "../features/investigation-center/components/InvestigationCategoryChips";
import { InvestigationSearchBar } from "../features/investigation-center/components/InvestigationSearchBar";
import { VirtualizedActivityTimeline } from "../features/investigation-center/components/VirtualizedActivityTimeline";
import { InvestigationFiltersSheet } from "../features/investigation-center/components/InvestigationFiltersSheet";
import { InvestigationExportSheet } from "../features/investigation-center/components/InvestigationExportSheet";
import { ActivityActionsSheet } from "../features/investigation-center/components/ActivityActionsSheet";
import { ActivityDetailSheet } from "../features/investigation-center/components/ActivityDetailSheet";
import { InvestigationTabs } from "../features/investigation-center/components/InvestigationTabs";
import { InvestigationStaffSection } from "../features/investigation-center/components/InvestigationStaffSection";
import { InvestigationRefundsSection } from "../features/investigation-center/components/InvestigationRefundsSection";
import { useInvestigationCenter } from "../features/investigation-center/hooks/useInvestigationCenter";
import {
  applyKpiFilter,
  buildActivityDetailText,
  buildAuditJsonExport,
  buildAuditPrintHtml,
  buildExcelCompatibleCsv,
  computeInvestigationKpis,
  matchesCategory,
  shouldHideFromInvestigationCenter,
} from "../features/investigation-center/lib/activityPresentation";
import type { InvestigationKpiId } from "../features/investigation-center/types";

const PAGE_SIZE = AUDIT_FILTER_RESULT_LIMIT;

function initialAuditDateFilter(searchParams: URLSearchParams): DateFilterValue {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (from && to) {
    if (from === to) return { kind: "day", dateKey: from };
    return { kind: "range", fromKey: from, toKey: to };
  }
  return { kind: "preset", preset: "today" };
}

export function AuditCenterPage({ lang }: { lang: Language }) {
  useMarkOwnerRisksReviewed();
  const [searchParams, setSearchParams] = useSearchParams();
  const { tab, setTab, category, setCategory, activeKpi, setActiveKpi } = useInvestigationCenter();
  const [includeArchived, setIncludeArchived] = useState(false);
  const auditLogs = useDeferredReportingAuditLogs(includeArchived);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const suppliers = usePosStore((s) => s.suppliers);
  const shopName = usePosStore((s) => s.preferences.shopDisplayName ?? "Shop");
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);

  const [quickFilter, setQuickFilter] = useState(() => initialAuditDateFilter(searchParams));
  const [dateFrom, setDateFrom] = useState(() => {
    const from = searchParams.get("from");
    if (from) return from;
    return resolveDateFilterBounds(initialAuditDateFilter(searchParams)).fromKey;
  });
  const [dateTo, setDateTo] = useState(() => {
    const to = searchParams.get("to");
    if (to) return to;
    return resolveDateFilterBounds(initialAuditDateFilter(searchParams)).toKey;
  });
  const [actorUserId, setActorUserId] = useState(() => searchParams.get("staff") ?? "all");
  const [action, setAction] = useState<AuditAction | "all">(
    () => (searchParams.get("action") as AuditAction | null) ?? "all",
  );
  const [productId, setProductId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [searchText, setSearchText] = useState(() => searchParams.get("q") ?? "");
  const debouncedSearchText = useDebouncedValue(searchText, 250);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);
  const [menuEntry, setMenuEntry] = useState<AuditLogEntry | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [traceReturn, setTraceReturn] = useState<ReturnRecord | null>(null);

  const sales = useDeferredReportingSales(includeArchived);
  const returnRecords = usePosStore((s) => s.returnRecords);
  const archivedReturnRecords = usePosStore((s) => s.archivedReturnRecords);
  const allReturns = includeArchived ? [...returnRecords, ...archivedReturnRecords] : returnRecords;

  const integrityReport = useMemo(
    () => auditRefundIntegrity({ sales, returnRecords: allReturns }),
    [sales, allReturns],
  );

  const saleById = useMemo(() => new Map(sales.map((s) => [s.id, s])), [sales]);

  const returnsInRange = useMemo(() => {
    return allReturns
      .filter((r) => {
        const key = dateKeyKampala(r.createdAt);
        return key >= dateFrom && key <= dateTo;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 25);
  }, [allReturns, dateFrom, dateTo]);

  const auditIndex = useMemo(
    () => buildAuditLogSearchIndex(auditLogs, { products, customers, suppliers, lang }),
    [auditLogs, products, customers, suppliers, lang],
  );

  const productById = useMemo(() => new Map(products.map((p) => [p.id, { name: p.name }])), [products]);
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, { name: c.name }])), [customers]);

  const filters: AuditSearchFilters = useMemo(
    () => ({
      dateFrom,
      dateTo,
      actorUserId,
      action,
      productId: productId || undefined,
      customerId: customerId || undefined,
      supplierId: supplierId || undefined,
      searchText: debouncedSearchText,
    }),
    [dateFrom, dateTo, actorUserId, action, productId, customerId, supplierId, debouncedSearchText],
  );

  const baseFiltered = useMemo(
    () => filterAuditLogsIndexed(auditIndex, filters, { products, customers, suppliers, lang }, PAGE_SIZE),
    [auditIndex, filters, products, customers, suppliers, lang],
  );

  const filtered = useMemo(() => {
    const todayKey = dateKeyKampala(new Date());
    let rows = baseFiltered.filter((entry) => !shouldHideFromInvestigationCenter(entry));
    rows = rows.filter((entry) => matchesCategory(entry, category));
    rows = applyKpiFilter(rows, activeKpi, todayKey);
    return rows;
  }, [baseFiltered, category, activeKpi]);

  const kpiCards = useMemo(
    () => computeInvestigationKpis(auditIndex, dateFrom, dateTo, returnsInRange.length),
    [auditIndex, dateFrom, dateTo, returnsInRange.length],
  );

  const periodLabel = useMemo(() => formatDateFilterViewingLabel(lang, quickFilter), [lang, quickFilter]);

  const shiftsInRange = useMemo(
    () =>
      (shifts ?? [])
        .filter((s) => {
          const key = dateKeyKampala(s.startAt);
          return key >= dateFrom && key <= dateTo;
        })
        .slice(0, 10),
    [shifts, dateFrom, dateTo],
  );

  const syncUrl = (next: Partial<{ from: string; to: string; staff: string; action: string; q: string }>) => {
    const params = new URLSearchParams(searchParams);
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    if (next.staff) params.set("staff", next.staff);
    if (next.action) params.set("action", next.action);
    if (next.q !== undefined) {
      if (next.q) params.set("q", next.q);
      else params.delete("q");
    }
    setSearchParams(params, { replace: true });
  };

  const applyFilters = (next: {
    dateFrom: string;
    dateTo: string;
    quickDate: DateFilterValue;
    actorUserId: string;
    action: AuditAction | "all";
    productId: string;
    customerId: string;
    supplierId: string;
  }) => {
    setDateFrom(next.dateFrom);
    setDateTo(next.dateTo);
    setQuickFilter(next.quickDate);
    setActorUserId(next.actorUserId);
    setAction(next.action);
    setProductId(next.productId);
    setCustomerId(next.customerId);
    setSupplierId(next.supplierId);
    syncUrl({
      from: next.dateFrom,
      to: next.dateTo,
      staff: next.actorUserId,
      action: next.action,
      q: debouncedSearchText,
    });
  };

  const applyDateFilter = (quickDate: DateFilterValue) => {
    const bounds = resolveDateFilterBounds(quickDate);
    applyFilters({
      dateFrom: bounds.fromKey,
      dateTo: bounds.toKey,
      quickDate,
      actorUserId,
      action,
      productId,
      customerId,
      supplierId,
    });
  };

  const downloadBlob = (filename: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadCsv = (entries: AuditLogEntry[] = filtered) => {
    downloadBlob(`audit-${dateKeyKampala(new Date())}.csv`, new Blob([buildAuditCsv(lang, entries)], { type: "text/csv;charset=utf-8" }));
  };

  const downloadExcel = (entries: AuditLogEntry[] = filtered) => {
    downloadBlob(`audit-${dateKeyKampala(new Date())}.csv`, new Blob([buildExcelCompatibleCsv(lang, entries)], { type: "text/csv;charset=utf-8" }));
  };

  const downloadPdf = async (entries: AuditLogEntry[] = filtered) => {
    const blob = await buildAuditPdfBlob(lang, entries, shopName);
    downloadBlob(`audit-${dateKeyKampala(new Date())}.pdf`, blob);
  };

  const downloadJson = (entries: AuditLogEntry[] = filtered) => {
    downloadBlob(`audit-${dateKeyKampala(new Date())}.json`, new Blob([buildAuditJsonExport(lang, entries)], { type: "application/json;charset=utf-8" }));
  };

  const printEntries = (entries: AuditLogEntry[] = filtered) => {
    printHtmlDocument(buildAuditPrintHtml(lang, entries, shopName), "80mm", t(lang, "auditCenterTitle"));
  };

  const shareEntries = async (entries: AuditLogEntry[] = filtered) => {
    const body = entries
      .slice(0, 40)
      .map((e) => buildActivityDetailText(lang, e, { productById, customerById }))
      .join("\n\n---\n\n");
    await shareText(body, t(lang, "auditCenterTitle"));
  };

  const copyEntry = async (entry: AuditLogEntry) => {
    const text = buildActivityDetailText(lang, entry, { productById, customerById });
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      await shareText(text, t(lang, "auditCenterTitle"));
    }
  };

  const handleKpiSelect = (id: InvestigationKpiId) => {
    if (activeKpi === id) {
      setActiveKpi(null);
      return;
    }
    setActiveKpi(id);
    if (id === "refunds") setTab("refunds");
    else setTab("timeline");
  };

  return (
    <div className="space-y-4 pb-12">
      <PageHeader
        lang={lang}
        title={t(lang, "auditCenterTitle")}
        subtitle={t(lang, "icPageSub")}
        backLabel={t(lang, "officeBackToHub")}
      />

      <InvestigationDateFilter lang={lang} filter={quickFilter} onFilterChange={applyDateFilter} />

      <InvestigationKpiGrid
        lang={lang}
        cards={kpiCards}
        activeKpi={activeKpi}
        periodLabel={periodLabel}
        onSelect={handleKpiSelect}
      />

      <IncludeArchivedFilter lang={lang} checked={includeArchived} onChange={setIncludeArchived} />

      <InvestigationTabs lang={lang} active={tab} onChange={setTab} />

      {tab === "timeline" ? (
        <div className="space-y-3">
          <InvestigationSearchBar
            lang={lang}
            searchText={searchText}
            onSearchChange={(value) => {
              setSearchText(value);
              syncUrl({ from: dateFrom, to: dateTo, staff: actorUserId, action, q: value });
            }}
            onOpenFilters={() => setFiltersOpen(true)}
            onOpenExport={() => setExportOpen(true)}
            resultCount={filtered.length}
          />
          <InvestigationCategoryChips lang={lang} active={category} onChange={setCategory} />
          <VirtualizedActivityTimeline
            lang={lang}
            entries={filtered}
            productById={productById}
            customerById={customerById}
            onSelect={setSelected}
            onMenu={setMenuEntry}
          />
        </div>
      ) : null}

      {tab === "staff" ? (
        <InvestigationStaffSection
          lang={lang}
          entries={filtered}
          shifts={shiftsInRange}
          productById={productById}
          customerById={customerById}
          onSelect={setSelected}
          onMenu={setMenuEntry}
        />
      ) : null}

      {tab === "refunds" ? (
        <InvestigationRefundsSection
          lang={lang}
          integrityReport={integrityReport}
          returns={returnsInRange}
          onTraceReturn={setTraceReturn}
        />
      ) : null}

      <InvestigationFiltersSheet
        lang={lang}
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        quickDate={quickFilter}
        actors={auditIndex.actors}
        products={products}
        customers={customers}
        suppliers={suppliers}
        onApply={applyFilters}
      />

      <InvestigationExportSheet
        lang={lang}
        open={exportOpen}
        disabled={filtered.length === 0}
        onClose={() => setExportOpen(false)}
        onExportCsv={() => downloadCsv()}
        onExportExcel={() => downloadExcel()}
        onExportPdf={() => void downloadPdf()}
        onExportJson={() => downloadJson()}
        onPrint={() => printEntries()}
        onShare={() => void shareEntries()}
      />

      <ActivityDetailSheet
        lang={lang}
        entry={selected}
        shopName={shopName}
        productById={productById}
        customerById={customerById}
        open={selected !== null}
        onClose={() => setSelected(null)}
        onCopy={() => selected && void copyEntry(selected)}
        onShare={() => selected && void shareEntries([selected])}
        onPrint={() => selected && printEntries([selected])}
        onExportPdf={() => selected && void downloadPdf([selected])}
      />

      <ActivityActionsSheet
        lang={lang}
        entry={menuEntry}
        open={menuEntry !== null}
        onClose={() => setMenuEntry(null)}
        onViewDetails={() => {
          if (menuEntry) setSelected(menuEntry);
          setMenuEntry(null);
        }}
        onCopy={() => menuEntry && void copyEntry(menuEntry)}
        onShare={() => menuEntry && void shareEntries([menuEntry])}
        onPrint={() => menuEntry && printEntries([menuEntry])}
        onExportPdf={() => menuEntry && void downloadPdf([menuEntry])}
        onExportCsv={() => menuEntry && downloadCsv([menuEntry])}
        onReportIssue={() => menuEntry && void shareEntries([menuEntry])}
      />

      <RefundCalculationDrawer
        lang={lang}
        open={traceReturn !== null}
        sale={traceReturn?.saleId ? saleById.get(traceReturn.saleId) ?? null : null}
        returnRecord={traceReturn}
        returnRecords={allReturns}
        actorLabel={
          traceReturn ? traceReturn.actorName?.trim() || actorDisplayLabel(traceReturn.actorUserId, lang) : ""
        }
        onClose={() => setTraceReturn(null)}
      />
    </div>
  );
}

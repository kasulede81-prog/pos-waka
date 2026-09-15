import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { AuditAction, AuditLogEntry, Language, ReturnRecord } from "../../types";
import { t } from "../../lib/i18n";
import { useDeferredReportingAuditLogs } from "../../hooks/useDeferredReportingAuditLogs";
import { useDeferredReportingSales } from "../../hooks/useDeferredReportingSales";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { usePosStore } from "../../store/usePosStore";
import { useSessionActor } from "../../context/SessionActorContext";
import { hasPermission } from "../../lib/permissions";
import {
  AUDIT_FILTER_RESULT_LIMIT,
  buildAuditLogSearchIndex,
  filterAuditLogsIndexed,
  type AuditSearchFilters,
} from "../../lib/auditSearch";
import { buildAuditCsv, buildAuditPdfBlob } from "../../lib/auditExport";
import { dateKeyKampala } from "../../lib/datesUg";
import { auditRefundIntegrity } from "../../lib/auditRefundIntegrity";
import { resolveDateFilterBounds, type DateFilterValue } from "../../lib/dateFilters";
import { formatDateFilterViewingLabel } from "../../lib/dateFilterLabels";
import { shareText } from "../../lib/reportExport";
import { exportCsvFile, exportJsonFile, exportPdfFile, exportXlsxFile, printReportDocument } from "../../lib/reportExportEngine";
import { useInvestigationCenter, splitActiveKpis } from "./hooks/useInvestigationCenter";
import { computePharmacyInvestigationKpis } from "./extensions/pharmacy/computePharmacyInvestigationKpis";
import {
  applyKpiFilter,
  buildActivityDetailText,
  buildAuditJsonExport,
  buildAuditPrintHtml,
  buildExcelCompatibleCsv,
  computeInvestigationKpis,
  matchesCategory,
  shouldHideFromInvestigationCenter,
} from "./lib/activityPresentation";
import type { InvestigationKpiId, PharmacyInvestigationKpiId } from "./types";
import { EnterprisePageContainer } from "../../components/layout/EnterprisePageContainer";
import { EnterpriseListFooter } from "../../components/enterprise/EnterpriseListFooter";
import {
  resolveInvestigationAccentCategories,
  resolveInvestigationCategories,
  resolveInvestigationTabs,
  resolveKpiTabTarget,
} from "./registry/investigationCatalog";
import { pharmacyTimelinePresentation } from "./registry/pharmacyWidgets";
import { resolveInvestigationMode } from "./registry/investigationMode";
import { createInvestigationSlotRenderer } from "./registry/enterpriseInvestigationRegistry";
import type { InvestigationCenterContext } from "./registry/investigationWidgetTypes";

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

export function EnterpriseInvestigationShell({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const mode = resolveInvestigationMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const [searchParams, setSearchParams] = useSearchParams();
  const { tab, setTab, category, setCategory, activeKpi, setActiveKpi } = useInvestigationCenter(mode);
  const { sharedKpi, pharmacyKpi } = splitActiveKpis(activeKpi);
  const [includeArchived, setIncludeArchived] = useState(false);
  const auditLogs = useDeferredReportingAuditLogs(includeArchived);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const suppliers = usePosStore((s) => s.suppliers);
  const shopName = usePosStore((s) => s.preferences.shopDisplayName ?? "Shop");
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
  const sales = useDeferredReportingSales(includeArchived);
  const prescriptions = usePosStore((s) => s.pharmacyPrescriptions);
  const pharmacyRegister = usePosStore((s) => s.pharmacyControlledRegister);

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

  const returnRecords = usePosStore((s) => s.returnRecords);
  const archivedReturnRecords = usePosStore((s) => s.archivedReturnRecords);
  const allReturns = includeArchived ? [...returnRecords, ...archivedReturnRecords] : returnRecords;

  const can = useCallback((perm: Parameters<typeof hasPermission>[1]) => hasPermission(actor.role, perm), [actor.role]);

  const integrityReport = useMemo(
    () => auditRefundIntegrity({ sales, returnRecords: allReturns }),
    [sales, allReturns],
  );

  const saleById = useMemo(() => new Map(sales.map((s) => [s.id, s])), [sales]);

  const returnsCountInRange = useMemo(
    () =>
      allReturns.filter((r) => {
        const key = dateKeyKampala(r.createdAt);
        return key >= dateFrom && key <= dateTo;
      }).length,
    [allReturns, dateFrom, dateTo],
  );

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

  const exportEntries = useMemo(() => {
    const allBase = filterAuditLogsIndexed(
      auditIndex,
      filters,
      { products, customers, suppliers, lang },
      Number.MAX_SAFE_INTEGER,
    );
    const todayKey = dateKeyKampala(new Date());
    let rows = allBase.filter((entry) => !shouldHideFromInvestigationCenter(entry));
    rows = rows.filter((entry) => matchesCategory(entry, category));
    rows = applyKpiFilter(rows, activeKpi, todayKey);
    return rows;
  }, [auditIndex, filters, products, customers, suppliers, lang, category, activeKpi]);

  const kpiCards = useMemo(
    () => computeInvestigationKpis(auditIndex, dateFrom, dateTo, returnsCountInRange),
    [auditIndex, dateFrom, dateTo, returnsCountInRange],
  );

  const pharmacyKpiCards = useMemo(() => {
    if (mode !== "pharmacy") return [];
    return computePharmacyInvestigationKpis({
      index: auditIndex,
      dateFrom,
      dateTo,
      products,
      sales,
      returns: allReturns,
      prescriptions,
      register: pharmacyRegister,
      preferences,
      auditLogs,
    });
  }, [
    mode,
    auditIndex,
    dateFrom,
    dateTo,
    products,
    sales,
    allReturns,
    prescriptions,
    pharmacyRegister,
    preferences,
    auditLogs,
  ]);

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

  const tabs = useMemo(() => resolveInvestigationTabs(mode), [mode]);
  const categories = useMemo(() => resolveInvestigationCategories(mode), [mode]);
  const accentCategories = useMemo(() => resolveInvestigationAccentCategories(mode), [mode]);

  const syncUrl = useCallback(
    (next: Partial<{ from: string; to: string; staff: string; action: string; q: string }>) => {
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
    },
    [searchParams, setSearchParams],
  );

  const applyFilters = useCallback(
    (next: {
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
    },
    [debouncedSearchText, syncUrl],
  );

  const applyDateFilter = useCallback(
    (quickDate: DateFilterValue) => {
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
    },
    [action, actorUserId, applyFilters, customerId, productId, supplierId],
  );

  const downloadCsv = useCallback(
    async (entries: AuditLogEntry[] = exportEntries) => {
      const csv = buildAuditCsv(lang, entries);
      const rows = csv.split("\n").map((line) => line.split(","));
      await exportCsvFile("investigation", `audit-${dateKeyKampala(new Date())}.csv`, rows, {
        shareDialogTitle: t(lang, "auditCenterTitle"),
      });
    },
    [exportEntries, lang],
  );

  const downloadExcel = useCallback(
    async (entries: AuditLogEntry[] = exportEntries) => {
      const csv = buildExcelCompatibleCsv(lang, entries);
      const rows = csv.replace(/^\uFEFF/, "").split("\n").map((line) => line.split(","));
      await exportXlsxFile("investigation", `audit-${dateKeyKampala(new Date())}.xlsx`, rows, {
        shareDialogTitle: t(lang, "auditCenterTitle"),
        sheetName: "Audit",
      });
    },
    [exportEntries, lang],
  );

  const downloadPdf = useCallback(
    async (entries: AuditLogEntry[] = exportEntries) => {
      const blob = await buildAuditPdfBlob(lang, entries, shopName);
      await exportPdfFile("investigation", `audit-${dateKeyKampala(new Date())}.pdf`, blob, {
        shareDialogTitle: t(lang, "auditCenterTitle"),
      });
    },
    [exportEntries, lang, shopName],
  );

  const downloadJson = useCallback(
    async (entries: AuditLogEntry[] = exportEntries) => {
      await exportJsonFile(
        "investigation",
        `audit-${dateKeyKampala(new Date())}.json`,
        buildAuditJsonExport(lang, entries),
        { shareDialogTitle: t(lang, "auditCenterTitle") },
      );
    },
    [exportEntries, lang],
  );

  const printEntries = useCallback(
    async (entries: AuditLogEntry[] = exportEntries) => {
      const filename = `audit-${dateKeyKampala(new Date())}.pdf`;
      const blob = await buildAuditPdfBlob(lang, entries, shopName);
      await printReportDocument("investigation", {
        pdfFilename: filename,
        buildPdfBlob: () => blob,
        htmlBody: buildAuditPrintHtml(lang, entries, shopName),
        paper: "a4",
        title: t(lang, "auditCenterTitle"),
        shareDialogTitle: t(lang, "auditCenterTitle"),
      });
    },
    [exportEntries, lang, shopName],
  );

  const shareEntries = useCallback(
    async (entries: AuditLogEntry[] = exportEntries) => {
      const body = entries
        .slice(0, 40)
        .map((e) => buildActivityDetailText(lang, e, { productById, customerById }))
        .join("\n\n---\n\n");
      await shareText(body, t(lang, "auditCenterTitle"), "investigation");
    },
    [customerById, exportEntries, lang, productById],
  );

  const copyEntry = useCallback(
    async (entry: AuditLogEntry) => {
      const text = buildActivityDetailText(lang, entry, { productById, customerById });
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        await shareText(text, t(lang, "auditCenterTitle"));
      }
    },
    [customerById, lang, productById],
  );

  const handleKpiSelect = useCallback(
    (id: InvestigationKpiId) => {
      if (activeKpi === id) {
        setActiveKpi(null);
        return;
      }
      setActiveKpi(id);
      setTab(resolveKpiTabTarget(id));
    },
    [activeKpi, setActiveKpi, setTab],
  );

  const handlePharmacyKpiSelect = useCallback(
    (id: PharmacyInvestigationKpiId) => {
      handleKpiSelect(id);
    },
    [handleKpiSelect],
  );

  const onSearchTextChange = useCallback(
    (value: string) => {
      setSearchText(value);
      syncUrl({ from: dateFrom, to: dateTo, staff: actorUserId, action, q: value });
    },
    [action, actorUserId, dateFrom, dateTo, syncUrl],
  );

  const getTimelinePresentation = useCallback(
    (entry: AuditLogEntry) => {
      if (mode !== "pharmacy") return null;
      return pharmacyTimelinePresentation(lang, entry, productById);
    },
    [lang, mode, productById],
  );

  const ctx = useMemo((): InvestigationCenterContext => ({
    lang,
    mode,
    businessType: preferences.businessType,
    can,
    tab,
    setTab,
    category,
    setCategory,
    activeKpi,
    setActiveKpi,
    sharedKpi,
    pharmacyKpi,
    tabs,
    categories,
    accentCategories,
    getTimelinePresentation,
    includeArchived,
    setIncludeArchived,
    quickFilter,
    dateFrom,
    dateTo,
    actorUserId,
    action,
    productId,
    customerId,
    supplierId,
    searchText,
    onSearchTextChange,
    debouncedSearchText,
    filters,
    filtered,
    kpiCards,
    pharmacyKpiCards,
    periodLabel,
    auditIndex,
    auditLogs,
    products,
    customers,
    suppliers,
    shopName,
    productById,
    customerById,
    saleById,
    integrityReport,
    returnsInRange,
    allReturns,
    shiftsInRange,
    pharmacyRegister,
    selected,
    setSelected,
    menuEntry,
    setMenuEntry,
    filtersOpen,
    setFiltersOpen,
    exportOpen,
    setExportOpen,
    traceReturn,
    setTraceReturn,
    applyDateFilter,
    applyFilters,
    syncUrl,
    handleKpiSelect,
    handlePharmacyKpiSelect,
    downloadCsv,
    downloadExcel,
    downloadPdf,
    downloadJson,
    printEntries,
    shareEntries,
    copyEntry,
  }), [
    lang,
    mode,
    preferences.businessType,
    can,
    tab,
    setTab,
    category,
    setCategory,
    activeKpi,
    setActiveKpi,
    sharedKpi,
    pharmacyKpi,
    tabs,
    categories,
    accentCategories,
    getTimelinePresentation,
    includeArchived,
    quickFilter,
    dateFrom,
    dateTo,
    actorUserId,
    action,
    productId,
    customerId,
    supplierId,
    searchText,
    onSearchTextChange,
    debouncedSearchText,
    filters,
    filtered,
    kpiCards,
    pharmacyKpiCards,
    periodLabel,
    auditIndex,
    auditLogs,
    products,
    customers,
    suppliers,
    shopName,
    productById,
    customerById,
    saleById,
    integrityReport,
    returnsInRange,
    allReturns,
    shiftsInRange,
    pharmacyRegister,
    selected,
    menuEntry,
    filtersOpen,
    exportOpen,
    traceReturn,
    applyDateFilter,
    applyFilters,
    syncUrl,
    handleKpiSelect,
    handlePharmacyKpiSelect,
    downloadCsv,
    downloadExcel,
    downloadPdf,
    downloadJson,
    printEntries,
    shareEntries,
    copyEntry,
  ]);

  const renderSlot = useMemo(() => createInvestigationSlotRenderer(ctx), [ctx]);

  return (
    <EnterprisePageContainer>
      {renderSlot("header")}
      {renderSlot("date-filter")}
      {renderSlot("kpi-grid")}
      {renderSlot("alerts")}
      {renderSlot("status")}
      {renderSlot("tabs")}
      {renderSlot("search")}
      {renderSlot("timeline-categories")}
      {renderSlot("timeline")}
      {baseFiltered.length >= PAGE_SIZE ? (
        <EnterpriseListFooter lang={lang} truncated truncatedCount={PAGE_SIZE} />
      ) : null}
      {renderSlot("reports")}
      {renderSlot("compliance")}
      {renderSlot("quick-actions")}
      {renderSlot("footer")}
    </EnterprisePageContainer>
  );
}

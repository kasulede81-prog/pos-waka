import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, FileText, Search, ShieldCheck } from "lucide-react";
import type { AuditAction, AuditLogEntry, Language, ReturnRecord } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { PageHeader } from "../components/layout/PageHeader";
import { DateFilterBar } from "../components/shared/DateFilterBar";
import { DateFilterViewingLabel } from "../components/shared/DateFilterViewingLabel";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { AuditDetailDrawer } from "../components/audit/AuditDetailDrawer";
import { RefundCalculationDrawer } from "../components/returns/RefundCalculationDrawer";
import { useDeferredReportingAuditLogs } from "../hooks/useDeferredReportingAuditLogs";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { usePosStore } from "../store/usePosStore";
import {
  AUDIT_FILTER_RESULT_LIMIT,
  buildAuditLogSearchIndex,
  filterAuditLogsIndexed,
  INVESTIGATION_ACTIONS,
  type AuditSearchFilters,
} from "../lib/auditSearch";
import { extractAuditEntityLabel, actorDisplayLabel } from "../lib/activityNarrative";
import { auditActionLabel, formatAuditRowSummary } from "../lib/auditCenterDetails";
import { formatAuditDeviceLabel } from "../lib/auditDeviceLabel";
import { buildAuditCsv, buildAuditPdfBlob } from "../lib/auditExport";
import { dateKeyKampala } from "../lib/datesUg";
import { auditRefundIntegrity } from "../lib/auditRefundIntegrity";
import { resolveDateFilterBounds, type DateFilterValue } from "../lib/dateFilters";

const PAGE_SIZE = AUDIT_FILTER_RESULT_LIMIT;

function initialAuditDateFilter(searchParams: URLSearchParams): DateFilterValue {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (from && to && from === to) return { kind: "day", dateKey: from };
  return { kind: "preset", preset: "this_month" };
}

export function AuditCenterPage({ lang }: { lang: Language }) {
  const [searchParams] = useSearchParams();
  const [includeArchived, setIncludeArchived] = useState(false);
  const auditLogs = useDeferredReportingAuditLogs(includeArchived);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const suppliers = usePosStore((s) => s.suppliers);
  const shopName = usePosStore((s) => s.preferences.shopDisplayName ?? "Shop");

  const [quickFilter, setQuickFilter] = useState(() => initialAuditDateFilter(searchParams));
  const monthBounds = useMemo(
    () => resolveDateFilterBounds({ kind: "preset", preset: "this_month" }),
    [],
  );
  const [dateFrom, setDateFrom] = useState(
    () => searchParams.get("from") ?? monthBounds.fromKey,
  );
  const [dateTo, setDateTo] = useState(() => searchParams.get("to") ?? monthBounds.toKey);
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
  const actors = auditIndex.actors;

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

  const filtered = useMemo(
    () =>
      filterAuditLogsIndexed(
        auditIndex,
        filters,
        { products, customers, suppliers, lang },
        PAGE_SIZE,
      ),
    [auditIndex, filters, products, customers, suppliers, lang],
  );

  const actionOptions = useMemo(() => [...INVESTIGATION_ACTIONS].sort(), []);

  const downloadCsv = () => {
    const csv = buildAuditCsv(lang, filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-${dateKeyKampala(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = async () => {
    const blob = await buildAuditPdfBlob(lang, filtered, shopName);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-${dateKeyKampala(new Date())}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const inputClass =
    "mt-1 min-h-[44px] w-full rounded-xl border-2 border-slate-200 px-3 text-sm font-semibold outline-none focus:border-waka-500";

  const onQuickFilterChange = (next: DateFilterValue) => {
    setQuickFilter(next);
    const bounds = resolveDateFilterBounds(next);
    setDateFrom(bounds.fromKey);
    setDateTo(bounds.toKey);
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        lang={lang}
        title={t(lang, "auditCenterTitle")}
        subtitle={t(lang, "auditCenterSub")}
        backLabel={t(lang, "officeBackToHub")}
      />

      <DateFilterBar lang={lang} value={quickFilter} onChange={onQuickFilterChange} />
      <DateFilterViewingLabel lang={lang} value={quickFilter} />

      <IncludeArchivedFilter lang={lang} checked={includeArchived} onChange={setIncludeArchived} />

      <section className="rounded-[1.5rem] border border-emerald-200/80 bg-gradient-to-br from-emerald-50/80 to-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-black text-slate-900">{t(lang, "refundIntegrityTitle")}</h2>
            <p className="mt-0.5 text-xs font-medium text-slate-600">{t(lang, "refundIntegritySub")}</p>
            <p
              className={`mt-2 text-sm font-bold ${integrityReport.ok ? "text-emerald-800" : "text-rose-800"}`}
            >
              {integrityReport.ok
                ? t(lang, "refundIntegrityOk")
                : tTemplate(lang, "refundIntegrityViolations", {
                    count: String(integrityReport.violations.length),
                  })}
            </p>
            {!integrityReport.ok ? (
              <ul className="mt-2 space-y-1 text-xs font-semibold text-rose-900">
                {integrityReport.violations.slice(0, 8).map((v, i) => (
                  <li key={`${v.code}-${i}`} className="rounded-lg bg-rose-50 px-2 py-1">
                    {v.message}
                    {v.saleId ? ` · ${v.saleId.slice(0, 8)}` : ""}
                    {v.expected != null && v.actual != null
                      ? ` (${v.actual} / max ${v.expected})`
                      : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-[10px] font-semibold text-slate-500">
              {integrityReport.returnsScanned} returns · {integrityReport.salesScanned} sales scanned
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-500">{t(lang, "refundHistoryTitle")}</h2>
        {returnsInRange.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">{t(lang, "refundHistoryEmpty")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {returnsInRange.map((r) => {
              const staff = r.actorName?.trim() || actorDisplayLabel(r.actorUserId, lang);
              const when = new Date(r.createdAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900">
                      {r.productName} · UGX {r.refundAmountUgx.toLocaleString()}
                    </p>
                    <p className="text-xs text-slate-600">
                      {staff} · {when}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTraceReturn(r)}
                    className="shrink-0 rounded-xl border border-waka-200 bg-waka-50 px-3 py-1.5 text-xs font-black text-waka-900"
                  >
                    {t(lang, "refundTraceView")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-500">{t(lang, "auditFiltersTitle")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-bold text-slate-800">
            {t(lang, "auditFilterDateFrom")}
            <input type="date" className={inputClass} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="block text-sm font-bold text-slate-800">
            {t(lang, "auditFilterDateTo")}
            <input type="date" className={inputClass} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <label className="block text-sm font-bold text-slate-800">
            {t(lang, "auditFilterStaff")}
            <select className={inputClass} value={actorUserId} onChange={(e) => setActorUserId(e.target.value)}>
              <option value="all">{t(lang, "auditFilterAll")}</option>
              {actors.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-slate-800">
            {t(lang, "auditFilterAction")}
            <select
              className={inputClass}
              value={action}
              onChange={(e) => setAction(e.target.value as AuditAction | "all")}
            >
              <option value="all">{t(lang, "auditFilterAll")}</option>
              {actionOptions.map((a) => (
                <option key={a} value={a}>
                  {auditActionLabel(lang, a)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-slate-800">
            {t(lang, "auditFilterProduct")}
            <select className={inputClass} value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">{t(lang, "auditFilterAll")}</option>
              {[...products]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-slate-800">
            {t(lang, "auditFilterCustomer")}
            <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">{t(lang, "auditFilterAll")}</option>
              {[...customers]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-slate-800 sm:col-span-2">
            {t(lang, "auditFilterSupplier")}
            <select className={inputClass} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t(lang, "auditFilterAll")}</option>
              {[...suppliers]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-slate-800 sm:col-span-2">
            <span className="flex items-center gap-2">
              <Search className="h-4 w-4 text-slate-400" aria-hidden />
              {t(lang, "auditFilterSearch")}
            </span>
            <input
              type="search"
              className={inputClass}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={t(lang, "auditFilterSearchPlaceholder")}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={downloadCsv}
            disabled={filtered.length === 0}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border-2 border-slate-200 bg-white px-4 text-sm font-black text-slate-800 disabled:opacity-40"
          >
            <Download className="h-4 w-4" aria-hidden />
            {t(lang, "auditExportCsv")}
          </button>
          <button
            type="button"
            onClick={() => void downloadPdf()}
            disabled={filtered.length === 0}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border-2 border-waka-600 bg-waka-50 px-4 text-sm font-black text-waka-900 disabled:opacity-40"
          >
            <FileText className="h-4 w-4" aria-hidden />
            {t(lang, "auditExportPdf")}
          </button>
        </div>
      </section>

      <p className="text-sm font-semibold text-slate-600">
        {t(lang, "auditResultCount")}: {filtered.length}
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-[1.5rem] border border-slate-200 bg-white p-6 text-slate-600">{t(lang, "auditEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((e) => {
            const staff = e.actorName?.trim() || actorDisplayLabel(e.actorUserId, lang);
            const when = new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
            const narrative = formatAuditRowSummary(lang, e, { productById, customerById });
            const entity = extractAuditEntityLabel(e, productById, customerById);
            const deviceLabel = formatAuditDeviceLabel(e.deviceId, e.payload);
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setSelected(e)}
                  className="w-full rounded-[1.25rem] border border-slate-100 bg-white p-4 text-left shadow-sm ring-1 ring-slate-100/80 transition hover:border-waka-200"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-black text-slate-900">{staff}</p>
                    <time className="text-xs font-semibold text-slate-500" dateTime={e.at}>
                      {when}
                    </time>
                  </div>
                  <p className="mt-1 text-xs font-bold uppercase tracking-wide text-waka-700">
                    {auditActionLabel(lang, e.action)}
                    {entity ? ` · ${entity}` : ""}
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-800">{narrative}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {t(lang, `role_${e.role}`)} · {deviceLabel}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <AuditDetailDrawer
        lang={lang}
        entry={selected}
        productById={productById}
        customerById={customerById}
        onClose={() => setSelected(null)}
      />

      <RefundCalculationDrawer
        lang={lang}
        open={traceReturn !== null}
        sale={traceReturn?.saleId ? saleById.get(traceReturn.saleId) ?? null : null}
        returnRecord={traceReturn}
        returnRecords={allReturns}
        actorLabel={
          traceReturn
            ? traceReturn.actorName?.trim() || actorDisplayLabel(traceReturn.actorUserId, lang)
            : ""
        }
        onClose={() => setTraceReturn(null)}
      />
    </div>
  );
}

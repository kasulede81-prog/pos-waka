import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, FileText, Search } from "lucide-react";
import type { AuditAction, AuditLogEntry, Language } from "../types";
import { t } from "../lib/i18n";
import { PageHeader } from "../components/layout/PageHeader";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { AuditDetailDrawer } from "../components/audit/AuditDetailDrawer";
import { useDeferredReportingAuditLogs } from "../hooks/useDeferredReportingAuditLogs";
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

const PAGE_SIZE = AUDIT_FILTER_RESULT_LIMIT;

function defaultDateFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return dateKeyKampala(d);
}

export function AuditCenterPage({ lang }: { lang: Language }) {
  const [searchParams] = useSearchParams();
  const [includeArchived, setIncludeArchived] = useState(false);
  const auditLogs = useDeferredReportingAuditLogs(includeArchived);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const suppliers = usePosStore((s) => s.suppliers);
  const shopName = usePosStore((s) => s.preferences.shopDisplayName ?? "Shop");

  const [dateFrom, setDateFrom] = useState(() => searchParams.get("from") ?? defaultDateFrom());
  const [dateTo, setDateTo] = useState(() => searchParams.get("to") ?? dateKeyKampala(new Date()));
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

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        lang={lang}
        title={t(lang, "auditCenterTitle")}
        subtitle={t(lang, "auditCenterSub")}
        backLabel={t(lang, "officeBackToHub")}
      />

      <IncludeArchivedFilter lang={lang} checked={includeArchived} onChange={setIncludeArchived} />

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
    </div>
  );
}

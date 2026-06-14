import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDeferredReportingAuditLogs } from "../hooks/useDeferredReportingAuditLogs";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { PageHeader } from "../components/layout/PageHeader";
import { DateFilterBar } from "../components/shared/DateFilterBar";
import { DateFilterViewingLabel } from "../components/shared/DateFilterViewingLabel";
import { useReportingDateFilter } from "../hooks/useReportingDateFilter";
import type { AuditLogEntry, Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { groupAuditByStaff, STAFF_ACTIVITY_ACTIONS } from "../lib/auditSearch";
import { auditActionLabel, formatAuditRowSummary } from "../lib/auditCenterDetails";
import { AuditDetailDrawer } from "../components/audit/AuditDetailDrawer";
import { dateKeyKampala } from "../lib/datesUg";
import { dateMatchesFilter } from "../lib/dateFilters";

const PAGE = 300;

export function StaffActivityPage({ lang }: { lang: Language }) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);
  const { filter, setFilter, bounds } = useReportingDateFilter({ kind: "preset", preset: "today" });
  const auditLogs = useDeferredReportingAuditLogs(includeArchived);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, { name: p.name }])), [products]);
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, { name: c.name }])), [customers]);

  const filtered = useMemo(
    () =>
      auditLogs
        .filter((e) => STAFF_ACTIVITY_ACTIONS.has(e.action))
        .filter((e) => dateMatchesFilter(dateKeyKampala(e.at), bounds))
        .slice(0, PAGE),
    [auditLogs, bounds],
  );

  const shiftsInRange = useMemo(
    () =>
      (shifts ?? []).filter((s) => dateMatchesFilter(dateKeyKampala(s.startAt), bounds)).slice(0, 10),
    [shifts, bounds],
  );

  const groups = useMemo(() => groupAuditByStaff(filtered), [filtered]);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        lang={lang}
        title={t(lang, "staffActivityTitle")}
        subtitle={t(lang, "staffActivitySubGrouped")}
        backLabel={t(lang, "officeBackToHub")}
      />

      <Link
        to="/office/audit-center"
        className="block rounded-2xl border-2 border-violet-200 bg-violet-50 px-4 py-3 text-sm font-black text-violet-950"
      >
        {t(lang, "staffActivityOpenAuditCenter")} →
      </Link>

      <DateFilterBar lang={lang} value={filter} onChange={setFilter} />
      <DateFilterViewingLabel lang={lang} value={filter} />

      <IncludeArchivedFilter lang={lang} checked={includeArchived} onChange={setIncludeArchived} />

      {groups.length === 0 ? (
        <p className="rounded-[1.5rem] border border-slate-200 bg-white p-6 text-slate-600">{t(lang, "staffActivityEmpty")}</p>
      ) : (
        <div className="space-y-8">
          {shiftsInRange.length > 0 ? (
            <section>
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-500">{t(lang, "shiftsTodayTitle")}</h2>
              <ul className="mt-3 space-y-3">
                {shiftsInRange.map((s) => (
                  <li key={s.id} className="rounded-[1.25rem] border border-slate-100 bg-white p-4 shadow-sm ring-1 ring-slate-100/80">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-black text-slate-900">{s.actorName ?? s.actorUserId}</p>
                      <p className="text-xs font-semibold text-slate-500">{s.endAt ? t(lang, "shiftClosed") : t(lang, "shiftOpen")}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {new Date(s.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} -{" "}
                      {s.endAt ? new Date(s.endAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-800">
                      UGX {s.salesTotalUgx.toLocaleString()} · {t(lang, "cardDebtToday")} UGX {s.debtTotalUgx.toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {groups.map((group) => (
            <section key={group.actorId}>
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-500">{group.actorLabel}</h2>
              <ul className="mt-3 space-y-2">
                {group.entries.map((e) => {
                  const when = new Date(e.at).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(e)}
                        className="w-full rounded-[1.25rem] border border-slate-100 bg-white p-4 text-left shadow-sm ring-1 ring-slate-100/80 hover:border-waka-200"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-xs font-bold uppercase tracking-wide text-waka-700">
                            {auditActionLabel(lang, e.action)}
                          </p>
                          <time className="text-xs font-semibold text-slate-500" dateTime={e.at}>
                            {when}
                          </time>
                        </div>
                        <p className="mt-1 text-sm font-medium text-slate-800">
                          {formatAuditRowSummary(lang, e, { productById, customerById })}
                        </p>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          {e.role}
                          {e.deviceId ? ` · ${e.deviceId.slice(0, 8)}…` : ""}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
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

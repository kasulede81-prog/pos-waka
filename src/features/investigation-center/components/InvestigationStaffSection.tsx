import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EnterpriseListFooter } from "../../../components/enterprise/EnterpriseListFooter";
import type { AuditLogEntry, Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { TimelinePresentation } from "../registry/investigationWidgetTypes";
import {
  INVESTIGATION_PAGE_SIZE,
  INVESTIGATION_SHIFTS_PAGE_SIZE,
  collectInvestigationStaffGroups,
  nextInvestigationVisibleCount,
  paginateInvestigationResults,
  resetInvestigationVisibleCount,
} from "../lib/investigationResultScope";
import { VirtualizedActivityTimeline } from "./VirtualizedActivityTimeline";

type Props = {
  lang: Language;
  entries: AuditLogEntry[];
  shifts: Array<{
    id: string;
    actorName?: string;
    actorUserId: string;
    startAt: string;
    endAt?: string | null;
    salesTotalUgx: number;
    debtTotalUgx: number;
  }>;
  productById: Map<string, { name: string }>;
  customerById: Map<string, { name: string }>;
  getTimelinePresentation?: (entry: AuditLogEntry) => TimelinePresentation | null;
  onSelect: (entry: AuditLogEntry) => void;
  onMenu: (entry: AuditLogEntry) => void;
};

/** Presentation helper — shift counter is not certified revenue (tests assert this). */
export function shiftSalesCounterLabelKey(): string {
  return "icShiftSalesTotal";
}

export function shiftSalesCounterIsCanonicalRevenue(): boolean {
  return false;
}

export function InvestigationStaffSection({
  lang,
  entries,
  shifts,
  productById,
  customerById,
  getTimelinePresentation,
  onSelect,
  onMenu,
}: Props) {
  const staffGroups = useMemo(() => collectInvestigationStaffGroups(entries), [entries]);
  const [visibleCount, setVisibleCount] = useState(INVESTIGATION_PAGE_SIZE);
  const [shiftVisibleCount, setShiftVisibleCount] = useState(INVESTIGATION_SHIFTS_PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(resetInvestigationVisibleCount(INVESTIGATION_PAGE_SIZE));
  }, [entries]);
  useEffect(() => {
    setShiftVisibleCount(resetInvestigationVisibleCount(INVESTIGATION_SHIFTS_PAGE_SIZE));
  }, [shifts]);
  const page = useMemo(
    () => paginateInvestigationResults(staffGroups, visibleCount),
    [staffGroups, visibleCount],
  );
  const shiftPage = useMemo(
    () => paginateInvestigationResults(shifts, shiftVisibleCount),
    [shifts, shiftVisibleCount],
  );

  if (staffGroups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-10 text-center">
        <p className="text-sm font-semibold text-muted-foreground">{t(lang, "staffActivityEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {shifts.length > 0 ? (
        <section>
          <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">{t(lang, "shiftsTodayTitle")}</h2>
          <ul className="mt-3 space-y-2">
            {shiftPage.displayed.map((s) => (
              <li key={s.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-black text-foreground">{s.actorName ?? s.actorUserId}</p>
                  <p className="text-xs font-semibold text-muted-foreground">{s.endAt ? t(lang, "shiftClosed") : t(lang, "shiftOpen")}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(s.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} –{" "}
                  {s.endAt ? new Date(s.endAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                </p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {t(lang, "icShiftSalesTotal")}: UGX {s.salesTotalUgx.toLocaleString()}
                </p>
                <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">{t(lang, "icShiftSalesTotalHint")}</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {t(lang, "icShiftDebtIssued")}: UGX {s.debtTotalUgx.toLocaleString()}
                </p>
                <Link
                  to="/receipts"
                  className="mt-2 inline-flex text-[11px] font-black text-waka-700 underline-offset-2 hover:underline"
                >
                  {t(lang, "icOpenSalesHistory")} →
                </Link>
              </li>
            ))}
          </ul>
          {shiftPage.hasMore || shiftPage.total > INVESTIGATION_SHIFTS_PAGE_SIZE ? (
            <EnterpriseListFooter
              lang={lang}
              truncated={shiftPage.hasMore}
              truncatedCount={shiftPage.shown}
              totalCount={shiftPage.total}
              hasMore={shiftPage.hasMore}
              onLoadMore={() =>
                setShiftVisibleCount((current) =>
                  nextInvestigationVisibleCount(current, shiftPage.total, INVESTIGATION_SHIFTS_PAGE_SIZE),
                )
              }
              endOfList={!shiftPage.hasMore && shiftPage.total > INVESTIGATION_SHIFTS_PAGE_SIZE}
            />
          ) : null}
        </section>
      ) : null}

      {page.displayed.map((group) => (
        <section key={group.actorId}>
          <h2 className="mb-2 text-xs font-black uppercase tracking-widest text-muted-foreground">{group.actorLabel}</h2>
          <VirtualizedActivityTimeline
            lang={lang}
            entries={group.entries}
            productById={productById}
            customerById={customerById}
            getTimelinePresentation={getTimelinePresentation}
            onSelect={onSelect}
            onMenu={onMenu}
          />
        </section>
      ))}
      {page.hasMore || page.total > INVESTIGATION_PAGE_SIZE ? (
        <EnterpriseListFooter
          lang={lang}
          truncated={page.hasMore}
          truncatedCount={page.shown}
          totalCount={page.total}
          hasMore={page.hasMore}
          onLoadMore={() =>
            setVisibleCount((current) =>
              nextInvestigationVisibleCount(current, page.total, INVESTIGATION_PAGE_SIZE),
            )
          }
          endOfList={!page.hasMore && page.total > INVESTIGATION_PAGE_SIZE}
        />
      ) : null}
    </div>
  );
}

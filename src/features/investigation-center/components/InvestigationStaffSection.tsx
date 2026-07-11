import type { AuditLogEntry, Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { groupAuditByStaff } from "../../../lib/auditSearch";
import type { TimelinePresentation } from "../registry/investigationWidgetTypes";
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
  const staffGroups = groupAuditByStaff(entries);

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
            {shifts.map((s) => (
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
                  UGX {s.salesTotalUgx.toLocaleString()} · {t(lang, "cardDebtToday")} UGX {s.debtTotalUgx.toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {staffGroups.map((group) => (
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
    </div>
  );
}

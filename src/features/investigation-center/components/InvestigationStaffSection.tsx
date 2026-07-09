import type { AuditLogEntry, Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { groupAuditByStaff } from "../../../lib/auditSearch";
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
  pharmacyMode?: boolean;
  onSelect: (entry: AuditLogEntry) => void;
  onMenu: (entry: AuditLogEntry) => void;
};

export function InvestigationStaffSection({
  lang,
  entries,
  shifts,
  productById,
  customerById,
  pharmacyMode = false,
  onSelect,
  onMenu,
}: Props) {
  const staffGroups = groupAuditByStaff(entries);

  if (staffGroups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-200 bg-white px-4 py-10 text-center">
        <p className="text-sm font-semibold text-stone-600">{t(lang, "staffActivityEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {shifts.length > 0 ? (
        <section>
          <h2 className="text-xs font-black uppercase tracking-widest text-stone-500">{t(lang, "shiftsTodayTitle")}</h2>
          <ul className="mt-3 space-y-2">
            {shifts.map((s) => (
              <li key={s.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-black text-stone-900">{s.actorName ?? s.actorUserId}</p>
                  <p className="text-xs font-semibold text-stone-500">{s.endAt ? t(lang, "shiftClosed") : t(lang, "shiftOpen")}</p>
                </div>
                <p className="mt-1 text-xs text-stone-600">
                  {new Date(s.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} –{" "}
                  {s.endAt ? new Date(s.endAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                </p>
                <p className="mt-2 text-sm font-semibold text-stone-800">
                  UGX {s.salesTotalUgx.toLocaleString()} · {t(lang, "cardDebtToday")} UGX {s.debtTotalUgx.toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {staffGroups.map((group) => (
        <section key={group.actorId}>
          <h2 className="mb-2 text-xs font-black uppercase tracking-widest text-stone-500">{group.actorLabel}</h2>
          <VirtualizedActivityTimeline
            lang={lang}
            entries={group.entries}
            productById={productById}
            customerById={customerById}
            pharmacyMode={pharmacyMode}
            onSelect={onSelect}
            onMenu={onMenu}
          />
        </section>
      ))}
    </div>
  );
}

import clsx from "clsx";
import { Clock, Receipt, Users } from "lucide-react";
import type { HospitalityFloorState, Language, Sale, TableSession } from "../../types";
import { t } from "../../lib/i18n";
import {
  TABLE_STATUS_COLORS,
  activeTableSessions,
  billRequestedSessions,
  floorStatusCounts,
  formatSessionElapsed,
  pendingSaleTotal,
  sessionDisplayLabel,
} from "../../lib/hospitality";
import { formatUgx } from "../../lib/formatUgx";

type Props = {
  lang: Language;
  floor: HospitalityFloorState;
  sales: Sale[];
  onSessionTap: (sessionId: string) => void;
};

function SessionRow({
  label,
  session,
  total,
  highlight,
  onTap,
}: {
  label: string;
  session: TableSession;
  total: number;
  highlight?: boolean;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      className={clsx(
        "flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99]",
        highlight
          ? "border-orange-300 bg-orange-50 text-orange-950"
          : "border-border bg-card text-foreground",
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-black">{label}</p>
        <p className="text-xs font-semibold text-muted-foreground">
          {session.waiterLabel ?? "—"} · {formatSessionElapsed(session.openedAt)}
        </p>
      </div>
      <span className="shrink-0 text-sm font-black tabular-nums">{formatUgx(total)}</span>
    </button>
  );
}

export function FloorActiveSidebar({ lang, floor, sales, onSessionTap }: Props) {
  const active = activeTableSessions(floor);
  const billRequested = billRequestedSessions(floor);
  const counts = floorStatusCounts(floor);

  const saleFor = (session: TableSession) => sales.find((s) => s.id === session.saleId);

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-black uppercase tracking-wide text-muted-foreground">{t(lang, "floorActiveTables")}</h2>
        <p className="text-xs font-medium text-muted-foreground">{t(lang, "floorActiveTablesSub")}</p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {billRequested.length > 0 ? (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-black uppercase text-orange-700">
              <Receipt className="h-3.5 w-3.5" />
              {t(lang, "floorBillRequested")}
            </p>
            {billRequested.map((session) => (
              <SessionRow
                key={session.id}
                label={sessionDisplayLabel(session, floor)}
                session={session}
                total={pendingSaleTotal(saleFor(session))}
                highlight
                onTap={() => onSessionTap(session.id)}
              />
            ))}
          </div>
        ) : null}

        {active
          .filter((s) => s.status === "open")
          .map((session) => (
            <SessionRow
              key={session.id}
              label={sessionDisplayLabel(session, floor)}
              session={session}
              total={pendingSaleTotal(saleFor(session))}
              onTap={() => onSessionTap(session.id)}
            />
          ))}

        {active.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-sm font-semibold text-muted-foreground">
            {t(lang, "floorNoActiveTables")}
          </p>
        ) : null}
      </div>

      <div className="border-t border-border p-3">
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(TABLE_STATUS_COLORS) as Array<keyof typeof TABLE_STATUS_COLORS>).map((key) => {
            const count =
              key === "available"
                ? counts.available
                : key === "occupied"
                  ? counts.occupied
                  : key === "payment_pending"
                    ? counts.billRequested
                    : key === "reserved"
                      ? counts.reserved
                      : key === "needs_attention"
                        ? counts.needsAttention
                        : counts.disabled;
            if (key === "disabled" && count === 0) return null;
            const colors = TABLE_STATUS_COLORS[key];
            return (
              <div
                key={key}
                className="flex flex-col items-center rounded-xl bg-muted px-2 py-2 text-center"
                title={t(lang, colors.labelKey)}
              >
                <span className={clsx("mb-1 h-2.5 w-2.5 rounded-full", colors.dot)} />
                <span className="text-lg font-black tabular-nums text-foreground">{count}</span>
                <span className="line-clamp-1 text-[10px] font-bold text-muted-foreground">{t(lang, colors.labelKey)}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between text-xs font-semibold text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {active.length} {t(lang, "floorSeatedCount")}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {billRequested.length} {t(lang, "floorBillRequestedShort")}
          </span>
        </div>
      </div>
    </aside>
  );
}

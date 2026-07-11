import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import type { DayClosePreflightSnapshot } from "../../lib/dayCloseEnforcement";

type Props = {
  lang: Language;
  snapshot: DayClosePreflightSnapshot | null;
  loading?: boolean;
};

function StatusIcon({ status }: { status: "pass" | "fail" | "warn" | "pending" }) {
  if (status === "pass") return <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden />;
  if (status === "fail") return <XCircle className="h-5 w-5 shrink-0 text-rose-600" aria-hidden />;
  if (status === "warn") return <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden />;
  return <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />;
}

export function CloseDayPreflightPanel({ lang, snapshot, loading }: Props) {
  const translate = (key: string) => (t as (l: Language, k: string) => string)(lang, key);

  return (
    <section className="rounded-3xl border border-border bg-card p-4 shadow-waka-sm">
      <h2 className="text-base font-black text-foreground">{t(lang, "dayClosePreflightTitle")}</h2>
      <p className="mt-1 text-xs font-medium text-muted-foreground">{t(lang, "dayClosePreflightSub")}</p>

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t(lang, "dayClosePreflightLoading")}
        </p>
      ) : null}

      {snapshot ? (
        <ul className="mt-4 space-y-2">
          {snapshot.items.map((item) => (
            <li
              key={item.id}
              className={`flex items-start gap-3 rounded-2xl px-3 py-2.5 ${
                item.status === "fail" ? "bg-rose-50" : item.status === "pass" ? "bg-emerald-50/80" : "bg-muted"
              }`}
            >
              <StatusIcon status={item.status} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground">{translate(item.labelKey)}</p>
                {item.detailKey && item.status !== "pass" ? (
                  <p className="mt-0.5 text-xs font-medium text-muted-foreground">{translate(item.detailKey)}</p>
                ) : null}
                {item.navigateTo && item.status === "fail" ? (
                  <Link
                    to={item.navigateTo}
                    className="mt-1 inline-block text-xs font-black text-waka-700 underline"
                  >
                    {t(lang, "dayClosePreflightFixLink")}
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {snapshot && snapshot.openShifts.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-sm font-black text-rose-950">{t(lang, "dayCloseBlockedShiftsTitle")}</p>
          <ul className="mt-2 space-y-2">
            {snapshot.openShifts.map((sh) => (
              <li key={sh.shiftId} className="text-xs font-semibold text-rose-900">
                {tTemplate(lang, "dayCloseBlockedShiftRow", {
                  cashier: sh.actorName,
                  device: sh.deviceLabel,
                  opened: new Date(sh.startAt).toLocaleTimeString("en-UG", {
                    timeZone: "Africa/Kampala",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {snapshot && snapshot.hospitalitySessions.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-sm font-black text-rose-950">{t(lang, "dayCloseBlockedTablesTitle")}</p>
          <ul className="mt-2 space-y-2">
            {snapshot.hospitalitySessions.map((row) => (
              <li key={row.sessionId} className="rounded-xl bg-white/70 px-3 py-2">
                <p className="text-sm font-black text-foreground">{row.label}</p>
                <p className="text-xs font-semibold text-muted-foreground">
                  {row.waiterLabel ? `${t(lang, "dayCloseWaiter")}: ${row.waiterLabel} · ` : ""}
                  {t(lang, "dayCloseSessionStatus")}: {row.status}
                </p>
                <p className="text-xs font-bold text-foreground">UGX {row.amountUgx.toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {snapshot && snapshot.pendingSync.total > 0 ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-black text-amber-950">{t(lang, "dayCloseSyncWaitingTitle")}</p>
          <p className="mt-1 text-xs font-semibold text-amber-900">
            {tTemplate(lang, "dayCloseSyncWaitingBody", { count: snapshot.pendingSync.total })}
          </p>
        </div>
      ) : null}
    </section>
  );
}

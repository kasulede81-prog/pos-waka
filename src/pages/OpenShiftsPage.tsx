import { useMemo } from "react";
import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { shiftStatusLabel } from "../lib/shiftEnforcement";
import { dateKeyKampala } from "../lib/datesUg";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { PageHeader } from "../components/layout/PageHeader";
import {
  buildShiftSummaryRows,
  downloadShiftSummaryCsv,
  downloadShiftSummaryPdf,
} from "../lib/shiftReportExport";

function canViewShiftDashboard(role: string): boolean {
  return role === "owner" || role === "manager";
}

export function OpenShiftsPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
  const managerForceCloseOpenShift = usePosStore((s) => s.managerForceCloseOpenShift);
  const todayKey = dateKeyKampala(new Date());

  const rows = useMemo(() => buildShiftSummaryRows(shifts), [shifts]);
  const canForceClose = actor.role === "owner" || actor.role === "manager" || actor.role === "supervisor";

  if (!canViewShiftDashboard(actor.role)) {
    return <Navigate to="/office" replace />;
  }

  return (
    <EnterprisePageContainer>
      <PageHeader lang={lang} title={t(lang, "openShiftsTitle")} subtitle={t(lang, "openShiftsSub")} backFallback="/office" backLabel={t(lang, "officeBackToHub")} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => downloadShiftSummaryCsv(lang, rows)}
          className="min-h-10 rounded-xl border border-border bg-card px-4 text-sm font-black text-foreground"
        >
          {t(lang, "shiftReportExportCsv")}
        </button>
        <button
          type="button"
          onClick={() => downloadShiftSummaryPdf(lang, rows)}
          className="min-h-10 rounded-xl border border-border bg-card px-4 text-sm font-black text-foreground"
        >
          {t(lang, "shiftReportExportPdf")}
        </button>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-waka-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-muted text-xs font-black uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-3">{t(lang, "openShiftsColCashier")}</th>
              <th className="px-3 py-3">{t(lang, "openShiftsColRole")}</th>
              <th className="px-3 py-3">{t(lang, "openShiftsColStarted")}</th>
              <th className="px-3 py-3">{t(lang, "openShiftsColDuration")}</th>
              <th className="px-3 py-3">{t(lang, "openShiftsColSales")}</th>
              <th className="px-3 py-3">{t(lang, "openShiftsColDebt")}</th>
              <th className="px-3 py-3">{t(lang, "openShiftsColStatus")}</th>
              {canForceClose ? <th className="px-3 py-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={canForceClose ? 8 : 7} className="px-3 py-8 text-center font-semibold text-muted-foreground">
                  {t(lang, "openShiftsEmpty")}
                </td>
              </tr>
            ) : (
              rows.map(({ shift, durationLabel }) => {
                const shiftDay = dateKeyKampala(shift.startAt);
                const staleOpen = !shift.endAt && shiftDay < todayKey;
                return (
                <tr key={shift.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-3 font-bold text-foreground">{shift.actorName ?? shift.actorUserId}</td>
                  <td className="px-3 py-3 font-semibold text-muted-foreground">{t(lang, `role_${shift.role}`)}</td>
                  <td className="px-3 py-3 font-semibold text-muted-foreground">
                    {new Date(shift.startAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-3 font-semibold text-muted-foreground">{durationLabel}</td>
                  <td className="px-3 py-3 font-semibold text-foreground">
                    UGX {shift.salesTotalUgx.toLocaleString()}
                  </td>
                  <td className="px-3 py-3 font-semibold text-teal-800">
                    UGX {(shift.debtPaymentsTotalUgx ?? 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={
                        shiftStatusLabel(shift) === "ACTIVE"
                          ? staleOpen
                            ? "rounded-full bg-rose-100 px-2 py-0.5 text-xs font-black text-rose-900"
                            : "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-black text-emerald-900"
                          : "rounded-full bg-muted px-2 py-0.5 text-xs font-black text-muted-foreground"
                      }
                    >
                      {shiftStatusLabel(shift)}
                    </span>
                  </td>
                  {canForceClose ? (
                    <td className="px-3 py-3">
                      {!shift.endAt ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!window.confirm(t(lang, "openShiftsForceCloseConfirm"))) return;
                            managerForceCloseOpenShift(shift.id, "Manager force close");
                          }}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-black text-rose-900"
                        >
                          {t(lang, "openShiftsForceClose")}
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
              })
            )}
          </tbody>
        </table>
      </div>
    </EnterprisePageContainer>
  );
}

export function ShiftSummaryReportPage({ lang }: { lang: Language }) {
  return <OpenShiftsPage lang={lang} />;
}

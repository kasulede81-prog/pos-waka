import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import type { Language, ShiftRecord } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { shiftStatusLabel, formatShiftDuration } from "../lib/shiftEnforcement";
import { dateKeyKampala } from "../lib/datesUg";
import { WakaButton } from "../components/ui/wakaPrimitives";
import { ResponsiveDataTable } from "../components/shared/ResponsiveDataTable";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import {
  buildShiftSummaryRows,
  downloadShiftSummaryCsv,
  downloadShiftSummaryPdf,
} from "../lib/shiftReportExport";
import { actorHasPermission } from "../lib/actorAuthorization";
import {
  canActorRecoverShifts,
  listOpenShifts,
  listRecoverableOpenShifts,
} from "../lib/shiftRecoveryOps";
import { shiftExpectedCash } from "../lib/saleAdjustments";
import { ShiftRecoveryWizard } from "../components/pos/ShiftRecoveryWizard";

function canViewShiftDashboard(role: string): boolean {
  return role === "owner" || role === "manager" || role === "supervisor";
}

export function OpenShiftsPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
  const preferences = usePosStore((s) => s.preferences);
  const closeShiftWithCashCount = usePosStore((s) => s.closeShiftWithCashCount);
  const managerForceCloseOpenShift = usePosStore((s) => s.managerForceCloseOpenShift);
  const todayKey = dateKeyKampala(new Date());
  const [recoveringShift, setRecoveringShift] = useState<ShiftRecord | null>(null);

  const rows = useMemo(() => buildShiftSummaryRows(shifts), [shifts]);
  const openShifts = useMemo(() => listOpenShifts(shifts), [shifts]);
  const recoverableForActor = useMemo(
    () => listRecoverableOpenShifts(shifts, actor.userId),
    [shifts, actor.userId],
  );
  const canRecover = useMemo(
    () =>
      canActorRecoverShifts({
        actorUserId: actor.userId,
        actorRole: actor.role,
        actorDisplayName: actor.displayName,
        hasPermission: (permission) => actorHasPermission(actor, permission),
      }),
    [actor],
  );

  if (!canViewShiftDashboard(actor.role)) {
    return <Navigate to="/office" replace />;
  }

  const formulaVersion = preferences.cashDrawerFormulaVersion ?? "v1";

  return (
    <EnterprisePageContainer>
      <EnterprisePageHeader lang={lang} title={t(lang, "openShiftsTitle")} subtitle={t(lang, "openShiftsSub")} backFallback="/office" backLabel={t(lang, "officeBackToHub")} />

      {openShifts.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-black text-amber-950">{t(lang, "shiftRecoveryPendingBanner")}</p>
          <p className="mt-1 text-xs font-semibold text-amber-900">{t(lang, "shiftRecoveryPendingSub")}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <WakaButton type="button" variant="secondary" onClick={() => void downloadShiftSummaryCsv(lang, rows)}>
          {t(lang, "shiftReportExportCsv")}
        </WakaButton>
        <WakaButton type="button" variant="secondary" onClick={() => void downloadShiftSummaryPdf(lang, rows)}>
          {t(lang, "shiftReportExportPdf")}
        </WakaButton>
      </div>
      <ResponsiveDataTable minWidthPx={960}>
          <thead>
            <tr>
              <th className="px-3 py-3">{t(lang, "openShiftsColCashier")}</th>
              <th className="px-3 py-3">{t(lang, "openShiftsColRole")}</th>
              <th className="px-3 py-3">{t(lang, "openShiftsColStarted")}</th>
              <th className="px-3 py-3">{t(lang, "openShiftsColDuration")}</th>
              <th className="px-3 py-3">{t(lang, "openShiftsColSales")}</th>
              <th className="px-3 py-3">{t(lang, "openShiftsColDebt")}</th>
              <th className="px-3 py-3">{t(lang, "shiftRecoveryExpectedCash")}</th>
              <th className="px-3 py-3">{t(lang, "openShiftsColStatus")}</th>
              {canRecover ? <th className="px-3 py-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={canRecover ? 9 : 8} className="px-3 py-8 text-center font-semibold text-muted-foreground">
                  {t(lang, "openShiftsEmpty")}
                </td>
              </tr>
            ) : (
              rows.map(({ shift, durationLabel }) => {
                const shiftDay = dateKeyKampala(shift.startAt);
                const staleOpen = !shift.endAt && shiftDay < todayKey;
                const isOpen = !shift.endAt;
                const expectedCash = isOpen
                  ? shiftExpectedCash(shift, { formulaVersion })
                  : null;
                const isOtherOperator = isOpen && shift.actorUserId !== actor.userId;
                const showRecover = isOpen && canRecover && (isOtherOperator || actor.userId === shift.actorUserId);
                return (
                <tr key={shift.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-3 font-bold text-foreground">{shift.actorName ?? shift.actorUserId}</td>
                  <td className="px-3 py-3 font-semibold text-muted-foreground">{t(lang, `role_${shift.role}`)}</td>
                  <td className="px-3 py-3 font-semibold text-muted-foreground">
                    {new Date(shift.startAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-3 font-semibold text-muted-foreground">{durationLabel || formatShiftDuration(shift.startAt)}</td>
                  <td className="px-3 py-3 font-semibold text-foreground">
                    UGX {shift.salesTotalUgx.toLocaleString()}
                  </td>
                  <td className="px-3 py-3 font-semibold text-teal-800">
                    UGX {(shift.debtPaymentsTotalUgx ?? 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-3 font-semibold text-foreground">
                    {expectedCash != null ? `UGX ${expectedCash.toLocaleString()}` : "—"}
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
                  {canRecover ? (
                    <td className="px-3 py-3">
                      {showRecover ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setRecoveringShift(shift)}
                            className="rounded-lg border border-waka-200 bg-waka-50 px-2 py-1 text-xs font-black text-waka-900"
                          >
                            {isOtherOperator ? t(lang, "shiftRecoveryRecover") : t(lang, "shiftRecoveryContinue")}
                          </button>
                          {isOtherOperator && staleOpen ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (!window.confirm(t(lang, "openShiftsForceCloseConfirm"))) return;
                                managerForceCloseOpenShift(shift.id, "Emergency force close without count");
                              }}
                              className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-black text-rose-900"
                            >
                              {t(lang, "openShiftsForceClose")}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
              })
            )}
          </tbody>
      </ResponsiveDataTable>

      {recoverableForActor.length > 0 && canRecover ? (
        <p className="text-xs font-semibold text-muted-foreground">
          {tTemplate(lang, "shiftRecoveryOtherCount", { count: String(recoverableForActor.length) })}
        </p>
      ) : null}

      <ShiftRecoveryWizard
        lang={lang}
        open={Boolean(recoveringShift)}
        shift={recoveringShift}
        recoveryMode={Boolean(recoveringShift && recoveringShift.actorUserId !== actor.userId)}
        onClose={() => setRecoveringShift(null)}
        onConfirm={(counted, handoff, recoveryMeta) => {
          if (!recoveringShift) return { ok: false, errorKey: "invalid" };
          return closeShiftWithCashCount(counted, handoff, {
            shiftId: recoveringShift.id,
            recoveryReason: recoveryMeta?.recoveryReason,
            recoveryNotes: recoveryMeta?.recoveryNotes,
          });
        }}
      />
    </EnterprisePageContainer>
  );
}

export function ShiftSummaryReportPage({ lang }: { lang: Language }) {
  return <OpenShiftsPage lang={lang} />;
}

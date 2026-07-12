import { actorHasPermission } from "../lib/actorAuthorization";
import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  Scale,
  Sun,
  Wallet,
} from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";

import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { PageHeader } from "../components/layout/PageHeader";
import { OfficeNavCard } from "../components/office/OfficeNavCard";
import { DayDrawerOpenAlert } from "../components/office/DayDrawerOpenAlert";
import { buildCashManagementSnapshot, canAccessCashManagement } from "../lib/cashManagementSnapshot";
import { isFormulaV2 } from "../lib/dayDrawerOpen";
import {
  classifyCashVariance,
  computeCashVarianceThresholdUgx,
  varianceStateLabelKey,
  varianceStateStatusKind,
} from "../lib/cashVarianceExperience";
import { listOpenShifts, listRecoverableOpenShifts } from "../lib/shiftRecoveryOps";
import { shiftExpectedCash } from "../lib/saleAdjustments";
import { ShiftCashAuditTimeline } from "../components/cash/ShiftCashAuditTimeline";
import { statusTokens } from "../lib/statusTokens";
import clsx from "clsx";
import { useDrawerCashForToday } from "../hooks/useDrawerCashForDay";
import { getCachedComputation } from "../lib/computationResultCache";
import { timedComputation } from "../lib/performanceMetrics";
import { usePageLoadMark } from "../hooks/usePageLoadMark";
import { dateKeyKampala } from "../lib/datesUg";

type Props = { lang: Language };

export function CashManagementPage({ lang }: Props) {
  usePageLoadMark("cash-management");
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const dayCloses = usePosStore((s) => s.dayCloses);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
  const cashDrawerAdjustments = usePosStore((s) => s.cashDrawerAdjustments);

  const todayKey = dateKeyKampala(new Date());
  const drawer = useDrawerCashForToday();
  const [showVarianceHistory, setShowVarianceHistory] = useState(false);

  const snapshot = useMemo(() => {
    const fp = `${todayKey}:${dayCloses.length}:${cashDrawerAdjustments.length}:${dayDrawerOpens.length}:${shifts.length}:${drawer.expectedDrawerCashUgx}`;
    return getCachedComputation("buildCashManagementSnapshot", fp, () =>
      timedComputation("buildCashManagementSnapshot", () =>
        buildCashManagementSnapshot({
          lang,
          preferences,
          dayDrawerOpens,
          dayCloses,
          shifts,
          cashDrawerAdjustments,
          expectedCashUgx: drawer.expectedDrawerCashUgx,
        }),
      ),
    );
  }, [
    lang,
    preferences,
    dayDrawerOpens,
    dayCloses,
    shifts,
    cashDrawerAdjustments,
    drawer.expectedDrawerCashUgx,
    todayKey,
  ]);

  const canOpen = actorHasPermission(actor, "day.open_drawer");
  const canClose = actorHasPermission(actor, "day.close");
  const canShifts = actor.role === "owner" || actor.role === "manager";
  const canHistory = actorHasPermission(actor, "owner.cash_history");
  const needsDayOpen = isFormulaV2(preferences) && !snapshot.drawerOpen && canOpen;

  const openShifts = useMemo(() => listOpenShifts(shifts), [shifts]);
  const recoverableShifts = useMemo(
    () => listRecoverableOpenShifts(shifts, actor.userId),
    [shifts, actor.userId],
  );
  const toleranceUgx = computeCashVarianceThresholdUgx(snapshot.periodExpectedCashUgx, preferences);
  const dayAssessment =
    snapshot.latestCountedCashUgx != null
      ? classifyCashVariance(
          snapshot.periodExpectedCashUgx,
          snapshot.latestCountedCashUgx,
          preferences,
          "day_close",
        )
      : null;
  const closedToday = useMemo(
    () =>
      shifts
        .filter((sh) => sh.endAt && dateKeyKampala(sh.startAt) === todayKey && sh.countedCashUgx != null)
        .slice(0, 5),
    [shifts, todayKey],
  );
  const formulaVersion = preferences.cashDrawerFormulaVersion ?? "v1";

  if (!canAccessCashManagement(actor.role)) {
    return <Navigate to="/office" replace />;
  }

  return (
    <EnterprisePageContainer className="space-y-5">
      <PageHeader
        lang={lang}
        title={t(lang, "cashManagementTitle")}
        subtitle={t(lang, "cashManagementSub")}
        backLabel={t(lang, "officeBackToHub")}
        backFallback="/office"
      />

      {needsDayOpen ? <DayDrawerOpenAlert lang={lang} /> : null}

      <section
        className={`rounded-3xl border-2 p-5 ${
          snapshot.isBalanced ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
        }`}
      >
        <div className="flex items-start gap-3">
          {snapshot.isBalanced ? (
            <CheckCircle2 className="mt-0.5 h-8 w-8 shrink-0 text-emerald-700" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 h-8 w-8 shrink-0 text-amber-800" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black uppercase tracking-wide text-muted-foreground">{snapshot.dayKey}</p>
            <p className="mt-1 text-xl font-black text-foreground">
              {snapshot.isBalanced ? t(lang, "cashManagementBalanced") : t(lang, "cashManagementNeedsReview")}
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold text-muted-foreground">{t(lang, "cashManagementExpected")}</dt>
                <dd className="text-lg font-black tabular-nums">UGX {snapshot.periodExpectedCashUgx.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-muted-foreground">{t(lang, "cashManagementCounted")}</dt>
                <dd className="text-lg font-black tabular-nums">
                  {snapshot.latestCountedCashUgx != null
                    ? `UGX ${snapshot.latestCountedCashUgx.toLocaleString()}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-muted-foreground">{t(lang, "cashManagementVariance")}</dt>
                <dd
                  className={`text-lg font-black tabular-nums ${
                    snapshot.latestDayVarianceUgx != null && snapshot.latestDayVarianceUgx < 0
                      ? "text-rose-700"
                      : "text-foreground"
                  }`}
                >
                  {snapshot.latestDayVarianceUgx != null
                    ? `UGX ${snapshot.latestDayVarianceUgx.toLocaleString()}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-muted-foreground">{t(lang, "cashManagementTolerance")}</dt>
                <dd className="text-lg font-black tabular-nums">±UGX {toleranceUgx.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-muted-foreground">{t(lang, "cashManagementOpenShifts")}</dt>
                <dd className="text-lg font-black tabular-nums">{openShifts.length}</dd>
              </div>
              {recoverableShifts.length > 0 ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold text-muted-foreground">{t(lang, "cashManagementRecoveryPending")}</dt>
                  <dd className="text-sm font-black text-amber-900">
                    {recoverableShifts.length} ·{" "}
                    <a href="/office/open-shifts" className="underline">
                      {t(lang, "officeCardOpenShifts")}
                    </a>
                  </dd>
                </div>
              ) : null}
              {dayAssessment ? (
                <div className="sm:col-span-2">
                  <span className={clsx("inline-flex", statusTokens[varianceStateStatusKind(dayAssessment.state)].badgeRing)}>
                    {t(lang, varianceStateLabelKey(dayAssessment.state))}
                  </span>
                </div>
              ) : null}
              <div>
                <dt className="text-xs font-semibold text-muted-foreground">{t(lang, "cashManagementDrawerOpen")}</dt>
                <dd className="text-sm font-black">
                  {snapshot.drawerOpen
                    ? `UGX ${snapshot.drawerOpen.openingFloatUgx.toLocaleString()}`
                    : t(lang, "ownerCashDrawerOpenNo")}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <ul className="grid gap-3 sm:grid-cols-2">
        {canOpen && !needsDayOpen ? (
          <OfficeNavCard
            to="/office/day-open"
            title={t(lang, "officeCardDayOpen")}
            subtitle={t(lang, "officeCardDayOpenSub")}
            Icon={Sun}
          />
        ) : null}
        {canClose ? (
          <>
            <OfficeNavCard
              to="/office/cash-position"
              title={t(lang, "officeCardCashPosition")}
              subtitle={t(lang, "cashManagementCashPositionSub")}
              Icon={Wallet}
              highlight
            />
            <OfficeNavCard
              to="/close-day"
              title={t(lang, "officeCardCloseDay")}
              subtitle={t(lang, "cashManagementCloseDaySub")}
              Icon={Scale}
              highlight
            />
          </>
        ) : null}
        {canShifts ? (
          <OfficeNavCard
            to="/office/open-shifts"
            title={t(lang, "officeCardOpenShifts")}
            subtitle={t(lang, "cashManagementShiftsSub")}
            Icon={Clock}
          />
        ) : null}
        {actorHasPermission(actor, "settings.view") ? (
          <OfficeNavCard
            to="/settings/health"
            title={t(lang, "cashManagementSyncStatus")}
            subtitle={t(lang, "cashManagementSyncStatusSub")}
            Icon={Banknote}
          />
        ) : null}
      </ul>

      {closedToday.length > 0 && canShifts ? (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="text-base font-black text-foreground">{t(lang, "cashManagementClosedShiftsToday")}</h2>
          <ul className="mt-3 space-y-4">
            {closedToday.map((shift) => (
              <li key={shift.id}>
                <p className="text-sm font-black text-foreground">{shift.actorName ?? shift.actorUserId}</p>
                <ShiftCashAuditTimeline
                  lang={lang}
                  shift={shift}
                  expectedCashUgx={shiftExpectedCash(shift, { formulaVersion })}
                  preferences={preferences}
                  className="mt-2"
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(snapshot.shortageShiftCount > 0 || snapshot.topShortages.length > 0) && canShifts ? (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="text-base font-black text-foreground">{t(lang, "cashManagementShortages")}</h2>
          <ul className="mt-3 space-y-2">
            {snapshot.topShortages.map((row) => (
              <li key={row.userId} className="flex justify-between rounded-xl bg-muted px-3 py-2 text-sm">
                <span className="font-bold text-foreground">{row.label}</span>
                <span className="font-black tabular-nums text-rose-700">
                  {row.shortageCount30d} / 30d · UGX {row.lifetimeShortageUgx.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {snapshot.floatVerificationFeed.length > 0 ? (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="text-base font-black text-foreground">{t(lang, "ownerCashFloatFeed")}</h2>
          <ul className="mt-3 space-y-2">
            {snapshot.floatVerificationFeed.map((row) => (
              <li key={row.shiftId} className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs">
                <div className="flex justify-between font-bold text-rose-950">
                  <span>{row.cashierLabel}</span>
                  <span>UGX {row.varianceUgx.toLocaleString()}</span>
                </div>
                <p className="text-rose-900">
                  {t(lang, "ownerCashFloatVerifier")}: {row.verifierLabel ?? "—"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {snapshot.adjustmentFeed.length > 0 ? (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="text-base font-black text-foreground">{t(lang, "ownerCashAdjustmentFeed")}</h2>
          <ul className="mt-3 space-y-2">
            {snapshot.adjustmentFeed.map((row) => (
              <li key={row.id} className="flex justify-between rounded-xl bg-muted px-3 py-2 text-xs">
                <span className="font-bold text-foreground">{row.actorLabel}</span>
                <span className={`font-black tabular-nums ${row.direction === "out" ? "text-rose-700" : "text-emerald-700"}`}>
                  {row.direction === "out" ? "−" : "+"}UGX {row.amountUgx.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canHistory && snapshot.varianceHistory.length > 0 ? (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <button
            type="button"
            onClick={() => setShowVarianceHistory((v) => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <h2 className="text-base font-black text-foreground">{t(lang, "cashManagementVarianceHistory")}</h2>
            <span className="text-sm font-bold text-muted-foreground">{showVarianceHistory ? "−" : "+"}</span>
          </button>
          {showVarianceHistory ? (
            <ul className="mt-3 divide-y divide-stone-100">
              {snapshot.varianceHistory.map((row) => (
                <li key={row.id} className="flex justify-between py-2 text-sm">
                  <span className="font-bold text-foreground">{row.dateKey}</span>
                  <span className={`font-black tabular-nums ${row.flagged ? "text-rose-700" : "text-foreground"}`}>
                    UGX {row.differenceUgx.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

    </EnterprisePageContainer>
  );
}

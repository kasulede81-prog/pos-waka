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
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import { EnterpriseCard } from "../components/enterprise/EnterpriseCard";
import { WakaButton } from "../components/ui/wakaPrimitives";
import { Body, Caption, MonoNumber, SectionTitle } from "../components/enterprise/EnterpriseTypography";
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
      <EnterprisePageHeader
        lang={lang}
        title={t(lang, "cashManagementTitle")}
        subtitle={t(lang, "cashManagementSub")}
        backLabel={t(lang, "officeBackToHub")}
        backFallback="/office"
      />

      {needsDayOpen ? <DayDrawerOpenAlert lang={lang} /> : null}

      <EnterpriseCard
        className={clsx(
          snapshot.isBalanced ? statusTokens.success.banner : statusTokens.warning.banner,
          snapshot.isBalanced ? statusTokens.success.badgeRing : statusTokens.warning.badgeRing,
        )}
      >
        <div className="flex items-start gap-3">
          {snapshot.isBalanced ? (
            <CheckCircle2 className="mt-0.5 h-8 w-8 shrink-0 text-emerald-700" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 h-8 w-8 shrink-0 text-amber-800" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <Caption>{snapshot.dayKey}</Caption>
            <SectionTitle as="p" className="mt-1">
              {snapshot.isBalanced ? t(lang, "cashManagementBalanced") : t(lang, "cashManagementNeedsReview")}
            </SectionTitle>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <Caption className="normal-case">{t(lang, "cashManagementExpected")}</Caption>
                <MonoNumber className="text-lg">UGX {snapshot.periodExpectedCashUgx.toLocaleString()}</MonoNumber>
              </div>
              <div>
                <Caption className="normal-case">{t(lang, "cashManagementCounted")}</Caption>
                <MonoNumber className="text-lg">
                  {snapshot.latestCountedCashUgx != null
                    ? `UGX ${snapshot.latestCountedCashUgx.toLocaleString()}`
                    : "—"}
                </MonoNumber>
              </div>
              <div>
                <Caption className="normal-case">{t(lang, "cashManagementVariance")}</Caption>
                <MonoNumber className={clsx("text-lg", snapshot.latestDayVarianceUgx != null && snapshot.latestDayVarianceUgx < 0 && "text-rose-700")}>
                  {snapshot.latestDayVarianceUgx != null
                    ? `UGX ${snapshot.latestDayVarianceUgx.toLocaleString()}`
                    : "—"}
                </MonoNumber>
              </div>
              <div>
                <Caption className="normal-case">{t(lang, "cashManagementTolerance")}</Caption>
                <MonoNumber className="text-lg">±UGX {toleranceUgx.toLocaleString()}</MonoNumber>
              </div>
              <div>
                <Caption className="normal-case">{t(lang, "cashManagementOpenShifts")}</Caption>
                <MonoNumber className="text-lg">{openShifts.length}</MonoNumber>
              </div>
              {recoverableShifts.length > 0 ? (
                <div className="sm:col-span-2">
                  <Caption className="normal-case">{t(lang, "cashManagementRecoveryPending")}</Caption>
                  <Body className="!text-sm !font-black text-amber-900">
                    {recoverableShifts.length} ·{" "}
                    <a href="/office/open-shifts" className="underline">
                      {t(lang, "officeCardOpenShifts")}
                    </a>
                  </Body>
                </div>
              ) : null}
              {dayAssessment ? (
                <div className="sm:col-span-2">
                  <span className={clsx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold", statusTokens[varianceStateStatusKind(dayAssessment.state)].badge, statusTokens[varianceStateStatusKind(dayAssessment.state)].badgeRing)}>
                    {t(lang, varianceStateLabelKey(dayAssessment.state))}
                  </span>
                </div>
              ) : null}
              <div>
                <Caption className="normal-case">{t(lang, "cashManagementDrawerOpen")}</Caption>
                <Body className="!text-sm !font-black">
                  {snapshot.drawerOpen
                    ? `UGX ${snapshot.drawerOpen.openingFloatUgx.toLocaleString()}`
                    : t(lang, "ownerCashDrawerOpenNo")}
                </Body>
              </div>
            </dl>
          </div>
        </div>
      </EnterpriseCard>

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
        <EnterpriseCard title={t(lang, "cashManagementClosedShiftsToday")}>
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
        </EnterpriseCard>
      ) : null}

      {(snapshot.shortageShiftCount > 0 || snapshot.topShortages.length > 0) && canShifts ? (
        <EnterpriseCard title={t(lang, "cashManagementShortages")}>
          <ul className="mt-3 space-y-2">
            {snapshot.topShortages.map((row) => (
              <li key={row.userId} className="flex justify-between rounded-xl bg-muted px-3 py-2 text-sm">
                <span className="font-bold text-foreground">{row.label}</span>
                <MonoNumber className={clsx("text-rose-700")}>
                  {row.shortageCount30d} / 30d · UGX {row.lifetimeShortageUgx.toLocaleString()}
                </MonoNumber>
              </li>
            ))}
          </ul>
        </EnterpriseCard>
      ) : null}

      {snapshot.floatVerificationFeed.length > 0 ? (
        <EnterpriseCard title={t(lang, "ownerCashFloatFeed")}>
          <ul className="space-y-2">
            {snapshot.floatVerificationFeed.map((row) => (
              <li key={row.shiftId} className={clsx("rounded-xl border px-3 py-2 text-xs", statusTokens.danger.banner, statusTokens.danger.badgeRing)}>
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
        </EnterpriseCard>
      ) : null}

      {snapshot.adjustmentFeed.length > 0 ? (
        <EnterpriseCard title={t(lang, "ownerCashAdjustmentFeed")}>
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
        </EnterpriseCard>
      ) : null}

      {canHistory && snapshot.varianceHistory.length > 0 ? (
        <EnterpriseCard
          title={t(lang, "cashManagementVarianceHistory")}
          actions={
            <WakaButton type="button" variant="ghost" onClick={() => setShowVarianceHistory((v) => !v)}>
              {showVarianceHistory ? "−" : "+"}
            </WakaButton>
          }
        >
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
        </EnterpriseCard>
      ) : null}

    </EnterprisePageContainer>
  );
}

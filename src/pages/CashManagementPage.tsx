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
import { hasPermission } from "../lib/permissions";
import { PageHeader } from "../components/layout/PageHeader";
import { OfficeNavCard } from "../components/office/OfficeNavCard";
import { DayDrawerOpenAlert } from "../components/office/DayDrawerOpenAlert";
import { buildCashManagementSnapshot, canAccessCashManagement } from "../lib/cashManagementSnapshot";
import { isFormulaV2 } from "../lib/dayDrawerOpen";
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

  if (!canAccessCashManagement(actor.role)) {
    return <Navigate to="/office" replace />;
  }

  const canOpen = hasPermission(actor.role, "day.open_drawer");
  const canClose = hasPermission(actor.role, "day.close");
  const canShifts = actor.role === "owner" || actor.role === "manager";
  const canHistory = hasPermission(actor.role, "owner.cash_history");
  const needsDayOpen = isFormulaV2(preferences) && !snapshot.drawerOpen && canOpen;

  return (
    <div className="page-content-pad space-y-5 pb-24">
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
            <p className="text-sm font-black uppercase tracking-wide text-stone-700">{snapshot.dayKey}</p>
            <p className="mt-1 text-xl font-black text-stone-950">
              {snapshot.isBalanced ? t(lang, "cashManagementBalanced") : t(lang, "cashManagementNeedsReview")}
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold text-stone-600">{t(lang, "cashManagementExpected")}</dt>
                <dd className="text-lg font-black tabular-nums">UGX {snapshot.periodExpectedCashUgx.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-stone-600">{t(lang, "cashManagementCounted")}</dt>
                <dd className="text-lg font-black tabular-nums">
                  {snapshot.latestCountedCashUgx != null
                    ? `UGX ${snapshot.latestCountedCashUgx.toLocaleString()}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-stone-600">{t(lang, "cashManagementVariance")}</dt>
                <dd
                  className={`text-lg font-black tabular-nums ${
                    snapshot.latestDayVarianceUgx != null && snapshot.latestDayVarianceUgx < 0
                      ? "text-rose-700"
                      : "text-stone-950"
                  }`}
                >
                  {snapshot.latestDayVarianceUgx != null
                    ? `UGX ${snapshot.latestDayVarianceUgx.toLocaleString()}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-stone-600">{t(lang, "cashManagementDrawerOpen")}</dt>
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
        {hasPermission(actor.role, "settings.view") ? (
          <OfficeNavCard
            to="/settings/health"
            title={t(lang, "cashManagementSyncStatus")}
            subtitle={t(lang, "cashManagementSyncStatusSub")}
            Icon={Banknote}
          />
        ) : null}
      </ul>

      {(snapshot.shortageShiftCount > 0 || snapshot.topShortages.length > 0) && canShifts ? (
        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-black text-slate-950">{t(lang, "cashManagementShortages")}</h2>
          <ul className="mt-3 space-y-2">
            {snapshot.topShortages.map((row) => (
              <li key={row.userId} className="flex justify-between rounded-xl bg-stone-50 px-3 py-2 text-sm">
                <span className="font-bold text-stone-900">{row.label}</span>
                <span className="font-black tabular-nums text-rose-700">
                  {row.shortageCount30d} / 30d · UGX {row.lifetimeShortageUgx.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {snapshot.floatVerificationFeed.length > 0 ? (
        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-black text-slate-950">{t(lang, "ownerCashFloatFeed")}</h2>
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
        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-black text-slate-950">{t(lang, "ownerCashAdjustmentFeed")}</h2>
          <ul className="mt-3 space-y-2">
            {snapshot.adjustmentFeed.map((row) => (
              <li key={row.id} className="flex justify-between rounded-xl bg-stone-50 px-3 py-2 text-xs">
                <span className="font-bold text-stone-900">{row.actorLabel}</span>
                <span className={`font-black tabular-nums ${row.direction === "out" ? "text-rose-700" : "text-emerald-700"}`}>
                  {row.direction === "out" ? "−" : "+"}UGX {row.amountUgx.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canHistory && snapshot.varianceHistory.length > 0 ? (
        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <button
            type="button"
            onClick={() => setShowVarianceHistory((v) => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <h2 className="text-base font-black text-slate-950">{t(lang, "cashManagementVarianceHistory")}</h2>
            <span className="text-sm font-bold text-stone-500">{showVarianceHistory ? "−" : "+"}</span>
          </button>
          {showVarianceHistory ? (
            <ul className="mt-3 divide-y divide-stone-100">
              {snapshot.varianceHistory.map((row) => (
                <li key={row.id} className="flex justify-between py-2 text-sm">
                  <span className="font-bold text-stone-900">{row.dateKey}</span>
                  <span className={`font-black tabular-nums ${row.flagged ? "text-rose-700" : "text-stone-800"}`}>
                    UGX {row.differenceUgx.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

    </div>
  );
}

import { useMemo } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { dateKeyKampala } from "../../lib/datesUg";
import { activeDayCloseForDate } from "../../lib/dayCloseIdempotency";
import {
  activeDayDrawerOpenForDate,
  hasDuplicateOpeningFloatRisk,
  hasLegacyShiftFloatsOnDay,
  isFormulaV2,
  resolveCashDrawerFormulaVersion,
} from "../../lib/dayDrawerOpen";

export function CashDrawerDiagnosticsCard({ lang }: { lang: Language }) {
  const cashDrawerAdjustments = usePosStore((s) => s.cashDrawerAdjustments);
  const dayCloses = usePosStore((s) => s.dayCloses);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
  const preferences = usePosStore((s) => s.preferences);

  const todayKey = dateKeyKampala(new Date());
  const pct = preferences.cashVarianceThresholdPct ?? 5;
  const fixed = preferences.cashVarianceThresholdUgxFixed ?? 10_000;
  const formulaVersion = resolveCashDrawerFormulaVersion(preferences);
  const dayOpen = activeDayDrawerOpenForDate(dayDrawerOpens, todayKey);

  const issues = useMemo(() => {
    const list: string[] = [];
    const activeShiftToday = shifts.some((s) => dateKeyKampala(s.startAt) === todayKey && !s.endAt);

    if (isFormulaV2(preferences)) {
      if (!dayOpen && activeShiftToday) {
        list.push(t(lang, "cashDrawerDiagnosticsMissingFloat"));
      }
      if (hasLegacyShiftFloatsOnDay(shifts, todayKey)) {
        list.push(t(lang, "dayDrawerDiagnosticsLegacyShiftFloat"));
      }
      if (hasDuplicateOpeningFloatRisk(formulaVersion, todayKey, cashDrawerAdjustments, shifts, dayDrawerOpens)) {
        list.push(t(lang, "dayDrawerDiagnosticsDuplicateRisk"));
      }
    } else {
      const openingFloat =
        (cashDrawerAdjustments
          .filter((a) => !a.deletedAt && a.type === "opening_float")
          .reduce((s, a) => s + a.amountUgx, 0) || 0) +
        shifts
          .filter((sh) => dateKeyKampala(sh.startAt) === todayKey)
          .reduce((s, sh) => s + (sh.openingFloatUgx ?? 0), 0);
      if (openingFloat <= 0 && activeShiftToday) {
        list.push(t(lang, "cashDrawerDiagnosticsMissingFloat"));
      }
      if (!dayOpen) {
        list.push(t(lang, "dayDrawerDiagnosticsMigrationReady"));
      }
    }

    const unsynced = [...cashDrawerAdjustments, ...dayDrawerOpens].filter((a) => a.pendingSync && !a.deletedAt).length;
    if (unsynced > 0) {
      list.push(`${t(lang, "cashDrawerDiagnosticsUnsynced")}: ${unsynced}`);
    }

    const todayClose = activeDayCloseForDate(dayCloses, todayKey);
    if (todayClose) {
      const exp = Math.max(1, todayClose.expectedCashUgx);
      const absDiff = Math.abs(todayClose.differenceUgx);
      if (absDiff > Math.max((pct / 100) * exp, fixed)) {
        list.push(
          `${t(lang, "cashDrawerDiagnosticsLargeVariance")}: UGX ${absDiff.toLocaleString()}`,
        );
      }
    }

    for (const adj of cashDrawerAdjustments) {
      if (adj.deletedAt) continue;
      if (adj.amountUgx < 0) {
        list.push(t(lang, "cashDrawerDiagnosticsNegativeEvent"));
        break;
      }
    }

    return list;
  }, [cashDrawerAdjustments, dayCloses, dayDrawerOpens, shifts, todayKey, lang, pct, fixed, preferences, dayOpen, formulaVersion]);

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-900">{t(lang, "cashDrawerDiagnosticsTitle")}</p>
      <p className="mt-1 text-sm text-stone-600">{todayKey}</p>
      <p className="mt-2 text-xs font-bold uppercase text-stone-500">
        {t(lang, "dayDrawerDiagnosticsFormula")}: {formulaVersion}
      </p>
      {dayOpen ? (
        <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm">
          <p className="font-black text-sky-950">UGX {dayOpen.openingFloatUgx.toLocaleString()}</p>
          <p className="font-semibold text-sky-900">
            {t(lang, "dayOpenOpenedBy")}: {dayOpen.countedByLabel}
          </p>
          {dayOpen.firstVerifiedByLabel ? (
            <p className="font-semibold text-sky-900">
              {t(lang, "dayOpenFirstVerified")}: {dayOpen.firstVerifiedByLabel}
            </p>
          ) : null}
        </div>
      ) : null}
      {issues.length === 0 ? (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-950">
          {t(lang, "cashDrawerDiagnosticsAllClear")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {issues.map((issue) => (
            <li
              key={issue}
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950"
            >
              {issue}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

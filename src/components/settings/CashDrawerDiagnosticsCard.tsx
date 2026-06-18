import { useMemo } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { dateKeyKampala } from "../../lib/datesUg";
import { activeDayCloseForDate } from "../../lib/dayCloseIdempotency";
import { resolveOpeningFloatUgx } from "../../lib/cashDrawerLedger";

export function CashDrawerDiagnosticsCard({ lang }: { lang: Language }) {
  const cashDrawerAdjustments = usePosStore((s) => s.cashDrawerAdjustments);
  const dayCloses = usePosStore((s) => s.dayCloses);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
  const preferences = usePosStore((s) => s.preferences);

  const todayKey = dateKeyKampala(new Date());
  const pct = preferences.cashVarianceThresholdPct ?? 5;
  const fixed = preferences.cashVarianceThresholdUgxFixed ?? 10_000;

  const issues = useMemo(() => {
    const list: string[] = [];
    const openingFloat = resolveOpeningFloatUgx(todayKey, cashDrawerAdjustments, shifts);
    const activeShiftToday = shifts.some((s) => dateKeyKampala(s.startAt) === todayKey && !s.endAt);
    if (openingFloat <= 0 && activeShiftToday) {
      list.push(t(lang, "cashDrawerDiagnosticsMissingFloat"));
    }

    const unsynced = cashDrawerAdjustments.filter((a) => a.pendingSync && !a.deletedAt).length;
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
  }, [cashDrawerAdjustments, dayCloses, shifts, todayKey, lang, pct, fixed]);

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-900">{t(lang, "cashDrawerDiagnosticsTitle")}</p>
      <p className="mt-1 text-sm text-stone-600">{todayKey}</p>
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

import { useEffect, useMemo, useState } from "react";
import type { Language, ShiftRecord } from "../../types";
import { t } from "../../lib/i18n";
import { formatShiftDuration } from "../../lib/shiftEnforcement";
import { shiftExpectedCash, shiftExpectedCashLabelParts } from "../../lib/saleAdjustments";
import { activeDayDrawerOpenForDate } from "../../lib/dayDrawerOpen";
import { dateKeyKampala } from "../../lib/datesUg";
import { usePosStore } from "../../store/usePosStore";

type Props = {
  lang: Language;
  shift: ShiftRecord;
  cashierName: string;
  onCloseShift: () => void;
};

export function ActiveShiftBanner({ lang, shift, cashierName, onCloseShift }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const preferences = usePosStore((s) => s.preferences);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const formulaVersion = preferences.cashDrawerFormulaVersion ?? "v1";
  const cashCtx = useMemo(() => ({ formulaVersion }), [formulaVersion]);
  const parts = useMemo(() => shiftExpectedCashLabelParts(shift, cashCtx), [shift, cashCtx]);
  const expected = shiftExpectedCash(shift, cashCtx);
  const dayOpen = useMemo(
    () =>
      formulaVersion === "v2"
        ? activeDayDrawerOpenForDate(dayDrawerOpens, dateKeyKampala(new Date()))
        : null,
    [formulaVersion, dayDrawerOpens],
  );
  const openingFloatDisplay =
    parts.openingFloat > 0
      ? parts.openingFloat
      : formulaVersion === "v2"
        ? Math.max(0, shift.verifiedFloatUgx ?? dayOpen?.openingFloatUgx ?? 0)
        : parts.openingFloat;

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const startedLabel = new Date(shift.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="rounded-2xl border border-teal-200 bg-teal-50/90 px-3 py-2.5 text-xs shadow-waka-sm sm:text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="font-black text-teal-950">
            {t(lang, "activeShiftCashier")}: {cashierName}
          </p>
          <p className="font-semibold text-teal-900">
            {t(lang, "activeShiftStarted")} {startedLabel} · {formatShiftDuration(shift.startAt, now)}
          </p>
        </div>
        <button
          type="button"
          onClick={onCloseShift}
          className="shrink-0 rounded-xl border border-teal-700 bg-teal-700 px-3 py-1.5 text-[11px] font-black text-white sm:text-xs"
        >
          {t(lang, "shiftCloseBtn")}
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-semibold text-teal-900 sm:grid-cols-4">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-teal-700">{t(lang, "shiftCloseOpeningFloat")}</dt>
          <dd>UGX {openingFloatDisplay.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-teal-700">{t(lang, "shiftCloseSales")}</dt>
          <dd>UGX {parts.sales.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-teal-700">{t(lang, "shiftCloseDebtPayments")}</dt>
          <dd>UGX {parts.debtPayments.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-teal-700">{t(lang, "shiftCloseExpected")}</dt>
          <dd className="font-black">UGX {expected.toLocaleString()}</dd>
        </div>
      </dl>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import type { Language, ShiftRecord } from "../../types";
import { t } from "../../lib/i18n";
import { formatShiftDuration } from "../../lib/shiftEnforcement";
import { shiftExpectedCash, shiftExpectedCashLabelParts } from "../../lib/saleAdjustments";

type Props = {
  lang: Language;
  shift: ShiftRecord;
  cashierName: string;
  onCloseShift: () => void;
};

export function ActiveShiftBanner({ lang, shift, cashierName, onCloseShift }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const parts = useMemo(() => shiftExpectedCashLabelParts(shift), [shift]);
  const expected = shiftExpectedCash(shift);

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
          <dd>UGX {(shift.openingFloatUgx ?? 0).toLocaleString()}</dd>
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

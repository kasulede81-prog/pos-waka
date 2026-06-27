import { useEffect, useMemo, useState } from "react";
import { Banknote, Clock, User, Wallet } from "lucide-react";
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

function MetricPill({
  icon: Icon,
  label,
  value,
  emphasize,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden />
      <div className="min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-wide text-teal-700/90">{label}</p>
        <p className={`truncate text-xs leading-tight ${emphasize ? "font-black text-teal-950" : "font-bold text-teal-900"}`}>
          {value}
        </p>
      </div>
    </div>
  );
}

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

  const duration = formatShiftDuration(shift.startAt, now);
  const fmt = (n: number) => `UGX ${n.toLocaleString()}`;

  return (
    <div className="rounded-2xl border border-teal-200/80 bg-gradient-to-br from-teal-50 to-white px-3 py-2 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-800">
            <User className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-teal-950">
              {t(lang, "activeShiftCashier")}: {cashierName}
            </p>
            <p className="flex items-center gap-1 text-[11px] font-semibold text-teal-800">
              <Clock className="h-3 w-3 shrink-0" aria-hidden />
              Shift · {duration}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseShift}
          className="shrink-0 rounded-xl bg-teal-700 px-3 py-1.5 text-[11px] font-black text-white shadow-sm active:bg-teal-800"
        >
          {t(lang, "shiftCloseBtn")}
        </button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1.5 border-t border-teal-100/80 pt-2">
        <MetricPill icon={Wallet} label={t(lang, "shiftCloseOpeningFloat")} value={fmt(openingFloatDisplay)} />
        <MetricPill icon={Banknote} label={t(lang, "shiftCloseSales")} value={fmt(parts.sales)} />
        <MetricPill icon={Wallet} label={t(lang, "shiftCloseExpected")} value={fmt(expected)} emphasize />
      </div>
      <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-teal-800">
        <Banknote className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        {t(lang, "shiftCloseDebtPayments")}: {fmt(parts.debtPayments)}
      </p>
    </div>
  );
}

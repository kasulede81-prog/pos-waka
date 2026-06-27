import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { Banknote, ChevronDown, Clock, ShoppingCart, User, Wallet } from "lucide-react";
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
  todaySaleCount: number;
  todaySalesUgx: number;
  pendingCount: number;
  onCloseShift: () => void;
  onRecordExpense?: () => void;
  canRecordExpense?: boolean;
  canSavePending?: boolean;
};

function fmt(n: number) {
  return `UGX ${n.toLocaleString()}`;
}

export function PosShiftSummaryCollapsible({
  lang,
  shift,
  cashierName,
  todaySaleCount,
  todaySalesUgx,
  pendingCount,
  onCloseShift,
  onRecordExpense,
  canRecordExpense,
  canSavePending,
}: Props) {
  const [expanded, setExpanded] = useState(false);
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

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const duration = formatShiftDuration(shift.startAt, now);

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full min-h-[50px] items-center gap-2 rounded-xl border border-stone-200/90 bg-white px-2.5 py-2 text-left shadow-sm transition-all active:scale-[0.99] motion-reduce:active:scale-100"
      >
        <ChevronDown
          className={clsx("h-4 w-4 shrink-0 text-stone-500 transition-transform duration-200", expanded && "rotate-180")}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-black uppercase tracking-wide text-stone-500">
            {t(lang, "posShiftSummaryTitle")}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="inline-flex items-center gap-1 text-xs font-bold text-teal-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
              Shift · {duration}
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-bold text-stone-800">
              <ShoppingCart className="h-3 w-3 text-teal-700" aria-hidden />
              {todaySaleCount}
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-black text-teal-800">
              <Wallet className="h-3 w-3" aria-hidden />
              {fmt(todaySalesUgx)}
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-bold text-stone-600">
              <Clock className="h-3 w-3" aria-hidden />
              {pendingCount}
            </span>
          </div>
        </div>
      </button>

      {expanded ? (
        <>
          <button
            type="button"
            aria-label={t(lang, "cancel")}
            className="fixed inset-0 z-[44] bg-stone-900/40 backdrop-blur-[2px] transition-opacity duration-200"
            onClick={() => setExpanded(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t(lang, "posShiftSummaryTitle")}
            className="fixed left-2 right-2 top-[calc(var(--waka-safe-top,0px)+3.25rem)] z-[45] max-h-[min(70dvh,32rem)] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-4 shadow-2xl transition-all duration-200"
          >
            <div className="flex items-start gap-3 border-b border-stone-100 pb-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-800">
                <User className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-stone-950">
                  {t(lang, "activeShiftCashier")}: {cashierName}
                </p>
                <p className="text-xs font-semibold text-stone-500">
                  {t(lang, "activeShiftStarted")} · {duration}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-stone-500 active:bg-stone-100"
              >
                {t(lang, "cancel")}
              </button>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-stone-50 p-2.5">
                <dt className="text-[10px] font-bold uppercase tracking-wide text-stone-500">
                  {t(lang, "shiftCloseOpeningFloat")}
                </dt>
                <dd className="mt-0.5 text-sm font-black text-stone-950">{fmt(openingFloatDisplay)}</dd>
              </div>
              <div className="rounded-xl bg-teal-50/80 p-2.5">
                <dt className="text-[10px] font-bold uppercase tracking-wide text-teal-700">
                  {t(lang, "shiftCloseSales")}
                </dt>
                <dd className="mt-0.5 text-sm font-black text-teal-900">{fmt(parts.sales)}</dd>
              </div>
              <div className="rounded-xl bg-teal-50/80 p-2.5">
                <dt className="text-[10px] font-bold uppercase tracking-wide text-teal-700">
                  {t(lang, "shiftCloseExpected")}
                </dt>
                <dd className="mt-0.5 text-sm font-black text-teal-900">{fmt(expected)}</dd>
              </div>
              <div className="rounded-xl bg-stone-50 p-2.5">
                <dt className="text-[10px] font-bold uppercase tracking-wide text-stone-500">
                  {t(lang, "shiftCloseDebtPayments")}
                </dt>
                <dd className="mt-0.5 text-sm font-black text-stone-950">{fmt(parts.debtPayments)}</dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setExpanded(false);
                  onCloseShift();
                }}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-sm font-black text-white shadow-sm active:bg-teal-800"
              >
                <Banknote className="h-4 w-4" aria-hidden />
                {t(lang, "shiftCloseBtn")}
              </button>
              {canRecordExpense && onRecordExpense ? (
                <button
                  type="button"
                  onClick={() => {
                    setExpanded(false);
                    onRecordExpense();
                  }}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-bold text-stone-800 active:bg-stone-50"
                >
                  {t(lang, "posRecordExpenseBtn")}
                </button>
              ) : null}
              {canSavePending ? (
                <Link
                  to="/pending-sales"
                  onClick={() => setExpanded(false)}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-950 active:bg-amber-100"
                >
                  {t(lang, "pendingSalesLink")}
                  {pendingCount > 0 ? (
                    <span className="rounded-full bg-amber-400 px-1.5 py-px text-[10px] font-black text-amber-950">
                      {pendingCount}
                    </span>
                  ) : null}
                </Link>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

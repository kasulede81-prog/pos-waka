import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, CheckCircle2, Clock, Languages } from "lucide-react";
import type { Language, ShiftRecord } from "../../types";
import { t } from "../../lib/i18n";
import { formatShiftDuration } from "../../lib/shiftEnforcement";
import { shiftExpectedCash, shiftExpectedCashLabelParts } from "../../lib/saleAdjustments";
import { activeDayDrawerOpenForDate } from "../../lib/dayDrawerOpen";
import { dateKeyKampala } from "../../lib/datesUg";
import { usePosStore } from "../../store/usePosStore";
import { WakaSymbolIcon } from "../brand/WakaLogo";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { countSalesWithSyncErrors } from "../../offline/cloudSync";
import { useUiLanguage } from "../../hooks/useUiLanguage";
import { languageToggleLabel, nextLanguage } from "../../lib/language";
import { confirmLeavePosIfNeeded } from "../../lib/posExitGuard";
import { POS_HOME_ROUTE } from "../../lib/posNavigation";

type Props = {
  lang: Language;
  sellLabelKey: string;
  cashierName: string;
  shift: ShiftRecord | null;
  todaySaleCount: number;
  todaySalesUgx: number;
  pendingCount: number;
  onCloseShift: () => void;
};

function MetricCell({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="hidden min-w-0 xl:block">
      <p className="truncate text-[9px] font-bold uppercase tracking-wide text-stone-500">{label}</p>
      <p className={clsx("truncate text-xs font-black leading-tight", emphasize ? "text-waka-800" : "text-stone-800")}>
        {value}
      </p>
    </div>
  );
}

/** Single-line ~56px enterprise POS header for full desktop sell screen. */
export function PosDesktopCompactHeader({
  lang,
  sellLabelKey,
  cashierName,
  shift,
  todaySaleCount,
  todaySalesUgx,
  pendingCount,
  onCloseShift,
}: Props) {
  const navigate = useNavigate();
  const { setLang } = useUiLanguage();
  const sync = useSyncStatus();
  const syncErrors = countSalesWithSyncErrors();
  const synced = sync.pendingCount === 0 && syncErrors === 0;
  const preferences = usePosStore((s) => s.preferences);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const [now, setNow] = useState(() => Date.now());

  const formulaVersion = preferences.cashDrawerFormulaVersion ?? "v1";
  const cashCtx = useMemo(() => ({ formulaVersion }), [formulaVersion]);
  const parts = useMemo(() => (shift ? shiftExpectedCashLabelParts(shift, cashCtx) : null), [shift, cashCtx]);
  const expected = shift ? shiftExpectedCash(shift, cashCtx) : 0;
  const dayOpen = useMemo(
    () =>
      formulaVersion === "v2"
        ? activeDayDrawerOpenForDate(dayDrawerOpens, dateKeyKampala(new Date()))
        : null,
    [formulaVersion, dayDrawerOpens],
  );
  const openingFloatDisplay =
    parts && parts.openingFloat > 0
      ? parts.openingFloat
      : shift && formulaVersion === "v2"
        ? Math.max(0, shift.verifiedFloatUgx ?? dayOpen?.openingFloatUgx ?? 0)
        : parts?.openingFloat ?? 0;

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const duration = shift ? formatShiftDuration(shift.startAt, now) : "—";
  const fmt = (n: number) => `UGX ${n.toLocaleString()}`;

  const handleExit = () => {
    void confirmLeavePosIfNeeded(window.location.pathname, POS_HOME_ROUTE).then((ok) => {
      if (ok) navigate(POS_HOME_ROUTE, { preventScrollReset: true });
    });
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-stone-200/90 bg-white px-2 shadow-sm sm:gap-3 sm:px-3">
      <button
        type="button"
        onClick={handleExit}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-stone-50 text-stone-600 active:bg-stone-100"
        aria-label={t(lang, "posNavExit")}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </button>

      <WakaSymbolIcon size="xs" className="h-8 w-8 shrink-0" />
      <div className="hidden min-w-0 sm:block">
        <p className="truncate text-sm font-black text-stone-950">Waka POS</p>
        <p className="truncate text-[10px] font-bold text-waka-700">{t(lang, sellLabelKey)}</p>
      </div>

      <div className="mx-1 hidden h-8 w-px shrink-0 bg-stone-200 lg:block" aria-hidden />

      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        <div className="min-w-0 shrink">
          <p className="truncate text-[9px] font-bold uppercase tracking-wide text-stone-500">
            {t(lang, "activeShiftCashier")}
          </p>
          <p className="truncate text-xs font-black text-stone-900">{cashierName}</p>
        </div>

        <div className="hidden min-w-0 shrink items-center gap-1 text-stone-700 md:flex">
          <Clock className="h-3.5 w-3.5 shrink-0 text-waka-600" aria-hidden />
          <span className="truncate text-xs font-bold">{duration}</span>
        </div>

        <MetricCell label={t(lang, "shiftCloseOpeningFloat")} value={fmt(openingFloatDisplay)} />
        <MetricCell
          label={t(lang, "salesHistoryTodaySales")}
          value={`${todaySaleCount} · ${fmt(todaySalesUgx)}`}
        />
        <MetricCell
          label={t(lang, "pendingSalesLink")}
          value={String(pendingCount)}
          emphasize={pendingCount > 0}
        />
        <MetricCell label={t(lang, "posDesktopDrawerBalance")} value={fmt(expected)} emphasize />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className={clsx(
            "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black",
            synced
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-900",
          )}
          role="status"
        >
          {synced ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : null}
          {synced ? t(lang, "desktopHomeStatusSynced") : t(lang, "desktopHomeStatusSyncPending")}
        </span>

        <button
          type="button"
          onClick={() => setLang(nextLanguage(lang))}
          className="hidden h-9 items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 text-[10px] font-bold text-stone-700 active:bg-stone-50 sm:inline-flex"
          aria-label={languageToggleLabel(lang)}
        >
          <Languages className="h-3.5 w-3.5" aria-hidden />
          {languageToggleLabel(lang).slice(0, 2).toUpperCase()}
        </button>

        {shift ? (
          <button
            type="button"
            onClick={onCloseShift}
            className="hidden h-9 shrink-0 rounded-lg bg-teal-700 px-2.5 text-[10px] font-black text-white active:bg-teal-800 lg:inline-flex lg:items-center"
          >
            {t(lang, "shiftCloseBtn")}
          </button>
        ) : null}
      </div>
    </header>
  );
}

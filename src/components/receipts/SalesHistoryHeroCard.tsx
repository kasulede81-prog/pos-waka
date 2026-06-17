import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronDown, ChevronRight, HandCoins, Wallet } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DateFilterPreset, DateFilterValue } from "../../lib/dateFilters";
import { dateKeyKampala } from "../../lib/datesUg";
import { formatDateFilterViewingLabel } from "../../lib/dateFilterLabels";

const PRESETS: DateFilterPreset[] = ["today", "this_week", "this_month"];

type Props = {
  lang: Language;
  salesLabel: string;
  salesUgx: number;
  profitUgx: number | null;
  showProfit: boolean;
  totalDebtUgx: number;
  showDebtsLink?: boolean;
  filter: DateFilterValue;
  onFilterChange: (next: DateFilterValue) => void;
  sparklinePoints?: number[];
};

function formatPickerDate(dateKey: string, lang: Language): string {
  const parts = dateKey.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return dateKey;
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const locale = lang === "sw" ? "sw-UG" : "en-UG";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Kampala",
  }).format(anchor);
}

function ProfitSparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const w = 88;
  const h = 28;
  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 4) - 2;
    return `${x},${y}`;
  });
  const area = `M0,${h} L${coords.map((c) => c.replace(",", " ")).join(" L")} L${w},${h} Z`;
  const line = coords.join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 h-7 w-[5.5rem]" aria-hidden>
      <defs>
        <linearGradient id="salesSparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(255 237 213)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="rgb(255 237 213)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#salesSparkFill)" />
      <polyline
        fill="none"
        stroke="rgb(254 215 170)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={line}
      />
    </svg>
  );
}

export function SalesHistoryHeroCard({
  lang,
  salesLabel,
  salesUgx,
  profitUgx,
  showProfit,
  totalDebtUgx,
  showDebtsLink = true,
  filter,
  onFilterChange,
  sparklinePoints,
}: Props) {
  const dateInputId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const customDayKey = filter.kind === "day" ? filter.dateKey : dateKeyKampala(new Date());
  const filterLabel = formatDateFilterViewingLabel(lang, filter);
  const pickerDateLabel =
    filter.kind === "day" ? formatPickerDate(filter.dateKey, lang) : filterLabel;

  const presetLabel = (p: DateFilterPreset) => {
    if (p === "today") return t(lang, "dateFilterPresetToday");
    if (p === "this_week") return t(lang, "dateFilterPresetThisWeek");
    return t(lang, "dateFilterPresetThisMonth");
  };

  return (
    <div className="overflow-hidden rounded-[1.35rem] bg-gradient-to-br from-waka-600 via-waka-600 to-waka-700 text-white shadow-waka-md">
      <div className="grid grid-cols-3 divide-x divide-white/15">
        <div className="px-2 py-3 sm:px-4 sm:py-5">
          <p className="text-[10px] font-bold text-waka-100/90 sm:text-xs">{salesLabel}</p>
          <p className="mt-1 text-lg font-black tracking-tight sm:text-2xl lg:text-[1.65rem]">
            UGX {salesUgx.toLocaleString()}
          </p>
          <Link
            to="/reports"
            className="mt-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-waka-50/95 hover:text-white sm:mt-2 sm:text-xs"
          >
            {t(lang, "salesHistoryViewSummary")}
            <ChevronRight className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden />
          </Link>
        </div>
        <div className="relative px-2 py-3 sm:px-4 sm:py-5">
          <div className="absolute right-1.5 top-2 flex h-7 w-7 items-center justify-center rounded-xl bg-white/15 sm:right-3 sm:top-3 sm:h-8 sm:w-8">
            <Wallet className="h-3.5 w-3.5 text-white/95 sm:h-4 sm:w-4" aria-hidden />
          </div>
          <p className="text-[10px] font-bold text-waka-100/90 sm:text-xs">{t(lang, "salesHistoryProfits")}</p>
          {showProfit ? (
            <>
              <p className="mt-1 text-lg font-black tracking-tight sm:text-2xl lg:text-[1.65rem]">
                UGX {(profitUgx ?? 0).toLocaleString()}
              </p>
              {sparklinePoints && sparklinePoints.length > 1 ? (
                <ProfitSparkline points={sparklinePoints} />
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm font-semibold text-waka-100/80">—</p>
          )}
        </div>
        <div className="relative px-2 py-3 sm:px-4 sm:py-5">
          <div className="absolute right-1.5 top-2 flex h-7 w-7 items-center justify-center rounded-xl bg-white/15 sm:right-3 sm:top-3 sm:h-8 sm:w-8">
            <HandCoins className="h-3.5 w-3.5 text-white/95 sm:h-4 sm:w-4" aria-hidden />
          </div>
          <p className="text-[10px] font-bold text-waka-100/90 sm:text-xs">{t(lang, "salesHistoryTotalDebts")}</p>
          <p className="mt-1 text-lg font-black tracking-tight sm:text-2xl lg:text-[1.65rem]">
            UGX {totalDebtUgx.toLocaleString()}
          </p>
          {showDebtsLink ? (
            <Link
              to="/debts"
              className="mt-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-waka-50/95 hover:text-white sm:mt-2 sm:text-xs"
            >
              {t(lang, "salesHistoryViewDebts")}
              <ChevronRight className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>

      <div className="relative border-t border-white/10 bg-waka-800/35 px-3 py-2">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="mx-auto flex min-h-[40px] w-full max-w-sm items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold text-white/95 active:bg-white/10"
        >
          <CalendarDays className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
          <span>{pickerDateLabel}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${pickerOpen ? "rotate-180" : ""}`} aria-hidden />
        </button>

        {pickerOpen ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-[44]"
              aria-label={t(lang, "cancel")}
              onClick={() => setPickerOpen(false)}
            />
            <div className="absolute bottom-full left-3 right-3 z-[45] mb-1 rounded-2xl border border-stone-200 bg-white p-3 text-stone-900 shadow-xl">
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      onFilterChange({ kind: "preset", preset });
                      setPickerOpen(false);
                    }}
                    className={`min-h-[36px] rounded-full border px-3 text-xs font-black ${
                      filter.kind === "preset" && filter.preset === preset
                        ? "border-waka-500 bg-waka-600 text-white"
                        : "border-stone-200 bg-stone-50 text-stone-800"
                    }`}
                  >
                    {presetLabel(preset)}
                  </button>
                ))}
              </div>
              <label
                htmlFor={dateInputId}
                className="mt-3 flex min-h-[40px] cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm font-bold text-stone-800"
              >
                <CalendarDays className="h-4 w-4 shrink-0 text-waka-600" aria-hidden />
                <span>{t(lang, "dateFilterPickDate")}</span>
                <input
                  id={dateInputId}
                  type="date"
                  className="ml-auto max-w-[9rem] rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-semibold"
                  value={customDayKey}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    onFilterChange({ kind: "day", dateKey: v });
                    setPickerOpen(false);
                  }}
                />
              </label>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

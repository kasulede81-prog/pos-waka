import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { ModalSheet } from "../../../components/layout/ModalSheet";
import type { DateFilterValue } from "../../../lib/dateFilters";
import { extendedPresetToFilter } from "../lib/analyticsPageView";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  currentFilter: DateFilterValue;
  onApply: (filter: DateFilterValue) => void;
};

const PRESETS = [
  "today",
  "yesterday",
  "this_week",
  "last_7_days",
  "this_month",
  "last_month",
  "this_year",
] as const;

function presetLabelKey(preset: string): string {
  if (preset === "today") return "dateFilterPresetToday";
  if (preset === "yesterday") return "dateFilterPresetYesterday";
  if (preset === "this_week") return "dateFilterPresetThisWeek";
  if (preset === "last_7_days") return "baPresetLast7Days";
  if (preset === "this_month") return "dateFilterPresetThisMonth";
  if (preset === "last_month") return "baPresetLastMonth";
  return "baPresetThisYear";
}

function isPresetActive(current: DateFilterValue, preset: string): boolean {
  const next = extendedPresetToFilter(preset);
  if (current.kind === "preset" && next.kind === "preset") return current.preset === next.preset;
  return JSON.stringify(current) === JSON.stringify(next);
}

export function AnalyticsDateFilterSheet({ lang, open, onClose, currentFilter, onApply }: Props) {
  const customFrom = currentFilter.kind === "range" ? currentFilter.fromKey : "";
  const customTo = currentFilter.kind === "range" ? currentFilter.toKey : "";

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={t(lang, "baDateRange")}
      footer={
        <button type="button" onClick={onClose} className="min-h-[48px] w-full rounded-2xl bg-waka-600 text-sm font-black text-white">
          {t(lang, "icApplyFilters")}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                onApply(extendedPresetToFilter(preset));
                onClose();
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-black ${
                isPresetActive(currentFilter, preset) ? "bg-waka-600 text-white" : "border border-border bg-card text-muted-foreground"
              }`}
            >
              {t(lang, presetLabelKey(preset))}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "auditFilterDateFrom")}
            <input
              type="date"
              className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-border px-3 text-sm font-semibold"
              value={customFrom}
              onChange={(e) => onApply({ kind: "range", fromKey: e.target.value, toKey: customTo || e.target.value })}
            />
          </label>
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "auditFilterDateTo")}
            <input
              type="date"
              className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-border px-3 text-sm font-semibold"
              value={customTo}
              onChange={(e) => onApply({ kind: "range", fromKey: customFrom || e.target.value, toKey: e.target.value })}
            />
          </label>
        </div>
      </div>
    </ModalSheet>
  );
}

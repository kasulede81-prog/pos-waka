import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { Language } from "../../types";
import type { DateFilterValue } from "../../lib/dateFilters";
import { HistoryDatePickerStrip } from "./HistoryDatePickerStrip";

export type HistoryHeroMetric = {
  label: string;
  value: string;
  icon?: LucideIcon;
  hint?: string;
  footer?: ReactNode;
  belowValue?: ReactNode;
};

type Props = {
  lang: Language;
  metrics: HistoryHeroMetric[];
  filter?: DateFilterValue;
  onFilterChange?: (next: DateFilterValue) => void;
  dateLabelOverride?: string;
  datePickerFooter?: ReactNode;
  /** Compact strip below metrics (e.g. POS action chips). */
  footer?: ReactNode;
};

export function HistoryHeroCard({
  lang,
  metrics,
  filter,
  onFilterChange,
  dateLabelOverride,
  datePickerFooter,
  footer,
}: Props) {
  const count = Math.min(3, Math.max(1, metrics.length));
  const gridClass = count === 1 ? "grid-cols-1" : count === 2 ? "grid-cols-2" : "grid-cols-3";

  return (
    <div className="overflow-hidden rounded-[1.35rem] bg-gradient-to-br from-waka-600 via-waka-600 to-waka-700 text-white shadow-waka-md">
      <div className={`grid ${gridClass} divide-x divide-white/15`}>
        {metrics.slice(0, 3).map((metric, index) => {
          const Icon = metric.icon;
          return (
            <div key={index} className="relative px-2 py-3 sm:px-4 sm:py-5">
              {Icon ? (
                <div className="absolute right-1.5 top-2 flex h-7 w-7 items-center justify-center rounded-xl bg-white/15 sm:right-3 sm:top-3 sm:h-8 sm:w-8">
                  <Icon className="h-3.5 w-3.5 text-white/95 sm:h-4 sm:w-4" aria-hidden />
                </div>
              ) : null}
              <p className="text-[10px] font-bold text-waka-100/90 sm:text-xs">{metric.label}</p>
              <p className="mt-1 text-lg font-black tracking-tight sm:text-2xl lg:text-[1.65rem]">{metric.value}</p>
              {metric.belowValue}
              {metric.hint ? (
                <p className="mt-1 text-[10px] font-semibold text-waka-100/75 sm:text-xs">{metric.hint}</p>
              ) : null}
              {metric.footer}
            </div>
          );
        })}
      </div>
      {footer ? (
        <div className="border-t border-white/15 px-2 py-1.5 sm:px-3 sm:py-2">{footer}</div>
      ) : null}
      {filter && onFilterChange ? (
        <HistoryDatePickerStrip
          lang={lang}
          filter={filter}
          onFilterChange={onFilterChange}
          labelOverride={dateLabelOverride}
          footer={datePickerFooter}
        />
      ) : null}
    </div>
  );
}

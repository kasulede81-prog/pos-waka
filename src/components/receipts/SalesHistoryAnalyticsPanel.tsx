import { useState } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Metric = { label: string; value: string };

type Props = {
  lang: Language;
  metrics: Metric[];
};

export function SalesHistoryAnalyticsPanel({ lang, metrics }: Props) {
  const [open, setOpen] = useState(false);
  if (metrics.length === 0) return null;

  return (
    <div className="rounded-xl border border-stone-200/90 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full min-h-[44px] items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-xs font-black text-stone-800">{t(lang, "salesHistoryAnalytics")}</span>
        <ChevronDown className={clsx("h-4 w-4 text-stone-500 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <dl className="grid grid-cols-2 gap-2 border-t border-stone-100 px-3 py-3 sm:grid-cols-3">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-lg bg-stone-50 px-2.5 py-2">
              <dt className="text-[10px] font-bold uppercase tracking-wide text-stone-500">{m.label}</dt>
              <dd className="mt-0.5 text-sm font-black tabular-nums text-stone-950">{m.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

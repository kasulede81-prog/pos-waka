import { useState } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Insight = { text: string };

type Props = {
  lang: Language;
  insights: Insight[];
};

export function ProfitInsightsPanel({ lang, insights }: Props) {
  const [open, setOpen] = useState(false);
  if (insights.length === 0) return null;

  return (
    <section className="rounded-2xl border border-stone-200/90 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full min-h-[44px] items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="text-xs font-black text-stone-800">{t(lang, "profitInsightsTitle")}</span>
        <ChevronDown className={clsx("h-4 w-4 text-stone-500 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <ul className="space-y-2 border-t border-stone-100 px-3 py-3">
          {insights.map((item, i) => (
            <li key={i} className="flex gap-2 text-xs font-medium leading-relaxed text-stone-700">
              <span className="mt-0.5 shrink-0 text-waka-600">•</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

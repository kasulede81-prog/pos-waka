import clsx from "clsx";
import { Sparkles } from "lucide-react";
import type { Language } from "../../../types";
import { t, tTemplate } from "../../../lib/i18n";
import type { AiInsightCard } from "../types";

type Props = {
  lang: Language;
  insights: AiInsightCard[];
};

const TONE_CLASS: Record<AiInsightCard["tone"], string> = {
  green: "border-emerald-200 bg-emerald-50/80 text-emerald-950",
  blue: "border-sky-200 bg-sky-50/80 text-sky-950",
  orange: "border-amber-200 bg-amber-50/80 text-amber-950",
  purple: "border-violet-200 bg-violet-50/80 text-violet-950",
  rose: "border-rose-200 bg-rose-50/80 text-rose-950",
};

export function AnalyticsAiInsights({ lang, insights }: Props) {
  if (insights.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border/90 bg-gradient-to-br from-white to-muted p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-waka-600 text-white">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
        <h2 className="text-sm font-black text-foreground">{t(lang, "baAiInsightsTitle")}</h2>
      </div>
      <div className="-mx-0.5 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
        {insights.map((insight) => (
          <article
            key={insight.id}
            className={clsx("min-w-[220px] shrink-0 rounded-2xl border p-3 shadow-sm", TONE_CLASS[insight.tone])}
          >
            <p className="text-sm font-semibold leading-snug">
              {insight.textVars
                ? tTemplate(lang, insight.textKey, Object.fromEntries(Object.entries(insight.textVars).map(([k, v]) => [k, String(v)])))
                : t(lang, insight.textKey)}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

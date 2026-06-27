import { Link } from "react-router-dom";
import { Bot, Sparkles } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";

type Props = {
  lang: Language;
  insightKeys: string[];
  pctRevenue: number | null;
  topProductName: string | null;
  onViewRecommendations?: () => void;
};

export function CommandCenterAiCoach({ lang, insightKeys, pctRevenue, topProductName, onViewRecommendations }: Props) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-sky-200/80 bg-gradient-to-br from-sky-50/90 via-white to-indigo-50/50 p-4 shadow-sm backdrop-blur-sm sm:p-5">
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-sky-200/30 blur-2xl" aria-hidden />
      <div className="flex gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-md">
          <Bot className="h-6 w-6" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-sky-600" aria-hidden />
            <h2 className="text-sm font-black text-sky-950 sm:text-base">{t(lang, "cmdCenterAiCoachTitle")}</h2>
          </div>
          <ul className="mt-2 space-y-1.5">
            {insightKeys.map((key) => (
              <li key={key} className="flex gap-2 text-xs font-semibold text-sky-950/90">
                <span className="text-sky-500">•</span>
                <span>
                  {key === "cmdCenterInsightRevenueUp" || key === "cmdCenterInsightRevenueDown"
                    ? tTemplate(lang, key, { pct: String(Math.abs(pctRevenue ?? 0).toFixed(0)) })
                    : key === "cmdCenterInsightReorder" && topProductName
                      ? tTemplate(lang, key, { name: topProductName })
                      : t(lang, key)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              to="/office"
              className="inline-flex min-h-[36px] items-center rounded-xl bg-sky-600 px-3 text-xs font-black text-white"
            >
              {t(lang, "cmdCenterAskAi")}
            </Link>
            <button
              type="button"
              onClick={onViewRecommendations}
              className="inline-flex min-h-[36px] items-center rounded-xl border border-sky-200 bg-white/80 px-3 text-xs font-black text-sky-900"
            >
              {t(lang, "cmdCenterViewRecommendations")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

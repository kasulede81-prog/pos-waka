import { Link } from "react-router-dom";
import { Share2 } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { starCountFromScore } from "../../lib/commandCenterPageView";

type Props = {
  lang: Language;
  score: number;
  summaryKey: string;
  summaryVars?: Record<string, string | number>;
  onExport: () => void;
  onShare: () => void;
};

export function CommandCenterExecutiveFooter({
  lang,
  score,
  summaryKey,
  summaryVars,
  onExport,
  onShare,
}: Props) {
  const stars = starCountFromScore(score);

  return (
    <section className="overflow-hidden rounded-3xl border border-stone-200/60 bg-gradient-to-br from-white/90 via-stone-50/80 to-waka-50/40 p-4 shadow-sm backdrop-blur-md sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-stone-500">{t(lang, "cmdCenterExecutiveTitle")}</p>
          <p className="mt-1 text-lg font-black text-stone-950" aria-label={`${stars} stars`}>
            {"⭐".repeat(stars)}
            {"☆".repeat(5 - stars)}
          </p>
          <p className="mt-0.5 text-2xl font-black tabular-nums text-waka-700">
            {score} <span className="text-base font-bold text-stone-500">/ 100</span>
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm font-semibold leading-relaxed text-stone-700">
        {summaryVars ? tTemplate(lang, summaryKey, summaryVars) : t(lang, summaryKey)}
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Link
          to="/settings/health"
          className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border-2 border-stone-200 bg-white/80 px-4 text-sm font-black text-stone-900"
        >
          {t(lang, "cmdCenterViewFullReport")}
        </Link>
        <button
          type="button"
          onClick={onExport}
          className="inline-flex min-h-[44px] items-center justify-center rounded-2xl bg-waka-600 px-4 text-sm font-black text-white"
        >
          {t(lang, "cmdCenterExportDashboard")}
        </button>
        <button
          type="button"
          onClick={onShare}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl border-2 border-stone-200 bg-white/80 px-4 text-sm font-black text-stone-900"
        >
          <Share2 className="h-4 w-4" aria-hidden />
          {t(lang, "cmdCenterShareReport")}
        </button>
      </div>
    </section>
  );
}

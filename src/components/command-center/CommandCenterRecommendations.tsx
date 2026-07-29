import { Link } from "react-router-dom";
import clsx from "clsx";
import { Lightbulb } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import type { CommandCenterRecommendation } from "../../lib/commandCenterPageView";

type Props = {
  lang: Language;
  recommendations: CommandCenterRecommendation[];
  sectionId?: string;
};

const toneClass: Record<CommandCenterRecommendation["tone"], string> = {
  orange: "from-waka-50 to-waka-50 border-waka-100",
  teal: "from-success-muted to-success-muted/80 border-success/20",
  blue: "from-sky-50 to-indigo-50 border-sky-100",
  rose: "from-danger-muted to-danger-muted/80 border-danger/20",
  amber: "from-warning-muted to-warning-muted/80 border-warning/20",
};

export function CommandCenterRecommendations({ lang, recommendations, sectionId }: Props) {
  if (recommendations.length === 0) return null;

  return (
    <section id={sectionId} className="rounded-3xl border border-border/90 bg-card p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-warning" aria-hidden />
        <h2 className="text-sm font-black text-foreground sm:text-base">{t(lang, "cmdCenterRecommendationsTitle")}</h2>
      </div>
      <ul className="mt-3 space-y-2">
        {recommendations.map((rec) => (
          <li
            key={rec.id}
            className={clsx(
              "flex items-center justify-between gap-3 rounded-2xl border bg-gradient-to-r p-3",
              toneClass[rec.tone],
            )}
          >
            <p className="min-w-0 flex-1 text-sm font-bold text-foreground">
              {rec.titleVars ? tTemplate(lang, rec.titleKey, rec.titleVars) : t(lang, rec.titleKey)}
            </p>
            <Link
              to={rec.actionTo}
              className="shrink-0 rounded-xl bg-card/90 px-3 py-2 text-xs font-black text-foreground shadow-sm ring-1 ring-border/80"
            >
              {t(lang, rec.actionLabelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

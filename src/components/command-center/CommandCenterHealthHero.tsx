import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { healthScoreLabelKey, type DomainStatusRow } from "../../lib/commandCenterPageView";

type Props = {
  lang: Language;
  score: number;
  domains: DomainStatusRow[];
};

import { chartShellClass, chartStroke } from "../../lib/chartTokens";
import { healthStatusBadge, healthStatusDot } from "../../lib/statusTokens";

function HealthRing({ score }: { score: number }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  return (
    <div className="relative flex h-[108px] w-[108px] shrink-0 items-center justify-center">
      <svg viewBox="0 0 108 108" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="54" cy="54" r={r} fill="none" stroke={chartStroke.track} strokeWidth="10" />
        <circle
          cx="54"
          cy="54"
          r={r}
          fill="none"
          stroke={chartStroke.primary}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black tabular-nums text-foreground">{score}%</span>
      </div>
    </div>
  );
}

export function CommandCenterHealthHero({ lang, score, domains }: Props) {
  return (
    <section className={clsx(chartShellClass, "overflow-hidden bg-gradient-to-br from-card via-card to-business-muted/40 p-4 sm:p-5")}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <HealthRing score={score} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            {t(lang, "cmdCenterHealthTitle")}
          </p>
          <p className="mt-0.5 text-lg font-black text-foreground">{t(lang, healthScoreLabelKey(score))}</p>
          <ul className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {domains.map((d) => (
              <li
                key={d.id}
                className={clsx(
                  "flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-[11px] font-bold ring-1 ring-inset",
                  healthStatusBadge(d.status === "critical" ? "critical" : d.status === "warning" ? "warning" : "ok"),
                )}
              >
                <span
                  className={clsx(
                    healthStatusDot(d.status === "critical" ? "critical" : d.status === "warning" ? "warning" : "ok"),
                  )}
                  aria-hidden
                />
                <span className="truncate">{t(lang, d.labelKey)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <Link
        to="/settings/health"
        className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-2xl bg-waka-600 px-4 text-sm font-black text-white shadow-sm transition active:scale-[0.99]"
      >
        {t(lang, "cmdCenterViewHealthReport")} →
      </Link>
    </section>
  );
}

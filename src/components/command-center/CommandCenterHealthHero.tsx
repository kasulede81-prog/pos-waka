import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { healthScoreLabelKey, type DomainStatusRow } from "../../lib/commandCenterPageView";
import { chartShellClass, chartStroke } from "../../lib/chartTokens";
import { healthStatusBadge, healthStatusDot } from "../../lib/statusTokens";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { Caption, SectionTitle } from "../enterprise/EnterpriseTypography";
import { WakaButton } from "../ui/wakaPrimitives";

type Props = {
  lang: Language;
  score: number;
  domains: DomainStatusRow[];
};

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
    <EnterpriseCard className={clsx(chartShellClass, "overflow-hidden bg-gradient-to-br from-card via-card to-business-muted/40")}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <HealthRing score={score} />
        <div className="min-w-0 flex-1">
          <Caption className="uppercase tracking-widest">{t(lang, "cmdCenterHealthTitle")}</Caption>
          <SectionTitle as="p" className="mt-0.5 !text-lg">{t(lang, healthScoreLabelKey(score))}</SectionTitle>
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
      <Link to="/settings/health" className="mt-4 block">
        <WakaButton type="button" className="w-full">
          {t(lang, "cmdCenterViewHealthReport")} →
        </WakaButton>
      </Link>
    </EnterpriseCard>
  );
}

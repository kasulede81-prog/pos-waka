import clsx from "clsx";
import { ArrowRight, BarChart3 } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { HomeTileLiveStat, HomeTileIntensity } from "../../lib/homeExecutiveKpis";
import type { ResolvedHomeTile } from "../../lib/launcherTiles";
import type { HomePulseSparkMode, HomePulseTrendPoint } from "../../lib/homePulseSpark";
import { resolveHomeTileAccent } from "../../lib/homeTileAccent";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { Caption, SectionTitle } from "../enterprise/EnterpriseTypography";
import { enterpriseIconClass, ENTERPRISE_ICON_STROKE } from "../../lib/enterpriseIcons";
import { HomeTileAccentWell } from "./HomeTileAccentWell";
import { HomeLiveValue } from "./HomeLiveValue";
import { HomePulseSparkline } from "./HomePulseSparkline";
import { HomeLiveStatusRail } from "./HomeLiveStatusRail";
import type { HomeHealthItem } from "../../hooks/useHomeBusinessHealthItems";

type Props = {
  lang: Language;
  tile: Pick<ResolvedHomeTile, "color" | "customColor">;
  liveStat?: HomeTileLiveStat;
  onOpen: () => void;
  weekTrend?: readonly HomePulseTrendPoint[];
  sparkMode?: HomePulseSparkMode | null;
  /** Stretch to fill the command-deck visualization column. */
  commandPanel?: boolean;
  intensity?: HomeTileIntensity;
  sellStat?: HomeTileLiveStat;
  healthItems?: readonly HomeHealthItem[];
  commandCenterTo?: string | null;
};

/** Reports as a live visualization panel driven by the existing 7-day Home trend. */
export function HomeReportsPreview({
  lang,
  tile,
  liveStat,
  onOpen,
  weekTrend = [],
  sparkMode = null,
  commandPanel = false,
  intensity = "calm",
  sellStat,
  healthItems = [],
  commandCenterTo = null,
}: Props) {
  const accent = resolveHomeTileAccent(tile);
  const showSpark = Boolean(sparkMode && weekTrend.length > 0);
  const engineHealth = healthItems.slice(0, 4);

  return (
    <EnterpriseCard
      className={clsx(
        "home-reports-preview home-reports-preview--world !border-teal-800/30 !bg-transparent !p-0 overflow-hidden",
        commandPanel && "flex h-full min-h-0 flex-col",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className={clsx(
          "relative flex w-full items-stretch gap-3 p-3 pl-3.5 text-left transition-waka active:scale-[0.99] motion-reduce:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-waka-500 sm:p-4 sm:pl-4",
          commandPanel ? "min-h-0 flex-1 flex-col gap-3" : "min-h-[76px] sm:min-h-[84px]",
        )}
      >
        <span
          className="pointer-events-none absolute inset-y-0 left-0 w-1"
          style={accent.railStyle}
          aria-hidden
        />
        <div className={clsx("flex items-center gap-3", commandPanel && "w-full")}>
          <HomeTileAccentWell accent={accent} size="lg">
            <BarChart3 className={clsx(enterpriseIconClass("md"), "text-current")} strokeWidth={ENTERPRISE_ICON_STROKE} aria-hidden />
          </HomeTileAccentWell>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {commandPanel ? (
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {t(lang, "homeLiveFloorTitle")}
              </p>
            ) : null}
            <SectionTitle as="span" className="block min-w-0 !text-base">
              {t(lang, "desktopHomeTileReports")}
            </SectionTitle>
            <Caption as="span" className="mt-0 block min-w-0 normal-case">
              {t(lang, "desktopHomeTileReportsSub")}
            </Caption>
          </div>
          {!commandPanel ? (
            <span className="flex shrink-0 items-center gap-1 self-center text-xs font-bold text-waka-900">
              {t(lang, "desktopHomeCtaViewReports")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </span>
          ) : null}
        </div>

        {showSpark && sparkMode ? (
          <HomePulseSparkline
            className={clsx(commandPanel ? "flex min-h-[7.5rem] w-full flex-1 flex-col" : "hidden min-w-[140px] sm:block sm:w-40")}
            lang={lang}
            points={weekTrend}
            mode={sparkMode}
            size={commandPanel ? "panel" : "compact"}
            intensity={liveStat?.intensity ?? intensity}
          />
        ) : null}

        {commandPanel && (sellStat || liveStat) ? (
          <div className="grid w-full grid-cols-2 gap-2" data-home-live-engine="true">
            {sellStat ? (
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{sellStat.label}</p>
                <HomeLiveValue value={sellStat.value} className="text-lg font-black tabular-nums text-foreground xl:text-xl" />
              </div>
            ) : null}
            {liveStat ? (
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{liveStat.label}</p>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                  <HomeLiveValue value={liveStat.value} className="text-lg font-black tabular-nums text-foreground xl:text-xl" />
                  {liveStat.trend ? <span className="text-xs font-bold text-success">{liveStat.trend}</span> : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : liveStat ? (
          <div className={clsx("min-w-0", commandPanel ? "w-full" : "flex-1")}>
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{liveStat.label}</p>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <HomeLiveValue value={liveStat.value} className="text-lg font-black tabular-nums text-foreground xl:text-xl" />
              {liveStat.trend ? <span className="text-xs font-bold text-success">{liveStat.trend}</span> : null}
            </div>
          </div>
        ) : null}

        {commandPanel ? (
          <span className="mt-auto flex items-center gap-1 text-xs font-bold text-waka-900">
            {t(lang, "desktopHomeCtaViewReports")}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </span>
        ) : null}
      </button>
      {commandPanel && engineHealth.length > 0 ? (
        <div className="px-3 pb-3 sm:px-4 sm:pb-4">
          <HomeLiveStatusRail
            lang={lang}
            items={engineHealth}
            commandCenterTo={commandCenterTo}
            orientation="rail"
          />
        </div>
      ) : null}
    </EnterpriseCard>
  );
}

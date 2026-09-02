import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { HomeTileLiveStat } from "../../lib/homeExecutiveKpis";
import type { HomePulseSparkMode, HomePulseTrendPoint } from "../../lib/homePulseSpark";
import { HOME_MOBILE_TYPE } from "../../lib/homeMobileComposition";
import { HomeLiveValue } from "./HomeLiveValue";
import { HomePulseSparkline } from "./HomePulseSparkline";

type Props = {
  lang: Language;
  weekTrend: readonly HomePulseTrendPoint[];
  sparkMode: HomePulseSparkMode | null;
  sellStat?: HomeTileLiveStat;
  intensity?: HomeTileLiveStat["intensity"];
};

/** Mobile live engine — one 7-day spark, real Home metrics only. */
export function MobileHomeLiveEngine({
  lang,
  weekTrend,
  sparkMode,
  sellStat,
  intensity = "calm",
}: Props) {
  const showSpark = Boolean(sparkMode && weekTrend.length > 0);
  if (!showSpark && !sellStat) return null;

  return (
    <section className="home-mobile-live" aria-label={t(lang, "homeLiveFloorTitle")}>
      <h2 className={`${HOME_MOBILE_TYPE.section} mb-2`}>{t(lang, "homeLiveFloorTitle")}</h2>
      {sellStat ? (
        <div className="mb-2">
          <HomeLiveValue value={sellStat.value} className="block text-xl font-black tabular-nums" />
          <p className="text-xs font-semibold opacity-80">{sellStat.label}</p>
        </div>
      ) : null}
      {showSpark && sparkMode ? (
        <HomePulseSparkline
          lang={lang}
          points={weekTrend}
          mode={sparkMode}
          size="compact"
          intensity={intensity}
          className={clsx("home-mobile-live__spark")}
        />
      ) : (
        <p className="text-xs font-medium opacity-75">{t(lang, "homePulseWeekEmpty")}</p>
      )}
    </section>
  );
}

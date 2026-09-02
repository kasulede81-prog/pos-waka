import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { HomeTileLiveStat } from "../../lib/homeExecutiveKpis";
import type { HomePulseSparkMode, HomePulseTrendPoint } from "../../lib/homePulseSpark";
import type { HomeHealthItem } from "../../hooks/useHomeBusinessHealthItems";
import { SectionTitle } from "../enterprise/EnterpriseTypography";
import { HomePulseSparkline } from "./HomePulseSparkline";
import { HomeLiveValue } from "./HomeLiveValue";
import { HomeLiveStatusRail } from "./HomeLiveStatusRail";

type Props = {
  lang: Language;
  weekTrend: readonly HomePulseTrendPoint[];
  sparkMode: HomePulseSparkMode | null;
  sellStat?: HomeTileLiveStat;
  healthItems: readonly HomeHealthItem[];
  commandCenterTo?: string | null;
  intensity?: HomeTileLiveStat["intensity"];
};

/**
 * Live Business Floor — occupies the canvas between Primary work and Operations.
 * Only existing Home metrics/health. No invented activity.
 */
export function HomeLiveBusinessFloor({
  lang,
  weekTrend,
  sparkMode,
  sellStat,
  healthItems,
  commandCenterTo,
  intensity = "calm",
}: Props) {
  const showSpark = Boolean(sparkMode && weekTrend.length > 0);
  const floorHealth = healthItems.slice(0, 4);
  if (!showSpark && !sellStat && floorHealth.length === 0) return null;

  return (
    <section className="home-live-floor" data-home-floor="true" aria-label={t(lang, "homeLiveFloorTitle")}>
      <SectionTitle as="h2" className="mb-1.5 !text-sm sm:!text-base">
        {t(lang, "homeLiveFloorTitle")}
      </SectionTitle>
      <p className="mb-2 text-xs font-medium text-muted-foreground">{t(lang, "homeLiveFloorSub")}</p>
      <div className="home-live-floor__deck">
        <div className="home-live-floor__viz">
          {floorHealth.length > 0 ? <FloorStatusNetwork items={floorHealth} /> : null}
          {showSpark && sparkMode ? (
            <HomePulseSparkline
              lang={lang}
              points={weekTrend}
              mode={sparkMode}
              size="panel"
              intensity={intensity}
              className="home-live-floor__spark"
            />
          ) : (
            <p className="text-xs font-medium text-muted-foreground">{t(lang, "homePulseWeekEmpty")}</p>
          )}
        </div>
        <div className="home-live-floor__status">
          {sellStat ? (
            <div className="home-live-floor__metric">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{sellStat.label}</p>
              <HomeLiveValue
                value={sellStat.value}
                className={clsx("text-lg font-black tabular-nums text-foreground", sellStat.trend && "mr-2")}
              />
              {sellStat.trend ? <span className="text-xs font-bold text-success">{sellStat.trend}</span> : null}
            </div>
          ) : null}
          {floorHealth.length > 0 ? (
            <HomeLiveStatusRail lang={lang} items={floorHealth} commandCenterTo={commandCenterTo} orientation="rail" />
          ) : null}
        </div>
      </div>
    </section>
  );
}

const FLOOR_NODE_POINTS = [
  [28, 22],
  [78, 14],
  [128, 24],
  [176, 16],
] as const;

function FloorStatusNetwork({ items }: { items: readonly HomeHealthItem[] }) {
  const nodes = items.slice(0, FLOOR_NODE_POINTS.length);
  if (nodes.length === 0) return null;
  const path = FLOOR_NODE_POINTS.slice(0, nodes.length)
    .map((point, index) => `${index === 0 ? "M" : "L"}${point[0]} ${point[1]}`)
    .join(" ");
  return (
    <svg className="home-live-floor__net" viewBox="0 0 200 36" aria-hidden>
      <path d={path} fill="none" stroke="rgba(234, 88, 12, 0.22)" strokeWidth="1.4" />
      {nodes.map((item, index) => {
        const point = FLOOR_NODE_POINTS[index];
        if (!point) return null;
        const fill =
          item.status === "critical" ? "#dc2626" : item.status === "warning" ? "#d97706" : "#0f766e";
        return <circle key={item.id} className="home-live-floor__node" cx={point[0]} cy={point[1]} r="4.2" fill={fill} />;
      })}
    </svg>
  );
}

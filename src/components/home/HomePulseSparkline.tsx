import { useId } from "react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  homePulseSparkArea,
  homePulseSparkCoords,
  homePulseSparkDayLabel,
  homePulseSparkHasActivity,
  homePulseSparkPolyline,
  homePulseSparkValues,
  type HomePulseSparkMode,
  type HomePulseTrendPoint,
} from "../../lib/homePulseSpark";
import type { HomeTileIntensity } from "../../lib/homeExecutiveKpis";

const COMPACT = { width: 240, height: 64, pad: 4 };
const PANEL = { width: 420, height: 120, pad: 10 };
const STAGE = { width: 640, height: 280, pad: 28 };

type Props = {
  lang: Language;
  points: readonly HomePulseTrendPoint[];
  mode: HomePulseSparkMode;
  className?: string;
  /** compact = hero chip; stage = viewport visualization. */
  size?: "compact" | "stage" | "panel";
  intensity?: HomeTileIntensity;
};

/** SVG of the existing 7-day Home trend. Path remounts when real values change. */
export function HomePulseSparkline({
  lang,
  points,
  mode,
  className,
  size = "compact",
  intensity = "calm",
}: Props) {
  const gradId = useId().replace(/:/g, "");
  const stage = size === "stage";
  const panel = size === "panel";
  const box = stage ? STAGE : panel ? PANEL : COMPACT;
  const values = homePulseSparkValues(points, mode);
  const coords = homePulseSparkCoords(values, box.width, box.height, box.pad);
  const line = homePulseSparkPolyline(coords);
  const area = homePulseSparkArea(coords, box.height, box.pad);
  const signature = values.join(",");
  const hasActivity = homePulseSparkHasActivity(values);

  return (
    <div
      className={clsx("home-pulse-spark", stage && "home-pulse-spark--stage", panel && "home-pulse-spark--panel", className)}
      data-home-pulse-intensity={intensity}
    >
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {t(lang, "homePulseWeekTrend")}
      </p>
      <div className={clsx("relative", stage && "min-h-0 flex-1")}>
        {stage ? <div className="home-pulse-spark__aura" aria-hidden /> : null}
        <svg
          key={signature}
          viewBox={`0 0 ${box.width} ${box.height}`}
          className={clsx("home-pulse-spark__svg w-full", stage ? "h-full min-h-[10rem]" : panel ? "h-24" : "h-14")}
          preserveAspectRatio="none"
          role="img"
          aria-label={t(lang, "homePulseWeekTrendAria")}
        >
          <defs>
            <linearGradient id={`home-pulse-fill-${gradId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(234, 88, 12)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="rgb(234, 88, 12)" stopOpacity="0.03" />
            </linearGradient>
          </defs>
          {area ? (
            <polygon
              className="home-pulse-spark__area"
              points={area}
              fill={`url(#home-pulse-fill-${gradId})`}
            />
          ) : null}
          {line ? (
            <polyline
              className="home-pulse-spark__line"
              points={line}
              fill="none"
              stroke="rgb(234, 88, 12)"
              strokeWidth={stage ? 3 : 2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </svg>
      </div>
      {stage ? (
        <ol className="mt-1 flex justify-between px-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
          {points.map((point) => (
            <li key={point.day}>{homePulseSparkDayLabel(point.day)}</li>
          ))}
        </ol>
      ) : null}
      {!hasActivity ? <p className="sr-only">{t(lang, "homePulseWeekEmpty")}</p> : null}
    </div>
  );
}

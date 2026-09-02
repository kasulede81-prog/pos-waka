import type { Language } from "../../types";
import type { HomeExecutiveKpi, HomeTileLiveStat } from "../../lib/homeExecutiveKpis";
import type { HomePulseSparkMode, HomePulseTrendPoint } from "../../lib/homePulseSpark";
import type { HomeHealthItem } from "../../hooks/useHomeBusinessHealthItems";
import { LivingBusinessPulse } from "./LivingBusinessPulse";

type Props = {
  lang: Language;
  sellStat?: HomeTileLiveStat;
  onSell?: () => void;
  heroActionLabelKey?: string;
  className?: string;
  surface?: "hero" | "command";
  kpis?: readonly HomeExecutiveKpi[];
  weekTrend?: readonly HomePulseTrendPoint[];
  sparkMode?: HomePulseSparkMode | null;
  healthItems?: readonly HomeHealthItem[];
  commandCenterTo?: string | null;
};

/**
 * Home hero adapter — Settings preview and live Home share LivingBusinessPulse.
 * NEW SALE remains a direct onClick with no animation wait.
 */
export function HomeBusinessHero(props: Props) {
  return <LivingBusinessPulse {...props} />;
}

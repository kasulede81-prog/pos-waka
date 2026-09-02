import { useMemo, type ReactNode } from "react";
import { ArrowRight, ShoppingCart } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useSessionActor } from "../../context/SessionActorContext";
import { enterpriseMotion } from "../../lib/enterpriseMotion";
import type { ResolvedHomeTile } from "../../lib/launcherTiles";
import type { HomeExecutiveKpi, HomeTileLiveStat } from "../../lib/homeExecutiveKpis";
import type { HomePulseSparkMode, HomePulseTrendPoint } from "../../lib/homePulseSpark";
import type { HomeHealthItem } from "../../hooks/useHomeBusinessHealthItems";
import {
  HOME_MOBILE_OPS_GRID,
  HOME_MOBILE_TYPE,
  HOME_MOBILE_WORKSPACE_GRID,
  homeGreetingKey,
} from "../../lib/homeMobileComposition";
import { HomeLiveValue } from "./HomeLiveValue";
import { MobileHomeStatusStrip } from "./MobileHomeStatusStrip";
import { MobileHomeLiveEngine } from "./MobileHomeLiveEngine";
import { MobileHomeAdminList } from "./MobileHomeAdminList";

type Props = {
  lang: Language;
  pharmacyMode: boolean;
  onSell?: () => void;
  sellStat?: HomeTileLiveStat;
  kpis: readonly HomeExecutiveKpi[];
  weekTrend: readonly HomePulseTrendPoint[];
  sparkMode: HomePulseSparkMode | null;
  healthItems: readonly HomeHealthItem[];
  commandCenterTo?: string | null;
  workspaceTiles: readonly ResolvedHomeTile[];
  operationsTiles: readonly ResolvedHomeTile[];
  adminTiles: readonly ResolvedHomeTile[];
  liveStats: Record<string, HomeTileLiveStat | undefined>;
  renderCard: (tile: ResolvedHomeTile, density: "comfortable" | "compact", weight: "primary" | "supporting", fill?: boolean) => ReactNode;
  onOpenAdmin: (to: string) => void;
};

/**
 * Mobile Living Business Cockpit — purpose-built phone Home.
 * Desktop command deck is a separate path and must not render here.
 */
export function MobileHomeCockpit({
  lang,
  pharmacyMode,
  onSell,
  sellStat,
  kpis,
  weekTrend,
  sparkMode,
  healthItems,
  workspaceTiles,
  operationsTiles,
  adminTiles,
  liveStats,
  renderCard,
  onOpenAdmin,
}: Props) {
  const actor = useSessionActor();
  const shopName = usePosStore((s) => s.preferences.shopDisplayName?.trim());
  const firstName = actor.displayName?.trim().split(/\s+/)[0];
  const greetingKey = useMemo(() => homeGreetingKey(new Date().getHours()), []);
  const salesKpi = kpis.find((kpi) => kpi.id === "sales");
  const txKpi = kpis.find((kpi) => kpi.id === "transactions");
  const cashKpi = kpis.find((kpi) => kpi.id === "cash");
  const ctaKey = pharmacyMode ? "builderHomeTapDispense" : "desktopHomeCtaNewSale";

  return (
    <div className="home-mobile-cockpit" role="navigation" aria-label={t(lang, "desktopHomeNavLabel")}>
      <section className="home-mobile-hero" aria-label={t(lang, "builderHomeHeroAria")}>
        {firstName ? (
          <h1 className={`${HOME_MOBILE_TYPE.greeting} text-foreground`}>
            {t(lang, greetingKey).replace("{name}", firstName)}
          </h1>
        ) : (
          <h1 className="sr-only">{t(lang, "desktopHomeTitle")}</h1>
        )}
        {shopName ? <p className={HOME_MOBILE_TYPE.shop}>{shopName}</p> : null}
        {salesKpi ? (
          <>
            <p className={`${HOME_MOBILE_TYPE.salesLabel} mt-3`}>{salesKpi.label}</p>
            <HomeLiveValue value={salesKpi.value} className={clsx("home-stat-value mt-0.5 block text-foreground", HOME_MOBILE_TYPE.salesValue)} />
          </>
        ) : sellStat ? (
          <>
            <p className={`${HOME_MOBILE_TYPE.salesLabel} mt-3`}>{sellStat.label}</p>
            <HomeLiveValue value={sellStat.value} className={clsx("home-stat-value mt-0.5 block text-foreground", HOME_MOBILE_TYPE.salesValue)} />
          </>
        ) : (
          <p className="mt-3 text-sm font-medium text-muted-foreground">{t(lang, "builderHomeHeroSub")}</p>
        )}
        {txKpi ? <p className="mt-1 text-sm font-semibold text-muted-foreground">{txKpi.value}</p> : null}
      </section>

      {onSell ? (
        <button
          type="button"
          onClick={onSell}
          className={clsx(
            "home-mobile-new-sale",
            enterpriseMotion.standard,
            enterpriseMotion.press,
            enterpriseMotion.focus,
          )}
        >
          <span className="home-mobile-new-sale__glow" aria-hidden />
          <ShoppingCart className="h-6 w-6 shrink-0" strokeWidth={2.4} aria-hidden />
          {t(lang, ctaKey)}
          <ArrowRight className="home-mobile-new-sale__arrow h-6 w-6 shrink-0" strokeWidth={2.4} aria-hidden />
        </button>
      ) : null}

      <MobileHomeStatusStrip lang={lang} items={healthItems} cashKpi={cashKpi} />

      {workspaceTiles.length > 0 ? (
        <section className="home-mobile-primary" aria-label={t(lang, "homeModulesPrimary")}>
          <h2 className={`${HOME_MOBILE_TYPE.section} mb-2`}>{t(lang, "homeModulesPrimary")}</h2>
          <div className={HOME_MOBILE_WORKSPACE_GRID}>
            {workspaceTiles.map((tile) => renderCard(tile, "comfortable", "primary", true))}
          </div>
        </section>
      ) : null}

      <MobileHomeLiveEngine
        lang={lang}
        weekTrend={weekTrend}
        sparkMode={sparkMode}
        sellStat={sellStat}
        intensity={liveStats.reports?.intensity ?? liveStats.sell?.intensity ?? "calm"}
      />

      {operationsTiles.length > 0 ? (
        <section className="home-mobile-operations" aria-label={t(lang, "homeModulesSecondary")}>
          <h2 className={`${HOME_MOBILE_TYPE.section} mb-2`}>{t(lang, "homeModulesSecondary")}</h2>
          <div className={HOME_MOBILE_OPS_GRID}>
            {operationsTiles.map((tile) => renderCard(tile, "compact", "supporting", true))}
          </div>
        </section>
      ) : null}

      <MobileHomeAdminList lang={lang} tiles={adminTiles} liveStats={liveStats} onOpen={onOpenAdmin} />
    </div>
  );
}

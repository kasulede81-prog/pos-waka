import clsx from "clsx";
import { ArrowRight, ShoppingCart } from "lucide-react";
import { HOME_TYPE_SCALE } from "../../lib/homeComposition";
import type { Language } from "../../types";
import { BusinessBuilderScene } from "../businessBuilder/BusinessBuilderScene";
import { useBusinessBuilder } from "../../context/BusinessBuilderContext";
import { useHomeBusinessSceneSync } from "../../hooks/useHomeBusinessSceneSync";
import { useHomeDashboardAnimationPause } from "../../hooks/useHomeDashboardAnimationPause";
import type { HomeExecutiveKpi, HomeTileLiveStat } from "../../lib/homeExecutiveKpis";
import type { HomePulseSparkMode, HomePulseTrendPoint } from "../../lib/homePulseSpark";
import { resolveHomeHeroPreviewBgColor } from "../../lib/shelfColor";
import { usePosStore } from "../../store/usePosStore";
import { t } from "../../lib/i18n";
import { enterpriseMotion } from "../../lib/enterpriseMotion";
import type { HomeHealthItem } from "../../hooks/useHomeBusinessHealthItems";
import { HomeLiveValue } from "./HomeLiveValue";
import { HomeLiveStatusRail } from "./HomeLiveStatusRail";
import { HomePulseSparkline } from "./HomePulseSparkline";

type Props = {
  lang: Language;
  sellStat?: HomeTileLiveStat;
  onSell?: () => void;
  heroActionLabelKey?: string;
  className?: string;
  /** command = desktop visual center; hero = compact phone / Settings preview. */
  surface?: "hero" | "command";
  kpis?: readonly HomeExecutiveKpi[];
  weekTrend?: readonly HomePulseTrendPoint[];
  sparkMode?: HomePulseSparkMode | null;
  healthItems?: readonly HomeHealthItem[];
  commandCenterTo?: string | null;
};

/**
 * Living Business Pulse — editorial desktop centerpiece from existing Home data.
 * NEW SALE stays a direct click (no animation gate, no decorative load).
 */
export function LivingBusinessPulse({
  lang,
  sellStat,
  onSell,
  heroActionLabelKey = "builderHomeTapSell",
  className,
  surface = "hero",
  kpis = [],
  weekTrend = [],
  sparkMode = null,
  healthItems = [],
  commandCenterTo = null,
}: Props) {
  useHomeBusinessSceneSync();
  const animPaused = useHomeDashboardAnimationPause();
  const { scene } = useBusinessBuilder();
  const previewBgColor = usePosStore((s) => resolveHomeHeroPreviewBgColor(s.preferences.homeHeroPreviewBgColor));
  const shopLabel = scene.shopName.trim() || t(lang, "builderDefaultShopName");
  const command = surface === "command";
  const salesKpi = kpis.find((kpi) => kpi.id === "sales");
  const supportingKpis = kpis.filter((kpi) => kpi.id !== "sales").slice(0, 4);
  const intensity = sellStat?.intensity ?? "calm";
  const showSpark = Boolean(sparkMode && weekTrend.length > 0);
  const commandCtaKey =
    command && heroActionLabelKey === "builderHomeTapSell" ? "desktopHomeCtaNewSale" : heroActionLabelKey;

  return (
    <section
      data-living-pulse={surface}
      data-home-pulse-intensity={intensity}
      className={clsx(
        "home-business-hero home-business-hero--pulse home-living-pulse overflow-hidden rounded-2xl border border-orange-200/70 shadow-sm",
        command ? "home-living-pulse--command home-living-pulse--console" : "mb-2.5 sm:mb-3",
        className,
      )}
      aria-label={t(lang, "builderHomeHeroAria")}
    >
      <div className="home-business-hero__ambient" aria-hidden />
      <div className="home-living-pulse__glow" aria-hidden />
      {salesKpi || sellStat ? (
        <span
          key={salesKpi?.value ?? sellStat?.value ?? "none"}
          className="home-living-pulse__sale-flash"
          aria-hidden
        />
      ) : null}
      {command ? (
        <div className="home-living-pulse__composition home-living-pulse__console relative z-[1]">
          <div
            className="home-living-pulse__atmosphere home-business-hero__preview"
            style={{ ["--home-shop-tint" as string]: previewBgColor }}
            aria-hidden
          >
            <BusinessBuilderScene className="home-living-pulse__atmosphere-scene" lang={lang} />
          </div>

          <div className="home-living-pulse__status">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {t(lang, "builderHomeHeroKicker")}
            </p>
            <h2 className="truncate text-sm font-semibold tracking-tight text-foreground sm:text-base">{shopLabel}</h2>
            {scene.isOpen ? (
              <span className="rounded-full bg-success px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
                {t(lang, "builderHomeOpen")}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
              <span
                className={clsx("builder-live-dot h-1.5 w-1.5 rounded-full bg-primary", animPaused && "!animate-none")}
                aria-hidden
              />
              {t(lang, "builderLivePreview")}
            </span>
          </div>

          <div className="home-living-pulse__lead">
            <div className="home-living-pulse__today min-w-0">
              {salesKpi ? (
                <>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{salesKpi.label}</p>
                  <HomeLiveValue
                    value={salesKpi.value}
                    className={clsx("home-stat-value mt-1 block text-foreground", HOME_TYPE_SCALE.metric)}
                  />
                </>
              ) : sellStat ? (
                <>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{sellStat.label}</p>
                  <HomeLiveValue
                    value={sellStat.value}
                    className={clsx("home-stat-value mt-1 block text-foreground", HOME_TYPE_SCALE.metric)}
                  />
                </>
              ) : (
                <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "builderHomeHeroSub")}</p>
              )}
              {sellStat && salesKpi ? (
                <p className="mt-2 text-sm font-semibold text-muted-foreground">
                  <HomeLiveValue value={sellStat.value} className="tabular-nums text-foreground" />
                </p>
              ) : null}
            </div>
            {supportingKpis.length > 0 ? (
              <ul className="home-living-pulse__kpis">
                {supportingKpis.map((kpi) => (
                  <li key={kpi.id} className="home-living-pulse__chip rounded-xl px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
                    <HomeLiveValue value={kpi.value} className="text-lg font-black tabular-nums text-foreground" />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {onSell ? (
            <button
              type="button"
              onClick={onSell}
              className={clsx(
                "home-new-sale-cta home-business-hero__cta",
                HOME_TYPE_SCALE.cta,
                enterpriseMotion.standard,
                enterpriseMotion.press,
                enterpriseMotion.focus,
              )}
            >
              <span className="home-new-sale-cta__glow" aria-hidden />
              <ShoppingCart className="home-new-sale-cta__mark h-6 w-6" strokeWidth={2.4} aria-hidden />
              {t(lang, commandCtaKey)}
              <ArrowRight className="home-new-sale-cta__arrow h-6 w-6" strokeWidth={2.4} aria-hidden />
            </button>
          ) : null}

          {healthItems.length > 0 ? (
            <div className="home-living-pulse__health">
              <HomeLiveStatusRail
                lang={lang}
                items={healthItems}
                commandCenterTo={commandCenterTo}
                orientation="rail"
              />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="relative z-[1] flex items-stretch gap-0">
          <div
            className="home-business-hero__preview relative hidden w-[96px] shrink-0 border-r border-border/70 sm:block sm:w-[120px]"
            style={{ backgroundColor: previewBgColor }}
            aria-hidden
          >
            <div className="flex h-full min-h-[88px] items-center justify-center px-1 py-2">
              <BusinessBuilderScene className="mx-auto max-h-[80px] scale-95" lang={lang} />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-2.5 p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(lang, "builderHomeHeroKicker")}
                </p>
                {scene.isOpen ? (
                  <span className="rounded-full bg-success px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
                    {t(lang, "builderHomeOpen")}
                  </span>
                ) : null}
              </div>
              <h2 className="mt-0.5 truncate text-lg font-bold tracking-tight text-foreground sm:text-xl">
                {shopLabel}
              </h2>
              {sellStat ? (
                <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                  {sellStat.label}:{" "}
                  <HomeLiveValue value={sellStat.value} className="home-stat-value tabular-nums text-foreground" />
                </p>
              ) : (
                <p className="mt-0.5 text-xs font-medium text-muted-foreground">{t(lang, "builderHomeHeroSub")}</p>
              )}
              {showSpark && sparkMode ? (
                <HomePulseSparkline className="mt-2 max-w-xs" lang={lang} points={weekTrend} mode={sparkMode} />
              ) : null}
            </div>
            {onSell ? (
              <button
                type="button"
                onClick={onSell}
                className={clsx(
                  "home-new-sale-cta home-new-sale-cta--compact home-business-hero__cta",
                  enterpriseMotion.standard,
                  enterpriseMotion.press,
                  enterpriseMotion.focus,
                )}
              >
                <span className="home-new-sale-cta__glow" aria-hidden />
                <ShoppingCart className="home-new-sale-cta__mark h-5 w-5" strokeWidth={2.4} aria-hidden />
                {t(lang, heroActionLabelKey)}
                <ArrowRight className="home-new-sale-cta__arrow h-5 w-5" strokeWidth={2.4} aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

import clsx from "clsx";
import { ArrowRight } from "lucide-react";
import type { Language } from "../../types";
import { BusinessBuilderScene } from "../businessBuilder/BusinessBuilderScene";
import { useBusinessBuilder } from "../../context/BusinessBuilderContext";
import { useHomeBusinessSceneSync } from "../../hooks/useHomeBusinessSceneSync";
import { useHomeDashboardAnimationPause } from "../../hooks/useHomeDashboardAnimationPause";
import type { HomeTileLiveStat } from "../../lib/homeExecutiveKpis";
import { resolveHomeHeroPreviewBgColor } from "../../lib/shelfColor";
import { usePosStore } from "../../store/usePosStore";
import { t } from "../../lib/i18n";
import { enterpriseMotion } from "../../lib/enterpriseMotion";

type Props = {
  lang: Language;
  sellStat?: HomeTileLiveStat;
  onSell?: () => void;
  heroActionLabelKey?: string;
  className?: string;
};

/**
 * Business Pulse — compact executive hero: context + status + primary NEW SALE action.
 * HOME CINEMATIC DENSITY V1 — layered depth + restrained ambient motion; KPIs own the scan below.
 */
export function HomeBusinessHero({
  lang,
  sellStat,
  onSell,
  heroActionLabelKey = "builderHomeTapSell",
  className,
}: Props) {
  useHomeBusinessSceneSync();
  const animPaused = useHomeDashboardAnimationPause();
  const { scene } = useBusinessBuilder();
  const previewBgColor = usePosStore((s) => resolveHomeHeroPreviewBgColor(s.preferences.homeHeroPreviewBgColor));
  const shopLabel = scene.shopName.trim() || t(lang, "builderDefaultShopName");

  return (
    <section
      className={clsx(
        "home-business-hero home-business-hero--pulse mb-2.5 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm sm:mb-3",
        className,
      )}
      aria-label={t(lang, "builderHomeHeroAria")}
    >
      <div className="home-business-hero__ambient" aria-hidden />
      <div className="relative z-[1] flex items-stretch gap-0">
        <div
          className="home-business-hero__preview relative hidden w-[96px] shrink-0 border-r border-border/70 sm:block sm:w-[120px] lg:w-[148px] xl:w-[168px]"
          style={{ backgroundColor: previewBgColor }}
          aria-hidden
        >
          <div className="flex h-full min-h-[88px] items-center justify-center px-1 py-2 lg:min-h-[104px]">
            <BusinessBuilderScene
              className="mx-auto max-h-[80px] scale-95 lg:max-h-[108px] lg:scale-100"
              lang={lang}
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2.5 p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-3.5 lg:px-5 lg:py-4">
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
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
                <span
                  className={clsx("builder-live-dot h-1.5 w-1.5 rounded-full bg-primary", animPaused && "!animate-none")}
                  aria-hidden
                />
                {t(lang, "builderLivePreview")}
              </span>
            </div>
            <h2 className="mt-0.5 truncate text-lg font-bold tracking-tight text-foreground sm:text-xl lg:text-[1.35rem]">
              {shopLabel}
            </h2>
            {sellStat ? (
              <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                {sellStat.label}:{" "}
                <span className="home-stat-value tabular-nums text-foreground">{sellStat.value}</span>
                {sellStat.trend ? <span className="ml-1 text-success">{sellStat.trend}</span> : null}
              </p>
            ) : (
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">{t(lang, "builderHomeHeroSub")}</p>
            )}
          </div>

          {onSell ? (
            <button
              type="button"
              onClick={onSell}
              className={clsx(
                "home-business-hero__cta inline-flex min-h-[48px] w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground sm:w-auto sm:min-w-[11rem] sm:text-base lg:min-h-[52px] lg:px-6",
                enterpriseMotion.standard,
                enterpriseMotion.focus,
                "shadow-[0_12px_28px_rgba(234,88,12,0.32)] hover:bg-primary-hover hover:shadow-[0_14px_32px_rgba(234,88,12,0.4)] active:scale-[0.99] motion-reduce:active:scale-100",
              )}
            >
              {t(lang, heroActionLabelKey)}
              <ArrowRight className="h-4 w-4" strokeWidth={2.25} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

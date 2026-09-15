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

type Props = {
  lang: Language;
  sellStat?: HomeTileLiveStat;
  onSell?: () => void;
  heroActionLabelKey?: string;
  className?: string;
};

/**
 * Phase 34.1 — compact executive hero: context + status + primary action.
 * Identity scene is secondary; KPIs/health own the scan path below.
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
        "home-business-hero mb-3 overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:mb-4",
        className,
      )}
      aria-label={t(lang, "builderHomeHeroAria")}
    >
      <div className="flex items-stretch gap-0">
        <div
          className="home-business-hero__preview relative hidden w-[88px] shrink-0 border-r border-border sm:block sm:w-[112px]"
          style={{ backgroundColor: previewBgColor }}
          aria-hidden
        >
          <div className="flex h-full items-center justify-center px-1 py-2">
            <BusinessBuilderScene className="mx-auto max-h-[72px] scale-90" lang={lang} />
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2.5 p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t(lang, "builderHomeHeroKicker")}
              </p>
              {scene.isOpen ? (
                <span className="rounded-full bg-success px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
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
            <h2 className="mt-0.5 truncate text-lg font-bold tracking-tight text-foreground sm:text-xl">{shopLabel}</h2>
            {sellStat ? (
              <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                {sellStat.label}: <span className="tabular-nums text-foreground">{sellStat.value}</span>
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
              className="inline-flex min-h-[48px] w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-waka hover:bg-primary-hover active:scale-[0.99] motion-reduce:active:scale-100 sm:w-auto sm:min-w-[10.5rem] sm:text-base"
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

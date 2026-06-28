import clsx from "clsx";
import { ArrowRight } from "lucide-react";
import type { Language } from "../../types";
import { BusinessBuilderScene } from "../businessBuilder/BusinessBuilderScene";
import { useBusinessBuilder } from "../../context/BusinessBuilderContext";
import { useHomeBusinessSceneSync } from "../../hooks/useHomeBusinessSceneSync";
import { useHomeDashboardAnimationPause } from "../../hooks/useHomeDashboardAnimationPause";
import type { HomeTileLiveStat } from "../../hooks/useHomeDashboardMetrics";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  sellStat?: HomeTileLiveStat;
  onSell?: () => void;
  className?: string;
};

/** Living dashboard hero — same shop the user built during registration. */
export function HomeBusinessHero({ lang, sellStat, onSell, className }: Props) {
  useHomeBusinessSceneSync();
  const animPaused = useHomeDashboardAnimationPause();
  const { scene } = useBusinessBuilder();
  const shopLabel = scene.shopName.trim() || t(lang, "builderDefaultShopName");

  return (
    <section
      className={clsx(
        "home-business-hero mb-4 overflow-hidden rounded-[28px] border border-white/70 bg-gradient-to-br from-orange-50/90 via-white to-sky-50/80 shadow-[0_20px_56px_-28px_rgba(234,88,12,0.45)] backdrop-blur-sm sm:mb-5 sm:rounded-[32px] lg:mb-6",
        className,
      )}
      aria-label={t(lang, "builderHomeHeroAria")}
    >
      <div className="flex flex-col lg:flex-row lg:items-stretch">
        <div
          className="home-business-hero__preview relative border-b border-orange-100/80 lg:w-[42%] lg:shrink-0 lg:border-b-0 lg:border-r"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3 lg:px-5 lg:pt-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-orange-700">
              <span
                className={clsx("builder-live-dot h-1.5 w-1.5 rounded-full bg-orange-500", animPaused && "!animate-none")}
                aria-hidden
              />
              {t(lang, "builderLivePreview")}
            </span>
            {scene.isOpen ? (
              <span className="rounded-full bg-emerald-500 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">
                {t(lang, "builderHomeOpen")}
              </span>
            ) : null}
          </div>
          <div className="px-3 pb-3 pt-1 lg:px-4 lg:pb-4">
            <BusinessBuilderScene className="mx-auto max-h-[min(38vh,260px)] lg:max-h-none" lang={lang} />
          </div>
        </div>

        <div className="flex flex-1 flex-col justify-between gap-4 p-4 sm:p-5 lg:p-6">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600/90">
              {t(lang, "builderHomeHeroKicker")}
            </p>
            <h2 className="mt-1 text-xl font-black tracking-tight text-stone-900 sm:text-2xl">{shopLabel}</h2>
            <p className="mt-1 text-sm font-medium text-stone-600">{t(lang, "builderHomeHeroSub")}</p>
          </div>

          {sellStat ? (
            <div className="rounded-2xl border border-orange-100 bg-white/80 px-4 py-3 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                {t(lang, sellStat.labelKey)}
              </p>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                <span className="text-lg font-black tabular-nums text-stone-900 sm:text-xl">{sellStat.value}</span>
                {sellStat.trend ? (
                  <span className="text-xs font-bold text-emerald-700">{sellStat.trend}</span>
                ) : null}
              </div>
            </div>
          ) : null}

          {onSell ? (
            <button
              type="button"
              onClick={onSell}
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[24px] bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3 text-sm font-black text-white shadow-[0_12px_32px_-10px_rgba(234,88,12,0.55)] transition active:scale-[0.99] sm:text-base lg:w-auto lg:self-start"
            >
              {t(lang, "builderHomeTapSell")}
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

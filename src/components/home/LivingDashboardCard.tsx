import type { CSSProperties } from "react";
import clsx from "clsx";
import type { Ref } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import type { ResolvedHomeTile } from "../../lib/launcherTiles";
import {
  launcherTileColorClasses,
  launcherTileSurfaceStyle,
} from "../../lib/launcherTiles";
import { homeDashboardTheme } from "../../config/homeDashboardTheme";
import type { HomeTileLiveStat } from "../../hooks/useHomeDashboardMetrics";
import { useHomeTileParallax } from "../../hooks/useHomeTileParallax";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { hapticTap } from "../../lib/nativeFeedback";
import { usePosStore } from "../../store/usePosStore";
import { HomeTileArt } from "./tiles/HomeTileArt";
import { HomeTileLottie } from "./HomeTileLottie";

type Props = {
  tile: ResolvedHomeTile;
  lang: Language;
  spotlight: boolean;
  liveStat?: HomeTileLiveStat;
  buttonRef?: Ref<HTMLButtonElement>;
  onClick?: () => void;
};

function tileAccentClass(tile: ResolvedHomeTile, layout: ReturnType<typeof homeDashboardTheme>["layout"]): string {
  if (layout === "featured") return "col-span-2 lg:col-span-4";
  if (layout === "heroSecondary" && tile.scale >= 45) return "col-span-2";
  return "";
}

export function LivingDashboardCard({
  tile,
  lang,
  spotlight,
  liveStat,
  buttonRef,
  onClick,
}: Props) {
  const theme = homeDashboardTheme(tile.id);
  const hapticsOn = usePosStore((s) => s.preferences.hapticsOn !== false);
  const isHero = theme.layout === "heroPrimary" || theme.layout === "heroSecondary";
  const isFeatured = theme.layout === "featured";
  const intensity = liveStat?.intensity ?? "calm";
  const parallax = useHomeTileParallax(spotlight && isHero);

  const customStyle = launcherTileSurfaceStyle(tile);
  const usesLauncherPalette = Boolean(customStyle) || tile.color !== "default";

  const glowStyle: CSSProperties | undefined = spotlight
    ? ({ "--home-tile-glow": theme.glow } as CSSProperties)
    : undefined;

  const combinedStyle: CSSProperties = {
    ...customStyle,
    ...glowStyle,
  };

  const handleClick = () => {
    if (hapticsOn) hapticTap();
    onClick?.();
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      data-launcher-key={tile.id}
      data-tile-intensity={intensity}
      onClick={handleClick}
      onPointerMove={parallax.onPointerMove}
      onPointerLeave={parallax.onPointerLeave}
      className={clsx(
        "home-living-card group relative touch-manipulation overflow-hidden rounded-[28px] border text-left transition-[transform,box-shadow,filter] duration-300 ease-out",
        "hover:-translate-y-0.5 hover:shadow-2xl active:scale-[0.985] motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-waka-500",
        usesLauncherPalette
          ? clsx(
              customStyle ? "border-2 border-white/30 text-white" : launcherTileColorClasses(tile.color, tile.pinned),
            )
          : clsx("border-white/20 text-white", theme.shadow, `bg-gradient-to-br ${theme.gradient}`),
        spotlight && "home-living-card--spotlight",
        tileAccentClass(tile, theme.layout),
        isHero && "home-living-card--hero flex min-h-[168px] flex-col sm:min-h-[188px] lg:min-h-[220px]",
        isFeatured && "home-living-card--featured flex min-h-[140px] flex-row items-stretch sm:min-h-[156px]",
        !isHero && !isFeatured && "home-living-card--scene flex min-h-[168px] flex-col sm:min-h-[176px]",
        tile.pinned && !usesLauncherPalette && "ring-2 ring-inset ring-white/40",
      )}
      style={combinedStyle}
    >
      {!usesLauncherPalette ? (
        <>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/20 via-card/5 to-transparent" aria-hidden />
          <div
            className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-40 blur-2xl"
            style={{ background: theme.glow }}
            aria-hidden
          />
        </>
      ) : null}

      {tile.badge !== undefined && tile.badge > 0 ? (
        <span className="absolute right-3 top-3 z-20 flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-rose-600 px-1.5 text-xs font-black text-white shadow-lg">
          {tile.badge > 99 ? "99+" : tile.badge}
        </span>
      ) : null}

      <div
        className={clsx(
          "relative flex flex-1",
          isHero && "flex-col lg:flex-row lg:items-stretch",
          isFeatured && "w-full flex-row items-center",
          !isHero && !isFeatured && "flex-col",
        )}
      >
        <div
          className={clsx(
            "home-living-card__scene relative flex shrink-0 items-center justify-center overflow-hidden transition-transform duration-300 will-change-transform",
            isHero && "min-h-[108px] flex-1 px-3 pt-4 lg:max-w-[48%] lg:pt-5",
            isFeatured && "w-[38%] max-w-[200px] shrink-0 sm:w-[34%]",
            !isHero && !isFeatured && "min-h-[96px] flex-1 px-2 pt-3",
          )}
          style={parallax.sceneStyle}
        >
          <HomeTileArt tileId={tile.id} intensity={intensity} className={clsx("relative z-[1]", theme.artClass)} />
          <HomeTileLottie
            tileId={theme.lottieId}
            active={spotlight}
            className="absolute inset-0 z-[2] h-full w-full opacity-90"
          />
        </div>

        <div
          className={clsx(
            "relative z-[1] flex flex-col justify-end",
            isHero && "gap-2 px-4 pb-4 pt-2 lg:justify-center lg:px-5 lg:pb-5 lg:pt-4",
            isFeatured && "flex-1 justify-center gap-2 px-4 py-4 pr-12",
            !isHero && !isFeatured && "gap-1.5 px-4 pb-4 pt-1",
          )}
        >
          <div>
            <span
              className={clsx(
                "block font-black uppercase tracking-wide",
                isHero ? "text-xl sm:text-2xl lg:text-3xl" : isFeatured ? "text-lg sm:text-xl" : "text-base sm:text-lg",
              )}
            >
              {t(lang, tile.labelKey)}
            </span>
            <span className="mt-0.5 line-clamp-2 text-xs font-medium leading-snug sm:text-sm opacity-80">
              {t(lang, theme.subtitleKey)}
            </span>
          </div>

          {liveStat ? (
            <div className="mt-1 rounded-2xl bg-black/15 px-3 py-2 backdrop-blur-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/65 sm:text-[11px]">
                {liveStat.label}
              </p>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0">
                <span className="text-sm font-black tabular-nums sm:text-base">{liveStat.value}</span>
                {liveStat.trend ? (
                  <span className="text-xs font-bold text-emerald-200">{liveStat.trend}</span>
                ) : null}
              </div>
            </div>
          ) : null}

          {theme.ctaKey ? (
            <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs font-black uppercase tracking-wide backdrop-blur-sm transition group-hover:bg-white/30 sm:text-sm">
              {t(lang, theme.ctaKey)}
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
            </span>
          ) : null}
        </div>
      </div>

      {isFeatured ? (
        <ChevronRight
          className="absolute right-4 top-1/2 z-10 h-7 w-7 -translate-y-1/2 opacity-80"
          strokeWidth={2.5}
          aria-hidden
        />
      ) : null}
    </button>
  );
}

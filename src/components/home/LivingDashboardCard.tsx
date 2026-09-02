import type { CSSProperties, PointerEvent, Ref } from "react";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import type { ResolvedHomeTile } from "../../lib/launcherTiles";
import { homeDashboardTheme } from "../../config/homeDashboardTheme";
import type { HomeTileLiveStat } from "../../lib/homeExecutiveKpis";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { hapticTap } from "../../lib/nativeFeedback";
import { usePosStore } from "../../store/usePosStore";
import { enterpriseMotion } from "../../lib/enterpriseMotion";
import { resolveHomeWorldSurface } from "../../lib/homeWorldSurface";
import { useHomeTileParallax } from "../../hooks/useHomeTileParallax";
import { HomeTileArt } from "./tiles/HomeTileArt";
import { HomeTileScene } from "./scenes/HomeTileScene";
import { HomeCashDrawerScene } from "./HomeCashDrawerScene";
import { HomeLiveValue } from "./HomeLiveValue";
import type { HomeDrawerKick } from "../../lib/homeLivingMotion";
import { homeDrawerPresentationState } from "../../lib/homeLivingMotion";
import { HOME_TYPE_SCALE } from "../../lib/homeComposition";

type Props = {
  tile: ResolvedHomeTile;
  lang: Language;
  spotlight: boolean;
  liveStat?: HomeTileLiveStat;
  buttonRef?: Ref<HTMLButtonElement>;
  onClick?: () => void;
  onPointerDown?: (e: PointerEvent<HTMLButtonElement>) => void;
  /** Phase 34.1 — calm enterprise cards by default; living = legacy gradient art. */
  appearance?: "enterprise" | "living";
  /** Slightly denser for admin band. */
  density?: "comfortable" | "compact";
  /** Supporting modules get quieter chrome than primary. */
  weight?: "primary" | "supporting";
  /** Fine-pointer parallax/spotlight — off when Home motion is paused. */
  pointerMotion?: boolean;
  /** Fill the assigned bento cell instead of a fixed min-height. */
  fill?: boolean;
  /** Real hardware kick from drawerAudit — presentation only. */
  drawerKick?: HomeDrawerKick | null;
  onDrawerKickSettled?: () => void;
};

/**
 * Home module card — HOME REMIX V6.
 * Colored miniature scene first; KPI text remains the authority.
 */
export function LivingDashboardCard({
  tile,
  lang,
  spotlight,
  liveStat,
  buttonRef,
  onClick,
  onPointerDown,
  appearance = "enterprise",
  density = "comfortable",
  weight = "primary",
  pointerMotion = true,
  fill = false,
  drawerKick = null,
  onDrawerKickSettled,
}: Props) {
  const theme = homeDashboardTheme(tile.id);
  const hapticsOn = usePosStore((s) => s.preferences.hapticsOn !== false);
  const pointer = useHomeTileParallax(pointerMotion && appearance === "enterprise");

  const handleClick = () => {
    if (hapticsOn) hapticTap();
    onClick?.();
  };

  if (appearance === "enterprise") {
    const world = resolveHomeWorldSurface(tile.id);
    const cash = tile.id === "cash";
    const drawerState = homeDrawerPresentationState(cash ? drawerKick : null, !pointerMotion);
    const staged = weight === "primary" || cash;
    const showArt = !cash;
    return (
      <button
        ref={buttonRef}
        type="button"
        data-launcher-key={tile.id}
        data-tile-intensity={liveStat?.intensity ?? "calm"}
        data-home-spotlight={spotlight ? "true" : undefined}
        data-home-drawer={cash ? drawerState : undefined}
        data-home-world={world.id}
        data-home-zone={world.zone}
        onClick={handleClick}
        onPointerDown={onPointerDown}
        onPointerMove={pointer.onPointerMove}
        onPointerLeave={pointer.onPointerLeave}
        style={pointer.cardStyle}
        className={clsx(
          "home-module-card home-module-card--living home-module-card--world group relative flex w-full touch-manipulation flex-col overflow-hidden rounded-2xl border text-left",
          world.ink === "light" && "home-module-card--ink-light",
          enterpriseMotion.standard,
          enterpriseMotion.cardInteractive,
          enterpriseMotion.hoverLift,
          enterpriseMotion.focus,
          fill && "h-full min-h-0",
          density === "compact"
            ? "min-h-[76px] p-2.5 sm:p-3"
            : fill
              ? "p-3 sm:p-3.5"
              : staged
                ? "min-h-[132px] p-3 sm:min-h-[140px] sm:p-3.5"
                : "min-h-[104px] p-3 sm:min-h-[108px] sm:p-3.5",
          weight === "supporting" && "home-module-card--supporting",
          spotlight && "home-module-card--spotlight",
          liveStat?.intensity === "alert" && tile.id === "inventory" && "home-module-card--stock-attention",
        )}
      >
        <span className="home-module-card__spot" aria-hidden />
        <span className="home-module-card__atmosphere" aria-hidden />
        {showArt ? (
          <div
            className={clsx(
              "home-module-card__art pointer-events-none absolute inset-y-0 right-0 w-[46%]",
              spotlight ? "opacity-[0.16]" : "opacity-[0.08]",
            )}
            aria-hidden
          >
            <HomeTileArt tileId={tile.id} intensity={liveStat?.intensity} className="h-full w-full" />
          </div>
        ) : null}
        {tile.badge !== undefined && tile.badge > 0 ? (
          <span className="absolute right-2.5 top-2.5 z-10 flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-black text-white">
            {tile.badge > 99 ? "99+" : tile.badge}
          </span>
        ) : null}

        <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
          <div
            className={clsx("home-tile-icon", staged ? "mb-2 w-full" : "mb-1.5")}
            style={pointer.sceneStyle}
          >
            {cash ? (
              <HomeCashDrawerScene
                state={drawerState}
                intensity={liveStat?.intensity}
                className={
                  staged
                    ? "h-[4.75rem] w-full sm:h-[5.25rem]"
                    : "h-12 w-[4.5rem] sm:h-[3.25rem] sm:w-[4.75rem]"
                }
                onOpenSettled={onDrawerKickSettled}
              />
            ) : staged ? (
              <HomeTileScene
                tileId={tile.id}
                intensity={liveStat?.intensity}
                density="stage"
                drawerState={drawerState}
                onDrawerKickSettled={onDrawerKickSettled}
              />
            ) : (
              <HomeTileScene
                tileId={tile.id}
                intensity={liveStat?.intensity}
                density="inline"
                drawerState={drawerState}
              />
            )}
          </div>

          <div className="min-w-0 pr-5">
            <span className={clsx("home-world-title block leading-snug", HOME_TYPE_SCALE.tileTitle)}>{t(lang, tile.labelKey)}</span>
            <span className="home-world-sub mt-0.5 line-clamp-2 text-[11px] font-medium leading-snug sm:text-xs">
              {t(lang, theme.subtitleKey)}
            </span>
          </div>
          <ChevronRight className="home-world-chevron absolute right-3 top-[calc(50%+0.5rem)] h-4 w-4 -translate-y-1/2 opacity-60 transition-opacity group-hover:opacity-100" aria-hidden />

          {liveStat ? (
            <div className="home-world-stat mt-auto border-t pt-2">
              <p className="living-dashboard-card__stat-label home-world-sub text-[10px] font-bold uppercase tracking-wide">
                {liveStat.label}
              </p>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                <HomeLiveValue
                  value={liveStat.value}
                  className="living-dashboard-card__stat-value home-stat-value home-world-title text-sm font-black tabular-nums"
                />
                {liveStat.trend ? <span className="home-world-trend text-xs font-bold">{liveStat.trend}</span> : null}
              </div>
            </div>
          ) : null}
        </div>
      </button>
    );
  }

  const glowStyle: CSSProperties | undefined = spotlight
    ? ({ "--home-tile-glow": theme.glow } as CSSProperties)
    : undefined;

  return (
    <button
      ref={buttonRef}
      type="button"
      data-launcher-key={tile.id}
      data-tile-intensity={liveStat?.intensity ?? "calm"}
      onClick={handleClick}
      className={clsx(
        "home-living-card group relative flex min-h-[140px] touch-manipulation flex-col overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-br text-left text-white shadow-md",
        theme.gradient,
        theme.shadow,
        spotlight && "home-living-card--spotlight",
      )}
      style={glowStyle}
    >
      <div className="relative z-[1] flex flex-1 flex-col justify-end gap-1.5 px-4 pb-4 pt-3">
        <span className="block text-base font-black uppercase tracking-wide">{t(lang, tile.labelKey)}</span>
        <span className="line-clamp-2 text-xs font-medium opacity-80">{t(lang, theme.subtitleKey)}</span>
        {liveStat ? (
          <div className="mt-1 rounded-xl bg-black/15 px-2.5 py-1.5">
            <p className="living-dashboard-card__stat-label text-[10px] font-bold uppercase text-white/65">{liveStat.label}</p>
            <HomeLiveValue value={liveStat.value} className="living-dashboard-card__stat-value text-sm font-black tabular-nums" />
          </div>
        ) : null}
      </div>
    </button>
  );
}

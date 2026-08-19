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
import { enterpriseIconClass, ENTERPRISE_ICON_STROKE } from "../../lib/enterpriseIcons";
import { enterpriseMotion } from "../../lib/enterpriseMotion";
import { resolveHomeTileAccent } from "../../lib/homeTileAccent";
import { HomeTileAccentWell } from "./HomeTileAccentWell";

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
};

/**
 * Home module card — Phase 34.1 defaults to calm enterprise surfaces
 * so operational KPIs/health own visual priority.
 */
export function LivingDashboardCard({
  tile,
  lang,
  spotlight: _spotlight,
  liveStat,
  buttonRef,
  onClick,
  onPointerDown,
  appearance = "enterprise",
  density = "comfortable",
}: Props) {
  const theme = homeDashboardTheme(tile.id);
  const hapticsOn = usePosStore((s) => s.preferences.hapticsOn !== false);
  const Icon = tile.Icon;

  const handleClick = () => {
    if (hapticsOn) hapticTap();
    onClick?.();
  };

  if (appearance === "enterprise") {
    const accent = resolveHomeTileAccent(tile);
    return (
      <button
        ref={buttonRef}
        type="button"
        data-launcher-key={tile.id}
        data-tile-intensity={liveStat?.intensity ?? "calm"}
        onClick={handleClick}
        onPointerDown={onPointerDown}
        className={clsx(
          "group relative flex w-full touch-manipulation flex-col overflow-hidden rounded-2xl border border-border bg-card text-left shadow-sm",
          enterpriseMotion.standard,
          enterpriseMotion.cardInteractive,
          enterpriseMotion.focus,
          density === "compact" ? "min-h-[96px] p-3" : "min-h-[112px] p-3.5 sm:p-4",
        )}
      >
        <span
          className="pointer-events-none absolute inset-y-0 left-0 w-1"
          style={accent.railStyle}
          aria-hidden
        />
        {tile.badge !== undefined && tile.badge > 0 ? (
          <span className="absolute right-2.5 top-2.5 z-10 flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-black text-white">
            {tile.badge > 99 ? "99+" : tile.badge}
          </span>
        ) : null}

        <div className="flex items-start gap-2.5 pl-1">
          <HomeTileAccentWell accent={accent}>
            <Icon className={clsx(enterpriseIconClass("md"), "text-current")} strokeWidth={ENTERPRISE_ICON_STROKE} aria-hidden />
          </HomeTileAccentWell>
          <div className="min-w-0 flex-1 pr-4">
            <span className="block truncate text-sm font-black text-foreground sm:text-base">{t(lang, tile.labelKey)}</span>
            <span className="mt-0.5 line-clamp-2 text-[11px] font-medium leading-snug text-muted-foreground sm:text-xs">
              {t(lang, theme.subtitleKey)}
            </span>
          </div>
          <ChevronRight className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground opacity-70" aria-hidden />
        </div>

        {liveStat ? (
          <div className="mt-auto border-t border-border/70 pt-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{liveStat.label}</p>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-black tabular-nums text-foreground">{liveStat.value}</span>
              {liveStat.trend ? <span className="text-xs font-bold text-success">{liveStat.trend}</span> : null}
            </div>
          </div>
        ) : null}
      </button>
    );
  }

  // Legacy living appearance (kept for arrange previews / optional use).
  const glowStyle: CSSProperties | undefined = _spotlight
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
        _spotlight && "home-living-card--spotlight",
      )}
      style={glowStyle}
    >
      <div className="relative z-[1] flex flex-1 flex-col justify-end gap-1.5 px-4 pb-4 pt-3">
        <span className="block text-base font-black uppercase tracking-wide">{t(lang, tile.labelKey)}</span>
        <span className="line-clamp-2 text-xs font-medium opacity-80">{t(lang, theme.subtitleKey)}</span>
        {liveStat ? (
          <div className="mt-1 rounded-xl bg-black/15 px-2.5 py-1.5">
            <p className="text-[10px] font-bold uppercase text-white/65">{liveStat.label}</p>
            <span className="text-sm font-black tabular-nums">{liveStat.value}</span>
          </div>
        ) : null}
      </div>
    </button>
  );
}

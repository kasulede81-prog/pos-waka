import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { ResolvedHomeTile } from "../../lib/launcherTiles";
import type { HomeTileLiveStat } from "../../lib/homeExecutiveKpis";
import { resolveHomeWorldSurface } from "../../lib/homeWorldSurface";
import { HomeTileScene } from "./scenes/HomeTileScene";
import { HomeLiveValue } from "./HomeLiveValue";
import { HOME_MOBILE_TYPE } from "../../lib/homeMobileComposition";

type Props = {
  lang: Language;
  tiles: readonly ResolvedHomeTile[];
  liveStats: Record<string, HomeTileLiveStat | undefined>;
  onOpen: (to: string) => void;
};

/** Compact system-control list — not another 2×2 card grid. */
export function MobileHomeAdminList({ lang, tiles, liveStats, onOpen }: Props) {
  if (tiles.length === 0) return null;

  return (
    <section className="home-mobile-admin" aria-label={t(lang, "homeModulesAdmin")}>
      <h2 className={`${HOME_MOBILE_TYPE.section} mb-2`}>{t(lang, "homeModulesAdmin")}</h2>
      <ul className="home-mobile-admin__list">
        {tiles.map((tile) => {
          const world = resolveHomeWorldSurface(tile.id);
          const stat = liveStats[tile.id];
          return (
            <li key={tile.id}>
              <button
                type="button"
                data-launcher-key={tile.id}
                data-home-world={world.id}
                onClick={() => onOpen(tile.to)}
                className="home-mobile-admin__row min-h-12"
              >
                <span className="home-mobile-admin__icon" aria-hidden>
                  <HomeTileScene tileId={tile.id} intensity={stat?.intensity} density="inline" />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-bold">{t(lang, tile.labelKey)}</span>
                  {stat ? (
                    <HomeLiveValue value={stat.value} className="block truncate text-xs font-semibold tabular-nums opacity-80" />
                  ) : null}
                </span>
                {tile.badge !== undefined && tile.badge > 0 ? (
                  <span className={clsx("rounded-full bg-danger px-1.5 text-[10px] font-black text-white")}>
                    {tile.badge > 99 ? "99+" : tile.badge}
                  </span>
                ) : null}
                <ChevronRight className="h-4 w-4 shrink-0 opacity-55" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

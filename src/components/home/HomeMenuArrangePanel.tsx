import { useCallback, useMemo, useState } from "react";
import clsx from "clsx";
import type { Language, LauncherTileColor, LauncherTileConfig } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useShelfDragReorder } from "../../hooks/useShelfDragReorder";
import {
  LAUNCHER_TILE_CATALOG,
  launcherMasonryGridClass,
  launcherScaleFromConfig,
  resolveHomeMenuTiles,
  updateLauncherTileLayout,
} from "../../lib/launcherTiles";
import { PRESET_SHELF_HEX, resolveShelfHex } from "../../lib/shelfColor";
import { useSessionActor } from "../../context/SessionActorContext";
import { hasPermission } from "../../lib/permissions";
import { HomeLauncherTile } from "./HomeLauncherTile";
import { ShelfColorWheel } from "../pos/ShelfColorWheel";
import { ShelfScaleSlider } from "../pos/ShelfScaleSlider";

const COLORS: LauncherTileColor[] = ["default", "red", "orange", "blue", "green", "purple"];
const EMPTY_ORDER: string[] = [];
const EMPTY_LAYOUT: Record<string, LauncherTileConfig> = {};

type Props = {
  lang: Language;
  embedded?: boolean;
};

export function HomeMenuArrangePanel({ lang, embedded = false }: Props) {
  const actor = useSessionActor();
  const savedOrderRaw = usePosStore((s) => s.preferences.launcherTileOrder);
  const layoutRaw = usePosStore((s) => s.preferences.launcherTileLayout);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const savedOrder = savedOrderRaw ?? EMPTY_ORDER;
  const layout = layoutRaw ?? EMPTY_LAYOUT;

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const can = useCallback((perm?: Parameters<typeof hasPermission>[1]) => !perm || hasPermission(actor.role, perm), [actor.role]);

  const { hero, secondary } = useMemo(
    () =>
      resolveHomeMenuTiles({
        savedOrder,
        layout,
        hasPermission: can,
        includeHidden: true,
      }),
    [savedOrder, layout, can],
  );

  const orderKeys = useMemo(() => secondary.map((t) => t.id), [secondary]);

  const onReorder = useCallback(
    (next: string[]) => {
      setPreferences({ launcherTileOrder: next });
    },
    [setPreferences],
  );

  const { dragKey, overKey, startDrag, shouldIgnoreClick } = useShelfDragReorder(
    orderKeys,
    onReorder,
    "data-launcher-key",
  );

  const selectedTile = selectedId ? secondary.find((t) => t.id === selectedId) : null;
  const selectedConfig = selectedId ? layout[selectedId] : null;
  const selectedScale = launcherScaleFromConfig(selectedConfig ?? undefined);
  const selectedPreviewHex = selectedConfig
    ? resolveShelfHex(selectedConfig.customColor, selectedConfig.color ?? selectedTile?.color ?? "default")
    : PRESET_SHELF_HEX.default;

  const patchSelected = useCallback(
    (patch: Partial<LauncherTileConfig>) => {
      if (!selectedId) return;
      setPreferences({ launcherTileLayout: updateLauncherTileLayout(layout, selectedId, patch) });
    },
    [selectedId, setPreferences, layout],
  );

  const selectTile = useCallback(
    (id: string) => {
      if (shouldIgnoreClick()) return;
      setSelectedId((current) => (current === id ? null : id));
    },
    [shouldIgnoreClick],
  );

  const selectedDef = selectedId ? LAUNCHER_TILE_CATALOG.find((t) => t.id === selectedId) : null;

  const content = (
    <div className="space-y-4">
      <p className="text-sm font-medium text-stone-600">{t(lang, "homeMenuArrangeSub")}</p>

      {hero ? (
        <section className="space-y-2">
          <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "homeMenuSellLocked")}</p>
          <HomeLauncherTile tile={hero} lang={lang} mode="arrange" variant="sell" />
        </section>
      ) : null}

      <div className={launcherMasonryGridClass()}>
        {secondary.map((tile) => (
          <HomeLauncherTile
            key={tile.id}
            tile={tile}
            lang={lang}
            mode="arrange"
            variant="secondary"
            selected={selectedId === tile.id}
            dragging={dragKey === tile.id}
            dragOver={overKey === tile.id && dragKey !== tile.id}
            onClick={() => selectTile(tile.id)}
            onDragPointerDown={(e) => startDrag(tile.id, e)}
          />
        ))}
      </div>

      {selectedId && selectedTile && selectedDef?.hideable ? (
        <section className="space-y-3 rounded-2xl border-2 border-waka-200 bg-white p-4">
          <p className="text-sm font-black text-stone-950">
            {t(lang, "homeMenuEditHeading")}: {t(lang, selectedTile.labelKey)}
          </p>

          <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm font-bold text-stone-800">
            <input
              type="checkbox"
              checked={!selectedTile.hidden}
              onChange={(e) => patchSelected({ hidden: !e.target.checked })}
              className="h-5 w-5 rounded border-2 border-stone-300 accent-waka-600"
            />
            {selectedTile.hidden ? t(lang, "homeMenuShowTile") : t(lang, "homeMenuHideTile")}
          </label>

          <div>
            <p className="text-xs font-bold text-stone-600">{t(lang, "homeMenuColorLabel")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => patchSelected({ color, customColor: null })}
                  className={clsx(
                    "h-9 min-w-[3rem] rounded-xl border-2 px-2 text-xs font-black capitalize",
                    (selectedConfig?.color ?? "default") === color && !selectedConfig?.customColor
                      ? "border-waka-600 ring-2 ring-waka-200"
                      : "border-stone-200",
                  )}
                  style={{ backgroundColor: PRESET_SHELF_HEX[color] }}
                >
                  {color === "default" ? "—" : ""}
                </button>
              ))}
            </div>
            <ShelfColorWheel
              className="mt-3"
              value={selectedPreviewHex}
              onChange={(hex) => {
                if (hex) patchSelected({ customColor: hex });
                else patchSelected({ customColor: undefined, color: "default" });
              }}
            />
          </div>

          <ShelfScaleSlider
            value={selectedScale}
            previewHex={selectedPreviewHex}
            onChange={(scale) => patchSelected({ scale })}
            lang={lang}
          />
        </section>
      ) : null}
    </div>
  );

  if (embedded) return content;

  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-950">{t(lang, "homeMenuArrangeTitle")}</p>
      <div className="mt-4">{content}</div>
    </article>
  );
}

import { useCallback, useMemo, useState } from "react";
import { actorHasEffectivePermission } from "../../lib/actorAuthorization";
import clsx from "clsx";
import type { Language, LauncherTileColor, LauncherTileConfig } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useShelfDragReorder } from "../../hooks/useShelfDragReorder";
import {
  launcherCatalogForMode,
  launcherMasonryGridClass,
  launcherScaleFromConfig,
  resolveHomeMenuTiles,
  updateLauncherTileLayout,
} from "../../lib/launcherTiles";
import { isPharmacyMode } from "../../lib/pharmacy";
import { PRESET_SHELF_HEX, resolveShelfHex, HOME_HERO_PREVIEW_BG_PRESETS, resolveHomeHeroPreviewBgColor } from "../../lib/shelfColor";
import { useSessionActor } from "../../context/SessionActorContext";
import { useSubscription } from "../../context/SubscriptionContext";
import { WakaSwitch } from "../enterprise/WakaSwitch";

import type { Permission } from "../../types";
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
  const { snapshot, authMode } = useSubscription();
  const preferences = usePosStore((s) => s.preferences);
  const savedOrderRaw = usePosStore((s) => s.preferences.launcherTileOrder);
  const layoutRaw = usePosStore((s) => s.preferences.launcherTileLayout);
  const previewBgStored = usePosStore((s) => s.preferences.homeHeroPreviewBgColor);
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const savedOrder = savedOrderRaw ?? EMPTY_ORDER;
  const layout = layoutRaw ?? EMPTY_LAYOUT;

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const can = useCallback(
    (perm?: Permission) =>
      !perm || actorHasEffectivePermission(actor, perm, snapshot, authMode),
    [actor.role, snapshot, authMode],
  );

  const { hero, secondary } = useMemo(
    () =>
      resolveHomeMenuTiles({
        savedOrder,
        layout,
        hasPermission: can,
        includeHidden: true,
        pharmacyMode,
      }),
    [savedOrder, layout, can, pharmacyMode],
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

  const selectedDef = selectedId
    ? launcherCatalogForMode(pharmacyMode).find((t) => t.id === selectedId)
    : null;
  const previewBgHex = resolveHomeHeroPreviewBgColor(previewBgStored);

  const content = (
    <div className="space-y-4">
      <p className="text-sm font-medium text-stone-600">{t(lang, "homeMenuArrangeSub")}</p>

      <section className="space-y-3 rounded-2xl border-2 border-stone-200 bg-white p-4">
        <div>
          <p className="text-sm font-black text-stone-950">{t(lang, "homeMenuPreviewBgTitle")}</p>
          <p className="mt-0.5 text-xs font-medium text-stone-500">{t(lang, "homeMenuPreviewBgSub")}</p>
        </div>
        <div>
          <p className="text-xs font-bold text-stone-600">{t(lang, "homeMenuColorLabel")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {HOME_HERO_PREVIEW_BG_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setPreferences({ homeHeroPreviewBgColor: preset.hex })}
                className={clsx(
                  "h-9 min-w-[3rem] rounded-xl border-2 px-2 text-xs font-black capitalize",
                  previewBgHex === preset.hex ? "border-waka-600 ring-2 ring-waka-200" : "border-stone-200",
                )}
                style={{ backgroundColor: preset.hex }}
                aria-label={preset.id}
              />
            ))}
          </div>
          <ShelfColorWheel
            className="mt-3"
            value={previewBgHex}
            onChange={(hex) => setPreferences({ homeHeroPreviewBgColor: hex ?? null })}
          />
        </div>
      </section>

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

          <WakaSwitch
            checked={!selectedTile.hidden}
            onCheckedChange={(checked) => patchSelected({ hidden: !checked })}
            label={selectedTile.hidden ? t(lang, "homeMenuShowTile") : t(lang, "homeMenuHideTile")}
            className="text-sm font-bold text-stone-800"
          />

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

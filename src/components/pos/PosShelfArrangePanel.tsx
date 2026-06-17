import { useCallback, useMemo, useState } from "react";
import clsx from "clsx";
import type { Language, PosShelfColor, PosShelfLayoutConfig, PosShelfPresetId, PosShelfSize, Product } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useShelfDragReorder } from "../../hooks/useShelfDragReorder";
import {
  SHELF_ICON_OPTIONS,
  buildPosShelfDisplayCards,
  buildQuickSellShelfCard,
  effectiveShelfOrderKeys,
  QUICK_SELL_SHELF_KEY,
  updateShelfLayoutEntry,
} from "../../lib/posShelfLayout";
import { POS_SHELF_PRESET_IDS, applyShelfPreset } from "../../lib/posShelfPresets";
import { PosShelfTile } from "./PosShelfTile";

const PRESET_LABEL_KEY: Record<
  PosShelfPresetId,
  | "posShelfPreset_retail"
  | "posShelfPreset_supermarket"
  | "posShelfPreset_pharmacy"
  | "posShelfPreset_restaurant"
  | "posShelfPreset_bar"
  | "posShelfPreset_hardware"
  | "posShelfPreset_boutique"
> = {
  retail: "posShelfPreset_retail",
  supermarket: "posShelfPreset_supermarket",
  pharmacy: "posShelfPreset_pharmacy",
  restaurant: "posShelfPreset_restaurant",
  bar: "posShelfPreset_bar",
  hardware: "posShelfPreset_hardware",
  boutique: "posShelfPreset_boutique",
};

type Props = {
  lang: Language;
  products: Product[];
  /** When true, omit outer article chrome (embedded in settings page). */
  embedded?: boolean;
};

const COLORS: PosShelfColor[] = ["default", "red", "orange", "blue", "green", "purple"];
const SIZES: PosShelfSize[] = ["small", "medium", "large"];
const EMPTY_SHELF_ORDER: string[] = [];
const EMPTY_SHELF_LAYOUT: Record<string, PosShelfLayoutConfig> = {};

export function PosShelfArrangePanel({ lang, products, embedded = false }: Props) {
  const savedOrderRaw = usePosStore((s) => s.preferences.posPinnedShelfKeys);
  const shelfLayoutRaw = usePosStore((s) => s.preferences.posShelfLayout);
  const quickSellIdsRaw = usePosStore((s) => s.preferences.posQuickSellProductIds);
  const savedOrder = savedOrderRaw ?? EMPTY_SHELF_ORDER;
  const shelfLayout = shelfLayoutRaw ?? EMPTY_SHELF_LAYOUT;
  const quickSellIds = quickSellIdsRaw ?? EMPTY_SHELF_ORDER;
  const setPreferences = usePosStore((s) => s.setPreferences);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [quickPickerOpen, setQuickPickerOpen] = useState(false);

  const shelfCards = useMemo(() => {
    const cards = buildPosShelfDisplayCards(products, t(lang, "posNoShelf"), shelfLayout, savedOrder);
    const quick = buildQuickSellShelfCard(
      quickSellIds,
      products,
      t(lang, "posQuickSellShelf"),
      shelfLayout[QUICK_SELL_SHELF_KEY],
    );
    return quick ? [quick, ...cards] : cards;
  }, [products, lang, shelfLayout, savedOrder, quickSellIds]);

  const orderKeys = useMemo(() => {
    const keys = shelfCards.map((c) => c.key);
    return effectiveShelfOrderKeys(keys, savedOrder);
  }, [shelfCards, savedOrder]);

  const onReorder = useCallback(
    (next: string[]) => {
      setPreferences({ posPinnedShelfKeys: next.filter((k) => k !== QUICK_SELL_SHELF_KEY) });
    },
    [setPreferences],
  );

  const { dragKey, overKey, startDrag, shouldIgnoreClick } = useShelfDragReorder(orderKeys, onReorder);

  const selectedConfig = selectedKey ? (shelfLayout[selectedKey] ?? {}) : null;
  const isQuickSellSelected = selectedKey === QUICK_SELL_SHELF_KEY;

  const patchSelected = useCallback(
    (patch: Partial<PosShelfLayoutConfig>) => {
      if (!selectedKey) return;
      setPreferences({ posShelfLayout: updateShelfLayoutEntry(shelfLayout, selectedKey, patch) });
    },
    [selectedKey, setPreferences, shelfLayout],
  );

  const applyPreset = useCallback(
    (presetId: PosShelfPresetId) => {
      const result = applyShelfPreset(presetId, products);
      setPreferences({
        posShelfPresetId: presetId,
        posPinnedShelfKeys: result.orderKeys.filter((k) => k !== QUICK_SELL_SHELF_KEY),
        posShelfLayout: result.layout,
        posQuickSellProductIds: result.quickSellProductIds,
      });
      setSelectedKey(null);
    },
    [products, setPreferences],
  );

  const toggleQuickProduct = useCallback(
    (productId: string) => {
      const has = quickSellIds.includes(productId);
      const next = has ? quickSellIds.filter((id) => id !== productId) : [...quickSellIds, productId].slice(0, 24);
      setPreferences({ posQuickSellProductIds: next });
    },
    [quickSellIds, setPreferences],
  );

  const selectShelf = useCallback(
    (key: string) => {
      if (shouldIgnoreClick()) return;
      setSelectedKey((k) => (k === key ? null : key));
    },
    [shouldIgnoreClick],
  );

  if (shelfCards.length === 0) {
    return (
      <p className="rounded-2xl bg-amber-50 px-4 py-6 text-center text-sm font-semibold text-amber-950">
        {t(lang, "posEmptySub")}
      </p>
    );
  }

  const content = (
    <div className="space-y-4">
      <section className="rounded-2xl border border-stone-200 bg-white p-3">
        <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "posShelfPresetHeading")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {POS_SHELF_PRESET_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => applyPreset(id)}
              className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-bold text-stone-800 active:bg-waka-50"
            >
              {t(lang, PRESET_LABEL_KEY[id])}
            </button>
          ))}
        </div>
      </section>

      <p className="text-sm font-medium text-stone-600">{t(lang, "stockShelfArrangeSub")}</p>

      <div className="grid grid-flow-dense grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {shelfCards.map((shelf) => (
          <PosShelfTile
            key={shelf.key}
            shelf={shelf}
            lang={lang}
            mode="arrange"
            selected={selectedKey === shelf.key}
            dragging={dragKey === shelf.key}
            dragOver={overKey === shelf.key && dragKey !== shelf.key}
            countLabel={
              shelf.isQuickSell
                ? t(lang, "posQuickSellCount").replace("{{count}}", String(shelf.count))
                : t(lang, "posShelfProductCount").replace("{{count}}", String(shelf.count))
            }
            onClick={() => selectShelf(shelf.key)}
            onDragPointerDown={(e) => startDrag(shelf.key, e)}
          />
        ))}
      </div>

      {selectedKey && selectedConfig ? (
        <section className="space-y-3 rounded-2xl border-2 border-waka-200 bg-white p-4">
          <p className="text-sm font-black text-stone-950">{t(lang, "posShelfEditHeading")}</p>

          <label className="block space-y-1">
            <span className="text-xs font-bold text-stone-600">{t(lang, "posShelfEditName")}</span>
            <input
              type="text"
              value={selectedConfig.displayName ?? ""}
              placeholder={shelfCards.find((c) => c.key === selectedKey)?.label ?? ""}
              onChange={(e) => patchSelected({ displayName: e.target.value })}
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm font-semibold"
            />
          </label>

          <div>
            <p className="text-xs font-bold text-stone-600">{t(lang, "posShelfEditColor")}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-pressed={selectedConfig.color === color || (!selectedConfig.color && color === "default")}
                  onClick={() => patchSelected({ color })}
                  className={clsx(
                    "rounded-full border px-3 py-1 text-xs font-black capitalize",
                    selectedConfig.color === color || (!selectedConfig.color && color === "default")
                      ? "border-waka-500 bg-waka-50 text-waka-900"
                      : "border-stone-200 bg-white text-stone-700",
                  )}
                >
                  {t(lang, `posShelfColor_${color}` as "posShelfColor_default")}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-stone-600">{t(lang, "posShelfEditIcon")}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {SHELF_ICON_OPTIONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  aria-pressed={selectedConfig.icon === icon}
                  onClick={() => patchSelected({ icon })}
                  className={clsx(
                    "flex h-9 w-9 items-center justify-center rounded-xl border text-lg",
                    selectedConfig.icon === icon ? "border-waka-500 bg-waka-50" : "border-stone-200 bg-white",
                  )}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-stone-600">{t(lang, "posShelfEditSize")}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={selectedConfig.size === size}
                  onClick={() => patchSelected({ size })}
                  className={clsx(
                    "rounded-full border px-3 py-1 text-xs font-black capitalize",
                    selectedConfig.size === size ? "border-waka-500 bg-waka-50 text-waka-900" : "border-stone-200 bg-white",
                  )}
                >
                  {t(lang, `posShelfSize_${size}` as "posShelfSize_small")}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(selectedConfig.featured)}
              onChange={(e) => patchSelected({ featured: e.target.checked })}
              className="h-4 w-4 rounded border-stone-300"
            />
            <span className="text-sm font-bold text-stone-800">{t(lang, "posShelfEditFeatured")}</span>
          </label>

          <div>
            <p className="text-xs font-bold text-stone-600">{t(lang, "posShelfEditBadge")}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {(["none", "fast_moving", "promotion"] as const).map((badge) => (
                <button
                  key={badge}
                  type="button"
                  aria-pressed={badge === "none" ? !selectedConfig.badge : selectedConfig.badge === badge}
                  onClick={() => patchSelected({ badge: badge === "none" ? null : badge })}
                  className={clsx(
                    "rounded-full border px-3 py-1 text-xs font-black",
                    (badge === "none" ? !selectedConfig.badge : selectedConfig.badge === badge)
                      ? "border-waka-500 bg-waka-50 text-waka-900"
                      : "border-stone-200 bg-white text-stone-700",
                  )}
                >
                  {t(
                    lang,
                    badge === "none"
                      ? "posShelfBadgeNone"
                      : badge === "fast_moving"
                        ? "posShelfBadgeFastMoving"
                        : "posShelfBadgePromotion",
                  )}
                </button>
              ))}
            </div>
          </div>

          {isQuickSellSelected ? (
            <div>
              <button
                type="button"
                onClick={() => setQuickPickerOpen((v) => !v)}
                className="text-sm font-black text-waka-700"
              >
                {quickPickerOpen ? t(lang, "posQuickSellHideProducts") : t(lang, "posQuickSellPickProducts")}
              </button>
              {quickPickerOpen ? (
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-stone-200 p-2">
                  {products.slice(0, 80).map((p) => (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-stone-50">
                        <input
                          type="checkbox"
                          checked={quickSellIds.includes(p.id)}
                          onChange={() => toggleQuickProduct(p.id)}
                          className="h-4 w-4"
                        />
                        <span className="truncate text-sm font-semibold text-stone-800">{p.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );

  if (embedded) return content;

  return (
    <article className="space-y-3 rounded-2xl border-2 border-waka-200 bg-waka-50/60 p-4">
      <div>
        <p className="text-base font-black text-stone-950">{t(lang, "stockShelfArrangeTitle")}</p>
      </div>
      {content}
    </article>
  );
}

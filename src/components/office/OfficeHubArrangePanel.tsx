import { useCallback, useMemo, useState } from "react";
import clsx from "clsx";
import type { Language, LauncherTileColor, LauncherTileConfig } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useShelfDragReorder } from "../../hooks/useShelfDragReorder";
import { useOfficeHubAccess } from "../../hooks/useOfficeHubAccess";
import {
  OFFICE_HUB_SECTIONS,
  resolveOfficeHubSections,
  updateOfficeHubTileLayout,
} from "../../lib/officeHubSections";
import { PRESET_SHELF_HEX, resolveShelfHex } from "../../lib/shelfColor";
import { OfficeHubSectionTile } from "./OfficeHubSectionTile";
import { ShelfColorWheel } from "../pos/ShelfColorWheel";

const COLORS: LauncherTileColor[] = ["default", "red", "orange", "blue", "green", "purple"];
const EMPTY_ORDER: string[] = [];
const EMPTY_LAYOUT: Record<string, LauncherTileConfig> = {};

type Props = {
  lang: Language;
  embedded?: boolean;
};

export function OfficeHubArrangePanel({ lang, embedded = false }: Props) {
  const { sectionVisible } = useOfficeHubAccess();
  const savedOrderRaw = usePosStore((s) => s.preferences.officeHubTileOrder);
  const layoutRaw = usePosStore((s) => s.preferences.officeHubTileLayout);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const savedOrder = savedOrderRaw ?? EMPTY_ORDER;
  const layout = layoutRaw ?? EMPTY_LAYOUT;

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sections = useMemo(
    () =>
      resolveOfficeHubSections({
        savedOrder,
        layout,
        sectionVisible,
        includeHidden: true,
      }),
    [savedOrder, layout, sectionVisible],
  );

  const orderKeys = useMemo(() => sections.map((s) => s.id), [sections]);

  const onReorder = useCallback(
    (next: string[]) => {
      setPreferences({ officeHubTileOrder: next });
    },
    [setPreferences],
  );

  const { dragKey, overKey, startDrag, shouldIgnoreClick } = useShelfDragReorder(
    orderKeys,
    onReorder,
    "data-office-hub-key",
  );

  const selectedSection = selectedId ? sections.find((s) => s.id === selectedId) : null;
  const selectedConfig = selectedId ? layout[selectedId] : null;
  const selectedPreviewHex = selectedConfig
    ? resolveShelfHex(selectedConfig.customColor, selectedConfig.color ?? selectedSection?.color ?? "orange")
    : PRESET_SHELF_HEX.orange;

  const patchSelected = useCallback(
    (patch: Partial<LauncherTileConfig>) => {
      if (!selectedId) return;
      setPreferences({ officeHubTileLayout: updateOfficeHubTileLayout(layout, selectedId, patch) });
    },
    [selectedId, setPreferences, layout],
  );

  const selectSection = useCallback(
    (id: string) => {
      if (shouldIgnoreClick()) return;
      setSelectedId((current) => (current === id ? null : id));
    },
    [shouldIgnoreClick],
  );

  const selectedDef = selectedId ? OFFICE_HUB_SECTIONS.find((s) => s.id === selectedId) : null;

  if (sections.length === 0) {
    return (
      <p className="rounded-2xl bg-amber-50 px-4 py-6 text-center text-sm font-semibold text-amber-950">
        {t(lang, "officeHubEmpty")}
      </p>
    );
  }

  const content = (
    <div className="space-y-4">
      <p className="text-sm font-medium text-stone-600">{t(lang, "officeMenuArrangeSub")}</p>

      <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
        {sections.map((section, index) => (
          <OfficeHubSectionTile
            key={section.id}
            section={section}
            lang={lang}
            mode="arrange"
            selected={selectedId === section.id}
            dragging={dragKey === section.id}
            dragOver={overKey === section.id && dragKey !== section.id}
            className={sections.length % 2 === 1 && index === sections.length - 1 ? "col-span-2" : undefined}
            onClick={() => selectSection(section.id)}
            onDragPointerDown={(e) => startDrag(section.id, e)}
          />
        ))}
      </div>

      {selectedId && selectedSection && selectedDef ? (
        <section className="space-y-3 rounded-2xl border-2 border-waka-200 bg-white p-4">
          <p className="text-sm font-black text-stone-950">
            {t(lang, "officeMenuEditHeading")}: {t(lang, selectedSection.titleKey)}
          </p>

          <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm font-bold text-stone-800">
            <input
              type="checkbox"
              checked={!selectedSection.hidden}
              onChange={(e) => patchSelected({ hidden: !e.target.checked })}
              className="h-5 w-5 rounded border-2 border-stone-300 accent-waka-600"
            />
            {selectedSection.hidden ? t(lang, "homeMenuShowTile") : t(lang, "homeMenuHideTile")}
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
                    (selectedConfig?.color ?? "orange") === color && !selectedConfig?.customColor
                      ? "border-waka-600 ring-2 ring-waka-200"
                      : "border-stone-200",
                  )}
                  style={{ backgroundColor: PRESET_SHELF_HEX[color === "default" ? "default" : color] }}
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
                else patchSelected({ customColor: undefined, color: "orange" });
              }}
            />
          </div>
        </section>
      ) : null}
    </div>
  );

  if (embedded) return content;

  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-950">{t(lang, "officeMenuArrangeTitle")}</p>
      <div className="mt-4">{content}</div>
    </article>
  );
}

import type { Language } from "../../../types";
import { inventoryExtensionSectionTitleKey } from "../../../lib/inventoryWorkspaceTiles";
import type { InventoryWorkspaceMode, InventoryWorkspaceTile } from "../../../lib/inventoryWorkspaceTiles";
import { InventoryNavigationTiles } from "./InventoryNavigationTiles";

type Props = {
  lang: Language;
  mode: InventoryWorkspaceMode;
  tiles: InventoryWorkspaceTile[];
};

export function InventoryBusinessExtension({ lang, mode, tiles }: Props) {
  const sectionKey = inventoryExtensionSectionTitleKey(mode);
  if (!sectionKey || tiles.length === 0) return null;

  return (
    <InventoryNavigationTiles
      lang={lang}
      tiles={tiles}
      titleKey={sectionKey}
    />
  );
}

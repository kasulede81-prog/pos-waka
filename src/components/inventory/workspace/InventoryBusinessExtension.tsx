import type { Language, UserRole } from "../../../types";
import { inventoryExtensionSectionTitleKey } from "../../../lib/inventoryWorkspaceTiles";
import type { InventoryWorkspaceMode, InventoryWorkspaceTile } from "../../../lib/inventoryWorkspaceTiles";
import { InventoryNavigationTiles } from "./InventoryNavigationTiles";

type Props = {
  lang: Language;
  role: UserRole;
  mode: InventoryWorkspaceMode;
  tiles: InventoryWorkspaceTile[];
};

export function InventoryBusinessExtension({ lang, role, mode, tiles }: Props) {
  const sectionKey = inventoryExtensionSectionTitleKey(mode);
  if (!sectionKey || tiles.length === 0) return null;

  return (
    <InventoryNavigationTiles
      lang={lang}
      role={role}
      tiles={tiles}
      titleKey={sectionKey}
    />
  );
}

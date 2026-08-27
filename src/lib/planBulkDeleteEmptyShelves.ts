import type { BusinessType, CatalogNode, PosShelfLayoutConfig, Product, ShopPreferences } from "../types";
import { catalogShopIdFromPreferences, retireCatalogNodesForDeletedShelf } from "./catalogHierarchy";
import { isReservedEmptyShelfKey, planDeleteEmptyShelf, sameShelfIdentity } from "./deleteEmptyShelf";
import {
  catalogIdentityHasChildFolders,
  isProtectedPresetShelfIdentity,
  type EmptyShelfSkipReason,
} from "./emptyShelfManager";

export type BulkDeleteEmptyShelfSkip = {
  key: string;
  reason: EmptyShelfSkipReason;
};

export type PlanBulkDeleteEmptyShelvesInput = {
  shelfKeys: readonly string[];
  products: readonly Product[];
  layout: Record<string, PosShelfLayoutConfig>;
  orderKeys: readonly string[];
  sellCategoryFilter?: string | null;
  nodes?: readonly CatalogNode[];
  hierarchyEnabled?: boolean;
  shopId?: string;
  pharmacyMode?: boolean;
  hospitalityMode?: boolean;
  businessType?: BusinessType | null;
};

export type PlanBulkDeleteEmptyShelvesOk = {
  ok: true;
  layout: Record<string, PosShelfLayoutConfig>;
  orderKeys: string[];
  nodes: CatalogNode[];
  nodesChanged: boolean;
  clearSellCategoryFilter: boolean;
  deletedKeys: string[];
  skipped: BulkDeleteEmptyShelfSkip[];
};

export function planBulkDeleteEmptyShelves(
  input: PlanBulkDeleteEmptyShelvesInput,
): PlanBulkDeleteEmptyShelvesOk {
  const shopId = input.shopId?.trim() || catalogShopIdFromPreferences(undefined);
  let layout: Record<string, PosShelfLayoutConfig> = { ...input.layout };
  let orderKeys = [...input.orderKeys];
  let nodes = [...(input.nodes ?? [])];
  let clearSellCategoryFilter = false;
  const deletedKeys: string[] = [];
  const skipped: BulkDeleteEmptyShelfSkip[] = [];

  const uniqueKeys: string[] = [];
  for (const raw of input.shelfKeys) {
    const key = raw.trim();
    if (!key) {
      skipped.push({ key: raw, reason: "emptyKey" });
      continue;
    }
    if (uniqueKeys.some((u) => sameShelfIdentity(u, key))) continue;
    uniqueKeys.push(key);
  }

  const presetInput = {
    pharmacyMode: input.pharmacyMode,
    hospitalityMode: input.hospitalityMode,
    businessType: input.businessType,
  };

  for (const shelfKey of uniqueKeys) {
    if (isReservedEmptyShelfKey(shelfKey)) {
      skipped.push({ key: shelfKey, reason: "reserved" });
      continue;
    }
    if (isProtectedPresetShelfIdentity(shelfKey, presetInput)) {
      skipped.push({ key: shelfKey, reason: "preset" });
      continue;
    }
    if (
      input.hierarchyEnabled === true &&
      catalogIdentityHasChildFolders(nodes, shopId, shelfKey)
    ) {
      skipped.push({ key: shelfKey, reason: "hasChildren" });
      continue;
    }

    const plan = planDeleteEmptyShelf({
      shelfKey,
      products: input.products,
      layout,
      orderKeys,
      sellCategoryFilter: input.sellCategoryFilter,
    });
    if (!plan.ok) {
      skipped.push({
        key: shelfKey,
        reason: plan.errorKey === "shelfDeleteReserved" ? "reserved" : plan.errorKey === "shelfDeleteEmpty" ? "emptyKey" : "occupied",
      });
      continue;
    }

    layout = plan.layout;
    orderKeys = plan.orderKeys;
    if (plan.clearSellCategoryFilter) clearSellCategoryFilter = true;
    const nextNodes = retireCatalogNodesForDeletedShelf(nodes, plan.shelfKey);
    nodes = nextNodes;
    deletedKeys.push(plan.shelfKey);
  }

  const originalNodes = input.nodes ?? [];
  const nodesChanged =
    nodes.length !== originalNodes.length || nodes.some((n, i) => n !== originalNodes[i]);

  return {
    ok: true,
    layout,
    orderKeys,
    nodes,
    nodesChanged,
    clearSellCategoryFilter,
    deletedKeys,
    skipped,
  };
}

export function bulkDeleteEmptyShelvesPreferencePatch(
  plan: PlanBulkDeleteEmptyShelvesOk,
): Partial<ShopPreferences> | null {
  if (plan.deletedKeys.length === 0) return null;
  const prefPatch: Partial<ShopPreferences> = {
    posShelfLayout: plan.layout,
    posPinnedShelfKeys: plan.orderKeys,
  };
  if (plan.clearSellCategoryFilter) prefPatch.posSellCategoryFilter = null;
  if (plan.nodesChanged) prefPatch.posCatalogNodes = plan.nodes;
  return prefPatch;
}

import { describe, expect, it } from "vitest";
import {
  INVENTORY_TRANSFER_ENABLED,
  resolveInventoryExtensionTiles,
  resolveInventoryNavTiles,
  resolveInventoryOverviewQuickActions,
} from "./inventoryWorkspaceTiles";

describe("inventoryWorkspaceTiles (Phase 27.1)", () => {
  it("keeps Transfer out of production navigation while disabled", () => {
    expect(INVENTORY_TRANSFER_ENABLED).toBe(false);
    const nav = resolveInventoryNavTiles("retail", "/stock");
    expect(nav.some((t) => t.id === "transfer")).toBe(false);
    const quick = resolveInventoryOverviewQuickActions("retail");
    expect(quick.some((a) => a.id === "transfer")).toBe(false);
  });

  it("exposes Add Product and Receive on the hub overview quick actions", () => {
    const quick = resolveInventoryOverviewQuickActions("retail");
    expect(quick.map((a) => a.id)).toEqual(
      expect.arrayContaining(["receive", "newProduct", "adjust", "count"]),
    );
    expect(quick.find((a) => a.id === "newProduct")?.primary).toBe(true);
    expect(quick.find((a) => a.id === "receive")?.primary).toBe(true);
  });

  it("mounts completed hub destinations only", () => {
    const nav = resolveInventoryNavTiles("retail", "/stock");
    expect(nav.map((t) => t.id)).toEqual([
      "products",
      "purchases",
      "count",
      "movements",
      "categories",
      "suppliers",
      "reports",
    ]);
  });

  it("wires implemented extensions and hides unfinished ones", () => {
    expect(resolveInventoryExtensionTiles("pharmacy", "/pharmacy/inventory").map((t) => t.id)).toEqual([
      "expiry",
      "compliance",
    ]);
    expect(resolveInventoryExtensionTiles("retail", "/stock").map((t) => t.id)).toEqual(["shelfLabels"]);
    expect(resolveInventoryExtensionTiles("hospitality", "/stock").map((t) => t.id)).toEqual([
      "recipeInventory",
    ]);
    expect(resolveInventoryExtensionTiles("wholesale", "/stock")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  INVENTORY_TRANSFER_ENABLED,
  resolveInventoryExtensionTiles,
  resolveInventoryNavTiles,
  resolveInventoryOverviewQuickActions,
  resolveInventoryQuickActions,
} from "./inventoryWorkspaceTiles";

describe("inventoryWorkspaceTiles (MB-4C transfer enabled)", () => {
  it("exposes Transfer in production navigation with enterprise.transfers gate", () => {
    expect(INVENTORY_TRANSFER_ENABLED).toBe(true);
    const nav = resolveInventoryNavTiles("retail", "/stock");
    const transfer = nav.find((t) => t.id === "transfer");
    expect(transfer).toMatchObject({
      href: "/stock/transfer",
      perm: "enterprise.transfers",
    });
    const quick = resolveInventoryOverviewQuickActions("retail");
    expect(quick.find((a) => a.id === "transfer")?.perm).toBe("enterprise.transfers");
    expect(resolveInventoryQuickActions("retail").find((a) => a.id === "transfer")?.href).toBe("/stock/transfer");
  });

  it("exposes Add Product and Receive on the hub overview quick actions", () => {
    const quick = resolveInventoryOverviewQuickActions("retail");
    expect(quick.map((a) => a.id)).toEqual(
      expect.arrayContaining(["receive", "newProduct", "importCsv", "adjust", "count", "transfer"]),
    );
    expect(quick.find((a) => a.id === "newProduct")?.primary).toBe(true);
    expect(quick.find((a) => a.id === "receive")?.primary).toBe(true);
  });

  it("places Import CSV beside Add Product on hub overview, gated by products.add", () => {
    const quick = resolveInventoryOverviewQuickActions("retail");
    const addIdx = quick.findIndex((a) => a.id === "newProduct");
    const csvIdx = quick.findIndex((a) => a.id === "importCsv");
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(csvIdx).toBe(addIdx + 1);
    expect(quick[csvIdx]).toMatchObject({
      labelKey: "stockQuickImportCsv",
      actionId: "importCsv",
      perm: "products.add",
      primary: true,
    });
  });

  it("mounts completed hub destinations including transfer", () => {
    const nav = resolveInventoryNavTiles("retail", "/stock");
    expect(nav.map((t) => t.id)).toEqual([
      "products",
      "purchases",
      "count",
      "transfer",
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

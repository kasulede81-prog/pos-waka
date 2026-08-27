import { describe, expect, it } from "vitest";
import { filterDestinationShopProductRows } from "./stockTransferSync";

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("MB-4C destination product picker filter", () => {
  it("only returns products belonging to the selected destination shop", () => {
    const rows = filterDestinationShopProductRows(SHOP_B, [
      { id: "p1", name: "Dest Coke", shop_id: SHOP_B, is_active: true, stock_on_hand: 3, sku: "D1" },
      { id: "p2", name: "Source Coke", shop_id: SHOP_A, is_active: true, stock_on_hand: 9, sku: "S1" },
      { id: "p3", name: "Inactive Dest", shop_id: SHOP_B, is_active: false, stock_on_hand: 1, sku: "D2" },
    ]);
    expect(rows).toEqual([{ id: "p1", name: "Dest Coke", sku: "D1", stockOnHand: 3 }]);
  });

  it("never auto-matches by identical display names across shops", () => {
    const rows = filterDestinationShopProductRows(SHOP_B, [
      { id: "src", name: "Coca-Cola", shop_id: SHOP_A, is_active: true, stock_on_hand: 10 },
      { id: "dst", name: "Coca-Cola", shop_id: SHOP_B, is_active: true, stock_on_hand: 2 },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["dst"]);
  });
});

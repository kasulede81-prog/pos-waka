import { describe, expect, it } from "vitest";
import { resolveStockProductSheetActionIds } from "./StockProductActionSheet";

describe("resolveStockProductSheetActionIds", () => {
  it("does not present edit/duplicate/restock/remove to a cashier-like actor", () => {
    expect(
      resolveStockProductSheetActionIds({
        canAdd: false,
        canEdit: false,
        canRestock: false,
        canRemove: false,
        canSell: true,
      }),
    ).toEqual(["sell"]);
  });

  it("presents owner actions including edit, duplicate, restock, and remove", () => {
    expect(
      resolveStockProductSheetActionIds({
        canAdd: true,
        canEdit: true,
        canRestock: true,
        canRemove: true,
        canSell: true,
      }),
    ).toEqual(["sell", "edit", "duplicate", "restock", "remove"]);
  });

  it("presents manager / stock-keeper catalog actions without remove", () => {
    expect(
      resolveStockProductSheetActionIds({
        canAdd: true,
        canEdit: true,
        canRestock: true,
        canRemove: false,
        canSell: false,
      }),
    ).toEqual(["edit", "duplicate", "restock"]);
  });

  it("does not advertise edit when add is allowed but updateProduct would be rejected", () => {
    expect(
      resolveStockProductSheetActionIds({
        canAdd: true,
        canEdit: false,
        canRestock: false,
        canRemove: false,
        canSell: false,
      }),
    ).toEqual(["duplicate"]);
  });

  it("does not advertise edit from stock.adjust alone (does not broaden past products.add)", () => {
    expect(
      resolveStockProductSheetActionIds({
        canAdd: false,
        canEdit: false,
        canRestock: false,
        canRemove: false,
        canSell: false,
      }),
    ).toEqual([]);
  });
});

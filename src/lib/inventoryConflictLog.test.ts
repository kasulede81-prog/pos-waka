import { describe, expect, it } from "vitest";
import { detectSaleStockConflict, logInventoryConflict, getRecentInventoryConflicts, clearInventoryConflictLog } from "./inventoryConflictLog";

describe("inventoryConflictLog", () => {
  it("detects oversell risk when stock would go negative", () => {
    const conflict = detectSaleStockConflict({
      productId: "p1",
      productName: "Coke",
      stockOnHand: 2,
      quantity: 5,
      minimumStockAlert: 5,
    });
    expect(conflict?.kind).toBe("oversell_risk");
  });

  it("detects critical level when crossing minimum alert", () => {
    const conflict = detectSaleStockConflict({
      productId: "p1",
      productName: "Coke",
      stockOnHand: 12,
      quantity: 8,
      minimumStockAlert: 5,
    });
    expect(conflict?.kind).toBe("critical_level");
    expect(conflict?.stockAfter).toBe(4);
  });

  it("logs and retains recent conflicts", () => {
    clearInventoryConflictLog();
    const c = detectSaleStockConflict({
      productId: "p1",
      productName: "Coke",
      stockOnHand: 1,
      quantity: 3,
      minimumStockAlert: 0,
    });
    expect(c).not.toBeNull();
    logInventoryConflict(c!);
    expect(getRecentInventoryConflicts()).toHaveLength(1);
  });
});

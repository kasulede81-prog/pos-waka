import { describe, expect, it } from "vitest";
import { mergeStockMovementsFromCloudPull, parseStockMovementRow } from "./stockMovementRecovery";

describe("stockMovementRecovery", () => {
  it("parses cloud RPC row into StockMovement", () => {
    const m = parseStockMovementRow({
      id: "m1",
      movement_at: "2026-06-01T10:00:00.000Z",
      payload: {
        id: "m1",
        at: "2026-06-01T10:00:00.000Z",
        productId: "p1",
        productName: "Sugar",
        deltaBaseUnits: -2,
        kind: "sale_out",
        summary: "Sale",
      },
    });
    expect(m?.productId).toBe("p1");
    expect(m?.deltaBaseUnits).toBe(-2);
  });

  it("merges cloud movements into empty local ledger", () => {
    const merged = mergeStockMovementsFromCloudPull([], [
      {
        id: "m1",
        at: "2026-06-01T10:00:00.000Z",
        productId: "p1",
        productName: "Sugar",
        deltaBaseUnits: 5,
        kind: "purchase_in",
        summary: "Purchase",
      },
    ]);
    expect(merged).toHaveLength(1);
  });
});

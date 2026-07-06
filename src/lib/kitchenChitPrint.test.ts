import { describe, expect, it } from "vitest";
import { buildKitchenChitLines, kitchenChitSummary } from "./kitchenChitPrint";
import type { KitchenTicket } from "../types";

const sampleTicket: KitchenTicket = {
  id: "t1",
  tableSessionId: "s1",
  saleId: "sale1",
  stationId: "st1",
  stationType: "kitchen",
  status: "queued",
  ticketNumber: 12,
  firedAt: "2026-07-06T10:00:00.000Z",
  tableLabel: "T5",
  waiterLabel: "Jane",
  guestCount: 4,
  orderRound: 1,
  items: [
    {
      id: "i1",
      productId: "p1",
      productName: "Grilled chicken",
      quantity: 2,
      modifierLabels: ["Extra spicy"],
      notes: "No onions",
    },
  ],
};

describe("kitchenChitPrint", () => {
  it("formats table and modifiers on chit lines", () => {
    const lines = buildKitchenChitLines(sampleTicket, "en", "new");
    const text = lines.join("\n");
    expect(text).toContain("T5");
    expect(text).toContain("Jane");
    expect(text).toContain("Grilled chicken");
    expect(text).toContain("Extra spicy");
    expect(text).toContain("No onions");
  });

  it("builds human summary for queue", () => {
    expect(kitchenChitSummary(sampleTicket, "new")).toContain("#12");
    expect(kitchenChitSummary(sampleTicket, "new")).toContain("T5");
  });
});

import { describe, expect, it } from "vitest";
import { buildKitchenChitEscPos, buildKitchenChitLines, kitchenChitSummary } from "./kitchenChitPrint";
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

  it("builds 58mm kitchen ESC/POS without clipping long item names", () => {
    const ticket: KitchenTicket = {
      ...sampleTicket,
      items: [
        {
          ...sampleTicket.items[0],
          productName: "Charcoal Grilled Whole Chicken With Extra Spicy Marinade And Chips",
        },
      ],
    };
    const bytes = buildKitchenChitEscPos(ticket, "en", "58mm", "new");
    const text = decodeEscPosAscii(bytes);
    expect(text).toContain("T5");
    expect(text).toContain("Charcoal Grilled");
    expect(text).toContain("Whole Chicken");
    expect(text.split("\n").filter(Boolean).every((line) => line.length <= 32)).toBe(true);
    expect(hasPartialCut(bytes)).toBe(false);
    expect(bytes.includes(0x0c)).toBe(false);
  });
});

function decodeEscPosAscii(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x1b) {
      const next = bytes[i + 1];
      if (next === 0x40) {
        i += 1;
        continue;
      }
      if (next === 0x74 || next === 0x61 || next === 0x45 || next === 0x64) {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (b === 0x1d) {
      const next = bytes[i + 1];
      if (next === 0x21) {
        i += 2;
        continue;
      }
      if (next === 0x56) {
        i += 3;
        continue;
      }
      i += 1;
      continue;
    }
    if (b === 0x0a) {
      out += "\n";
      continue;
    }
    if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
  }
  return out;
}

function hasPartialCut(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] === 0x1d && bytes[i + 1] === 0x56 && bytes[i + 2] === 0x42 && bytes[i + 3] === 0x03) return true;
  }
  return false;
}

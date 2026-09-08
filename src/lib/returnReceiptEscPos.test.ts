import { describe, expect, it, vi } from "vitest";
import type { ReturnRecord } from "../types";
import type { ReturnReceiptContext } from "./receiptDocuments";
import { buildReturnReceiptEscPos } from "./returnReceiptEscPos";
import { columnsForWidth, defaultFinishForWidth } from "./escPosBuilder";

const LINKED_SALE_ID = "sale-abc12345-linked";

function sampleReturn(overrides: Partial<ReturnRecord> = {}): ReturnRecord {
  return {
    id: "ret-11111111",
    saleId: LINKED_SALE_ID,
    productId: "p-coke",
    productName: "Coke 500ml",
    quantity: 2,
    refundAmountUgx: 15_000,
    refundCashUgx: 9_000,
    cogsUgx: 8_000,
    unitCostUgx: 4_000,
    reason: "wrong_item",
    note: "Opened by mistake",
    actorUserId: "user-1",
    actorName: "Amina",
    createdAt: "2026-08-25T12:00:00.000Z",
    ...overrides,
  };
}

function sampleCtx(overrides: Partial<ReturnReceiptContext> = {}): ReturnReceiptContext {
  return {
    shopName: "Waka Test Shop",
    receiptNumber: "RET-20260825-RET111",
    returnRecord: sampleReturn(),
    sale: {
      id: LINKED_SALE_ID,
      createdAt: "2026-08-25T10:00:00.000Z",
      lines: [],
      subtotalUgx: 50_000,
      totalUgx: 50_000,
      cashPaidUgx: 50_000,
      debtUgx: 0,
      discountTotalUgx: 0,
      estimatedProfitUgx: 20_000,
      pendingSync: false,
      status: "completed",
    },
    cashier: "Amina",
    customerName: "John Doe",
    ...overrides,
  };
}

function decodeEscPosText(bytes: Uint8Array): string {
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
    if (bytes[i] === 0x1d && bytes[i + 1] === 0x56 && bytes[i + 2] === 0x42 && bytes[i + 3] === 0x03) {
      return true;
    }
  }
  return false;
}

function hasFeed(bytes: Uint8Array, lines = 4): boolean {
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0x1b && bytes[i + 1] === 0x64 && bytes[i + 2] === lines) return true;
  }
  return false;
}

function contentLines(bytes: Uint8Array): string[] {
  return decodeEscPosText(bytes).split("\n").filter((line) => line.length > 0);
}

describe("buildReturnReceiptEscPos", () => {
  it("is a Uint8Array and is deterministic", () => {
    const ctx = sampleCtx();
    const a = buildReturnReceiptEscPos(ctx, "80mm");
    const b = buildReturnReceiptEscPos(ctx, "80mm");
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.byteLength).toBeGreaterThan(20);
    expect(a).toEqual(b);
  });

  it("uses 32 columns on 58mm and 42 on 80mm", () => {
    expect(columnsForWidth("58mm")).toBe(32);
    expect(columnsForWidth("80mm")).toBe(42);
    const ctx = sampleCtx();
    const narrow = buildReturnReceiptEscPos(ctx, "58mm");
    const wide = buildReturnReceiptEscPos(ctx, "80mm");
    expect(contentLines(narrow).every((line) => line.length <= 32)).toBe(true);
    expect(contentLines(wide).every((line) => line.length <= 42)).toBe(true);
    expect(Array.from(narrow)).not.toEqual(Array.from(wide));
  });

  it("wraps long product names within column width", () => {
    const longName =
      "Very Long Pharmacy Compound Name With Extra Words That Must Wrap Across Thermal Columns Without Throwing";
    const bytes = buildReturnReceiptEscPos(
      sampleCtx({ returnRecord: sampleReturn({ productName: longName }) }),
      "58mm",
    );
    const text = decodeEscPosText(bytes);
    expect(text).toContain("Very Long Pharmacy");
    expect(text).toContain("Compound Name");
    expect(contentLines(bytes).every((line) => line.length <= 32)).toBe(true);
    expect(text.split("\n")).not.toContain(longName);
  });

  it("wraps a long reason within 58mm columns", () => {
    const longReason =
      "wrong_item plus a very long explanation that must wrap across fifty eight millimeter columns" as ReturnRecord["reason"];
    const bytes = buildReturnReceiptEscPos(
      sampleCtx({ returnRecord: sampleReturn({ reason: longReason }) }),
      "58mm",
    );
    const text = decodeEscPosText(bytes);
    expect(text).toContain("wrong_item plus a very");
    expect(contentLines(bytes).every((line) => line.length <= 32)).toBe(true);
    expect(text.split("\n")).not.toContain(`Reason: ${longReason}`);
  });

  it("wraps a long note within 58mm columns", () => {
    const note = "Customer asked us to write an unusually long note that will not fit on one 58mm thermal line.";
    const bytes = buildReturnReceiptEscPos(sampleCtx({ returnRecord: sampleReturn({ note }) }), "58mm");
    const text = decodeEscPosText(bytes);
    expect(text).toContain("unusually long note");
    expect(contentLines(bytes).every((line) => line.length <= 32)).toBe(true);
    expect(text.split("\n")).not.toContain(`Note: ${note}`);
  });

  it("prints exactly the stored refundAmountUgx and not other money fields", () => {
    const ctx = sampleCtx({
      returnRecord: sampleReturn({
        refundAmountUgx: 15_000,
        refundCashUgx: 9_000,
        cogsUgx: 8_000,
        unitCostUgx: 4_000,
      }),
    });
    const text = decodeEscPosText(buildReturnReceiptEscPos(ctx, "80mm"));
    expect(text).toContain("UGX 15,000");
    expect(text).toContain("Refund");
    expect(text).not.toContain("UGX 9,000");
    expect(text).not.toContain("UGX 8,000");
    expect(text).not.toContain("UGX 4,000");
    expect(text).not.toContain("UGX 50,000");
    expect(text).not.toContain("COGS");
    expect(text).not.toContain("unit cost");
    expect(text).not.toContain("Grand Total");
    expect(text).not.toContain("Subtotal");
    expect(text).not.toContain("Method");
    expect(text).not.toContain("refundCash");
    expect(text).not.toContain("Paid");
    expect(text).not.toContain("Change");
  });

  it("includes a linked sale reference from returnRecord.saleId without requiring Sale", () => {
    const ctx = sampleCtx({
      sale: null,
      returnRecord: sampleReturn({ saleId: "abcdef12-zzzz-sale" }),
    });
    const text = decodeEscPosText(buildReturnReceiptEscPos(ctx, "80mm"));
    expect(text).toContain("Sale:");
    expect(text).toContain("#abcdef12");
    expect(text).not.toContain("abcdef12-zzzz-sale");
  });

  it("omits sale reference for unlinked returns and does not invent one from ctx.sale", () => {
    const ctx = sampleCtx({
      returnRecord: sampleReturn({ saleId: null }),
    });
    const text = decodeEscPosText(buildReturnReceiptEscPos(ctx, "80mm"));
    expect(text).not.toContain("Sale:");
    expect(text).not.toContain(`#${LINKED_SALE_ID.slice(0, 8)}`);
  });

  it("does not print original sale total", () => {
    const text = decodeEscPosText(buildReturnReceiptEscPos(sampleCtx(), "80mm"));
    expect(text).not.toContain("50,000");
    expect(text).not.toContain("Original sale");
  });

  it("inherits EscPosBuilder feed on 58mm and does not emit form-feed or cut", () => {
    const shortBytes = buildReturnReceiptEscPos(sampleCtx(), "58mm");
    const longBytes = buildReturnReceiptEscPos(
      sampleCtx({
        returnRecord: sampleReturn({
          productName: "Very Long Pharmacy Compound Name With Extra Words That Must Wrap Across Thermal Columns",
          note: "Customer asked us to write an unusually long note that will not fit on one 58mm thermal line.",
        }),
      }),
      "58mm",
    );
    expect(defaultFinishForWidth("58mm")).toBe("feed");
    expect(longBytes.byteLength).toBeGreaterThan(shortBytes.byteLength);
    expect(shortBytes.includes(0x0c)).toBe(false);
    expect(longBytes.includes(0x0c)).toBe(false);
    expect(hasPartialCut(shortBytes)).toBe(false);
    expect(hasPartialCut(longBytes)).toBe(false);
    expect(hasFeed(shortBytes, 4)).toBe(true);
  });

  it("inherits EscPosBuilder partial-cut on 80mm", () => {
    const bytes = buildReturnReceiptEscPos(sampleCtx(), "80mm");
    expect(defaultFinishForWidth("80mm")).toBe("partial-cut");
    expect(hasFeed(bytes, 4)).toBe(true);
    expect(hasPartialCut(bytes)).toBe(true);
  });

  it("does not mutate ReturnRecord", () => {
    const rec = sampleReturn();
    const before = structuredClone(rec);
    buildReturnReceiptEscPos(sampleCtx({ returnRecord: rec }), "58mm");
    expect(rec).toEqual(before);
  });

  it("does not import or invoke print queue / adapter", async () => {
    const queue = await import("./printQueue");
    const adapter = await import("../services/hardware/printerAdapter");
    const enqueueSpy = vi.spyOn(queue, "enqueuePrintJob");
    const sendSpy = vi.spyOn(adapter, "sendEscPosBytes");
    buildReturnReceiptEscPos(sampleCtx(), "80mm");
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
    enqueueSpy.mockRestore();
    sendSpy.mockRestore();
  });
});

import { describe, expect, it, vi } from "vitest";
import { defaultReceiptDisplayOptions } from "./receiptBranding";
import type { ReceiptDisplayData } from "./receiptPrint";
import { buildRetailReceiptEscPos } from "./retailReceiptEscPos";
import { columnsForWidth } from "./escPosBuilder";

function sampleDisplay(overrides: Partial<ReceiptDisplayData> = {}): ReceiptDisplayData {
  return {
    shopName: "Waka Test Shop",
    shopAddress: "Plot 1 Kampala Road",
    shopPhone: "+256700000000",
    customHeaderLines: null,
    headerLines: [],
    receiptNumber: "INV-000042",
    dateText: "25 Aug 2026",
    timeText: "14:30",
    cashier: "Amina",
    lines: [
      {
        name: "Cooking Oil 1L",
        quantityLabel: "2",
        unitPriceUgx: 12_000,
        lineTotalUgx: 24_000,
        listPriceUgx: 12_000,
        customerPaidUgx: 12_000,
        showCustomerPaid: false,
        showCalculation: true,
      },
      {
        name: "Sugar 1kg",
        quantityLabel: "1",
        unitPriceUgx: 5_000,
        lineTotalUgx: 5_000,
        listPriceUgx: 5_000,
        customerPaidUgx: 5_000,
        showCustomerPaid: false,
        showCalculation: false,
      },
    ],
    subtotalUgx: 29_000,
    lineDiscountsUgx: 0,
    cartDiscountUgx: 1_000,
    discountUgx: 1_000,
    totalUgx: 28_000,
    paidUgx: 30_000,
    changeUgx: 2_000,
    paymentMethodLabel: "CASH",
    footerLines: ["Thank you for shopping with us"],
    footerThanks: "Thank you for shopping with us",
    footerPowered: "Powered by Waka POS",
    returnPolicy: "Returns accepted with receipt within 24 hours.",
    displayOptions: defaultReceiptDisplayOptions(),
    customerName: null,
    customerPhone: null,
    outstandingDebtUgx: 0,
    customerBalanceUgx: null,
    ...overrides,
  };
}

function decodeEscPosText(bytes: Uint8Array): string {
  // Strip common ESC/POS control sequences for content assertions.
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x1b) {
      // ESC @ / ESC t n / ESC a n / ESC E n / ESC d n
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
      // GS ! n / GS V ...
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

describe("buildRetailReceiptEscPos (Phase 1A)", () => {
  it("is deterministic for the same ReceiptDisplayData input", () => {
    const display = sampleDisplay();
    const a = buildRetailReceiptEscPos(display, "80mm");
    const b = buildRetailReceiptEscPos(display, "80mm");
    expect(a).toEqual(b);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("does not mutate ReceiptDisplayData or nested lines", () => {
    const display = sampleDisplay({
      lines: [
        {
          name: "Immutable Item",
          quantityLabel: "3",
          unitPriceUgx: 1000,
          lineTotalUgx: 3000,
          listPriceUgx: 1000,
          customerPaidUgx: 1000,
          showCustomerPaid: false,
          showCalculation: true,
        },
      ],
    });
    const frozenLine = Object.freeze({ ...display.lines[0] });
    const frozenLines = Object.freeze([frozenLine]);
    const frozenOpts = Object.freeze({ ...display.displayOptions });
    const frozen = Object.freeze({
      ...display,
      lines: frozenLines,
      displayOptions: frozenOpts,
      footerLines: Object.freeze([...display.footerLines]),
      headerLines: Object.freeze([...display.headerLines]),
    }) as ReceiptDisplayData;

    expect(() => buildRetailReceiptEscPos(frozen, "58mm")).not.toThrow();
    expect(frozen.lines[0].name).toBe("Immutable Item");
    expect(frozen.totalUgx).toBe(28_000);
    expect(frozen.lines).toBe(frozenLines);
  });

  it("renders 58mm and 80mm successfully and deterministically", () => {
    const display = sampleDisplay();
    const narrow = buildRetailReceiptEscPos(display, "58mm");
    const wide = buildRetailReceiptEscPos(display, "80mm");
    expect(narrow.byteLength).toBeGreaterThan(40);
    expect(wide.byteLength).toBeGreaterThan(40);
    expect(narrow).toEqual(buildRetailReceiptEscPos(display, "58mm"));
    expect(wide).toEqual(buildRetailReceiptEscPos(display, "80mm"));
    // Different widths generally produce different layouts (column count differs).
    expect(columnsForWidth("58mm")).toBe(32);
    expect(columnsForWidth("80mm")).toBe(42);
    expect(Array.from(narrow)).not.toEqual(Array.from(wide));
  });

  it("includes retail content from ReceiptDisplayData", () => {
    const display = sampleDisplay({
      cartDiscountUgx: 1_000,
      outstandingDebtUgx: 4_000,
      customerName: "John Doe",
      customerPhone: "+256711111111",
      displayOptions: {
        ...defaultReceiptDisplayOptions(),
        showDebtInfo: true,
        showCustomerName: true,
        showCustomerPhone: true,
      },
    });
    const text = decodeEscPosText(buildRetailReceiptEscPos(display, "80mm"));
    expect(text).toContain("Waka Test Shop");
    expect(text).toContain("INV-000042");
    expect(text).toContain("25 Aug 2026");
    expect(text).toContain("14:30");
    expect(text).toContain("Amina");
    expect(text).toContain("Cooking Oil 1L");
    expect(text).toContain("Sugar 1kg");
    expect(text).toContain("Subtotal");
    expect(text).toContain("Cart discount");
    expect(text).toContain("Grand Total");
    expect(text).toContain("CASH");
    expect(text).toContain("Outstanding Debt");
    expect(text).toContain("John Doe");
    expect(text).toContain("Thank you for shopping with us");
    expect(text).not.toContain("TABLE");
    expect(text).not.toContain("Waiter");
    expect(text).not.toContain("kitchen");
  });

  it("handles long product names and missing optional fields", () => {
    const longName =
      "Very Long Pharmacy Compound Name With Extra Words That Must Wrap Across Thermal Columns Without Throwing";
    const display = sampleDisplay({
      shopAddress: null,
      shopPhone: null,
      cashier: "",
      customerName: null,
      customerPhone: null,
      headerLines: [],
      customHeaderLines: null,
      displayOptions: {
        ...defaultReceiptDisplayOptions(),
        showCashier: false,
        showShopAddress: false,
        showShopPhone: false,
        showCustomerName: false,
        showDebtInfo: false,
      },
      lines: [
        {
          name: longName,
          quantityLabel: "1",
          unitPriceUgx: 99_999,
          lineTotalUgx: 99_999,
          listPriceUgx: 99_999,
          customerPaidUgx: 99_999,
          showCustomerPaid: false,
          showCalculation: true,
        },
      ],
      lineDiscountsUgx: 500,
      cartDiscountUgx: 0,
      discountUgx: 500,
      footerPowered: null,
      returnPolicy: null,
    });
    const bytes = buildRetailReceiptEscPos(display, "58mm");
    const text = decodeEscPosText(bytes);
    expect(text).toContain("Very Long Pharmacy");
    expect(text).toContain("Line discounts");
    expect(text).not.toContain("Cashier:");
    expect(bytes.byteLength).toBeGreaterThan(20);
  });

  it("does not import or invoke print queue / adapter / sale sync surfaces", async () => {
    const queue = await import("./printQueue");
    const adapter = await import("../services/hardware/printerAdapter");
    const enqueueSpy = vi.spyOn(queue, "enqueuePrintJob");
    const sendSpy = vi.spyOn(adapter, "sendEscPosBytes");
    const display = sampleDisplay();
    buildRetailReceiptEscPos(display, "80mm");
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
    enqueueSpy.mockRestore();
    sendSpy.mockRestore();
  });

  it("keeps 58mm lines within 32 columns and wraps long names", () => {
    const longName =
      "Very Long Pharmacy Compound Name With Extra Words That Must Wrap Across Thermal Columns Without Throwing";
    const bytes = buildRetailReceiptEscPos(
      sampleDisplay({
        returnPolicy: null,
        footerLines: [
          "Thank you for shopping with us",
          "Returns accepted with receipt within 24 hours.",
        ],
        lines: [
          {
            name: longName,
            quantityLabel: "1",
            unitPriceUgx: 99_999,
            lineTotalUgx: 99_999,
            listPriceUgx: 99_999,
            customerPaidUgx: 99_999,
            showCustomerPaid: false,
            showCalculation: true,
          },
        ],
      }),
      "58mm",
    );
    const text = decodeEscPosText(bytes);
    const contentLines = text.split("\n").filter((line) => line.length > 0);
    expect(contentLines.every((line) => line.length <= 32)).toBe(true);
    expect(text).toContain("Very Long Pharmacy");
    expect(text).toContain("Compound Name");
  });

  it("keeps 58mm totals aligned and readable", () => {
    const text = decodeEscPosText(buildRetailReceiptEscPos(sampleDisplay(), "58mm"));
    for (const label of ["Subtotal", "Grand Total", "Paid", "Change", "Method"]) {
      const line = text.split("\n").find((row) => row.includes(label));
      expect(line, label).toBeTruthy();
      expect(line!.length).toBeLessThanOrEqual(32);
      if (label !== "Method") expect(line).toContain("UGX");
      else expect(line).toContain("CASH");
    }
  });

  it("uses content-dependent feed and no 327mm page on 58mm", () => {
    const shortBytes = buildRetailReceiptEscPos(sampleDisplay({ lines: sampleDisplay().lines.slice(0, 1) }), "58mm");
    const longBytes = buildRetailReceiptEscPos(
      sampleDisplay({
        lines: Array.from({ length: 8 }, (_, i) => ({
          name: `Item number ${i + 1} with a longer product title`,
          quantityLabel: "1",
          unitPriceUgx: 1000,
          lineTotalUgx: 1000,
          listPriceUgx: 1000,
          customerPaidUgx: 1000,
          showCustomerPaid: false,
          showCalculation: true,
        })),
      }),
      "58mm",
    );
    expect(longBytes.byteLength).toBeGreaterThan(shortBytes.byteLength);
    expect(shortBytes.includes(0x0c)).toBe(false);
    expect(longBytes.includes(0x0c)).toBe(false);
    expect(hasPartialCut(shortBytes)).toBe(false);
    expect(hasFeed(shortBytes, 4)).toBe(true);
  });

  it("word-wraps the default 24h snapshot footer on 58mm", () => {
    const policy = "Returns accepted with receipt within 24 hours.";
    const text = decodeEscPosText(
      buildRetailReceiptEscPos(
        sampleDisplay({
          returnPolicy: null,
          footerLines: ["Thank you for shopping with us", policy],
        }),
        "58mm",
      ),
    );
    const lines = text.split("\n");
    expect(policy.length).toBe(46);
    expect(lines).not.toContain(policy);
    expect(lines).not.toContain("Returns accepted with receipt wi");
    expect(lines).toContain("Returns accepted with receipt");
    expect(lines).toContain("within 24 hours.");
    const first = lines.indexOf("Returns accepted with receipt");
    expect(lines[first + 1]).toBe("within 24 hours.");
    expect(lines[first]!.length).toBeLessThanOrEqual(32);
    expect(lines[first + 1]!.length).toBeLessThanOrEqual(32);
  });

  it("preserves footer slot order, blank rows, and does not duplicate the policy", () => {
    const policy = "Returns accepted with receipt within 24 hours.";
    const longSlot = "Please bring this receipt when you return goods to the shop.";
    const text = decodeEscPosText(
      buildRetailReceiptEscPos(
        sampleDisplay({
          returnPolicy: policy,
          footerLines: ["Thank you for shopping with us", "", longSlot, policy],
        }),
        "58mm",
      ),
    );
    const policyCount = text.split("Returns accepted with receipt").length - 1;
    expect(policyCount).toBe(1);
    expect(text).toContain("Thank you for shopping with us\n\nPlease bring this receipt when\nyou return goods to the shop.\nReturns accepted with receipt\nwithin 24 hours.");
  });

  it("encodes UGX as ASCII on the thermal payload", () => {
    const bytes = buildRetailReceiptEscPos(sampleDisplay(), "58mm");
    const ugx = [0x55, 0x47, 0x58];
    let found = false;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === ugx[0] && bytes[i + 1] === ugx[1] && bytes[i + 2] === ugx[2]) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});

function hasPartialCut(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] === 0x1d && bytes[i + 1] === 0x56 && bytes[i + 2] === 0x42 && bytes[i + 3] === 0x03) return true;
  }
  return false;
}

function hasFeed(bytes: Uint8Array, lines = 4): boolean {
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0x1b && bytes[i + 1] === 0x64 && bytes[i + 2] === lines) return true;
  }
  return false;
}

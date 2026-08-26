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
});

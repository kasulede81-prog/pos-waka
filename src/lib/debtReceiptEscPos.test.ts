import { describe, expect, it, vi } from "vitest";
import type { Customer, DebtPayment } from "../types";
import type { DebtPaymentReceiptContext } from "./receiptDocuments";
import { buildDebtReceiptEscPos } from "./debtReceiptEscPos";
import { columnsForWidth, defaultFinishForWidth } from "./escPosBuilder";

const CUSTOMER_ID = "cust-uuid-must-not-print";

function samplePayment(overrides: Partial<DebtPayment> = {}): DebtPayment {
  return {
    id: "pay-11111111",
    customerId: CUSTOMER_ID,
    amountUgx: 25_000,
    createdAt: "2026-08-25T12:00:00.000Z",
    ...overrides,
  };
}

function sampleCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: CUSTOMER_ID,
    name: "John Doe",
    phone: "0700123456",
    location: "Kampala",
    debtBalanceUgx: 999_999,
    createdAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function sampleCtx(overrides: Partial<DebtPaymentReceiptContext> = {}): DebtPaymentReceiptContext {
  return {
    shopName: "Waka Test Shop",
    receiptNumber: "DEBT-20260825-PAY111",
    payment: samplePayment(),
    customer: sampleCustomer(),
    cashier: "Amina",
    balanceAfterUgx: 3_000,
    headerLines: ["Waka Test Shop", "Nakasero Road"],
    footerLines: ["Thank you for paying"],
    footerPowered: "Powered by Waka POS",
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

describe("buildDebtReceiptEscPos", () => {
  it("is a Uint8Array and is deterministic", () => {
    const ctx = sampleCtx();
    const a = buildDebtReceiptEscPos(ctx, "80mm");
    const b = buildDebtReceiptEscPos(ctx, "80mm");
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.byteLength).toBeGreaterThan(20);
    expect(a).toEqual(b);
  });

  it("uses 32 columns on 58mm and 42 on 80mm", () => {
    expect(columnsForWidth("58mm")).toBe(32);
    expect(columnsForWidth("80mm")).toBe(42);
    const ctx = sampleCtx();
    const narrow = buildDebtReceiptEscPos(ctx, "58mm");
    const wide = buildDebtReceiptEscPos(ctx, "80mm");
    expect(contentLines(narrow).every((line) => line.length <= 32)).toBe(true);
    expect(contentLines(wide).every((line) => line.length <= 42)).toBe(true);
    expect(Array.from(narrow)).not.toEqual(Array.from(wide));
  });

  it("prints exactly stored payment.amountUgx and ctx.balanceAfterUgx", () => {
    const ctx = sampleCtx({
      payment: samplePayment({ amountUgx: 25_000 }),
      balanceAfterUgx: 3_000,
      customer: sampleCustomer({ debtBalanceUgx: 999_999 }),
    });
    const text = decodeEscPosText(buildDebtReceiptEscPos(ctx, "80mm"));
    expect(text).toContain("DEBT PAYMENT RECEIPT");
    expect(text).toContain("Amount paid");
    expect(text).toContain("UGX 25,000");
    expect(text).toContain("Balance after");
    expect(text).toContain("UGX 3,000");
    expect(text).not.toContain("UGX 999,999");
    expect(text).not.toContain("1,002,999");
  });

  it("does not print payment method, cash split, sale, or cost fields", () => {
    const text = decodeEscPosText(buildDebtReceiptEscPos(sampleCtx(), "80mm"));
    expect(text).not.toContain("Mobile Money");
    expect(text).not.toContain("Cash received");
    expect(text).not.toContain("non-cash");
    expect(text).not.toContain("Method");
    expect(text).not.toContain("Card");
    expect(text).not.toContain("Bank");
    expect(text).not.toContain("Mixed");
    expect(text).not.toContain("Sale:");
    expect(text).not.toContain("Grand Total");
    expect(text).not.toContain("Subtotal");
    expect(text).not.toContain("COGS");
    expect(text).not.toContain("unit cost");
    expect(text).not.toContain(CUSTOMER_ID);
  });

  it("wraps a long customer name within 58mm columns", () => {
    const longName =
      "Very Long Customer Name With Extra Words That Must Wrap Across Thermal Columns Without Throwing";
    const bytes = buildDebtReceiptEscPos(
      sampleCtx({ customer: sampleCustomer({ name: longName }) }),
      "58mm",
    );
    const text = decodeEscPosText(bytes);
    expect(text).toContain("Very Long Customer");
    expect(contentLines(bytes).every((line) => line.length <= 32)).toBe(true);
    expect(text.split("\n")).not.toContain(`Customer:${longName}`);
    expect(text.split("\n").some((line) => line.includes(longName))).toBe(false);
  });

  it("wraps long header and footer lines within 58mm columns", () => {
    const longHeader = "Waka Neighbourhood Shop With An Extra Long Trading Name On Nakasero";
    const longFooter = "Please keep this receipt for your records and thank you for settling your account with us today.";
    const bytes = buildDebtReceiptEscPos(
      sampleCtx({
        headerLines: [longHeader, "Second header line that is also quite long for fifty eight mm"],
        footerLines: [longFooter],
      }),
      "58mm",
    );
    const text = decodeEscPosText(bytes);
    expect(text).toContain("Waka Neighbourhood Shop");
    expect(text).toContain("Please keep this receipt");
    expect(contentLines(bytes).every((line) => line.length <= 32)).toBe(true);
    expect(text.split("\n").some((line) => line.includes(longHeader))).toBe(false);
    expect(text.split("\n").some((line) => line.includes(longFooter))).toBe(false);
  });

  it("keeps a large UGX amount readable on 58mm", () => {
    const bytes = buildDebtReceiptEscPos(
      sampleCtx({
        payment: samplePayment({ amountUgx: 12_345_678 }),
        balanceAfterUgx: 9_000_000,
      }),
      "58mm",
    );
    const text = decodeEscPosText(bytes);
    expect(text).toContain("UGX 12,345,678");
    expect(text).toContain("UGX 9,000,000");
    expect(contentLines(bytes).every((line) => line.length <= 32)).toBe(true);
  });

  it("prints phone only when present", () => {
    const withPhone = decodeEscPosText(buildDebtReceiptEscPos(sampleCtx(), "80mm"));
    expect(withPhone).toContain("Phone:");
    expect(withPhone).toContain("0700123456");

    const without = decodeEscPosText(
      buildDebtReceiptEscPos(sampleCtx({ customer: sampleCustomer({ phone: "   " }) }), "80mm"),
    );
    expect(without).not.toContain("Phone:");
  });

  it("uses Not Recorded when customer name is empty", () => {
    const text = decodeEscPosText(
      buildDebtReceiptEscPos(sampleCtx({ customer: sampleCustomer({ name: "  " }) }), "80mm"),
    );
    expect(text).toContain("Not Recorded");
  });

  it("inherits EscPosBuilder feed on 58mm and does not emit form-feed or cut", () => {
    const shortBytes = buildDebtReceiptEscPos(sampleCtx(), "58mm");
    const longBytes = buildDebtReceiptEscPos(
      sampleCtx({
        headerLines: ["Very Long Pharmacy Compound Shop Name With Extra Words That Must Wrap Across Thermal Columns"],
        footerLines: ["Customer asked us to write an unusually long footer that will not fit on one 58mm thermal line."],
        customer: sampleCustomer({
          name: "Very Long Customer Name With Extra Words That Must Wrap Across Thermal Columns",
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
    const bytes = buildDebtReceiptEscPos(sampleCtx(), "80mm");
    expect(defaultFinishForWidth("80mm")).toBe("partial-cut");
    expect(hasFeed(bytes, 4)).toBe(true);
    expect(hasPartialCut(bytes)).toBe(true);
  });

  it("does not mutate payment, customer, or context snapshot", () => {
    const payment = samplePayment();
    const customer = sampleCustomer();
    const ctx = sampleCtx({ payment, customer, balanceAfterUgx: 3_000 });
    const paymentBefore = structuredClone(payment);
    const customerBefore = structuredClone(customer);
    const balanceBefore = ctx.balanceAfterUgx;
    buildDebtReceiptEscPos(ctx, "58mm");
    expect(payment).toEqual(paymentBefore);
    expect(customer).toEqual(customerBefore);
    expect(ctx.balanceAfterUgx).toBe(balanceBefore);
  });

  it("does not import or invoke print queue / adapter", async () => {
    const queue = await import("./printQueue");
    const adapter = await import("../services/hardware/printerAdapter");
    const enqueueSpy = vi.spyOn(queue, "enqueuePrintJob");
    const sendSpy = vi.spyOn(adapter, "sendEscPosBytes");
    buildDebtReceiptEscPos(sampleCtx(), "80mm");
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
    enqueueSpy.mockRestore();
    sendSpy.mockRestore();
  });
});

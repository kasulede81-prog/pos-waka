import { describe, expect, it } from "vitest";
import type { Sale, ShopPreferences } from "../types";
import {
  applyIndustryReceiptDefaults,
  brandingFromSale,
  buildReceiptBrandingSnapshot,
  buildReceiptHeaderLines,
  industryReceiptFooterTemplate,
  receiptFooterLinesForPrint,
  receiptFooterLinesFromPreferences,
  resolveFooterPowered,
  resolveReceiptBranding,
} from "./receiptBranding";
import { buildSaleReceiptText } from "./receiptPrint";

function prefs(partial: Partial<ShopPreferences> = {}): ShopPreferences {
  return {
    businessType: "kiosk_duka",
    kioskQuickSell: true,
    onboardingDone: true,
    schemaVersion: 2,
    shopDisplayName: "SUPER ADMIN",
    shopAddressLine: "Nansana",
    shopPhoneE164: "+256705110478",
    ...partial,
  } as ShopPreferences;
}

describe("receipt header", () => {
  it("builds structured header lines", () => {
    const lines = buildReceiptHeaderLines(
      {
        businessName: "SUPER ADMIN",
        address: "Nansana",
        phone: "+256705110478",
        email: "info@example.com",
        tin: "123456789",
      },
      {
        showCashier: true,
        showReceiptNumber: true,
        showPaymentMethod: true,
        showCustomerName: true,
        showCustomerPhone: true,
        showDebtInfo: true,
        showShopAddress: true,
        showShopPhone: true,
      },
    );
    expect(lines[0]).toBe("SUPER ADMIN");
    expect(lines).toContain("Nansana");
    expect(lines).toContain("+256705110478");
    expect(lines.some((l) => l.startsWith("TIN:"))).toBe(true);
  });

  it("splits multiline address into separate receipt lines", () => {
    const lines = buildReceiptHeaderLines(
      {
        businessName: "Shop",
        address: "Plot 5\nNansana\nUganda",
        phone: "",
        email: "",
        tin: "",
      },
      {
        showCashier: true,
        showReceiptNumber: true,
        showPaymentMethod: true,
        showCustomerName: true,
        showCustomerPhone: true,
        showDebtInfo: true,
        showShopAddress: true,
        showShopPhone: true,
      },
    );
    expect(lines).toEqual(["SHOP", "Plot 5", "Nansana", "Uganda"]);
  });
});

describe("footer lines", () => {
  it("keeps blank row between non-empty footer slots", () => {
    expect(receiptFooterLinesForPrint(["Thank you", "", "Visit again", ""])).toEqual([
      "Thank you",
      "",
      "Visit again",
    ]);
    const p = prefs({
      receiptFooterLines: ["Thank you", "", "Visit again", ""],
    });
    expect(receiptFooterLinesFromPreferences(p)).toEqual(["Thank you", "", "Visit again"]);
  });

  it("industry pharmacy template", () => {
    const lines = industryReceiptFooterTemplate("pharmacy");
    expect(lines[0]).toContain("children");
  });
});

describe("branding snapshot", () => {
  it("persists on sale and overrides live prefs", () => {
    const preferences = prefs({
      receiptFooterLines: ["Old footer"],
    });
    const snap = buildReceiptBrandingSnapshot(preferences, "free");
    const sale: Sale = {
      id: "s1",
      createdAt: "2026-06-02T10:00:00.000Z",
      lines: [],
      subtotalUgx: 1000,
      totalUgx: 1000,
      cashPaidUgx: 0,
      debtUgx: 1000,
      estimatedProfitUgx: 0,
      pendingSync: false,
      paymentMethod: "credit",
      receiptHeaderSnapshot: snap.header,
      receiptFooterSnapshot: snap.footer,
      receiptCustomerName: "John",
    };
    const live = prefs({ receiptFooterLines: ["New footer only"] });
    const branding = brandingFromSale(sale, live, "waka_plus");
    expect(branding.footerLines).not.toContain("New footer only");
    expect(branding.headerLines.length).toBeGreaterThan(0);
  });
});

describe("debt receipt text", () => {
  it("shows Pay Later, outstanding debt, and customer", () => {
    const branding = resolveReceiptBranding(prefs(), "free");
    const text = buildSaleReceiptText({
      shopName: "Shop",
      cashier: "Jane",
      receiptNumber: "001",
      sale: {
        id: "s1",
        createdAt: "2026-06-02T10:00:00.000Z",
        lines: [{ productId: "p", name: "Item", quantity: 1, unitPriceUgx: 1000, unitCostUgx: 500, lineTotalUgx: 1000, estimatedProfitUgx: 500, inputMode: "quantity" }],
        subtotalUgx: 1000,
        totalUgx: 1000,
        cashPaidUgx: 0,
        debtUgx: 1000,
        estimatedProfitUgx: 500,
        pendingSync: false,
        paymentMethod: "credit",
      },
      headerLines: branding.headerLines,
      footerLines: branding.footerLines,
      footerPowered: branding.footerPowered ?? undefined,
      displayOptions: branding.displayOptions,
      customerName: "John Ssemanda",
      customerBalanceUgx: null,
      labels: {
        cashier: "Cashier",
        items: "Items",
        total: "Total",
        paid: "Paid",
        debtSale: "Debt",
        balance: "Balance",
        time: "Time",
        outstandingDebt: "Outstanding Debt",
        customer: "Customer",
        customerNotRecorded: "Not Recorded",
        receiptNo: "Receipt No",
        date: "Date",
        method: "Method",
        change: "Change",
        subtotal: "Subtotal",
        discount: "Discount",
        grandTotal: "Grand Total",
      },
    });
    expect(text).toContain("Pay Later");
    expect(text).toContain("Outstanding Debt");
    expect(text).toContain("John Ssemanda");
  });

  it("shows Not Recorded when customer missing", () => {
    const sale: Sale = {
      id: "s1",
      createdAt: "2026-06-02T10:00:00.000Z",
      lines: [],
      subtotalUgx: 500,
      totalUgx: 500,
      cashPaidUgx: 0,
      debtUgx: 500,
      estimatedProfitUgx: 0,
      pendingSync: false,
      paymentMethod: "credit",
    };
    const text = buildSaleReceiptText({
      shopName: "Shop",
      cashier: "Jane",
      receiptNumber: "001",
      sale,
      displayOptions: {
        showCashier: true,
        showReceiptNumber: true,
        showPaymentMethod: true,
        showCustomerName: true,
        showCustomerPhone: true,
        showDebtInfo: true,
        showShopAddress: true,
        showShopPhone: true,
      },
      customerName: null,
      customerBalanceUgx: null,
      labels: {
        cashier: "Cashier",
        items: "Items",
        total: "Total",
        paid: "Paid",
        debtSale: "Debt",
        balance: "Balance",
        time: "Time",
        outstandingDebt: "Outstanding Debt",
        customer: "Customer",
        customerNotRecorded: "Not Recorded",
        receiptNo: "Receipt No",
        date: "Date",
        method: "Method",
        change: "Change",
        subtotal: "Subtotal",
        discount: "Discount",
        grandTotal: "Grand Total",
      },
    });
    expect(text).toContain("Not Recorded");
  });
});

describe("premium powered-by toggle", () => {
  it("free plan always shows powered by", () => {
    expect(resolveFooterPowered(prefs({ receiptShowPoweredByWaka: false }), "free")).toBe("Powered by Waka POS");
  });

  it("business plan may hide powered by", () => {
    expect(resolveFooterPowered(prefs({ receiptShowPoweredByWaka: false }), "business")).toBeNull();
  });
});

describe("industry defaults", () => {
  it("applies wholesale footer on new shop", () => {
    const patch = applyIndustryReceiptDefaults(prefs(), "wholesale");
    expect(patch.receiptFooterLines?.[0]).toContain("business");
  });
});

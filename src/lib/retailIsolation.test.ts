import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { pharmacyTerm } from "./pharmacyTerms";
import { hospitalityTerm } from "./hospitalityTerms";
import { wholesaleTerm } from "./wholesaleTerms";
import { posSearchAliases, uiPlaceholder } from "./pharmacyUx";
import { buildSaleReceiptText, type ReceiptLabels } from "./receiptPrint";
import type { Sale } from "../types";

const FORBIDDEN_NON_RETAIL_TERMS = [
  "paracetamol",
  "amoxicillin",
  "dispense",
  "patient",
  "table",
  "kitchen",
  "waiter",
  "invoice",
  "warehouse",
  "receivable",
] as const;

function expectNoForbiddenTerms(text: string) {
  const lower = text.toLowerCase();
  for (const term of FORBIDDEN_NON_RETAIL_TERMS) {
    expect(lower).not.toContain(term);
  }
}

describe("retail isolation — placeholders", () => {
  it("keeps retail product examples", () => {
    const example = uiPlaceholder("en", "kiosk_duka", "simpleAddStep1Example", false);
    expect(example.toLowerCase()).toContain("coca cola");
    expect(example.toLowerCase()).toContain("sugar");
    expectNoForbiddenTerms(example);
  });

  it("keeps retail category hint wording", () => {
    const category = uiPlaceholder("en", "kiosk_duka", "quickAddStep2Ph", false);
    expect(category.toLowerCase()).toContain("drinks");
    expectNoForbiddenTerms(category);
  });
});

describe("retail isolation — onboarding copy", () => {
  it("shows retail business type feature copy", () => {
    const features = t("en", "businessTypeFeatures_kiosk_duka");
    expect(features.toLowerCase()).toContain("pos");
    expect(features.toLowerCase()).toContain("stock");
    expectNoForbiddenTerms(features);
  });
});

describe("retail isolation — search aliases", () => {
  it("uses retail aliases and excludes pharmacy aliases", () => {
    const aliases = posSearchAliases("kiosk_duka", false);
    expect(aliases.soda).toBeDefined();
    expect(aliases.sugar).toBeDefined();
    expect(aliases.paracetamol).toBeUndefined();
    expect(aliases.amoxicillin).toBeUndefined();
  });
});

describe("retail isolation — terminology map", () => {
  it("retains retail terms across mode mappings", () => {
    expect(pharmacyTerm("en", "kiosk_duka", "product", false).toLowerCase()).toContain("product");
    expect(hospitalityTerm("en", "kiosk_duka", "sale", false).toLowerCase()).toContain("sale");
    expect(wholesaleTerm("en", "kiosk_duka", "stock").toLowerCase()).toContain("inventory");
  });
});

describe("retail isolation — dashboard and reports labels", () => {
  it("dashboard/reports copy remains retail", () => {
    const dashboardTitle = t("en", "homeCashierHello");
    const reportsTitle = t("en", "reports");
    expectNoForbiddenTerms(`${dashboardTitle} ${reportsTitle}`);
  });
});

describe("retail isolation — receipts", () => {
  it("receipt text is retail-safe", () => {
    const sale: Sale = {
      id: "sale-1",
      status: "completed",
      createdAt: "2026-06-02T08:00:00.000Z",
      updatedAt: "2026-06-02T08:00:00.000Z",
      lines: [
        {
          productId: "p1",
          name: "Coca Cola",
          quantity: 1,
          inputMode: "quantity",
          unitPriceUgx: 2000,
          unitCostUgx: 1000,
          lineTotalUgx: 2000,
          estimatedProfitUgx: 1000,
        },
      ],
      subtotalUgx: 2000,
      totalUgx: 2000,
      cashPaidUgx: 2000,
      debtUgx: 0,
      estimatedProfitUgx: 1000,
      pendingSync: false,
    };
    const labels: ReceiptLabels = {
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
    };
    const text = buildSaleReceiptText({
      shopName: "Retail Shop",
      cashier: "Cashier A",
      sale,
      customerName: null,
      customerBalanceUgx: null,
      labels,
    });
    expect(text.toLowerCase()).toContain("retail shop".toLowerCase());
    expectNoForbiddenTerms(text);
  });
});

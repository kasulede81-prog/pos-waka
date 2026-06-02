import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { hospitalityTerm } from "./hospitalityTerms";
import { posSearchAliases } from "./pharmacyUx";

const FORBIDDEN_NON_HOSPITALITY_TERMS = ["dispense", "patient", "invoice", "warehouse", "receivable"] as const;

function expectNoForbidden(text: string) {
  const lower = text.toLowerCase();
  for (const term of FORBIDDEN_NON_HOSPITALITY_TERMS) {
    expect(lower).not.toContain(term);
  }
}

describe("hospitality isolation — tables/kitchen/orders/settlement", () => {
  it("uses hospitality vocabulary for operations", () => {
    const words = [
      hospitalityTerm("en", "restaurant", "stock", true),
      hospitalityTerm("en", "restaurant", "sell", true),
      hospitalityTerm("en", "restaurant", "pendingSale", true),
      hospitalityTerm("en", "restaurant", "checkout", true),
      t("en", "navFloor"),
      t("en", "navKitchen"),
    ].join(" ");
    expect(words.toLowerCase()).toContain("menu");
    expect(words.toLowerCase()).toContain("orders");
    expect(words.toLowerCase()).toContain("bill");
    expect(words.toLowerCase()).toContain("floor");
    expect(words.toLowerCase()).toContain("kitchen");
    expectNoForbidden(words);
  });
});

describe("hospitality isolation — dashboard/reports/receipts/navigation", () => {
  it("keeps hospitality-first labels", () => {
    const copy = [
      t("en", "hospitalityDashTitle"),
      t("en", "hospitalityReportsTitle"),
      t("en", "hospitalityPage_receiptsHint"),
      t("en", "navFloor"),
      t("en", "navKitchen"),
      t("en", "navMenu"),
    ].join(" ");
    expect(copy.toLowerCase()).toContain("service");
    expect(copy.toLowerCase()).toContain("hospitality");
    expectNoForbidden(copy);
  });
});

describe("hospitality isolation — leakage checks", () => {
  it("does not pick pharmacy or wholesale aliases in hospitality mode", () => {
    const aliases = posSearchAliases("restaurant", false);
    expect(aliases.paracetamol).toBeUndefined();
    expect(aliases.amoxicillin).toBeUndefined();
    expect(aliases.rice).toBeUndefined();
    expect(aliases.detergent).toBeUndefined();
  });

  it("retains table and kitchen realism copy", () => {
    const realism = [t("en", "tableSendKitchen"), t("en", "kitchenCancelTicket"), t("en", "hospitalityDashOpenTables")].join(" ");
    expect(realism.toLowerCase()).toContain("kitchen");
    expect(realism.toLowerCase()).toContain("table");
    expectNoForbidden(realism);
  });
});

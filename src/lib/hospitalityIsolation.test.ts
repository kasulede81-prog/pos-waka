import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { hospitalityTerm } from "./hospitalityTerms";
import { posSearchAliases, uiPlaceholder } from "./pharmacyUx";
import {
  HOSPITALITY_FORBIDDEN_RETAIL_TERMS,
  hospitalityPlaceholder,
  textContainsHospitalityRetailLeak,
} from "./hospitalityUx";
import {
  defaultKitchenEnabledForBusinessType,
  isBarOnlyMode,
  isKitchenEnabledForHospitality,
} from "./hospitality";

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
    expect(words.toLowerCase()).toMatch(/order/);
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
  it("does not pick pharmacy, wholesale, or retail aliases in hospitality mode", () => {
    const aliases = posSearchAliases("restaurant", false, true);
    expect(aliases.paracetamol).toBeUndefined();
    expect(aliases.amoxicillin).toBeUndefined();
    expect(aliases.sugar).toBeUndefined();
    expect(aliases.pilau).toBeDefined();
  });

  it("uses hospitality placeholders without retail product examples", () => {
    const bar = hospitalityPlaceholder("en", "bar", "simpleAddStep1Example");
    const restaurant = hospitalityPlaceholder("en", "restaurant", "simpleAddStep1Example");
    const combined = hospitalityPlaceholder("en", "restaurant_bar", "simpleAddStep1Example");
    for (const text of [bar, restaurant, combined]) {
      expect(textContainsHospitalityRetailLeak(text)).toBeNull();
      expect(text.toLowerCase()).not.toContain("coca");
    }
    expect(bar.toLowerCase()).toMatch(/beer|whiskey|nile/);
    expect(restaurant.toLowerCase()).toMatch(/pilau|chapati|chicken/);
    expect(combined.toLowerCase()).toMatch(/pilau|chicken|beer/);
    const retail = uiPlaceholder("en", "kiosk_duka", "simpleAddStep1Example", false, false);
    expect(retail.toLowerCase()).toContain("sugar");
    for (const term of HOSPITALITY_FORBIDDEN_RETAIL_TERMS) {
      expect(bar.toLowerCase()).not.toContain(term);
    }
  });

  it("defaults kitchen off for bar and on for restaurant types", () => {
    expect(defaultKitchenEnabledForBusinessType("bar")).toBe(false);
    expect(defaultKitchenEnabledForBusinessType("restaurant")).toBe(true);
    expect(defaultKitchenEnabledForBusinessType("restaurant_bar")).toBe(true);
    expect(isKitchenEnabledForHospitality("bar", null)).toBe(false);
    expect(isKitchenEnabledForHospitality("bar", true)).toBe(true);
    expect(isBarOnlyMode("bar", true, null)).toBe(true);
    expect(isBarOnlyMode("restaurant", true, null)).toBe(false);
  });

  it("retains table and kitchen realism copy", () => {
    const realism = [t("en", "tableSendKitchen"), t("en", "kitchenCancelTicket"), t("en", "hospitalityDashOpenTables")].join(" ");
    expect(realism.toLowerCase()).toContain("kitchen");
    expect(realism.toLowerCase()).toContain("table");
    expectNoForbidden(realism);
  });
});

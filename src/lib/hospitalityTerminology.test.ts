import { describe, expect, it } from "vitest";
import { hospitalityTerm } from "./hospitalityTerms";
import { t } from "./i18n";

describe("hospitality terminology isolation", () => {
  it("uses order vocabulary in hospitality mode", () => {
    expect(hospitalityTerm("en", "restaurant", "sell", true).toLowerCase()).toContain("order");
    expect(hospitalityTerm("en", "bar", "clearSale", true).toLowerCase()).toContain("order");
    expect(hospitalityTerm("en", "restaurant_bar", "saveSale", true).toLowerCase()).toContain("order");
    expect(hospitalityTerm("en", "restaurant", "thisSale", true).toLowerCase()).toContain("order");
  });

  it("keeps retail sale wording outside hospitality", () => {
    expect(hospitalityTerm("en", "kiosk_duka", "clearSale", false)).toBe(t("en", "clearSale"));
    expect(hospitalityTerm("en", "kiosk_duka", "sell", false)).toBe(t("en", "sellTitle"));
  });
});

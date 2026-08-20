import { describe, expect, it } from "vitest";
import { tTemplate } from "./i18n";

describe("tTemplate", () => {
  it("replaces {{month}} without leaving a leftover brace", () => {
    expect(tTemplate("en", "desktopHomeLiveMonthProfit", { month: "August" })).toBe("August profit");
    expect(tTemplate("en", "desktopHomeLiveMonthSales", { month: "August" })).toBe("August total sales");
  });

  it("replaces {{count}} on Home health strings", () => {
    expect(tTemplate("en", "desktopHomeStatusLowStock", { count: 2 })).toBe("Low stock: 2");
    expect(tTemplate("en", "desktopHomeDeviceLimit", { count: 4 })).toBe("Up to 4 devices");
  });

  it("still replaces single-brace {count} strings", () => {
    expect(tTemplate("en", "desktopHomeLiveTxnCount", { count: 3 })).toBe("3 transactions");
    expect(tTemplate("en", "desktopHomeLiveItemsCount", { count: 2 })).toBe("2 items");
  });
});

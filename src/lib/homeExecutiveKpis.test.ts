import { describe, expect, it } from "vitest";
import { buildHomeExecutiveKpis } from "./homeExecutiveKpis";
import { homeModuleBand, sortTilesByHomePriority } from "./homeModulePriority";

describe("homeExecutiveKpis", () => {
  it("builds strip from existing live stats without inventing values", () => {
    const kpis = buildHomeExecutiveKpis({
      todayRevenueLabel: "Today's sales",
      todayRevenueValue: "UGX 120K",
      todayRevenueIntensity: "high",
      showTodayRevenue: true,
      transactions: {
        label: "Today's sales",
        value: "12 transactions",
        intensity: "normal",
      },
      cash: { label: "Drawer", value: "UGX 50K", intensity: "normal" },
      inventory: { label: "Low stock", value: "3 items", intensity: "alert" },
      reportsPath: "/reports",
      receiptsPath: "/receipts",
      profitPath: "/office/profit",
      cashPath: "/office/cash-drawer",
      inventoryPath: "/stock",
      debtsPath: "/debts",
    });

    expect(kpis.map((k) => k.id)).toEqual(["sales", "transactions", "cash", "lowStock"]);
    expect(kpis.find((k) => k.id === "lowStock")?.tone).toBe("danger");
    expect(kpis.find((k) => k.id === "sales")?.value).toBe("UGX 120K");
  });
});

describe("homeModulePriority", () => {
  it("bands modules for executive hierarchy", () => {
    expect(homeModuleBand("inventory")).toBe("primary");
    expect(homeModuleBand("debts")).toBe("secondary");
    expect(homeModuleBand("settings")).toBe("admin");
  });

  it("sorts primary before admin", () => {
    const sorted = sortTilesByHomePriority([{ id: "settings" }, { id: "cash" }, { id: "debts" }]);
    expect(sorted.map((t) => t.id)).toEqual(["cash", "debts", "settings"]);
  });
});

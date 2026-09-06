import { describe, expect, it } from "vitest";
import { presentProfitShelfRanking, shelfContributionPct } from "./profitPageView";
import type { ProfitCategoryGroup } from "./homeProfit";

const liveGroups: ProfitCategoryGroup[] = [
  {
    categoryKey: "general",
    categoryLabel: "General",
    salesUgx: 900_000,
    costUgx: 0,
    profitUgx: 90_000,
    products: [
      {
        productId: "p1",
        name: "Item",
        qty: 1,
        salesUgx: 900_000,
        costUgx: 0,
        profitUgx: 90_000,
      },
    ],
  },
];

describe("P2-NEW-07 profit shelf vs frozen headline", () => {
  it("TEST 1 — open period keeps live shelf totals", () => {
    const presented = presentProfitShelfRanking({
      authority: "live",
      groups: liveGroups,
      liveTotalProfitUgx: 900_000,
    });
    expect(presented).toEqual({
      kind: "open",
      groups: liveGroups,
      totalProfitUgx: 900_000,
    });
    if (presented.kind === "open") {
      expect(shelfContributionPct(presented.groups[0]!.profitUgx, presented.totalProfitUgx)).toBe(10);
    }
  });

  it("TEST 2 — closed period fails closed; no live shelf", () => {
    const presented = presentProfitShelfRanking({
      authority: "closed_snapshot",
      groups: liveGroups,
      liveTotalProfitUgx: 900_000,
    });
    expect(presented).toEqual({ kind: "unavailable" });
  });

  it("TEST 3 — mixed period fails closed", () => {
    const presented = presentProfitShelfRanking({
      authority: "mixed",
      groups: liveGroups,
      liveTotalProfitUgx: 900_000,
    });
    expect(presented).toEqual({ kind: "unavailable" });
  });

  it("TEST 4 — does not scale live product profit to a frozen headline", () => {
    const frozenHeadline = 1_000_000;
    const presented = presentProfitShelfRanking({
      authority: "closed_snapshot",
      groups: liveGroups,
      liveTotalProfitUgx: 900_000,
    });
    expect(presented.kind).toBe("unavailable");
    expect(shelfContributionPct(90_000, 900_000)).toBe(10);
    expect(shelfContributionPct(90_000, frozenHeadline)).toBe(9);
    expect(presented).not.toMatchObject({ totalProfitUgx: frozenHeadline });
    expect(presented).not.toMatchObject({ totalProfitUgx: 900_000 });
  });

  it("TEST 5 — shelf authority is independent of reports.profit visibility", () => {
    const canProfit = false;
    const presented = presentProfitShelfRanking({
      authority: "live",
      groups: liveGroups,
      liveTotalProfitUgx: 900_000,
    });
    expect(presented.kind).toBe("open");
    expect(canProfit).toBe(false);
  });
});

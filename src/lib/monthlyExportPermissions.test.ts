import { describe, expect, it } from "vitest";
import { buildMonthlyBusinessReport, formatMonthlyReportPlain, monthlyReportToCsv } from "./monthlyBusinessReport";

const report = buildMonthlyBusinessReport({
  monthKey: "2026-06",
  shopName: "Test Shop",
  sales: [],
  returnRecords: [],
  products: [],
  staffAccounts: [],
});

describe("monthly export profit gate", () => {
  it("includes profit columns when includeProfit is true", () => {
    const csv = monthlyReportToCsv(report, { includeProfit: true });
    expect(csv).toContain("profit_ugx");
    const plain = formatMonthlyReportPlain("en", report, { includeProfit: true });
    expect(plain).toContain("Profit");
  });

  it("omits profit columns entirely when includeProfit is false", () => {
    const csv = monthlyReportToCsv(report, { includeProfit: false });
    expect(csv).not.toContain("profit_ugx");
    expect(csv).not.toContain("net_profit");
    const plain = formatMonthlyReportPlain("en", report, { includeProfit: false });
    expect(plain.toLowerCase()).not.toContain("profit");
  });

  it("does not export profit row when denied", () => {
    const csv = monthlyReportToCsv(report, { includeProfit: false });
    expect(csv).not.toContain("profit_ugx");
    expect(csv.split("\n").some((line) => line.includes("profit"))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { canSeeFinanceDiagnostics, canSeeShopWideFinancialSummaries } from "./financeVisibility";

describe("financeVisibility", () => {
  it("allows shop summaries for owner manager supervisor only", () => {
    expect(canSeeShopWideFinancialSummaries("owner")).toBe(true);
    expect(canSeeShopWideFinancialSummaries("manager")).toBe(true);
    expect(canSeeShopWideFinancialSummaries("supervisor")).toBe(true);
    expect(canSeeShopWideFinancialSummaries("cashier")).toBe(false);
  });

  it("restricts finance diagnostics to owner", () => {
    expect(canSeeFinanceDiagnostics("owner")).toBe(true);
    expect(canSeeFinanceDiagnostics("manager")).toBe(false);
    expect(canSeeFinanceDiagnostics("cashier")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  loyaltySectionPath,
  loyaltySectionsForActor,
  resolveLoyaltySection,
} from "./loyaltyNav";

describe("loyaltyNav (Phase 1 IA)", () => {
  it("maps current and legacy section ids", () => {
    expect(resolveLoyaltySection(undefined)).toBe("overview");
    expect(resolveLoyaltySection("members")).toBe("members");
    expect(resolveLoyaltySection("customers")).toBe("members");
    expect(resolveLoyaltySection("earn")).toBe("settings");
    expect(resolveLoyaltySection("design")).toBe("cards");
    expect(resolveLoyaltySection("requests")).toBe("cards");
    expect(resolveLoyaltySection("unknown")).toBe("overview");
  });

  it("builds canonical paths", () => {
    expect(loyaltySectionPath("overview")).toBe("/office/loyalty/overview");
    expect(loyaltySectionPath("members")).toBe("/office/loyalty/members");
  });

  it("hides rewards management from non-managers", () => {
    const manager = loyaltySectionsForActor({ canManage: true });
    const cashier = loyaltySectionsForActor({ canManage: false });
    expect(manager).toContain("rewards");
    expect(cashier).not.toContain("rewards");
    expect(cashier).toContain("members");
    expect(cashier).toContain("overview");
  });
});

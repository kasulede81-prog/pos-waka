import { describe, expect, it } from "vitest";
import type { Product, ShopPreferences } from "../types";
import {
  buildControlledComplianceApproval,
  evaluateControlledCheckout,
  shouldOpenControlledGate,
} from "./pharmacyControlledCheckout";

function controlledProduct(): Product {
  return {
    id: "p1",
    name: "Morphine 10mg",
    sellingMode: "unit",
    baseUnit: "tablet",
    sellingPricePerUnitUgx: 1000,
    costPricePerUnitUgx: 500,
    stockOnHand: 50,
    minimumStockAlert: 5,
    category: "Analgesic",
    sku: "",
    updatedAt: "",
    version: 1,
    pharmacyMaster: {
      controlledDrug: true,
      controlledSchedule: "narcotic",
      maxQuantityPerDispense: 10,
      managerOverrideRequired: true,
      otcOrPrescription: "prescription",
    },
  };
}

describe("pharmacyControlledCheckout", () => {
  const prefs = { businessType: "pharmacy", kioskQuickSell: false, onboardingDone: true } as ShopPreferences;
  const line = {
    productId: "p1",
    name: "Morphine",
    inputMode: "quantity" as const,
    quantity: 2,
    unitPriceUgx: 1000,
    unitCostUgx: 500,
    lineTotalUgx: 2000,
    estimatedProfitUgx: 1000,
  };

  it("evaluateControlledCheckout delegates to shared validation", () => {
    const v = evaluateControlledCheckout({
      lines: [line],
      products: [controlledProduct()],
      preferences: prefs,
      prescription: null,
      compliance: null,
    });
    expect(v.controlledLines.length).toBe(1);
    expect(v.requiresGate).toBe(true);
  });

  it("shouldOpenControlledGate when controlled lines need approval", () => {
    const v = evaluateControlledCheckout({
      lines: [line],
      products: [controlledProduct()],
      preferences: prefs,
      prescription: null,
      compliance: null,
    });
    expect(shouldOpenControlledGate(v)).toBe(true);
  });

  it("shouldOpenControlledGate false when no controlled lines", () => {
    const v = evaluateControlledCheckout({
      lines: [],
      products: [controlledProduct()],
      preferences: prefs,
      prescription: null,
      compliance: null,
    });
    expect(shouldOpenControlledGate(v)).toBe(false);
  });

  it("buildControlledComplianceApproval stores real actor identity", () => {
    const approval = buildControlledComplianceApproval({
      patientVerified: true,
      prescriptionVerified: true,
      managerApproved: true,
      managerReason: "Emergency override",
      actor: { userId: "staff-42", displayName: "Jane Pharmacist", role: "manager" },
      pinVerified: true,
    });
    expect(approval.managerUserId).toBe("staff-42");
    expect(approval.managerName).toBe("Jane Pharmacist");
    expect(approval.managerRole).toBe("manager");
    expect(approval.pharmacistUserId).toBe("staff-42");
    expect(approval.pinVerified).toBe(true);
    expect(approval.approvalMethod).toBe("owner_pin");
  });
});

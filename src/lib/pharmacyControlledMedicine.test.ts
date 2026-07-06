import { describe, expect, it } from "vitest";
import type { Product, ShopPreferences } from "../types";
import { buildControlledLineInfo, isControlledProduct, validateControlledDispense } from "./pharmacyControlledMedicine";

function controlledProduct(maxQty = 10): Product {
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
      maxQuantityPerDispense: maxQty,
      managerOverrideRequired: true,
      otcOrPrescription: "prescription",
    },
  };
}

describe("pharmacyControlledMedicine", () => {
  const prefs = { businessType: "pharmacy", kioskQuickSell: false, onboardingDone: true } as ShopPreferences;

  it("detects controlled products", () => {
    expect(isControlledProduct(controlledProduct())).toBe(true);
    expect(isControlledProduct({ ...controlledProduct(), pharmacyMaster: { controlledDrug: false } })).toBe(false);
  });

  it("flags quantity violations", () => {
    const product = controlledProduct(5);
    const line = {
      productId: "p1",
      name: "Morphine",
      inputMode: "quantity" as const,
      quantity: 12,
      unitPriceUgx: 1000,
      unitCostUgx: 500,
      lineTotalUgx: 12000,
      estimatedProfitUgx: 6000,
    };
    const info = buildControlledLineInfo(product, line);
    expect(info?.maxQuantity).toBe(5);
    const v = validateControlledDispense({
      lines: [line],
      products: [product],
      preferences: prefs,
      prescription: null,
      compliance: null,
    });
    expect(v.quantityViolations.length).toBe(1);
    expect(v.prescriptionRequiredBlocked).toBe(true);
  });

  it("passes when compliance approval present", () => {
    const product = controlledProduct(20);
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
    const v = validateControlledDispense({
      lines: [line],
      products: [product],
      preferences: { ...prefs, pharmacyCompliance: { witnessWorkflowEnabled: false } },
      prescription: { id: "rx1" } as never,
      compliance: {
        patientVerified: true,
        prescriptionVerified: true,
        managerApproved: true,
        approvedAt: new Date().toISOString(),
      },
    });
    expect(v.requiresGate).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildPharmacyExpiryPdfBlob,
  buildPharmacyMarginPdfBlob,
  pharmacyExpiryCsv,
  pharmacyMarginCsv,
} from "./pharmacyDocumentExports";
import type { Product } from "../types";

const med: Product = {
  id: "m1",
  name: "Paracetamol",
  sellingMode: "unit",
  category: "Medicine",
  sellingPricePerUnitUgx: 500,
  costPricePerUnitUgx: 300,
  stockOnHand: 20,
  baseUnit: "tab",
  minimumStockAlert: 5,
  sku: "MED-1",
  expiryDate: "2026-12-01",
  updatedAt: "2026-01-01",
  version: 1,
};

describe("pharmacyExport", () => {
  it("exports expiry CSV with header", () => {
    const csv = pharmacyExpiryCsv([med]);
    expect(csv).toContain("product,expiry_date");
  });

  it("exports margin CSV", () => {
    const csv = pharmacyMarginCsv([med]);
    expect(csv).toContain("Paracetamol");
  });

  it("builds expiry PDF", () => {
    const blob = buildPharmacyExpiryPdfBlob("en", [med]);
    expect(blob.size).toBeGreaterThan(300);
  });

  it("builds margin PDF", () => {
    const blob = buildPharmacyMarginPdfBlob("en", [med]);
    expect(blob.size).toBeGreaterThan(300);
  });
});

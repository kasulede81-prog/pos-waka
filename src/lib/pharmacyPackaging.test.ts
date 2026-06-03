import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import {
  baseUnitsPerBox,
  baseUnitsPerStrip,
  buildPharmacySaleLine,
  calcCostPerBaseUnitUgx,
  calcTotalBaseUnits,
  deriveBoxPriceUgx,
  deriveStripPriceUgx,
  formatPharmacyStockEquivalent,
  formatPharmacyStockPrimary,
  getPharmacyPackagingSellPresets,
  isPharmacyPackagingActive,
  lowStockThresholdBaseUnits,
  pharmacyLineProfitUgx,
  pharmacyRestockPreview,
  stockPackagingBreakdown,
} from "./pharmacyPackaging";

const amoxicillinPackaging = {
  enabled: true,
  baseUnit: "tablet",
  level1: { unit: "strip", containsBaseUnits: 10 },
  level2: { unit: "box", containsLevel1Units: 10 },
  sell: { tablet: true, strip: true, box: true },
  priceStripUgx: null,
  priceBoxUgx: null,
  batches: [],
};

function product(partial: Partial<Product> & { pharmacyPackaging?: Product["pharmacyPackaging"] }): Product {
  return {
    id: "p1",
    name: "Amoxicillin",
    sellingMode: "unit",
    baseUnit: "tablet",
    sellingPricePerUnitUgx: 300,
    costPricePerUnitUgx: 200,
    stockOnHand: 200,
    minimumStockAlert: 10,
    category: "Antibiotics",
    sku: "SKU-1",
    updatedAt: "",
    version: 1,
    ...partial,
  };
}

describe("calcTotalBaseUnits", () => {
  it("tablet-only: opening stock", () => {
    expect(calcTotalBaseUnits({ packaging: null, openingStockBase: 200 })).toBe(200);
  });

  it("box + strip: 2 boxes → 200 tablets", () => {
    expect(
      calcTotalBaseUnits({
        packaging: amoxicillinPackaging,
        receivedLevel2Qty: 2,
      }),
    ).toBe(200);
  });

  it("strip only: 20 strips × 10 tablets", () => {
    expect(
      calcTotalBaseUnits({
        packaging: {
          ...amoxicillinPackaging,
          level2: null,
        },
        receivedLevel1Qty: 20,
      }),
    ).toBe(200);
  });
});

describe("calcCostPerBaseUnitUgx", () => {
  it("40,000 invoice / 200 tablets = 200 UGX", () => {
    expect(calcCostPerBaseUnitUgx(40_000, 200)).toBe(200);
  });
});

describe("derived sell prices", () => {
  it("derives strip and box from tablet price", () => {
    expect(deriveStripPriceUgx(300, 10)).toBe(3000);
    expect(deriveBoxPriceUgx(300, 100)).toBe(30_000);
  });
});

describe("POS presets and profit", () => {
  const p = product({
    pharmacyPackaging: amoxicillinPackaging,
    stockOnHand: 200,
  });

  it("exposes tablet, strip, and box presets", () => {
    const presets = getPharmacyPackagingSellPresets(p);
    expect(presets.length).toBeGreaterThanOrEqual(3);
    expect(presets.find((x) => x.value === 1)).toBeTruthy();
    expect(presets.find((x) => x.value === 10)).toBeTruthy();
    expect(presets.find((x) => x.value === 100)).toBeTruthy();
  });

  it("strip sale deducts base units and profit uses base cost", () => {
    const stripPreset = getPharmacyPackagingSellPresets(p).find((x) => x.value === 10)!;
    const lineTotal = 2800;
    const profit = pharmacyLineProfitUgx(lineTotal, stripPreset.value, p);
    expect(profit).toBe(2800 - 10 * 200);
  });

  it("box sale uses 100 base units", () => {
    expect(baseUnitsPerBox(amoxicillinPackaging)).toBe(100);
    expect(baseUnitsPerStrip(amoxicillinPackaging)).toBe(10);
  });
});

describe("legacy medicines", () => {
  it("packaging disabled leaves legacy behavior", () => {
    const legacy = product({ pharmacyPackaging: null });
    expect(isPharmacyPackagingActive(legacy)).toBe(false);
    expect(getPharmacyPackagingSellPresets(legacy)).toEqual([]);
  });
});

describe("packaging disabled mode", () => {
  it("uses opening stock only", () => {
    expect(
      calcTotalBaseUnits({
        packaging: { ...amoxicillinPackaging, enabled: false },
        openingStockBase: 50,
      }),
    ).toBe(50);
  });
});

describe("restock by boxes", () => {
  it("3 boxes adds 300 tablets", () => {
    expect(
      calcTotalBaseUnits({
        packaging: amoxicillinPackaging,
        receivedLevel2Qty: 3,
      }),
    ).toBe(300);
  });

  it("restock preview shows strips and tablets", () => {
    const p = product({ pharmacyPackaging: amoxicillinPackaging });
    const preview = pharmacyRestockPreview(p, "box", 3, 60_000);
    expect(preview.baseUnitsAdded).toBe(300);
    expect(preview.costPerBaseUnitUgx).toBe(200);
    expect(preview.lines.some((l) => l.label === "box" && l.count === 3)).toBe(true);
  });
});

describe("stock display", () => {
  it("formats 200 tablets as 20 strips and 2 boxes", () => {
    const p = product({ pharmacyPackaging: amoxicillinPackaging, stockOnHand: 200 });
    expect(formatPharmacyStockPrimary(p)).toBe("200 Tablets");
    const equiv = formatPharmacyStockEquivalent(p);
    expect(equiv).toContain("20");
    expect(equiv).toContain("2");
  });

  it("low stock threshold in boxes converts to base units", () => {
    const p = product({
      pharmacyPackaging: { ...amoxicillinPackaging, lowStockAlertUnit: "box" },
      minimumStockAlert: 2,
      stockOnHand: 150,
    });
    expect(lowStockThresholdBaseUnits(p)).toBe(200);
    expect(stockPackagingBreakdown(p)?.boxCount).toBe(1.5);
  });
});

describe("buildPharmacySaleLine", () => {
  it("1 strip sale stores saleUnitType and base quantity", () => {
    const p = product({ pharmacyPackaging: amoxicillinPackaging });
    const built = buildPharmacySaleLine(p, "strip", 1);
    expect(built.line?.quantity).toBe(10);
    expect(built.line?.saleUnitType).toBe("strip");
    expect(built.line?.saleUnitQty).toBe(1);
    expect(built.line?.lineTotalUgx).toBe(3000);
  });
});

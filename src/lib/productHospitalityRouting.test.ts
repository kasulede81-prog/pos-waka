import { describe, expect, it } from "vitest";
import type { KitchenStation, Product } from "../types";
import {
  inferProductHospitalityRouting,
  resolveProductProductionStation,
  resolveStationForProduct,
} from "./productHospitalityRouting";

function product(partial: Partial<Product> & Pick<Product, "name" | "category">): Product {
  return {
    id: "p1",
    sellingMode: "unit",
    baseUnit: "ea",
    sellingPricePerUnitUgx: 5000,
    costPricePerUnitUgx: 2000,
    stockOnHand: 10,
    minimumStockAlert: 0,
    sku: "",
    updatedAt: new Date().toISOString(),
    version: 1,
    ...partial,
  };
}

const stations: KitchenStation[] = [
  { id: "k1", name: "Kitchen", stationType: "kitchen", sortOrder: 0, isActive: true },
  { id: "b1", name: "Bar", stationType: "bar", sortOrder: 1, isActive: true },
];

describe("productHospitalityRouting", () => {
  it("uses explicit productionStation when set", () => {
    const p = product({
      name: "Water",
      category: "Water",
      hospitality: { productionStation: "bar", routingAutoInferred: false },
    });
    expect(resolveProductProductionStation(p)).toBe("bar");
  });

  it("infers bar from drink category", () => {
    expect(resolveProductProductionStation(product({ name: "Nile Special", category: "Beer" }))).toBe("bar");
  });

  it("infers grill from chicken category", () => {
    expect(resolveProductProductionStation(product({ name: "Roast", category: "Chicken" }))).toBe("grill");
  });

  it("falls back to keyword routing when category unknown", () => {
    expect(resolveProductProductionStation(product({ name: "Gin & Tonic", category: "Specials" }))).toBe("bar");
  });

  it("resolves floor station with fallback when exact type missing", () => {
    const p = product({
      name: "Cake",
      category: "Desserts",
      hospitality: { productionStation: "dessert" },
    });
    const station = resolveStationForProduct(p, stations);
    expect(station?.stationType).toBe("kitchen");
  });

  it("inferProductHospitalityRouting marks auto inferred", () => {
    const inferred = inferProductHospitalityRouting(product({ name: "Fanta", category: "Soft Drinks" }));
    expect(inferred.productionStation).toBe("bar");
    expect(inferred.routingAutoInferred).toBe(true);
  });
});

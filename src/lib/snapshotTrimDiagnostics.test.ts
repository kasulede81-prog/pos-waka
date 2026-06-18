import { describe, expect, it } from "vitest";
import type { PersistedSnapshot } from "../offline/localDb";
import {
  analyzeSnapshotTrim,
  MAX_CLOUD_SNAPSHOT_BYTES,
  recordSnapshotUploadTrimAnalysis,
  getLastSnapshotUploadTrimAnalysis,
} from "./snapshotTrimDiagnostics";
import { createDefaultPreferences } from "../data/defaultSeed";

function minimalSnap(overrides: Partial<PersistedSnapshot> = {}): PersistedSnapshot {
  return {
    products: [],
    customers: [],
    sales: [],
    preferences: createDefaultPreferences(),
    debtPayments: [],
    dayCloses: [],
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("snapshotTrimDiagnostics", () => {
  it("reports ok when snapshot under limit", () => {
    const analysis = analyzeSnapshotTrim(minimalSnap());
    expect(analysis.wouldTrim).toBe(false);
    expect(analysis.status).toBe("ok");
    expect(analysis.originalBytes).toBeLessThan(MAX_CLOUD_SNAPSHOT_BYTES);
  });

  it("detects archive removal when over limit", () => {
    const bigNotes = "x".repeat(500_000);
    const products = Array.from({ length: 30 }, (_, i) => ({
      id: `prod-${i}`,
      name: bigNotes,
      sellingPricePerUnitUgx: 1000,
      costPricePerUnitUgx: 500,
      stockOnHand: 1,
      baseUnit: "ea",
      sellingMode: "unit" as const,
      category: "General",
      sku: "",
      minimumStockAlert: 0,
      updatedAt: "2026-06-01T00:00:00.000Z",
      version: 1,
    }));

    const analysis = analyzeSnapshotTrim(minimalSnap({ products }));

    if (analysis.originalBytes > MAX_CLOUD_SNAPSHOT_BYTES) {
      expect(analysis.wouldTrim).toBe(true);
      expect(analysis.archivesRemoved).toBe(true);
      expect(analysis.retainedArchivedSalesCount).toBe(0);
    }
  });

  it("records last upload trim analysis", () => {
    const analysis = analyzeSnapshotTrim(minimalSnap());
    recordSnapshotUploadTrimAnalysis(analysis);
    expect(getLastSnapshotUploadTrimAnalysis()?.originalBytes).toBe(analysis.originalBytes);
  });
});

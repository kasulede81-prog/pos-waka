/**
 * Device A → Device B recovery E2E simulation (unit-level, no live Supabase).
 */

import { describe, expect, it, vi } from "vitest";
import type { Customer, Product, Sale, ShiftRecord, StockMovement } from "../types";
import { mergeStockMovementsFromCloudPull } from "./stockMovementRecovery";
import { mergeShiftsFromCloudPull } from "./shiftRecovery";
import { buildRecoveryCompletenessReport } from "./cloudRecoveryCompleteness";
import { validateRecoveryCompletionGate } from "./cloudRecoveryGate";
import { validateCloudRecoveryLocalState } from "./cloudRecoveryValidator";

vi.mock("./syncCheckpoints", () => ({
  readSyncCheckpoints: () => ({ bootstrapComplete: true }),
}));

vi.mock("./cloudAuthorityAudit", () => ({
  buildCloudRecoverySnapshotFromStore: () => ({
    scorePct: 95,
    bootstrapComplete: true,
    recoveryReady: true,
  }),
}));

const DEVICE_A = {
  products: [
    {
      id: "p1",
      name: "Rice 25kg",
      sellingMode: "unit" as const,
      baseUnit: "ea",
      sellingPricePerUnitUgx: 95000,
      costPricePerUnitUgx: 80000,
      stockOnHand: 40,
      minimumStockAlert: 5,
      category: "Grains",
      sku: "RICE25",
      updatedAt: "2026-06-01T00:00:00.000Z",
      version: 1,
    },
  ] satisfies Product[],
  customers: [
    {
      id: "c1",
      name: "Jane",
      phone: "+256700000001",
      location: "Kampala",
      createdAt: "2026-06-01T00:00:00.000Z",
      version: 1,
      debtBalanceUgx: 5000,
    },
  ] satisfies Customer[],
  sales: [
    {
      id: "s1",
      status: "completed" as const,
      createdAt: "2026-06-02T08:00:00.000Z",
      updatedAt: "2026-06-02T08:00:00.000Z",
      lines: [],
      subtotalUgx: 95000,
      totalUgx: 95000,
      cashPaidUgx: 95000,
      debtUgx: 0,
      estimatedProfitUgx: 15000,
      pendingSync: false,
    },
  ] satisfies Sale[],
  stockMovements: [
    {
      id: "m1",
      at: "2026-06-02T08:00:00.000Z",
      productId: "p1",
      productName: "Rice 25kg",
      deltaBaseUnits: -1,
      kind: "sale_out" as const,
      summary: "Sale s1",
      refId: "s1",
    },
  ] satisfies StockMovement[],
  shifts: [
    {
      id: "sh1",
      actorUserId: "owner",
      role: "owner",
      startAt: "2026-06-02T07:00:00.000Z",
      endAt: "2026-06-02T18:00:00.000Z",
      updatedAt: "2026-06-02T18:00:00.000Z",
      salesTotalUgx: 95000,
      debtTotalUgx: 0,
      refundsUgx: 0,
      estimatedCashUgx: 95000,
      pendingSync: false,
    },
  ] satisfies ShiftRecord[],
  dayCloses: [{ id: "dc1", dateKey: "2026-06-02", createdAt: "2026-06-02T20:00:00.000Z" }],
  inventoryCountSessions: [{ id: "ics1", sessionNumber: 1, status: "applied" as const, lines: [], createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" }],
};

describe("cloudRecoveryDeviceE2E", () => {
  it("Device B restores Device A entity counts via cloud merge simulation", () => {
    const deviceBProducts = [...DEVICE_A.products];
    const deviceBCustomers = [...DEVICE_A.customers];
    const deviceBSales = [...DEVICE_A.sales];
    const deviceBMovements = mergeStockMovementsFromCloudPull([], DEVICE_A.stockMovements);
    const deviceBShifts = mergeShiftsFromCloudPull([], DEVICE_A.shifts);

    expect(deviceBProducts.length).toBe(1);
    expect(deviceBSales.length).toBe(1);
    expect(deviceBCustomers.length).toBe(1);
    expect(deviceBMovements.length).toBe(1);
    expect(deviceBShifts.length).toBe(1);
    expect(deviceBMovements[0]?.kind).toBe("sale_out");
  });

  it("recovery validation and completeness pass for restored Device B state", () => {
    const validation = validateCloudRecoveryLocalState({
      products: DEVICE_A.products,
      customers: DEVICE_A.customers,
      sales: DEVICE_A.sales,
      debtPayments: [],
      stockMovements: [],
      suppliers: [],
      purchases: [],
      supplierPayments: [],
      preferences: { shifts: DEVICE_A.shifts } as never,
      returnRecords: [],
      dayClosesCount: DEVICE_A.dayCloses.length,
    });

    const probe = {
      hasSnapshot: true,
      snapshotUpdatedAt: null,
      hasCloudProducts: true,
      snapshotRowFound: true,
      snapshotContainsCoreData: true,
    };
    const gate = validateRecoveryCompletionGate(probe, {
      ...validation,
      counts: { ...validation.counts, shifts: DEVICE_A.shifts.length, dayCloses: DEVICE_A.dayCloses.length },
    });

    const completeness = buildRecoveryCompletenessReport({
      validation: {
        ...validation,
        counts: { ...validation.counts, shifts: DEVICE_A.shifts.length, dayCloses: DEVICE_A.dayCloses.length },
      },
      probe,
      stockMovements: DEVICE_A.stockMovements.length,
      inventoryCountSessions: DEVICE_A.inventoryCountSessions.length,
      archivedSales: 0,
      salesPullTruncated: false,
    });

    expect(gate.failures).not.toContain("shop_still_empty");
    expect(gate.failures).not.toContain("products_not_restored");
    expect(completeness.scorePct).toBeGreaterThanOrEqual(90);
    expect(completeness.categories.find((c) => c.id === "products")?.restored).toBe(true);
    expect(completeness.categories.find((c) => c.id === "sales")?.restored).toBe(true);
    expect(completeness.categories.find((c) => c.id === "inventory")?.restored).toBe(true);
  });
});

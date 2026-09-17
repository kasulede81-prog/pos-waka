import { describe, expect, it, beforeEach } from "vitest";
import type { PharmacyPrescription, PharmacyPrescriptionLine, Product, SaleLine } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";

/**
 * WAKA POS — Pharmacy Correction Phase 1: partial prescription dispensing.
 *
 * Exercises the REAL usePosStore.finalizeDraftSale action end to end (not a
 * reimplementation) to prove:
 *   - quantityDispensed accumulates across separate checkout visits instead
 *     of being clobbered by Math.max (the confirmed bug).
 *   - status is derived from prescribed vs. dispensed, never forced to
 *     "dispensed" merely because a dispense occurred.
 *   - over-dispensing is rejected before the sale is created.
 *   - the prescription stays a clinical record with no independent
 *     financial ledger — the authoritative transaction is always the Sale
 *     produced by finalizeDraftSale.
 */

const PRODUCT_ID = "cccccccc-1111-4ccc-8ccc-cccccccccccc";
const RX_ID = "dddddddd-1111-4ddd-8ddd-dddddddddddd";
const RX_LINE_ID = "eeeeeeee-1111-4eee-8eee-eeeeeeeeeeee";

const amoxicillin: Product = {
  id: PRODUCT_ID,
  name: "Amoxicillin 500mg",
  sellingMode: "unit",
  baseUnit: "capsule",
  sellingPricePerUnitUgx: 500,
  costPricePerUnitUgx: 200,
  stockOnHand: 500,
  minimumStockAlert: 20,
  category: "Antibiotics",
  sku: "",
  updatedAt: "2026-06-01T08:00:00.000Z",
  version: 1,
  pharmacyMaster: { batchTracked: false, expiryTracked: false, otcOrPrescription: "prescription" },
};

function rxLine(overrides: Partial<PharmacyPrescriptionLine> = {}): PharmacyPrescriptionLine {
  return {
    id: RX_LINE_ID,
    productId: PRODUCT_ID,
    productName: "Amoxicillin 500mg",
    strength: "500mg",
    form: "capsule",
    quantityPrescribed: 21,
    quantityDispensed: 0,
    directions: "1 capsule 3x/day for 7 days",
    ...overrides,
  };
}

function prescription(overrides: Partial<PharmacyPrescription> = {}): PharmacyPrescription {
  return {
    id: RX_ID,
    prescriptionNumber: "RX-20260601-0001",
    type: "paper_rx",
    status: "verified",
    priority: "normal",
    patientId: null,
    patientName: "Test Patient",
    patientPhone: null,
    doctorName: "Dr. Test",
    diagnosis: null,
    notes: null,
    prescriptionDate: "2026-06-01",
    refillCount: 0,
    refillsUsed: 0,
    lastRefillAt: null,
    nextRefillEligibleAt: null,
    lines: [rxLine()],
    saleId: null,
    verifiedAt: "2026-06-01T08:00:00.000Z",
    verifiedByUserId: "owner-1",
    verifiedByName: "Owner",
    dispensedAt: null,
    dispensedByUserId: null,
    dispensedByName: null,
    controlledMedicinesApproved: false,
    controlledApprovalReason: null,
    createdAt: "2026-06-01T08:00:00.000Z",
    updatedAt: "2026-06-01T08:00:00.000Z",
    version: 1,
    pendingSync: true,
    ...overrides,
  };
}

function draftLine(quantity: number): SaleLine {
  return {
    id: `draft-${quantity}-${Math.random()}`,
    productId: PRODUCT_ID,
    name: "Amoxicillin 500mg",
    inputMode: "quantity",
    quantity,
    unitPriceUgx: 500,
    unitCostUgx: 200,
    lineTotalUgx: 500 * quantity,
    estimatedProfitUgx: 300 * quantity,
    updatedAt: "2026-06-01T09:00:00.000Z",
  };
}

function dispenseVisit(quantity: number, rx: PharmacyPrescription) {
  usePosStore.setState({
    products: usePosStore.getState().products,
    pharmacyPrescriptions: [rx],
    activePharmacyPrescriptionId: RX_ID,
    pharmacyDispenseMode: "prescription",
    draftLines: [draftLine(quantity)],
    draftCartDiscountUgx: 0,
  });
  return usePosStore.getState().finalizeDraftSale({
    debtUgx: 0,
    paymentMethod: "cash",
    amountPaidUgx: 500 * quantity,
  });
}

describe("Pharmacy Correction Phase 1 — partial prescription dispensing (real finalizeDraftSale)", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner-1", role: "owner", displayName: "Owner" },
      products: [{ ...amoxicillin }],
      customers: [],
      sales: [],
      pharmacyPrescriptions: [prescription()],
      preferences: {
        ...usePosStore.getState().preferences,
        businessType: "pharmacy",
        pharmacyModeEnabled: true,
      },
    });
    expect(openTestShift().ok).toBe(true);
  });

  it("A — first partial dispense: 10 of 21, status partially_dispensed, remaining 11", () => {
    const rx = usePosStore.getState().pharmacyPrescriptions[0]!;
    const r = dispenseVisit(10, rx);
    expect(r.ok).toBe(true);

    const updated = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === RX_ID)!;
    expect(updated.lines[0]!.quantityDispensed).toBe(10);
    expect(updated.status).toBe("partially_dispensed");
    const remaining = updated.lines[0]!.quantityPrescribed - updated.lines[0]!.quantityDispensed;
    expect(remaining).toBe(11);
  });

  it("B — second partial dispense: +5, cumulative 15, remaining 6", () => {
    let rx = usePosStore.getState().pharmacyPrescriptions[0]!;
    expect(dispenseVisit(10, rx).ok).toBe(true);
    rx = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === RX_ID)!;

    const r = dispenseVisit(5, rx);
    expect(r.ok).toBe(true);
    const updated = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === RX_ID)!;
    expect(updated.lines[0]!.quantityDispensed).toBe(15);
    expect(updated.status).toBe("partially_dispensed");
    expect(updated.lines[0]!.quantityPrescribed - updated.lines[0]!.quantityDispensed).toBe(6);
  });

  it("C — final dispense: +6, cumulative 21, remaining 0, status dispensed", () => {
    let rx = usePosStore.getState().pharmacyPrescriptions[0]!;
    expect(dispenseVisit(10, rx).ok).toBe(true);
    rx = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === RX_ID)!;
    expect(dispenseVisit(5, rx).ok).toBe(true);
    rx = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === RX_ID)!;

    const r = dispenseVisit(6, rx);
    expect(r.ok).toBe(true);
    const updated = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === RX_ID)!;
    expect(updated.lines[0]!.quantityDispensed).toBe(21);
    expect(updated.status).toBe("dispensed");
    expect(updated.lines[0]!.quantityPrescribed - updated.lines[0]!.quantityDispensed).toBe(0);
  });

  it("D — over-dispensing is rejected before the sale is created (22 of 21)", () => {
    const rx = usePosStore.getState().pharmacyPrescriptions[0]!;
    const before = usePosStore.getState().sales.length;
    const r = dispenseVisit(22, rx);
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("pharmacyRxOverDispense");
    expect(usePosStore.getState().sales).toHaveLength(before);
    // Prescription untouched by the rejected attempt.
    const unchanged = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === RX_ID)!;
    expect(unchanged.lines[0]!.quantityDispensed).toBe(0);
  });

  it("D2 — a second visit that would push the total over the prescribed amount is also rejected", () => {
    let rx = usePosStore.getState().pharmacyPrescriptions[0]!;
    expect(dispenseVisit(15, rx).ok).toBe(true);
    rx = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === RX_ID)!;

    const r = dispenseVisit(10, rx); // 15 + 10 = 25 > 21
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("pharmacyRxOverDispense");
    const unchanged = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === RX_ID)!;
    expect(unchanged.lines[0]!.quantityDispensed).toBe(15); // untouched by the rejected second attempt
  });

  it("E — multiple dispensing records (Sales) accumulate correctly and never exceed the prescribed quantity", () => {
    let rx = usePosStore.getState().pharmacyPrescriptions[0]!;
    dispenseVisit(10, rx);
    rx = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === RX_ID)!;
    dispenseVisit(5, rx);
    rx = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === RX_ID)!;
    dispenseVisit(6, rx);

    const sales = usePosStore.getState().sales;
    expect(sales).toHaveLength(3);
    const totalDispensedAcrossSales = sales.reduce((sum, s) => sum + (s.lines[0]?.quantity ?? 0), 0);
    expect(totalDispensedAcrossSales).toBe(21);
    const finalRx = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === RX_ID)!;
    expect(finalRx.lines[0]!.quantityDispensed).toBe(21);
    expect(finalRx.lines[0]!.quantityDispensed).toBeLessThanOrEqual(finalRx.lines[0]!.quantityPrescribed);
  });

  it("F — prescription remains a clinical record with no independent financial ledger", () => {
    const rx = usePosStore.getState().pharmacyPrescriptions[0]!;
    dispenseVisit(10, rx);
    const updated = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === RX_ID)!;
    // No revenue/COGS/profit/payment/debt field exists anywhere on the prescription or its lines.
    const moneyFields = ["totalUgx", "cashPaidUgx", "debtUgx", "cogsUgx", "grossProfitUgx", "estimatedProfitUgx", "netRevenueUgx"];
    for (const field of moneyFields) {
      expect(updated).not.toHaveProperty(field);
      expect(updated.lines[0]).not.toHaveProperty(field);
    }
  });

  it("G — dispensing links to the authoritative Sale via saleId / prescriptionId", () => {
    const rx = usePosStore.getState().pharmacyPrescriptions[0]!;
    const r = dispenseVisit(10, rx);
    expect(r.ok).toBe(true);
    const sale = usePosStore.getState().sales.find((s) => s.id === (r as { saleId: string }).saleId)!;
    expect(sale).toBeDefined();
    expect(sale.prescriptionId).toBe(RX_ID);
    const updatedRx = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === RX_ID)!;
    expect(updatedRx.saleId).toBe(sale.id);
  });

  it("K — historical SaleLine cost remains immutable after a later product cost edit", () => {
    const rx = usePosStore.getState().pharmacyPrescriptions[0]!;
    const r = dispenseVisit(10, rx);
    expect(r.ok).toBe(true);
    const sale = usePosStore.getState().sales.find((s) => s.id === (r as { saleId: string }).saleId)!;
    const cogsBefore = sale.lines[0]!.cogsUgx;
    expect(cogsBefore).toBe(2_000); // 10 * 200

    usePosStore.setState({
      products: usePosStore.getState().products.map((p) =>
        p.id === PRODUCT_ID ? { ...p, costPricePerUnitUgx: 9_999, sellingPricePerUnitUgx: 9_999 } : p,
      ),
    });

    const saleAfter = usePosStore.getState().sales.find((s) => s.id === sale.id)!;
    expect(saleAfter.lines[0]!.cogsUgx).toBe(cogsBefore);
    expect(saleAfter.lines[0]!.cogsUgx).toBe(2_000);
  });
});

import { describe, expect, it } from "vitest";
import type { PharmacyPrescription, PharmacyPrescriptionLine, Product } from "../types";
import { markPrescriptionDispensed, prescriptionToDraftLines } from "./pharmacyPrescriptionOps";

function line(overrides: Partial<PharmacyPrescriptionLine> = {}): PharmacyPrescriptionLine {
  return {
    id: "l1",
    productId: "p1",
    productName: "Amoxicillin 500mg",
    strength: "500mg",
    form: "capsule",
    quantityPrescribed: 21,
    quantityDispensed: 0,
    directions: "1 capsule 3x/day",
    batchOverrideId: null,
    batchNumber: null,
    batchExpiry: null,
    ...overrides,
  };
}

function rx(overrides: Partial<PharmacyPrescription> = {}): PharmacyPrescription {
  return {
    id: "rx1",
    prescriptionNumber: "RX-20260601-0001",
    type: "paper_rx",
    status: "dispensing",
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
    lines: [line()],
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

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
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
    ...overrides,
  };
}

describe("markPrescriptionDispensed — status derived, never forced", () => {
  it("keeps a partial cumulative quantity as-is and sets status partially_dispensed", () => {
    const prev = rx();
    const updatedLines = [line({ quantityDispensed: 10 })]; // caller already computed the cumulative value
    const result = markPrescriptionDispensed(prev, "sale-1", { userId: "u1", displayName: "Cashier" }, updatedLines);

    expect(result.lines[0]!.quantityDispensed).toBe(10); // NOT overwritten to 21
    expect(result.status).toBe("partially_dispensed");
    expect(result.saleId).toBe("sale-1");
  });

  it("sets status dispensed only once every line is fully covered", () => {
    const prev = rx();
    const updatedLines = [line({ quantityDispensed: 21 })];
    const result = markPrescriptionDispensed(prev, "sale-2", { userId: "u1" }, updatedLines);

    expect(result.lines[0]!.quantityDispensed).toBe(21);
    expect(result.status).toBe("dispensed");
  });

  it("falls back to prev.lines when no lines are supplied, still deriving status honestly", () => {
    const prev = rx({ lines: [line({ quantityDispensed: 5 })] });
    const result = markPrescriptionDispensed(prev, "sale-3", { userId: "u1" });
    expect(result.lines[0]!.quantityDispensed).toBe(5);
    expect(result.status).toBe("partially_dispensed");
  });

  it("a multi-line prescription stays partially_dispensed until every line is done", () => {
    const prev = rx({
      lines: [
        line({ id: "l1", quantityPrescribed: 21, quantityDispensed: 0 }),
        line({ id: "l2", productId: "p2", quantityPrescribed: 10, quantityDispensed: 0 }),
      ],
    });
    const partiallyUpdated = [
      { ...prev.lines[0]!, quantityDispensed: 21 },
      { ...prev.lines[1]!, quantityDispensed: 3 },
    ];
    const result = markPrescriptionDispensed(prev, "sale-4", { userId: "u1" }, partiallyUpdated);
    expect(result.status).toBe("partially_dispensed");
  });
});

describe("prescriptionToDraftLines — only the true remainder is offered, never a stuck floor of 1", () => {
  it("seeds a draft line for exactly the remaining quantity", () => {
    const rx1 = rx({ lines: [line({ quantityPrescribed: 21, quantityDispensed: 10 })] });
    const lines = prescriptionToDraftLines(rx1, [product()]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBe(11);
  });

  it("skips a line that is already fully dispensed instead of forcing a phantom quantity of 1", () => {
    const rx1 = rx({
      lines: [
        line({ id: "l1", quantityPrescribed: 21, quantityDispensed: 21 }), // done
        line({ id: "l2", productId: "p2", quantityPrescribed: 10, quantityDispensed: 4 }), // remainder 6
      ],
    });
    const lines = prescriptionToDraftLines(rx1, [product(), product({ id: "p2", name: "Ibuprofen" })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.productId).toBe("p2");
    expect(lines[0]!.quantity).toBe(6);
  });

  it("returns no lines once every line is fully dispensed", () => {
    const rx1 = rx({ lines: [line({ quantityPrescribed: 21, quantityDispensed: 21 })] });
    const lines = prescriptionToDraftLines(rx1, [product()]);
    expect(lines).toHaveLength(0);
  });
});

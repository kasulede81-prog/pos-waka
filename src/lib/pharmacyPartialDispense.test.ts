import { describe, expect, it, beforeEach } from "vitest";
import type { PharmacyPrescription, PharmacyPrescriptionLine, Product, SaleLine } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { appendBatchToProduct, computeBatchIntegrity, createBatchOnReceive, getProductBatches } from "./pharmacyBatches";

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

/**
 * WAKA POS — Pharmacy Phase 2: multi-batch dispensing, write-off, void/return
 * batch restoration, and offline structure — all through the REAL store
 * actions (finalizeDraftSale, writeOffExpiredStock, voidSaleLine).
 *
 * Worked example straight from the task brief: Amoxicillin, 20 capsules
 * prescribed. Batch A: 8 remaining, earlier expiry. Batch B: 30 remaining,
 * later expiry. Dispensing 15 must pull Batch A -> 8, Batch B -> 7, but
 * produce exactly ONE Sale/SaleLine with COGS computed once from the core
 * product cost — never two sales, never per-batch cost.
 */
const MB_PRODUCT_ID = "ffffffff-2222-4fff-8fff-ffffffffffff";
const MB_RX_ID = "11111111-2222-4111-8111-111111111111";
const MB_RX_LINE_ID = "22222222-2222-4222-8222-222222222222";
const BATCH_A_EXPIRY = "2027-01-01";
const BATCH_B_EXPIRY = "2027-06-01";
const RECEIVED_AT = "2026-01-01T00:00:00.000Z";

function multiBatchProduct(): Product {
  const base: Product = {
    id: MB_PRODUCT_ID,
    name: "Amoxicillin 500mg (batch-tracked)",
    sellingMode: "unit",
    baseUnit: "capsule",
    sellingPricePerUnitUgx: 500,
    costPricePerUnitUgx: 200,
    stockOnHand: 38, // Batch A (8) + Batch B (30)
    minimumStockAlert: 5,
    category: "Antibiotics",
    sku: "",
    updatedAt: RECEIVED_AT,
    version: 1,
    pharmacyMaster: { batchTracked: true, expiryTracked: true, otcOrPrescription: "prescription" },
  };
  let withBatches = appendBatchToProduct(
    base,
    createBatchOnReceive({ batchNumber: "A", expiryDate: BATCH_A_EXPIRY, quantityBase: 8, unitCostUgx: 200, at: RECEIVED_AT }),
  );
  withBatches = appendBatchToProduct(
    withBatches,
    createBatchOnReceive({ batchNumber: "B", expiryDate: BATCH_B_EXPIRY, quantityBase: 30, unitCostUgx: 200, at: RECEIVED_AT }),
  );
  return { ...withBatches, stockOnHand: 38 };
}

function mbRxLine(overrides: Partial<PharmacyPrescriptionLine> = {}): PharmacyPrescriptionLine {
  return {
    id: MB_RX_LINE_ID,
    productId: MB_PRODUCT_ID,
    productName: "Amoxicillin 500mg (batch-tracked)",
    strength: "500mg",
    form: "capsule",
    quantityPrescribed: 20,
    quantityDispensed: 0,
    directions: "1 capsule 3x/day",
    ...overrides,
  };
}

function mbPrescription(overrides: Partial<PharmacyPrescription> = {}): PharmacyPrescription {
  return {
    id: MB_RX_ID,
    prescriptionNumber: "RX-20260601-0002",
    type: "paper_rx",
    status: "verified",
    priority: "normal",
    patientId: null,
    patientName: "Test Patient 2",
    patientPhone: null,
    doctorName: "Dr. Test",
    diagnosis: null,
    notes: null,
    prescriptionDate: "2026-06-01",
    refillCount: 0,
    refillsUsed: 0,
    lastRefillAt: null,
    nextRefillEligibleAt: null,
    lines: [mbRxLine()],
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

function mbDraftLine(quantity: number): SaleLine {
  return {
    id: `mb-draft-${quantity}-${Math.random()}`,
    productId: MB_PRODUCT_ID,
    name: "Amoxicillin 500mg (batch-tracked)",
    inputMode: "quantity",
    quantity,
    unitPriceUgx: 500,
    unitCostUgx: 200,
    lineTotalUgx: 500 * quantity,
    estimatedProfitUgx: 300 * quantity,
    updatedAt: RECEIVED_AT,
  };
}

function mbDispenseVisit(quantity: number, rx: PharmacyPrescription) {
  usePosStore.setState({
    pharmacyPrescriptions: [rx],
    activePharmacyPrescriptionId: MB_RX_ID,
    pharmacyDispenseMode: "prescription",
    draftLines: [mbDraftLine(quantity)],
    draftCartDiscountUgx: 0,
  });
  return usePosStore.getState().finalizeDraftSale({
    debtUgx: 0,
    paymentMethod: "cash",
    amountPaidUgx: 500 * quantity,
  });
}

describe("Pharmacy Phase 2 — multi-batch dispensing, write-off, void/return, offline (real store actions)", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner-1", role: "owner", displayName: "Owner" },
      products: [multiBatchProduct()],
      customers: [],
      sales: [],
      pharmacyPrescriptions: [mbPrescription()],
      preferences: {
        ...usePosStore.getState().preferences,
        businessType: "pharmacy",
        pharmacyModeEnabled: true,
      },
    });
    expect(openTestShift().ok).toBe(true);
  });

  it("A/D — dispensing 15 pulls Batch A(8) + Batch B(7), one Sale, correct pooled COGS", () => {
    const r = mbDispenseVisit(15, usePosStore.getState().pharmacyPrescriptions[0]!);
    expect(r.ok).toBe(true);

    const product = usePosStore.getState().products.find((p) => p.id === MB_PRODUCT_ID)!;
    const batches = getProductBatches(product);
    expect(batches.find((b) => b.batchNumber === "A")!.quantityRemaining).toBe(0);
    expect(batches.find((b) => b.batchNumber === "B")!.quantityRemaining).toBe(23);
    expect(product.stockOnHand).toBe(23); // 38 - 15, core truth, independent of batch split

    // J/K — exactly one WAKA Sale, through finalizeDraftSale, financially whole.
    const sales = usePosStore.getState().sales;
    expect(sales).toHaveLength(1);
    expect(sales[0]!.lines).toHaveLength(1);

    // M — one pooled COGS from the core engine, not two batch-priced COGS entries.
    expect(sales[0]!.lines[0]!.quantity).toBe(15);
    expect(sales[0]!.lines[0]!.cogsUgx).toBe(3_000); // 15 * 200, one number, not per-batch
  });

  it("real allocation is captured on the SaleLine, not the stale add-to-cart preview (defect #2 fix)", () => {
    mbDispenseVisit(15, usePosStore.getState().pharmacyPrescriptions[0]!);
    const sale = usePosStore.getState().sales[0]!;
    // Primary (first) allocation for a 15-unit sale starting at Batch A is Batch A itself.
    expect(sale.lines[0]!.pharmacyBatchNumber).toBe("A");
    expect(sale.lines[0]!.pharmacyBatchExpiry).toBe(BATCH_A_EXPIRY);
  });

  it("batch dispense timeline event refId is the real Sale id, not the literal string \"draft\" (defect #1 fix)", () => {
    const r = mbDispenseVisit(15, usePosStore.getState().pharmacyPrescriptions[0]!);
    const saleId = (r as { saleId: string }).saleId;
    const product = usePosStore.getState().products.find((p) => p.id === MB_PRODUCT_ID)!;
    const batchA = getProductBatches(product).find((b) => b.batchNumber === "A")!;
    const dispensedEvent = batchA.timeline.find((e) => e.type === "dispensed")!;
    expect(dispensedEvent.refId).toBe(saleId);
    expect(dispensedEvent.refId).not.toBe("draft");
  });

  it("F — partial dispense (15) then completion (+5) correctly spans the boundary from Batch A into Batch B", () => {
    let rx = usePosStore.getState().pharmacyPrescriptions[0]!;
    expect(mbDispenseVisit(15, rx).ok).toBe(true);
    rx = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === MB_RX_ID)!;
    expect(rx.status).toBe("partially_dispensed");
    expect(rx.lines[0]!.quantityDispensed).toBe(15);

    expect(mbDispenseVisit(5, rx).ok).toBe(true);
    rx = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === MB_RX_ID)!;
    expect(rx.status).toBe("dispensed");
    expect(rx.lines[0]!.quantityDispensed).toBe(20);

    const product = usePosStore.getState().products.find((p) => p.id === MB_PRODUCT_ID)!;
    const batches = getProductBatches(product);
    expect(batches.find((b) => b.batchNumber === "A")!.quantityRemaining).toBe(0); // depleted at visit 1
    expect(batches.find((b) => b.batchNumber === "B")!.quantityRemaining).toBe(18); // 30 - 7 - 5
    expect(product.stockOnHand).toBe(18); // 38 - 20
    expect(computeBatchIntegrity(product).ok).toBe(true);
  });

  it("G — a third visit that would exceed the prescribed 20 is rejected, even mid-multi-batch", () => {
    let rx = usePosStore.getState().pharmacyPrescriptions[0]!;
    mbDispenseVisit(15, rx);
    rx = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === MB_RX_ID)!;
    mbDispenseVisit(5, rx);
    rx = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === MB_RX_ID)!;

    const salesBefore = usePosStore.getState().sales.length;
    const r = mbDispenseVisit(1, rx); // already fully dispensed (20/20)
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("pharmacyRxOverDispense");
    expect(usePosStore.getState().sales).toHaveLength(salesBefore); // no phantom third sale
  });

  it("N — write-off never touches Sale/revenue, and never creates a fabricated sale", () => {
    const product = usePosStore.getState().products[0]!;
    const batchA = getProductBatches(product).find((b) => b.batchNumber === "A")!;
    const salesBefore = usePosStore.getState().sales.length;

    const r = usePosStore.getState().writeOffExpiredStock({
      productId: MB_PRODUCT_ID,
      quantity: 3,
      reason: "damaged",
      batchId: batchA.id,
      note: "dropped tray",
    });
    expect(r.ok).toBe(true);

    // No Sale of any kind was created by a write-off.
    expect(usePosStore.getState().sales).toHaveLength(salesBefore);
    const after = usePosStore.getState().products.find((p) => p.id === MB_PRODUCT_ID)!;
    expect(after.stockOnHand).toBe(35); // 38 - 3
    expect(getProductBatches(after).find((b) => b.batchNumber === "A")!.quantityRemaining).toBe(5); // 8 - 3

    // The core inventory movement mechanism recorded it — not a payment/Sale.
    const movement = usePosStore.getState().stockMovements.find((m) => m.productId === MB_PRODUCT_ID);
    expect(movement?.kind).toBe("adjust_expired_writeoff");
  });

  it("O — voiding a dispensed line restores both core stock AND the specific batch it came from, never fabricating quantity", () => {
    let rx = usePosStore.getState().pharmacyPrescriptions[0]!;
    mbDispenseVisit(15, rx); // Batch A -> 0, Batch B -> 23, stockOnHand -> 23
    rx = usePosStore.getState().pharmacyPrescriptions.find((p) => p.id === MB_RX_ID)!;
    mbDispenseVisit(5, rx); // Batch B -> 18, stockOnHand -> 18 (all 5 from B, since A is depleted)

    const secondSale = usePosStore.getState().sales.find((s) => s.lines[0]!.quantity === 5)!;
    expect(secondSale.lines[0]!.pharmacyBatchNumber).toBe("B"); // confirms the fix #2 assertion holds here too

    const voidResult = usePosStore.getState().voidSaleLine({
      saleId: secondSale.id,
      lineIndex: 0,
      reason: "other",
      note: "test void",
    });
    expect(voidResult.ok).toBe(true);

    const product = usePosStore.getState().products.find((p) => p.id === MB_PRODUCT_ID)!;
    expect(product.stockOnHand).toBe(23); // 18 + 5, core reversal, always correct
    const batches = getProductBatches(product);
    expect(batches.find((b) => b.batchNumber === "B")!.quantityRemaining).toBe(23); // 18 + 5, restored to the SAME batch it came from
    expect(batches.find((b) => b.batchNumber === "A")!.quantityRemaining).toBe(0); // untouched — void never touches an unrelated batch
    // Total quantity is conserved exactly — nothing fabricated, nothing lost.
    expect(computeBatchIntegrity(product).ok).toBe(true);
  });

  it("Q — a pharmacy sale carries the same pendingSync/offline-outbox shape as any other sale (no separate pharmacy path)", () => {
    const r = mbDispenseVisit(15, usePosStore.getState().pharmacyPrescriptions[0]!);
    expect(r.ok).toBe(true);
    const sale = usePosStore.getState().sales[0]!;
    expect(sale.pendingSync).toBe(true); // enters the exact same outbox/sync-queue path every sale does
    expect(sale.status).toBe("completed");
  });

  it("P — a strip/box pack-converted pharmacy product still deducts stock and computes COGS via the shared core formula", () => {
    // Pharmacy packaging bridges to the same core conversionRate/buyingPackCostUgx
    // fields costPrecision.ts already uses for retail pack-priced products —
    // no separate pharmacy conversion-to-cost formula exists.
    const packProductId = "33333333-4444-4333-8333-333333333333";
    const packProduct: Product = {
      id: packProductId,
      name: "Paracetamol strip (10 tablets)",
      sellingMode: "unit",
      baseUnit: "tablet",
      buyingUnit: "strip",
      conversionRate: 10,
      sellingPricePerUnitUgx: 300,
      costPricePerUnitUgx: 150, // = buyingPackCostUgx / conversionRate = 1500 / 10
      buyingPackCostUgx: 1_500,
      stockOnHand: 100,
      minimumStockAlert: 10,
      category: "Analgesics",
      sku: "",
      updatedAt: RECEIVED_AT,
      version: 1,
      pharmacyMaster: { batchTracked: false, expiryTracked: false, otcOrPrescription: "otc" },
    };
    usePosStore.setState({
      products: [packProduct],
      pharmacyPrescriptions: [],
      activePharmacyPrescriptionId: null,
      pharmacyDispenseMode: "otc",
      draftLines: [
        {
          id: "pack-line-1",
          productId: packProductId,
          name: packProduct.name,
          inputMode: "quantity",
          quantity: 6,
          unitPriceUgx: 300,
          unitCostUgx: 150,
          lineTotalUgx: 1_800,
          estimatedProfitUgx: 900,
          updatedAt: RECEIVED_AT,
        },
      ],
      draftCartDiscountUgx: 0,
    });
    const r = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash", amountPaidUgx: 1_800 });
    expect(r.ok).toBe(true);
    const sale = usePosStore.getState().sales[0]!;
    expect(sale.lines[0]!.quantity).toBe(6);
    expect(sale.lines[0]!.cogsUgx).toBe(900); // 6 tablets * 150 UGX/tablet (1,500/10), correct conversion
    const product = usePosStore.getState().products.find((p) => p.id === packProductId)!;
    expect(product.stockOnHand).toBe(94); // 100 - 6 base units (tablets), not 6 strips
  });
});

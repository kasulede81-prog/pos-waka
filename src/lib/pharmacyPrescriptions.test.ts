import { describe, expect, it } from "vitest";
import type { Customer, PharmacyPrescription, PharmacyPrescriptionLine } from "../types";
import {
  activePrescriptionQueue,
  canTransitionPrescriptionStatus,
  computeNextRefillDate,
  derivePrescriptionDispenseStatus,
  isPrescriptionFullyDispensed,
  isPrescriptionPartiallyDispensed,
  isRefillEligible,
  mergePrescriptionLww,
  normalizePrescription,
  prescriptionLineRemaining,
  prescriptionRemainingTotal,
  remainingRefills,
  searchPrescriptions,
} from "./pharmacyPrescriptions";

function line(overrides: Partial<PharmacyPrescriptionLine> = {}): PharmacyPrescriptionLine {
  return {
    id: "l1",
    productId: "p1",
    productName: "Paracetamol 500mg",
    strength: "500mg",
    form: "tablet",
    quantityPrescribed: 20,
    quantityDispensed: 0,
    directions: "1 tablet twice daily",
    batchOverrideId: null,
    batchNumber: null,
    batchExpiry: null,
    ...overrides,
  };
}

function rx(overrides: Partial<PharmacyPrescription> = {}): PharmacyPrescription {
  return {
    id: "rx1",
    prescriptionNumber: "RX-20260706-0001",
    type: "paper_rx",
    status: "draft",
    priority: "normal",
    patientId: "c1",
    patientName: "Jane Doe",
    patientPhone: "0700123456",
    doctorName: "Dr. Smith",
    diagnosis: null,
    notes: null,
    prescriptionDate: "2026-07-06",
    refillCount: 2,
    refillsUsed: 0,
    lastRefillAt: null,
    nextRefillEligibleAt: null,
    lines: [line()],
    saleId: null,
    verifiedAt: null,
    verifiedByUserId: null,
    verifiedByName: null,
    dispensedAt: null,
    dispensedByUserId: null,
    dispensedByName: null,
    controlledMedicinesApproved: false,
    controlledApprovalReason: null,
    createdAt: "2026-07-06T10:00:00.000Z",
    updatedAt: "2026-07-06T10:00:00.000Z",
    version: 1,
    pendingSync: true,
    ...overrides,
  };
}

describe("pharmacyPrescriptions", () => {
  it("allows valid status transitions and blocks invalid ones", () => {
    expect(canTransitionPrescriptionStatus("draft", "waiting_verification")).toBe(true);
    expect(canTransitionPrescriptionStatus("waiting_verification", "verified")).toBe(true);
    expect(canTransitionPrescriptionStatus("dispensed", "draft")).toBe(false);
    expect(canTransitionPrescriptionStatus("archived", "draft")).toBe(false);
  });

  it("normalizes partial prescription payloads", () => {
    const normalized = normalizePrescription({
      id: "rx-abc",
      type: "emergency",
      status: "unknown",
      lines: [{ id: "l1", productId: "p1", quantityPrescribed: 5 }],
    });
    expect(normalized?.type).toBe("emergency");
    expect(normalized?.status).toBe("draft");
    expect(normalized?.lines).toHaveLength(1);
    expect(normalized?.lines[0]?.quantityPrescribed).toBe(5);
  });

  it("searches by patient, doctor, and medicine", () => {
    const customers: Customer[] = [
      {
        id: "c1",
        name: "Jane Doe",
        phone: "0700123456",
        location: "",
        createdAt: "",
        version: 1,
        debtBalanceUgx: 0,
      },
    ];
    const list = [
      rx({ id: "a", prescriptionNumber: "RX-AAA", patientId: "c1" }),
      rx({
        id: "b",
        patientId: "c2",
        patientName: "Other",
        doctorName: "Dr. Alpha",
        lines: [line({ productName: "Ibuprofen" })],
      }),
    ];
    expect(searchPrescriptions(list, "jane", customers).map((r) => r.id)).toEqual(["a"]);
    expect(searchPrescriptions(list, "alpha", customers).map((r) => r.id)).toEqual(["b"]);
    expect(searchPrescriptions(list, "ibuprofen", customers).map((r) => r.id)).toEqual(["b"]);
  });

  it("orders active queue with urgent first", () => {
    const queue = activePrescriptionQueue([
      rx({ id: "a", status: "verified", priority: "normal", updatedAt: "2026-07-06T12:00:00.000Z" }),
      rx({ id: "b", status: "waiting_verification", priority: "urgent", updatedAt: "2026-07-06T09:00:00.000Z" }),
      rx({ id: "c", status: "dispensed" }),
    ]);
    expect(queue.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("tracks refill eligibility and remaining counts", () => {
    const dispensed = rx({
      status: "dispensed",
      refillCount: 3,
      refillsUsed: 1,
      dispensedAt: "2026-06-01T10:00:00.000Z",
      nextRefillEligibleAt: "2026-06-15",
    });
    expect(remainingRefills(dispensed)).toBe(2);
    expect(isRefillEligible(dispensed, new Date("2026-06-20"))).toBe(true);
    expect(isRefillEligible(dispensed, new Date("2026-06-10"))).toBe(false);
    expect(computeNextRefillDate(dispensed, 30)).toBe("2026-07-01");
  });

  it("merges prescriptions last-write-wins by version then updatedAt", () => {
    const local = rx({ version: 2, updatedAt: "2026-07-06T11:00:00.000Z", notes: "local" });
    const remoteNewer = rx({ version: 3, updatedAt: "2026-07-06T12:00:00.000Z", notes: "remote" });
    const remoteOlder = rx({ version: 1, updatedAt: "2026-07-06T13:00:00.000Z", notes: "old remote" });
    expect(mergePrescriptionLww(local, remoteNewer).notes).toBe("remote");
    expect(mergePrescriptionLww(local, remoteOlder).notes).toBe("local");
  });
});

/**
 * WAKA POS — Pharmacy Correction Phase 1: partial-dispensing status derivation.
 *
 * INCIDENT: quantityDispensed was updated with Math.max(prior, thisVisit)
 * instead of accumulating, and the prescription was unconditionally stamped
 * "dispensed" the moment any dispense event touched it — even when most of
 * the prescribed quantity remained. These tests lock in the corrected,
 * purely-derived status logic (quantityPrescribed vs. quantityDispensed),
 * independent of the store action that calls it.
 */
describe("partial dispensing — status derivation", () => {
  it("prescriptionLineRemaining never goes negative even if dispensed somehow exceeds prescribed", () => {
    expect(prescriptionLineRemaining(line({ quantityPrescribed: 21, quantityDispensed: 10 }))).toBe(11);
    expect(prescriptionLineRemaining(line({ quantityPrescribed: 21, quantityDispensed: 21 }))).toBe(0);
    expect(prescriptionLineRemaining(line({ quantityPrescribed: 21, quantityDispensed: 25 }))).toBe(0);
  });

  it("prescriptionRemainingTotal sums remaining across all lines", () => {
    const rx1 = rx({
      lines: [
        line({ id: "l1", quantityPrescribed: 21, quantityDispensed: 10 }),
        line({ id: "l2", productId: "p2", quantityPrescribed: 10, quantityDispensed: 10 }),
      ],
    });
    expect(prescriptionRemainingTotal(rx1)).toBe(11);
  });

  it("isPrescriptionFullyDispensed / isPrescriptionPartiallyDispensed classify correctly", () => {
    const notStarted = [line({ quantityPrescribed: 21, quantityDispensed: 0 })];
    const partial = [line({ quantityPrescribed: 21, quantityDispensed: 10 })];
    const full = [line({ quantityPrescribed: 21, quantityDispensed: 21 })];

    expect(isPrescriptionFullyDispensed(notStarted)).toBe(false);
    expect(isPrescriptionPartiallyDispensed(notStarted)).toBe(false); // nothing dispensed yet

    expect(isPrescriptionFullyDispensed(partial)).toBe(false);
    expect(isPrescriptionPartiallyDispensed(partial)).toBe(true);

    expect(isPrescriptionFullyDispensed(full)).toBe(true);
    expect(isPrescriptionPartiallyDispensed(full)).toBe(false);
  });

  it("a multi-line prescription is only fully dispensed once every line is covered", () => {
    const mixed = [
      line({ id: "l1", quantityPrescribed: 21, quantityDispensed: 21 }),
      line({ id: "l2", productId: "p2", quantityPrescribed: 10, quantityDispensed: 4 }),
    ];
    expect(isPrescriptionFullyDispensed(mixed)).toBe(false);
    expect(isPrescriptionPartiallyDispensed(mixed)).toBe(true);
    expect(derivePrescriptionDispenseStatus(mixed)).toBe("partially_dispensed");

    const bothDone = [
      line({ id: "l1", quantityPrescribed: 21, quantityDispensed: 21 }),
      line({ id: "l2", productId: "p2", quantityPrescribed: 10, quantityDispensed: 10 }),
    ];
    expect(derivePrescriptionDispenseStatus(bothDone)).toBe("dispensed");
  });

  it("dispensing/ready/partially_dispensed can all transition into partially_dispensed and back", () => {
    expect(canTransitionPrescriptionStatus("dispensing", "partially_dispensed")).toBe(true);
    expect(canTransitionPrescriptionStatus("ready", "partially_dispensed")).toBe(true);
    expect(canTransitionPrescriptionStatus("partially_dispensed", "dispensing")).toBe(true);
    expect(canTransitionPrescriptionStatus("partially_dispensed", "dispensed")).toBe(true);
    expect(canTransitionPrescriptionStatus("partially_dispensed", "cancelled")).toBe(true);
    // A partially-dispensed rx must never be a dead end.
    expect(canTransitionPrescriptionStatus("dispensed", "partially_dispensed")).toBe(false);
  });

  it("a partially_dispensed prescription stays in the active/working queue", () => {
    const queue = activePrescriptionQueue([
      rx({ id: "a", status: "partially_dispensed", updatedAt: "2026-07-06T12:00:00.000Z" }),
      rx({ id: "b", status: "dispensed" }),
    ]);
    expect(queue.map((r) => r.id)).toEqual(["a"]);
  });
});

import { describe, expect, it } from "vitest";
import type { Customer, PharmacyPrescription, PharmacyPrescriptionLine } from "../types";
import {
  activePrescriptionQueue,
  canTransitionPrescriptionStatus,
  computeNextRefillDate,
  isRefillEligible,
  mergePrescriptionLww,
  normalizePrescription,
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

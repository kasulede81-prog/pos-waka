/**
 * POST-AUDIT-03 — pharmacy collections must arm the incremental persist scheduler.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type {
  PharmacyControlledRegisterEntry,
  PharmacyDoctor,
  PharmacyPrescription,
} from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";
import { entityKey } from "../offline/entityStore";
import { persistRelevantUnchanged, usePosStore, type PosState } from "../store/usePosStore";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function doctor(id: string, extra: Partial<PharmacyDoctor> = {}): PharmacyDoctor {
  return {
    id,
    name: extra.name ?? `Dr. ${id}`,
    clinic: extra.clinic ?? "Kampala Clinic",
    phone: extra.phone ?? null,
    registrationNumber: extra.registrationNumber ?? null,
    notes: extra.notes ?? null,
    createdAt: extra.createdAt ?? "2026-09-06T08:00:00.000Z",
    updatedAt: extra.updatedAt ?? "2026-09-06T08:00:00.000Z",
    version: extra.version ?? 1,
    pendingSync: extra.pendingSync ?? false,
    ...extra,
  };
}

function prescription(id: string): PharmacyPrescription {
  return {
    id,
    prescriptionNumber: `RX-${id}`,
    type: "paper_rx",
    status: "draft",
    priority: "normal",
    patientId: "c1",
    patientName: "Jane Doe",
    patientPhone: "0700123456",
    doctorName: "Dr. Smith",
    diagnosis: null,
    notes: null,
    prescriptionDate: "2026-09-06",
    refillCount: 0,
    refillsUsed: 0,
    lastRefillAt: null,
    nextRefillEligibleAt: null,
    lines: [],
    saleId: null,
    verifiedAt: null,
    verifiedByUserId: null,
    verifiedByName: null,
    dispensedAt: null,
    dispensedByUserId: null,
    dispensedByName: null,
    controlledMedicinesApproved: false,
    controlledApprovalReason: null,
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:00:00.000Z",
    version: 1,
    pendingSync: false,
  };
}

function registerEntry(id: string): PharmacyControlledRegisterEntry {
  return {
    id,
    kind: "dispense",
    at: "2026-09-06T10:00:00.000Z",
    businessDate: "2026-09-06",
    productId: "p-ctrl",
    productName: "Diazepam 5mg",
    quantity: 2,
    immutable: true,
    createdAt: "2026-09-06T10:00:00.000Z",
  };
}

function baseState(): PosState {
  usePosStore.getState().resetForSignOut();
  usePosStore.getState().hydrateEssentials({
    products: [],
    customers: [],
    preferences: createDefaultPreferences(),
  });
  return usePosStore.getState();
}

function withPatch(base: PosState, patch: Partial<PosState>): PosState {
  return { ...base, ...patch };
}

afterEach(() => {
  usePosStore.getState().resetForSignOut();
});

describe("POST-AUDIT-03 pharmacy persist scheduling gate", () => {
  it("TEST 1 — doctor-only mutation is no longer classified as unchanged", () => {
    const prev = baseState();
    const next = withPatch(prev, { pharmacyDoctors: [doctor("doc-1")] });
    expect(prev.products).toBe(next.products);
    expect(prev.sales).toBe(next.sales);
    expect(prev.auditLogs).toBe(next.auditLogs);
    expect(prev.pharmacyDoctors).not.toBe(next.pharmacyDoctors);
    expect(persistRelevantUnchanged(prev, next)).toBe(false);
  });

  it("TEST 2 — prescription-only mutation is no longer classified as unchanged", () => {
    const prev = baseState();
    const next = withPatch(prev, { pharmacyPrescriptions: [prescription("rx-1")] });
    expect(prev.auditLogs).toBe(next.auditLogs);
    expect(prev.pharmacyPrescriptions).not.toBe(next.pharmacyPrescriptions);
    expect(persistRelevantUnchanged(prev, next)).toBe(false);
  });

  it("TEST 3 — controlled-register-only mutation is no longer classified as unchanged", () => {
    const prev = baseState();
    const next = withPatch(prev, { pharmacyControlledRegister: [registerEntry("reg-1")] });
    expect(prev.products).toBe(next.products);
    expect(prev.sales).toBe(next.sales);
    expect(prev.stockMovements).toBe(next.stockMovements);
    expect(prev.pharmacyControlledRegister).not.toBe(next.pharmacyControlledRegister);
    expect(persistRelevantUnchanged(prev, next)).toBe(false);
  });

  it("TEST 4 — unchanged pharmacy references keep the skip-persist result", () => {
    const prev = baseState();
    const next = withPatch(prev, {});
    expect(next.pharmacyDoctors).toBe(prev.pharmacyDoctors);
    expect(next.pharmacyPrescriptions).toBe(prev.pharmacyPrescriptions);
    expect(next.pharmacyControlledRegister).toBe(prev.pharmacyControlledRegister);
    expect(persistRelevantUnchanged(prev, next)).toBe(true);
    expect(persistRelevantUnchanged(prev, prev)).toBe(true);
  });

  it("TEST 5 — same doctor id with a new array reference is detected", () => {
    const prevDoc = doctor("doc-1", { name: "Dr. Old" });
    const prev = withPatch(baseState(), { pharmacyDoctors: [prevDoc] });
    const next = withPatch(prev, {
      pharmacyDoctors: [doctor("doc-1", { name: "Dr. New", version: 2 })],
    });
    expect(next.pharmacyDoctors[0]?.id).toBe(prev.pharmacyDoctors[0]?.id);
    expect(next.pharmacyDoctors[0]?.name).toBe("Dr. New");
    expect(next.pharmacyDoctors).not.toBe(prev.pharmacyDoctors);
    expect(persistRelevantUnchanged(prev, next)).toBe(false);
  });

  it("TEST 6 — existing watched collections still gate persistence", () => {
    const prev = baseState();
    expect(persistRelevantUnchanged(prev, withPatch(prev, { products: [...prev.products] }))).toBe(false);
    expect(persistRelevantUnchanged(prev, withPatch(prev, { customers: [...prev.customers] }))).toBe(false);
    expect(persistRelevantUnchanged(prev, withPatch(prev, { sales: [...prev.sales] }))).toBe(false);
    expect(persistRelevantUnchanged(prev, withPatch(prev, { stockMovements: [...prev.stockMovements] }))).toBe(
      false,
    );
    expect(persistRelevantUnchanged(prev, withPatch(prev, { cashExpenses: [...prev.cashExpenses] }))).toBe(false);
    expect(persistRelevantUnchanged(prev, withPatch(prev, { auditLogs: [...prev.auditLogs] }))).toBe(false);
    expect(persistRelevantUnchanged(prev, withPatch(prev, {}))).toBe(true);
  });

  it("detects the original Rx set, not only a later audit set", () => {
    const s0 = baseState();
    const s1 = withPatch(s0, { pharmacyPrescriptions: [prescription("rx-audit")] });
    expect(persistRelevantUnchanged(s0, s1)).toBe(false);

    const s2 = withPatch(s1, {
      auditLogs: [
        {
          id: "audit-1",
          at: "2026-09-06T10:00:00.000Z",
          deviceId: "dev-1",
          actorUserId: "staff-1",
          actorName: "Amina",
          role: "cashier",
          action: "pharmacy_prescription_created",
          payloadSummary: "RX-rx-audit",
          payload: {},
        },
        ...s1.auditLogs,
      ],
    });
    expect(s2.pharmacyPrescriptions).toBe(s1.pharmacyPrescriptions);
    expect(persistRelevantUnchanged(s1, s2)).toBe(false);
    expect(persistRelevantUnchanged(s0, s2)).toBe(false);
  });
});

describe("POST-AUDIT-03 scheduler and writer contracts", () => {
  it("TEST 7 — incremental persist still writes the three pharmacy buckets", () => {
    const persistSrc = src("src/offline/incrementalPersist.ts");
    expect(persistSrc).toContain('persistArrayDelta(\n    "pharmacyDoctor"');
    expect(persistSrc).toContain('persistArrayDelta(\n    "pharmacyPrescription"');
    expect(persistSrc).toContain('persistArrayDelta(\n    "pharmacyControlledRegister"');
  });

  it("subscribe still schedules persist only through persistRelevantUnchanged", () => {
    const storeSrc = src("src/store/usePosStore.ts");
    const gate = storeSrc.indexOf("export function persistRelevantUnchanged");
    const subscribe = storeSrc.indexOf("usePosStore.subscribe((state, prev) => {");
    const skip = storeSrc.indexOf("if (prev && persistRelevantUnchanged(prev, state)) return;", subscribe);
    const schedule = storeSrc.indexOf("schedulePersist(prev ?? state, state);", subscribe);
    expect(gate).toBeGreaterThan(0);
    expect(skip).toBeGreaterThan(subscribe);
    expect(schedule).toBeGreaterThan(skip);
    expect(storeSrc).toContain("a.pharmacyDoctors === b.pharmacyDoctors");
    expect(storeSrc).toContain("a.pharmacyPrescriptions === b.pharmacyPrescriptions");
    expect(storeSrc).toContain("a.pharmacyControlledRegister === b.pharmacyControlledRegister");
  });

  it("does not change account-scoped pharmacyDoctor keys", () => {
    expect(entityKey("sb:shop-a", "pharmacyDoctor", "doc-1")).toBe("sb:shop-a::pharmacyDoctor::doc-1");
    expect(entityKey("sb:shop-b", "pharmacyDoctor", "doc-1")).toBe("sb:shop-b::pharmacyDoctor::doc-1");
    expect(entityKey("sb:shop-a", "pharmacyDoctor", "doc-1")).not.toBe(
      entityKey("sb:shop-b", "pharmacyDoctor", "doc-1"),
    );
  });

  it("does not add cloud sync or a second persist scheduler", () => {
    const storeSrc = src("src/store/usePosStore.ts");
    expect(storeSrc).not.toContain('queueRemote("pharmacyDoctor"');
    expect(storeSrc).not.toMatch(/setInterval\([^)]*pharmacy/);
    const kinds = src("src/types.ts");
    const kindBlock = kinds.slice(kinds.indexOf("export type SyncOperationKind"), kinds.indexOf("export type SyncOperation ="));
    expect(kindBlock).not.toContain("pharmacyDoctor");
    expect(kindBlock).not.toContain("pharmacy_doctor");
  });
});

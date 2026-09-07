/**
 * POST-AUDIT-07 — pharmacy collections survive snapshotFromPartial backup/export/restore.
 */
import { afterEach, describe, expect, it } from "vitest";
import type {
  PharmacyControlledRegisterEntry,
  PharmacyDoctor,
  PharmacyPrescription,
} from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";
import {
  buildExportEnvelope,
  parseImportEnvelope,
  snapshotFromPartial,
} from "../offline/backupEngine";
import type { PersistedSnapshot } from "../offline/localDb";
import { entityKey } from "../offline/entityStore";
import { usePosStore } from "../store/usePosStore";

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

function corePartial(extra: Partial<PersistedSnapshot> = {}): Partial<PersistedSnapshot> {
  return {
    products: [],
    customers: [],
    sales: [],
    preferences: createDefaultPreferences(),
    debtPayments: [],
    dayCloses: [],
    ...extra,
  };
}

afterEach(() => {
  usePosStore.getState().resetForSignOut();
});

describe("POST-AUDIT-07 snapshotFromPartial pharmacy parity", () => {
  it("TEST 1 — preserves pharmacyDoctors", () => {
    const doctors = [doctor("doc-1", { name: "Dr. Okello" })];
    const snap = snapshotFromPartial(corePartial({ pharmacyDoctors: doctors }));
    expect(snap?.pharmacyDoctors).toEqual(doctors);
  });

  it("TEST 2 — preserves pharmacyPrescriptions", () => {
    const rxs = [prescription("rx-1")];
    const snap = snapshotFromPartial(corePartial({ pharmacyPrescriptions: rxs }));
    expect(snap?.pharmacyPrescriptions).toEqual(rxs);
  });

  it("TEST 3 — preserves pharmacyControlledRegister", () => {
    const register = [registerEntry("reg-1")];
    const snap = snapshotFromPartial(corePartial({ pharmacyControlledRegister: register }));
    expect(snap?.pharmacyControlledRegister).toEqual(register);
  });

  it("TEST 4 — complete backup/export/restore representation keeps all three collections", () => {
    const doctors = [doctor("doc-rt")];
    const rxs = [prescription("rx-rt")];
    const register = [registerEntry("reg-rt")];
    const normalized = snapshotFromPartial(
      corePartial({
        pharmacyDoctors: doctors,
        pharmacyPrescriptions: rxs,
        pharmacyControlledRegister: register,
      }),
    );
    expect(normalized).not.toBeNull();
    const imported = parseImportEnvelope(JSON.stringify(buildExportEnvelope(normalized!)));
    expect(imported.snapshot.pharmacyDoctors).toEqual(doctors);
    expect(imported.snapshot.pharmacyPrescriptions).toEqual(rxs);
    expect(imported.snapshot.pharmacyControlledRegister).toEqual(register);

    usePosStore.getState().resetForSignOut();
    usePosStore.getState().hydrateEssentials({
      products: [],
      customers: [],
      preferences: createDefaultPreferences(),
    });
    usePosStore.getState().hydrateRemainder({
      pharmacyDoctors: imported.snapshot.pharmacyDoctors ?? [],
      pharmacyPrescriptions: imported.snapshot.pharmacyPrescriptions ?? [],
      pharmacyControlledRegister: imported.snapshot.pharmacyControlledRegister ?? [],
    });
    expect(usePosStore.getState().pharmacyDoctors.map((d) => d.id)).toEqual(["doc-rt"]);
    expect(usePosStore.getState().pharmacyPrescriptions.map((r) => r.id)).toEqual(["rx-rt"]);
    expect(usePosStore.getState().pharmacyControlledRegister.map((e) => e.id)).toEqual(["reg-rt"]);
  });

  it("TEST 5 — legacy backup without pharmacy fields stays empty, no phantom rows", () => {
    const legacy = snapshotFromPartial({
      products: [],
      customers: [],
      sales: [],
      preferences: createDefaultPreferences(),
    });
    expect(legacy).not.toBeNull();
    expect(legacy!.pharmacyDoctors).toEqual([]);
    expect(legacy!.pharmacyPrescriptions).toEqual([]);
    expect(legacy!.pharmacyControlledRegister).toEqual([]);

    const imported = parseImportEnvelope(JSON.stringify(buildExportEnvelope(legacy!)));
    usePosStore.getState().resetForSignOut();
    usePosStore.getState().hydrateEssentials({
      products: [],
      customers: [],
      preferences: createDefaultPreferences(),
    });
    usePosStore.getState().hydrateRemainder({
      pharmacyDoctors: imported.snapshot.pharmacyDoctors ?? [],
      pharmacyPrescriptions: imported.snapshot.pharmacyPrescriptions ?? [],
      pharmacyControlledRegister: imported.snapshot.pharmacyControlledRegister ?? [],
    });
    expect(usePosStore.getState().pharmacyDoctors).toEqual([]);
    expect(usePosStore.getState().pharmacyPrescriptions).toEqual([]);
    expect(usePosStore.getState().pharmacyControlledRegister).toEqual([]);
  });

  it("TEST 6 — unrelated backup fields remain intact", () => {
    const snap = snapshotFromPartial(
      corePartial({
        cashExpenses: [
          {
            id: "exp-keep",
            category: "ops",
            amountUgx: 1,
            description: "Keep",
            paidOn: "2026-09-06",
            createdAt: "2026-09-06T09:00:00.000Z",
            createdByUserId: "owner",
            pendingSync: false,
          },
        ],
        inventoryCountSessions: [{ id: "ics-1" } as NonNullable<PersistedSnapshot["inventoryCountSessions"]>[number]],
        archivedStockMovements: [{ id: "asm-1" } as NonNullable<PersistedSnapshot["archivedStockMovements"]>[number]],
        pharmacyDoctors: [doctor("doc-keep")],
      }),
    );
    expect(snap?.inventoryCountSessions).toHaveLength(1);
    expect(snap?.inventoryCountSessions?.[0]?.id).toBe("ics-1");
    expect(snap?.archivedStockMovements).toHaveLength(1);
    expect(snap?.archivedStockMovements?.[0]?.id).toBe("asm-1");
    expect(snap?.cashExpenses).toHaveLength(1);
    expect(snap?.cashExpenses?.[0]?.id).toBe("exp-keep");
    expect(snap?.pharmacyDoctors?.[0]?.id).toBe("doc-keep");
    expect(snap?.products).toEqual([]);
    expect(snap?.sales).toEqual([]);
  });

  it("TEST 7 — pharmacy backup keys stay account-scoped", () => {
    expect(entityKey("sb:shop-a", "pharmacyDoctor", "doc-1")).toBe("sb:shop-a::pharmacyDoctor::doc-1");
    expect(entityKey("sb:shop-b", "pharmacyDoctor", "doc-1")).toBe("sb:shop-b::pharmacyDoctor::doc-1");
    expect(entityKey("sb:shop-a", "pharmacyPrescription", "rx-1")).not.toBe(
      entityKey("sb:shop-b", "pharmacyPrescription", "rx-1"),
    );
    expect(entityKey("sb:shop-a", "pharmacyControlledRegister", "reg-1")).not.toBe(
      entityKey("sb:shop-b", "pharmacyControlledRegister", "reg-1"),
    );
  });
});

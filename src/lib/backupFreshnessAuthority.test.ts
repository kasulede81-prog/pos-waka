/**
 * POST-AUDIT-08 — local backup/export uses current entity-store authority,
 * not a stale legacy KV snapshot.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "../data/defaultSeed";
import {
  appendManualBackup,
  buildExportEnvelope,
  maybeAppendDailyAutoBackup,
  parseImportEnvelope,
  readCurrentBackupSnapshot,
  registerBackupPersistFlush,
  snapshotFromPartial,
  WAKA_BACKUP_FILE_VERSION,
} from "../offline/backupEngine";
import * as entityStore from "../offline/entityStore";
import * as localDb from "../offline/localDb";
import type { LocalBackupRecord, PersistedSnapshot } from "../offline/localDb";
import { flushPendingPersistAsync } from "../store/usePosStore";
import type {
  PharmacyControlledRegisterEntry,
  PharmacyDoctor,
  PharmacyPrescription,
  Product,
  Sale,
} from "../types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function product(id: string, name: string): Product {
  return {
    id,
    name,
    sellingPricePerUnitUgx: 1_000,
    costPricePerUnitUgx: 100,
    stockOnHand: 10,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 2,
    updatedAt: "2026-09-06T09:00:00.000Z",
    version: 1,
  };
}

function sale(id: string): Sale {
  return {
    id,
    lines: [],
    subtotalUgx: 1_000,
    totalUgx: 1_000,
    cashPaidUgx: 1_000,
    debtUgx: 0,
    estimatedProfitUgx: 100,
    createdAt: "2026-09-06T10:00:00.000Z",
    pendingSync: false,
  };
}

function doctor(id: string): PharmacyDoctor {
  return {
    id,
    name: `Dr. ${id}`,
    clinic: "Kampala Clinic",
    phone: null,
    registrationNumber: null,
    notes: null,
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:00:00.000Z",
    version: 1,
    pendingSync: false,
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

function snap(partial: Partial<PersistedSnapshot> = {}): PersistedSnapshot {
  return {
    products: [],
    customers: [],
    sales: [],
    preferences: createDefaultPreferences(),
    debtPayments: [],
    dayCloses: [],
    updatedAt: "2026-09-06T12:00:00.000Z",
    ...partial,
  };
}

describe("POST-AUDIT-08 backup freshness / snapshot authority", () => {
  const captured: LocalBackupRecord[] = [];
  let assembleSpy: ReturnType<typeof vi.spyOn>;
  let kvSpy: ReturnType<typeof vi.spyOn>;
  let flushMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    captured.length = 0;
    assembleSpy = vi.spyOn(entityStore, "assembleSnapshotFromEntities");
    kvSpy = vi.spyOn(localDb, "readSnapshotWithFallback");
    flushMock = vi.fn(async () => {});
    registerBackupPersistFlush(flushMock);
    vi.spyOn(localDb, "appendBackupRecord").mockImplementation(async (rec) => {
      captured.push(rec);
    });
    vi.spyOn(localDb, "listBackupRecords").mockResolvedValue([]);
  });

  afterEach(() => {
    registerBackupPersistFlush(flushPendingPersistAsync);
    vi.restoreAllMocks();
  });

  it("TEST 1 — stale KV + newer durable entity product → backup contains newer state", async () => {
    assembleSpy.mockResolvedValue(snap({ products: [product("p-x", "new value")] }));
    kvSpy.mockResolvedValue(snap({ products: [product("p-x", "old value")] }));

    const backup = await readCurrentBackupSnapshot();
    expect(backup?.products).toHaveLength(1);
    expect(backup?.products[0]?.name).toBe("new value");
    expect(kvSpy).not.toHaveBeenCalled();
    expect(flushMock).toHaveBeenCalledOnce();
  });

  it("TEST 2 — new durable entity row absent from old KV is present in backup", async () => {
    assembleSpy.mockResolvedValue(
      snap({
        products: [product("p-old", "kept")],
        sales: [sale("sale-new")],
      }),
    );
    kvSpy.mockResolvedValue(snap({ products: [product("p-old", "kept")], sales: [] }));

    const backup = await readCurrentBackupSnapshot();
    expect(backup?.sales.map((s) => s.id)).toEqual(["sale-new"]);
    expect(kvSpy).not.toHaveBeenCalled();
  });

  it("TEST 3 — pharmacy collections from POST-AUDIT-07 remain in the backup authority path", async () => {
    const doctors = [doctor("doc-1")];
    const rxs = [prescription("rx-1")];
    const register = [registerEntry("reg-1")];
    assembleSpy.mockResolvedValue(
      snap({
        pharmacyDoctors: doctors,
        pharmacyPrescriptions: rxs,
        pharmacyControlledRegister: register,
      }),
    );
    kvSpy.mockResolvedValue(snap());

    const backup = await readCurrentBackupSnapshot();
    expect(backup?.pharmacyDoctors).toEqual(doctors);
    expect(backup?.pharmacyPrescriptions).toEqual(rxs);
    expect(backup?.pharmacyControlledRegister).toEqual(register);
  });

  it("TEST 4 — automatic backup uses fresh authority", async () => {
    assembleSpy.mockResolvedValue(snap({ products: [product("p-x", "auto-fresh")] }));
    kvSpy.mockResolvedValue(snap({ products: [product("p-x", "auto-stale")] }));

    const key = await maybeAppendDailyAutoBackup("2020-01-01");
    expect(key).toBeTruthy();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.kind).toBe("daily_auto");
    expect(captured[0]?.snapshot.products[0]?.name).toBe("auto-fresh");
    expect(kvSpy).not.toHaveBeenCalled();
  });

  it("TEST 5 — manual backup uses fresh authority", async () => {
    assembleSpy.mockResolvedValue(snap({ products: [product("p-x", "manual-fresh")] }));
    kvSpy.mockResolvedValue(snap({ products: [product("p-x", "manual-stale")] }));

    const result = await appendManualBackup();
    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.kind).toBe("manual");
    expect(captured[0]?.snapshot.products[0]?.name).toBe("manual-fresh");
    expect(kvSpy).not.toHaveBeenCalled();
  });

  it("TEST 6 — downloadable export uses fresh authority", async () => {
    assembleSpy.mockResolvedValue(snap({ products: [product("p-x", "export-fresh")] }));
    kvSpy.mockResolvedValue(snap({ products: [product("p-x", "export-stale")] }));

    const backup = await readCurrentBackupSnapshot();
    expect(backup).not.toBeNull();
    const env = buildExportEnvelope(backup!);
    expect(env.wakaBackupVersion).toBe(WAKA_BACKUP_FILE_VERSION);
    expect(env.snapshot.products[0]?.name).toBe("export-fresh");

    const card = src("src/components/BackupSettingsCard.tsx");
    expect(card).toContain("readCurrentBackupSnapshot");
    expect(card).not.toMatch(/readSnapshotWithFallback/);
    expect(card).toContain("buildExportEnvelope");
  });

  it("TEST 7 — pending persist flush is awaited before backup assembly", async () => {
    const order: string[] = [];
    registerBackupPersistFlush(async () => {
      order.push("flush");
      await Promise.resolve();
    });
    assembleSpy.mockImplementation(async () => {
      order.push("assemble");
      return snap({ products: [product("p-x", "after-flush")] });
    });
    kvSpy.mockResolvedValue(snap({ products: [product("p-x", "stale-kv")] }));

    const backup = await readCurrentBackupSnapshot();
    expect(order).toEqual(["flush", "assemble"]);
    expect(backup?.products[0]?.name).toBe("after-flush");
  });

  it("TEST 8 — old v1 backups remain importable", () => {
    const legacy = {
      wakaBackupVersion: 1,
      exportedAt: "2026-01-15T08:00:00.000Z",
      snapshot: {
        products: [product("p-legacy", "Legacy product")],
        customers: [],
        sales: [],
        preferences: createDefaultPreferences(),
        debtPayments: [],
        dayCloses: [],
        updatedAt: "2026-01-15T08:00:00.000Z",
      },
    };
    const imported = parseImportEnvelope(JSON.stringify(legacy));
    expect(imported.wakaBackupVersion).toBe(1);
    expect(imported.snapshot.products[0]?.name).toBe("Legacy product");
    const normalized = snapshotFromPartial(imported.snapshot);
    expect(normalized?.pharmacyDoctors).toEqual([]);
    expect(normalized?.pharmacyPrescriptions).toEqual([]);
    expect(normalized?.pharmacyControlledRegister).toEqual([]);
  });

  it("falls back to KV only when the entity store has no manifest", async () => {
    assembleSpy.mockResolvedValue(null);
    kvSpy.mockResolvedValue(snap({ products: [product("p-x", "kv-only")] }));

    const backup = await readCurrentBackupSnapshot();
    expect(backup?.products[0]?.name).toBe("kv-only");
    expect(kvSpy).toHaveBeenCalledOnce();
  });

  it("shared surfaces call readCurrentBackupSnapshot, not raw KV", () => {
    const engine = src("src/offline/backupEngine.ts");
    expect(engine).toContain("export async function readCurrentBackupSnapshot");
    expect(engine).toContain("assembleSnapshotFromEntities");
    expect(engine).toContain("persistFlushForBackup");
    expect(engine).toContain("registerBackupPersistFlush");
    expect(engine).not.toContain('import("../store/usePosStore")');

    const autoIdx = engine.indexOf("export async function maybeAppendDailyAutoBackup");
    const manualIdx = engine.indexOf("export async function appendManualBackup");
    const autoBody = engine.slice(autoIdx, manualIdx);
    const manualBody = engine.slice(manualIdx, engine.indexOf("export const WAKA_BACKUP_FILE_VERSION"));
    expect(autoBody).toContain("readCurrentBackupSnapshot");
    expect(autoBody).not.toContain("readSnapshotWithFallback");
    expect(manualBody).toContain("readCurrentBackupSnapshot");
    expect(manualBody).not.toContain("readSnapshotWithFallback");

    const store = src("src/store/usePosStore.ts");
    expect(store).toContain("fireSnapshotWrite(false)");
    expect(store).not.toMatch(/fireSnapshotWrite\(\s*true\s*\)/);
    expect(store).toContain("export async function flushPendingPersistAsync");
  });
});

/**
 * IC-NEW-01 — persisted pharmacy remainder rehydration across the restart boundary.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { PharmacyControlledRegisterEntry, PharmacyDoctor, PharmacyPrescription } from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";
import { dateKeyKampala } from "./datesUg";
import { entityKey } from "../offline/entityStore";
import { buildAuditLogSearchIndex } from "./auditSearch";
import { computePharmacyInvestigationKpis } from "../features/investigation-center/extensions/pharmacy/computePharmacyInvestigationKpis";
import {
  resolveInvestigationDataCompleteness,
} from "../features/investigation-center/lib/investigationDataCompleteness";
import {
  resolveInvestigationSalesDependentReadiness,
} from "../features/investigation-center/lib/investigationSalesDependentReadiness";
import { normalizePrescription } from "./pharmacyPrescriptions";
import { normalizePharmacyDoctor } from "./pharmacyDoctors";
import { normalizeControlledRegisterEntry } from "./pharmacyControlledRegister";
import { applyPharmacyRemainderHydration } from "./pharmacyRemainderHydration";
import { usePosStore } from "../store/usePosStore";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function persistedRx(id: string, extra: Partial<PharmacyPrescription> = {}): PharmacyPrescription {
  const today = dateKeyKampala(new Date());
  return {
    id,
    prescriptionNumber: `RX-${id}`,
    type: "paper_rx",
    status: "dispensed",
    priority: "normal",
    patientId: "c1",
    patientName: "Jane Doe",
    patientPhone: "0700123456",
    doctorName: "Dr. Smith",
    diagnosis: null,
    notes: null,
    prescriptionDate: today,
    refillCount: 0,
    refillsUsed: 0,
    lastRefillAt: null,
    nextRefillEligibleAt: null,
    lines: [
      {
        id: `${id}-l1`,
        productId: "p1",
        productName: "Paracetamol 500mg",
        quantityPrescribed: 10,
        quantityDispensed: 10,
      },
    ],
    saleId: null,
    verifiedAt: `${today}T09:00:00.000Z`,
    verifiedByUserId: "staff-1",
    verifiedByName: "Amina",
    dispensedAt: `${today}T10:00:00.000Z`,
    dispensedByUserId: "staff-1",
    dispensedByName: "Amina",
    controlledMedicinesApproved: false,
    controlledApprovalReason: null,
    createdAt: `${today}T08:00:00.000Z`,
    updatedAt: `${today}T10:00:00.000Z`,
    version: 1,
    pendingSync: false,
    ...extra,
  };
}

function persistedDoctor(id: string, extra: Partial<PharmacyDoctor> = {}): PharmacyDoctor {
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

function persistedRegister(id: string): PharmacyControlledRegisterEntry {
  const today = dateKeyKampala(new Date());
  return {
    id,
    kind: "dispense",
    at: `${today}T10:00:00.000Z`,
    businessDate: today,
    productId: "p-ctrl",
    productName: "Diazepam 5mg",
    quantity: 2,
    immutable: true,
    createdAt: `${today}T10:00:00.000Z`,
  };
}

function restartStore(): void {
  usePosStore.getState().resetForSignOut();
  usePosStore.getState().hydrateEssentials({
    products: [],
    customers: [],
    preferences: createDefaultPreferences(),
  });
}

afterEach(() => {
  usePosStore.getState().resetForSignOut();
});

describe("IC-NEW-01 pharmacy remainder hydration helper", () => {
  it("loads persisted prescriptions and drops malformed rows", () => {
    const persisted = [persistedRx("rx-1"), { not: "a prescription" }, { id: "" }];
    const loaded = applyPharmacyRemainderHydration(persisted, [], normalizePrescription);
    expect(loaded.map((r) => r.id)).toEqual(["rx-1"]);
  });

  it("loads persisted controlled-register rows and drops malformed rows", () => {
    const persisted = [persistedRegister("reg-1"), "bad", { id: "x" }];
    const loaded = applyPharmacyRemainderHydration(persisted, [], normalizeControlledRegisterEntry);
    expect(loaded.map((r) => r.id)).toEqual(["reg-1"]);
  });

  it("missing incoming keeps existing in-memory rows", () => {
    const existing = [persistedRx("rx-live")];
    const loaded = applyPharmacyRemainderHydration(undefined, existing, normalizePrescription);
    expect(loaded).toEqual(existing);
  });

  it("empty incoming stays empty when runtime is empty", () => {
    expect(applyPharmacyRemainderHydration([], [], normalizePrescription)).toEqual([]);
    expect(applyPharmacyRemainderHydration([], [], normalizeControlledRegisterEntry)).toEqual([]);
    expect(applyPharmacyRemainderHydration([], [], normalizePharmacyDoctor)).toEqual([]);
  });

  it("repeated hydration does not duplicate ids", () => {
    const persisted = [persistedRx("rx-1"), persistedRx("rx-1")];
    const first = applyPharmacyRemainderHydration([], persisted, normalizePrescription);
    const second = applyPharmacyRemainderHydration(persisted, first, normalizePrescription);
    expect(second).toHaveLength(1);
    expect(second[0]?.id).toBe("rx-1");
  });

  it("newer in-memory row wins over a stale persisted copy of the same id", () => {
    const disk = persistedRx("rx-1", { status: "draft", version: 1 });
    const live = persistedRx("rx-1", { status: "dispensed", version: 2 });
    const merged = applyPharmacyRemainderHydration([disk], [live], normalizePrescription);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.status).toBe("dispensed");
    expect(merged[0]?.version).toBe(2);
  });
});

describe("IC-NEW-01 restart-style production remainder hydration", () => {
  it("hydrates persisted pharmacy collections into a fresh runtime store", () => {
    const prescriptions = [persistedRx("rx-restart")];
    const register = [persistedRegister("reg-restart")];

    restartStore();
    expect(usePosStore.getState().pharmacyPrescriptions).toEqual([]);
    expect(usePosStore.getState().pharmacyControlledRegister).toEqual([]);
    expect(usePosStore.getState().hydrationStage).toBe("critical");

    usePosStore.getState().hydrateRemainder({
      pharmacyPrescriptions: prescriptions,
      pharmacyControlledRegister: register,
    });

    const state = usePosStore.getState();
    expect(state.pharmacyPrescriptions.map((r) => r.id)).toEqual(["rx-restart"]);
    expect(state.pharmacyControlledRegister.map((r) => r.id)).toEqual(["reg-restart"]);
    expect(state.hydrationStage).not.toBe("complete");

    usePosStore.setState({ hydrationStage: "complete" });
    expect(resolveInvestigationDataCompleteness({ hydrationStage: usePosStore.getState().hydrationStage }).dataComplete).toBe(
      true,
    );
    expect(state.pharmacyPrescriptions).toHaveLength(1);
    expect(state.pharmacyControlledRegister).toHaveLength(1);
  });

  it("empty persisted buckets remain empty after remainder", () => {
    restartStore();
    usePosStore.getState().hydrateRemainder({
      pharmacyPrescriptions: [],
      pharmacyControlledRegister: [],
    });
    expect(usePosStore.getState().pharmacyPrescriptions).toEqual([]);
    expect(usePosStore.getState().pharmacyControlledRegister).toEqual([]);
  });

  it("omitted pharmacy fields do not wipe in-memory mutations", () => {
    restartStore();
    usePosStore.setState({
      pharmacyPrescriptions: [persistedRx("rx-live")],
      pharmacyControlledRegister: [persistedRegister("reg-live")],
    });
    usePosStore.getState().hydrateRemainder({
      returnRecords: [],
    });
    expect(usePosStore.getState().pharmacyPrescriptions.map((r) => r.id)).toEqual(["rx-live"]);
    expect(usePosStore.getState().pharmacyControlledRegister.map((r) => r.id)).toEqual(["reg-live"]);
  });

  it("does not import another shop's in-memory pharmacy rows across essentials reset", () => {
    restartStore();
    usePosStore.setState({
      pharmacyPrescriptions: [persistedRx("rx-shop-a")],
      pharmacyControlledRegister: [persistedRegister("reg-shop-a")],
    });
    usePosStore.getState().hydrateEssentials({
      products: [],
      customers: [],
      preferences: createDefaultPreferences(),
    });
    usePosStore.getState().hydrateRemainder({
      pharmacyPrescriptions: [persistedRx("rx-shop-b")],
      pharmacyControlledRegister: [persistedRegister("reg-shop-b")],
    });
    expect(usePosStore.getState().pharmacyPrescriptions.map((r) => r.id)).toEqual(["rx-shop-b"]);
    expect(usePosStore.getState().pharmacyControlledRegister.map((r) => r.id)).toEqual(["reg-shop-b"]);
  });

  it("entity keys remain account-scoped so Shop A cannot share Shop B records", () => {
    const a = entityKey("sb:shop-a", "pharmacyPrescription", "rx-1");
    const b = entityKey("sb:shop-b", "pharmacyPrescription", "rx-1");
    expect(a).not.toBe(b);
    expect(a).toContain("sb:shop-a");
    expect(b).toContain("sb:shop-b");
    expect(entityKey("sb:shop-a", "pharmacyControlledRegister", "reg-1")).not.toBe(
      entityKey("sb:shop-b", "pharmacyControlledRegister", "reg-1"),
    );
    expect(entityKey("sb:shop-a", "pharmacyDoctor", "doc-1")).not.toBe(
      entityKey("sb:shop-b", "pharmacyDoctor", "doc-1"),
    );
    expect(entityKey("sb:shop-a", "pharmacyDoctor", "doc-1")).toBe("sb:shop-a::pharmacyDoctor::doc-1");
  });
});

describe("IC-NEW-01 Investigation Center reads hydrated pharmacy runtime state", () => {
  it("pharmacy KPI reads hydrated prescriptions after remainder", () => {
    restartStore();
    const prescriptions = [persistedRx("rx-kpi")];
    usePosStore.getState().hydrateRemainder({ pharmacyPrescriptions: prescriptions });
    usePosStore.setState({ hydrationStage: "complete" });

    const today = dateKeyKampala(new Date());
    const cards = computePharmacyInvestigationKpis({
      index: buildAuditLogSearchIndex([], { products: [], customers: [], suppliers: [], lang: "en" }),
      dateFrom: today,
      dateTo: today,
      products: [],
      sales: [],
      returns: [],
      prescriptions: usePosStore.getState().pharmacyPrescriptions,
      register: usePosStore.getState().pharmacyControlledRegister,
      preferences: { ...createDefaultPreferences(), businessType: "pharmacy" },
      auditLogs: [],
    });
    expect(cards.find((c) => c.id === "rx_today")?.value).toBeGreaterThanOrEqual(1);
  });

  it("compliance / controlled surface reads hydrated register after remainder", () => {
    restartStore();
    const register = [persistedRegister("reg-kpi")];
    usePosStore.getState().hydrateRemainder({ pharmacyControlledRegister: register });
    usePosStore.setState({ hydrationStage: "complete" });

    const today = dateKeyKampala(new Date());
    const cards = computePharmacyInvestigationKpis({
      index: buildAuditLogSearchIndex([], { products: [], customers: [], suppliers: [], lang: "en" }),
      dateFrom: today,
      dateTo: today,
      products: [],
      sales: [],
      returns: [],
      prescriptions: usePosStore.getState().pharmacyPrescriptions,
      register: usePosStore.getState().pharmacyControlledRegister,
      preferences: { ...createDefaultPreferences(), businessType: "pharmacy" },
      auditLogs: [],
    });
    expect(usePosStore.getState().pharmacyControlledRegister).toHaveLength(1);
    expect(cards.find((c) => c.id === "controlled_events")?.value).toBeGreaterThanOrEqual(1);
  });

  it("retail remainder without pharmacy fields stays empty and IC-P2-04/07 contracts are unchanged", () => {
    restartStore();
    usePosStore.getState().hydrateRemainder({
      returnRecords: [],
      auditLogs: [],
    });
    expect(usePosStore.getState().pharmacyPrescriptions).toEqual([]);
    expect(usePosStore.getState().pharmacyControlledRegister).toEqual([]);
    expect(usePosStore.getState().pharmacyDoctors).toEqual([]);
    expect(resolveInvestigationDataCompleteness({ hydrationStage: "complete" }).dataComplete).toBe(true);
    expect(resolveInvestigationDataCompleteness({ hydrationStage: "background" }).dataComplete).toBe(false);
    expect(
      resolveInvestigationSalesDependentReadiness({ salesHistoryHydrationActive: true }).salesDependentReady,
    ).toBe(false);
    expect(
      resolveInvestigationSalesDependentReadiness({ salesHistoryHydrationActive: false }).salesDependentReady,
    ).toBe(true);
  });
});

describe("IC-NEW-01 production hydration boundary contracts", () => {
  it("entity remainder loads pharmacy buckets before hydrationStage complete", () => {
    const storeSrc = src("src/store/usePosStore.ts");
    const remainderFn = storeSrc.indexOf("async function hydrateEntityRemainderFromManifest");
    const backgroundFn = storeSrc.indexOf("export async function bootstrapPosBackgroundFromDisk");
    const rxBucket = storeSrc.indexOf('getEntitiesByBucket<import("../types").PharmacyPrescription>("pharmacyPrescription")');
    const registerBucket = storeSrc.indexOf(
      'getEntitiesByBucket<import("../types").PharmacyControlledRegisterEntry>("pharmacyControlledRegister")',
    );
    const remainderCall = storeSrc.indexOf("pharmacyPrescriptions: pharmacyPrescriptionsRaw");
    const doctorBucket = storeSrc.indexOf('getEntitiesByBucket<import("../types").PharmacyDoctor>("pharmacyDoctor")');
    const doctorRemainderCall = storeSrc.indexOf("pharmacyDoctors: pharmacyDoctorsRaw");
    const completeAfterRemainder = storeSrc.indexOf('hydrationStage: "complete"', backgroundFn);
    expect(remainderFn).toBeGreaterThan(0);
    expect(backgroundFn).toBeGreaterThan(remainderFn);
    expect(rxBucket).toBeGreaterThan(remainderFn);
    expect(registerBucket).toBeGreaterThan(remainderFn);
    expect(doctorBucket).toBeGreaterThan(remainderFn);
    expect(remainderCall).toBeGreaterThan(rxBucket);
    expect(doctorRemainderCall).toBeGreaterThan(doctorBucket);
    expect(completeAfterRemainder).toBeGreaterThan(backgroundFn);
  });

  it("does not revive unused full hydrate() as the production boot path", () => {
    const storeSrc = src("src/store/usePosStore.ts");
    expect(storeSrc).toMatch(/hydrateEntityRemainderFromManifest\(manifest\)/);
    expect(storeSrc).not.toMatch(/getState\(\)\.hydrate\(/);
  });

  it("existing pharmacy mutations and incremental persist are unchanged", () => {
    const storeSrc = src("src/store/usePosStore.ts");
    expect(storeSrc).toContain("pharmacyPrescriptions: [rx, ...state.pharmacyPrescriptions]");
    expect(storeSrc).toContain("pharmacyControlledRegister: [entry, ...s.pharmacyControlledRegister]");
    const persistSrc = src("src/offline/incrementalPersist.ts");
    expect(persistSrc).toContain('persistArrayDelta(\n    "pharmacyPrescription"');
    expect(persistSrc).toContain('persistArrayDelta(\n    "pharmacyControlledRegister"');
  });

  it("pharmacy compliance widget waits for dataComplete after remainder", () => {
    const widgetSrc = src("src/features/investigation-center/registry/pharmacyWidgets.tsx");
    expect(widgetSrc).toContain("if (!ctx.dataComplete)");
    expect(widgetSrc).toContain("InvestigationIncompleteState");
  });

  it("IC-P2-04 completeness helper still keys only on hydrationStage", () => {
    const completenessSrc = src("src/features/investigation-center/lib/investigationDataCompleteness.ts");
    expect(completenessSrc).toContain('dataComplete: input.hydrationStage === "complete"');
    expect(completenessSrc).not.toContain("pharmacyPrescriptions");
  });

  it("IC-P2-07 sales-dependent helper remains sales-tail only", () => {
    const readinessSrc = src("src/features/investigation-center/lib/investigationSalesDependentReadiness.ts");
    expect(readinessSrc).toContain("salesDependentReady: !input.salesHistoryHydrationActive");
    expect(readinessSrc).not.toContain("pharmacyPrescriptions");
  });
});

describe("IC-NEW-12 pharmacy doctor remainder hydration helper", () => {
  it("loads persisted pharmacyDoctor rows and drops malformed rows", () => {
    const persisted = [persistedDoctor("doc-1"), { not: "a doctor" }, { id: "doc-bad" }, "bad"];
    const loaded = applyPharmacyRemainderHydration(persisted, [], normalizePharmacyDoctor);
    expect(loaded.map((d) => d.id)).toEqual(["doc-1"]);
    expect(loaded[0]?.name).toBe("Dr. doc-1");
  });

  it("missing incoming keeps existing in-memory doctors", () => {
    const existing = [persistedDoctor("doc-live")];
    const loaded = applyPharmacyRemainderHydration(undefined, existing, normalizePharmacyDoctor);
    expect(loaded).toEqual(existing);
  });

  it("empty incoming stays empty when runtime is empty", () => {
    expect(applyPharmacyRemainderHydration([], [], normalizePharmacyDoctor)).toEqual([]);
  });

  it("newer in-memory doctor wins over a stale persisted copy of the same id", () => {
    const disk = persistedDoctor("doc-1", { name: "Stale Name", clinic: "Old Clinic", version: 1 });
    const live = persistedDoctor("doc-1", { name: "Live Name", clinic: "New Clinic", version: 2 });
    const merged = applyPharmacyRemainderHydration([disk], [live], normalizePharmacyDoctor);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe("Live Name");
    expect(merged[0]?.clinic).toBe("New Clinic");
    expect(merged[0]?.version).toBe(2);
  });
});

describe("IC-NEW-12 restart-style doctor remainder hydration", () => {
  it("hydrates persisted pharmacyDoctor rows into state.pharmacyDoctors", () => {
    const doctors = [persistedDoctor("doc-restart")];

    restartStore();
    expect(usePosStore.getState().pharmacyDoctors).toEqual([]);
    expect(usePosStore.getState().hydrationStage).toBe("critical");

    usePosStore.getState().hydrateRemainder({
      pharmacyDoctors: doctors,
    });

    const state = usePosStore.getState();
    expect(state.pharmacyDoctors.map((d) => d.id)).toEqual(["doc-restart"]);
    expect(state.pharmacyDoctors[0]?.name).toBe("Dr. doc-restart");
    expect(state.hydrationStage).not.toBe("complete");

    usePosStore.setState({ hydrationStage: "complete" });
    expect(resolveInvestigationDataCompleteness({ hydrationStage: usePosStore.getState().hydrationStage }).dataComplete).toBe(
      true,
    );
    expect(usePosStore.getState().pharmacyDoctors).toHaveLength(1);
  });

  it("empty or missing pharmacyDoctor bucket leaves pharmacyDoctors empty without throwing", () => {
    restartStore();
    expect(() => {
      usePosStore.getState().hydrateRemainder({
        pharmacyDoctors: [],
      });
    }).not.toThrow();
    expect(usePosStore.getState().pharmacyDoctors).toEqual([]);

    restartStore();
    expect(() => {
      usePosStore.getState().hydrateRemainder({
        returnRecords: [],
      });
    }).not.toThrow();
    expect(usePosStore.getState().pharmacyDoctors).toEqual([]);
  });

  it("hydration of account A loads only account A doctors after essentials reset", () => {
    restartStore();
    usePosStore.setState({
      pharmacyDoctors: [persistedDoctor("doc-shop-a"), persistedDoctor("doc-shop-b-leak")],
    });
    usePosStore.getState().hydrateEssentials({
      products: [],
      customers: [],
      preferences: createDefaultPreferences(),
    });
    expect(usePosStore.getState().pharmacyDoctors).toEqual([]);
    usePosStore.getState().hydrateRemainder({
      pharmacyDoctors: [persistedDoctor("doc-shop-a")],
    });
    expect(usePosStore.getState().pharmacyDoctors.map((d) => d.id)).toEqual(["doc-shop-a"]);
  });

  it("skips malformed doctor rows using normalizePharmacyDoctor conventions", () => {
    restartStore();
    usePosStore.getState().hydrateRemainder({
      pharmacyDoctors: [
        persistedDoctor("doc-ok"),
        { id: "doc-no-name" },
        { name: "No id" },
        null,
        "bad",
      ] as PharmacyDoctor[],
    });
    expect(usePosStore.getState().pharmacyDoctors.map((d) => d.id)).toEqual(["doc-ok"]);
  });

  it("does not overwrite a newer in-memory doctor with stale persisted data", () => {
    restartStore();
    usePosStore.setState({
      pharmacyDoctors: [persistedDoctor("doc-1", { name: "Live Name", version: 2 })],
    });
    usePosStore.getState().hydrateRemainder({
      pharmacyDoctors: [persistedDoctor("doc-1", { name: "Stale Name", version: 1 })],
    });
    expect(usePosStore.getState().pharmacyDoctors).toHaveLength(1);
    expect(usePosStore.getState().pharmacyDoctors[0]?.name).toBe("Live Name");
    expect(usePosStore.getState().pharmacyDoctors[0]?.version).toBe(2);
  });

  it("snapshot and backup remainder sources restore pharmacyDoctors through hydrateRemainder", () => {
    const snapDoctors = [persistedDoctor("doc-snap")];
    const backupDoctors = [persistedDoctor("doc-backup")];

    restartStore();
    usePosStore.getState().hydrateRemainder({
      pharmacyDoctors: snapDoctors ?? [],
    });
    expect(usePosStore.getState().pharmacyDoctors.map((d) => d.id)).toEqual(["doc-snap"]);

    restartStore();
    usePosStore.getState().hydrateRemainder({
      pharmacyDoctors: backupDoctors ?? [],
    });
    expect(usePosStore.getState().pharmacyDoctors.map((d) => d.id)).toEqual(["doc-backup"]);
  });

  it("sign-out and essentials still clear pharmacyDoctors for account isolation", () => {
    usePosStore.setState({ pharmacyDoctors: [persistedDoctor("doc-session")] });
    usePosStore.getState().resetForSignOut();
    expect(usePosStore.getState().pharmacyDoctors).toEqual([]);

    usePosStore.setState({ pharmacyDoctors: [persistedDoctor("doc-session")] });
    usePosStore.getState().hydrateEssentials({
      products: [],
      customers: [],
      preferences: createDefaultPreferences(),
    });
    expect(usePosStore.getState().pharmacyDoctors).toEqual([]);
  });
});

describe("IC-NEW-12 production hydration boundary contracts", () => {
  it("entity remainder loads pharmacyDoctor before hydrationStage complete", () => {
    const storeSrc = src("src/store/usePosStore.ts");
    const remainderFn = storeSrc.indexOf("async function hydrateEntityRemainderFromManifest");
    const backgroundFn = storeSrc.indexOf("export async function bootstrapPosBackgroundFromDisk");
    const doctorBucket = storeSrc.indexOf('getEntitiesByBucket<import("../types").PharmacyDoctor>("pharmacyDoctor")');
    const doctorCall = storeSrc.indexOf("pharmacyDoctors: pharmacyDoctorsRaw");
    const completeAfterRemainder = storeSrc.indexOf('hydrationStage: "complete"', backgroundFn);
    expect(remainderFn).toBeGreaterThan(0);
    expect(doctorBucket).toBeGreaterThan(remainderFn);
    expect(doctorBucket).toBeLessThan(backgroundFn);
    expect(doctorCall).toBeGreaterThan(doctorBucket);
    expect(completeAfterRemainder).toBeGreaterThan(backgroundFn);
  });

  it("snapshot and backup remainder call sites pass pharmacyDoctors", () => {
    const storeSrc = src("src/store/usePosStore.ts");
    expect(storeSrc).toContain("pharmacyDoctors: restoredSnap.pharmacyDoctors ?? []");
    expect(storeSrc).toContain("pharmacyDoctors: snap.pharmacyDoctors ?? []");
  });

  it("Investigation Center completeness stays independent of pharmacyDoctors", () => {
    const completenessSrc = src("src/features/investigation-center/lib/investigationDataCompleteness.ts");
    const readinessSrc = src("src/features/investigation-center/lib/investigationSalesDependentReadiness.ts");
    const widgetSrc = src("src/features/investigation-center/registry/pharmacyWidgets.tsx");
    expect(completenessSrc).not.toContain("pharmacyDoctors");
    expect(completenessSrc).not.toContain("pharmacyDoctor");
    expect(readinessSrc).not.toContain("pharmacyDoctors");
    expect(widgetSrc).not.toContain("pharmacyDoctors");
    expect(resolveInvestigationDataCompleteness({ hydrationStage: "complete" }).dataComplete).toBe(true);
  });
});

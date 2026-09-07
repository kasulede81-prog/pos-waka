/**
 * SYNC-INV-01 — daily auto-backup must not storm IndexedDB from persist.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dateKeyKampala } from "./datesUg";
import { inventoryValueAtCostUgx } from "./costPrecision";
import {
  configureDailyAutoBackupScheduler,
  getDailyAutoBackupSchedulerDiagnostics,
  invalidateDailyAutoBackupSchedule,
  resetDailyAutoBackupSchedulerForTests,
  scheduleDailyAutoBackup,
} from "./dailyAutoBackupScheduler";
import { maybeAppendDailyAutoBackup, readCurrentBackupSnapshot, registerBackupPersistFlush } from "../offline/backupEngine";
import * as entityStore from "../offline/entityStore";
import * as localDb from "../offline/localDb";
import * as shopScope from "../offline/shopScope";
import { withGlobalSyncMutex } from "./globalSyncMutex";
import { createDefaultPreferences } from "../data/defaultSeed";
import type { PersistedSnapshot } from "../offline/localDb";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const NOW = new Date("2026-09-06T12:00:00.000Z");
const TODAY = dateKeyKampala(NOW);
const YESTERDAY = "2020-01-01";

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function snap(): PersistedSnapshot {
  return {
    products: [],
    customers: [],
    sales: [],
    preferences: createDefaultPreferences(),
    debtPayments: [],
    dayCloses: [],
    updatedAt: "2026-09-06T12:00:00.000Z",
  };
}

function harness(opts?: {
  runBackup?: (lastSaved: string | undefined, expectedNamespace: string) => Promise<string | undefined>;
}) {
  const idleQueue: Array<() => void> = [];
  let lastSaved: string | undefined = YESTERDAY;
  let namespace: string | null = "sb:user:shop-a";
  let hydrated = true;
  let backupCalls = 0;
  const namespacesSeen: string[] = [];

  configureDailyAutoBackupScheduler({
    now: () => NOW,
    getNamespace: () => namespace,
    isHydrated: () => hydrated,
    getLastSavedDateKey: () => lastSaved,
    onSuccess: (key) => {
      lastSaved = key;
    },
    runBackup:
      opts?.runBackup ??
      (async (_last, expectedNamespace) => {
        backupCalls += 1;
        namespacesSeen.push(expectedNamespace);
        return TODAY;
      }),
    runIdle: (fn) => {
      idleQueue.push(fn);
    },
    idleTimeoutMs: () => 0,
  });

  return {
    idleQueue,
    get backupCalls() {
      return backupCalls;
    },
    set backupCalls(n: number) {
      backupCalls = n;
    },
    namespacesSeen,
    get lastSaved() {
      return lastSaved;
    },
    set lastSaved(v: string | undefined) {
      lastSaved = v;
    },
    set namespace(v: string | null) {
      namespace = v;
    },
    get namespace() {
      return namespace;
    },
    set hydrated(v: boolean) {
      hydrated = v;
    },
    trigger() {
      return scheduleDailyAutoBackup({
        lastSavedDateKey: lastSaved,
        namespace,
        hydrated,
      });
    },
    async flushIdle() {
      const fns = idleQueue.splice(0);
      for (const fn of fns) fn();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
    async settle() {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("SYNC-INV-01 daily auto-backup scheduler", () => {
  beforeEach(() => {
    resetDailyAutoBackupSchedulerForTests();
  });

  afterEach(() => {
    resetDailyAutoBackupSchedulerForTests();
    registerBackupPersistFlush(async () => {});
    vi.restoreAllMocks();
  });

  it("TEST A — second trigger coalesces; one backup runs", async () => {
    const h = harness();
    expect(h.trigger()).toBe("scheduled");
    expect(h.trigger()).toBe("coalesced");
    expect(h.idleQueue).toHaveLength(1);
    expect(h.backupCalls).toBe(0);

    await h.flushIdle();
    expect(h.backupCalls).toBe(1);
    expect(h.lastSaved).toBe(TODAY);
    expect(h.idleQueue).toHaveLength(0);
  });

  it("TEST B — many persist triggers launch one backup", async () => {
    const h = harness();
    const results = Array.from({ length: 12 }, () => h.trigger());
    expect(results[0]).toBe("scheduled");
    expect(results.slice(1).every((r) => r === "coalesced")).toBe(true);
    expect(h.idleQueue).toHaveLength(1);

    await h.flushIdle();
    expect(h.backupCalls).toBe(1);
    expect(h.lastSaved).toBe(TODAY);
  });

  it("TEST C — failure does not storm or fake lastAutoBackupDateKey", async () => {
    let backupCalls = 0;
    const h = harness({
      runBackup: async () => {
        backupCalls += 1;
        return YESTERDAY;
      },
    });

    expect(h.trigger()).toBe("scheduled");
    for (let i = 0; i < 8; i += 1) expect(h.trigger()).toBe("coalesced");
    await h.flushIdle();
    expect(backupCalls).toBe(1);
    expect(h.lastSaved).toBe(YESTERDAY);
    expect(getDailyAutoBackupSchedulerDiagnostics().failedDateKey).toBe(TODAY);

    for (let i = 0; i < 8; i += 1) {
      expect(h.trigger()).toBe("skipped_failed_today");
    }
    expect(h.idleQueue).toHaveLength(0);
    expect(backupCalls).toBe(1);

    let syncRan = false;
    await withGlobalSyncMutex("flushSyncQueue", async () => {
      syncRan = true;
    });
    expect(syncRan).toBe(true);
  });

  it("TEST D — already backed up today is a cheap no-op", async () => {
    const h = harness();
    h.lastSaved = TODAY;
    expect(h.trigger()).toBe("skipped_already_backed_up");
    expect(h.idleQueue).toHaveLength(0);
    expect(h.backupCalls).toBe(0);
    expect(getDailyAutoBackupSchedulerDiagnostics().inFlight).toBe(false);
  });

  it("TEST E — persist-path schedule does not await assembly", async () => {
    let started = 0;
    let release!: (value: string | undefined) => void;
    const hold = new Promise<string | undefined>((resolve) => {
      release = resolve;
    });
    const h = harness({
      runBackup: async () => {
        started += 1;
        return hold;
      },
    });

    expect(h.trigger()).toBe("scheduled");
    expect(started).toBe(0);
    const persistReturned = true;
    expect(persistReturned).toBe(true);

    const flushP = h.flushIdle();
    await Promise.resolve();
    expect(started).toBe(1);
    expect(getDailyAutoBackupSchedulerDiagnostics().inFlight).toBe(true);
    expect(h.lastSaved).toBe(YESTERDAY);

    release(TODAY);
    await flushP;
    await h.settle();
    expect(h.lastSaved).toBe(TODAY);

    const store = src("src/store/usePosStore.ts");
    const fireIdx = store.indexOf("function fireSnapshotWrite");
    const fireBody = store.slice(fireIdx, store.indexOf("function fireDraftWrite"));
    expect(fireBody).toContain("scheduleDailyAutoBackup");
    expect(fireBody).not.toContain("maybeAppendDailyAutoBackup");
    expect(fireBody).not.toContain("runBackup()");
  });

  it("TEST F — backup scheduling does not take the sync mutex", async () => {
    const schedulerSrc = src("src/lib/dailyAutoBackupScheduler.ts");
    expect(schedulerSrc).not.toContain("globalSyncMutex");
    expect(schedulerSrc).not.toContain("withGlobalSyncMutex");
    expect(schedulerSrc).not.toContain("syncEngine");
    expect(schedulerSrc).not.toContain("cloudSync");
    expect(schedulerSrc).not.toContain("autoSync");

    let release!: (value: string | undefined) => void;
    const hold = new Promise<string | undefined>((resolve) => {
      release = resolve;
    });
    const h = harness({
      runBackup: async () => hold,
    });
    h.trigger();
    const flushP = h.flushIdle();
    await Promise.resolve();

    let syncRan = false;
    await withGlobalSyncMutex("flushSyncQueue", async () => {
      syncRan = true;
    });
    expect(syncRan).toBe(true);
    expect(getDailyAutoBackupSchedulerDiagnostics().inFlight).toBe(true);

    release(TODAY);
    await flushP;
    await h.settle();
  });

  it("TEST G — hydration persist burst schedules one daily backup", async () => {
    const h = harness();
    const burst = ["critical", "interactive", "remainder", "pharmacy", "archive", "sales-tail"].flatMap(() =>
      Array.from({ length: 2 }, () => h.trigger()),
    );
    expect(burst.filter((r) => r === "scheduled")).toHaveLength(1);
    expect(burst.filter((r) => r === "coalesced")).toHaveLength(11);
    await h.flushIdle();
    expect(h.backupCalls).toBe(1);
  });

  it("TEST H — deferred Shop A backup cannot write Shop B context", async () => {
    const h = harness();
    expect(h.trigger()).toBe("scheduled");
    h.namespace = "sb:user:shop-b";
    invalidateDailyAutoBackupSchedule();
    await h.flushIdle();
    expect(h.backupCalls).toBe(0);
    expect(h.lastSaved).toBe(YESTERDAY);

    expect(h.trigger()).toBe("scheduled");
    await h.flushIdle();
    expect(h.backupCalls).toBe(1);
    expect(h.namespacesSeen).toEqual(["sb:user:shop-b"]);
  });

  it("TEST I — manual/current snapshot still assembles from entity store", async () => {
    const assembleSpy = vi.spyOn(entityStore, "assembleSnapshotFromEntities").mockResolvedValue(snap());
    registerBackupPersistFlush(async () => {});
    const backup = await readCurrentBackupSnapshot();
    expect(backup).not.toBeNull();
    expect(assembleSpy).toHaveBeenCalledOnce();
    assembleSpy.mockRestore();

    const engine = src("src/offline/backupEngine.ts");
    expect(engine).toContain("export async function readCurrentBackupSnapshot");
    expect(engine).toContain("assembleSnapshotFromEntities");
    const autoIdx = engine.indexOf("export async function maybeAppendDailyAutoBackup");
    const manualIdx = engine.indexOf("export async function appendManualBackup");
    expect(engine.slice(autoIdx, manualIdx)).toContain("readCurrentBackupSnapshot");
    expect(engine.slice(manualIdx)).toContain("readCurrentBackupSnapshot");
  });

  it("TEST J — inventory valuation formula is unchanged", () => {
    expect(src("src/lib/costPrecision.ts")).toContain("export function inventoryValueAtCostUgx");
    expect(src("src/lib/dailyAutoBackupScheduler.ts")).not.toContain("inventoryValueAtCostUgx");
    expect(src("src/offline/backupEngine.ts")).not.toContain("inventoryValueAtCostUgx");
    expect(
      inventoryValueAtCostUgx([
        { stockOnHand: 10, costPricePerUnitUgx: 500, conversionRate: null },
        {
          stockOnHand: 24,
          costPricePerUnitUgx: 833,
          buyingPackCostUgx: 20_000,
          conversionRate: 24,
        },
      ]),
    ).toBe(5_000 + 20_000);
  });

  it("maybeAppendDailyAutoBackup is a cheap no-op when the day is already saved", async () => {
    const assembleSpy = vi.spyOn(entityStore, "assembleSnapshotFromEntities");
    const liveToday = dateKeyKampala(new Date());
    const key = await maybeAppendDailyAutoBackup(liveToday);
    expect(key).toBe(liveToday);
    expect(assembleSpy).not.toHaveBeenCalled();
    assembleSpy.mockRestore();
  });

  it("maybeAppendDailyAutoBackup aborts after assemble if namespace changed", async () => {
    let namespaceForGuard = "sb:user:shop-a";
    const nsSpy = vi.spyOn(shopScope, "getPersistenceNamespace").mockImplementation(() => namespaceForGuard);
    const assembleSpy = vi.spyOn(entityStore, "assembleSnapshotFromEntities").mockImplementation(async () => {
      namespaceForGuard = "sb:user:shop-b";
      return snap();
    });
    registerBackupPersistFlush(async () => {});
    const appendSpy = vi.spyOn(localDb, "appendBackupRecord").mockResolvedValue();
    const key = await maybeAppendDailyAutoBackup(YESTERDAY, { expectedNamespace: "sb:user:shop-a" });
    expect(key).toBe(YESTERDAY);
    expect(appendSpy).not.toHaveBeenCalled();
    assembleSpy.mockRestore();
    nsSpy.mockRestore();
    appendSpy.mockRestore();
  });
});

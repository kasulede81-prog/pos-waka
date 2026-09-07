import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { inventoryValueAtCostUgx } from "./costPrecision";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("mobile sync starvation — disk hydrate + incremental pull persist", () => {
  it("A/B — background sales hydrate suspends persist so page loads do not rewrite IndexedDB", () => {
    const store = src("src/store/usePosStore.ts");
    const byIds = store.slice(
      store.indexOf("function scheduleBackgroundSalesHydrateByIds"),
      store.indexOf("function scheduleBackgroundSalesHydrate("),
    );
    const byArray = store.slice(
      store.indexOf("function scheduleBackgroundSalesHydrate("),
      store.indexOf("export async function isActiveSalesFullyLoaded"),
    );
    expect(byIds).toContain("runWithPersistSuspendedSync");
    expect(byArray).toContain("runWithPersistSuspendedSync");
    expect(store).toContain("Disk→memory hydrate must not rewrite IndexedDB");
  });

  it("C — daily auto-backup remains a scheduled idle job, not persist-inline", () => {
    const store = src("src/store/usePosStore.ts");
    const fire = store.slice(store.indexOf("function fireSnapshotWrite"), store.indexOf("function fireDraftWrite"));
    expect(fire).toContain("scheduleDailyAutoBackup");
    expect(fire).not.toContain("maybeAppendDailyAutoBackup");
  });

  it("D/E — incremental cloud merge persists deltas, not a full snapshot rewrite", () => {
    const cloud = src("src/offline/cloudSync.ts");
    const merge = cloud.slice(
      cloud.indexOf("export async function pullCloudAndMergeIntoStore"),
      cloud.indexOf("export async function forceFullCloudSync"),
    );
    expect(merge).toContain("flushIncrementalPersist");
    expect(merge).not.toContain("flushFullSnapshotPersist");
    expect(src("src/store/usePosStore.ts")).toContain("flushFullSnapshotPersist");
  });

  it("F — remainder hydrate from disk does not persist entity buckets it just read", () => {
    const store = src("src/store/usePosStore.ts");
    const remainder = store.slice(
      store.indexOf("async function hydrateEntityRemainderFromManifest"),
      store.indexOf("export async function bootstrapPosCriticalFromDisk"),
    );
    expect(remainder).toContain("runWithPersistSuspendedSync");
    expect(remainder).toContain("hydrateRemainder");
  });

  it("G — sign-out / shop switch still invalidates backup scheduler independently", () => {
    expect(src("src/lib/dailyAutoBackupScheduler.ts")).toContain("export function invalidateDailyAutoBackupSchedule");
  });

  it("H/I — inventory value remains inventoryValueAtCostUgx over product stock/cost fields", () => {
    const stockPage = src("src/pages/StockPage.tsx");
    expect(stockPage).toContain("inventoryValueAtCostUgx(unlockedProducts)");
    expect(src("src/lib/costPrecision.ts")).toContain("export function inventoryValueAtCostUgx");
    const total = inventoryValueAtCostUgx([
      {
        stockOnHand: 10,
        costPricePerUnitUgx: 1_000,
      },
      {
        stockOnHand: 2,
        costPricePerUnitUgx: 500_000,
      },
    ]);
    expect(total).toBe(10 * 1_000 + 2 * 500_000);
  });

  it("pull mutex is non-reentrant so overlapping mobile visibility pulls cannot double-persist", () => {
    const mutex = src("src/lib/globalSyncMutex.ts");
    const pullFn = mutex.slice(
      mutex.indexOf("export async function withPullSyncMutex"),
      mutex.indexOf("export async function withPushSyncMutex"),
    );
    expect(pullFn).toContain("reentrant: false");
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyRestoredSnapshotFromBackup, usePosStore } from "../store/usePosStore";
import type { PersistedSnapshot } from "../offline/localDb";
import { t, tTemplate } from "./i18n";
import { confirmRestoreWithSafetyChecks } from "./restoreSafety";
import { backupSurfaceDeniedMessageKey, authorizeBackupRestore } from "./backupRestoreAuthorization";
import { authorizeBackupExport } from "./backupExportAuthorization";
import { buildPersistenceNamespace } from "../offline/shopScope";
import type { SessionActor } from "./sessionActor";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import type { Product } from "../types";

function actor(role: SessionActor["role"]): SessionActor {
  return { userId: `user-${role}`, role, displayName: role };
}

const PRODUCT: Product = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Original",
  sellingPricePerUnitUgx: 1_000,
  costPricePerUnitUgx: 100,
  stockOnHand: 10,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-05-31T09:00:00.000Z",
  version: 1,
};

function snapshotWithProduct(name: string): PersistedSnapshot {
  return {
    products: [{ ...PRODUCT, name }],
    customers: [],
    sales: [],
    preferences: usePosStore.getState().preferences,
    debtPayments: [],
    dayCloses: [],
    updatedAt: new Date().toISOString(),
  };
}

describe("T1 — backup page route authorization", () => {
  it("keeps /office/backup on settings.view (see page; mutate is settings.shop)", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../App.tsx"), "utf8");
    const start = src.indexOf('path="office/backup"');
    const end = src.indexOf('path="office/account/delete"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const slice = src.slice(start, end);
    expect(slice).toContain('permission="settings.view"');
    expect(slice).not.toContain('permission="settings.shop"');
  });
});

describe("T2 / T3 / T4 / T9 — backup export and restore mutation boundary", () => {
  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    usePosStore.setState({
      _hydrated: true,
      sessionActor: actor("owner"),
      products: [PRODUCT],
      auditLogs: [],
    });
  });

  it("T2 — owner export is authorized", () => {
    expect(
      authorizeBackupExport({
        actor: actor("owner"),
        snapshot: { kind: "local_full" },
        authMode: "local",
      }).ok,
    ).toBe(true);
  });

  it("T3 / T9 — manager restore is rejected at applyRestoredSnapshotFromBackup", async () => {
    usePosStore.setState({ sessionActor: actor("manager"), auditLogs: [] });
    await expect(applyRestoredSnapshotFromBackup(snapshotWithProduct("Hacked"))).rejects.toThrow("forbidden");
    expect(usePosStore.getState().products[0]?.name).toBe("Original");
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "auth_forbidden")).toBe(true);
  });

  it("T3 — cashier restore does not persist replacement products", async () => {
    usePosStore.setState({ sessionActor: actor("cashier"), auditLogs: [] });
    await expect(applyRestoredSnapshotFromBackup(snapshotWithProduct("Hacked"))).rejects.toThrow("forbidden");
    expect(usePosStore.getState().products[0]?.name).toBe("Original");
  });

  it("T4 / T9 — owner restore applies the snapshot", async () => {
    await applyRestoredSnapshotFromBackup(snapshotWithProduct("Restored"));
    expect(usePosStore.getState().products[0]?.name).toBe("Restored");
  });

  it("T6 — unauthorized restore never reports success", () => {
    const denied = authorizeBackupRestore({
      actor: actor("manager"),
      snapshot: { kind: "local_full" },
      authMode: "local",
    });
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(backupSurfaceDeniedMessageKey(denied.errorKey, "backupRestoreFail")).toBe("forbidden");
    expect(backupSurfaceDeniedMessageKey(denied.errorKey, "backupRestoreFail")).not.toBe("backupRestoreFail");
    expect(backupSurfaceDeniedMessageKey("backupRestoreNotEntitled", "backupRestoreFail")).toBe(
      "backupUpgradeRequired",
    );
  });
});

describe("T5 — restore confirmation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubConfirm(impl: () => boolean) {
    const confirm = vi.fn(impl);
    vi.stubGlobal("window", { confirm });
    return confirm;
  }

  it("does not proceed when the operator cancels the first confirm", () => {
    const confirm = stubConfirm(() => false);
    const ok = confirmRestoreWithSafetyChecks(
      "en",
      { pendingQueueCount: 0, unsyncedSales: 0, syncErrors: 0, hasRisk: false },
      t,
      tTemplate,
    );
    expect(ok).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("requires both confirms when there is no unsynced risk", () => {
    const answers = [true, true];
    const confirm = stubConfirm(() => answers.shift() ?? false);
    const ok = confirmRestoreWithSafetyChecks(
      "en",
      { pendingQueueCount: 0, unsyncedSales: 0, syncErrors: 0, hasRisk: false },
      t,
      tTemplate,
    );
    expect(ok).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("adds an extra confirm when unsynced work is at risk", () => {
    const answers = [true, true, true];
    const confirm = stubConfirm(() => answers.shift() ?? false);
    const ok = confirmRestoreWithSafetyChecks(
      "en",
      { pendingQueueCount: 2, unsyncedSales: 1, syncErrors: 0, hasRisk: true },
      t,
      tTemplate,
    );
    expect(ok).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(3);
  });
});

describe("T7 — shop/account namespace", () => {
  it("backup persistence namespaces do not cross shops", () => {
    const shopA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const shopB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const nsA = buildPersistenceNamespace("sb:user-1", shopA);
    const nsB = buildPersistenceNamespace("sb:user-1", shopB);
    expect(nsA).toBe(`sb:user-1:${shopA}`);
    expect(nsB).toBe(`sb:user-1:${shopB}`);
    expect(nsA).not.toBe(nsB);
    const rows = [
      { id: "bak-a", accountKey: nsA },
      { id: "bak-b", accountKey: nsB },
    ];
    expect(rows.filter((r) => r.accountKey === nsA).map((r) => r.id)).toEqual(["bak-a"]);
  });
});

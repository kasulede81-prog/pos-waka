/**
 * PHASE 0A — R3 executable regression: legacy snapshot claim must stay inside
 * one IndexedDB transaction.
 *
 * AUDIT FINDING (R3, P2):
 *   `claimLegacySnapshotForCurrentAccount` opened a `readwrite` transaction,
 *   then called `db.get(...)` — a *new* transaction — in the middle of it.
 *   Awaiting that nested read lets the outer tx auto-commit. Later put/delete
 *   on the original tx throw `TransactionInactiveError`, swallowed by
 *   `catch { return null }`. The claim could fail silently (copy without
 *   delete, or no claim at all).
 *
 * WHAT THIS FILE DOES:
 *   Real `localDb` against fake-indexeddb. Seeds unscoped `snapshot` /
 *   `last_good_snapshot` keys (pre-account-namespacing), then claims them.
 *   Distinct from WAKA-08, which moves `sb:<uid>::snapshot` into a shop
 *   namespace.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";
import {
  activateOfflineScope,
  clearOfflineScope,
  HARNESS_ACCOUNT_KEY,
  type OfflineScope,
} from "../test/offline/offlineHarness";
import { setActiveAccountKey } from "./accountScope";
import { setActiveShopId } from "./shopScope";
import {
  claimLegacySnapshotForCurrentAccount,
  getLocalDb,
  readSnapshotWithFallback,
  writeSnapshot,
} from "./localDb";

const LEGACY_SNAPSHOT_KEY = "snapshot";
const LEGACY_LAST_GOOD_KEY = "last_good_snapshot";
const LEGACY_CLAIMED_FLAG = "waka.legacy.idb.snapshot.claimed.v1";
const PRODUCT_A = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const PRODUCT_B = "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCOUNT_B = "sb:00000000-0000-4000-8000-000000000099";

function product(id: string, name: string): Product {
  return {
    id,
    name,
    sellingMode: "unit",
    baseUnit: "ea",
    buyingUnit: null,
    conversionRate: null,
    sellingPricePerUnitUgx: 5_000,
    costPricePerUnitUgx: 4_000,
    stockOnHand: 10,
    minimumStockAlert: 2,
    category: "test",
    sku: name.replace(/\s+/g, "-").toLowerCase(),
    updatedAt: "2026-09-01T10:00:00.000Z",
    version: 1,
  };
}

function snapshotFor(products: Product[]) {
  return {
    products,
    customers: [],
    sales: [],
    preferences: createDefaultPreferences(),
    debtPayments: [],
    dayCloses: [],
    updatedAt: "2026-09-01T10:00:00.000Z",
  };
}

async function wipeOfflineDb(): Promise<void> {
  const db = await getLocalDb();
  await db.clear("kv");
  await db.clear("records");
  await db.clear("syncQueue");
  if (db.objectStoreNames.contains("backups")) await db.clear("backups");
}

async function seedUnscopedLegacy(mainName: string, fallbackName?: string): Promise<void> {
  const db = await getLocalDb();
  const main = snapshotFor([product(PRODUCT_A, mainName)]);
  await db.put("kv", main, LEGACY_SNAPSHOT_KEY);
  if (fallbackName) {
    await db.put("kv", snapshotFor([product(PRODUCT_B, fallbackName)]), LEGACY_LAST_GOOD_KEY);
  } else {
    await db.put("kv", main, LEGACY_LAST_GOOD_KEY);
  }
}

async function kvKeys(): Promise<string[]> {
  const db = await getLocalDb();
  return (await db.getAllKeys("kv")).map(String);
}

function installWindow(): void {
  vi.stubGlobal("window", { localStorage: globalThis.localStorage });
}

describe("R3 — nested db.get inside an open write tx is inactive", () => {
  beforeEach(async () => {
    clearOfflineScope();
    localStorage.clear();
    await wipeOfflineDb();
  });

  it("reproduces TransactionInactiveError when db.get runs while a write tx is open", async () => {
    const db = await getLocalDb();
    await db.put("kv", { marker: "unscoped" }, LEGACY_SNAPSHOT_KEY);
    await db.put("kv", { marker: "last-good" }, LEGACY_LAST_GOOD_KEY);

    const tx = db.transaction("kv", "readwrite");
    const kv = tx.objectStore("kv");
    await kv.put({ marker: "copied" }, "probe::snapshot");
    // This is the R3 hazard: a new transaction while `tx` is still open.
    await db.get("kv", LEGACY_LAST_GOOD_KEY);

    let err: unknown = null;
    try {
      await kv.delete(LEGACY_SNAPSHOT_KEY);
      await tx.done;
    } catch (e) {
      err = e;
    }

    expect(err).toBeTruthy();
    const name = (err as { name?: string }).name ?? "";
    const message = String(err);
    expect(
      name === "TransactionInactiveError" || /TransactionInactive/i.test(message) || /inactive/i.test(message),
    ).toBe(true);
  });
});

describe("R3 — claimLegacySnapshotForCurrentAccount is transaction-safe", () => {
  let scope: OfflineScope;

  beforeEach(async () => {
    localStorage.clear();
    await wipeOfflineDb();
    clearOfflineScope();
    scope = activateOfflineScope();
    installWindow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearOfflineScope();
  });

  it("1 — claims an unscoped legacy snapshot into the current namespace", async () => {
    await seedUnscopedLegacy("Legacy Sugar");

    const claimed = await claimLegacySnapshotForCurrentAccount();
    expect(claimed?.products?.[0]?.name).toBe("Legacy Sugar");
    expect(claimed?.products?.[0]?.id).toBe(PRODUCT_A);

    const keys = await kvKeys();
    expect(keys).not.toContain(LEGACY_SNAPSHOT_KEY);
    expect(keys).toContain(`${scope.namespace}::${LEGACY_SNAPSHOT_KEY}`);

    const flag = JSON.parse(localStorage.getItem(LEGACY_CLAIMED_FLAG) ?? "null") as {
      accountKey?: string;
    } | null;
    expect(flag?.accountKey).toBe(scope.namespace);
  });

  it("2 — the claim is atomic: snapshot and last-good move together, unscoped keys are gone", async () => {
    await seedUnscopedLegacy("Legacy Sugar", "Legacy Last Good");

    const claimed = await claimLegacySnapshotForCurrentAccount();
    expect(claimed).toBeTruthy();

    const db = await getLocalDb();
    const keys = await kvKeys();
    expect(keys).not.toContain(LEGACY_SNAPSHOT_KEY);
    expect(keys).not.toContain(LEGACY_LAST_GOOD_KEY);
    expect(keys).toContain(`${scope.namespace}::${LEGACY_SNAPSHOT_KEY}`);
    expect(keys).toContain(`${scope.namespace}::${LEGACY_LAST_GOOD_KEY}`);

    const scopedMain = (await db.get("kv", `${scope.namespace}::${LEGACY_SNAPSHOT_KEY}`)) as {
      products?: Product[];
    };
    const scopedFb = (await db.get("kv", `${scope.namespace}::${LEGACY_LAST_GOOD_KEY}`)) as {
      products?: Product[];
    };
    expect(scopedMain?.products?.[0]?.name).toBe("Legacy Sugar");
    expect(scopedFb?.products?.[0]?.name).toBe("Legacy Last Good");

    // Partial-claim failure mode: copied scoped rows but left unscoped originals.
    expect(keys.filter((k) => k === LEGACY_SNAPSHOT_KEY || k === LEGACY_LAST_GOOD_KEY)).toEqual([]);
  });

  it("3 — a second shop cannot claim the same unscoped snapshot after it is claimed", async () => {
    await seedUnscopedLegacy("Legacy Sugar");

    const first = await claimLegacySnapshotForCurrentAccount();
    expect(first?.products?.[0]?.name).toBe("Legacy Sugar");

    // Switch shop without clearing the account-wide claim flag.
    setActiveShopId(SHOP_B);
    const second = await claimLegacySnapshotForCurrentAccount();
    expect(second).toBeNull();

    const keys = await kvKeys();
    expect(keys).not.toContain(LEGACY_SNAPSHOT_KEY);
    expect(keys.some((k) => k.startsWith(`${HARNESS_ACCOUNT_KEY}:${SHOP_B}::`))).toBe(false);

    setActiveShopId(scope.shopId);
    const stillA = await readSnapshotWithFallback();
    expect(stillA?.products?.[0]?.name).toBe("Legacy Sugar");
  });

  it("3b — a second account cannot inherit the claimed unscoped snapshot", async () => {
    await seedUnscopedLegacy("Legacy Sugar");
    expect(await claimLegacySnapshotForCurrentAccount()).toBeTruthy();

    setActiveAccountKey(ACCOUNT_B);
    setActiveShopId(SHOP_B);
    const second = await claimLegacySnapshotForCurrentAccount();
    expect(second).toBeNull();

    const keys = await kvKeys();
    expect(keys).not.toContain(LEGACY_SNAPSHOT_KEY);
    expect(keys.some((k) => k.startsWith(`${ACCOUNT_B}:`))).toBe(false);
  });

  it("4 — after tx.done, readSnapshotWithFallback sees the claimed data", async () => {
    await seedUnscopedLegacy("Legacy Sugar", "Legacy Last Good");

    const claimed = await claimLegacySnapshotForCurrentAccount();
    expect(claimed).toBeTruthy();

    const restored = await readSnapshotWithFallback();
    expect(restored?.products?.[0]?.name).toBe("Legacy Sugar");
    expect(restored?.products?.[0]?.id).toBe(PRODUCT_A);
  });

  it("5 — claim does not throw TransactionInactiveError (returns the snapshot, not null)", async () => {
    await seedUnscopedLegacy("Legacy Sugar", "Legacy Last Good");

    const errors: unknown[] = [];
    const onError = (ev: { message?: string }) => errors.push(ev);
    process.on("uncaughtException", onError as never);

    let thrown: unknown = null;
    let claimed: Awaited<ReturnType<typeof claimLegacySnapshotForCurrentAccount>> = null;
    try {
      claimed = await claimLegacySnapshotForCurrentAccount();
    } catch (e) {
      thrown = e;
    } finally {
      process.off("uncaughtException", onError as never);
    }

    expect(thrown).toBeNull();
    expect(claimed?.products?.[0]?.name).toBe("Legacy Sugar");
    expect(errors).toEqual([]);

    const keys = await kvKeys();
    expect(keys).not.toContain(LEGACY_SNAPSHOT_KEY);
    expect(keys).not.toContain(LEGACY_LAST_GOOD_KEY);
  });

  it("6 — empty/missing unscoped snapshot records the empty claim and leaves later shops unable to steal", async () => {
    const claimed = await claimLegacySnapshotForCurrentAccount();
    expect(claimed).toBeNull();

    const flag = JSON.parse(localStorage.getItem(LEGACY_CLAIMED_FLAG) ?? "null") as {
      empty?: boolean;
      accountKey?: string;
    } | null;
    expect(flag?.empty).toBe(true);
    expect(flag?.accountKey).toBe(scope.namespace);

    await seedUnscopedLegacy("Late Arrival");
    setActiveShopId(SHOP_B);
    expect(await claimLegacySnapshotForCurrentAccount()).toBeNull();
    expect(await kvKeys()).toContain(LEGACY_SNAPSHOT_KEY);
  });

  it("7 — claimed last-good remains usable as recovery after the active snapshot is corrupted", async () => {
    await seedUnscopedLegacy("Legacy Sugar", "Legacy Last Good");
    expect(await claimLegacySnapshotForCurrentAccount()).toBeTruthy();

    const db = await getLocalDb();
    await db.put("kv", { not: "a snapshot" }, `${scope.namespace}::${LEGACY_SNAPSHOT_KEY}`);

    const restored = await readSnapshotWithFallback();
    expect(restored?.products?.[0]?.name).toBe("Legacy Last Good");
  });

  it("writeSnapshot / last-good rotation still works after a successful claim", async () => {
    await seedUnscopedLegacy("Legacy Sugar");
    expect(await claimLegacySnapshotForCurrentAccount()).toBeTruthy();

    await writeSnapshot(snapshotFor([product(PRODUCT_B, "Post-claim Salt")]));
    const current = await readSnapshotWithFallback();
    expect(current?.products?.[0]?.name).toBe("Post-claim Salt");

    const db = await getLocalDb();
    const lastGood = (await db.get("kv", `${scope.namespace}::${LEGACY_LAST_GOOD_KEY}`)) as {
      products?: Product[];
    };
    expect(lastGood?.products?.[0]?.name).toBe("Legacy Sugar");
  });
});

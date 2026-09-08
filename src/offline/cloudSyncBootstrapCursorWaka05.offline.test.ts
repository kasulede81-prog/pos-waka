/**
 * PHASE 0A — WAKA-05 remaining hole: bootstrap / full-sync cursors.
 *
 * Incremental pullers already settle via `serverCheckpoint`. Full pull still
 * called `markBootstrapSyncComplete()` with no argument, which defaulted to
 * `new Date().toISOString()`. A fast client clock therefore seeded every
 * entity cursor into the server's future after the first successful bootstrap.
 *
 * The fix takes ONE Postgres `now()` immediately before the full download and
 * passes that same value to `markBootstrapSyncComplete`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateOfflineScope,
  organizationTablesFor,
  type OfflineScope,
} from "../test/offline/offlineHarness";
import { createFakeSupabaseClient, type FakeSupabaseClient } from "../test/offline/fakeSupabase";
import { needsBootstrapPull, readSyncCheckpoints, type SyncCheckpoints } from "../lib/syncCheckpoints";
import { normalizeServerTimestamp } from "../lib/serverNow";

const SERVER_NOW = "2026-07-10T00:00:00.000Z";
const FAST_CLIENT_NOW = new Date("2026-07-10T00:10:00.000Z");
const SLOW_CLIENT_NOW = new Date("2026-07-01T00:00:00.000Z");

const fake = vi.hoisted(() => ({ client: null as FakeSupabaseClient | null }));

vi.mock("../lib/supabase", async () => {
  const authConfig = await import("../lib/authConfig");
  return {
    get hasSupabaseConfig() {
      return fake.client != null;
    },
    get supabase() {
      return fake.client;
    },
    authRedirectOrigin: authConfig.authRedirectOrigin,
    getAuthCallbackUrl: authConfig.getAuthCallbackUrl,
    getAuthRecoveryUrl: authConfig.getAuthRecoveryUrl,
  };
});

function bootstrapCursors(cp: SyncCheckpoints): string[] {
  return [
    cp.lastSalesSyncAt,
    cp.lastProductsSyncAt,
    cp.lastCustomersSyncAt,
    cp.lastDebtsSyncAt,
    cp.lastDebtPaymentsSyncAt,
    cp.lastExpensesSyncAt,
    cp.lastReturnsSyncAt,
    cp.lastPurchasesSyncAt,
    cp.lastSuppliersSyncAt,
    cp.lastSupplierPaymentsSyncAt,
    cp.lastCashDrawerAdjustmentsSyncAt,
    cp.lastDayDrawerOpensSyncAt,
    cp.lastInventoryCountSessionsSyncAt,
    cp.lastShiftsSyncAt,
    cp.lastDayClosesSyncAt,
    cp.lastStockMovementsSyncAt,
    cp.lastCatalogSyncAt,
    cp.lastShopPolicySyncAt,
    cp.lastAuditLogsSyncAt,
  ].map((v) => v ?? "");
}

async function setStore(patch: Record<string, unknown>): Promise<void> {
  const { usePosStore } = await import("../store/usePosStore");
  usePosStore.setState(patch as never);
}

function makeClient(scope: OfflineScope, serverNow: string, tables: Record<string, unknown[]> = {}): void {
  fake.client = createFakeSupabaseClient({
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "harness@waka.test",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
    },
    tables: { ...organizationTablesFor(scope), ...tables },
    rpc: { shop_server_now: serverNow },
  });
}

describe("WAKA-05 — bootstrap / full-sync cursors use one server now()", () => {
  let scope: OfflineScope;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    scope = activateOfflineScope();
    await setStore({
      _hydrated: true,
      // Non-empty so merge takes the incremental-RAM path, not snapshot restore.
      products: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "Existing",
          priceUgx: 1_000,
          costUgx: 800,
          stock: 1,
          updatedAt: "2026-06-01T00:00:00.000Z",
          version: 1,
        },
      ],
      sales: [],
      customers: [],
      debtPayments: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a fast client clock cannot seed bootstrap cursors into the client's future", async () => {
    vi.setSystemTime(FAST_CLIENT_NOW);
    expect(FAST_CLIENT_NOW.getTime()).toBeGreaterThan(new Date(SERVER_NOW).getTime());
    makeClient(scope, SERVER_NOW);

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ forceFull: true })).resolves.toBe(true);

    const cp = readSyncCheckpoints();
    expect(cp.bootstrapComplete).toBe(true);
    const cursors = bootstrapCursors(cp);
    expect(new Set(cursors)).toEqual(new Set([SERVER_NOW]));
    expect(cursors).not.toContain(FAST_CLIENT_NOW.toISOString());
    expect(new Date(cursors[0]!).getTime()).toBeLessThan(FAST_CLIENT_NOW.getTime());
  });

  it("a slow client clock still seeds cursors from server time", async () => {
    vi.setSystemTime(SLOW_CLIENT_NOW);
    expect(SLOW_CLIENT_NOW.getTime()).toBeLessThan(new Date(SERVER_NOW).getTime());
    makeClient(scope, SERVER_NOW);

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ forceFull: true })).resolves.toBe(true);

    const cp = readSyncCheckpoints();
    expect(cp.bootstrapComplete).toBe(true);
    expect(new Set(bootstrapCursors(cp))).toEqual(new Set([SERVER_NOW]));
    expect(cp.lastSalesSyncAt).not.toBe(SLOW_CLIENT_NOW.toISOString());
  });

  it("every bootstrap cursor uses the same server checkpoint", async () => {
    vi.setSystemTime(FAST_CLIENT_NOW);
    makeClient(scope, SERVER_NOW);

    const { pullShopDataFromCloud } = await import("./cloudSync");
    const result = await pullShopDataFromCloud({ forceFull: true });
    expect(result?.bootstrapServerNow).toBe(SERVER_NOW);
    expect(result?.stats.mode).toBe("full");

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ forceFull: true })).resolves.toBe(true);

    const unique = new Set(bootstrapCursors(readSyncCheckpoints()));
    expect(unique.size).toBe(1);
    expect(unique.has(SERVER_NOW)).toBe(true);
  });

  it("existing bootstrap completion still happens after a successful full pull", async () => {
    vi.setSystemTime(FAST_CLIENT_NOW);
    makeClient(scope, SERVER_NOW, {
      customers: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          shop_id: scope.shopId,
          name: "Nakato Grace",
          phone_e164: "+256700000001",
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-01T00:00:00.000Z",
          metadata: { debtBalanceUgx: 0, version: 1 },
        },
      ],
    });

    expect(readSyncCheckpoints().bootstrapComplete).toBe(false);

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ forceFull: true })).resolves.toBe(true);

    const cp = readSyncCheckpoints();
    expect(cp.bootstrapComplete).toBe(true);
    expect(cp.lastCustomersSyncAt).toBe(SERVER_NOW);
    expect(needsBootstrapPull(false)).toBe(false);
  });

  it("does not fall back to the client clock when server now is unavailable", async () => {
    vi.setSystemTime(FAST_CLIENT_NOW);
    fake.client = createFakeSupabaseClient({
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "harness@waka.test",
        email_confirmed_at: "2026-01-01T00:00:00.000Z",
      },
      tables: organizationTablesFor(scope),
      rpc: {},
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ forceFull: true })).resolves.toBe(true);

    const cp = readSyncCheckpoints();
    expect(cp.bootstrapComplete).toBe(false);
    expect(cp.lastSalesSyncAt).toBeNull();
    expect(bootstrapCursors(cp).every((v) => v === "")).toBe(true);
  });

  it("normalises a PostgREST timestamptz into a comparable ISO cursor", () => {
    expect(normalizeServerTimestamp("2026-07-10T00:00:00+00:00")).toBe(SERVER_NOW);
    expect(normalizeServerTimestamp("")).toBeNull();
    expect(normalizeServerTimestamp(null)).toBeNull();
  });
});

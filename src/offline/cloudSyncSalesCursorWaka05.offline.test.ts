/**
 * PHASE 0A — WAKA-05 executable regression test: the incremental sales cursor.
 *
 * AUDIT FINDING (WAKA-05, P0) — FIXED:
 *   `pullSalesIncremental` returned
 *     `checkpointAt: checkpointAt > since ? checkpointAt : new Date().toISOString()`
 *   so a pull that fetched an EMPTY page (the ordinary steady state) advanced
 *   the persisted `lastSalesSyncAt` cursor to the CLIENT clock. If the client
 *   clock ran ahead of the server, every sale the server stamped with an
 *   `updated_at` between server-now and client-now was then permanently skipped
 *   by the next `.gt("updated_at", cursor)` query — silent sales data loss.
 *
 *   The fix: the cursor only ever moves to a timestamp taken from a real row
 *   (`maxRowUpdatedAt`). An empty page leaves it exactly where it was.
 *
 * WHAT THIS FILE DOES:
 *   Runs the REAL `pullShopDataFromCloud` in incremental mode against the REAL
 *   checkpoint store, faking only `src/lib/supabase` (the network boundary).
 *   It asserts the value that would be persisted as the next sales cursor
 *   (`result.checkpoints.salesAt`).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateOfflineScope,
  organizationTablesFor,
  type OfflineScope,
} from "../test/offline/offlineHarness";
import { createFakeSupabaseClient, type FakeSupabaseClient } from "../test/offline/fakeSupabase";
import { markBootstrapSyncComplete, readSyncCheckpoints } from "../lib/syncCheckpoints";

/** Well before "now" — a plausible last-successful-sync cursor. */
const LAST_SYNC_AT = "2026-07-01T00:00:00.000Z";

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

function cloudSaleRow(scope: OfflineScope, id: string, updatedAt: string) {
  return {
    id,
    shop_id: scope.shopId,
    status: "completed",
    total_ugx: 10_000,
    subtotal_ugx: 10_000,
    cash_amount_ugx: 10_000,
    debt_amount_ugx: 0,
    created_at: updatedAt,
    updated_at: updatedAt,
    sale_line_items: [],
    metadata: {},
  };
}

async function setStore(patch: Record<string, unknown>): Promise<void> {
  const { usePosStore } = await import("../store/usePosStore");
  usePosStore.setState(patch as never);
}

function makeClient(scope: OfflineScope, tables: Record<string, unknown[]>): void {
  fake.client = createFakeSupabaseClient({
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "harness@waka.test",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
    },
    tables: { ...organizationTablesFor(scope), ...tables },
  });
}

describe("WAKA-05 — the incremental sales cursor", () => {
  let scope: OfflineScope;

  beforeEach(async () => {
    scope = activateOfflineScope();
    // Bootstrap already done → the pull runs in incremental mode, and every
    // entity cursor starts at LAST_SYNC_AT.
    markBootstrapSyncComplete(LAST_SYNC_AT);
    // A non-empty local store keeps the pull in incremental mode.
    await setStore({
      _hydrated: true,
      products: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "Sugar 1kg",
          priceUgx: 5_000,
          costUgx: 4_000,
          stock: 10,
          updatedAt: LAST_SYNC_AT,
          version: 1,
        },
      ],
      sales: [],
      customers: [],
      debtPayments: [],
    });
  });

  it("does NOT advance the cursor on an empty page (no client-clock checkpoint)", async () => {
    makeClient(scope, { sales: [] });

    const { pullShopDataFromCloud } = await import("./cloudSync");
    const result = await pullShopDataFromCloud({ pullReason: "full_sync" });

    expect(result).toBeTruthy();
    // The cursor stays exactly where it was — it is NOT bumped to `Date.now()`.
    expect(result?.checkpoints?.salesAt).toBe(LAST_SYNC_AT);

    // And nothing that ran after the pull quietly rewrote it forward either.
    expect(readSyncCheckpoints().lastSalesSyncAt).toBe(LAST_SYNC_AT);
  });

  it("advances the cursor to the newest row's server updated_at, not the client clock", async () => {
    const newestServerTime = "2026-08-15T10:30:00.000Z";
    makeClient(scope, {
      sales: [
        cloudSaleRow(scope, "11111111-1111-4111-8111-000000000101", "2026-08-10T08:00:00.000Z"),
        cloudSaleRow(scope, "11111111-1111-4111-8111-000000000102", newestServerTime),
      ],
    });

    const { pullShopDataFromCloud } = await import("./cloudSync");
    const result = await pullShopDataFromCloud({ pullReason: "full_sync" });

    expect(result).toBeTruthy();
    // Server time from the row — well in the past, never ~now.
    expect(result?.checkpoints?.salesAt).toBe(newestServerTime);
    expect(new Date(result?.checkpoints?.salesAt ?? 0).getTime()).toBeLessThan(
      new Date("2026-09-01T00:00:00.000Z").getTime(),
    );
  });
});

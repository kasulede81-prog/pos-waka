/**
 * R1 — incomplete local debt ledger must not overwrite cloud `debtBalanceUgx`.
 *
 * AUDIT (R1, P0): `mergeCustomerFromCloudPull` with `ledgerAuthoritative`
 * recomputes `sum(sale.debtUgx) − sum(local payments)` and writes that back
 * with `version+1`. After WAKA-01 the merge actually runs. WAKA-05 fixed the
 * named missed-payment cursor, but `ledgerAuthoritative` was still true whenever
 * `lastDebtPaymentsSyncAt != null`.
 *
 * This file drives the REAL `pullCloudAndMergeIntoStore` (fake network only).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Customer, Sale } from "../types";
import {
  activateOfflineScope,
  organizationTablesFor,
  type OfflineScope,
} from "../test/offline/offlineHarness";
import { createFakeSupabaseClient, type FakeSupabaseClient } from "../test/offline/fakeSupabase";
import { markBootstrapSyncComplete } from "../lib/syncCheckpoints";

const LAST_SYNC_AT = "2026-07-01T00:00:00.000Z";
const CLOUD_UPDATED_AT = "2026-07-08T12:00:00.000Z";
const CUSTOMER_ID = "55555555-5555-4555-8555-555555555555";
const SALE_ID = "77777777-7777-4777-8777-777777777777";
const PRODUCT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AUTHORITATIVE_X = 60_000;

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

function localCustomer(balance: number, version: number): Customer {
  return {
    id: CUSTOMER_ID,
    name: "Nakato Grace",
    phone: "+256700000001",
    location: "Kikoni",
    createdAt: LAST_SYNC_AT,
    updatedAt: LAST_SYNC_AT,
    version,
    debtBalanceUgx: balance,
  };
}

function localCreditSale(debtUgx: number): Sale {
  return {
    id: SALE_ID,
    status: "completed",
    createdAt: LAST_SYNC_AT,
    updatedAt: LAST_SYNC_AT,
    subtotalUgx: debtUgx,
    totalUgx: debtUgx,
    cashPaidUgx: 0,
    debtUgx,
    estimatedProfitUgx: 0,
    lines: [],
    pendingSync: false,
    lastSyncError: null,
    customerId: CUSTOMER_ID,
  };
}

function cloudCustomerRow(scope: OfflineScope, balance: number, version: number) {
  return {
    id: CUSTOMER_ID,
    shop_id: scope.shopId,
    name: "Nakato Grace",
    phone_e164: "+256700000001",
    notes: "Kikoni",
    created_at: LAST_SYNC_AT,
    updated_at: CLOUD_UPDATED_AT,
    metadata: {
      location: "Kikoni",
      version,
      debtBalanceUgx: balance,
      phone: "+256700000001",
      wakaClient: true,
    },
  };
}

function cloudPaymentRow(scope: OfflineScope, id: string, amount: number, createdAt: string) {
  return {
    id,
    shop_id: scope.shopId,
    customer_id: CUSTOMER_ID,
    amount_ugx: amount,
    created_at: createdAt,
    client_created_at: createdAt,
    metadata: {},
  };
}

async function setStore(patch: Record<string, unknown>): Promise<void> {
  const { usePosStore } = await import("../store/usePosStore");
  usePosStore.setState(patch as never);
}

async function getStore() {
  const { usePosStore } = await import("../store/usePosStore");
  return usePosStore.getState();
}

function makeClient(scope: OfflineScope, tables: Record<string, unknown[]>): void {
  fake.client = createFakeSupabaseClient({
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "harness@waka.test",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
    },
    tables: { ...organizationTablesFor(scope), ...tables },
    keyset: true,
  });
}

/** localEmpty === false, bootstrap complete → incremental pull. */
const HYDRATED_INCOMPLETE = {
  _hydrated: true,
  products: [
    {
      id: PRODUCT_ID,
      name: "Existing",
      priceUgx: 1_000,
      costUgx: 800,
      stock: 1,
      updatedAt: LAST_SYNC_AT,
      version: 1,
    },
  ],
  sales: [localCreditSale(100_000)],
  customers: [localCustomer(100_000, 3)],
  debtPayments: [],
};

describe("R1 — pullCloudAndMergeIntoStore must not rebill from an incomplete ledger", () => {
  let scope: OfflineScope;

  beforeEach(async () => {
    scope = activateOfflineScope();
    // The audit's named trigger: checkpoint exists, so pre-fix ledgerAuthoritative
    // was true on every subsequent incremental customer merge.
    markBootstrapSyncComplete(LAST_SYNC_AT);
    await setStore(HYDRATED_INCOMPLETE);
  });

  afterEach(() => {
    fake.client = null;
  });

  it("keeps cloud debt X when this device is missing the payment", async () => {
    makeClient(scope, {
      customers: [cloudCustomerRow(scope, AUTHORITATIVE_X, 9)],
      customer_debt_payments: [],
      sales: [],
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ pullReason: "full_sync" })).resolves.toBe(true);

    const merged = (await getStore()).customers.find((c) => c.id === CUSTOMER_ID);
    expect(merged?.debtBalanceUgx).toBe(AUTHORITATIVE_X);
    expect(merged?.debtBalanceUgx).not.toBe(100_000);
  });

  it("does not restore the pre-payment balance on a second pull", async () => {
    makeClient(scope, {
      customers: [cloudCustomerRow(scope, AUTHORITATIVE_X, 9)],
      customer_debt_payments: [],
      sales: [],
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ pullReason: "full_sync" })).resolves.toBe(true);
    const afterFirst = (await getStore()).customers.find((c) => c.id === CUSTOMER_ID);
    const versionAfterFirst = afterFirst?.version;

    await expect(pullCloudAndMergeIntoStore({ pullReason: "full_sync" })).resolves.toBe(true);
    const afterSecond = (await getStore()).customers.find((c) => c.id === CUSTOMER_ID);
    expect(afterSecond?.debtBalanceUgx).toBe(AUTHORITATIVE_X);
    expect(afterSecond?.version).toBe(versionAfterFirst);
  });

  it("still adopts a complete pulled payment ledger (both devices' payments present)", async () => {
    await setStore({
      ...HYDRATED_INCOMPLETE,
      debtPayments: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          customerId: CUSTOMER_ID,
          amountUgx: 40_000,
          createdAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    });
    makeClient(scope, {
      customers: [cloudCustomerRow(scope, 70_000, 8)],
      customer_debt_payments: [
        cloudPaymentRow(scope, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", 30_000, "2026-07-03T00:00:00.000Z"),
      ],
      sales: [],
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ pullReason: "full_sync" })).resolves.toBe(true);

    const merged = (await getStore()).customers.find((c) => c.id === CUSTOMER_ID);
    // Incremental pull: LWW takes the newer cloud row (70_000) and does not
    // recompute. The complete-ledger overwrite is reserved for full snapshots.
    expect(merged?.debtBalanceUgx).toBe(70_000);
  });
});

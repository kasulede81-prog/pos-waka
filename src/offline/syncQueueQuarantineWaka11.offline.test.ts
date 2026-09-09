/**
 * PHASE 0A — WAKA-11 / WAKA-12 executable regressions.
 *
 * AUDIT FINDING (WAKA-11, P1) — FIXED:
 *   After `attempts` reached 100, flush skipped the re-append (`if (op.attempts < 100)`).
 *   The durable row stayed, `lastAttemptAt` froze, `shouldRetrySyncOp` stayed true past
 *   the backoff cap, and every later flush retried the same unprocessable op forever.
 *   Ops with no resolvable shop id took the same infinite-retry path via `"retry"`.
 *
 * AUDIT FINDING (WAKA-12, P1) — FIXED:
 *   `pullEntitySafe` recorded `entityErrors` and returned undefined, but the pull still
 *   returned true. `useSyncStatus` discarded that result (`void pulled;`) and wrote
 *   `lastSuccessAt` whenever the in-memory push counts were zero — so the indicator
 *   could show healthy while sales failed to download, or while durable queue rows
 *   were stuck / quarantined.
 *
 * This file runs the REAL flush against REAL IndexedDB (fake-indexeddb). Only
 * `src/lib/supabase` is faked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Customer, DebtPayment, SyncOperation } from "../types";
import {
  activateOfflineScope,
  HARNESS_USER_ID,
  organizationTablesFor,
  type OfflineScope,
} from "../test/offline/offlineHarness";
import { createFakeSupabaseClient, type FakeSupabaseClient } from "../test/offline/fakeSupabase";
import {
  deriveQueueHealth,
  isQuarantinedSyncOp,
  QUARANTINED_MAX_ATTEMPTS_ERROR,
  QUARANTINED_NO_SHOP_ERROR,
  SYNC_QUARANTINE_AFTER_ATTEMPTS,
} from "../lib/autoSync";
import { applySyncHealthAfterCycle, readSyncHealthMeta, writeSyncHealthMeta } from "../lib/syncMeta";
import { readLastEntityPullErrors } from "../lib/pullDiagnostics";
import { setActiveAccountKey } from "./accountScope";
import { setActiveShopId } from "./shopScope";

const PAYMENT_OK_ID = "77777777-7777-4777-8777-777777777777";
const PAYMENT_BAD_ID = "66666666-6666-4666-8666-666666666666";
const CUSTOMER_ID = "88888888-8888-4888-8888-888888888888";
const OP_OK = "op-debt-ok";
const OP_BAD = "op-debt-bad";
const OP_STUCK = "op-debt-stuck";
const OTHER_SHOP = "99999999-9999-4999-8999-999999999999";

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

function payment(id: string): DebtPayment {
  return {
    id,
    customerId: CUSTOMER_ID,
    amountUgx: 50_000,
    createdAt: "2026-09-05T09:00:00.000Z",
  };
}

function localCustomer(): Customer {
  return {
    id: CUSTOMER_ID,
    name: "Nakato Grace",
    phone: "+256700000001",
    location: "Kikoni",
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-09-05T09:00:00.000Z",
    version: 2,
    debtBalanceUgx: 50_000,
  };
}

function debtOp(scope: OfflineScope, id: string, paymentId: string, extra: Partial<SyncOperation> = {}): SyncOperation {
  return {
    id,
    kind: "customer",
    shopId: scope.shopId,
    payload: { kind: "debt_payment", paymentId },
    createdAt: "2026-09-05T09:00:00.000Z",
    attempts: 0,
    lastAttemptAt: null,
    ...extra,
  };
}

async function setStore(patch: Record<string, unknown>): Promise<void> {
  const { usePosStore } = await import("../store/usePosStore");
  usePosStore.setState(patch as never);
}

function pushRpcCalls(): number {
  return (fake.client?.rpcCalls ?? []).filter((c) => c.fn === "shop_push_debt_payment").length;
}

function healthAfterDurableQueue(queue: SyncOperation[], extra?: Partial<Parameters<typeof applySyncHealthAfterCycle>[0]>) {
  return applySyncHealthAfterCycle({
    attemptAt: "2026-09-08T12:00:00.000Z",
    pullPartial: false,
    pushFail: 0,
    queueFailed: extra?.queueFailed ?? 0,
    durableRemaining: queue.length,
    queueHealth: deriveQueueHealth(queue),
    ...extra,
  });
}

describe("WAKA-11 / WAKA-12 — durable queue quarantine and honest sync health", () => {
  let scope: OfflineScope;

  beforeEach(async () => {
    scope = activateOfflineScope();
    fake.client = createFakeSupabaseClient({
      user: {
        id: HARNESS_USER_ID,
        email: "harness@waka.test",
        email_confirmed_at: "2026-01-01T00:00:00.000Z",
      },
      tables: organizationTablesFor(scope),
      rpc: {
        shop_push_debt_payment: { ok: true, new_balance_ugx: 0 },
      },
    });
    await setStore({
      _hydrated: true,
      products: [],
      sales: [],
      customers: [],
      debtPayments: [],
      dayCloses: [],
    });
  });

  it("1 — a valid queued operation is pushed and then removed", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(debtOp(scope, OP_OK, PAYMENT_OK_ID));
    await setStore({ debtPayments: [payment(PAYMENT_OK_ID)], customers: [localCustomer()] });

    const { flushSyncQueueInner } = await import("./syncEngine");
    const result = await flushSyncQueueInner();

    expect(pushRpcCalls()).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(0);
    await expect(readSyncQueue()).resolves.toEqual([]);
    const health = healthAfterDurableQueue([]);
    expect(health.lastIssueCode).toBe("none");
    expect(health.queueHealth).toBe("healthy");
  });

  it("2 — a transient failure stays durable and is retried", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(debtOp(scope, OP_STUCK, PAYMENT_BAD_ID));

    const { flushSyncQueueInner } = await import("./syncEngine");
    const first = await flushSyncQueueInner();
    expect(pushRpcCalls()).toBe(0);
    expect(first.failed).toBe(1);
    expect(first.remaining).toBe(1);

    const [afterFirst] = await readSyncQueue();
    expect(afterFirst?.id).toBe(OP_STUCK);
    expect(afterFirst?.attempts).toBe(1);
    expect(isQuarantinedSyncOp(afterFirst as SyncOperation)).toBe(false);

    await appendSyncOperation({ ...(afterFirst as SyncOperation), lastAttemptAt: null });
    const second = await flushSyncQueueInner();
    expect(second.remaining).toBe(1);
    expect(pushRpcCalls()).toBe(0);

    const [afterSecond] = await readSyncQueue();
    expect(afterSecond?.id).toBe(OP_STUCK);
    expect(afterSecond?.attempts).toBe(2);
    expect(deriveQueueHealth(await readSyncQueue())).toBe("backing_off");
  });

  it("3 — a permanently unprocessable operation is quarantined, not retried forever", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(
      debtOp(scope, OP_STUCK, PAYMENT_BAD_ID, {
        attempts: SYNC_QUARANTINE_AFTER_ATTEMPTS - 1,
        lastAttemptAt: null,
      }),
    );

    const { flushSyncQueueInner } = await import("./syncEngine");
    const result = await flushSyncQueueInner();
    expect(pushRpcCalls()).toBe(0);
    expect(result.remaining).toBe(1);

    const [quarantined] = await readSyncQueue();
    expect(quarantined?.id).toBe(OP_STUCK);
    expect(quarantined?.payload).toEqual({ kind: "debt_payment", paymentId: PAYMENT_BAD_ID });
    expect(quarantined?.attempts).toBe(SYNC_QUARANTINE_AFTER_ATTEMPTS);
    expect(quarantined?.lastError).toBe(QUARANTINED_MAX_ATTEMPTS_ERROR);
    expect(quarantined?.quarantinedAt).toBeTruthy();
    expect(isQuarantinedSyncOp(quarantined as SyncOperation)).toBe(true);

    const second = await flushSyncQueueInner();
    expect(second.failed).toBe(0);
    expect(second.remaining).toBe(1);
    const [still] = await readSyncQueue();
    expect(still?.attempts).toBe(SYNC_QUARANTINE_AFTER_ATTEMPTS);
    expect(still?.lastError).toBe(QUARANTINED_MAX_ATTEMPTS_ERROR);
    expect(deriveQueueHealth(await readSyncQueue())).toBe("quarantined");
  });

  it("4 — one bad operation does not prevent a later valid operation from flushing", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(
      debtOp(scope, OP_BAD, PAYMENT_BAD_ID, {
        attempts: SYNC_QUARANTINE_AFTER_ATTEMPTS - 1,
        lastAttemptAt: null,
      }),
    );
    await appendSyncOperation(debtOp(scope, OP_OK, PAYMENT_OK_ID));
    await setStore({ debtPayments: [payment(PAYMENT_OK_ID)], customers: [localCustomer()] });

    const { flushSyncQueueInner } = await import("./syncEngine");
    const result = await flushSyncQueueInner();

    expect(pushRpcCalls()).toBe(1);
    expect(result.remaining).toBe(1);
    const remaining = await readSyncQueue();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(OP_BAD);
    expect(isQuarantinedSyncOp(remaining[0] as SyncOperation)).toBe(true);
    expect(remaining.find((op) => op.id === OP_OK)).toBeUndefined();
  });

  it("5 — quarantined work survives reload / re-read of IndexedDB", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(
      debtOp(scope, OP_STUCK, PAYMENT_BAD_ID, {
        attempts: SYNC_QUARANTINE_AFTER_ATTEMPTS,
        lastAttemptAt: "2026-09-01T00:00:00.000Z",
      }),
    );

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();

    const again = await readSyncQueue();
    expect(again).toHaveLength(1);
    expect(again[0]?.id).toBe(OP_STUCK);
    expect(again[0]?.lastError).toBe(QUARANTINED_MAX_ATTEMPTS_ERROR);
    expect(again[0]?.quarantinedAt).toBeTruthy();
    expect(again[0]?.payload).toEqual({ kind: "debt_payment", paymentId: PAYMENT_BAD_ID });
  });

  it("6/7 — sync health reflects pending, retrying, quarantined, and empty durable work", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    const emptyHealth = healthAfterDurableQueue([]);
    expect(emptyHealth.lastIssueCode).toBe("none");
    expect(emptyHealth.queueHealth).toBe("healthy");
    expect(emptyHealth.lastSuccessAt).toBe("2026-09-08T12:00:00.000Z");

    await appendSyncOperation(debtOp(scope, OP_OK, PAYMENT_OK_ID));
    const pending = await readSyncQueue();
    expect(deriveQueueHealth(pending)).toBe("healthy");
    writeSyncHealthMeta({ lastSuccessAt: "2026-01-01T00:00:00.000Z", lastIssueCode: "error" });
    const pendingHealth = healthAfterDurableQueue(pending);
    expect(pendingHealth.lastSuccessAt).toBe("2026-01-01T00:00:00.000Z");
    expect(pendingHealth.lastIssueCode).toBe("error");
    expect(pendingHealth.queueHealth).toBe("healthy");

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();
    const retrying = await readSyncQueue();
    expect(retrying[0]?.attempts).toBe(1);
    expect(isQuarantinedSyncOp(retrying[0] as SyncOperation)).toBe(false);
    const retryHealth = healthAfterDurableQueue(retrying, { queueFailed: 1 });
    expect(retryHealth.lastIssueCode).toBe("partial");
    expect(retryHealth.queueHealth).toBe("backing_off");

    await appendSyncOperation({
      ...(retrying[0] as SyncOperation),
      attempts: SYNC_QUARANTINE_AFTER_ATTEMPTS - 1,
      lastAttemptAt: null,
    });
    await flushSyncQueueInner();
    const quarantined = await readSyncQueue();
    expect(deriveQueueHealth(quarantined)).toBe("quarantined");
    const qHealth = healthAfterDurableQueue(quarantined);
    expect(qHealth.lastIssueCode).toBe("partial");
    expect(qHealth.queueHealth).toBe("quarantined");
  });

  it("8 — WAKA-06 RAM-miss / IndexedDB-hit still pushes before ACK", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    const { putEntity } = await import("./entityStore");
    await appendSyncOperation(debtOp(scope, OP_OK, PAYMENT_OK_ID));
    await putEntity("debtPayment", PAYMENT_OK_ID, payment(PAYMENT_OK_ID), "2026-09-05T09:00:00.000Z");
    await setStore({ customers: [localCustomer()] });

    const { flushSyncQueueInner } = await import("./syncEngine");
    const result = await flushSyncQueueInner();
    expect(pushRpcCalls()).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(0);
    await expect(readSyncQueue()).resolves.toEqual([]);
  });

  it("9 — a durable op is never ACKed/deleted unless the push actually succeeds", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(debtOp(scope, OP_STUCK, PAYMENT_BAD_ID));

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();
    expect(pushRpcCalls()).toBe(0);
    const remaining = await readSyncQueue();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(OP_STUCK);
  });

  it("other-shop ops are skipped without counting as failures or blocking the active shop", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(debtOp(scope, OP_BAD, PAYMENT_BAD_ID, { shopId: OTHER_SHOP }));
    await appendSyncOperation(debtOp(scope, OP_OK, PAYMENT_OK_ID));
    await setStore({ debtPayments: [payment(PAYMENT_OK_ID)], customers: [localCustomer()] });

    const { flushSyncQueueInner } = await import("./syncEngine");
    const result = await flushSyncQueueInner();
    expect(pushRpcCalls()).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(1);
    const [left] = await readSyncQueue();
    expect(left?.id).toBe(OP_BAD);
    expect(left?.attempts).toBe(0);
    expect(left?.shopId).toBe(OTHER_SHOP);
  });

  it("ops with no resolvable shop id are quarantined, not retried forever", async () => {
    setActiveAccountKey("local:harness@waka.test");
    setActiveShopId(null);
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation({
      id: OP_STUCK,
      kind: "customer",
      payload: { kind: "debt_payment", paymentId: PAYMENT_BAD_ID },
      createdAt: "2026-09-05T09:00:00.000Z",
      attempts: 0,
      lastAttemptAt: null,
    });

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();
    const [row] = await readSyncQueue();
    expect(row?.id).toBe(OP_STUCK);
    expect(row?.lastError).toBe(QUARANTINED_NO_SHOP_ERROR);
    expect(row?.quarantinedAt).toBeTruthy();
    expect(isQuarantinedSyncOp(row as SyncOperation)).toBe(true);

    const second = await flushSyncQueueInner();
    expect(second.failed).toBe(0);
    expect((await readSyncQueue())[0]?.attempts).toBe(SYNC_QUARANTINE_AFTER_ATTEMPTS);
  });
});

describe("WAKA-12 — pull entity failure must not report a healthy sync", () => {
  let scope: OfflineScope;

  beforeEach(async () => {
    scope = activateOfflineScope();
    const client = createFakeSupabaseClient({
      user: {
        id: HARNESS_USER_ID,
        email: "harness@waka.test",
        email_confirmed_at: "2026-01-01T00:00:00.000Z",
      },
      tables: organizationTablesFor(scope),
    });
    const origFrom = client.from.bind(client);
    client.from = ((table: string) => {
      if (table === "sales") throw new Error("sales_pull_denied");
      return origFrom(table);
    }) as FakeSupabaseClient["from"];
    fake.client = client;
    await setStore({
      _hydrated: true,
      products: [],
      sales: [],
      customers: [localCustomer()],
      debtPayments: [],
    });
  });

  it("records sales pull failure as partial health even though the pull still returns true", async () => {
    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ pullReason: "full_sync" })).resolves.toBe(true);

    const errors = readLastEntityPullErrors();
    expect(errors.sales).toBe("sales_pull_denied");

    const written = readSyncHealthMeta();
    expect(written.lastIssueCode).toBe("partial");
    expect(written.entityPullErrors?.sales).toBe("sales_pull_denied");
    expect(written.lastSuccessAt).toBeNull();

    const cycle = applySyncHealthAfterCycle({
      attemptAt: "2026-09-08T14:00:00.000Z",
      pullPartial: true,
      entityPullErrors: errors,
      pushFail: 0,
      queueFailed: 0,
      durableRemaining: 0,
      queueHealth: "healthy",
    });
    expect(cycle.lastIssueCode).toBe("partial");
    expect(cycle.lastSuccessAt).not.toBe("2026-09-08T14:00:00.000Z");
    expect(cycle.entityPullErrors?.sales).toBe("sales_pull_denied");
  });
});

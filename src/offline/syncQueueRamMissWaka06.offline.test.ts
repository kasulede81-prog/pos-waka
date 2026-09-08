/**
 * PHASE 0A — WAKA-06 executable regression test: queued-work loss on a RAM miss.
 *
 * AUDIT FINDING (WAKA-06, P0) — FIXED:
 *   `pushDebtPaymentToCloud` resolved the queued debt payment ONLY from the
 *   hydrated in-memory store:
 *
 *     const payment = usePosStore.getState().debtPayments.find(...)
 *     if (!payment) return true;      // <- acknowledged
 *
 *   `true` becomes `"ack"` in `processCloudSyncOperationResult`, and
 *   `flushSyncQueueInner` responds to `"ack"` with `removeSyncOperation(op.id)`.
 *   So a queue op whose row was merely absent from RAM — the ordinary state
 *   while the store is still hydrating from IndexedDB after a cold start — was
 *   permanently DELETED from the persisted queue without ever being pushed.
 *   The customer's debt payment never reached the cloud, on any device.
 *
 *   The same held for the customer lookup two lines below
 *   (`if (!customer || !isUuid(customer.id)) return true;`), which acknowledged
 *   whenever the customer had not hydrated yet.
 *
 *   The fix makes the persisted store the source of truth: RAM first, then the
 *   `debtPayment` entity bucket on disk, and a row found nowhere returns
 *   `false` (retry) rather than `true` (ack).
 *
 * WHAT THIS FILE DOES DIFFERENTLY:
 *   It runs the REAL `flushSyncQueueInner` against the REAL `localDb` sync
 *   queue and the REAL `entityStore` (fake-indexeddb), with the REAL
 *   `usePosStore`. Only `src/lib/supabase` — the network boundary — is faked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Customer, DebtPayment, SyncOperation } from "../types";
import {
  activateOfflineScope,
  organizationTablesFor,
  type OfflineScope,
} from "../test/offline/offlineHarness";
import { createFakeSupabaseClient, type FakeSupabaseClient } from "../test/offline/fakeSupabase";

const PAYMENT_ID = "77777777-7777-4777-8777-777777777777";
const CUSTOMER_ID = "88888888-8888-4888-8888-888888888888";
const OP_ID = "op-debt-payment-1";

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

function debtPayment(): DebtPayment {
  return {
    id: PAYMENT_ID,
    customerId: CUSTOMER_ID,
    amountUgx: 50_000,
    createdAt: "2026-09-05T09:00:00.000Z",
  };
}

/** The debtor as a fully hydrated device already knows them. */
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

/** The queue row this device wrote when the cashier took the payment. */
function debtPaymentOp(scope: OfflineScope): SyncOperation {
  return {
    id: OP_ID,
    kind: "customer",
    shopId: scope.shopId,
    payload: { kind: "debt_payment", paymentId: PAYMENT_ID },
    createdAt: "2026-09-05T09:00:00.000Z",
    attempts: 0,
    lastAttemptAt: null,
  };
}

async function setStore(patch: Record<string, unknown>): Promise<void> {
  const { usePosStore } = await import("../store/usePosStore");
  usePosStore.setState(patch as never);
}

function pushRpcCalls(): number {
  return (fake.client?.rpcCalls ?? []).filter((c) => c.fn === "shop_push_debt_payment").length;
}

describe("WAKA-06 — flush must not acknowledge a queue op whose row is missing from RAM", () => {
  let scope: OfflineScope;

  beforeEach(async () => {
    scope = activateOfflineScope();
    fake.client = createFakeSupabaseClient({
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "harness@waka.test",
        email_confirmed_at: "2026-01-01T00:00:00.000Z",
      },
      tables: organizationTablesFor(scope),
      rpc: {
        shop_push_debt_payment: { ok: true, new_balance_ugx: 0 },
      },
    });
    // A cold-started store: hydrated flag set, but the debt payment and the
    // customer have not been loaded into RAM yet.
    await setStore({
      _hydrated: true,
      products: [],
      sales: [],
      customers: [],
      debtPayments: [],
      dayCloses: [],
    });
  });

  /**
   * CONTROL / PROOF — the fully hydrated case: BOTH the payment and its
   * customer are in RAM. This behaves identically before and after the fix, so
   * its passing is what proves the failures below come from the RAM miss and
   * not from a broken harness, a missing session, or an unresolved shop ctx.
   */
  it("CONTROL — pushes and acknowledges when payment and customer are both hydrated", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(debtPaymentOp(scope));
    await setStore({ debtPayments: [debtPayment()], customers: [localCustomer()] });

    const { flushSyncQueueInner } = await import("./syncEngine");
    const result = await flushSyncQueueInner();

    // The work really was pushed, and only then acknowledged.
    expect(pushRpcCalls()).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(0);
    await expect(readSyncQueue()).resolves.toEqual([]);
  });

  /**
   * REGRESSION TEST FOR WAKA-06 — hydrated/RAM payment row present.
   *
   * The payment IS in RAM, but the customer has not hydrated yet. Before the
   * fix the customer lookup (`if (!customer …) return true`) acknowledged the
   * op, so the flush deleted a real, pushable payment without pushing it.
   */
  it("pushes a hydrated payment even when its customer has not hydrated yet", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(debtPaymentOp(scope));
    await setStore({ debtPayments: [debtPayment()], customers: [] });

    const { flushSyncQueueInner } = await import("./syncEngine");
    const result = await flushSyncQueueInner();

    expect(pushRpcCalls()).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(0);
    await expect(readSyncQueue()).resolves.toEqual([]);
  });

  /**
   * REGRESSION TEST FOR WAKA-06.
   *
   * The row is absent from RAM but present in the persisted entity store — the
   * exact state of a device that queued the payment, restarted, and began a
   * flush before hydration finished. Before the fix this returned `true`, the
   * flush acked, and `removeSyncOperation` deleted the op WITHOUT any push.
   */
  it("resolves the payment from IndexedDB when RAM does not contain it, and pushes it", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    const { putEntity } = await import("./entityStore");

    await appendSyncOperation(debtPaymentOp(scope));
    // On disk only — RAM stays empty (see beforeEach).
    await putEntity("debtPayment", PAYMENT_ID, debtPayment(), "2026-09-05T09:00:00.000Z");

    const { flushSyncQueueInner } = await import("./syncEngine");
    const result = await flushSyncQueueInner();

    // The persisted row was the source of truth: the payment was actually
    // uploaded rather than silently discarded.
    expect(pushRpcCalls()).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(0);
    await expect(readSyncQueue()).resolves.toEqual([]);
  });

  /**
   * REGRESSION TEST FOR WAKA-06 — the queued-work-loss case proper.
   *
   * The op is in IndexedDB but its row is in NEITHER RAM nor the persisted
   * entity store. That is not evidence the work was done, so the flush must
   * retry: the op stays on disk with its retry bookkeeping advanced, and no
   * push is attempted.
   */
  it("does NOT acknowledge or delete the op when the row is in neither RAM nor IndexedDB", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(debtPaymentOp(scope));

    const { flushSyncQueueInner } = await import("./syncEngine");
    const result = await flushSyncQueueInner();

    // Nothing was pushed — there was nothing resolvable to push.
    expect(pushRpcCalls()).toBe(0);
    // And nothing was thrown away.
    expect(result.failed).toBe(1);
    expect(result.remaining).toBe(1);
    expect(result.skippedBackoff).toBe(0);

    const [after] = await readSyncQueue();
    expect(after?.id).toBe(OP_ID);
    expect(after?.kind).toBe("customer");
    expect((after?.payload as { paymentId?: string })?.paymentId).toBe(PAYMENT_ID);
    // Retry bookkeeping advanced exactly once.
    expect(after?.attempts).toBe(1);
    expect(after?.lastAttemptAt).toBeTruthy();
  });

  /**
   * The op survives repeated flushes rather than being dropped on a later pass,
   * and keeps counting attempts — so the work is still there to be recovered
   * once the store finishes hydrating.
   */
  it("keeps the op across a second flush and keeps counting attempts", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation({ ...debtPaymentOp(scope), attempts: 0, lastAttemptAt: null });

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();

    // Clear the backoff so the second pass actually retries the op.
    const [first] = await readSyncQueue();
    expect(first?.attempts).toBe(1);
    await appendSyncOperation({ ...(first as SyncOperation), lastAttemptAt: null });

    const second = await flushSyncQueueInner();
    expect(second.remaining).toBe(1);

    const [after] = await readSyncQueue();
    expect(after?.id).toBe(OP_ID);
    expect(after?.attempts).toBe(2);
    expect(pushRpcCalls()).toBe(0);
  });
});

describe("WAKA-06 — flush before hydration must not process or ACK", () => {
  let scope: OfflineScope;

  beforeEach(async () => {
    scope = activateOfflineScope();
    fake.client = createFakeSupabaseClient({
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "harness@waka.test",
        email_confirmed_at: "2026-01-01T00:00:00.000Z",
      },
      tables: organizationTablesFor(scope),
      rpc: {
        shop_push_debt_payment: { ok: true, new_balance_ugx: 0 },
      },
    });
    await setStore({
      _hydrated: false,
      products: [],
      sales: [],
      customers: [],
      debtPayments: [],
    });
  });

  it("retains the op and does not increment attempts while _hydrated is false", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(debtPaymentOp(scope));

    const { flushSyncQueueInner } = await import("./syncEngine");
    const result = await flushSyncQueueInner();

    expect(pushRpcCalls()).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(1);
    const [after] = await readSyncQueue();
    expect(after?.id).toBe(OP_ID);
    expect(after?.attempts).toBe(0);
    expect(after?.lastAttemptAt).toBeNull();
  });

  it("completes the same op on the next flush after hydration when the row is in RAM", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(debtPaymentOp(scope));

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();
    expect(pushRpcCalls()).toBe(0);
    expect((await readSyncQueue())[0]?.attempts).toBe(0);

    await setStore({
      _hydrated: true,
      debtPayments: [debtPayment()],
      customers: [localCustomer()],
    });
    const second = await flushSyncQueueInner();

    expect(pushRpcCalls()).toBe(1);
    expect(second.failed).toBe(0);
    expect(second.remaining).toBe(0);
    await expect(readSyncQueue()).resolves.toEqual([]);
  });
});

/**
 * PHASE 0A — WAKA-06 executable regressions for the full RAM-miss class.
 *
 * The debt-payment / customer-lookup cases live in
 * `syncQueueRamMissWaka06.offline.test.ts`. This file covers every other
 * audit-listed handler that used `if (!row) return true` (ACK on RAM miss):
 *
 *   customer, product, supplier, pending_expenses/supplier_payment,
 *   pending_inventory_counts, pending_shifts, pending_day_closes,
 *   pending_cash_expenses, and the catalog_only product stock path.
 *
 * Each kind must fail on the old RAM-only ACK and pass after disk lookup +
 * `return false` (retry) + the `_hydrated` flush guard.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CashExpense,
  Customer,
  DayCloseSummary,
  InventoryCountSession,
  Product,
  ShiftRecord,
  Supplier,
  SupplierPayment,
  SyncOperation,
} from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";
import {
  activateOfflineScope,
  HARNESS_USER_ID,
  organizationTablesFor,
  type OfflineScope,
} from "../test/offline/offlineHarness";
import { createFakeSupabaseClient, type FakeSupabaseClient } from "../test/offline/fakeSupabase";
import { ENTITY_STORE_VERSION } from "./entityStore";

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

const CUSTOMER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUPPLIER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SUPPLIER_PAYMENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const COUNT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SHIFT_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const CLOSE_ID = "12121212-1212-4121-8121-121212121212";
const EXPENSE_ID = "13131313-1313-4131-8131-131313131313";

function customer(): Customer {
  return {
    id: CUSTOMER_ID,
    name: "Okello Peter",
    phone: "+256700000002",
    location: "Wandegeya",
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-09-05T09:00:00.000Z",
    version: 1,
    debtBalanceUgx: 0,
  };
}

function product(): Product {
  return {
    id: PRODUCT_ID,
    name: "Cooking oil 1L",
    sellingMode: "unit",
    baseUnit: "ea",
    sellingPricePerUnitUgx: 8_000,
    costPricePerUnitUgx: 6_000,
    stockOnHand: 12,
    minimumStockAlert: 2,
    category: "grocery",
    sku: "OIL-1L",
    updatedAt: "2026-09-05T09:00:00.000Z",
    version: 1,
  };
}

function supplier(): Supplier {
  return {
    id: SUPPLIER_ID,
    name: "Mukwano Depot",
    phone: "+256700000003",
    location: "Industrial Area",
    notes: "",
    balanceOwedUgx: 20_000,
    totalPurchasesUgx: 80_000,
    createdAt: "2026-08-01T08:00:00.000Z",
    version: 1,
  };
}

function supplierPayment(): SupplierPayment {
  return {
    id: SUPPLIER_PAYMENT_ID,
    supplierId: SUPPLIER_ID,
    amountUgx: 20_000,
    createdAt: "2026-09-05T09:00:00.000Z",
    pendingSync: true,
  };
}

function inventoryCount(): InventoryCountSession {
  return {
    id: COUNT_ID,
    sessionNumber: 1,
    status: "submitted",
    startedAt: "2026-09-05T08:00:00.000Z",
    startedBy: HARNESS_USER_ID,
    submittedAt: "2026-09-05T09:00:00.000Z",
    submittedBy: HARNESS_USER_ID,
    approvedAt: null,
    approvedBy: null,
    appliedAt: null,
    appliedBy: null,
    snapshotCreatedAt: "2026-09-05T08:00:00.000Z",
    notes: "",
    lines: [],
    pendingSync: true,
    updatedAt: "2026-09-05T09:00:00.000Z",
  };
}

function shift(): ShiftRecord {
  return {
    id: SHIFT_ID,
    actorUserId: HARNESS_USER_ID,
    role: "cashier",
    startAt: "2026-09-05T08:00:00.000Z",
    endAt: "2026-09-05T16:00:00.000Z",
    salesTotalUgx: 100_000,
    debtTotalUgx: 0,
    refundsUgx: 0,
    estimatedCashUgx: 100_000,
    pendingSync: true,
    updatedAt: "2026-09-05T16:00:00.000Z",
  };
}

function dayClose(): DayCloseSummary {
  return {
    id: CLOSE_ID,
    dateKey: "2026-09-05",
    expectedCashUgx: 100_000,
    countedCashUgx: 100_000,
    differenceUgx: 0,
    totalSalesUgx: 100_000,
    totalDebtUgx: 0,
    profitEstimateUgx: 20_000,
    createdAt: "2026-09-05T20:00:00.000Z",
    pendingSync: true,
    updatedAt: "2026-09-05T20:00:00.000Z",
  };
}

function cashExpense(): CashExpense {
  return {
    id: EXPENSE_ID,
    category: "transport",
    amountUgx: 5_000,
    description: "Boda to market",
    paidOn: "2026-09-05",
    createdAt: "2026-09-05T10:00:00.000Z",
    createdByUserId: HARNESS_USER_ID,
    pendingSync: true,
  };
}

type KindCase = {
  name: string;
  opId: string;
  kind: SyncOperation["kind"];
  payload: Record<string, unknown>;
  ramPatch: () => Record<string, unknown>;
  putDisk: () => Promise<void>;
  pushed: () => boolean;
};

async function setStore(patch: Record<string, unknown>): Promise<void> {
  const { usePosStore } = await import("../store/usePosStore");
  usePosStore.setState(patch as never);
}

async function emptyHydratedStore(): Promise<void> {
  await setStore({
    _hydrated: true,
    products: [],
    sales: [],
    customers: [],
    debtPayments: [],
    dayCloses: [],
    suppliers: [],
    supplierPayments: [],
    inventoryCountSessions: [],
    cashExpenses: [],
    preferences: createDefaultPreferences(),
  });
}

async function emptyUnhydratedStore(): Promise<void> {
  await setStore({
    _hydrated: false,
    products: [],
    sales: [],
    customers: [],
    debtPayments: [],
    dayCloses: [],
    suppliers: [],
    supplierPayments: [],
    inventoryCountSessions: [],
    cashExpenses: [],
    preferences: createDefaultPreferences(),
  });
}

function tableWrites(table: string): number {
  return (fake.client?.writes ?? []).filter((w) => w.table === table).length;
}

function rpcCalls(fn: string): number {
  return (fake.client?.rpcCalls ?? []).filter((c) => c.fn === fn).length;
}

function makeCases(): KindCase[] {
  return [
    {
      name: "customer",
      opId: "op-customer-1",
      kind: "customer",
      payload: { id: CUSTOMER_ID },
      ramPatch: () => ({ customers: [customer()] }),
      putDisk: async () => {
        const { putEntity } = await import("./entityStore");
        await putEntity("customer", CUSTOMER_ID, customer(), "2026-09-05T09:00:00.000Z");
      },
      pushed: () => tableWrites("customers") > 0,
    },
    {
      name: "product",
      opId: "op-product-1",
      kind: "product",
      payload: { id: PRODUCT_ID },
      ramPatch: () => ({ products: [product()] }),
      putDisk: async () => {
        const { putEntity } = await import("./entityStore");
        await putEntity("product", PRODUCT_ID, product(), "2026-09-05T09:00:00.000Z");
      },
      pushed: () => tableWrites("products") > 0,
    },
    {
      name: "product catalog_only stock path",
      opId: "op-catalog-only-1",
      kind: "pending_stock_updates",
      payload: { catalogOnly: true, productId: PRODUCT_ID },
      ramPatch: () => ({ products: [product()] }),
      putDisk: async () => {
        const { putEntity } = await import("./entityStore");
        await putEntity("product", PRODUCT_ID, product(), "2026-09-05T09:00:00.000Z");
      },
      pushed: () => tableWrites("products") > 0,
    },
    {
      name: "supplier",
      opId: "op-supplier-1",
      kind: "supplier",
      payload: { id: SUPPLIER_ID },
      ramPatch: () => ({ suppliers: [supplier()] }),
      putDisk: async () => {
        const { putEntity } = await import("./entityStore");
        await putEntity("supplier", SUPPLIER_ID, supplier(), "2026-09-05T09:00:00.000Z");
      },
      pushed: () => rpcCalls("shop_push_supplier") > 0,
    },
    {
      name: "supplier payment",
      opId: "op-supplier-payment-1",
      kind: "pending_expenses",
      payload: { kind: "supplier_payment", paymentId: SUPPLIER_PAYMENT_ID },
      ramPatch: () => ({ supplierPayments: [supplierPayment()] }),
      putDisk: async () => {
        const { putEntity } = await import("./entityStore");
        await putEntity("supplierPayment", SUPPLIER_PAYMENT_ID, supplierPayment(), "2026-09-05T09:00:00.000Z");
      },
      pushed: () => rpcCalls("shop_push_supplier_payment") > 0,
    },
    {
      name: "inventory count",
      opId: "op-inventory-count-1",
      kind: "pending_inventory_counts",
      payload: { sessionId: COUNT_ID },
      ramPatch: () => ({ inventoryCountSessions: [inventoryCount()] }),
      putDisk: async () => {
        const { putEntity } = await import("./entityStore");
        await putEntity("inventoryCountSession", COUNT_ID, inventoryCount(), "2026-09-05T09:00:00.000Z");
      },
      pushed: () => rpcCalls("shop_push_inventory_count_session") > 0,
    },
    {
      name: "shift",
      opId: "op-shift-1",
      kind: "pending_shifts",
      payload: { shiftId: SHIFT_ID },
      ramPatch: () => ({
        preferences: { ...createDefaultPreferences(), shifts: [shift()] },
      }),
      putDisk: async () => {
        const { writeEntityManifest } = await import("./entityStore");
        await writeEntityManifest({
          version: ENTITY_STORE_VERSION,
          preferences: { ...createDefaultPreferences(), shifts: [shift()] },
          salesOrder: [],
          archivedSalesOrder: [],
          tombstones: {},
          voidedSaleIds: {},
          updatedAt: "2026-09-05T16:00:00.000Z",
        });
      },
      pushed: () => rpcCalls("shop_push_shift") > 0,
    },
    {
      name: "day close",
      opId: "op-day-close-1",
      kind: "pending_day_closes",
      payload: { closeId: CLOSE_ID },
      ramPatch: () => ({ dayCloses: [dayClose()] }),
      putDisk: async () => {
        const { putEntity } = await import("./entityStore");
        await putEntity("dayClose", CLOSE_ID, dayClose(), "2026-09-05T20:00:00.000Z");
      },
      pushed: () => rpcCalls("shop_push_day_close") > 0,
    },
    {
      name: "cash expense",
      opId: "op-cash-expense-1",
      kind: "pending_cash_expenses",
      payload: { expenseId: EXPENSE_ID },
      ramPatch: () => ({ cashExpenses: [cashExpense()] }),
      putDisk: async () => {
        const { putEntity } = await import("./entityStore");
        await putEntity("cashExpense", EXPENSE_ID, cashExpense(), "2026-09-05T10:00:00.000Z");
      },
      pushed: () => rpcCalls("shop_push_cash_expense") > 0,
    },
  ];
}

function queueOp(scope: OfflineScope, c: KindCase): SyncOperation {
  return {
    id: c.opId,
    kind: c.kind,
    shopId: scope.shopId,
    payload: c.payload,
    createdAt: "2026-09-05T09:00:00.000Z",
    attempts: 0,
    lastAttemptAt: null,
  };
}

function makeClient(scope: OfflineScope): FakeSupabaseClient {
  return createFakeSupabaseClient({
    user: {
      id: HARNESS_USER_ID,
      email: "harness@waka.test",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
    },
    tables: organizationTablesFor(scope),
    rpc: {
      shop_push_supplier: { ok: true },
      shop_push_supplier_payment: { ok: true },
      shop_push_inventory_count_session: { ok: true },
      shop_push_shift: { ok: true },
      shop_push_day_close: { ok: true },
      shop_push_cash_expense: { ok: true },
    },
  });
}

describe.each(makeCases())("WAKA-06 RAM-miss class — $name", (c) => {
  let scope: OfflineScope;

  beforeEach(async () => {
    scope = activateOfflineScope();
    fake.client = makeClient(scope);
    await emptyHydratedStore();
  });

  it("CONTROL — pushes and acknowledges when the entity is in RAM", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(queueOp(scope, c));
    await setStore(c.ramPatch());

    const { flushSyncQueueInner } = await import("./syncEngine");
    const result = await flushSyncQueueInner();

    expect(c.pushed()).toBe(true);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(0);
    await expect(readSyncQueue()).resolves.toEqual([]);
  });

  it("resolves the entity from IndexedDB when RAM does not contain it, and pushes it", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(queueOp(scope, c));
    await c.putDisk();

    const { flushSyncQueueInner } = await import("./syncEngine");
    const result = await flushSyncQueueInner();

    expect(c.pushed()).toBe(true);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(0);
    await expect(readSyncQueue()).resolves.toEqual([]);
  });

  it("does NOT acknowledge or delete the op when the row is in neither RAM nor IndexedDB", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(queueOp(scope, c));

    const { flushSyncQueueInner } = await import("./syncEngine");
    const result = await flushSyncQueueInner();

    expect(c.pushed()).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.remaining).toBe(1);
    expect(result.skippedBackoff).toBe(0);

    const [after] = await readSyncQueue();
    expect(after?.id).toBe(c.opId);
    expect(after?.kind).toBe(c.kind);
    expect(after?.attempts).toBe(1);
    expect(after?.lastAttemptAt).toBeTruthy();
  });

  it("keeps the op across a second flush and keeps counting attempts", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(queueOp(scope, c));

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();

    const [first] = await readSyncQueue();
    expect(first?.attempts).toBe(1);
    await appendSyncOperation({ ...(first as SyncOperation), lastAttemptAt: null });

    const second = await flushSyncQueueInner();
    expect(second.remaining).toBe(1);
    expect(c.pushed()).toBe(false);

    const [after] = await readSyncQueue();
    expect(after?.id).toBe(c.opId);
    expect(after?.attempts).toBe(2);
    expect(after?.lastAttemptAt).toBeTruthy();
  });
});

describe.each(makeCases())("WAKA-06 hydration guard — $name", (c) => {
  let scope: OfflineScope;

  beforeEach(async () => {
    scope = activateOfflineScope();
    fake.client = makeClient(scope);
    await emptyUnhydratedStore();
  });

  it("retains the op and does not increment attempts while _hydrated is false", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(queueOp(scope, c));

    const { flushSyncQueueInner } = await import("./syncEngine");
    const result = await flushSyncQueueInner();

    expect(c.pushed()).toBe(false);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(1);
    const [after] = await readSyncQueue();
    expect(after?.id).toBe(c.opId);
    expect(after?.attempts).toBe(0);
    expect(after?.lastAttemptAt).toBeNull();
  });

  it("completes the same op on the next flush after hydration when the row is in RAM", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(queueOp(scope, c));

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();
    expect(c.pushed()).toBe(false);
    expect((await readSyncQueue())[0]?.attempts).toBe(0);

    await setStore({ _hydrated: true, ...c.ramPatch() });
    const second = await flushSyncQueueInner();

    expect(c.pushed()).toBe(true);
    expect(second.failed).toBe(0);
    expect(second.remaining).toBe(0);
    await expect(readSyncQueue()).resolves.toEqual([]);
  });

  it("completes from IndexedDB on the next flush after hydration when RAM is still empty", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(queueOp(scope, c));
    await c.putDisk();

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();
    expect(c.pushed()).toBe(false);
    expect((await readSyncQueue())[0]?.attempts).toBe(0);

    await setStore({ _hydrated: true });
    const second = await flushSyncQueueInner();

    expect(c.pushed()).toBe(true);
    expect(second.failed).toBe(0);
    expect(second.remaining).toBe(0);
    await expect(readSyncQueue()).resolves.toEqual([]);
  });
});

/**
 * SALES-SYNC-RETURNVOID-FIX-01 — enqueue, pendingSync, WAIT metadata,
 * recovery merge, and sale-before-adjustment ordering.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product, ReturnRecord, Sale, SaleLine, SyncOperation, VoidRecord } from "../types";
import { deriveQueueHealth, markSyncOpFailed, shouldRetrySyncOp } from "./autoSync";
import {
  WAITING_FOR_SALE_ERROR,
  isSaleCloudAcked,
  linkedSaleAdjustmentDecision,
  markSyncOpWaitingForSale,
  partitionSaleBeforeAdjustment,
} from "./saleAdjustmentSync";
import { mergeReturnRecordsForRecovery } from "./returnRecovery";
import { mergeVoidRecordsForRecovery } from "./saleAdjustmentLedger";
import { buildSyncForensicSnapshot } from "./syncForensicSnapshot";
import { setActiveAccountKey } from "../offline/accountScope";
import { setCachedShopId } from "./shopSyncContext";
import { usePosStore } from "../store/usePosStore";
import { createDefaultPreferences } from "../data/defaultSeed";
import { openTestShift } from "../test/shiftTestSetup";
import { resetReturnSubmitLocksForTests } from "./returnSubmitGuard";
import * as syncEngine from "../offline/syncEngine";

const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCOUNT = "sb:sales-sync-returnvoid-fix-01";
const SHOP_A = "11111111-1111-4111-8111-111111111111";

function product(stockOnHand = 20): Product {
  return {
    id: PRODUCT_ID,
    name: "Soap",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 3_000,
    stockOnHand,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 2,
    updatedAt: "2026-09-06T08:00:00.000Z",
    version: 1,
  };
}

function line(quantity: number, lineTotalUgx: number): SaleLine {
  return {
    id: "line-1",
    productId: PRODUCT_ID,
    name: "Soap",
    quantity,
    unitPriceUgx: lineTotalUgx / quantity,
    unitCostUgx: 3_000,
    estimatedProfitUgx: lineTotalUgx - quantity * 3_000,
    inputMode: "quantity",
    lineTotalUgx,
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "totalUgx">): Sale {
  const total = partial.totalUgx;
  const debt = partial.debtUgx ?? 0;
  return {
    id: SALE_ID,
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    status: "completed",
    subtotalUgx: total,
    cashPaidUgx: partial.cashPaidUgx ?? Math.max(0, total - debt),
    debtUgx: debt,
    estimatedProfitUgx: Math.max(0, total - 15_000),
    lines: partial.lines ?? [line(5, total)],
    pendingSync: false,
    lastSyncError: null,
    customerId: null,
    paymentMethod: "cash",
    tenderCashUgx: partial.tenderCashUgx ?? total,
    ...partial,
  };
}

function seedStore(s: Sale) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    preferences: createDefaultPreferences(),
    products: [product(20)],
    sales: [s],
    archivedSales: [],
    customers: [],
    returnRecords: [],
    archivedReturnRecords: [],
    voidRecords: [],
    archivedVoidRecords: [],
    stockMovements: [],
    archivedStockMovements: [],
    draftLines: [],
  });
  expect(openTestShift().ok).toBe(true);
}

function queuedKinds(calls: unknown[][]): string[] {
  return calls.map((c) => String((c[0] as { kind?: string })?.kind ?? ""));
}

function unsyncedSaleCount(): number {
  return usePosStore.getState().sales.filter((s) => s.pendingSync === true).length;
}

function op(partial: Partial<SyncOperation> & Pick<SyncOperation, "id" | "kind">): SyncOperation {
  return {
    payload: {},
    createdAt: "2026-09-07T10:00:00.000Z",
    attempts: 0,
    lastAttemptAt: null,
    shopId: SHOP_A,
    ...partial,
  };
}

describe("SALES-SYNC-RETURNVOID-FIX-01 source locks", () => {
  it("checkout stamps cloudCompleteFinancials before any return can shrink the header", () => {
    const store = readFileSync(resolve(process.cwd(), "src/store/usePosStore.ts"), "utf8");
    const engine = readFileSync(resolve(process.cwd(), "src/offline/syncEngine.ts"), "utf8");
    expect(store).toContain("cloudCompleteFinancials: captureCloudCompleteFinancials({");
    expect(engine).toContain("probeBlockedReturnRecovery");
    expect(engine).toContain("hasBlockedReturnRecoveryAttempt");
    expect(engine).toContain("markBlockedReturnRecoveryAttempted");
  });

  it("return/void processors no longer re-complete the sale", () => {
    const sync = readFileSync(resolve(process.cwd(), "src/offline/cloudSync.ts"), "utf8");
    const helperStart = sync.indexOf("async function processPendingReturnAdjustment");
    const helperEnd = sync.indexOf("async function processSaleVoidAdjustment");
    const returnHelper = sync.slice(helperStart, helperEnd);
    expect(returnHelper).not.toContain("pushSaleRowToCloud");
    expect(returnHelper).not.toContain("shop_push_sale_complete");
    const voidStart = sync.indexOf("async function processSaleVoidAdjustment");
    const voidEnd = sync.indexOf("async function pushCashExpenseToCloud");
    const voidHelper = sync.slice(voidStart, voidEnd);
    expect(voidHelper).not.toContain("shop_push_sale_complete");
    expect(voidHelper).not.toContain("pushSaleRowToCloud");
    expect(sync).toContain("mergeReturnRecordsForRecovery(state.returnRecords, cloud.returnCloudRows)");
    expect(sync).not.toContain("mergeReturnRecordsForRecovery([], cloud.returnCloudRows)");
  });

  it("voidSaleLine no longer queues a sale re-completion", () => {
    const store = readFileSync(resolve(process.cwd(), "src/store/usePosStore.ts"), "utf8");
    const start = store.indexOf("voidSaleLine: ({ saleId, lineIndex, reason, note })");
    const end = store.indexOf("returnProduct: ({ saleId, productId, quantity");
    const voidFn = store.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(voidFn).not.toContain('queueRemote("sale"');
    expect(voidFn).toContain("pendingSync: sale.pendingSync === true");
  });
});

describe("SALES-SYNC-RETURNVOID-FIX-01 helpers", () => {
  it("SALE_CLOUD_ACKED is pendingSync !== true", () => {
    expect(isSaleCloudAcked({ pendingSync: false })).toBe(true);
    expect(isSaleCloudAcked({ pendingSync: true })).toBe(false);
    expect(isSaleCloudAcked(null)).toBe(false);
    expect(linkedSaleAdjustmentDecision({ pendingSync: true }, SALE_ID)).toBe("wait");
    expect(linkedSaleAdjustmentDecision({ pendingSync: false }, SALE_ID)).toBe("proceed");
    expect(linkedSaleAdjustmentDecision({ pendingSync: false }, null)).toBe("proceed");
  });

  it("WAIT does not increment attempts, lastAttemptAt, or backoff", () => {
    const before = op({ id: "w1", kind: "pending_returns", attempts: 2, lastAttemptAt: null });
    const waited = markSyncOpWaitingForSale(before);
    expect(waited.attempts).toBe(2);
    expect(waited.lastAttemptAt).toBeNull();
    expect(waited.lastError).toBe(WAITING_FOR_SALE_ERROR);
    expect(shouldRetrySyncOp(waited)).toBe(true);
    const failed = markSyncOpFailed(before);
    expect(failed.attempts).toBe(3);
    expect(failed.lastAttemptAt).toBeTruthy();
    expect(shouldRetrySyncOp(failed, Date.now())).toBe(false);
  });

  it("closed-date park stays distinct from WAIT", () => {
    const waitRow = op({
      id: "wait",
      kind: "pending_returns",
      lastError: WAITING_FOR_SALE_ERROR,
    });
    const parkRow = op({
      id: "park",
      kind: "pending_returns",
      lastError: "closed_business_date",
      closedDateKey: "2026-09-01",
      attempts: 1,
      lastAttemptAt: "2026-09-07T11:00:00.000Z",
    });
    const snap = buildSyncForensicSnapshot({
      queue: [waitRow, parkRow],
      nowMs: Date.parse("2026-09-07T12:00:00.000Z"),
      dayCloses: [
        {
          id: "close-2026-09-01",
          dateKey: "2026-09-01",
          expectedCashUgx: 0,
          countedCashUgx: 0,
          differenceUgx: 0,
          totalSalesUgx: 0,
          totalDebtUgx: 0,
          profitEstimateUgx: 0,
          createdAt: "2026-09-01T20:00:00.000Z",
        },
      ],
      activeShopId: SHOP_A,
      accountKeyPresent: true,
      authenticated: true,
      actorRole: "owner",
      online: true,
    });
    expect(snap.rows.find((r) => r.id === "wait")?.classification).toBe("WAITING_FOR_SALE");
    expect(snap.rows.find((r) => r.id === "park")?.classification).toBe("CLOSED_DATE_PARK");
    expect(deriveQueueHealth([waitRow])).toBe("healthy");
    expect(shouldRetrySyncOp(parkRow, Date.parse("2026-09-07T12:00:00.000Z"), [
      {
        id: "close-2026-09-01",
        dateKey: "2026-09-01",
        expectedCashUgx: 0,
        countedCashUgx: 0,
        differenceUgx: 0,
        totalSalesUgx: 0,
        totalDebtUgx: 0,
        profitEstimateUgx: 0,
        createdAt: "2026-09-01T20:00:00.000Z",
      },
    ])).toBe(false);
  });

  it("sale uploads are partitioned before return/void adjustments", () => {
    const saleOp = op({ id: "s1", kind: "pending_sales", createdAt: "2026-09-07T10:00:01.000Z" });
    const retOp = op({ id: "r1", kind: "pending_returns", createdAt: "2026-09-07T10:00:00.000Z" });
    const voidOp = op({ id: "v1", kind: "pending_stock_updates", createdAt: "2026-09-07T10:00:00.000Z" });
    const productOp = op({ id: "p1", kind: "product", createdAt: "2026-09-07T10:00:00.000Z" });
    const { saleUploads, other } = partitionSaleBeforeAdjustment([retOp, voidOp, saleOp, productOp]);
    expect(saleUploads.map((o) => o.id)).toEqual(["s1"]);
    expect(other.map((o) => o.id)).toEqual(["r1", "v1", "p1"]);
  });
});

describe("SALES-SYNC-RETURNVOID-FIX-01 store enqueue", () => {
  let enqueueSpy: { mock: { calls: unknown[][] }; mockRestore: () => void };

  beforeEach(() => {
    resetReturnSubmitLocksForTests();
    setActiveAccountKey(ACCOUNT);
    setCachedShopId(null);
    enqueueSpy = vi.spyOn(syncEngine, "enqueueSync").mockResolvedValue(undefined);
  });

  afterEach(() => {
    enqueueSpy.mockRestore();
    resetReturnSubmitLocksForTests();
    setActiveAccountKey(null);
    setCachedShopId(null);
  });

  it("normal checkout still marks pendingSync and queues pending_sales", () => {
    seedStore(sale({ totalUgx: 50_000 }));
    usePosStore.setState({
      sales: [],
      draftLines: [line(1, 10_000)],
      draftCartDiscountUgx: 0,
      draftPaymentMethod: "cash",
      draftSaleCustomerId: "",
      draftSaleCustomerName: "",
      draftSaleCustomerPhone: "",
      activePendingSaleId: null,
      draftInput: null,
    });
    const done = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(done.ok).toBe(true);
    const created = usePosStore.getState().sales[0]!;
    expect(created.pendingSync).toBe(true);
    expect(created.cloudCompleteFinancials?.totalUgx).toBe(created.totalUgx);
    expect(queuedKinds(enqueueSpy.mock.calls)).toContain("pending_sales");
    expect(unsyncedSaleCount()).toBe(1);
  });

  it("return of a cloud-ACKed sale does not enqueue sale or set pendingSync", () => {
    seedStore(sale({ totalUgx: 50_000, pendingSync: false }));
    const r = usePosStore.getState().returnProduct({
      saleId: SALE_ID,
      productId: PRODUCT_ID,
      quantity: 1,
      refundAmountUgx: 10_000,
      reason: "wrong_item",
    });
    expect(r.ok).toBe(true);
    const next = usePosStore.getState().sales[0]!;
    expect(next.pendingSync).toBe(false);
    expect(next.totalUgx).toBe(40_000);
    expect(queuedKinds(enqueueSpy.mock.calls)).toContain("pending_returns");
    expect(queuedKinds(enqueueSpy.mock.calls)).not.toContain("sale");
    expect(queuedKinds(enqueueSpy.mock.calls)).not.toContain("pending_sales");
    expect(unsyncedSaleCount()).toBe(0);
    const queued = enqueueSpy.mock.calls
      .map((c) => c[0] as { id?: string; kind?: string; payload?: Record<string, unknown> })
      .filter((row) => row.kind === "pending_returns");
    expect(queued).toHaveLength(1);
    expect(queued[0]!.id).toBe(usePosStore.getState().returnRecords[0]!.id);
    expect(queued[0]!.payload?.operationType).toBe("return");
    expect(queued[0]!.payload?.saleId).toBe(SALE_ID);
  });

  it("return of a still-pending sale keeps pendingSync so checkout can finish", () => {
    seedStore(sale({
      totalUgx: 50_000,
      pendingSync: true,
      cloudCompleteFinancials: {
        subtotalUgx: 50_000,
        totalUgx: 50_000,
        cashPaidUgx: 50_000,
        debtUgx: 0,
        discountTotalUgx: 0,
      },
    }));
    const r = usePosStore.getState().returnProduct({
      saleId: SALE_ID,
      productId: PRODUCT_ID,
      quantity: 1,
      refundAmountUgx: 10_000,
      reason: "wrong_item",
    });
    expect(r.ok).toBe(true);
    const next = usePosStore.getState().sales[0]!;
    expect(next.pendingSync).toBe(true);
    expect(next.totalUgx).toBe(40_000);
    expect(next.cloudCompleteFinancials?.totalUgx).toBe(50_000);
    expect(unsyncedSaleCount()).toBe(1);
    expect(queuedKinds(enqueueSpy.mock.calls)).toContain("pending_returns");
  });

  it("void of a cloud-ACKed sale does not enqueue sale or set pendingSync", () => {
    seedStore(sale({ totalUgx: 50_000, pendingSync: false }));
    const r = usePosStore.getState().voidSaleLine({
      saleId: SALE_ID,
      lineIndex: 0,
      reason: "other",
    });
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().sales[0]!.pendingSync).toBe(false);
    expect(queuedKinds(enqueueSpy.mock.calls)).toContain("pending_stock_updates");
    expect(queuedKinds(enqueueSpy.mock.calls)).not.toContain("sale");
    expect(queuedKinds(enqueueSpy.mock.calls)).not.toContain("pending_sales");
    expect(unsyncedSaleCount()).toBe(0);
    const queued = enqueueSpy.mock.calls
      .map((c) => c[0] as { id?: string; kind?: string; payload?: Record<string, unknown> })
      .filter((row) => row.kind === "pending_stock_updates");
    expect(queued).toHaveLength(1);
    expect(queued[0]!.id).toBe(usePosStore.getState().voidRecords[0]!.id);
    expect(queued[0]!.payload?.operationType).toBe("void");
    expect(queued[0]!.payload?.saleId).toBe(SALE_ID);
  });

  it("void of a still-pending sale keeps pendingSync", () => {
    seedStore(sale({ totalUgx: 50_000, pendingSync: true }));
    const r = usePosStore.getState().voidSaleLine({
      saleId: SALE_ID,
      lineIndex: 0,
      reason: "other",
    });
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().sales[0]!.pendingSync).toBe(true);
    expect(queuedKinds(enqueueSpy.mock.calls)).not.toContain("sale");
    expect(unsyncedSaleCount()).toBe(1);
  });
});

describe("SALES-SYNC-RETURNVOID-FIX-01 full recovery merge", () => {
  it("preserves a local un-ACKed return when cloud has none", () => {
    const local: ReturnRecord = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      saleId: SALE_ID,
      productId: PRODUCT_ID,
      productName: "Soap",
      quantity: 1,
      refundAmountUgx: 10_000,
      reason: "wrong_item",
      actorUserId: "owner:1",
      createdAt: "2026-09-07T11:00:00.000Z",
    };
    const merged = mergeReturnRecordsForRecovery([local], []);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe(local.id);
  });

  it("preserves a local un-ACKed void when cloud has none", () => {
    const local: VoidRecord = {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      saleId: SALE_ID,
      lineIndex: 0,
      productId: PRODUCT_ID,
      productName: "Soap",
      quantity: 1,
      amountUgx: 10_000,
      reason: "other",
      actorUserId: "owner:1",
      createdAt: "2026-09-07T11:00:00.000Z",
    };
    const merged = mergeVoidRecordsForRecovery([local], []);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe(local.id);
  });

  it("dedupes the same return id across local and cloud", () => {
    const local: ReturnRecord = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      saleId: SALE_ID,
      productId: PRODUCT_ID,
      productName: "Soap",
      quantity: 1,
      refundAmountUgx: 10_000,
      reason: "wrong_item",
      actorUserId: "owner:1",
      createdAt: "2026-09-07T11:00:00.000Z",
    };
    const merged = mergeReturnRecordsForRecovery([local], [
      { record: { ...local, note: "cloud" }, updatedAt: "2026-09-07T12:00:00.000Z" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.note).toBe("cloud");
  });
});

describe("WAKA-SYNC-ARCHITECTURE-ADAPTATION-01 forensic + permissions", () => {
  it("forensic snapshot identifies a return adjustment without exposing the raw sale id", () => {
    const row = op({
      id: "ret-forensic",
      kind: "pending_returns",
      payload: { returnId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", saleId: SALE_ID, operationType: "return" },
    });
    const snap = buildSyncForensicSnapshot({
      queue: [row],
      nowMs: Date.parse("2026-09-07T12:00:00.000Z"),
      dayCloses: [],
      activeShopId: SHOP_A,
      accountKeyPresent: true,
      authenticated: true,
      actorRole: "owner",
      online: true,
    });
    expect(snap.rows[0]?.payloadClass).toBe("return");
    expect(snap.rows[0]?.operationType).toBe("return");
    expect(snap.rows[0]?.saleIdRedacted).toBe(`${SALE_ID.slice(0, 8)}…`);
    expect(JSON.stringify(snap.rows[0])).not.toContain(SALE_ID);
  });

  it("forensic snapshot identifies a void adjustment", () => {
    const row = op({
      id: "void-forensic",
      kind: "pending_stock_updates",
      payload: { referenceType: "sale_void", saleId: SALE_ID, operationType: "void" },
    });
    const snap = buildSyncForensicSnapshot({
      queue: [row],
      nowMs: Date.parse("2026-09-07T12:00:00.000Z"),
      dayCloses: [],
      activeShopId: SHOP_A,
      accountKeyPresent: true,
      authenticated: true,
      actorRole: "owner",
      online: true,
    });
    expect(snap.rows[0]?.payloadClass).toBe("void");
    expect(snap.rows[0]?.operationType).toBe("void");
    expect(snap.rows[0]?.classification).toBe("READY");
  });

  it("return and void still require sale_void permission", () => {
    const store = readFileSync(resolve(process.cwd(), "src/store/usePosStore.ts"), "utf8");
    const voidFn = store.slice(
      store.indexOf("voidSaleLine: ({ saleId, lineIndex, reason, note })"),
      store.indexOf("returnProduct: ({ saleId, productId, quantity"),
    );
    const returnFn = store.slice(store.indexOf("returnProduct: ({ saleId, productId, quantity"));
    expect(voidFn).toContain('denyUnlessEffectivePermission("sale_void"');
    expect(returnFn).toContain('denyUnlessEffectivePermission("sale_void"');
  });
});

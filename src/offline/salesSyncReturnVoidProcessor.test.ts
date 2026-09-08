/**
 * SALES-SYNC-RETURNVOID-FIX-01 — return/void processors never re-complete the sale.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product, ReturnRecord, Sale, SaleLine, SyncOperation, VoidRecord } from "../types";
import { r3SaleVoidStockPayload } from "../lib/stockDurableSync";
import { syncProcessLastError, syncProcessStatus } from "../lib/saleAdjustmentSync";
import { captureCloudCompleteFinancials } from "../lib/saleCloudCompleteFinancials";
import { buildSalePushPayload } from "./cloudSync";
import { readLastBlockedReturnProbe, resetBlockedReturnRecoveryForTests } from "../lib/blockedReturnRecovery";
import { usePosStore } from "../store/usePosStore";

const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "11111111-1111-4111-8111-111111111111" } } },
      }),
    },
  },
}));

vi.mock("../lib/organizationDeletionState", () => ({
  assertOrganizationOperationsAllowed: async () => undefined,
}));

const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RETURN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VOID_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SHOP_ID = "11111111-1111-4111-8111-111111111111";

function line(): SaleLine {
  return {
    id: "line-1",
    productId: PRODUCT_ID,
    name: "Soap",
    quantity: 5,
    unitPriceUgx: 10_000,
    unitCostUgx: 3_000,
    estimatedProfitUgx: 35_000,
    inputMode: "quantity",
    lineTotalUgx: 50_000,
  };
}

function sale(pendingSync: boolean): Sale {
  return {
    id: SALE_ID,
    status: "completed",
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    subtotalUgx: 50_000,
    totalUgx: 50_000,
    cashPaidUgx: 50_000,
    debtUgx: 0,
    estimatedProfitUgx: 35_000,
    lines: [line()],
    pendingSync,
    lastSyncError: null,
  };
}

function product(): Product {
  return {
    id: PRODUCT_ID,
    name: "Soap",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 3_000,
    stockOnHand: 20,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 2,
    updatedAt: "2026-09-06T08:00:00.000Z",
    version: 1,
  };
}

function returnRec(saleId: string | null = SALE_ID): ReturnRecord {
  return {
    id: RETURN_ID,
    saleId,
    productId: PRODUCT_ID,
    productName: "Soap",
    quantity: 1,
    refundAmountUgx: 10_000,
    reason: "wrong_item",
    actorUserId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-09-07T11:00:00.000Z",
  };
}

function voidRec(): VoidRecord {
  return {
    id: VOID_ID,
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
}

function op(kind: SyncOperation["kind"], payload: Record<string, unknown>): SyncOperation {
  return {
    id: `op-${kind}`,
    kind,
    payload,
    createdAt: "2026-09-07T11:00:00.000Z",
    attempts: 0,
    lastAttemptAt: null,
    shopId: SHOP_ID,
  };
}

function seed(opts?: { pendingSync?: boolean; saleId?: string | null; omitSale?: boolean }) {
  usePosStore.setState({
    sales: opts?.omitSale ? [] : [sale(opts?.pendingSync ?? false)],
    archivedSales: [],
    products: [product()],
    returnRecords: [returnRec(opts?.saleId === undefined ? SALE_ID : opts.saleId)],
    archivedReturnRecords: [],
    voidRecords: [voidRec()],
    archivedVoidRecords: [],
  });
}

function thenableQuery(data: unknown, error: unknown = null) {
  const query: {
    select: () => typeof query;
    eq: () => typeof query;
    in: () => typeof query;
    maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>;
  } = {
    select: () => query,
    eq: () => query,
    in: () => query,
    maybeSingle: async () => ({ data, error }),
    then: (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject),
  };
  return query;
}

function mockCeilingCloud(input: { totalUgx: number; quantity: number; lineTotalUgx: number }) {
  fromMock.mockImplementation((table: unknown) => {
    if (table === "sales") {
      return thenableQuery({ id: SALE_ID, shop_id: SHOP_ID, total_ugx: input.totalUgx });
    }
    if (table === "sale_line_items") {
      return thenableQuery([
        { product_id: PRODUCT_ID, quantity: input.quantity, line_total_ugx: input.lineTotalUgx },
      ]);
    }
    if (table === "sale_returns") return thenableQuery([]);
    return thenableQuery(null, { message: "unknown_table" });
  });
}

describe("SALES-SYNC-RETURNVOID-FIX-01 processors", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    fromMock.mockReset();
    fromMock.mockImplementation(() => thenableQuery(null, { message: "unmocked" }));
    resetBlockedReturnRecoveryForTests();
  });

  it("pending_returns of a cloud-ACKed sale does not call shop_push_sale_complete", async () => {
    seed({ pendingSync: false });
    const cloudSync = await import("./cloudSync");
    const saleSpy = vi.spyOn(cloudSync, "pushSaleRowToCloud");
    const result = await cloudSync.processCloudSyncOperationResult(
      op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID }),
    );
    expect(result).toBe("ack");
    expect(saleSpy).not.toHaveBeenCalled();
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual(["shop_push_sale_return"]);
    expect(rpcMock.mock.calls.map((c) => c[0])).not.toContain("shop_push_sale_complete");
    saleSpy.mockRestore();
  });

  it("sale_void of a cloud-ACKed sale does not call shop_push_sale_complete", async () => {
    seed({ pendingSync: false });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    const result = await processCloudSyncOperationResult(
      op(
        "pending_stock_updates",
        r3SaleVoidStockPayload({
          productId: PRODUCT_ID,
          delta: 1,
          voidRecordId: VOID_ID,
          saleId: SALE_ID,
          amountUgx: 10_000,
          lineIndex: 0,
          productName: "Soap",
        }),
      ),
    );
    expect(result).toBe("ack");
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual(["shop_apply_sale_void_stock"]);
    expect(rpcMock.mock.calls.map((c) => c[0])).not.toContain("shop_push_sale_complete");
  });

  it("return waits when the linked sale is not cloud-ACKed", async () => {
    seed({ pendingSync: true });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    const result = await processCloudSyncOperationResult(
      op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID }),
    );
    expect(result).toBe("wait");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("void waits when the linked sale is not cloud-ACKed", async () => {
    seed({ pendingSync: true });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    const result = await processCloudSyncOperationResult(
      op(
        "pending_stock_updates",
        r3SaleVoidStockPayload({
          productId: PRODUCT_ID,
          delta: 1,
          voidRecordId: VOID_ID,
          saleId: SALE_ID,
          amountUgx: 10_000,
          lineIndex: 0,
        }),
      ),
    );
    expect(result).toBe("wait");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("once the sale is ACKed the return uploads", async () => {
    seed({ pendingSync: true });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    expect(
      await processCloudSyncOperationResult(op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID })),
    ).toBe("wait");
    usePosStore.setState({ sales: [sale(false)] });
    expect(
      await processCloudSyncOperationResult(op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID })),
    ).toBe("ack");
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual(["shop_push_sale_return"]);
  });

  it("once the sale is ACKed the void uploads", async () => {
    seed({ pendingSync: true });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    const voidOp = op(
      "pending_stock_updates",
      r3SaleVoidStockPayload({
        productId: PRODUCT_ID,
        delta: 1,
        voidRecordId: VOID_ID,
        saleId: SALE_ID,
        amountUgx: 10_000,
        lineIndex: 0,
      }),
    );
    expect(await processCloudSyncOperationResult(voidOp)).toBe("wait");
    usePosStore.setState({ sales: [sale(false)] });
    expect(await processCloudSyncOperationResult(voidOp)).toBe("ack");
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual(["shop_apply_sale_void_stock"]);
  });

  it("unlinked return uploads without waiting for a sale", async () => {
    seed({ saleId: null });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    const result = await processCloudSyncOperationResult(op("pending_returns", { returnId: RETURN_ID }));
    expect(result).toBe("ack");
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual(["shop_push_sale_return"]);
  });

  it("sale_not_found is BLOCKED_BUSINESS and does not re-complete the sale", async () => {
    seed({ pendingSync: false });
    rpcMock.mockResolvedValue({ data: { ok: false, error: "sale_not_found" }, error: null });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    const result = await processCloudSyncOperationResult(
      op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID }),
    );
    expect(syncProcessStatus(result)).toBe("block");
    expect(syncProcessLastError(result)).toBe("sale_not_found");
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual(["shop_push_sale_return"]);
    expect(rpcMock.mock.calls.map((c) => c[0])).not.toContain("shop_push_sale_complete");
  });

  it("duplicate return upload stays idempotent", async () => {
    seed({ pendingSync: false });
    rpcMock.mockResolvedValue({ data: { ok: true, idempotent: true }, error: null });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    const row = op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID });
    expect(await processCloudSyncOperationResult(row)).toBe("ack");
    expect(await processCloudSyncOperationResult(row)).toBe("ack");
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual(["shop_push_sale_return", "shop_push_sale_return"]);
  });

  it("duplicate void upload stays idempotent", async () => {
    seed({ pendingSync: false });
    rpcMock.mockResolvedValue({ data: { ok: true, idempotent: true }, error: null });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    const row = op(
      "pending_stock_updates",
      r3SaleVoidStockPayload({
        productId: PRODUCT_ID,
        delta: 1,
        voidRecordId: VOID_ID,
        saleId: SALE_ID,
        amountUgx: 10_000,
        lineIndex: 0,
      }),
    );
    expect(await processCloudSyncOperationResult(row)).toBe("ack");
    expect(await processCloudSyncOperationResult(row)).toBe("ack");
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual([
      "shop_apply_sale_void_stock",
      "shop_apply_sale_void_stock",
    ]);
  });

  it("crash after server ACK remains safe on replay", async () => {
    seed({ pendingSync: false });
    rpcMock.mockResolvedValue({ data: { ok: true, idempotent: true }, error: null });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    const row = op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID });
    expect(await processCloudSyncOperationResult(row)).toBe("ack");
    expect(await processCloudSyncOperationResult(row)).toBe("ack");
    expect(usePosStore.getState().returnRecords).toHaveLength(1);
  });

  it("crash before server commit leaves the local record and stays retryable", async () => {
    seed({ pendingSync: false });
    rpcMock.mockResolvedValue({ data: null, error: { message: "network" } });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    const row = op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID });
    const failed = await processCloudSyncOperationResult(row);
    expect(syncProcessStatus(failed)).toBe("retry");
    expect(syncProcessLastError(failed)).toBe("rpc_failed");
    expect(usePosStore.getState().returnRecords).toHaveLength(1);
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await processCloudSyncOperationResult(row)).toBe("ack");
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual(["shop_push_sale_return"]);
  });

  it("closed-date void does not re-complete the sale", async () => {
    seed({ pendingSync: false });
    rpcMock.mockResolvedValue({ data: { ok: false, error: "closed_business_date" }, error: null });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    const result = await processCloudSyncOperationResult(
      op(
        "pending_stock_updates",
        r3SaleVoidStockPayload({
          productId: PRODUCT_ID,
          delta: 1,
          voidRecordId: VOID_ID,
          saleId: SALE_ID,
          amountUgx: 10_000,
          lineIndex: 0,
        }),
      ),
    );
    expect(result).toBe("retry");
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual(["shop_apply_sale_void_stock"]);
    expect(rpcMock.mock.calls.map((c) => c[0])).not.toContain("shop_push_sale_complete");
  });

  it("closed-date return parks instead of waiting for sale", async () => {
    seed({ pendingSync: false });
    rpcMock.mockResolvedValue({ data: { ok: false, error: "closed_business_date" }, error: null });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    const result = await processCloudSyncOperationResult(
      op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID }),
    );
    expect(result).toBe("park");
    expect(syncProcessLastError(result)).toBeUndefined();
  });

  it("refund_exceeds_remaining is BLOCK with allowlisted lastError", async () => {
    seed({ pendingSync: false });
    rpcMock.mockResolvedValue({ data: { ok: false, error: "refund_exceeds_remaining" }, error: null });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    const result = await processCloudSyncOperationResult(
      op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID }),
    );
    expect(syncProcessStatus(result)).toBe("block");
    expect(syncProcessLastError(result)).toBe("refund_exceeds_remaining");
  });

  it("PostgREST 401 is RETRY with 401", async () => {
    seed({ pendingSync: false });
    rpcMock.mockResolvedValue({ data: null, error: { code: "401", message: "JWT expired for kasule" } });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    const result = await processCloudSyncOperationResult(
      op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID }),
    );
    expect(syncProcessStatus(result)).toBe("retry");
    expect(syncProcessLastError(result)).toBe("401");
  });

  it("boolean ACK wrapper still treats ok as true", async () => {
    seed({ pendingSync: false });
    const { processCloudSyncOperation } = await import("./cloudSync");
    expect(await processCloudSyncOperation(op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID }))).toBe(
      true,
    );
  });

  it("blocked business rejection does not masquerade as success", async () => {
    seed({ pendingSync: false });
    rpcMock.mockResolvedValue({ data: { ok: false, error: "refund_exceeds_remaining" }, error: null });
    const { processCloudSyncOperation } = await import("./cloudSync");
    expect(await processCloudSyncOperation(op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID }))).toBe(
      false,
    );
  });

  it("sale 2000 → local return shrinks live header → uploads still send 2000 / 2000 and both ACK", async () => {
    const snapshot = captureCloudCompleteFinancials({
      subtotalUgx: 2000,
      totalUgx: 2000,
      cashPaidUgx: 2000,
      debtUgx: 0,
      discountTotalUgx: 0,
    });
    const pending: Sale = {
      ...sale(true),
      subtotalUgx: 0,
      totalUgx: 0,
      cashPaidUgx: 0,
      estimatedProfitUgx: 0,
      voidedTotalUgx: 2000,
      cloudCompleteFinancials: snapshot,
      lines: [{ ...line(), quantity: 2, unitPriceUgx: 1000, lineTotalUgx: 2000 }],
    };
    const ret: ReturnRecord = {
      ...returnRec(SALE_ID),
      quantity: 2,
      refundAmountUgx: 2000,
      reason: "warm_bad",
    };
    usePosStore.setState({
      sales: [pending],
      archivedSales: [],
      products: [product()],
      returnRecords: [ret],
      archivedReturnRecords: [],
      voidRecords: [],
      archivedVoidRecords: [],
    });
    const salePayload = buildSalePushPayload(pending, { shopId: SHOP_ID, userId: SHOP_ID });
    expect(pending.totalUgx).toBe(0);
    expect(pending.cloudCompleteFinancials?.totalUgx).toBe(2000);
    expect(salePayload.sale.total_ugx).toBe(2000);
    expect(salePayload.payments[0]?.amount_ugx).toBe(2000);
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    expect(
      await processCloudSyncOperationResult(op("pending_sales", { saleId: SALE_ID })),
    ).toBe("ack");
    expect(rpcMock.mock.calls[0]?.[0]).toBe("shop_push_sale_complete");
    expect((rpcMock.mock.calls[0]?.[1] as { p_payload?: { sale?: { total_ugx?: number } } }).p_payload?.sale?.total_ugx).toBe(
      2000,
    );
    rpcMock.mockClear();
    usePosStore.setState({ sales: [{ ...pending, pendingSync: false }] });
    expect(
      await processCloudSyncOperationResult(op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID })),
    ).toBe("ack");
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual(["shop_push_sale_return"]);
    expect(
      (rpcMock.mock.calls[0]?.[1] as { p_payload?: { refund_amount_ugx?: number; quantity?: number } }).p_payload
        ?.refund_amount_ugx,
    ).toBe(2000);
    expect(
      (rpcMock.mock.calls[0]?.[1] as { p_payload?: { quantity?: number } }).p_payload?.quantity,
    ).toBe(2);
  });

  it("probe stays false when cloud total is below the refund", async () => {
    seed({ pendingSync: false });
    mockCeilingCloud({ totalUgx: 1000, quantity: 1, lineTotalUgx: 1000 });
    const { probeBlockedReturnRecovery } = await import("./cloudSync");
    const blocked = op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID });
    blocked.lastError = "refund_exceeds_remaining";
    expect(await probeBlockedReturnRecovery(blocked)).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(readLastBlockedReturnProbe()).toMatchObject({
      ok: false,
      blocker: "ceiling",
      ceilingError: "refund_exceeds_remaining",
      cloudSaleTotalUgx: 1000,
      saleRowPresent: true,
    });
  });

  it("probe is true when cloud total is 0 but this return already exists", async () => {
    seed({ pendingSync: false });
    fromMock.mockImplementation((table: unknown) => {
      if (table === "sales") {
        return thenableQuery({ id: SALE_ID, shop_id: SHOP_ID, total_ugx: 0, cash_amount_ugx: 0 });
      }
      if (table === "sale_line_items") {
        return thenableQuery([
          { product_id: PRODUCT_ID, quantity: 1, line_total_ugx: 10_000 },
        ]);
      }
      if (table === "sale_returns") {
        return thenableQuery([
          {
            id: RETURN_ID,
            shop_id: SHOP_ID,
            sale_id: SALE_ID,
            product_id: PRODUCT_ID,
            quantity: 1,
            refund_amount_ugx: 10_000,
            reason: "wrong_item",
            created_at: "2026-09-07T11:00:00.000Z",
          },
        ]);
      }
      return thenableQuery(null, { message: "unknown_table" });
    });
    const { probeBlockedReturnRecovery } = await import("./cloudSync");
    const blocked = op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID });
    blocked.lastError = "refund_exceeds_remaining";
    expect(await probeBlockedReturnRecovery(blocked)).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(readLastBlockedReturnProbe()).toMatchObject({
      ok: true,
      blocker: "none",
      cloudSaleTotalUgx: 0,
      saleRowPresent: true,
    });
  });

  it("already-synced return ACKs leftover queue without shop_push_sale_return", async () => {
    seed({ pendingSync: false });
    fromMock.mockImplementation((table: unknown) => {
      if (table === "sale_returns") {
        return thenableQuery({
          id: RETURN_ID,
          sale_id: SALE_ID,
          product_id: PRODUCT_ID,
          quantity: 1,
          refund_amount_ugx: 10_000,
        });
      }
      return thenableQuery(null, { message: "unmocked" });
    });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    const result = await processCloudSyncOperationResult(
      op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID }),
    );
    expect(result).toBe("ack");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("legitimate return can recover after cloud ceilings would pass, then ACK", async () => {
    seed({ pendingSync: false });
    mockCeilingCloud({ totalUgx: 10_000, quantity: 5, lineTotalUgx: 50_000 });
    const { probeBlockedReturnRecovery, processCloudSyncOperationResult } = await import("./cloudSync");
    const blocked = op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID });
    blocked.lastError = "refund_exceeds_remaining";
    expect(await probeBlockedReturnRecovery(blocked)).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
    const result = await processCloudSyncOperationResult(blocked);
    expect(result).toBe("ack");
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual(["shop_push_sale_return"]);
    expect(rpcMock.mock.calls.map((c) => c[0])).not.toContain("shop_push_sale_complete");
  });

  it("authenticated empty SELECT is not treated as a missing sale and does not call the RPC", async () => {
    seed({ pendingSync: false });
    fromMock.mockImplementation((table: unknown) => {
      if (table === "sales") return thenableQuery(null, null);
      if (table === "sale_line_items") return thenableQuery([]);
      if (table === "sale_returns") return thenableQuery([]);
      return thenableQuery(null, { message: "unknown_table" });
    });
    const { probeBlockedReturnRecovery } = await import("./cloudSync");
    const blocked = op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID });
    blocked.lastError = "refund_exceeds_remaining";
    expect(await probeBlockedReturnRecovery(blocked)).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(readLastBlockedReturnProbe()).toMatchObject({
      ok: false,
      blocker: "select_empty",
      saleRowPresent: false,
      cloudSaleTotalUgx: null,
    });
  });
});

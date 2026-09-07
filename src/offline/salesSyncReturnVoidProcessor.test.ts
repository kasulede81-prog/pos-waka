/**
 * SALES-SYNC-RETURNVOID-FIX-01 — return/void processors never re-complete the sale.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product, ReturnRecord, Sale, SaleLine, SyncOperation, VoidRecord } from "../types";
import { r3SaleVoidStockPayload } from "../lib/stockDurableSync";
import { usePosStore } from "../store/usePosStore";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
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

describe("SALES-SYNC-RETURNVOID-FIX-01 processors", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
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

  it("sale_not_found remains retryable and does not re-complete the sale", async () => {
    seed({ pendingSync: false });
    rpcMock.mockResolvedValue({ data: { ok: false, error: "sale_not_found" }, error: null });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    const result = await processCloudSyncOperationResult(
      op("pending_returns", { returnId: RETURN_ID, saleId: SALE_ID }),
    );
    expect(result).toBe("retry");
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
    expect(await processCloudSyncOperationResult(row)).toBe("retry");
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
  });
});

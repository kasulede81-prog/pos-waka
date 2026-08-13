import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sale, SyncOperation } from "../types";
import { usePosStore } from "../store/usePosStore";
import { readSyncQueue, removeSyncOperation } from "./localDb";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "u1" } } } }),
    },
  },
}));

const SALE_ID = "fa5093c8-4179-4aaa-b774-c9416c1569c5";
const SHOP_ID = "1a110d2e-d957-4c6e-a936-8af86403a836";
const ctx = { shopId: SHOP_ID, userId: "11111111-1111-4111-8111-111111111111" };

function cancelledSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: SALE_ID,
    status: "cancelled",
    lines: [],
    subtotalUgx: 1000,
    totalUgx: 1000,
    cashPaidUgx: 0,
    debtUgx: 0,
    estimatedProfitUgx: 0,
    createdAt: "2026-08-10T23:46:25.000Z",
    pendingSync: true,
    lastSyncError: "not_found_or_not_draft",
    ...overrides,
  };
}

describe("pushCancelPendingSaleToCloud idempotent ACK", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    vi.mocked(readSyncQueue).mockReset();
    vi.mocked(removeSyncOperation).mockReset();
    vi.mocked(readSyncQueue).mockResolvedValue([]);
    vi.mocked(removeSyncOperation).mockResolvedValue(undefined);
    usePosStore.setState({
      sales: [cancelledSale()],
    });
  });

  it("ACKs already_cancelled without calling pending or complete upsert", async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, already_cancelled: true, sale_id: SALE_ID },
      error: null,
    });
    const { pushSaleRowToCloud } = await import("./cloudSync");
    const ok = await pushSaleRowToCloud(cancelledSale(), ctx);
    expect(ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("shop_cancel_pending_sale", {
      p_shop_id: SHOP_ID,
      p_sale_id: SALE_ID,
    });
    expect(rpcMock.mock.calls.map((c) => c[0])).not.toContain("shop_push_pending_sale");
    expect(rpcMock.mock.calls.map((c) => c[0])).not.toContain("shop_push_sale_complete");
    const sale = usePosStore.getState().sales.find((s) => s.id === SALE_ID);
    expect(sale?.pendingSync).toBe(false);
    expect(sale?.lastSyncError).toBeNull();
    expect(sale?.status).toBe("cancelled");
  });

  it("keeps pendingSync when the sale is genuinely missing", async () => {
    rpcMock.mockResolvedValue({
      data: { ok: false, error: "not_found_or_not_draft" },
      error: null,
    });
    const { pushCancelPendingSaleToCloud } = await import("./cloudSync");
    const ok = await pushCancelPendingSaleToCloud(SALE_ID, ctx);
    expect(ok).toBe(false);
    const sale = usePosStore.getState().sales.find((s) => s.id === SALE_ID);
    expect(sale?.pendingSync).toBe(true);
    expect(sale?.lastSyncError).toBe("not_found_or_not_draft");
  });

  it("keeps pendingSync when unauthorized", async () => {
    rpcMock.mockResolvedValue({
      data: { ok: false, error: "forbidden" },
      error: null,
    });
    const { pushCancelPendingSaleToCloud } = await import("./cloudSync");
    const ok = await pushCancelPendingSaleToCloud(SALE_ID, ctx);
    expect(ok).toBe(false);
    expect(usePosStore.getState().sales[0]?.pendingSync).toBe(true);
    expect(usePosStore.getState().sales[0]?.lastSyncError).toBe("forbidden");
  });

  it("settles the matching cancel queue op on success", async () => {
    const op: SyncOperation = {
      id: "op-cancel-1",
      kind: "pending_sales",
      payload: { saleId: SALE_ID, kind: "pending_cancel" },
      createdAt: "2026-08-11T00:50:20.000Z",
      attempts: 12,
      lastAttemptAt: "2026-08-13T15:40:00.000Z",
    };
    vi.mocked(readSyncQueue).mockResolvedValue([op]);
    rpcMock.mockResolvedValue({
      data: { ok: true, already_cancelled: true, sale_id: SALE_ID },
      error: null,
    });
    const { pushCancelPendingSaleToCloud } = await import("./cloudSync");
    expect(await pushCancelPendingSaleToCloud(SALE_ID, ctx)).toBe(true);
    expect(vi.mocked(removeSyncOperation)).toHaveBeenCalledWith("op-cancel-1");
  });

  it("does not reopen a cancelled sale through pending upsert", async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, already_cancelled: true, sale_id: SALE_ID },
      error: null,
    });
    const { pushPendingSaleToCloud } = await import("./cloudSync");
    const ok = await pushPendingSaleToCloud(cancelledSale(), ctx);
    expect(ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("shop_cancel_pending_sale", expect.any(Object));
    expect(rpcMock).not.toHaveBeenCalledWith("shop_push_pending_sale", expect.anything());
  });
});

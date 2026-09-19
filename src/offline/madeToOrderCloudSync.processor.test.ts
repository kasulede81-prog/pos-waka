/**
 * Phase 5 — how made-to-order voids/returns and the sale itself reach the cloud.
 * The RPCs are mocked here (their real SQL is exercised in madeToOrderCloudStock.sql.integration.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product, ReturnRecord, Sale, SaleLine, SyncOperation, VoidRecord } from "../types";
import { r3SaleVoidStockPayload } from "../lib/stockDurableSync";
import { buildSalePushPayload } from "./cloudSync";
import { usePosStore } from "../store/usePosStore";
import { resetBlockedReturnRecoveryForTests } from "../lib/blockedReturnRecovery";

const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
    auth: { getSession: async () => ({ data: { session: { user: { id: "11111111-1111-4111-8111-111111111111" } } } }) },
  },
}));
vi.mock("../lib/organizationDeletionState", () => ({ assertOrganizationOperationsAllowed: async () => undefined }));

const SHOP = "11111111-1111-4111-8111-111111111111";
const SALE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BURGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BEEF = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LINE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const VOID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const RETURN = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const recipeLine = (): SaleLine => ({
  id: LINE,
  productId: BURGER,
  name: "Burger",
  quantity: 3,
  unitPriceUgx: 20_000,
  unitCostUgx: 9_500,
  cogsUgx: 28_500,
  estimatedProfitUgx: 31_500,
  inputMode: "quantity",
  lineTotalUgx: 60_000,
  ingredientConsumption: [{ productId: BEEF, quantity: 3 }],
});

const sale = (pendingSync = false): Sale => ({
  id: SALE,
  status: "completed",
  createdAt: "2026-09-06T10:00:00.000Z",
  updatedAt: "2026-09-06T10:00:00.000Z",
  subtotalUgx: 60_000,
  totalUgx: 60_000,
  cashPaidUgx: 60_000,
  debtUgx: 0,
  estimatedProfitUgx: 31_500,
  lines: [recipeLine()],
  pendingSync,
  lastSyncError: null,
});

const product = (id: string, name: string, stock: number): Product => ({
  id,
  name,
  sellingPricePerUnitUgx: 20_000,
  costPricePerUnitUgx: 1_000,
  stockOnHand: stock,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 0,
  updatedAt: "2026-09-06T08:00:00.000Z",
  version: 1,
});

const voidRec = (): VoidRecord => ({
  id: VOID,
  saleId: SALE,
  lineIndex: 0,
  productId: BURGER,
  productName: "Burger",
  quantity: 1,
  amountUgx: 20_000,
  reason: "other",
  actorUserId: "owner:1",
  createdAt: "2026-09-07T11:00:00.000Z",
  saleLineId: LINE,
});

const op = (kind: SyncOperation["kind"], payload: Record<string, unknown>): SyncOperation => ({
  id: `op-${kind}`,
  kind,
  payload,
  createdAt: "2026-09-07T11:00:00.000Z",
  attempts: 0,
  lastAttemptAt: null,
  shopId: SHOP,
});

const recipeVoidOp = () =>
  op(
    "pending_stock_updates",
    r3SaleVoidStockPayload({
      productId: BURGER,
      delta: 1,
      voidRecordId: VOID,
      saleId: SALE,
      amountUgx: 20_000,
      lineIndex: 0,
      productName: "Burger",
      saleLineId: LINE,
      recipeLine: true,
    }),
  );

function seed(pendingSync = false) {
  usePosStore.setState({
    sales: [sale(pendingSync)],
    archivedSales: [],
    products: [product(BURGER, "Burger", 0), product(BEEF, "Beef", 97)],
    returnRecords: [],
    archivedReturnRecords: [],
    voidRecords: [voidRec()],
    archivedVoidRecords: [],
  });
}

// (the best-effort line "voided" flag sync that follows every acknowledged void is not what is under test)
const calls = () => rpcMock.mock.calls.map((c) => c[0] as string).filter((n) => n !== "shop_sync_sale_line_void_state");

function thenableQuery(data: unknown, error: unknown = null) {
  const query: Record<string, unknown> = {
    select: () => query,
    eq: () => query,
    in: () => query,
    maybeSingle: async () => ({ data, error }),
    then: (resolve: (v: { data: unknown; error: unknown }) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(resolve, reject),
  };
  return query;
}
const stockOf = (id: string) => usePosStore.getState().products.find((p) => p.id === id)!.stockOnHand;

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
  fromMock.mockReset();
  fromMock.mockImplementation(() => thenableQuery(null, { message: "unmocked" }));
  resetBlockedReturnRecoveryForTests();
});

describe("void of a made-to-order recipe line", () => {
  it("goes through the line-bound RPC with only the line, quantity and financials — never an ingredient amount", async () => {
    seed();
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    expect(await processCloudSyncOperationResult(recipeVoidOp())).toBe("ack");
    expect(calls()).toEqual(["shop_apply_sale_void_line_stock"]);
    const first = rpcMock.mock.calls.find((c) => c[0] === "shop_apply_sale_void_line_stock")!;
    const payload = (first[1] as { p_payload: Record<string, unknown> }).p_payload;
    expect(payload).toMatchObject({
      void_record_id: VOID,
      sale_id: SALE,
      sale_line_id: LINE,
      delta: 1,
      amount_ugx: 20_000,
    });
    expect(payload).not.toHaveProperty("product_id");
    expect(JSON.stringify(payload)).not.toContain(BEEF);
  });

  it("the ingredient stock the cloud returns becomes the local truth", async () => {
    seed();
    rpcMock.mockResolvedValue({
      data: { ok: true, idempotent: false, stocks: [{ product_id: BEEF, stock_on_hand: 98, updated_at: "2026-09-07T12:00:00.000Z" }] },
      error: null,
    });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    expect(await processCloudSyncOperationResult(recipeVoidOp())).toBe("ack");
    expect(stockOf(BEEF)).toBe(98);
  });

  it("a cloud that predates the RPC falls back to the previous void RPC (which matches its own sale application)", async () => {
    seed();
    rpcMock.mockImplementation(async (name: string) =>
      name === "shop_apply_sale_void_line_stock"
        ? { data: null, error: { code: "PGRST202", message: "function not found" } }
        : { data: { ok: true }, error: null },
    );
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    expect(await processCloudSyncOperationResult(recipeVoidOp())).toBe("ack");
    expect(calls()).toEqual(["shop_apply_sale_void_line_stock", "shop_apply_sale_void_stock"]);
    const legacyArgs = (rpcMock.mock.calls.find((c) => c[0] === "shop_apply_sale_void_stock")![1] as { p_payload: Record<string, unknown> }).p_payload;
    expect(legacyArgs).toMatchObject({ product_id: BURGER, void_record_id: VOID, delta: 1, sale_id: SALE });
  });

  it("a refusal (e.g. void_exceeds_line) is retried, never acknowledged", async () => {
    seed();
    rpcMock.mockResolvedValue({ data: { ok: false, error: "void_exceeds_line" }, error: null });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    expect(await processCloudSyncOperationResult(recipeVoidOp())).toBe("retry");
    expect(calls()).toEqual(["shop_apply_sale_void_line_stock"]); // no silent fallback that would credit the dish
  });

  it("offline retry: a network error is retried, then the same op succeeds and a replay is a harmless ack", async () => {
    seed();
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "FETCH", message: "network" } });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    expect(await processCloudSyncOperationResult(recipeVoidOp())).toBe("retry");
    rpcMock.mockResolvedValue({ data: { ok: true, idempotent: false, stocks: [] }, error: null });
    expect(await processCloudSyncOperationResult(recipeVoidOp())).toBe("ack");
    rpcMock.mockResolvedValue({ data: { ok: true, idempotent: true, stocks: [] }, error: null });
    expect(await processCloudSyncOperationResult(recipeVoidOp())).toBe("ack"); // multi-device / stale replay
  });

  it("waits for the sale to be cloud-acknowledged first (the cloud must know the line before it can reverse it)", async () => {
    seed(true);
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    expect(await processCloudSyncOperationResult(recipeVoidOp())).toBe("wait");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("a non-recipe void (retail / batch-prepared / legacy) still uses the previous RPC, exactly as before", async () => {
    seed();
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    const retail = op(
      "pending_stock_updates",
      r3SaleVoidStockPayload({ productId: BURGER, delta: 1, voidRecordId: VOID, saleId: SALE, amountUgx: 20_000, lineIndex: 0, saleLineId: LINE }),
    );
    expect(await processCloudSyncOperationResult(retail)).toBe("ack");
    expect(calls()).toEqual(["shop_apply_sale_void_stock"]);
  });
});

describe("return of a line", () => {
  it("carries the sale line id in the return's metadata (the cloud binds the reversal to that line)", async () => {
    seed();
    const ret: ReturnRecord = {
      id: RETURN,
      saleId: SALE,
      productId: BURGER,
      productName: "Burger",
      quantity: 1,
      refundAmountUgx: 20_000,
      reason: "wrong_item",
      saleLineId: LINE,
      actorUserId: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-09-07T11:00:00.000Z",
    };
    usePosStore.setState({ returnRecords: [ret] });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    expect(await processCloudSyncOperationResult(op("pending_returns", { returnId: RETURN, saleId: SALE }))).toBe("ack");
    const payload = (rpcMock.mock.calls[0]![1] as { p_payload: { metadata: Record<string, unknown> } }).p_payload;
    expect(calls()).toEqual(["shop_push_sale_return"]);
    expect(payload.metadata.saleLineId).toBe(LINE);
  });

  it("a legacy return without a line id sends none (the cloud resolves or refuses it)", async () => {
    seed();
    const ret: ReturnRecord = {
      id: RETURN,
      saleId: SALE,
      productId: BURGER,
      productName: "Burger",
      quantity: 1,
      refundAmountUgx: 20_000,
      reason: "wrong_item",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-09-07T11:00:00.000Z",
    };
    usePosStore.setState({ returnRecords: [ret] });
    const { processCloudSyncOperationResult } = await import("./cloudSync");
    await processCloudSyncOperationResult(op("pending_returns", { returnId: RETURN, saleId: SALE }));
    const payload = (rpcMock.mock.calls[0]![1] as { p_payload: { metadata: Record<string, unknown> } }).p_payload;
    expect(payload.metadata).not.toHaveProperty("saleLineId");
  });
});

describe("the sale itself", () => {
  const retail: SaleLine = {
    id: "11111111-2222-4333-8444-555555555555",
    productId: "99999999-9999-4999-8999-999999999999",
    name: "Coke",
    quantity: 2,
    unitPriceUgx: 2_000,
    unitCostUgx: 1_200,
    estimatedProfitUgx: 1_600,
    inputMode: "quantity",
    lineTotalUgx: 4_000,
  };

  it("pushes each line under its own id with the recorded ingredient provenance, and none for a retail line", () => {
    const s = { ...sale(), lines: [recipeLine(), retail], subtotalUgx: 64_000, totalUgx: 64_000, cashPaidUgx: 64_000 };
    const payload = buildSalePushPayload(s, { shopId: SHOP, userId: "11111111-1111-4111-8111-111111111111" });
    const lines = payload.lines as Array<{ id: string; product_id: string; metadata: Record<string, unknown> }>;
    expect(lines.map((l) => l.id)).toEqual([LINE, retail.id]);
    expect(lines[0]!.metadata.ingredientConsumption).toEqual([{ productId: BEEF, quantity: 3 }]);
    expect(lines[1]!.metadata).not.toHaveProperty("ingredientConsumption");
    // the historical money on the line is exactly the sale-time snapshot
    expect(lines[0]!.metadata).toMatchObject({ unitCostUgx: 9_500, cogsUgx: 28_500 });
  });

  it("a sale with an EMPTY provenance still marks the line as made-to-order (an empty array, not absent)", () => {
    const line = { ...recipeLine(), ingredientConsumption: [] };
    const payload = buildSalePushPayload({ ...sale(), lines: [line] }, { shopId: SHOP, userId: "11111111-1111-4111-8111-111111111111" });
    expect((payload.lines as Array<{ metadata: Record<string, unknown> }>)[0]!.metadata.ingredientConsumption).toEqual([]);
  });
});

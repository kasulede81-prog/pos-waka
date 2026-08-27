import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TransferEngineSimulator,
  destinationWacAfterTransferReceive,
  transferDispatchOperationKey,
  transferReceiveOperationKey,
  validateReceiveLinesInput,
} from "./stockTransferEngine";

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TRANSFER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LINE_1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LINE_2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SRC_P1 = "11111111-1111-4111-8111-111111111111";
const SRC_P2 = "22222222-2222-4222-8222-222222222222";
const DST_P1 = "33333333-3333-4333-8333-333333333333";
const DST_P2 = "44444444-4444-4444-8444-444444444444";
const R1 = "55555555-5555-4555-8555-555555555555";
const R2 = "66666666-6666-4666-8666-666666666666";

function freshSim(): TransferEngineSimulator {
  const sim = new TransferEngineSimulator();
  sim.addProduct({ id: SRC_P1, shopId: SHOP_A, stockOnHand: 100, costPricePerUnitUgx: 2000 });
  sim.addProduct({ id: SRC_P2, shopId: SHOP_A, stockOnHand: 50, costPricePerUnitUgx: 1000 });
  sim.addProduct({ id: DST_P1, shopId: SHOP_B, stockOnHand: 10, costPricePerUnitUgx: 2000 });
  sim.addProduct({ id: DST_P2, shopId: SHOP_B, stockOnHand: 0, costPricePerUnitUgx: 0 });
  sim.upsertDraft({
    id: TRANSFER_ID,
    fromShopId: SHOP_A,
    toShopId: SHOP_B,
    status: "draft",
    lines: [
      {
        id: LINE_1,
        sourceProductId: SRC_P1,
        destinationProductId: DST_P1,
        quantity: 30,
        receivedQuantity: 0,
        unitCostUgx: 0,
      },
    ],
  });
  return sim;
}

describe("MB-4B transfer engine (simulator)", () => {
  let sim: TransferEngineSimulator;

  beforeEach(() => {
    sim = freshSim();
  });

  it("T1 — normal dispatch decreases source once and moves to IN_TRANSIT", () => {
    const result = sim.dispatch(TRANSFER_ID);
    expect(result).toEqual({ ok: true });
    expect(sim.products.get(SRC_P1)!.stockOnHand).toBe(70);
    expect(sim.transfers.get(TRANSFER_ID)!.status).toBe("in_transit");
    expect(sim.appliedMovements.size).toBe(1);
    expect(sim.transfers.get(TRANSFER_ID)!.lines[0]!.unitCostUgx).toBe(2000);
  });

  it("T2 — duplicate dispatch is idempotent (no second decrease)", () => {
    sim.dispatch(TRANSFER_ID);
    const second = sim.dispatch(TRANSFER_ID);
    expect(second).toEqual({ ok: true, idempotent: true });
    expect(sim.products.get(SRC_P1)!.stockOnHand).toBe(70);
    expect(sim.appliedMovements.size).toBe(1);
  });

  it("T3 — crash/retry after dispatch commit is idempotent", () => {
    expect(sim.dispatch(TRANSFER_ID).ok).toBe(true);
    for (let i = 0; i < 5; i++) {
      const retry = sim.dispatch(TRANSFER_ID);
      expect(retry.ok).toBe(true);
      expect(retry).toHaveProperty("idempotent", true);
    }
    expect(sim.products.get(SRC_P1)!.stockOnHand).toBe(70);
  });

  it("T4 — first partial receipt adds destination stock once", () => {
    sim.transfers.get(TRANSFER_ID)!.lines[0]!.quantity = 100;
    sim.dispatch(TRANSFER_ID);
    const result = sim.receive(TRANSFER_ID, R1, [{ lineId: LINE_1, quantity: 40 }]);
    expect(result).toEqual({ ok: true, status: "in_transit" });
    expect(sim.products.get(DST_P1)!.stockOnHand).toBe(50);
    expect(sim.transfers.get(TRANSFER_ID)!.lines[0]!.receivedQuantity).toBe(40);
  });

  it("T5 — retry same partial receipt is idempotent", () => {
    sim.transfers.get(TRANSFER_ID)!.lines[0]!.quantity = 100;
    sim.dispatch(TRANSFER_ID);
    sim.receive(TRANSFER_ID, R1, [{ lineId: LINE_1, quantity: 40 }]);
    const retry = sim.receive(TRANSFER_ID, R1, [{ lineId: LINE_1, quantity: 40 }]);
    expect(retry).toEqual({ ok: true, idempotent: true, status: "in_transit" });
    expect(sim.products.get(DST_P1)!.stockOnHand).toBe(50);
    expect(sim.transfers.get(TRANSFER_ID)!.lines[0]!.receivedQuantity).toBe(40);
  });

  it("T6 — second legitimate receipt completes transfer", () => {
    sim.transfers.get(TRANSFER_ID)!.lines[0]!.quantity = 100;
    sim.dispatch(TRANSFER_ID);
    sim.receive(TRANSFER_ID, R1, [{ lineId: LINE_1, quantity: 40 }]);
    const result = sim.receive(TRANSFER_ID, R2, [{ lineId: LINE_1, quantity: 60 }]);
    expect(result).toEqual({ ok: true, status: "received" });
    expect(sim.products.get(DST_P1)!.stockOnHand).toBe(110);
    expect(sim.transfers.get(TRANSFER_ID)!.status).toBe("received");
  });

  it("T7 — concurrent duplicate receive_event_id applies once", () => {
    sim.transfers.get(TRANSFER_ID)!.lines[0]!.quantity = 100;
    sim.dispatch(TRANSFER_ID);
    const a = sim.receive(TRANSFER_ID, R1, [{ lineId: LINE_1, quantity: 40 }]);
    const b = sim.receive(TRANSFER_ID, R1, [{ lineId: LINE_1, quantity: 40 }]);
    expect(a.ok && b.ok).toBe(true);
    expect(sim.products.get(DST_P1)!.stockOnHand).toBe(50);
    expect(sim.appliedMovements.size).toBe(2); // 1 dispatch + 1 receive
  });

  it("T8 — over-receipt rejected with zero stock mutation", () => {
    sim.transfers.get(TRANSFER_ID)!.lines[0]!.quantity = 100;
    sim.dispatch(TRANSFER_ID);
    sim.receive(TRANSFER_ID, R1, [{ lineId: LINE_1, quantity: 40 }]);
    const stockBefore = sim.products.get(DST_P1)!.stockOnHand;
    const result = sim.receive(TRANSFER_ID, R2, [{ lineId: LINE_1, quantity: 61 }]);
    expect(result).toEqual({ ok: false, error: "over_receive" });
    expect(sim.products.get(DST_P1)!.stockOnHand).toBe(stockBefore);
  });

  it("T9 — receive before dispatch rejected", () => {
    const result = sim.receive(TRANSFER_ID, R1, [{ lineId: LINE_1, quantity: 10 }]);
    expect(result).toEqual({ ok: false, error: "invalid_status" });
    expect(sim.products.get(DST_P1)!.stockOnHand).toBe(10);
  });

  it("T10 — insufficient source stock rejects dispatch atomically", () => {
    sim.transfers.get(TRANSFER_ID)!.lines[0]!.quantity = 100;
    sim.products.get(SRC_P1)!.stockOnHand = 90;
    const result = sim.dispatch(TRANSFER_ID);
    expect(result).toEqual({ ok: false, error: "insufficient_stock" });
    expect(sim.products.get(SRC_P1)!.stockOnHand).toBe(90);
    expect(sim.transfers.get(TRANSFER_ID)!.status).toBe("draft");
    expect(sim.appliedMovements.size).toBe(0);
  });

  it("T11 — destination WAC uses canonical weighted average (10@2000 + 10@2500 → 20@2250)", () => {
    sim.transfers.get(TRANSFER_ID)!.lines[0]!.quantity = 10;
    sim.products.get(DST_P1)!.stockOnHand = 10;
    sim.products.get(DST_P1)!.costPricePerUnitUgx = 2000;
    sim.dispatch(TRANSFER_ID);
    sim.transfers.get(TRANSFER_ID)!.lines[0]!.unitCostUgx = 2500;
    sim.receive(TRANSFER_ID, R1, [{ lineId: LINE_1, quantity: 10 }]);
    expect(sim.products.get(DST_P1)!.costPricePerUnitUgx).toBe(
      destinationWacAfterTransferReceive(10, 2000, 10, 2500),
    );
    expect(sim.products.get(DST_P1)!.costPricePerUnitUgx).toBe(2250);
  });

  it("T12 — receive event survives offline replay (same event id)", () => {
    sim.transfers.get(TRANSFER_ID)!.lines[0]!.quantity = 100;
    sim.dispatch(TRANSFER_ID);
    for (let i = 0; i < 100; i++) {
      const r = sim.receive(TRANSFER_ID, R1, [{ lineId: LINE_1, quantity: 40 }]);
      expect(r.ok).toBe(true);
    }
    expect(sim.products.get(DST_P1)!.stockOnHand).toBe(50);
    expect(sim.transfers.get(TRANSFER_ID)!.lines[0]!.receivedQuantity).toBe(40);
  });

  it("T14 — multi-line dispatch/receive with independent product mapping", () => {
    sim.upsertDraft({
      id: TRANSFER_ID,
      fromShopId: SHOP_A,
      toShopId: SHOP_B,
      status: "draft",
      lines: [
        {
          id: LINE_1,
          sourceProductId: SRC_P1,
          destinationProductId: DST_P1,
          quantity: 30,
          receivedQuantity: 0,
          unitCostUgx: 0,
        },
        {
          id: LINE_2,
          sourceProductId: SRC_P2,
          destinationProductId: DST_P2,
          quantity: 20,
          receivedQuantity: 0,
          unitCostUgx: 0,
        },
      ],
    });
    expect(sim.dispatch(TRANSFER_ID).ok).toBe(true);
    expect(sim.products.get(SRC_P1)!.stockOnHand).toBe(70);
    expect(sim.products.get(SRC_P2)!.stockOnHand).toBe(30);
    expect(sim.appliedMovements.size).toBe(2);

    sim.receive(TRANSFER_ID, R1, [
      { lineId: LINE_1, quantity: 30 },
      { lineId: LINE_2, quantity: 20 },
    ]);
    expect(sim.products.get(DST_P1)!.stockOnHand).toBe(40);
    expect(sim.products.get(DST_P2)!.stockOnHand).toBe(20);
    expect(sim.transfers.get(TRANSFER_ID)!.status).toBe("received");
  });

  it("T15 — dispatch is all-or-nothing (partial failure rolls back)", () => {
    sim.upsertDraft({
      id: TRANSFER_ID,
      fromShopId: SHOP_A,
      toShopId: SHOP_B,
      status: "draft",
      lines: [
        {
          id: LINE_1,
          sourceProductId: SRC_P1,
          destinationProductId: DST_P1,
          quantity: 30,
          receivedQuantity: 0,
          unitCostUgx: 0,
        },
        {
          id: LINE_2,
          sourceProductId: SRC_P2,
          destinationProductId: DST_P2,
          quantity: 100,
          receivedQuantity: 0,
          unitCostUgx: 0,
        },
      ],
    });
    const result = sim.dispatch(TRANSFER_ID);
    expect(result).toEqual({ ok: false, error: "insufficient_stock" });
    expect(sim.products.get(SRC_P1)!.stockOnHand).toBe(100);
    expect(sim.products.get(SRC_P2)!.stockOnHand).toBe(50);
    expect(sim.transfers.get(TRANSFER_ID)!.status).toBe("draft");
    expect(sim.appliedMovements.size).toBe(0);
  });

  it("draft cancel only; in-transit cancel rejected", () => {
    expect(sim.cancel(TRANSFER_ID).ok).toBe(true);
    expect(sim.cancel(TRANSFER_ID)).toEqual({ ok: true, idempotent: true });
    sim.upsertDraft({
      id: TRANSFER_ID,
      fromShopId: SHOP_A,
      toShopId: SHOP_B,
      status: "draft",
      lines: sim.transfers.get(TRANSFER_ID)!.lines,
    });
    sim.dispatch(TRANSFER_ID);
    expect(sim.cancel(TRANSFER_ID)).toEqual({ ok: false, error: "invalid_status" });
  });

  it("durable operation keys are deterministic", () => {
    expect(transferDispatchOperationKey(SHOP_A, TRANSFER_ID, SRC_P1)).toBe(
      `transfer_dispatch:${SHOP_A}:${TRANSFER_ID}:${SRC_P1}`,
    );
    expect(transferReceiveOperationKey(SHOP_B, R1, DST_P1)).toBe(
      `transfer_receive:${SHOP_B}:${R1}:${DST_P1}`,
    );
  });

  it("validateReceiveLinesInput catches empty and over-receive", () => {
    const state = new Map([[LINE_1, { quantity: 100, receivedQuantity: 40 }]]);
    expect(validateReceiveLinesInput([], state)).toEqual({ ok: false, error: "no_lines" });
    expect(validateReceiveLinesInput([{ lineId: LINE_1, quantity: 61 }], state)).toEqual({
      ok: false,
      error: "over_receive",
    });
  });

  it("rejects duplicate source and destination products in draft", () => {
    const dupSrc = sim.upsertDraft({
      id: TRANSFER_ID,
      fromShopId: SHOP_A,
      toShopId: SHOP_B,
      status: "draft",
      lines: [
        {
          id: LINE_1,
          sourceProductId: SRC_P1,
          destinationProductId: DST_P1,
          quantity: 5,
          receivedQuantity: 0,
          unitCostUgx: 0,
        },
        {
          id: LINE_2,
          sourceProductId: SRC_P1,
          destinationProductId: DST_P2,
          quantity: 3,
          receivedQuantity: 0,
          unitCostUgx: 0,
        },
      ],
    });
    expect(dupSrc).toEqual({ ok: false, error: "duplicate_source_product" });

    const dupDst = sim.upsertDraft({
      id: "transfer-dup-dst",
      fromShopId: SHOP_A,
      toShopId: SHOP_B,
      status: "draft",
      lines: [
        {
          id: LINE_1,
          sourceProductId: SRC_P1,
          destinationProductId: DST_P1,
          quantity: 5,
          receivedQuantity: 0,
          unitCostUgx: 0,
        },
        {
          id: LINE_2,
          sourceProductId: SRC_P2,
          destinationProductId: DST_P1,
          quantity: 3,
          receivedQuantity: 0,
          unitCostUgx: 0,
        },
      ],
    });
    expect(dupDst).toEqual({ ok: false, error: "duplicate_destination_product" });
  });
});

describe("MB-4B transfer queue shop stamp (T13)", () => {
  const queueState = vi.hoisted(() => ({ ops: [] as { kind: string; shopId?: string; payload: unknown }[] }));

  vi.mock("../../offline/syncEngine", () => ({
    enqueueSync: async (op: { kind: string; shopId?: string; payload: unknown }) => {
      queueState.ops.push(op);
    },
  }));

  vi.mock("../../offline/shopScope", () => ({
    getActiveShopId: () => SHOP_B,
  }));

  beforeEach(() => {
    queueState.ops = [];
  });

  it("T13 — dispatch/receive queue ops keep immutable from/to shopId", async () => {
    const { queueTransferDispatch, queueTransferReceive } = await import("./stockTransferSync");
    await queueTransferDispatch(TRANSFER_ID, SHOP_A);
    await queueTransferReceive(TRANSFER_ID, R1, [{ lineId: LINE_1, quantity: 5 }], SHOP_B);
    expect(queueState.ops[0]).toMatchObject({ kind: "pending_transfer_dispatch", shopId: SHOP_A });
    expect(queueState.ops[1]).toMatchObject({ kind: "pending_transfer_receive", shopId: SHOP_B });
  });
});

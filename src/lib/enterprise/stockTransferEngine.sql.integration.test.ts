import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  createTransferEngineSqlHarness,
  rpcJson,
  seedTransferFixture,
  type SqlExec,
  type TransferFixture,
} from "../../test/sqlIntegration/transferEnginePgHarness";

describe("MB-4B transfer engine — real SQL (migration 167)", () => {
  let exec: SqlExec;
  let fx: TransferFixture;

  beforeAll(async () => {
    exec = await createTransferEngineSqlHarness();
    fx = await seedTransferFixture(exec);
  }, 120_000);

  afterAll(async () => {
    await exec?.close();
  });

  async function upsertDraft(
    userId: string,
    lines: { sourceProductId: string; destinationProductId: string; quantity: number }[],
    opts?: { fromShopId?: string; toShopId?: string },
  ): Promise<{ ok: boolean; transferId?: string; error?: string }> {
    return asUser(exec, userId, async () => {
      const payload = {
        from_shop_id: opts?.fromShopId ?? fx.fromShopId,
        to_shop_id: opts?.toShopId ?? fx.toShopId,
        lines: lines.map((l) => ({
          source_product_id: l.sourceProductId,
          destination_product_id: l.destinationProductId,
          quantity: l.quantity,
        })),
      };
      const { rows } = await exec.query(
        `SELECT public.enterprise_transfer_upsert_draft($1::jsonb) AS enterprise_transfer_upsert_draft`,
        [JSON.stringify(payload)],
      );
      const j = rpcJson(rows[0]);
      return { ok: j.ok === true, transferId: j.transfer_id as string | undefined, error: j.error as string | undefined };
    });
  }

  async function dispatch(userId: string, transferId: string) {
    return asUser(exec, userId, async () => {
      const { rows } = await exec.query(
        `SELECT public.enterprise_transfer_dispatch($1::uuid) AS enterprise_transfer_dispatch`,
        [transferId],
      );
      return rpcJson(rows[0]);
    });
  }

  async function receive(
    userId: string,
    transferId: string,
    receiveEventId: string,
    lines: { lineId: string; quantity: number }[],
  ) {
    return asUser(exec, userId, async () => {
      const { rows } = await exec.query(
        `SELECT public.enterprise_transfer_receive($1::uuid, $2::uuid, $3::jsonb) AS enterprise_transfer_receive`,
        [transferId, receiveEventId, JSON.stringify(lines.map((l) => ({ line_id: l.lineId, quantity: l.quantity })))],
      );
      return rpcJson(rows[0]);
    });
  }

  async function cancel(userId: string, transferId: string) {
    return asUser(exec, userId, async () => {
      const { rows } = await exec.query(
        `SELECT public.enterprise_transfer_cancel($1::uuid) AS enterprise_transfer_cancel`,
        [transferId],
      );
      return rpcJson(rows[0]);
    });
  }

  async function getLineId(transferId: string): Promise<string> {
    const { rows } = await exec.query<{ id: string }>(
      `SELECT id FROM public.enterprise_stock_transfer_lines WHERE transfer_id = $1 LIMIT 1`,
      [transferId],
    );
    return rows[0]!.id;
  }

  async function sourceStock(): Promise<number> {
    const { rows } = await exec.query<{ stock_on_hand: string }>(
      `SELECT stock_on_hand FROM public.products WHERE id = $1`,
      [fx.sourceProductId],
    );
    return Number(rows[0]!.stock_on_hand);
  }

  async function destStock(): Promise<number> {
    const { rows } = await exec.query<{ stock_on_hand: string }>(
      `SELECT stock_on_hand FROM public.products WHERE id = $1`,
      [fx.destProductId],
    );
    return Number(rows[0]!.stock_on_hand);
  }

  async function destWac(): Promise<number> {
    const { rows } = await exec.query<{ cost_price_per_unit_ugx: string; metadata: Record<string, unknown> }>(
      `SELECT cost_price_per_unit_ugx, metadata FROM public.products WHERE id = $1`,
      [fx.destProductId],
    );
    const exact = rows[0]?.metadata?.exactCostPricePerUnitUgx;
    return exact != null ? Number(exact) : Number(rows[0]!.cost_price_per_unit_ugx);
  }

  async function dispatchMovementCount(transferId: string): Promise<number> {
    const { rows } = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.inventory_movements
       WHERE reference_type = 'transfer_dispatch' AND reference_id = $1`,
      [transferId],
    );
    return Number(rows[0]!.c);
  }

  async function receiveMovementCount(receiveEventId: string): Promise<number> {
    const { rows } = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.inventory_movements
       WHERE reference_type = 'transfer_receive' AND reference_id = $1`,
      [receiveEventId],
    );
    return Number(rows[0]!.c);
  }

  it("T-SQL-1 DISPATCH ONCE", async () => {
    const draft = await upsertDraft(fx.sourceUserId, [
      { sourceProductId: fx.sourceProductId, destinationProductId: fx.destProductId, quantity: 30 },
    ]);
    expect(draft.ok).toBe(true);
    const transferId = draft.transferId!;

    const before = await sourceStock();
    const d = await dispatch(fx.sourceUserId, transferId);
    expect(d.ok).toBe(true);
    expect(d.status).toBe("in_transit");
    expect(await sourceStock()).toBe(before - 30);
    expect(await dispatchMovementCount(transferId)).toBe(1);
  });

  it("T-SQL-2 DUPLICATE DISPATCH REPLAY", async () => {
    const draft = await upsertDraft(fx.sourceUserId, [
      { sourceProductId: fx.sourceProduct2Id, destinationProductId: fx.destProduct2Id, quantity: 10 },
    ]);
    const transferId = draft.transferId!;
    await dispatch(fx.sourceUserId, transferId);
    const stockAfterFirst = await exec.query<{ stock_on_hand: string }>(
      `SELECT stock_on_hand FROM public.products WHERE id = $1`,
      [fx.sourceProduct2Id],
    );
    const mid = Number(stockAfterFirst.rows[0]!.stock_on_hand);

    const replay = await dispatch(fx.sourceUserId, transferId);
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    const after = await exec.query<{ stock_on_hand: string }>(
      `SELECT stock_on_hand FROM public.products WHERE id = $1`,
      [fx.sourceProduct2Id],
    );
    expect(Number(after.rows[0]!.stock_on_hand)).toBe(mid);
    expect(await dispatchMovementCount(transferId)).toBe(1);
  });

  it("T-SQL-3 RECEIVE ONCE + WAC", async () => {
    await exec.exec(
      `UPDATE public.products SET cost_price_per_unit_ugx = 2500, metadata = '{}'::jsonb WHERE id = '${fx.sourceProductId}'`,
    );
    const draft = await upsertDraft(fx.sourceUserId, [
      { sourceProductId: fx.sourceProductId, destinationProductId: fx.destProductId, quantity: 10 },
    ]);
    const transferId = draft.transferId!;
    await dispatch(fx.sourceUserId, transferId);
    const lineId = await getLineId(transferId);
    const eventId = crypto.randomUUID();
    const beforeDest = await destStock();

    const r = await receive(fx.destUserId, transferId, eventId, [{ lineId, quantity: 10 }]);
    expect(r.ok).toBe(true);
    expect(await destStock()).toBe(beforeDest + 10);
    expect(await receiveMovementCount(eventId)).toBe(1);
    expect(await destWac()).toBe(2250);
  });

  it("T-SQL-4 SAME RECEIVE EVENT REPLAY", async () => {
    const draft = await upsertDraft(fx.sourceUserId, [
      { sourceProductId: fx.sourceProduct2Id, destinationProductId: fx.destProduct2Id, quantity: 5 },
    ]);
    const transferId = draft.transferId!;
    await dispatch(fx.sourceUserId, transferId);
    const lineId = await getLineId(transferId);
    const eventId = crypto.randomUUID();
    await receive(fx.destUserId, transferId, eventId, [{ lineId, quantity: 5 }]);
    const wacAfter = await exec.query<{ cost_price_per_unit_ugx: string }>(
      `SELECT cost_price_per_unit_ugx FROM public.products WHERE id = $1`,
      [fx.destProduct2Id],
    );
    const stockMid = await exec.query<{ stock_on_hand: string }>(
      `SELECT stock_on_hand FROM public.products WHERE id = $1`,
      [fx.destProduct2Id],
    );

    const replay = await receive(fx.destUserId, transferId, eventId, [{ lineId, quantity: 5 }]);
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    expect(Number(stockMid.rows[0]!.stock_on_hand)).toBe(5);
    const stockAfter = await exec.query<{ stock_on_hand: string }>(
      `SELECT stock_on_hand FROM public.products WHERE id = $1`,
      [fx.destProduct2Id],
    );
    expect(Number(stockAfter.rows[0]!.stock_on_hand)).toBe(Number(stockMid.rows[0]!.stock_on_hand));
    expect(Number(wacAfter.rows[0]!.cost_price_per_unit_ugx)).toBe(
      Number(
        (
          await exec.query<{ cost_price_per_unit_ugx: string }>(
            `SELECT cost_price_per_unit_ugx FROM public.products WHERE id = $1`,
            [fx.destProduct2Id],
          )
        ).rows[0]!.cost_price_per_unit_ugx,
      ),
    );
    expect(await receiveMovementCount(eventId)).toBe(1);
  });

  it("T-SQL-5 DIFFERENT PARTIAL RECEIVE EVENTS", async () => {
    await exec.exec(
      `UPDATE public.products SET stock_on_hand = 200, cost_price_per_unit_ugx = 2500, metadata = '{}'::jsonb
       WHERE id = '${fx.sourceProductId}'`,
    );
    await exec.exec(
      `UPDATE public.products SET stock_on_hand = 10, cost_price_per_unit_ugx = 2000,
       metadata = '{"exactCostPricePerUnitUgx": 2000}' WHERE id = '${fx.destProductId}'`,
    );
    const draft = await upsertDraft(fx.sourceUserId, [
      { sourceProductId: fx.sourceProductId, destinationProductId: fx.destProductId, quantity: 100 },
    ]);
    const transferId = draft.transferId!;
    await dispatch(fx.sourceUserId, transferId);
    const lineId = await getLineId(transferId);

    await receive(fx.destUserId, transferId, crypto.randomUUID(), [{ lineId, quantity: 40 }]);
    expect(await destStock()).toBe(50);
    await receive(fx.destUserId, transferId, crypto.randomUUID(), [{ lineId, quantity: 60 }]);
    expect(await destStock()).toBe(110);
    expect(await destWac()).toBeCloseTo(2454.5454545454545, 8);
    const { rows } = await exec.query<{ status: string }>(
      `SELECT status FROM public.enterprise_stock_transfers WHERE id = $1`,
      [transferId],
    );
    expect(rows[0]!.status).toBe("received");
  });

  it("T-SQL-6 OVER-RECEIPT atomic rejection", async () => {
    const draft = await upsertDraft(fx.sourceUserId, [
      { sourceProductId: fx.sourceProduct2Id, destinationProductId: fx.destProduct2Id, quantity: 20 },
    ]);
    const transferId = draft.transferId!;
    await dispatch(fx.sourceUserId, transferId);
    const lineId = await getLineId(transferId);
    const beforeStock = await exec.query<{ stock_on_hand: string }>(
      `SELECT stock_on_hand FROM public.products WHERE id = $1`,
      [fx.destProduct2Id],
    );
    const beforeWac = await exec.query<{ cost_price_per_unit_ugx: string }>(
      `SELECT cost_price_per_unit_ugx FROM public.products WHERE id = $1`,
      [fx.destProduct2Id],
    );
    const beforeRecv = await exec.query<{ received_quantity: string }>(
      `SELECT received_quantity FROM public.enterprise_stock_transfer_lines WHERE id = $1`,
      [lineId],
    );

    const r = await receive(fx.destUserId, transferId, crypto.randomUUID(), [{ lineId, quantity: 21 }]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("over_receive");

    const afterStock = await exec.query<{ stock_on_hand: string }>(
      `SELECT stock_on_hand FROM public.products WHERE id = $1`,
      [fx.destProduct2Id],
    );
    expect(afterStock.rows[0]!.stock_on_hand).toBe(beforeStock.rows[0]!.stock_on_hand);
    expect(
      (
        await exec.query<{ cost_price_per_unit_ugx: string }>(
          `SELECT cost_price_per_unit_ugx FROM public.products WHERE id = $1`,
          [fx.destProduct2Id],
        )
      ).rows[0]!.cost_price_per_unit_ugx,
    ).toBe(beforeWac.rows[0]!.cost_price_per_unit_ugx);
    expect(
      (
        await exec.query<{ received_quantity: string }>(
          `SELECT received_quantity FROM public.enterprise_stock_transfer_lines WHERE id = $1`,
          [lineId],
        )
      ).rows[0]!.received_quantity,
    ).toBe(beforeRecv.rows[0]!.received_quantity);
    expect(
      Number(
        (
          await exec.query<{ c: string }>(
            `SELECT count(*)::text AS c FROM public.inventory_movements WHERE reference_type = 'transfer_receive'`,
          )
        ).rows[0]!.c,
      ),
    ).toBeGreaterThanOrEqual(0);
  });

  it("T-SQL-7 RECEIVE BEFORE DISPATCH", async () => {
    const draft = await upsertDraft(fx.sourceUserId, [
      { sourceProductId: fx.sourceProductId, destinationProductId: fx.destProductId, quantity: 5 },
    ]);
    const transferId = draft.transferId!;
    const lineId = await getLineId(transferId);
    const before = await destStock();
    const r = await receive(fx.destUserId, transferId, crypto.randomUUID(), [{ lineId, quantity: 5 }]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("invalid_status");
    expect(await destStock()).toBe(before);
  });

  it("T-SQL-8 DUPLICATE SOURCE PRODUCT rejected", async () => {
    const before = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.enterprise_stock_transfer_lines`,
    );
    const r = await upsertDraft(fx.sourceUserId, [
      { sourceProductId: fx.sourceProductId, destinationProductId: fx.destProductId, quantity: 5 },
      { sourceProductId: fx.sourceProductId, destinationProductId: fx.destProduct2Id, quantity: 3 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("duplicate_source_product");
    const after = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.enterprise_stock_transfer_lines`,
    );
    expect(Number(after.rows[0]!.c)).toBe(Number(before.rows[0]!.c));
  });

  it("T-SQL-9 DUPLICATE DESTINATION PRODUCT rejected", async () => {
    const r = await upsertDraft(fx.sourceUserId, [
      { sourceProductId: fx.sourceProductId, destinationProductId: fx.destProductId, quantity: 5 },
      { sourceProductId: fx.sourceProduct2Id, destinationProductId: fx.destProductId, quantity: 3 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("duplicate_destination_product");
  });

  it("T-SQL-10 MULTI-LINE RECEIVE ATOMICITY", async () => {
    const draft = await upsertDraft(fx.sourceUserId, [
      { sourceProductId: fx.sourceProductId, destinationProductId: fx.destProductId, quantity: 10 },
      { sourceProductId: fx.sourceProduct2Id, destinationProductId: fx.destProduct2Id, quantity: 10 },
    ]);
    const transferId = draft.transferId!;
    await dispatch(fx.sourceUserId, transferId);
    const lines = await exec.query<{ id: string; destination_product_id: string }>(
      `SELECT id, destination_product_id FROM public.enterprise_stock_transfer_lines WHERE transfer_id = $1 ORDER BY created_at`,
      [transferId],
    );
    const beforeA = await destStock();
    const beforeB = Number(
      (
        await exec.query<{ stock_on_hand: string }>(
          `SELECT stock_on_hand FROM public.products WHERE id = $1`,
          [fx.destProduct2Id],
        )
      ).rows[0]!.stock_on_hand,
    );

    const r = await receive(fx.destUserId, transferId, crypto.randomUUID(), [
      { lineId: lines.rows[0]!.id, quantity: 5 },
      { lineId: lines.rows[1]!.id, quantity: 99 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("over_receive");
    expect(await destStock()).toBe(beforeA);
    expect(
      Number(
        (
          await exec.query<{ stock_on_hand: string }>(
            `SELECT stock_on_hand FROM public.products WHERE id = $1`,
            [fx.destProduct2Id],
          )
        ).rows[0]!.stock_on_hand,
      ),
    ).toBe(beforeB);
  });

  it("T-SQL-11 AUTHORIZATION", async () => {
    const draft = await upsertDraft(fx.sourceUserId, [
      { sourceProductId: fx.sourceProductId, destinationProductId: fx.destProductId, quantity: 5 },
    ]);
    const transferId = draft.transferId!;

    const destDispatch = await dispatch(fx.destUserId, transferId);
    expect(destDispatch.ok).toBe(false);
    expect(destDispatch.error).toBe("forbidden");

    await dispatch(fx.sourceUserId, transferId);
    const lineId = await getLineId(transferId);
    const sourceReceive = await receive(fx.sourceUserId, transferId, crypto.randomUUID(), [
      { lineId, quantity: 5 },
    ]);
    expect(sourceReceive.ok).toBe(false);
    expect(sourceReceive.error).toBe("forbidden");

    const okReceive = await receive(fx.destUserId, transferId, crypto.randomUUID(), [{ lineId, quantity: 5 }]);
    expect(okReceive.ok).toBe(true);

    const spoofDraft = await upsertDraft(
      fx.sourceUserId,
      [{ sourceProductId: fx.sourceProduct2Id, destinationProductId: fx.destProduct2Id, quantity: 1 }],
      { fromShopId: fx.toShopId, toShopId: fx.fromShopId },
    );
    expect(spoofDraft.ok).toBe(false);
  });

  it("T-SQL-12 DRAFT CANCEL", async () => {
    const draft = await upsertDraft(fx.sourceUserId, [
      { sourceProductId: fx.sourceProduct2Id, destinationProductId: fx.destProduct2Id, quantity: 2 },
    ]);
    const transferId = draft.transferId!;
    const before = await exec.query<{ stock_on_hand: string }>(
      `SELECT stock_on_hand FROM public.products WHERE id = $1`,
      [fx.sourceProduct2Id],
    );
    const c = await cancel(fx.sourceUserId, transferId);
    expect(c.ok).toBe(true);
    expect(
      Number(
        (
          await exec.query<{ c: string }>(
            `SELECT count(*)::text AS c FROM public.inventory_movements WHERE reference_id = $1`,
            [transferId],
          )
        ).rows[0]!.c,
      ),
    ).toBe(0);
    expect(
      (
        await exec.query<{ stock_on_hand: string }>(
          `SELECT stock_on_hand FROM public.products WHERE id = $1`,
          [fx.sourceProduct2Id],
        )
      ).rows[0]!.stock_on_hand,
    ).toBe(before.rows[0]!.stock_on_hand);
  });
});

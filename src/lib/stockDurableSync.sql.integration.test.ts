import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, rpcJson, type SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";
import {
  createR3StockSqlHarness,
  seedR3StockFixture,
  type R3StockFixture,
} from "../test/sqlIntegration/r3StockPgHarness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Sync R3 — real SQL (migration 168)", () => {
  let exec: SqlExec;
  let fx: R3StockFixture;

  beforeAll(async () => {
    exec = await createR3StockSqlHarness();
    fx = await seedR3StockFixture(exec);
  }, 120_000);

  afterAll(async () => {
    await exec?.close();
  });

  async function stockOf(productId: string): Promise<number> {
    const { rows } = await exec.query<{ stock_on_hand: string }>(
      `SELECT stock_on_hand FROM public.products WHERE id = $1`,
      [productId],
    );
    return Number(rows[0]!.stock_on_hand);
  }

  async function costOf(productId: string): Promise<number> {
    const { rows } = await exec.query<{ cost_price_per_unit_ugx: string }>(
      `SELECT cost_price_per_unit_ugx FROM public.products WHERE id = $1`,
      [productId],
    );
    return Number(rows[0]!.cost_price_per_unit_ugx);
  }

  async function movementCount(referenceType: string, referenceId: string): Promise<number> {
    const { rows } = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.inventory_movements
       WHERE reference_type = $1 AND reference_id = $2`,
      [referenceType, referenceId],
    );
    return Number(rows[0]!.c);
  }

  async function applyAdjustment(
    userId: string,
    shopId: string,
    productId: string,
    adjustmentId: string,
    delta: number,
  ) {
    return asUser(exec, userId, async () => {
      const { rows } = await exec.query(
        `SELECT public.shop_apply_stock_adjustment($1::uuid, $2::jsonb) AS result`,
        [
          shopId,
          JSON.stringify({
            product_id: productId,
            adjustment_id: adjustmentId,
            delta,
            note: "damaged",
          }),
        ],
      );
      return rpcJson(rows[0]);
    });
  }

  async function applyCount(
    userId: string,
    shopId: string,
    sessionId: string,
    productId: string,
    delta: number,
  ) {
    return asUser(exec, userId, async () => {
      const { rows } = await exec.query(
        `SELECT public.shop_apply_inventory_count_stock($1::uuid, $2::jsonb) AS result`,
        [
          shopId,
          JSON.stringify({
            session_id: sessionId,
            product_id: productId,
            delta,
          }),
        ],
      );
      return rpcJson(rows[0]);
    });
  }

  async function insertCountSession(input: {
    sessionId: string;
    shopId: string;
    status: string;
    lines: { productId: string; countedQty: number | null }[];
  }): Promise<void> {
    const payload = {
      session: {
        id: input.sessionId,
        status: input.status,
        lines: input.lines.map((l) => ({
          productId: l.productId,
          countedQty: l.countedQty,
        })),
      },
    };
    await exec.query(
      `INSERT INTO public.shop_inventory_count_sessions
        (id, shop_id, session_number, status, payload)
       VALUES ($1::uuid, $2::uuid, 1, $3, $4::jsonb)`,
      [input.sessionId, input.shopId, input.status, JSON.stringify(payload)],
    );
  }

  it("T1 one adjustment applies once", async () => {
    const id = crypto.randomUUID();
    const before = await stockOf(fx.productAId);
    const r = await applyAdjustment(fx.userAId, fx.shopAId, fx.productAId, id, -5);
    expect(r.ok).toBe(true);
    expect(r.idempotent).toBe(false);
    expect(await stockOf(fx.productAId)).toBe(before - 5);
    expect(await movementCount("adjustment", id)).toBe(1);
  });

  it("T2 same adjustment replay applies once only", async () => {
    const id = crypto.randomUUID();
    await applyAdjustment(fx.userAId, fx.shopAId, fx.productAId, id, -3);
    const mid = await stockOf(fx.productAId);
    const replay = await applyAdjustment(fx.userAId, fx.shopAId, fx.productAId, id, -3);
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    expect(await stockOf(fx.productAId)).toBe(mid);
    expect(await movementCount("adjustment", id)).toBe(1);
  });

  it("T3 retry after server commit is idempotent", async () => {
    const id = crypto.randomUUID();
    const first = await applyAdjustment(fx.userAId, fx.shopAId, fx.productAId, id, -2);
    expect(first.ok).toBe(true);
    const mid = await stockOf(fx.productAId);
    const retry = await applyAdjustment(fx.userAId, fx.shopAId, fx.productAId, id, -2);
    expect(retry.ok).toBe(true);
    expect(retry.idempotent).toBe(true);
    expect(await stockOf(fx.productAId)).toBe(mid);
  });

  it("T4 crash/lost ACK then retry is idempotent", async () => {
    const id = crypto.randomUUID();
    await applyAdjustment(fx.userAId, fx.shopAId, fx.productAId, id, -1);
    const mid = await stockOf(fx.productAId);
    const lostAckRetry = await applyAdjustment(fx.userAId, fx.shopAId, fx.productAId, id, -1);
    expect(lostAckRetry.ok).toBe(true);
    expect(lostAckRetry.idempotent).toBe(true);
    expect(await stockOf(fx.productAId)).toBe(mid);
  });

  it("T5 concurrent duplicate cannot apply twice (unique index + FOR UPDATE)", async () => {
    const id = crypto.randomUUID();
    await applyAdjustment(fx.userAId, fx.shopAId, fx.productAId, id, -1);
    const mid = await stockOf(fx.productAId);
    await expect(
      exec.exec(`
        INSERT INTO public.inventory_movements (
          id, shop_id, product_id, quantity_delta, reason, reference_type, reference_id
        ) VALUES (
          gen_random_uuid(), '${fx.shopAId}', '${fx.productAId}', -1, 'adjustment', 'adjustment', '${id}'
        )
      `),
    ).rejects.toThrow();
    expect(await stockOf(fx.productAId)).toBe(mid);
    expect(await movementCount("adjustment", id)).toBe(1);
  });

  it("T6 two legitimate separate adjustments both apply", async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const before = await stockOf(fx.productAId);
    expect((await applyAdjustment(fx.userAId, fx.shopAId, fx.productAId, a, -4)).ok).toBe(true);
    expect((await applyAdjustment(fx.userAId, fx.shopAId, fx.productAId, b, -6)).ok).toBe(true);
    expect(await stockOf(fx.productAId)).toBe(before - 10);
    expect(await movementCount("adjustment", a)).toBe(1);
    expect(await movementCount("adjustment", b)).toBe(1);
  });

  it("T7 Shop A adjustment cannot apply as Shop B", async () => {
    const id = crypto.randomUUID();
    const stockA = await stockOf(fx.productAId);
    const stockB = await stockOf(fx.productBId);
    const mismatch = await applyAdjustment(fx.userAId, fx.shopBId, fx.productAId, id, -8);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.error).toBe("shop_mismatch");
    const crossUser = await applyAdjustment(fx.userBId, fx.shopAId, fx.productAId, id, -8);
    expect(crossUser.ok).toBe(false);
    expect(await stockOf(fx.productAId)).toBe(stockA);
    expect(await stockOf(fx.productBId)).toBe(stockB);
  });

  it("T8 one count product application applies once", async () => {
    const sessionId = crypto.randomUUID();
    await insertCountSession({
      sessionId,
      shopId: fx.shopAId,
      status: "applied",
      lines: [{ productId: fx.productA2Id, countedQty: 30 }],
    });
    const before = await stockOf(fx.productA2Id);
    const r = await applyCount(fx.userAId, fx.shopAId, sessionId, fx.productA2Id, -10);
    expect(r.ok).toBe(true);
    expect(await stockOf(fx.productA2Id)).toBe(before - 10);
    expect(await movementCount("inventory_count", sessionId)).toBe(1);
  });

  it("T9 same session/product replay does not reapply", async () => {
    const sessionId = crypto.randomUUID();
    await insertCountSession({
      sessionId,
      shopId: fx.shopAId,
      status: "applied",
      lines: [{ productId: fx.productA2Id, countedQty: 25 }],
    });
    await applyCount(fx.userAId, fx.shopAId, sessionId, fx.productA2Id, -5);
    const mid = await stockOf(fx.productA2Id);
    const replay = await applyCount(fx.userAId, fx.shopAId, sessionId, fx.productA2Id, -5);
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    expect(await stockOf(fx.productA2Id)).toBe(mid);
  });

  it("T10 retry after server commit is idempotent (count)", async () => {
    const sessionId = crypto.randomUUID();
    await insertCountSession({
      sessionId,
      shopId: fx.shopAId,
      status: "approved",
      lines: [{ productId: fx.productA2Id, countedQty: 20 }],
    });
    await applyCount(fx.userAId, fx.shopAId, sessionId, fx.productA2Id, -2);
    const mid = await stockOf(fx.productA2Id);
    const retry = await applyCount(fx.userAId, fx.shopAId, sessionId, fx.productA2Id, -2);
    expect(retry.idempotent).toBe(true);
    expect(await stockOf(fx.productA2Id)).toBe(mid);
  });

  it("T11 crash/lost ACK then retry is idempotent (count)", async () => {
    const sessionId = crypto.randomUUID();
    await insertCountSession({
      sessionId,
      shopId: fx.shopAId,
      status: "applied",
      lines: [{ productId: fx.productA2Id, countedQty: 18 }],
    });
    await applyCount(fx.userAId, fx.shopAId, sessionId, fx.productA2Id, -1);
    const mid = await stockOf(fx.productA2Id);
    const retry = await applyCount(fx.userAId, fx.shopAId, sessionId, fx.productA2Id, -1);
    expect(retry.ok).toBe(true);
    expect(retry.idempotent).toBe(true);
    expect(await stockOf(fx.productA2Id)).toBe(mid);
  });

  it("T12 concurrent duplicate count cannot apply twice (unique index)", async () => {
    const sessionId = crypto.randomUUID();
    await insertCountSession({
      sessionId,
      shopId: fx.shopAId,
      status: "applied",
      lines: [{ productId: fx.productA2Id, countedQty: 10 }],
    });
    await applyCount(fx.userAId, fx.shopAId, sessionId, fx.productA2Id, -1);
    const mid = await stockOf(fx.productA2Id);
    await expect(
      exec.exec(`
        INSERT INTO public.inventory_movements (
          id, shop_id, product_id, quantity_delta, reason, reference_type, reference_id
        ) VALUES (
          gen_random_uuid(), '${fx.shopAId}', '${fx.productA2Id}', -1, 'adjustment', 'inventory_count', '${sessionId}'
        )
      `),
    ).rejects.toThrow();
    expect(await stockOf(fx.productA2Id)).toBe(mid);
  });

  it("T13 multi-product count replay cannot duplicate already-applied lines", async () => {
    const sessionId = crypto.randomUUID();
    await insertCountSession({
      sessionId,
      shopId: fx.shopAId,
      status: "applied",
      lines: [
        { productId: fx.productAId, countedQty: 50 },
        { productId: fx.productA2Id, countedQty: 10 },
      ],
    });
    const beforeA = await stockOf(fx.productAId);
    const beforeA2 = await stockOf(fx.productA2Id);
    expect((await applyCount(fx.userAId, fx.shopAId, sessionId, fx.productAId, -1)).ok).toBe(true);
    expect((await applyCount(fx.userAId, fx.shopAId, sessionId, fx.productA2Id, -1)).ok).toBe(true);
    const midA = await stockOf(fx.productAId);
    const midA2 = await stockOf(fx.productA2Id);
    expect(midA).toBe(beforeA - 1);
    expect(midA2).toBe(beforeA2 - 1);
    const replayA = await applyCount(fx.userAId, fx.shopAId, sessionId, fx.productAId, -1);
    expect(replayA.idempotent).toBe(true);
    expect(await stockOf(fx.productAId)).toBe(midA);
    expect(await stockOf(fx.productA2Id)).toBe(midA2);
  });

  it("T14 later recount with a new session ID applies", async () => {
    const session1 = crypto.randomUUID();
    const session2 = crypto.randomUUID();
    await insertCountSession({
      sessionId: session1,
      shopId: fx.shopAId,
      status: "applied",
      lines: [{ productId: fx.productA2Id, countedQty: 8 }],
    });
    await insertCountSession({
      sessionId: session2,
      shopId: fx.shopAId,
      status: "applied",
      lines: [{ productId: fx.productA2Id, countedQty: 12 }],
    });
    const before = await stockOf(fx.productA2Id);
    expect((await applyCount(fx.userAId, fx.shopAId, session1, fx.productA2Id, -2)).ok).toBe(true);
    expect((await applyCount(fx.userAId, fx.shopAId, session2, fx.productA2Id, 3)).ok).toBe(true);
    expect(await stockOf(fx.productA2Id)).toBe(before - 2 + 3);
    expect(await movementCount("inventory_count", session1)).toBe(1);
    expect(await movementCount("inventory_count", session2)).toBe(1);
  });

  it("T15 Shop A count cannot apply as Shop B", async () => {
    const sessionId = crypto.randomUUID();
    await insertCountSession({
      sessionId,
      shopId: fx.shopAId,
      status: "applied",
      lines: [{ productId: fx.productA2Id, countedQty: 5 }],
    });
    const stockA2 = await stockOf(fx.productA2Id);
    const stockB = await stockOf(fx.productBId);
    const mismatch = await applyCount(fx.userAId, fx.shopBId, sessionId, fx.productA2Id, -3);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.error).toBe("shop_mismatch");
    expect(await stockOf(fx.productA2Id)).toBe(stockA2);
    expect(await stockOf(fx.productBId)).toBe(stockB);
  });

  it("T16 missing durable reference fails closed and does not mutate stock", async () => {
    const before = await stockOf(fx.productAId);
    const r = await asUser(exec, fx.userAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.shop_apply_stock_adjustment($1::uuid, $2::jsonb) AS result`,
        [fx.shopAId, JSON.stringify({ product_id: fx.productAId, delta: -9, note: "damaged" })],
      );
      return rpcJson(rows[0]);
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("invalid_payload");
    expect(await stockOf(fx.productAId)).toBe(before);
  });

  it("T17 re-applying migration 168 does not mutate existing stock", async () => {
    const beforeA = await stockOf(fx.productAId);
    const beforeB = await stockOf(fx.productBId);
    const sql = readFileSync(
      join(process.cwd(), "supabase", "migrations", "168_adjustment_count_stock_durable_idempotency.sql"),
      "utf8",
    );
    await exec.exec(sql);
    expect(await stockOf(fx.productAId)).toBe(beforeA);
    expect(await stockOf(fx.productBId)).toBe(beforeB);
  });

  it("T18 purchase 166 durable path still applies once", async () => {
    const purchaseId = crypto.randomUUID();
    const before = await stockOf(fx.productAId);
    const costBefore = await costOf(fx.productAId);
    const push = async () =>
      asUser(exec, fx.userAId, async () => {
        const { rows } = await exec.query(
          `SELECT public.shop_push_product_stock($1::uuid, $2::jsonb) AS result`,
          [
            fx.shopAId,
            JSON.stringify({
              product_id: fx.productAId,
              delta: 7,
              note: `purchase:${purchaseId}`,
            }),
          ],
        );
        return rpcJson(rows[0]);
      });
    const first = await push();
    expect(first.ok).toBe(true);
    const mid = await stockOf(fx.productAId);
    expect(mid).toBe(before + 7);
    const replay = await push();
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    expect(await stockOf(fx.productAId)).toBe(mid);
    expect(await costOf(fx.productAId)).toBe(costBefore);
  });

  it("T19 R3 apply does not change WAC/cost", async () => {
    const id = crypto.randomUUID();
    const costBefore = await costOf(fx.productAId);
    await applyAdjustment(fx.userAId, fx.shopAId, fx.productAId, id, 2);
    expect(await costOf(fx.productAId)).toBe(costBefore);
  });
});

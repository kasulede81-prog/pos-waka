/**
 * SALE-VOID-STOCK-1.0 — real SQL integration (migration 172).
 * Uses the R3/MB-4B PGlite harness. Concurrent duplicate is proven via unique-index
 * rejection (same pattern as Sync R3 T5), not two live PostgreSQL sessions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, rpcJson, type SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";
import {
  createR3StockSqlHarness,
  seedR3StockFixture,
  type R3StockFixture,
} from "../test/sqlIntegration/r3StockPgHarness";

describe("SALE-VOID-STOCK-1.0 — real SQL (migration 172)", () => {
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

  async function applyVoid(
    userId: string,
    shopId: string,
    productId: string,
    voidRecordId: string,
    delta: number,
  ) {
    return asUser(exec, userId, async () => {
      const { rows } = await exec.query(
        `SELECT public.shop_apply_sale_void_stock($1::uuid, $2::jsonb) AS result`,
        [
          shopId,
          JSON.stringify({
            product_id: productId,
            void_record_id: voidRecordId,
            delta,
            note: "void",
          }),
        ],
      );
      return rpcJson(rows[0]);
    });
  }

  it("T1 first void stock restoration", async () => {
    const voidId = crypto.randomUUID();
    const before = await stockOf(fx.productAId);
    const r = await applyVoid(fx.userAId, fx.shopAId, fx.productAId, voidId, 5);
    expect(r.ok).toBe(true);
    expect(r.idempotent).toBe(false);
    expect(await stockOf(fx.productAId)).toBe(before + 5);
    expect(await movementCount("sale_void", voidId)).toBe(1);
  });

  it("T2 same void replay", async () => {
    const voidId = crypto.randomUUID();
    const before = await stockOf(fx.productAId);
    expect((await applyVoid(fx.userAId, fx.shopAId, fx.productAId, voidId, 3)).ok).toBe(true);
    const mid = await stockOf(fx.productAId);
    const replay = await applyVoid(fx.userAId, fx.shopAId, fx.productAId, voidId, 3);
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    expect(await stockOf(fx.productAId)).toBe(mid);
    expect(await stockOf(fx.productAId)).toBe(before + 3);
    expect(await movementCount("sale_void", voidId)).toBe(1);
  });

  it("T3 lost ACK retry", async () => {
    const voidId = crypto.randomUUID();
    const before = await stockOf(fx.productAId);
    expect((await applyVoid(fx.userAId, fx.shopAId, fx.productAId, voidId, 2)).ok).toBe(true);
    const lostAckRetry = await applyVoid(fx.userAId, fx.shopAId, fx.productAId, voidId, 2);
    expect(lostAckRetry.ok).toBe(true);
    expect(lostAckRetry.idempotent).toBe(true);
    expect(await stockOf(fx.productAId)).toBe(before + 2);
  });

  it("T4 crash-after-commit retry semantics", async () => {
    const voidId = crypto.randomUUID();
    const before = await stockOf(fx.productAId);
    expect((await applyVoid(fx.userAId, fx.shopAId, fx.productAId, voidId, 4)).ok).toBe(true);
    // Simulated crash: client never saw ACK; retries same void_record_id.
    const afterCrash = await applyVoid(fx.userAId, fx.shopAId, fx.productAId, voidId, 4);
    expect(afterCrash.ok).toBe(true);
    expect(afterCrash.idempotent).toBe(true);
    expect(await stockOf(fx.productAId)).toBe(before + 4);
    expect(await movementCount("sale_void", voidId)).toBe(1);
  });

  it("T5 concurrent duplicate mechanism (unique index; not two live PG sessions)", async () => {
    const voidId = crypto.randomUUID();
    await applyVoid(fx.userAId, fx.shopAId, fx.productAId, voidId, 1);
    const mid = await stockOf(fx.productAId);
    await expect(
      exec.exec(`
        INSERT INTO public.inventory_movements (
          id, shop_id, product_id, quantity_delta, reason, reference_type, reference_id
        ) VALUES (
          gen_random_uuid(), '${fx.shopAId}', '${fx.productAId}', 1, 'void', 'sale_void', '${voidId}'
        )
      `),
    ).rejects.toThrow();
    expect(await stockOf(fx.productAId)).toBe(mid);
    expect(await movementCount("sale_void", voidId)).toBe(1);
  });

  it("T6 two legitimate void lines both restore", async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const before = await stockOf(fx.productAId);
    expect((await applyVoid(fx.userAId, fx.shopAId, fx.productAId, a, 2)).ok).toBe(true);
    expect((await applyVoid(fx.userAId, fx.shopAId, fx.productAId, b, 7)).ok).toBe(true);
    expect(await stockOf(fx.productAId)).toBe(before + 9);
    expect(await movementCount("sale_void", a)).toBe(1);
    expect(await movementCount("sale_void", b)).toBe(1);
  });

  it("T7 same line replay does not restore twice", async () => {
    const voidId = crypto.randomUUID();
    const before = await stockOf(fx.productA2Id);
    expect((await applyVoid(fx.userAId, fx.shopAId, fx.productA2Id, voidId, 6)).ok).toBe(true);
    expect((await applyVoid(fx.userAId, fx.shopAId, fx.productA2Id, voidId, 6)).ok).toBe(true);
    expect((await applyVoid(fx.userAId, fx.shopAId, fx.productA2Id, voidId, 6)).ok).toBe(true);
    expect(await stockOf(fx.productA2Id)).toBe(before + 6);
  });

  it("T8 authorization/shop mismatch rejected", async () => {
    const voidId = crypto.randomUUID();
    const stockA = await stockOf(fx.productAId);
    const stockB = await stockOf(fx.productBId);
    const mismatch = await applyVoid(fx.userAId, fx.shopBId, fx.productAId, voidId, 8);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.error).toBe("shop_mismatch");
    const crossUser = await applyVoid(fx.userBId, fx.shopAId, fx.productAId, voidId, 8);
    expect(crossUser.ok).toBe(false);
    expect(await stockOf(fx.productAId)).toBe(stockA);
    expect(await stockOf(fx.productBId)).toBe(stockB);
  });

  it("T9 durable movement exists with inventory_movement_uuid grain", async () => {
    const voidId = crypto.randomUUID();
    expect((await applyVoid(fx.userAId, fx.shopAId, fx.productAId, voidId, 1)).ok).toBe(true);
    const { rows } = await exec.query<{ id: string; reference_type: string }>(
      `SELECT id::text AS id, reference_type FROM public.inventory_movements
       WHERE reference_type = 'sale_void' AND reference_id = $1 AND product_id = $2`,
      [voidId, fx.productAId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reference_type).toBe("sale_void");
    const { rows: expected } = await exec.query<{ id: string }>(
      `SELECT public.inventory_movement_uuid($1::uuid, 'sale_void', $2::uuid, $3::uuid)::text AS id`,
      [fx.shopAId, voidId, fx.productAId],
    );
    expect(rows[0]!.id).toBe(expected[0]!.id);
  });

  it("T10 existing sale completion remains unaffected + WAC unchanged", async () => {
    const saleId = crypto.randomUUID();
    const costBefore = await costOf(fx.productAId);
    const stockBefore = await stockOf(fx.productAId);
    // Sale completion unique grain must still accept a sale movement.
    await exec.exec(`
      INSERT INTO public.inventory_movements (
        id, shop_id, product_id, quantity_delta, reason, reference_type, reference_id
      ) VALUES (
        public.inventory_movement_uuid('${fx.shopAId}', 'sale', '${saleId}', '${fx.productAId}'),
        '${fx.shopAId}', '${fx.productAId}', -1, 'sale', 'sale', '${saleId}'
      )
    `);
    const voidId = crypto.randomUUID();
    expect((await applyVoid(fx.userAId, fx.shopAId, fx.productAId, voidId, 1)).ok).toBe(true);
    expect(await costOf(fx.productAId)).toBe(costBefore);
    expect(await stockOf(fx.productAId)).toBe(stockBefore + 1);
    expect(await movementCount("sale", saleId)).toBe(1);
    expect(await movementCount("sale_void", voidId)).toBe(1);
  });
});

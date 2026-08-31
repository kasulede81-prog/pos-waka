/**
 * PURCHASE-VOID-STOCK-1.0 — real SQL integration (migration 173).
 * Uses the R3/MB-4B PGlite harness. Concurrent duplicate is proven via unique-index
 * rejection (same pattern as Sync R3 T5 / sale-void T5), not two live PostgreSQL sessions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, rpcJson, type SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";
import {
  createR3StockSqlHarness,
  seedR3StockFixture,
  type R3StockFixture,
} from "../test/sqlIntegration/r3StockPgHarness";

describe("PURCHASE-VOID-STOCK-1.0 — real SQL (migration 173)", () => {
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

  async function exactCostMeta(productId: string): Promise<string | null> {
    const { rows } = await exec.query<{ exact: string | null }>(
      `SELECT metadata ->> 'exactCostPricePerUnitUgx' AS exact FROM public.products WHERE id = $1`,
      [productId],
    );
    return rows[0]?.exact ?? null;
  }

  async function movementCount(referenceType: string, referenceId: string): Promise<number> {
    const { rows } = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.inventory_movements
       WHERE reference_type = $1 AND reference_id = $2`,
      [referenceType, referenceId],
    );
    return Number(rows[0]!.c);
  }

  async function applyPurchaseVoid(
    userId: string,
    shopId: string,
    productId: string,
    purchaseId: string,
    delta: number,
  ) {
    return asUser(exec, userId, async () => {
      const { rows } = await exec.query(
        `SELECT public.shop_apply_purchase_void_stock($1::uuid, $2::jsonb) AS result`,
        [
          shopId,
          JSON.stringify({
            product_id: productId,
            purchase_id: purchaseId,
            delta,
            note: "purchase_void",
          }),
        ],
      );
      return rpcJson(rows[0]);
    });
  }

  it("T1 first purchase-void stock reversal", async () => {
    const purchaseId = crypto.randomUUID();
    const before = await stockOf(fx.productAId);
    const r = await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productAId, purchaseId, -5);
    expect(r.ok).toBe(true);
    expect(r.idempotent).toBe(false);
    expect(await stockOf(fx.productAId)).toBe(before - 5);
    expect(await movementCount("purchase_void", purchaseId)).toBe(1);
  });

  it("T2 same purchase-void replay", async () => {
    const purchaseId = crypto.randomUUID();
    const before = await stockOf(fx.productAId);
    expect((await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productAId, purchaseId, -3)).ok).toBe(true);
    const mid = await stockOf(fx.productAId);
    const replay = await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productAId, purchaseId, -3);
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    expect(await stockOf(fx.productAId)).toBe(mid);
    expect(await stockOf(fx.productAId)).toBe(before - 3);
    expect(await movementCount("purchase_void", purchaseId)).toBe(1);
  });

  it("T3 lost ACK retry", async () => {
    const purchaseId = crypto.randomUUID();
    const before = await stockOf(fx.productAId);
    expect((await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productAId, purchaseId, -2)).ok).toBe(true);
    const lostAckRetry = await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productAId, purchaseId, -2);
    expect(lostAckRetry.ok).toBe(true);
    expect(lostAckRetry.idempotent).toBe(true);
    expect(await stockOf(fx.productAId)).toBe(before - 2);
  });

  it("T4 crash-after-commit retry semantics", async () => {
    const purchaseId = crypto.randomUUID();
    const before = await stockOf(fx.productAId);
    expect((await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productAId, purchaseId, -4)).ok).toBe(true);
    const afterCrash = await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productAId, purchaseId, -4);
    expect(afterCrash.ok).toBe(true);
    expect(afterCrash.idempotent).toBe(true);
    expect(await stockOf(fx.productAId)).toBe(before - 4);
    expect(await movementCount("purchase_void", purchaseId)).toBe(1);
  });

  it("T5 concurrent duplicate mechanism (unique index; not two live PG sessions)", async () => {
    const purchaseId = crypto.randomUUID();
    await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productAId, purchaseId, -1);
    const mid = await stockOf(fx.productAId);
    await expect(
      exec.exec(`
        INSERT INTO public.inventory_movements (
          id, shop_id, product_id, quantity_delta, reason, reference_type, reference_id
        ) VALUES (
          gen_random_uuid(), '${fx.shopAId}', '${fx.productAId}', -1, 'void', 'purchase_void', '${purchaseId}'
        )
      `),
    ).rejects.toThrow();
    expect(await stockOf(fx.productAId)).toBe(mid);
    expect(await movementCount("purchase_void", purchaseId)).toBe(1);
  });

  it("T6 two legitimate purchase-void events do not collapse", async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const before = await stockOf(fx.productAId);
    expect((await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productAId, a, -2)).ok).toBe(true);
    expect((await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productAId, b, -7)).ok).toBe(true);
    expect(await stockOf(fx.productAId)).toBe(before - 9);
    expect(await movementCount("purchase_void", a)).toBe(1);
    expect(await movementCount("purchase_void", b)).toBe(1);
  });

  it("T7 multi-product purchase void", async () => {
    const purchaseId = crypto.randomUUID();
    const beforeA = await stockOf(fx.productAId);
    const beforeA2 = await stockOf(fx.productA2Id);
    expect((await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productAId, purchaseId, -3)).ok).toBe(true);
    expect((await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productA2Id, purchaseId, -5)).ok).toBe(true);
    expect(await stockOf(fx.productAId)).toBe(beforeA - 3);
    expect(await stockOf(fx.productA2Id)).toBe(beforeA2 - 5);
    expect(await movementCount("purchase_void", purchaseId)).toBe(2);
    // Replay both lines
    expect((await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productAId, purchaseId, -3)).idempotent).toBe(true);
    expect((await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productA2Id, purchaseId, -5)).idempotent).toBe(true);
    expect(await stockOf(fx.productAId)).toBe(beforeA - 3);
    expect(await stockOf(fx.productA2Id)).toBe(beforeA2 - 5);
  });

  it("T8 authorization failure", async () => {
    const purchaseId = crypto.randomUUID();
    const stockA = await stockOf(fx.productAId);
    const crossUser = await applyPurchaseVoid(fx.userBId, fx.shopAId, fx.productAId, purchaseId, -8);
    expect(crossUser.ok).toBe(false);
    expect(await stockOf(fx.productAId)).toBe(stockA);
  });

  it("T9 shop mismatch", async () => {
    const purchaseId = crypto.randomUUID();
    const stockA = await stockOf(fx.productAId);
    const stockB = await stockOf(fx.productBId);
    const mismatch = await applyPurchaseVoid(fx.userAId, fx.shopBId, fx.productAId, purchaseId, -8);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.error).toBe("shop_mismatch");
    expect(await stockOf(fx.productAId)).toBe(stockA);
    expect(await stockOf(fx.productBId)).toBe(stockB);
  });

  it("T10 WAC/cost remains unchanged", async () => {
    const purchaseId = crypto.randomUUID();
    const costBefore = await costOf(fx.productAId);
    const exactBefore = await exactCostMeta(fx.productAId);
    expect((await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productAId, purchaseId, -1)).ok).toBe(true);
    expect(await costOf(fx.productAId)).toBe(costBefore);
    expect(await exactCostMeta(fx.productAId)).toBe(exactBefore);
  });

  it("T12 purchase RECEIVE unique grain still intact (166)", async () => {
    const purchaseId = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.inventory_movements (
        id, shop_id, product_id, quantity_delta, reason, reference_type, reference_id
      ) VALUES (
        public.inventory_movement_uuid('${fx.shopAId}', 'purchase', '${purchaseId}', '${fx.productAId}'),
        '${fx.shopAId}', '${fx.productAId}', 10, 'purchase', 'purchase', '${purchaseId}'
      )
    `);
    expect(await movementCount("purchase", purchaseId)).toBe(1);
    // Void of same purchase id is a different reference_type — allowed once.
    expect((await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productAId, purchaseId, -10)).ok).toBe(true);
    expect(await movementCount("purchase", purchaseId)).toBe(1);
    expect(await movementCount("purchase_void", purchaseId)).toBe(1);
  });

  it("T15 sale_void RPC remains green after 173", async () => {
    const voidId = crypto.randomUUID();
    const before = await stockOf(fx.productAId);
    const { rows } = await asUser(exec, fx.userAId, async () =>
      exec.query(`SELECT public.shop_apply_sale_void_stock($1::uuid, $2::jsonb) AS result`, [
        fx.shopAId,
        JSON.stringify({ product_id: fx.productAId, void_record_id: voidId, delta: 2 }),
      ]),
    );
    const r = rpcJson(rows[0]);
    expect(r.ok).toBe(true);
    expect(await stockOf(fx.productAId)).toBe(before + 2);
  });

  it("rejects positive delta (purchase void must reverse inbound)", async () => {
    const purchaseId = crypto.randomUUID();
    const before = await stockOf(fx.productAId);
    const r = await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productAId, purchaseId, 5);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("invalid_delta");
    expect(await stockOf(fx.productAId)).toBe(before);
  });

  it("floors stock at zero (preserved semantics)", async () => {
    const purchaseId = crypto.randomUUID();
    const before = await stockOf(fx.productA2Id);
    const r = await applyPurchaseVoid(fx.userAId, fx.shopAId, fx.productA2Id, purchaseId, -(before + 50));
    expect(r.ok).toBe(true);
    expect(await stockOf(fx.productA2Id)).toBe(0);
  });
});

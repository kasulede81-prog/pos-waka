/**
 * SALES-MULTI-01 — sale_voids ledger + void stock remain idempotent (migration 179).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asUser, rpcJson, type SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";
import { createR3StockSqlHarness, seedR3StockFixture, type R3StockFixture } from "../test/sqlIntegration/r3StockPgHarness";

const SQL_179 = readFileSync(
  join(process.cwd(), "supabase/migrations/179_sale_void_financial_ledger.sql"),
  "utf8",
);

describe("SALES-MULTI-01 sale_voids ledger — real SQL", () => {
  let exec: SqlExec;
  let fx: R3StockFixture;
  let saleId: string;

  beforeAll(async () => {
    exec = await createR3StockSqlHarness();
    fx = await seedR3StockFixture(exec);
    await exec.exec(`
      CREATE TABLE IF NOT EXISTS public.sales (
        id uuid PRIMARY KEY,
        shop_id uuid NOT NULL,
        status text NOT NULL DEFAULT 'completed',
        total_ugx bigint NOT NULL DEFAULT 0,
        cash_amount_ugx bigint NOT NULL DEFAULT 0,
        debt_amount_ugx bigint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await exec.exec(SQL_179);
    saleId = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.sales (id, shop_id, status, total_ugx, cash_amount_ugx, debt_amount_ugx)
      VALUES ('${saleId}', '${fx.shopAId}', 'completed', 100000, 50000, 50000);
    `);
  }, 120_000);

  afterAll(async () => {
    await exec?.close();
  });

  async function applyVoid(input: {
    userId: string;
    shopId: string;
    productId: string;
    voidRecordId: string;
    delta: number;
    saleId?: string;
    amountUgx?: number;
  }) {
    return asUser(exec, input.userId, async () => {
      const { rows } = await exec.query(
        `SELECT public.shop_apply_sale_void_stock($1::uuid, $2::jsonb) AS result`,
        [
          input.shopId,
          JSON.stringify({
            product_id: input.productId,
            void_record_id: input.voidRecordId,
            delta: input.delta,
            sale_id: input.saleId,
            amount_ugx: input.amountUgx,
            line_index: 0,
            note: "void",
          }),
        ],
      );
      return rpcJson(rows[0]);
    });
  }

  async function saleTotal(): Promise<number> {
    const { rows } = await exec.query<{ total_ugx: string }>(
      `SELECT total_ugx::text FROM public.sales WHERE id = $1`,
      [saleId],
    );
    return Number(rows[0]!.total_ugx);
  }

  async function voidCount(id: string): Promise<number> {
    const { rows } = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.sale_voids WHERE id = $1`,
      [id],
    );
    return Number(rows[0]!.c);
  }

  it("does not mutate the completed sale header", async () => {
    const voidId = crypto.randomUUID();
    const r = await applyVoid({
      userId: fx.userAId,
      shopId: fx.shopAId,
      productId: fx.productAId,
      voidRecordId: voidId,
      delta: 2,
      saleId,
      amountUgx: 20_000,
    });
    expect(r.ok).toBe(true);
    expect(await saleTotal()).toBe(100_000);
    expect(await voidCount(voidId)).toBe(1);
  });

  it("replay of the same void_record_id does not insert a second financial row", async () => {
    const voidId = crypto.randomUUID();
    const first = await applyVoid({
      userId: fx.userAId,
      shopId: fx.shopAId,
      productId: fx.productAId,
      voidRecordId: voidId,
      delta: 1,
      saleId,
      amountUgx: 10_000,
    });
    const replay = await applyVoid({
      userId: fx.userAId,
      shopId: fx.shopAId,
      productId: fx.productAId,
      voidRecordId: voidId,
      delta: 1,
      saleId,
      amountUgx: 10_000,
    });
    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    expect(await voidCount(voidId)).toBe(1);
    expect(await saleTotal()).toBe(100_000);
  });

  it("stock-only payload still works without writing sale_voids", async () => {
    const voidId = crypto.randomUUID();
    const r = await applyVoid({
      userId: fx.userAId,
      shopId: fx.shopAId,
      productId: fx.productAId,
      voidRecordId: voidId,
      delta: 1,
    });
    expect(r.ok).toBe(true);
    expect(await voidCount(voidId)).toBe(0);
  });

  it("outsider cannot persist a void ledger row", async () => {
    const voidId = crypto.randomUUID();
    const r = await applyVoid({
      userId: fx.outsiderId,
      shopId: fx.shopAId,
      productId: fx.productAId,
      voidRecordId: voidId,
      delta: 1,
      saleId,
      amountUgx: 10_000,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
    expect(await voidCount(voidId)).toBe(0);
  });
});

describe("SALES-MULTI-01 migration 179 contract", () => {
  it("does not UPDATE sales financial columns", () => {
    expect(SQL_179).not.toContain("update public.sales");
    expect(SQL_179).toContain("insert into public.sale_voids");
    expect(SQL_179).toContain("on conflict (id) do nothing");
    expect(SQL_179).toContain("closed_business_date");
    expect(SQL_179).toContain("user_is_cashier_or_above");
  });
});

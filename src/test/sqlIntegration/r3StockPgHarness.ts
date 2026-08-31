import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { SqlExec } from "./transferEnginePgHarness";

const ROOT = join(process.cwd(), "supabase", "migrations");
const TRANSFER_BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "transferEngineBootstrap.sql");
const R3_BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "r3StockBootstrap.sql");
const MIGRATION_166 = join(ROOT, "166_purchase_stock_durable_idempotency.sql");
const MIGRATION_168 = join(ROOT, "168_adjustment_count_stock_durable_idempotency.sql");
const MIGRATION_172 = join(ROOT, "172_sale_void_stock_durable_idempotency.sql");
const MIGRATION_173 = join(ROOT, "173_purchase_void_stock_durable_idempotency.sql");

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

export async function createR3StockSqlHarness(): Promise<SqlExec> {
  const url = process.env.TEST_DATABASE_URL?.trim();

  if (url) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const exec: SqlExec = {
      async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
        const res = await client.query(sql, params);
        return { rows: res.rows as unknown as T[] };
      },
      async exec(sql: string) {
        await client.query(sql);
      },
      async close() {
        await client.end();
      },
    };
    await exec.exec(readSql(TRANSFER_BOOTSTRAP));
    await exec.exec(readSql(R3_BOOTSTRAP));
    await exec.exec(readSql(MIGRATION_166));
    await exec.exec(readSql(MIGRATION_168));
    await exec.exec(readSql(MIGRATION_172));
    await exec.exec(readSql(MIGRATION_173));
    return exec;
  }

  const db = new PGlite();
  const exec: SqlExec = {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await db.query(sql, params);
      return { rows: res.rows as unknown as T[] };
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
    async close() {
      await db.close();
    },
  };
  await exec.exec(readSql(TRANSFER_BOOTSTRAP));
  await exec.exec(readSql(R3_BOOTSTRAP));
  await exec.exec(readSql(MIGRATION_166));
  await exec.exec(readSql(MIGRATION_168));
  await exec.exec(readSql(MIGRATION_172));
  await exec.exec(readSql(MIGRATION_173));
  return exec;
}

export type R3StockFixture = {
  shopAId: string;
  shopBId: string;
  userAId: string;
  userBId: string;
  outsiderId: string;
  productAId: string;
  productA2Id: string;
  productBId: string;
};

export async function seedR3StockFixture(exec: SqlExec): Promise<R3StockFixture> {
  const shopAId = crypto.randomUUID();
  const shopBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  const productAId = crypto.randomUUID();
  const productA2Id = crypto.randomUUID();
  const productBId = crypto.randomUUID();
  const orgId = crypto.randomUUID();

  await exec.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${userAId}', 'a@test.local'),
      ('${userBId}', 'b@test.local'),
      ('${outsiderId}', 'out@test.local');
    INSERT INTO public.organizations (id, name) VALUES ('${orgId}', 'R3 Org');
    INSERT INTO public.shops (id, organization_id, name) VALUES
      ('${shopAId}', '${orgId}', 'Shop A'),
      ('${shopBId}', '${orgId}', 'Shop B');
    INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
      ('${shopAId}', '${userAId}', 'owner'),
      ('${shopBId}', '${userBId}', 'owner');
    INSERT INTO public.products (id, shop_id, name, stock_on_hand, cost_price_per_unit_ugx, metadata) VALUES
      ('${productAId}', '${shopAId}', 'Widget A', 100, 6000, '{}'),
      ('${productA2Id}', '${shopAId}', 'Widget A2', 40, 3000, '{}'),
      ('${productBId}', '${shopBId}', 'Widget B', 20, 4000, '{}');
  `);

  return { shopAId, shopBId, userAId, userBId, outsiderId, productAId, productA2Id, productBId };
}

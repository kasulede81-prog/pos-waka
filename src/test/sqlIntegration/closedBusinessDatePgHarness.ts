import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { asUser, rpcJson, type SqlExec } from "./transferEnginePgHarness";

const ROOT = join(process.cwd(), "supabase", "migrations");
const TRANSFER_BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "transferEngineBootstrap.sql");
const R3_BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "r3StockBootstrap.sql");
const CLOSED_BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "closedBusinessDateBootstrap.sql");
const MIGRATION_175 = join(ROOT, "175_closed_business_date_guard.sql");

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

export async function createClosedBusinessDateSqlHarness(): Promise<SqlExec & { isRealPostgres: boolean }> {
  const url = process.env.TEST_DATABASE_URL?.trim();

  if (url) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const exec: SqlExec & { isRealPostgres: boolean } = {
      isRealPostgres: true,
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
    await exec.exec(readSql(CLOSED_BOOTSTRAP));
    await exec.exec(readSql(MIGRATION_175));
    return exec;
  }

  const db = new PGlite();
  const exec: SqlExec & { isRealPostgres: boolean } = {
    isRealPostgres: false,
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
  await exec.exec(readSql(CLOSED_BOOTSTRAP));
  await exec.exec(readSql(MIGRATION_175));
  return exec;
}

export type ClosedDateFixture = {
  shopAId: string;
  shopBId: string;
  userAId: string;
  userBId: string;
  customerAId: string;
};

export async function seedClosedDateFixture(exec: SqlExec): Promise<ClosedDateFixture> {
  const shopAId = crypto.randomUUID();
  const shopBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();
  const customerAId = crypto.randomUUID();
  const orgId = crypto.randomUUID();

  await exec.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${userAId}', 'close-a@test.local'),
      ('${userBId}', 'close-b@test.local');
    INSERT INTO public.organizations (id, name) VALUES ('${orgId}', 'Close Org');
    INSERT INTO public.shops (id, organization_id, name) VALUES
      ('${shopAId}', '${orgId}', 'Close Shop A'),
      ('${shopBId}', '${orgId}', 'Close Shop B');
    INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
      ('${shopAId}', '${userAId}', 'owner'),
      ('${shopBId}', '${userBId}', 'owner');
    INSERT INTO public.customers (id, shop_id, name, metadata) VALUES
      ('${customerAId}', '${shopAId}', 'Alice', '{"debtBalanceUgx": 100000}'::jsonb);
  `);

  return { shopAId, shopBId, userAId, userBId, customerAId };
}

export async function insertActiveClose(exec: SqlExec, shopId: string, dateKey: string, id = crypto.randomUUID()) {
  await exec.exec(`
    INSERT INTO public.shop_day_closes (id, shop_id, date_key, superseded_at, payload)
    VALUES ('${id}', '${shopId}', '${dateKey}', NULL, '{}'::jsonb);
  `);
  return id;
}

export { asUser, rpcJson };

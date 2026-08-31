import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { SqlExec } from "./transferEnginePgHarness";

const ROOT = join(process.cwd(), "supabase", "migrations");
const TRANSFER_BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "transferEngineBootstrap.sql");
const R3_BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "r3StockBootstrap.sql");
const DEBT_BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "debtPaymentBootstrap.sql");
const MIGRATION_174 = join(ROOT, "174_debt_payment_durable_idempotency.sql");

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

export async function createDebtPaymentSqlHarness(): Promise<SqlExec & { isRealPostgres: boolean }> {
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
    await exec.exec(readSql(DEBT_BOOTSTRAP));
    await exec.exec(readSql(MIGRATION_174));
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
  await exec.exec(readSql(DEBT_BOOTSTRAP));
  await exec.exec(readSql(MIGRATION_174));
  return exec;
}

export type DebtPaymentFixture = {
  shopAId: string;
  shopBId: string;
  userAId: string;
  userBId: string;
  outsiderId: string;
  customerAId: string;
  customerBId: string;
};

export async function seedDebtPaymentFixture(exec: SqlExec): Promise<DebtPaymentFixture> {
  const shopAId = crypto.randomUUID();
  const shopBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  const customerAId = crypto.randomUUID();
  const customerBId = crypto.randomUUID();
  const orgId = crypto.randomUUID();

  await exec.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${userAId}', 'debt-a@test.local'),
      ('${userBId}', 'debt-b@test.local'),
      ('${outsiderId}', 'debt-out@test.local');
    INSERT INTO public.organizations (id, name) VALUES ('${orgId}', 'Debt Org');
    INSERT INTO public.shops (id, organization_id, name) VALUES
      ('${shopAId}', '${orgId}', 'Debt Shop A'),
      ('${shopBId}', '${orgId}', 'Debt Shop B');
    INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
      ('${shopAId}', '${userAId}', 'cashier'),
      ('${shopBId}', '${userBId}', 'cashier');
    INSERT INTO public.customers (id, shop_id, name, metadata) VALUES
      ('${customerAId}', '${shopAId}', 'Alice', '{"debtBalanceUgx": 100000}'::jsonb),
      ('${customerBId}', '${shopBId}', 'Bob', '{"debtBalanceUgx": 50000}'::jsonb);
  `);

  return { shopAId, shopBId, userAId, userBId, outsiderId, customerAId, customerBId };
}

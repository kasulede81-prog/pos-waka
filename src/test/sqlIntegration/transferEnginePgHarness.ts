import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

export type SqlExec = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<void>;
  close: () => Promise<void>;
};

const ROOT = join(process.cwd(), "supabase", "migrations");
const BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "transferEngineBootstrap.sql");
const MIGRATION_167 = join(ROOT, "167_enterprise_stock_transfer_engine.sql");

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

async function apply167(exec: SqlExec): Promise<void> {
  await exec.exec(readSql(MIGRATION_167));
}

export async function createTransferEngineSqlHarness(): Promise<SqlExec> {
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
    await exec.exec(readSql(BOOTSTRAP));
    await apply167(exec);
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
  await exec.exec(readSql(BOOTSTRAP));
  await apply167(exec);
  return exec;
}

export async function asUser<T>(exec: SqlExec, userId: string, fn: () => Promise<T>): Promise<T> {
  await exec.exec("BEGIN");
  await exec.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
  try {
    const result = await fn();
    await exec.exec("COMMIT");
    return result;
  } catch (err) {
    await exec.exec("ROLLBACK");
    throw err;
  }
}

export function rpcJson(row: Record<string, unknown> | undefined): Record<string, unknown> {
  const raw =
    row?.enterprise_transfer_upsert_draft ??
    row?.enterprise_transfer_dispatch ??
    row?.enterprise_transfer_receive ??
    row?.enterprise_transfer_cancel ??
    row?.result;
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") return JSON.parse(raw) as Record<string, unknown>;
  return (row ?? {}) as Record<string, unknown>;
}

export type TransferFixture = {
  orgId: string;
  fromShopId: string;
  toShopId: string;
  sourceUserId: string;
  destUserId: string;
  outsiderUserId: string;
  sourceProductId: string;
  destProductId: string;
  sourceProduct2Id: string;
  destProduct2Id: string;
};

export async function seedTransferFixture(exec: SqlExec): Promise<TransferFixture> {
  const orgId = crypto.randomUUID();
  const fromShopId = crypto.randomUUID();
  const toShopId = crypto.randomUUID();
  const sourceUserId = crypto.randomUUID();
  const destUserId = crypto.randomUUID();
  const outsiderUserId = crypto.randomUUID();
  const sourceProductId = crypto.randomUUID();
  const destProductId = crypto.randomUUID();
  const sourceProduct2Id = crypto.randomUUID();
  const destProduct2Id = crypto.randomUUID();

  await exec.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${sourceUserId}', 'source@test.local'),
      ('${destUserId}', 'dest@test.local'),
      ('${outsiderUserId}', 'outsider@test.local');
    INSERT INTO public.organizations (id, name) VALUES ('${orgId}', 'Test Org');
    INSERT INTO public.shops (id, organization_id, name) VALUES
      ('${fromShopId}', '${orgId}', 'Shop A'),
      ('${toShopId}', '${orgId}', 'Shop B');
    INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
      ('${fromShopId}', '${sourceUserId}', 'owner'),
      ('${toShopId}', '${destUserId}', 'owner');
    INSERT INTO public.products (id, shop_id, name, stock_on_hand, cost_price_per_unit_ugx, metadata) VALUES
      ('${sourceProductId}', '${fromShopId}', 'Source A', 100, 2000, '{}'),
      ('${sourceProduct2Id}', '${fromShopId}', 'Source B', 50, 1000, '{}'),
      ('${destProductId}', '${toShopId}', 'Dest A', 10, 2000, '{"exactCostPricePerUnitUgx": 2000}'),
      ('${destProduct2Id}', '${toShopId}', 'Dest B', 0, 0, '{}');
  `);

  return {
    orgId,
    fromShopId,
    toShopId,
    sourceUserId,
    destUserId,
    outsiderUserId,
    sourceProductId,
    destProductId,
    sourceProduct2Id,
    destProduct2Id,
  };
}

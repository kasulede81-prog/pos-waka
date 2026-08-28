import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { asUser, type SqlExec } from "./transferEnginePgHarness";

const BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "transferEngineBootstrap.sql");
const MIGRATION = join(process.cwd(), "supabase", "migrations", "169_shop_efris_plumbing.sql");

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

const CASHIER_ABOVE_SQL = `
CREATE OR REPLACE FUNCTION public.user_is_cashier_or_above (p_shop uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_can_manage_shop(p_shop)
  OR EXISTS (
    SELECT 1 FROM public.shop_members sm
    WHERE sm.shop_id = p_shop
      AND sm.user_id = auth.uid()
      AND sm.role IN ('owner', 'manager', 'cashier', 'stock_keeper', 'waiter', 'viewer')
  );
$$;
`;

export type EfrisSqlFixture = {
  shopAId: string;
  shopBId: string;
  userAId: string;
  userBId: string;
  cashierAId: string;
  outsiderId: string;
};

export function efrisRpc(row: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!row) return {};
  const raw =
    row.shop_enqueue_efris_submission ??
    row.shop_get_efris_config ??
    row.shop_set_efris_enabled ??
    row.shop_efris_note_provider_absent ??
    row.result;
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") return JSON.parse(raw) as Record<string, unknown>;
  const first = Object.values(row)[0];
  if (first && typeof first === "object") return first as Record<string, unknown>;
  if (typeof first === "string") {
    try {
      return JSON.parse(first) as Record<string, unknown>;
    } catch {
      return row;
    }
  }
  return row;
}

export async function createEfrisSqlHarness(): Promise<SqlExec> {
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
    await exec.exec(CASHIER_ABOVE_SQL);
    await exec.exec(readSql(MIGRATION));
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
  await exec.exec(CASHIER_ABOVE_SQL);
  await exec.exec(readSql(MIGRATION));
  return exec;
}

export { asUser };

export async function seedEfrisFixture(exec: SqlExec): Promise<EfrisSqlFixture> {
  const shopAId = crypto.randomUUID();
  const shopBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();
  const cashierAId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  const orgId = crypto.randomUUID();

  await exec.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${userAId}', 'a-mgr@test.local'),
      ('${userBId}', 'b-mgr@test.local'),
      ('${cashierAId}', 'a-cash@test.local'),
      ('${outsiderId}', 'out@test.local');
    INSERT INTO public.organizations (id, name) VALUES ('${orgId}', 'EFRIS Org');
    INSERT INTO public.shops (id, organization_id, name) VALUES
      ('${shopAId}', '${orgId}', 'Shop A'),
      ('${shopBId}', '${orgId}', 'Shop B');
    INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
      ('${shopAId}', '${userAId}', 'manager'),
      ('${shopBId}', '${userBId}', 'manager'),
      ('${shopAId}', '${cashierAId}', 'cashier');
  `);

  return { shopAId, shopBId, userAId, userBId, cashierAId, outsiderId };
}

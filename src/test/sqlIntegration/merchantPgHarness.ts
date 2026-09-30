import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { SqlExec } from "./transferEnginePgHarness";

/**
 * A database carrying the MERCHANT tenancy schema and the merchant registration hardening
 * migration, so the bootstrap RPCs can actually be CALLED in a test.
 *
 * WHY THIS EXISTS SEPARATELY from `loyaltyPgHarness`: that harness models a shop's loyalty
 * surface — organizations, shops and shop_members only — and has no `profiles`,
 * `organization_members`, `districts` or `subscriptions`, so `bootstrap_owner_workspace` cannot
 * run against it. Rather than grow the loyalty bootstrap (which 90-odd passing suites share, and
 * whose shape they assert on), the merchant path gets its own small schema.
 *
 * The function bodies under test are the REAL ones: the hardening migration is generated from the
 * live definitions and applied here unmodified.
 */

const BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "merchantBootstrap.sql");

export const MERCHANT_MIGRATIONS = [
  join(process.cwd(), "supabase", "migrations", "20260930320000_merchant_registration_hardening.sql"),
];

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

export async function createMerchantSqlHarness(): Promise<SqlExec> {
  const url = process.env.TEST_DATABASE_URL?.trim();

  if (url) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const exec: SqlExec = {
      async query<T extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ) {
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
    for (const m of MERCHANT_MIGRATIONS) await exec.exec(readSql(m));
    return exec;
  }

  const db = new PGlite();
  const exec: SqlExec = {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ) {
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
  for (const m of MERCHANT_MIGRATIONS) await exec.exec(readSql(m));
  return exec;
}

/**
 * Run `fn` as the `authenticated` role with the given identity, so `auth.uid()` resolves and the
 * SECURITY DEFINER functions behave as they do for a real signed-in merchant.
 */
export async function asMerchant<T>(exec: SqlExec, userId: string, fn: () => Promise<T>): Promise<T> {
  await exec.exec("BEGIN");
  await exec.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
  await exec.exec("SET LOCAL ROLE authenticated");
  try {
    const result = await fn();
    await exec.exec("COMMIT");
    return result;
  } catch (err) {
    await exec.exec("ROLLBACK");
    throw err;
  }
}

export async function asAnonymous<T>(exec: SqlExec, fn: () => Promise<T>): Promise<T> {
  await exec.exec("BEGIN");
  await exec.exec("SET LOCAL ROLE anon");
  try {
    const result = await fn();
    await exec.exec("COMMIT");
    return result;
  } catch (err) {
    await exec.exec("ROLLBACK");
    throw err;
  }
}

/** The first column of the first row, whatever it is called. */
export function firstValue<T = unknown>(row: Record<string, unknown> | undefined): T | undefined {
  if (!row) return undefined;
  return Object.values(row)[0] as T;
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { SqlExec } from "./transferEnginePgHarness";
export type { SqlExec };

const MIGRATION = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260924001500_edge_rate_limit_buckets.sql",
);

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

/** Minimal harness for edge_rate_limit_* SQL (isolated from loyalty). */
export async function createEdgeRateLimitSqlHarness(): Promise<SqlExec> {
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

  await exec.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOINHERIT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOINHERIT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOINHERIT BYPASSRLS;
      END IF;
    END $$;
  `);
  await exec.exec(readSql(MIGRATION));
  return exec;
}

export async function asRole<T>(
  exec: SqlExec,
  role: "anon" | "authenticated" | "service_role",
  fn: () => Promise<T>,
): Promise<T> {
  await exec.exec("BEGIN");
  await exec.exec(`SET LOCAL ROLE ${role}`);
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
  const raw = row?.edge_rate_limit_consume ?? row?.result ?? row;
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") return JSON.parse(raw) as Record<string, unknown>;
  return {};
}

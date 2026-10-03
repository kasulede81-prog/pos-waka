import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { SqlExec } from "./transferEnginePgHarness";

export type { SqlExec };

/**
 * Harness for the Phase 2 shop-membership lockdown (C1).
 *
 * Bootstraps the pre-Phase-2 production state — including the vulnerable
 * single-owner trigger and the live privilege grants — and then optionally
 * applies `20261003000000_shop_membership_lockdown.sql`.
 *
 * Applying it is opt-in so a test can prove the attack path is real BEFORE the
 * migration and closed AFTER it. Without that, a passing "manager cannot take
 * over" assertion proves nothing: it might simply be testing a schema that never
 * had the bug.
 */

const ROOT = join(process.cwd(), "supabase", "migrations");
const BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "shopMembershipLockdownBootstrap.sql");
const LOCKDOWN_MIGRATION = join(ROOT, "20261003000000_shop_membership_lockdown.sql");

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

function makePgExec(client: pg.Client): SqlExec {
  return {
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
}

export async function createShopMembershipLockdownHarness(
  options: { applyLockdown?: boolean } = {},
): Promise<SqlExec> {
  const applyLockdown = options.applyLockdown ?? true;
  const url = process.env.TEST_DATABASE_URL?.trim();

  let exec: SqlExec;
  if (url) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    exec = makePgExec(client);
  } else {
    const db = new PGlite();
    exec = {
      async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
        const res = await db.query<T>(sql, params);
        return { rows: res.rows };
      },
      async exec(sql: string) {
        await db.exec(sql);
      },
      async close() {
        await db.close();
      },
    };
  }

  await exec.exec(readSql(BOOTSTRAP));
  if (applyLockdown) await exec.exec(readSql(LOCKDOWN_MIGRATION));
  return exec;
}

/**
 * Run `fn` as the `authenticated` role with the given identity, so `auth.uid()`
 * resolves and RLS + table privileges apply exactly as they do for a signed-in
 * user. Rolled back on throw so a rejected statement cannot poison the fixture.
 */
export async function asUser<T>(exec: SqlExec, userId: string, fn: () => Promise<T>): Promise<T> {
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

/** Outcome of a statement that may be blocked by a privilege or by RLS. */
export type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Run a mutation and report whether it was rejected. A privilege denial throws;
 * an RLS USING clause that filters the row out simply affects nothing. Both are
 * "the write did not happen", so callers assert on `ok` AND on affected rows.
 */
export async function attempt<T>(fn: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type MembershipFixture = {
  shopId: string;
  otherShopId: string;
  ownerId: string;
  managerId: string;
  cashierId: string;
  viewerId: string;
  outsiderId: string;
};

/**
 * One shop with an owner, manager, cashier and viewer; a second shop owned by
 * `outsiderId` so cross-shop attempts have a real target; and an organisation
 * tying the first shop to its owner.
 */
export async function seedMembershipFixture(exec: SqlExec): Promise<MembershipFixture> {
  const ids = {
    shopId: crypto.randomUUID(),
    otherShopId: crypto.randomUUID(),
    orgId: crypto.randomUUID(),
    ownerId: crypto.randomUUID(),
    managerId: crypto.randomUUID(),
    cashierId: crypto.randomUUID(),
    viewerId: crypto.randomUUID(),
    outsiderId: crypto.randomUUID(),
  };

  for (const id of [
    ids.ownerId,
    ids.managerId,
    ids.cashierId,
    ids.viewerId,
    ids.outsiderId,
  ]) {
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [id, `${id}@example.test`]);
  }

  await exec.query(`INSERT INTO public.organizations (id, name) VALUES ($1, 'Org')`, [ids.orgId]);
  await exec.query(
    `INSERT INTO public.organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [ids.orgId, ids.ownerId],
  );
  await exec.query(
    `INSERT INTO public.shops (id, organization_id, name) VALUES ($1, $2, 'Main'), ($3, $4, 'Other')`,
    [ids.shopId, ids.orgId, ids.otherShopId, ids.orgId],
  );

  await exec.query(
    `INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
       ($1, $2, 'owner'),
       ($1, $3, 'manager'),
       ($1, $4, 'cashier'),
       ($1, $5, 'viewer'),
       ($6, $7, 'owner')`,
    [ids.shopId, ids.ownerId, ids.managerId, ids.cashierId, ids.viewerId, ids.otherShopId, ids.outsiderId],
  );

  return {
    shopId: ids.shopId,
    otherShopId: ids.otherShopId,
    ownerId: ids.ownerId,
    managerId: ids.managerId,
    cashierId: ids.cashierId,
    viewerId: ids.viewerId,
    outsiderId: ids.outsiderId,
  };
}

/** Current role of a membership, read as the superuser so RLS cannot hide it. */
export async function roleOf(exec: SqlExec, shopId: string, userId: string): Promise<string | null> {
  const { rows } = await exec.query<{ role: string }>(
    `SELECT role FROM public.shop_members WHERE shop_id = $1 AND user_id = $2`,
    [shopId, userId],
  );
  return rows[0]?.role ?? null;
}

export async function memberCount(exec: SqlExec, shopId: string): Promise<number> {
  const { rows } = await exec.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.shop_members WHERE shop_id = $1`,
    [shopId],
  );
  return Number(rows[0]?.n ?? "0");
}

/** Audit rows written for a shop, newest first. */
export async function auditActions(exec: SqlExec, shopId: string): Promise<string[]> {
  const { rows } = await exec.query<{ action: string }>(
    `SELECT action FROM public.audit_logs WHERE shop_id = $1 ORDER BY created_at ASC`,
    [shopId],
  );
  return rows.map((r) => r.action);
}

export async function auditRow(
  exec: SqlExec,
  shopId: string,
  action: string,
): Promise<Record<string, unknown> | null> {
  const { rows } = await exec.query<Record<string, unknown>>(
    `SELECT actor_user_id, action, payload FROM public.audit_logs
      WHERE shop_id = $1 AND action = $2
      ORDER BY created_at DESC LIMIT 1`,
    [shopId, action],
  );
  return rows[0] ?? null;
}

/** Invoke a jsonb-returning RPC as a given user. */
export async function callRpc(
  exec: SqlExec,
  userId: string | null,
  sql: string,
  params: unknown[],
): Promise<Record<string, unknown>> {
  const run = async () => {
    const { rows } = await exec.query<{ result: Record<string, unknown> }>(sql, params);
    return rows[0]?.result ?? {};
  };
  return userId === null ? asAnonymous(exec, run) : asUser(exec, userId, run);
}

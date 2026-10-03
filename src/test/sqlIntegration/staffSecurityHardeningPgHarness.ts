import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { SqlExec } from "./transferEnginePgHarness";

export type { SqlExec };

/**
 * Harness for the Phase 3 staff-security work (H1-H4, M2, M3).
 *
 * Bootstraps the pre-Phase-3 production state and optionally applies
 * `20261003010000_staff_security_hardening.sql`. Applying it is opt-in so a test
 * can show the finding is real BEFORE the migration and closed AFTER — otherwise
 * a passing "cannot" assertion may just be testing a schema that never had it.
 */

const ROOT = join(process.cwd(), "supabase", "migrations");
const BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "staffSecurityHardeningBootstrap.sql");
const PHASE3_MIGRATION = join(ROOT, "20261003010000_staff_security_hardening.sql");

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

export function phase3MigrationSql(): string {
  return readSql(PHASE3_MIGRATION);
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

export async function createStaffSecurityHarness(
  options: { applyPhase3?: boolean } = {},
): Promise<SqlExec> {
  const applyPhase3 = options.applyPhase3 ?? true;
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
  if (applyPhase3) await exec.exec(readSql(PHASE3_MIGRATION));
  return exec;
}

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

export type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

export async function attempt<T>(fn: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type StaffFixture = {
  shopId: string;
  otherShopId: string;
  ownerId: string;
  managerId: string;
  cashierId: string;
  viewerId: string;
  /** staff row linked to cashierId */
  cashierStaffClientId: string;
  managerStaffClientId: string;
  deviceFp: string;
  foreignDeviceFp: string;
};

const APPROVED_DEVICE = "device-approved-1";
const FOREIGN_DEVICE = "device-other-shop";

export async function seedStaffFixture(exec: SqlExec): Promise<StaffFixture> {
  const id = () => crypto.randomUUID();
  const ids = {
    shopId: id(),
    otherShopId: id(),
    orgId: id(),
    ownerId: id(),
    managerId: id(),
    cashierId: id(),
    viewerId: id(),
  };

  for (const [userId, email] of [
    [ids.ownerId, "owner@example.test"],
    [ids.managerId, "manager@example.test"],
    [ids.cashierId, "cashier@example.test"],
    [ids.viewerId, "viewer@example.test"],
  ] as const) {
    await exec.query(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1,$2, now())`, [
      userId,
      email,
    ]);
  }

  await exec.query(`INSERT INTO public.organizations (id, name) VALUES ($1,'Org')`, [ids.orgId]);
  await exec.query(
    `INSERT INTO public.organization_members (organization_id, user_id, role) VALUES ($1,$2,'owner')`,
    [ids.orgId, ids.ownerId],
  );
  await exec.query(
    `INSERT INTO public.shops (id, organization_id, name) VALUES ($1,$2,'Main'), ($3,$2,'Other')`,
    [ids.shopId, ids.orgId, ids.otherShopId],
  );

  await exec.query(
    `INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
       ($1,$2,'owner'), ($1,$3,'manager'), ($1,$4,'cashier'), ($1,$5,'viewer')`,
    [ids.shopId, ids.ownerId, ids.managerId, ids.cashierId, ids.viewerId],
  );

  const cashierStaffClientId = id();
  const managerStaffClientId = id();

  // Staff rows linked to the auth users, carrying credential hashes.
  await exec.query(
    `INSERT INTO public.shop_pos_staff (shop_id, client_id, name, username, role, pin_hash, password_hash, user_id, is_active)
     VALUES
       ($1,$2,'Manager','mgr','manager','$2b$10$managerhash','$2b$10$managerpw',$3,true),
       ($1,$4,'Cashier','csh','cashier','$2b$10$cashierhash','$2b$10$cashierpw',$5,true)`,
    [ids.shopId, managerStaffClientId, ids.managerId, cashierStaffClientId, ids.cashierId],
  );

  // An active terminal for this shop, and one belonging to the other shop.
  await exec.query(
    `INSERT INTO public.shop_devices (shop_id, device_fingerprint, approval_status, status)
     VALUES ($1,$2,'approved','active'), ($3,$4,'approved','active')`,
    [ids.shopId, APPROVED_DEVICE, ids.otherShopId, FOREIGN_DEVICE],
  );

  return {
    ...ids,
    cashierStaffClientId,
    managerStaffClientId,
    deviceFp: APPROVED_DEVICE,
    foreignDeviceFp: FOREIGN_DEVICE,
  };
}

/** Run the staff-list RPC as a given user and return the raw jsonb rows. */
export async function listStaff(
  exec: SqlExec,
  userId: string,
  shopId: string,
): Promise<Record<string, unknown>[]> {
  return asUser(exec, userId, async () => {
    const { rows } = await exec.query<{ staff: Record<string, unknown>[] }>(
      `SELECT public.shop_pos_staff_list ($1) AS staff`,
      [shopId],
    );
    return (rows[0]?.staff ?? []) as Record<string, unknown>[];
  });
}

export async function staffField(
  exec: SqlExec,
  shopId: string,
  clientId: string,
  field: string,
): Promise<unknown> {
  const { rows } = await exec.query<Record<string, unknown>>(
    `SELECT ${field} AS v FROM public.shop_pos_staff WHERE shop_id = $1 AND client_id = $2`,
    [shopId, clientId],
  );
  return rows[0]?.v ?? null;
}

export async function callRpc(
  exec: SqlExec,
  userId: string,
  sql: string,
  params: unknown[],
): Promise<Record<string, unknown>> {
  return asUser(exec, userId, async () => {
    const { rows } = await exec.query<{ result: Record<string, unknown> }>(sql, params);
    return rows[0]?.result ?? {};
  });
}

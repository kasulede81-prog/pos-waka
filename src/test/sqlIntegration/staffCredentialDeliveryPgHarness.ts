import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { SqlExec } from "./transferEnginePgHarness";

export type { SqlExec };

/**
 * Harness for Phase 4 (staff credential delivery).
 *
 * Layers, in order:
 *   1. staffSecurityHardeningBootstrap.sql        (pre-Phase-3 schema)
 *   2. 20261003010000_staff_security_hardening.sql (Phase 3, applied)
 *   3. staffCredentialDeliveryBootstrap.sql       (pre-Phase-4 additions)
 *   4. 20261003020000_staff_credential_delivery_lockdown.sql (Phase 4, opt-in)
 *
 * Phase 4 is opt-in so the download exposure and the approval bypass can be
 * demonstrated BEFORE the migration and closed AFTER it.
 */

const ROOT = join(process.cwd(), "supabase", "migrations");
const T = join(process.cwd(), "src", "test", "sqlIntegration");

const PHASE3_BOOTSTRAP = join(T, "staffSecurityHardeningBootstrap.sql");
const PHASE3_MIGRATION = join(ROOT, "20261003010000_staff_security_hardening.sql");
const PHASE4_BOOTSTRAP = join(T, "staffCredentialDeliveryBootstrap.sql");
const PHASE4_MIGRATION = join(ROOT, "20261003020000_staff_credential_delivery_lockdown.sql");

const read = (p: string) => readFileSync(p, "utf8");

export function phase4MigrationSql(): string {
  return read(PHASE4_MIGRATION);
}

export async function createCredentialDeliveryHarness(
  options: { applyPhase4?: boolean } = {},
): Promise<SqlExec> {
  const applyPhase4 = options.applyPhase4 ?? true;
  const url = process.env.TEST_DATABASE_URL?.trim();

  let exec: SqlExec;
  if (url) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    exec = {
      async query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
        const res = await client.query(sql, params);
        return { rows: res.rows as unknown as Row[] };
      },
      async exec(sql: string) {
        await client.query(sql);
      },
      async close() {
        await client.end();
      },
    };
  } else {
    const db = new PGlite();
    exec = {
      async query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
        const res = await db.query<Row>(sql, params);
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

  await exec.exec(read(PHASE3_BOOTSTRAP));
  await exec.exec(read(PHASE3_MIGRATION));
  await exec.exec(read(PHASE4_BOOTSTRAP));
  if (applyPhase4) await exec.exec(read(PHASE4_MIGRATION));
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

export type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

export async function attempt<T>(fn: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Call shop_pos_staff_download() as a user and return the raw jsonb. */
export async function download(
  exec: SqlExec,
  userId: string,
  shopId: string,
  fingerprint: string | null,
): Promise<Record<string, unknown>> {
  return asUser(exec, userId, async () => {
    const { rows } = await exec.query<{ payload: Record<string, unknown> }>(
      `SELECT public.shop_pos_staff_download ($1, 0, $2) AS payload`,
      [shopId, fingerprint],
    );
    return rows[0]?.payload ?? {};
  });
}

export type Phase4Fixture = {
  shopId: string;
  otherShopId: string;
  ownerId: string;
  managerId: string;
  cashierId: string;
  viewerId: string;
  deviceFp: string;
  foreignFp: string;
  cashierStaffClientId: string;
};

export async function seedPhase4Fixture(exec: SqlExec): Promise<Phase4Fixture> {
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
    await exec.query(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1,$2,now())`, [
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
  await exec.query(
    `INSERT INTO public.shop_pos_staff (shop_id, client_id, name, role, pin_hash, password_hash, user_id, is_active)
     VALUES ($1,$2,'Cashier','cashier','$2b$10$cashierhash','$2b$10$cashierpw',$3,true)`,
    [ids.shopId, cashierStaffClientId, ids.cashierId],
  );

  const deviceFp = "approved-terminal-1";
  const foreignFp = "other-shop-terminal";
  await exec.query(
    `INSERT INTO public.shop_devices (shop_id, device_fingerprint, approval_status, status)
     VALUES ($1,$2,'approved','active'), ($3,$4,'approved','active')`,
    [ids.shopId, deviceFp, ids.otherShopId, foreignFp],
  );

  return { ...ids, deviceFp, foreignFp, cashierStaffClientId };
}

/** True when the payload carries any real credential material. */
export function payloadLeaksHashes(payload: Record<string, unknown>): boolean {
  const rows = Array.isArray(payload.changed) ? (payload.changed as Record<string, unknown>[]) : [];
  return rows.some((r) => r.pin_hash != null || r.password_hash != null);
}

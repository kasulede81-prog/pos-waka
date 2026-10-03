import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { SqlExec } from "./transferEnginePgHarness";

export type { SqlExec };

/**
 * Harness for Phase 5 (Google-first invitation acceptance).
 *
 * Bootstraps the PRE-Phase-5 acceptance function, then optionally applies
 * 20261003030000_staff_invite_google_identity.sql, so a test can show the
 * non-Google path was open before and is closed after.
 */

const ROOT = join(process.cwd(), "supabase", "migrations");
const BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "staffInviteGoogleBootstrap.sql");
const PHASE5_MIGRATION = join(ROOT, "20261003030000_staff_invite_google_identity.sql");

const read = (p: string) => readFileSync(p, "utf8");

export function phase5MigrationSql(): string {
  return read(PHASE5_MIGRATION);
}

export async function createInviteGoogleHarness(
  options: { applyPhase5?: boolean } = {},
): Promise<SqlExec> {
  const applyPhase5 = options.applyPhase5 ?? true;
  const url = process.env.TEST_DATABASE_URL?.trim();

  let exec: SqlExec;
  if (url) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    exec = {
      async query<Row extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ) {
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
      async query<Row extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ) {
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

  await exec.exec(read(BOOTSTRAP));
  if (applyPhase5) await exec.exec(read(PHASE5_MIGRATION));
  return exec;
}

/**
 * Run as `authenticated` with a simulated Supabase-signed identity: both the
 * `sub` and `email` claims come from the session the Auth server issued, never
 * from an argument the caller controls. The RPC under test takes no email
 * parameter, which is what makes the simulated claim the only identity input.
 */
export async function asIdentity<T>(
  exec: SqlExec,
  identity: { userId: string; email: string },
  fn: () => Promise<T>,
): Promise<T> {
  await exec.exec("BEGIN");
  await exec.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [identity.userId]);
  await exec.query(`SELECT set_config('request.jwt.claim.email', $1, true)`, [identity.email]);
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

export async function acceptInvite(
  exec: SqlExec,
  identity: { userId: string; email: string },
  token: string,
): Promise<Record<string, unknown>> {
  return asIdentity(exec, identity, async () => {
    const { rows } = await exec.query<{ result: Record<string, unknown> }>(
      `SELECT public.shop_accept_staff_invite ($1) AS result`,
      [token],
    );
    return rows[0]?.result ?? {};
  });
}

export type InviteFixture = {
  shopId: string;
  otherShopId: string;
  ownerId: string;
  alice: { userId: string; email: string };
  bob: { userId: string; email: string };
  token: string;
  invitationId: string;
  staffId: string;
};

export const ALICE_EMAIL = "alice@example.com";
export const BOB_EMAIL = "bob@example.com";

/**
 * One shop with an unlinked staff record, and a pending invitation addressed to
 * Alice's email that points at that staff record.
 *
 * `providers` controls the Google identity each user carries:
 *   "google"      — a verified Google identity matching their email
 *   "google-wrong"— a Google identity whose email is someone else's
 *   "unverified"  — a Google identity Google marked unverified
 *   "password"    — no Google identity at all
 */
export async function seedInviteFixture(
  exec: SqlExec,
  providers: { alice?: "google" | "google-wrong" | "unverified" | "password"; bob?: "google" | "password" } = {},
): Promise<InviteFixture> {
  const id = () => crypto.randomUUID();
  const shopId = id();
  const otherShopId = id();
  const ownerId = id();
  const aliceId = id();
  const bobId = id();

  for (const [uid, email] of [
    [ownerId, "owner@example.com"],
    [aliceId, ALICE_EMAIL],
    [bobId, BOB_EMAIL],
  ] as const) {
    await exec.query(
      `INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data)
       VALUES ($1,$2,now(),'{"provider":"email"}'::jsonb)`,
      [uid, email],
    );
    await exec.query(`INSERT INTO public.profiles (id, primary_shop_id) VALUES ($1, null)`, [uid]);
  }

  await exec.query(`INSERT INTO public.shops (id, name) VALUES ($1,'Main'), ($2,'Other')`, [shopId, otherShopId]);
  await exec.query(
    `INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ($1,$2,'owner')`,
    [shopId, ownerId],
  );

  const googleIdentity = async (userId: string, email: string, verified: boolean) => {
    await exec.query(
      `INSERT INTO auth.identities (user_id, provider, provider_id, identity_data)
       VALUES ($1,'google',$2, jsonb_build_object('email',$3::text,'email_verified',$4::boolean))`,
      [userId, `g-${userId}`, email, verified],
    );
  };

  const aliceProvider = providers.alice ?? "google";
  if (aliceProvider === "google") await googleIdentity(aliceId, ALICE_EMAIL, true);
  if (aliceProvider === "google-wrong") await googleIdentity(aliceId, BOB_EMAIL, true);
  if (aliceProvider === "unverified") await googleIdentity(aliceId, ALICE_EMAIL, false);

  if ((providers.bob ?? "google") === "google") await googleIdentity(bobId, BOB_EMAIL, true);

  await exec.query(
    `INSERT INTO public.shop_pos_staff (shop_id, client_id, name, role, email)
     VALUES ($1,$2,'Alice','waiter',$3)`,
    [shopId, id(), ALICE_EMAIL],
  );
  const { rows: staffRows } = await exec.query<{ id: string }>(
    `SELECT id FROM public.shop_pos_staff WHERE shop_id = $1 AND email = $2`,
    [shopId, ALICE_EMAIL],
  );
  const staffId = staffRows[0]?.id as string;

  const token = `tok-${crypto.randomUUID()}`;
  const invitationId = id();
  await exec.query(
    `INSERT INTO public.shop_staff_invitations
       (id, shop_id, email, membership_role, pos_role, staff_id, invited_by, token_hash, expires_at)
     VALUES ($1,$2,$3,'waiter','waiter',$4,$5,$6, now() + interval '7 days')`,
    [invitationId, shopId, ALICE_EMAIL, staffId, ownerId, `testhash:${token}`],
  );

  return {
    shopId,
    otherShopId,
    ownerId,
    alice: { userId: aliceId, email: ALICE_EMAIL },
    bob: { userId: bobId, email: BOB_EMAIL },
    token,
    invitationId,
    staffId,
  };
}

export async function invitationState(exec: SqlExec, invitationId: string) {
  const { rows } = await exec.query<{
    accepted_at: string | null;
    accepted_by: string | null;
    revoked_at: string | null;
  }>(
    `SELECT accepted_at, accepted_by, revoked_at FROM public.shop_staff_invitations WHERE id = $1`,
    [invitationId],
  );
  return rows[0] ?? null;
}

export async function membershipOf(exec: SqlExec, shopId: string, userId: string) {
  const { rows } = await exec.query<{ role: string }>(
    `SELECT role FROM public.shop_members WHERE shop_id = $1 AND user_id = $2`,
    [shopId, userId],
  );
  return rows[0]?.role ?? null;
}

export async function staffUserId(exec: SqlExec, staffId: string) {
  const { rows } = await exec.query<{ user_id: string | null }>(
    `SELECT user_id FROM public.shop_pos_staff WHERE id = $1`,
    [staffId],
  );
  return rows[0]?.user_id ?? null;
}

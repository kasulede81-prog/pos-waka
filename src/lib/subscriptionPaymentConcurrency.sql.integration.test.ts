import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  createSubscriptionPaymentSqlHarness,
  rpcJson,
  seedSubscriptionPaymentFixture,
  type SqlExec,
  type SubscriptionPaymentFixture,
} from "../test/sqlIntegration/subscriptionPaymentPgHarness";

/**
 * M3-G — GENUINE two-session PostgreSQL concurrency for the payment stack.
 *
 * WHY THIS IS A SEPARATE FILE (mirrors loyaltyProgramCodeConcurrency):
 * The `*.sql.integration.test.ts` suites run on PGlite — ONE connection — so
 * every "race" there is strictly sequential. Their trailing
 * "reports whether real two-session PostgreSQL ran" tests are no-ops
 * (`expect(true).toBe(true)`), and the shared harness opens a single
 * pg.Client even when TEST_DATABASE_URL is set. Those suites cannot make a
 * concurrency claim; this one can.
 *
 * WHAT MAKES THESE REAL RACES:
 *   - a pg.Pool with independent connections (≥2 open at once);
 *   - `makeBarrier`: every participant's transaction is OPEN, claims set,
 *     BEFORE any of them issues the contended statement;
 *   - the RPC runs INSIDE the open transaction, so row locks are held to
 *     commit — exactly the interleaving production sees.
 *
 * HONEST FAILURE (M3-G requirement): with TEST_DATABASE_URL unset this suite
 * FAILS LOUDLY in beforeAll. It never falls back to a single connection, and
 * it is never a green `expect(true)` placeholder. "Passed" here means two
 * real PostgreSQL sessions were used. Run it with a DISPOSABLE database:
 *
 *   TEST_DATABASE_URL=postgres://... npx vitest run src/lib/subscriptionPaymentConcurrency.sql.integration.test.ts
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL?.trim();

/** DKASU production project ref — refused outright (harness applies migrations). */
const PRODUCTION_PROJECT_REF = "ljaedextsenbkxzzgxcg";

function assertDisposableDatabase(url: string): void {
  const lowered = url.toLowerCase();
  const problems: string[] = [];
  if (lowered.includes(PRODUCTION_PROJECT_REF)) {
    problems.push("it names the WAKA production Supabase project ref");
  }
  if (/\.supabase\.(co|com|net|in)(:\d+)?(\/|$|\?)/.test(lowered)) {
    problems.push("it is a hosted Supabase database");
  }
  if (problems.length > 0) {
    throw new Error(
      `REFUSING to run: TEST_DATABASE_URL was rejected because ${problems.join(" and ")}. ` +
        "This suite applies the full WAKA migration chain and must only point at a disposable local PostgreSQL.",
    );
  }
}

/**
 * Start from a EMPTY database every run: the harness fixture uses fixed keys
 * (e.g. plan code `business_m1`), so re-running against a previously-used
 * database fails on INSERT. The suite's contract is a DISPOSABLE database —
 * this enforces it. Run this file STANDALONE; it drops and recreates its
 * target database.
 */
async function resetDisposableDatabase(url: string): Promise<void> {
  const u = new URL(url);
  const dbName = u.pathname.replace(/^\//, "");
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error(`REFUSING to reset: database name ${JSON.stringify(dbName)} is not a plain identifier.`);
  }
  u.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: u.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.end();
  }
}

let exec: SqlExec;
let pool: pg.Pool;
let fx: SubscriptionPaymentFixture;

/** Resolves only once `count` callers arrived — all txs open before any proceeds. */
function makeBarrier(count: number): () => Promise<void> {
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived >= count) open();
    await gate;
  };
}

type Identity = { sub?: string; service?: boolean };

/** Open a transaction with a spoofed caller identity (mirrors asUser, per-connection). */
async function beginAs(c: pg.PoolClient, identity: Identity): Promise<void> {
  await c.query("begin");
  if (identity.sub) {
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [identity.sub]);
  }
  if (identity.service) {
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ role: "service_role" }),
    ]);
  }
}

/**
 * Run one RPC inside its own open transaction, released by a shared barrier
 * so two sessions genuinely overlap on the contended row locks.
 * Returns the jsonb body on success, or `{ __transportError: message }` when
 * the statement itself threw (e.g. a deadlock) — the error is the assertion.
 */
async function racedRpc(
  identity: Identity,
  fn: string,
  args: unknown[],
  barrier: () => Promise<void>,
): Promise<Record<string, unknown>> {
  const c = await pool.connect();
  try {
    await beginAs(c, identity);
    await barrier(); // both transactions are OPEN before either RPC runs
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const r = await c.query(`SELECT public.${fn}(${placeholders}) AS result`, args);
    await c.query("commit");
    return rpcJson(r.rows[0]);
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    return { __transportError: e instanceof Error ? e.message : String(e) };
  } finally {
    c.release();
  }
}

/** Sequential RPC helper on a short-lived connection (setup/teardown only). */
async function rpcOnce(identity: Identity, fn: string, args: unknown[]): Promise<Record<string, unknown>> {
  const c = await pool.connect();
  try {
    await beginAs(c, identity);
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const r = await c.query(`SELECT public.${fn}(${placeholders}) AS result`, args);
    await c.query("commit");
    return rpcJson(r.rows[0]);
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await exec.query<Record<string, unknown>>(sql, params);
  return Object.values(rows[0]!)[0] as T;
}

async function resetSubPayments(): Promise<void> {
  await exec.exec(
    `DELETE FROM public.subscription_payments WHERE subscription_id = '${fx.subscriptionAId}'`,
  );
}

const OWNER = () => ({ sub: fx.ownerAId });
const INTERNAL = () => ({ sub: fx.internalAdminId });

function createArgs(reference: string, opts: { paymentId?: string | null; sub?: string } = {}) {
  return [
    fx.shopAId,
    "mtn_momo",
    reference,
    fx.amountUgx,
    null,
    opts.paymentId ?? null,
    opts.sub ?? fx.subscriptionAId,
    null,
    null,
  ];
}

beforeAll(async () => {
  // HONEST FAILURE: no real two-session PostgreSQL → this suite fails, loudly.
  if (!TEST_DB_URL) {
    throw new Error(
      "M3-G concurrency suite requires TEST_DATABASE_URL (a DISPOSABLE local PostgreSQL). " +
        "Two-session execution cannot be faked: this suite fails rather than skipping, " +
        "running on PGlite, or asserting expect(true). " +
        "Run: TEST_DATABASE_URL=postgres://user@host:5432/db npx vitest run " +
        "src/lib/subscriptionPaymentConcurrency.sql.integration.test.ts",
    );
  }
  assertDisposableDatabase(TEST_DB_URL);
  await resetDisposableDatabase(TEST_DB_URL);
  exec = await createSubscriptionPaymentSqlHarness();
  pool = new pg.Pool({ connectionString: TEST_DB_URL, max: 16 });
  fx = await seedSubscriptionPaymentFixture(exec);
}, 300_000);

afterAll(async () => {
  await pool?.end();
  await exec?.close();
});

// If beforeAll threw (no URL), every test below fails with that message —
// by design. Nothing here is skippable, and nothing asserts true blindly.
describe("M3-G payment concurrency (GENUINE two-session PostgreSQL)", () => {
  it("1. concurrent create/create on one subscription → exactly one actionable pending", async () => {
    await resetSubPayments();
    const barrier = makeBarrier(2);
    const [a, b] = await Promise.all([
      racedRpc(OWNER(), "subscription_payment_create", createArgs("RACE-CREATE-1"), barrier),
      racedRpc(OWNER(), "subscription_payment_create", createArgs("RACE-CREATE-2"), barrier),
    ]);

    expect(a.__transportError, JSON.stringify(a)).toBeUndefined();
    expect(b.__transportError, JSON.stringify(b)).toBeUndefined();
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.idempotent).toBe(false);
    expect(b.idempotent).toBe(false);

    const counts = await exec.query<{ status: string; reason: string | null; n: string }>(
      `SELECT status, status_reason AS reason, count(*)::text AS n
         FROM public.subscription_payments
        WHERE subscription_id = $1
        GROUP BY status, status_reason`,
      [fx.subscriptionAId],
    );
    const byKey = new Map(counts.rows.map((r) => [`${r.status}:${r.reason ?? ""}`, Number(r.n)]));
    expect(byKey.get("pending:") ?? 0, "exactly one actionable pending intent").toBe(1);
    expect(byKey.get("cancelled:stale_replaced") ?? 0, "the loser is stale-replaced").toBe(1);
  }, 60_000);

  it("2. concurrent double-initiation claim → exactly one claims; the loser never reaches the provider", async () => {
    await resetSubPayments();
    const created = await rpcOnce(OWNER(), "subscription_payment_create", createArgs("RACE-CLAIM-1"));
    expect(created.ok).toBe(true);
    const paymentId = String(created.payment_id);

    const barrier = makeBarrier(2);
    const [a, b] = await Promise.all([
      racedRpc(INTERNAL(), "subscription_payment_provider_claim", [paymentId, 300], barrier),
      racedRpc(INTERNAL(), "subscription_payment_provider_claim", [paymentId, 300], barrier),
    ]);

    expect(a.__transportError, JSON.stringify(a)).toBeUndefined();
    expect(b.__transportError, JSON.stringify(b)).toBeUndefined();
    const claimed = [a, b].filter((r) => r.claimed === true);
    const inProgress = [a, b].filter((r) => r.in_progress === true);
    expect(claimed, "exactly one concurrent claim wins").toHaveLength(1);
    expect(inProgress, "the loser observes in_progress (provider not called twice)").toHaveLength(1);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // Claim marker persisted exactly once, on the winning row.
    const claimAt = await scalar<string>(
      `SELECT metadata ->> 'initiate_claimed_at' FROM public.subscription_payments WHERE id = $1`,
      [paymentId],
    );
    expect(claimAt).toBeTruthy();
  }, 60_000);

  it("3. confirm vs fail on the same payment → no deadlock; state consistent with period effect", async () => {
    await resetSubPayments();
    const created = await rpcOnce(OWNER(), "subscription_payment_create", createArgs("RACE-CF-1"));
    const paymentId = String(created.payment_id);
    const baseEnd = await scalar<string>(
      `SELECT current_period_end::text FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );

    const barrier = makeBarrier(2);
    const [confirm, fail] = await Promise.all([
      racedRpc(INTERNAL(), "subscription_payment_confirm", [paymentId, null, null], barrier),
      racedRpc(INTERNAL(), "subscription_payment_fail", [paymentId, "race"], barrier),
    ]);

    // M3-G lock order (subscription → payment on BOTH paths): no ABBA deadlock.
    expect(confirm.__transportError, JSON.stringify(confirm)).toBeUndefined();
    expect(fail.__transportError, JSON.stringify(fail)).toBeUndefined();

    const status = await scalar<string>(
      `SELECT status FROM public.subscription_payments WHERE id = $1`,
      [paymentId],
    );
    const endNow = await scalar<string>(
      `SELECT current_period_end::text FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );

    if (status === "confirmed") {
      expect(confirm.ok).toBe(true);
      // Period advanced exactly once. Compared as a timestamptz (NOT
      // `end - base = interval '1 month'` — PostgreSQL compares that by
      // normalizing months to 30 days, so any real month that isn't exactly
      // 30 days long would fail a correct product).
      const advanced = await scalar<number>(
        `SELECT (current_period_end = $1::timestamptz + interval '1 month')::int
           FROM public.subscriptions WHERE id = $2`,
        [baseEnd, fx.subscriptionAId],
      );
      expect(advanced).toBe(1);
      expect(endNow).not.toBe(baseEnd);
    } else {
      expect(status).toBe("failed");
      expect(fail.ok).toBe(true);
      expect(endNow, "a failed payment never advances the period").toBe(baseEnd);
    }
  }, 60_000);

  it("4. callback/status settlement race → two concurrent confirms, ONE period advance", async () => {
    await resetSubPayments();
    const created = await rpcOnce(OWNER(), "subscription_payment_create", createArgs("RACE-SETTLE-1"));
    const paymentId = String(created.payment_id);
    const baseEnd = await scalar<string>(
      `SELECT current_period_end::text FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );

    const barrier = makeBarrier(2);
    // Two settlement channels (callback + status poll) confirming simultaneously.
    const [a, b] = await Promise.all([
      racedRpc(INTERNAL(), "subscription_payment_confirm", [paymentId, null, null], barrier),
      racedRpc(INTERNAL(), "subscription_payment_confirm", [paymentId, null, null], barrier),
    ]);

    expect(a.__transportError, JSON.stringify(a)).toBeUndefined();
    expect(b.__transportError, JSON.stringify(b)).toBeUndefined();
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // One real apply, one idempotent observation.
    const idempotents = [a, b].filter((r) => r.idempotent === true);
    expect(idempotents, "the second confirm replays idempotently").toHaveLength(1);

    const adv = await scalar<number>(
      `SELECT (current_period_end = $1::timestamptz + interval '1 month')::int
         FROM public.subscriptions WHERE id = $2`,
      [baseEnd, fx.subscriptionAId],
    );
    expect(adv, "exactly one period advance for two racing confirms").toBe(1);
    const status = await scalar<string>(
      `SELECT status FROM public.subscription_payments WHERE id = $1`,
      [paymentId],
    );
    expect(status).toBe("confirmed");
  }, 60_000);

  it("5. stale-replacement racing provider success → initiated payment is NEVER cancelled", async () => {
    await resetSubPayments();
    const created = await rpcOnce(OWNER(), "subscription_payment_create", createArgs("RACE-INITIATED"));
    const initiatedId = String(created.payment_id);
    const attached = await rpcOnce(INTERNAL(), "subscription_payment_provider_attach", [
      initiatedId,
      "prov-race-1",
      "+256781234567",
      null,
    ]);
    expect(attached.ok).toBe(true);

    const barrier = makeBarrier(2);
    // A new intent racing the settlement of the initiated payment.
    const [newIntent, confirm] = await Promise.all([
      racedRpc(OWNER(), "subscription_payment_create", createArgs("RACE-NEWER-INTENT"), barrier),
      racedRpc(INTERNAL(), "subscription_payment_confirm", [initiatedId, null, null], barrier),
    ]);

    expect(newIntent.__transportError, JSON.stringify(newIntent)).toBeUndefined();
    expect(confirm.__transportError, JSON.stringify(confirm)).toBeUndefined();
    expect(newIntent.ok).toBe(true);
    expect(confirm.ok).toBe(true);

    const initiatedStatus = await scalar<string>(
      `SELECT status FROM public.subscription_payments WHERE id = $1`,
      [initiatedId],
    );
    expect(
      initiatedStatus,
      "a provider-initiated payment must never be stale-replaced (money in flight)",
    ).toBe("confirmed");
    const pendingNew = await scalar<number>(
      `SELECT count(*)::int FROM public.subscription_payments
        WHERE subscription_id = $1 AND status = 'pending' AND reference = 'RACE-NEWER-INTENT'`,
      [fx.subscriptionAId],
    );
    expect(pendingNew, "the new intent remains actionable").toBe(1);
  }, 60_000);

  it("6. replay/idempotency first-execution race → same (provider, reference) yields ONE row", async () => {
    await resetSubPayments();
    const barrier = makeBarrier(2);
    // Two "lost response" retries racing the FIRST execution — the unique
    // (provider, reference) index + unique_violation recovery must converge.
    const [a, b] = await Promise.all([
      racedRpc(OWNER(), "subscription_payment_create", createArgs("RACE-SAME-REF"), barrier),
      racedRpc(OWNER(), "subscription_payment_create", createArgs("RACE-SAME-REF"), barrier),
    ]);

    expect(a.__transportError, JSON.stringify(a)).toBeUndefined();
    expect(b.__transportError, JSON.stringify(b)).toBeUndefined();
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.payment_id, "both callers converge on the winner").toBe(b.payment_id);
    expect([a.idempotent, b.idempotent].filter((x) => x === true).length,
      "the loser returns idempotent:true").toBeGreaterThanOrEqual(1);

    const rows = await scalar<number>(
      `SELECT count(*)::int FROM public.subscription_payments
        WHERE subscription_id = $1 AND reference = 'RACE-SAME-REF'`,
      [fx.subscriptionAId],
    );
    expect(rows, "exactly one ledger row for the raced reference").toBe(1);
  }, 60_000);

  it("7. lock order: confirm vs cancel repeatedly → zero deadlocks, consistent outcomes", async () => {
    // fail/cancel/refund were re-ordered to subscription → payment in
    // 20261007200000; this exercises the previously-inverted pair directly.
    for (let round = 0; round < 3; round += 1) {
      await resetSubPayments();
      const created = await rpcOnce(OWNER(), "subscription_payment_create", createArgs(`RACE-LOCK-${round}`));
      const paymentId = String(created.payment_id);
      const baseEnd = await scalar<string>(
        `SELECT current_period_end::text FROM public.subscriptions WHERE id = $1`,
        [fx.subscriptionAId],
      );

      const barrier = makeBarrier(2);
      const [confirm, cancel] = await Promise.all([
        racedRpc(INTERNAL(), "subscription_payment_confirm", [paymentId, null, null], barrier),
        racedRpc(INTERNAL(), "subscription_payment_cancel", [paymentId, "race"], barrier),
      ]);

      expect(confirm.__transportError, `round ${round}: ${JSON.stringify(confirm)}`).toBeUndefined();
      expect(cancel.__transportError, `round ${round}: ${JSON.stringify(cancel)}`).toBeUndefined();

      const status = await scalar<string>(
        `SELECT status FROM public.subscription_payments WHERE id = $1`,
        [paymentId],
      );
      const endNow = await scalar<string>(
        `SELECT current_period_end::text FROM public.subscriptions WHERE id = $1`,
        [fx.subscriptionAId],
      );
      if (status === "confirmed") {
        expect(endNow).not.toBe(baseEnd);
      } else {
        expect(status).toBe("cancelled");
        expect(endNow).toBe(baseEnd);
      }
    }
  }, 90_000);
});

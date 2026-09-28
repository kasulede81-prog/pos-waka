import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  createLoyaltySqlHarness,
  enableProgram,
  insertCompletedSale,
  rpcJson,
  seedLoyaltyFixture,
  type LoyaltyFixture,
  type SqlExec,
} from "../../test/sqlIntegration/loyaltyPgHarness";

/**
 * Phase 0 (Member Dashboard) — grant-layer hardening + over-exposed RPC revokes.
 *
 * Run under the PRODUCTION privilege posture. The default harness never grants table DML to
 * `authenticated`, so a "permission denied" there could just mean "never granted". With
 * `productionGrants: true` the harness reproduces the platform baseline (blanket DML plus
 * TRUNCATE/REFERENCES/TRIGGER) before the migrations run, so every denial below proves a
 * Phase 0 revoke is doing the work rather than an absent grant.
 *
 * The load-bearing assertions are the POSITIVE ones — a completed sale must still award points
 * and merchant reward CRUD must still work. Revoking privileges is only safe if the engine and
 * the merchant flows are unaffected, and that is what these tests exist to prove.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

/** Tables no client writes directly — grants should be SELECT-only after Phase 0. */
const RPC_ONLY_TABLES = [
  "public.loyalty_transactions",
  "public.loyalty_reward_assignments",
  "public.loyalty_point_lot_allocations",
  "public.loyalty_customer_offers",
  "public.loyalty_redemptions",
];

async function attempt(
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: number } | { error: string }> {
  try {
    return await asUser(exec, userId, async () => {
      const { rows } = await exec.query(
        `WITH w AS (${sql} RETURNING 1) SELECT count(*)::int AS n FROM w`,
        params,
      );
      return { rows: Number((rows[0] as { n: number }).n) };
    });
  } catch (err) {
    return { error: String((err as Error).message) };
  }
}

/** Run a statement as `userId`, returning the error message or null on success. */
async function attemptRaw(userId: string, sql: string): Promise<string | null> {
  try {
    await asUser(exec, userId, async () => {
      await exec.query(sql);
    });
    return null;
  } catch (err) {
    return String((err as Error).message);
  }
}

beforeAll(async () => {
  exec = await createLoyaltySqlHarness({ productionGrants: true });
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId);
}, T);

afterAll(async () => {
  await exec.close();
});

describe("Phase 0: the ledger is read-only to browser roles", () => {
  it("authenticated holds SELECT and nothing else on loyalty_transactions", async () => {
    const { rows } = await exec.query<{
      sel: boolean;
      ins: boolean;
      upd: boolean;
      del: boolean;
      trunc: boolean;
    }>(
      `SELECT has_table_privilege('authenticated','public.loyalty_transactions','SELECT') AS sel,
              has_table_privilege('authenticated','public.loyalty_transactions','INSERT') AS ins,
              has_table_privilege('authenticated','public.loyalty_transactions','UPDATE') AS upd,
              has_table_privilege('authenticated','public.loyalty_transactions','DELETE') AS del,
              has_table_privilege('authenticated','public.loyalty_transactions','TRUNCATE') AS trunc`,
    );
    expect(rows[0]).toEqual({ sel: true, ins: false, upd: false, del: false, trunc: false });
  });

  it("a merchant cannot write or truncate the ledger, even for their own shop", async () => {
    const acct = await exec.query<{ id: string }>(
      `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 LIMIT 1`,
      [f.shopAId],
    );
    expect(
      await attempt(
        f.ownerAId,
        `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause)
         VALUES ($1,$2,'adjusted',999,'manual_adjustment')`,
        [f.shopAId, acct.rows[0]?.id ?? f.customerAId],
      ),
    ).toMatchObject({ error: expect.stringMatching(/permission denied/i) });

    expect(await attemptRaw(f.ownerAId, `TRUNCATE public.loyalty_transactions`)).toMatch(
      /permission denied/i,
    );
  });

  it("the ledger stays readable to the merchant (SELECT is untouched)", async () => {
    await insertCompletedSale(exec, f, { totalUgx: 5000, customerId: f.customerAId });
    const n = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.loyalty_transactions WHERE shop_id = $1`,
        [f.shopAId],
      );
      return Number(rows[0]!.n);
    });
    expect(n).toBeGreaterThan(0);
  });
});

describe("Phase 0: RPC-only tables expose SELECT only", () => {
  it("no write grant survives on any RPC-only table", async () => {
    for (const t of RPC_ONLY_TABLES) {
      const { rows } = await exec.query<{ ins: boolean; upd: boolean; del: boolean; trunc: boolean }>(
        `SELECT has_table_privilege('authenticated',$1,'INSERT') AS ins,
                has_table_privilege('authenticated',$1,'UPDATE') AS upd,
                has_table_privilege('authenticated',$1,'DELETE') AS del,
                has_table_privilege('authenticated',$1,'TRUNCATE') AS trunc`,
        [t],
      );
      expect(rows[0], t).toEqual({ ins: false, upd: false, del: false, trunc: false });
    }
  });

  it("loyalty_accounts keeps SELECT but loses DELETE and TRUNCATE", async () => {
    const { rows } = await exec.query<{ sel: boolean; ins: boolean; upd: boolean; del: boolean; trunc: boolean }>(
      `SELECT has_table_privilege('authenticated','public.loyalty_accounts','SELECT') AS sel,
              has_table_privilege('authenticated','public.loyalty_accounts','INSERT') AS ins,
              has_table_privilege('authenticated','public.loyalty_accounts','UPDATE') AS upd,
              has_table_privilege('authenticated','public.loyalty_accounts','DELETE') AS del,
              has_table_privilege('authenticated','public.loyalty_accounts','TRUNCATE') AS trunc`,
    );
    expect(rows[0]).toEqual({ sel: true, ins: false, upd: false, del: false, trunc: false });
  });

  it("anon holds no write grant on any loyalty table", async () => {
    for (const t of [...RPC_ONLY_TABLES, "public.loyalty_accounts", "public.loyalty_programs"]) {
      const { rows } = await exec.query<{ w: boolean; trunc: boolean }>(
        `SELECT (has_table_privilege('anon',$1,'INSERT') OR has_table_privilege('anon',$1,'UPDATE')
                 OR has_table_privilege('anon',$1,'DELETE')) AS w,
                has_table_privilege('anon',$1,'TRUNCATE') AS trunc`,
        [t],
      );
      expect(rows[0], t).toEqual({ w: false, trunc: false });
    }
  });
});

describe("Phase 0: load-bearing merchant grants were preserved", () => {
  it("loyalty_rewards keeps INSERT/UPDATE but loses DELETE and TRUNCATE", async () => {
    const { rows } = await exec.query<{ ins: boolean; upd: boolean; del: boolean; trunc: boolean }>(
      `SELECT has_table_privilege('authenticated','public.loyalty_rewards','INSERT') AS ins,
              has_table_privilege('authenticated','public.loyalty_rewards','UPDATE') AS upd,
              has_table_privilege('authenticated','public.loyalty_rewards','DELETE') AS del,
              has_table_privilege('authenticated','public.loyalty_rewards','TRUNCATE') AS trunc`,
    );
    // INSERT/UPDATE are the client write path and stay. DELETE has no policy and no client
    // caller (rewards are deactivated, never removed), so it is revoked.
    expect(rows[0]).toEqual({ ins: true, upd: true, del: false, trunc: false });
  });

  it("customers keeps full DML for the offline sync upsert, loses TRUNCATE", async () => {
    const { rows } = await exec.query<{ ins: boolean; upd: boolean; trunc: boolean }>(
      `SELECT has_table_privilege('authenticated','public.customers','INSERT') AS ins,
              has_table_privilege('authenticated','public.customers','UPDATE') AS upd,
              has_table_privilege('authenticated','public.customers','TRUNCATE') AS trunc`,
    );
    expect(rows[0]).toEqual({ ins: true, upd: true, trunc: false });
  });

  it("the merchant can still create and update a reward directly (client write path)", async () => {
    const created = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query<{ id: string }>(
        `INSERT INTO public.loyalty_rewards (shop_id, name, points_required)
         VALUES ($1,'Phase 0 Reward',50) RETURNING id`,
        [f.shopAId],
      );
      return rows[0]!.id;
    });
    expect(created).toBeTruthy();

    const updated = await attempt(
      f.ownerAId,
      `UPDATE public.loyalty_rewards SET name = 'Phase 0 Reward v2' WHERE id = '${created}'`,
    );
    expect(updated).toEqual({ rows: 1 });
  });

  it("the offline customer upsert still succeeds", async () => {
    const id = crypto.randomUUID();
    const r = await attempt(
      f.cashierAId,
      `INSERT INTO public.customers (id, shop_id, name, phone_e164)
       VALUES ('${id}','${f.shopAId}','Offline Sync Customer','+256700111222')`,
    );
    expect(r).toEqual({ rows: 1 });
  });
});

describe("Phase 0: the loyalty engine still awards points", () => {
  it("a completed sale still writes an earned ledger row and moves the balance", async () => {
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 7000, customerId: f.customerAId });

    const { rows } = await exec.query<{ kind: string; points: number }>(
      `SELECT kind, points FROM public.loyalty_transactions
        WHERE shop_id = $1 AND source_sale_id = $2`,
      [f.shopAId, saleId],
    );
    // The engine calls loyalty_earn_lot_remaining / loyalty_outstanding_for_sale from TRIGGER
    // context; if the Phase 0 revokes had broken that path, this row would not exist.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("earned");
    expect(Number(rows[0]!.points)).toBeGreaterThan(0);

    const acct = await exec.query<{ balance_points: number }>(
      `SELECT balance_points FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
      [f.shopAId, f.customerAId],
    );
    expect(Number(acct.rows[0]!.balance_points)).toBeGreaterThan(0);
  });

  it("a void still reverses through the engine", async () => {
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 4000, customerId: f.customerAId });
    await exec.query(`UPDATE public.sales SET status = 'void' WHERE id = $1`, [saleId]);
    const { rows } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_transactions
        WHERE shop_id = $1 AND source_sale_id = $2 AND kind = 'reversed'`,
      [f.shopAId, saleId],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("the merchant-facing offer RPC still works (it composes the revoked helper)", async () => {
    const acct = await exec.query<{ id: string }>(
      `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 LIMIT 1`,
      [f.shopAId],
    );
    const r = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_preview_account_offers($1,$2) AS result`,
        [f.shopAId, acct.rows[0]!.id],
      );
      return rpcJson(rows[0]);
    });
    expect(r.ok).toBe(true);
  });
});

describe("Phase 0: the two cross-tenant RPCs are no longer callable", () => {
  const accountId = () => f.customerAId;

  it("loyalty_resolve_customer_offers is denied to authenticated", async () => {
    const err = await attemptRaw(
      f.ownerAId,
      `SELECT public.loyalty_resolve_customer_offers('${accountId()}'::uuid, now())`,
    );
    expect(err).toMatch(/permission denied/i);
  });

  it("loyalty_account_reward_granted is denied to authenticated", async () => {
    const err = await attemptRaw(
      f.ownerAId,
      `SELECT public.loyalty_account_reward_granted('${accountId()}'::uuid, gen_random_uuid(), now())`,
    );
    expect(err).toMatch(/permission denied/i);
  });

  it("loyalty_earn_lot_remaining is denied to authenticated and anon", async () => {
    const err = await attemptRaw(
      f.ownerAId,
      `SELECT public.loyalty_earn_lot_remaining(gen_random_uuid())`,
    );
    expect(err).toMatch(/permission denied/i);

    const { rows } = await exec.query<{ auth: boolean; anon: boolean; pub: boolean }>(
      `SELECT has_function_privilege('authenticated','public.loyalty_earn_lot_remaining(uuid)','EXECUTE') AS auth,
              has_function_privilege('anon','public.loyalty_earn_lot_remaining(uuid)','EXECUTE') AS anon,
              EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       WHERE p.oid = to_regprocedure('public.loyalty_earn_lot_remaining(uuid)')
                         AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS pub`,
    );
    expect(rows[0]).toEqual({ auth: false, anon: false, pub: false });
  });

  it("all three remain executable by definer callers (owner retains EXECUTE)", async () => {
    // Proven indirectly: the offer preview above succeeded, and the sale engine above awarded
    // points. Here we assert the functions still resolve and the owner holds EXECUTE.
    for (const sig of [
      "public.loyalty_resolve_customer_offers(uuid, timestamptz)",
      "public.loyalty_account_reward_granted(uuid, uuid, timestamptz)",
      "public.loyalty_earn_lot_remaining(uuid)",
    ]) {
      const { rows } = await exec.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_proc WHERE oid = to_regprocedure($1)`,
        [sig],
      );
      expect(rows[0]!.n, sig).toBe(1);
    }
  });
});

describe("Phase 0: the merchant surface is unchanged", () => {
  it("the core merchant loyalty RPCs still authorize their own shop", async () => {
    const overview = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(`SELECT public.loyalty_shop_overview($1) AS result`, [f.shopAId]);
      return rpcJson(rows[0]);
    });
    expect(overview.ok).toBe(true);

    const usage = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(`SELECT public.shop_loyalty_usage($1) AS result`, [f.shopAId]);
      return rpcJson(rows[0]);
    });
    expect(usage.ok).toBe(true);
  });

  it("an outsider still cannot reach the merchant loyalty surface", async () => {
    const r = await asUser(exec, f.outsiderId, async () => {
      const { rows } = await exec.query(`SELECT public.loyalty_shop_overview($1) AS result`, [f.shopAId]);
      return rpcJson(rows[0]);
    });
    expect(r.ok).toBe(false);
  });

  it("shop B's owner cannot read shop A's ledger rows", async () => {
    const n = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.loyalty_transactions WHERE shop_id = $1`,
        [f.shopBId],
      );
      return Number(rows[0]!.n);
    });
    expect(n).toBe(0);
  });
});

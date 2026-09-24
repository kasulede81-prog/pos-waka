/**
 * C3 points expiry — SQL integration (local harness only).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

let exec: SqlExec;
let f: LoyaltyFixture;
let accountId: string;

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId, { earnUnitUgx: 1000, earnPointsPerUnit: 1 });
  const enrolled = await asUser(exec, f.ownerAId, async () => {
    const { rows } = await exec.query(
      `SELECT public.loyalty_enroll_customer($1, $2, true, 'c3', '{}'::jsonb) AS result`,
      [f.shopAId, f.customerAId],
    );
    return rpcJson(rows[0]);
  });
  accountId = String(enrolled.account_id);
}, 120_000);

afterAll(async () => {
  await exec.close();
});

async function setPointsMode(mode: "never" | "rolling_months", months: number | null) {
  await asUser(exec, f.ownerAId, async () => {
    const r = rpcJson(
      (
        await exec.query(
          `SELECT public.loyalty_update_program(
             $1, true, 1000, 1, 0, 'never', NULL, NULL, $2, $3
           ) AS result`,
          [f.shopAId, mode, months],
        )
      ).rows[0],
    );
    expect(r.ok).toBe(true);
  });
}

async function earnViaSale(totalUgx: number, customerId = f.customerAId) {
  return insertCompletedSale(exec, f, { totalUgx, customerId });
}

async function insertReward(points: number, expiresOn: string | null = null) {
  const id = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, active, expires_on)
     VALUES ($1, $2, $3, $4, true, $5::date)`,
    [id, f.shopAId, `R-${id.slice(0, 8)}`, points, expiresOn],
  );
  return id;
}

async function redeem(rewardId: string, key?: string) {
  return asUser(exec, f.ownerAId, async () =>
    rpcJson(
      (
        await exec.query(
          `SELECT public.loyalty_redeem_reward($1, $2, $3, $4, NULL, NULL) AS result`,
          [f.shopAId, accountId, rewardId, key ?? `c3-${crypto.randomUUID()}`],
        )
      ).rows[0],
    ),
  );
}

describe("C3 loyalty points expiry", () => {
  it("defaults: never mode; existing/new earns under never have expires_at NULL", async () => {
    await setPointsMode("never", null);
    const saleId = await earnViaSale(5000);
    const { rows } = await exec.query<{ expires: string | null; pts: number }>(
      `SELECT expires_at::text AS expires, points AS pts
       FROM public.loyalty_transactions
       WHERE source_sale_id = $1 AND kind = 'earned'`,
      [saleId],
    );
    expect(rows[0]?.pts).toBe(5);
    expect(rows[0]?.expires).toBeNull();
  });

  it("rolling mode stamps expires_at on NEW earns only; prior NULL stays", async () => {
    await setPointsMode("never", null);
    const oldSale = await earnViaSale(3000);
    await setPointsMode("rolling_months", 12);
    const newSale = await earnViaSale(4000);
    const old = await exec.query<{ expires: string | null }>(
      `SELECT expires_at::text AS expires FROM public.loyalty_transactions
       WHERE source_sale_id = $1 AND kind = 'earned'`,
      [oldSale],
    );
    const neu = await exec.query<{ expires: string | null }>(
      `SELECT expires_at::text AS expires FROM public.loyalty_transactions
       WHERE source_sale_id = $1 AND kind = 'earned'`,
      [newSale],
    );
    expect(old.rows[0]?.expires).toBeNull();
    expect(neu.rows[0]?.expires).toBeTruthy();
  });

  it("Kampala boundary: active before exclusive bound; expire after", async () => {
    const { rows } = await exec.query<{ exp: string }>(
      `SELECT public.loyalty_compute_earn_expires_at('rolling_months', 1, '2027-01-15 10:00:00+03'::timestamptz)::text AS exp`,
    );
    expect(rows[0]?.exp).toBeTruthy();
    const on = await exec.query<{ on: string }>(
      `SELECT public.loyalty_membership_expires_on_date(
         public.loyalty_compute_earn_expires_at('rolling_months', 1, '2027-01-15 10:00:00+03'::timestamptz)
       )::text AS on`,
    );
    expect(on.rows[0]?.on).toBe("2027-02-15");
  });

  it("FIFO: expire oldest due lot; no double expire; balance never negative", async () => {
    await setPointsMode("never", null);
    const customerId = crypto.randomUUID();
    await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, 'FIFO')`, [
      customerId,
      f.shopAId,
    ]);
    const enrolled = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_enroll_customer($1, $2, true, 'c3', '{}'::jsonb) AS result`,
            [f.shopAId, customerId],
          )
        ).rows[0],
      ),
    );
    const aid = String(enrolled.account_id);
    const sale1 = await insertCompletedSale(exec, f, { totalUgx: 10_000, customerId });
    const sale2 = await insertCompletedSale(exec, f, { totalUgx: 20_000, customerId });
    const e1 = await exec.query<{ id: string }>(
      `SELECT id FROM public.loyalty_transactions WHERE source_sale_id = $1 AND kind = 'earned'`,
      [sale1],
    );
    const e2 = await exec.query<{ id: string }>(
      `SELECT id FROM public.loyalty_transactions WHERE source_sale_id = $1 AND kind = 'earned'`,
      [sale2],
    );
    await exec.query(
      `UPDATE public.loyalty_transactions SET expires_at = now() - interval '1 hour' WHERE id = $1`,
      [e1.rows[0]?.id],
    );
    await exec.query(
      `UPDATE public.loyalty_transactions SET expires_at = now() + interval '30 days' WHERE id = $1`,
      [e2.rows[0]?.id],
    );

    const first = rpcJson(
      (await exec.query(`SELECT public.loyalty_expire_due_points($1) AS result`, [aid])).rows[0],
    );
    expect(first.ok).toBe(true);
    expect(Number(first.expired_points)).toBe(10);
    const bal = await exec.query<{ b: number }>(
      `SELECT balance_points AS b FROM public.loyalty_accounts WHERE id = $1`,
      [aid],
    );
    expect(bal.rows[0]?.b).toBe(20);

    const second = rpcJson(
      (await exec.query(`SELECT public.loyalty_expire_due_points($1) AS result`, [aid])).rows[0],
    );
    expect(Number(second.expired_points)).toBe(0);
    expect(
      (
        await exec.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public.loyalty_transactions
           WHERE account_id = $1 AND kind = 'expired'`,
          [aid],
        )
      ).rows[0]?.n,
    ).toBe(1);

    const alloc = await exec.query<{ pts: number; earn: string }>(
      `SELECT points AS pts, earn_transaction_id::text AS earn
       FROM public.loyalty_point_lot_allocations
       WHERE account_id = $1 AND kind = 'expired'`,
      [aid],
    );
    expect(alloc.rows[0]?.pts).toBe(10);
    expect(alloc.rows[0]?.earn).toBe(e1.rows[0]?.id);
  });

  it("redeem after due expiry → insufficient_points; no redemption when short", async () => {
    await setPointsMode("never", null);
    const customerId = crypto.randomUUID();
    await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, 'Short')`, [
      customerId,
      f.shopAId,
    ]);
    const enrolled = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_enroll_customer($1, $2, true, 'c3', '{}'::jsonb) AS result`,
            [f.shopAId, customerId],
          )
        ).rows[0],
      ),
    );
    const aid = String(enrolled.account_id);
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 5000, customerId });
    await exec.query(
      `UPDATE public.loyalty_transactions
       SET expires_at = now() - interval '1 day'
       WHERE source_sale_id = $1 AND kind = 'earned'`,
      [saleId],
    );
    const rewardId = await insertReward(3);
    const result = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_redeem_reward($1, $2, $3, $4, NULL, NULL) AS result`,
            [f.shopAId, aid, rewardId, `c3-short-${crypto.randomUUID()}`],
          )
        ).rows[0],
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("insufficient_points");
    expect(Number(result.balance)).toBe(0);
  });

  it("return after expiry cannot reverse already-expired points", async () => {
    await setPointsMode("never", null);
    const customerId = crypto.randomUUID();
    await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, 'Ret')`, [
      customerId,
      f.shopAId,
    ]);
    await asUser(exec, f.ownerAId, async () => {
      await exec.query(
        `SELECT public.loyalty_enroll_customer($1, $2, true, 'c3', '{}'::jsonb)`,
        [f.shopAId, customerId],
      );
    });
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 10_000, customerId });
    const earn = await exec.query<{ id: string; account: string }>(
      `SELECT id, account_id::text AS account FROM public.loyalty_transactions
       WHERE source_sale_id = $1 AND kind = 'earned'`,
      [saleId],
    );
    await exec.query(
      `UPDATE public.loyalty_transactions SET expires_at = now() - interval '2 hours' WHERE id = $1`,
      [earn.rows[0]?.id],
    );
    rpcJson(
      (
        await exec.query(`SELECT public.loyalty_expire_due_points($1) AS result`, [
          earn.rows[0]?.account,
        ])
      ).rows[0],
    );
    expect(
      Number(
        (
          await exec.query<{ o: number }>(
            `SELECT public.loyalty_outstanding_for_sale($1) AS o`,
            [saleId],
          )
        ).rows[0]?.o,
      ),
    ).toBe(0);

    const returnId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.sale_returns (id, shop_id, sale_id, product_id, quantity, refund_amount_ugx, reason)
       VALUES ($1, $2, $3, $4, 1, 10000, 'other')`,
      [returnId, f.shopAId, saleId, f.productAId],
    );
    // Trigger may already reverse; call explicitly for assertion.
    const rev = rpcJson(
      (
        await exec.query(`SELECT public.loyalty_reverse_for_return($1) AS result`, [returnId])
      ).rows[0],
    );
    expect(rev.reversed === false || rev.reason === "already_reversed" || rev.reason === "nothing_outstanding").toBe(
      true,
    );
    const bal = await exec.query<{ b: number }>(
      `SELECT balance_points AS b FROM public.loyalty_accounts WHERE id = $1`,
      [earn.rows[0]?.account],
    );
    expect(bal.rows[0]?.b).toBeGreaterThanOrEqual(0);
  });

  it("C1 membership_expired still precedes C3; C2 reward_expired preserved", async () => {
    await setPointsMode("never", null);
    await exec.query(
      `UPDATE public.loyalty_accounts
       SET membership_expires_at = now() - interval '1 day'
       WHERE id = $1`,
      [accountId],
    );
    const rewardOk = await insertReward(10, "2035-01-01");
    const mem = await redeem(rewardOk);
    expect(mem.ok).toBe(false);
    expect(mem.error).toBe("membership_expired");

    await exec.query(
      `UPDATE public.loyalty_accounts SET membership_expires_at = NULL WHERE id = $1`,
      [accountId],
    );
    const rewardExp = await insertReward(10, "2020-01-01");
    const rew = await redeem(rewardExp);
    expect(rew.ok).toBe(false);
    expect(rew.error).toBe("reward_expired");
  });

  it("expire RPC not executable as authenticated; outsider cannot change points mode", async () => {
    let denied = false;
    try {
      await asUser(exec, f.ownerAId, async () => {
        await exec.query(`SELECT public.loyalty_expire_due_points($1)`, [accountId]);
      });
    } catch {
      denied = true;
    }
    expect(denied).toBe(true);

    const forbidden = await asUser(exec, f.outsiderId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_update_program(
               $1, true, 1000, 1, 0, 'never', NULL, NULL, 'rolling_months', 6
             ) AS result`,
            [f.shopAId],
          )
        ).rows[0],
      ),
    );
    expect(forbidden.ok).toBe(false);
    expect(forbidden.error).toBe("forbidden");
  });

  it("FIFO redeem allocates oldest earn first", async () => {
    await setPointsMode("never", null);
    const customerId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, 'Alloc')`,
      [customerId, f.shopAId],
    );
    const enrolled = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_enroll_customer($1, $2, true, 'c3', '{}'::jsonb) AS result`,
            [f.shopAId, customerId],
          )
        ).rows[0],
      ),
    );
    const aid = String(enrolled.account_id);
    const s1 = await insertCompletedSale(exec, f, { totalUgx: 10_000, customerId });
    const s2 = await insertCompletedSale(exec, f, { totalUgx: 10_000, customerId });
    const e1 = (
      await exec.query<{ id: string }>(
        `SELECT id FROM public.loyalty_transactions WHERE source_sale_id = $1 AND kind = 'earned'`,
        [s1],
      )
    ).rows[0]?.id;
    const rewardId = await insertReward(5);
    const ok = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_redeem_reward($1, $2, $3, $4, NULL, NULL) AS result`,
            [f.shopAId, aid, rewardId, `c3-alloc-${crypto.randomUUID()}`],
          )
        ).rows[0],
      ),
    );
    expect(ok.ok).toBe(true);
    const alloc = await exec.query<{ earn: string; pts: number }>(
      `SELECT earn_transaction_id::text AS earn, points AS pts
       FROM public.loyalty_point_lot_allocations
       WHERE account_id = $1 AND kind = 'redeemed'
       ORDER BY created_at`,
      [aid],
    );
    expect(alloc.rows[0]?.earn).toBe(e1);
    expect(alloc.rows[0]?.pts).toBe(5);
    void s2;
  });

  it("migration source: post-C3 redeem is strict; backfill emits shortfall NOTICE counters", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase", "migrations", "20260924120000_loyalty_points_expiry.sql"),
      "utf8",
    );
    expect(sql).toMatch(
      /loyalty_allocate_fifo\(\s*v_account\.id,\s*v_tx_id,\s*v_reward\.points_required,\s*'redeemed',\s*false,\s*true\s*\)/,
    );
    expect(sql).toContain("v_redeemed_pts");
    expect(sql).toContain("v_allocated_pts");
    expect(sql).toContain("v_shortfall_pts");
    expect(sql).toContain("C3 FIFO backfill:");
    expect(sql.toLowerCase()).toContain("raise notice");
    expect(sql).toContain("C3 FIFO backfill shortfalls:");
  });

  it("strict redeem succeeds when FIFO lots fully cover; allocations complete", async () => {
    await setPointsMode("never", null);
    const customerId = crypto.randomUUID();
    await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, 'StrictOk')`, [
      customerId,
      f.shopAId,
    ]);
    const enrolled = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_enroll_customer($1, $2, true, 'c3', '{}'::jsonb) AS result`,
            [f.shopAId, customerId],
          )
        ).rows[0],
      ),
    );
    const aid = String(enrolled.account_id);
    await asUser(exec, f.ownerAId, async () => {
      expect(
        rpcJson(
          (await exec.query(`SELECT public.loyalty_adjust_points($1, 40, 'strict ok') AS result`, [aid]))
            .rows[0],
        ).ok,
      ).toBe(true);
    });
    const rewardId = await insertReward(25);
    const key = `c3-strict-ok-${crypto.randomUUID()}`;
    const ok = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_redeem_reward($1, $2, $3, $4, NULL, NULL) AS result`,
            [f.shopAId, aid, rewardId, key],
          )
        ).rows[0],
      ),
    );
    expect(ok.ok).toBe(true);
    const sum = await exec.query<{ s: number }>(
      `SELECT coalesce(sum(points), 0)::int AS s FROM public.loyalty_point_lot_allocations
       WHERE consumer_transaction_id = $1`,
      [ok.transaction_id],
    );
    expect(sum.rows[0]?.s).toBe(25);
  });

  it("strict redeem fails on lot shortfall; no redemption, ledger, allocation, or balance change", async () => {
    await setPointsMode("never", null);
    const customerId = crypto.randomUUID();
    await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, 'StrictFail')`, [
      customerId,
      f.shopAId,
    ]);
    const enrolled = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_enroll_customer($1, $2, true, 'c3', '{}'::jsonb) AS result`,
            [f.shopAId, customerId],
          )
        ).rows[0],
      ),
    );
    const aid = String(enrolled.account_id);
    await asUser(exec, f.ownerAId, async () => {
      expect(
        rpcJson(
          (await exec.query(`SELECT public.loyalty_adjust_points($1, 10, 'lots only') AS result`, [aid]))
            .rows[0],
        ).ok,
      ).toBe(true);
    });
    // Inflate cached balance without credit lots (invalid post-C3 state).
    await exec.query(`UPDATE public.loyalty_accounts SET balance_points = 500 WHERE id = $1`, [aid]);
    const rewardId = await insertReward(100);
    const before = await exec.query<{ b: number; tx: number; rd: number; al: number }>(
      `SELECT a.balance_points AS b,
              (SELECT count(*)::int FROM public.loyalty_transactions t WHERE t.account_id = a.id) AS tx,
              (SELECT count(*)::int FROM public.loyalty_redemptions r WHERE r.account_id = a.id) AS rd,
              (SELECT count(*)::int FROM public.loyalty_point_lot_allocations l WHERE l.account_id = a.id) AS al
       FROM public.loyalty_accounts a WHERE a.id = $1`,
      [aid],
    );

    let threw = false;
    try {
      await asUser(exec, f.ownerAId, async () => {
        await exec.query(
          `SELECT public.loyalty_redeem_reward($1, $2, $3, $4, NULL, NULL) AS result`,
          [f.shopAId, aid, rewardId, `c3-strict-fail-${crypto.randomUUID()}`],
        );
      });
    } catch (e) {
      threw = true;
      expect(String(e)).toMatch(/loyalty_fifo_shortfall/);
    }
    expect(threw).toBe(true);

    const after = await exec.query<{ b: number; tx: number; rd: number; al: number }>(
      `SELECT a.balance_points AS b,
              (SELECT count(*)::int FROM public.loyalty_transactions t WHERE t.account_id = a.id) AS tx,
              (SELECT count(*)::int FROM public.loyalty_redemptions r WHERE r.account_id = a.id) AS rd,
              (SELECT count(*)::int FROM public.loyalty_point_lot_allocations l WHERE l.account_id = a.id) AS al
       FROM public.loyalty_accounts a WHERE a.id = $1`,
      [aid],
    );
    expect(after.rows[0]?.b).toBe(before.rows[0]?.b);
    expect(after.rows[0]?.tx).toBe(before.rows[0]?.tx);
    expect(after.rows[0]?.rd).toBe(before.rows[0]?.rd);
    expect(after.rows[0]?.al).toBe(before.rows[0]?.al);
  });

  it("allocate_fifo non-strict (backfill path) does not raise on shortfall", async () => {
    const customerId = crypto.randomUUID();
    await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, 'NonStrict')`, [
      customerId,
      f.shopAId,
    ]);
    const enrolled = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_enroll_customer($1, $2, true, 'c3', '{}'::jsonb) AS result`,
            [f.shopAId, customerId],
          )
        ).rows[0],
      ),
    );
    const aid = String(enrolled.account_id);
    await asUser(exec, f.ownerAId, async () => {
      expect(
        rpcJson(
          (await exec.query(`SELECT public.loyalty_adjust_points($1, 10, 'ns lots') AS result`, [aid]))
            .rows[0],
        ).ok,
      ).toBe(true);
    });
    await exec.query(`UPDATE public.loyalty_accounts SET balance_points = 100 WHERE id = $1`, [aid]);
    const tx = await exec.query<{ id: string }>(
      `INSERT INTO public.loyalty_transactions
         (shop_id, account_id, kind, points, cause, actor_source, note)
       VALUES ($1, $2, 'redeemed', -50, 'redemption', 'system', 'backfill-sim')
       RETURNING id`,
      [f.shopAId, aid],
    );
    const consumerId = tx.rows[0]?.id!;
    await exec.query(
      `SELECT public.loyalty_allocate_fifo($1, $2, 50, 'redeemed', false, false)`,
      [aid, consumerId],
    );
    const sum = await exec.query<{ s: number }>(
      `SELECT coalesce(sum(points), 0)::int AS s FROM public.loyalty_point_lot_allocations
       WHERE consumer_transaction_id = $1`,
      [consumerId],
    );
    expect(sum.rows[0]?.s).toBe(10);
  });

  it("duplicate idempotent redemption remains safe under strict FIFO", async () => {
    await setPointsMode("never", null);
    const customerId = crypto.randomUUID();
    await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, 'Idem')`, [
      customerId,
      f.shopAId,
    ]);
    const enrolled = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_enroll_customer($1, $2, true, 'c3', '{}'::jsonb) AS result`,
            [f.shopAId, customerId],
          )
        ).rows[0],
      ),
    );
    const aid = String(enrolled.account_id);
    await asUser(exec, f.ownerAId, async () => {
      expect(
        rpcJson(
          (await exec.query(`SELECT public.loyalty_adjust_points($1, 30, 'idem') AS result`, [aid])).rows[0],
        ).ok,
      ).toBe(true);
    });
    const rewardId = await insertReward(10);
    const key = `c3-idem-${crypto.randomUUID()}`;
    const first = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_redeem_reward($1, $2, $3, $4, NULL, NULL) AS result`,
            [f.shopAId, aid, rewardId, key],
          )
        ).rows[0],
      ),
    );
    expect(first.ok).toBe(true);
    expect(first.already_redeemed).toBe(false);
    const second = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_redeem_reward($1, $2, $3, $4, NULL, NULL) AS result`,
            [f.shopAId, aid, rewardId, key],
          )
        ).rows[0],
      ),
    );
    expect(second.ok).toBe(true);
    expect(second.already_redeemed).toBe(true);
    expect(second.redemption_id).toBe(first.redemption_id);
    const rd = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_redemptions WHERE account_id = $1 AND idempotency_key = $2`,
      [aid, key],
    );
    expect(rd.rows[0]?.n).toBe(1);
  });
});

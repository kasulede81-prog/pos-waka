/**
 * C2 reward expiry — SQL integration (local harness only).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  createLoyaltySqlHarness,
  enableProgram,
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
      `SELECT public.loyalty_enroll_customer($1, $2, true, 'c2', '{}'::jsonb) AS result`,
      [f.shopAId, f.customerAId],
    );
    return rpcJson(rows[0]);
  });
  accountId = String(enrolled.account_id);
  await exec.query(`UPDATE public.loyalty_accounts SET balance_points = 500 WHERE id = $1`, [
    accountId,
  ]);
}, 120_000);

afterAll(async () => {
  await exec.close();
});

async function insertReward(opts: {
  name: string;
  points: number;
  expiresOn?: string | null;
  active?: boolean;
  shopId?: string;
}) {
  const id = crypto.randomUUID();
  await asUser(exec, f.ownerAId, async () => {
    await exec.query(
      `INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, active, expires_on)
       VALUES ($1, $2, $3, $4, $5, $6::date)`,
      [
        id,
        opts.shopId ?? f.shopAId,
        opts.name,
        opts.points,
        opts.active ?? true,
        opts.expiresOn === undefined ? null : opts.expiresOn,
      ],
    );
  });
  return id;
}

async function redeem(rewardId: string, key: string) {
  return asUser(exec, f.ownerAId, async () =>
    rpcJson(
      (
        await exec.query(
          `SELECT public.loyalty_redeem_reward($1, $2, $3, $4, NULL, NULL) AS result`,
          [f.shopAId, accountId, rewardId, key],
        )
      ).rows[0],
    ),
  );
}

describe("C2 loyalty reward expiry", () => {
  it("defaults: existing/new rewards have expires_on NULL (never)", async () => {
    const id = await insertReward({ name: "Never Default", points: 10 });
    const { rows } = await exec.query<{ expires: string | null }>(
      `SELECT expires_on::text AS expires FROM public.loyalty_rewards WHERE id = $1`,
      [id],
    );
    expect(rows[0]?.expires).toBeNull();
    expect(
      (
        await exec.query<{ ok: boolean }>(
          `SELECT public.loyalty_reward_unexpired(NULL, now()) AS ok`,
        )
      ).rows[0]?.ok,
    ).toBe(true);
  });

  it("Kampala inclusive: redeemable on expiry day, expired after exclusive bound", async () => {
    const { rows } = await exec.query<{ on_day: boolean; after: boolean }>(
      `SELECT
         public.loyalty_reward_unexpired('2027-12-31', '2027-12-31 20:00:00+03'::timestamptz) AS on_day,
         public.loyalty_reward_unexpired('2027-12-31', '2028-01-01 00:00:00+03'::timestamptz) AS after`,
    );
    expect(rows[0]?.on_day).toBe(true);
    expect(rows[0]?.after).toBe(false);
  });

  it("redeem succeeds before/on expiry date; rejected after with reward_expired", async () => {
    const future = await insertReward({ name: "Future Soda", points: 50, expiresOn: "2035-06-15" });
    const ok = await redeem(future, `c2-ok-${crypto.randomUUID()}`);
    expect(ok.ok).toBe(true);
    expect(ok.already_redeemed).toBe(false);

    const expiredId = await insertReward({
      name: "Old Soda",
      points: 50,
      expiresOn: "2020-01-01",
    });
    const beforeBal = await exec.query<{ b: number; tx: number; rd: number }>(
      `SELECT a.balance_points AS b,
              (SELECT count(*)::int FROM public.loyalty_transactions t WHERE t.account_id = a.id) AS tx,
              (SELECT count(*)::int FROM public.loyalty_redemptions r WHERE r.account_id = a.id) AS rd
       FROM public.loyalty_accounts a WHERE a.id = $1`,
      [accountId],
    );
    const rejected = await redeem(expiredId, `c2-exp-${crypto.randomUUID()}`);
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toBe("reward_expired");
    const afterBal = await exec.query<{ b: number; tx: number; rd: number }>(
      `SELECT a.balance_points AS b,
              (SELECT count(*)::int FROM public.loyalty_transactions t WHERE t.account_id = a.id) AS tx,
              (SELECT count(*)::int FROM public.loyalty_redemptions r WHERE r.account_id = a.id) AS rd
       FROM public.loyalty_accounts a WHERE a.id = $1`,
      [accountId],
    );
    expect(afterBal.rows[0]?.b).toBe(beforeBal.rows[0]?.b);
    expect(afterBal.rows[0]?.tx).toBe(beforeBal.rows[0]?.tx);
    expect(afterBal.rows[0]?.rd).toBe(beforeBal.rows[0]?.rd);
  });

  it("preserves FOR UPDATE and reward_expired in redeem definition", async () => {
    const { rows } = await exec.query<{ def: string }>(
      `SELECT pg_get_functiondef('public.loyalty_redeem_reward(uuid,uuid,uuid,text,text,uuid)'::regprocedure) AS def`,
    );
    const def = rows[0]?.def ?? "";
    expect(def.toLowerCase()).toContain("for update");
    expect(def).toContain("membership_expired");
    expect(def).toContain("reward_expired");
    expect(def).toContain("loyalty_reward_unexpired");
  });

  it("C1 × C2: membership_expired and reward_expired combinations", async () => {
    const activeReward = await insertReward({
      name: "Active Combo",
      points: 10,
      expiresOn: "2035-01-01",
    });
    const expiredReward = await insertReward({
      name: "Expired Combo",
      points: 10,
      expiresOn: "2019-01-01",
    });

    // Active membership + active reward
    await exec.query(
      `UPDATE public.loyalty_accounts SET membership_expires_at = NULL, balance_points = 200 WHERE id = $1`,
      [accountId],
    );
    expect((await redeem(activeReward, `c2-aa-${crypto.randomUUID()}`)).ok).toBe(true);

    // Active membership + expired reward
    const ar = await redeem(expiredReward, `c2-ae-${crypto.randomUUID()}`);
    expect(ar.ok).toBe(false);
    expect(ar.error).toBe("reward_expired");

    // Expired membership + active reward
    await exec.query(
      `UPDATE public.loyalty_accounts SET membership_expires_at = now() - interval '1 day' WHERE id = $1`,
      [accountId],
    );
    const eaReward = await insertReward({
      name: "Still Active Reward",
      points: 10,
      expiresOn: "2035-12-01",
    });
    const ea = await redeem(eaReward, `c2-ea-${crypto.randomUUID()}`);
    expect(ea.ok).toBe(false);
    expect(ea.error).toBe("membership_expired");

    // Both expired
    const both = await redeem(expiredReward, `c2-ee-${crypto.randomUUID()}`);
    expect(both.ok).toBe(false);
    expect(both.error).toBe("membership_expired");

    await exec.query(`UPDATE public.loyalty_accounts SET membership_expires_at = NULL WHERE id = $1`, [
      accountId,
    ]);
  });

  it("authorized merchant can set/clear expiry; outsider and cross-shop blocked", async () => {
    const id = await insertReward({ name: "Auth Expiry", points: 5 });
    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`UPDATE public.loyalty_rewards SET expires_on = '2030-01-01' WHERE id = $1`, [
        id,
      ]);
    });
    const { rows: mid } = await exec.query<{ e: string | null }>(
      `SELECT expires_on::text AS e FROM public.loyalty_rewards WHERE id = $1`,
      [id],
    );
    expect(mid[0]?.e).toBe("2030-01-01");

    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`UPDATE public.loyalty_rewards SET expires_on = NULL WHERE id = $1`, [id]);
    });
    const { rows: cleared } = await exec.query<{ e: string | null }>(
      `SELECT expires_on::text AS e FROM public.loyalty_rewards WHERE id = $1`,
      [id],
    );
    expect(cleared[0]?.e).toBeNull();

    let outsiderWrote = false;
    try {
      await asUser(exec, f.outsiderId, async () => {
        const { rows } = await exec.query(
          `UPDATE public.loyalty_rewards SET expires_on = '2025-01-01' WHERE id = $1 RETURNING id`,
          [id],
        );
        outsiderWrote = rows.length > 0;
      });
    } catch {
      outsiderWrote = false;
    }
    expect(outsiderWrote).toBe(false);

    const cross = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_redeem_reward($1, $2, $3, $4, NULL, NULL) AS result`,
            [f.shopBId, accountId, id, `c2-cross-${crypto.randomUUID()}`],
          )
        ).rows[0],
      ),
    );
    expect(cross.ok).toBe(false);
  });
});

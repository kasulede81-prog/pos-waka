/**
 * Decision 026 — customer offer SQL integration (local harness).
 */
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
      `SELECT public.loyalty_enroll_customer($1, $2, true, 'offers', '{}'::jsonb) AS result`,
      [f.shopAId, f.customerAId],
    );
    return rpcJson(rows[0]);
  });
  accountId = String(enrolled.account_id);
}, 120_000);

afterAll(async () => {
  await exec.close();
});

async function createOffer(
  kind: string,
  title: string,
  config: Record<string, unknown>,
  priority = 0,
  userId = f.ownerAId,
) {
  return asUser(exec, userId, async () =>
    rpcJson(
      (
        await exec.query(
          `SELECT public.loyalty_create_customer_offer(
             $1, $2, $3, $4, $5::jsonb, $6, NULL, NULL, NULL
           ) AS result`,
          [f.shopAId, accountId, kind, title, JSON.stringify(config), priority],
        )
      ).rows[0],
    ),
  );
}

describe("Decision 026 customer offers", () => {
  it("owner can create; cashier cannot; outsider forbidden; cross-shop blocked", async () => {
    const ok = await createOffer("earn_multiplier", "2x", { multiplier: 2 });
    expect(ok.ok).toBe(true);

    const cashier = await createOffer("status_badge", "X", { label: "VIP" }, 0, f.cashierAId);
    expect(cashier.ok).toBe(false);
    expect(cashier.error).toBe("forbidden");

    const outsider = await asUser(exec, f.outsiderId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_create_customer_offer(
               $1, $2, 'status_badge', 'No', '{"label":"X"}'::jsonb, 0, NULL, NULL, NULL
             ) AS result`,
            [f.shopAId, accountId],
          )
        ).rows[0],
      ),
    );
    expect(outsider.ok).toBe(false);

    const cross = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_create_customer_offer(
               $1, $2, 'status_badge', 'No', '{"label":"X"}'::jsonb, 0, NULL, NULL, NULL
             ) AS result`,
            [f.shopBId, accountId],
          )
        ).rows[0],
      ),
    );
    expect(cross.ok).toBe(false);
    expect(cross.error).toBe("forbidden");
  });

  it("highest multiplier wins; never multiplies; flats stack", async () => {
    const customerId = crypto.randomUUID();
    await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, 'Stack')`, [
      customerId,
      f.shopAId,
    ]);
    const enrolled = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_enroll_customer($1, $2, true, 's', '{}'::jsonb) AS result`,
            [f.shopAId, customerId],
          )
        ).rows[0],
      ),
    );
    const aid = String(enrolled.account_id);
    await asUser(exec, f.ownerAId, async () => {
      expect(
        rpcJson(
          (
            await exec.query(
              `SELECT public.loyalty_create_customer_offer(
                 $1,$2,'earn_multiplier','2x','{"multiplier":2}'::jsonb,1,NULL,NULL,NULL
               ) AS result`,
              [f.shopAId, aid],
            )
          ).rows[0],
        ).ok,
      ).toBe(true);
      expect(
        rpcJson(
          (
            await exec.query(
              `SELECT public.loyalty_create_customer_offer(
                 $1,$2,'earn_multiplier','3x','{"multiplier":3}'::jsonb,0,NULL,NULL,NULL
               ) AS result`,
              [f.shopAId, aid],
            )
          ).rows[0],
        ).ok,
      ).toBe(true);
      expect(
        rpcJson(
          (
            await exec.query(
              `SELECT public.loyalty_create_customer_offer(
                 $1,$2,'earn_bonus_flat','b1','{"points":100}'::jsonb,0,NULL,NULL,NULL
               ) AS result`,
              [f.shopAId, aid],
            )
          ).rows[0],
        ).ok,
      ).toBe(true);
      expect(
        rpcJson(
          (
            await exec.query(
              `SELECT public.loyalty_create_customer_offer(
                 $1,$2,'earn_bonus_flat','b2','{"points":50}'::jsonb,0,NULL,NULL,NULL
               ) AS result`,
              [f.shopAId, aid],
            )
          ).rows[0],
        ).ok,
      ).toBe(true);
    });

    const saleId = await insertCompletedSale(exec, f, { totalUgx: 100_000, customerId });
    // base = 100, mult = 3, flat = 150 => 450
    const tx = await exec.query<{ pts: number; snap: Record<string, unknown> }>(
      `SELECT points AS pts, rule_snapshot AS snap FROM public.loyalty_transactions
       WHERE source_sale_id = $1 AND kind = 'earned'`,
      [saleId],
    );
    expect(tx.rows[0]?.pts).toBe(450);
    expect(Number(tx.rows[0]?.snap?.base_points)).toBe(100);
    expect(Number(tx.rows[0]?.snap?.effective_multiplier)).toBe(3);
    expect(Number(tx.rows[0]?.snap?.flat_bonus_points)).toBe(150);
    expect(Number(tx.rows[0]?.snap?.effective_points)).toBe(450);
  });

  it("paused/revoked/expired window offers do not apply; snapshot survives revoke", async () => {
    const customerId = crypto.randomUUID();
    await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, 'Life')`, [
      customerId,
      f.shopAId,
    ]);
    const enrolled = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_enroll_customer($1, $2, true, 'l', '{}'::jsonb) AS result`,
            [f.shopAId, customerId],
          )
        ).rows[0],
      ),
    );
    const aid = String(enrolled.account_id);
    const created = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_create_customer_offer(
               $1,$2,'earn_multiplier','2x','{"multiplier":2}'::jsonb,0,NULL,NULL,NULL
             ) AS result`,
            [f.shopAId, aid],
          )
        ).rows[0],
      ),
    );
    const offerId = String(created.offer_id);
    const sale1 = await insertCompletedSale(exec, f, { totalUgx: 10_000, customerId });
    const pts1 = await exec.query<{ pts: number }>(
      `SELECT points AS pts FROM public.loyalty_transactions WHERE source_sale_id = $1 AND kind='earned'`,
      [sale1],
    );
    expect(pts1.rows[0]?.pts).toBe(20); // base 10 * 2

    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_set_customer_offer_status($1,$2,'revoked')`, [
        f.shopAId,
        offerId,
      ]);
    });
    const sale2 = await insertCompletedSale(exec, f, { totalUgx: 10_000, customerId });
    const pts2 = await exec.query<{ pts: number; snap: Record<string, unknown> }>(
      `SELECT points AS pts, rule_snapshot AS snap FROM public.loyalty_transactions
       WHERE source_sale_id = $1 AND kind='earned'`,
      [sale2],
    );
    expect(pts2.rows[0]?.pts).toBe(10);
    // Historical sale1 snapshot still has multiplier
    const hist = await exec.query<{ snap: Record<string, unknown> }>(
      `SELECT rule_snapshot AS snap FROM public.loyalty_transactions WHERE source_sale_id = $1`,
      [sale1],
    );
    expect(Number(hist.rows[0]?.snap?.effective_multiplier)).toBe(2);
  });

  it("membership expired blocks award even with offers", async () => {
    await exec.query(
      `UPDATE public.loyalty_accounts SET membership_expires_at = now() - interval '1 day' WHERE id = $1`,
      [accountId],
    );
    await createOffer("earn_bonus_flat", "bonus", { points: 500 }, 99);
    const before = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_transactions WHERE account_id = $1 AND kind='earned'`,
      [accountId],
    );
    await insertCompletedSale(exec, f, { totalUgx: 50_000, customerId: f.customerAId });
    const after = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_transactions WHERE account_id = $1 AND kind='earned'`,
      [accountId],
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    await exec.query(`UPDATE public.loyalty_accounts SET membership_expires_at = NULL WHERE id = $1`, [
      accountId,
    ]);
  });

  it("reward_grant required for grant-only rewards; C2 expiry still enforced", async () => {
    const rewardId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.loyalty_rewards
         (id, shop_id, name, points_required, active, requires_offer_grant, expires_on)
       VALUES ($1, $2, 'Grant Only', 5, true, true, '2035-01-01')`,
      [rewardId, f.shopAId],
    );
    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_adjust_points($1, 50, 'fund')`, [accountId]);
    });
    const denied = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_redeem_reward($1,$2,$3,$4,NULL,NULL) AS result`,
            [f.shopAId, accountId, rewardId, `g-${crypto.randomUUID()}`],
          )
        ).rows[0],
      ),
    );
    expect(denied.ok).toBe(false);
    expect(denied.error).toBe("reward_grant_required");

    await createOffer("reward_grant", "grant", { reward_ids: [rewardId] });
    const ok = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_redeem_reward($1,$2,$3,$4,NULL,NULL) AS result`,
            [f.shopAId, accountId, rewardId, `g2-${crypto.randomUUID()}`],
          )
        ).rows[0],
      ),
    );
    expect(ok.ok).toBe(true);

    const expiredId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.loyalty_rewards
         (id, shop_id, name, points_required, active, requires_offer_grant, expires_on)
       VALUES ($1, $2, 'Expired Grant', 5, true, true, '2020-01-01')`,
      [expiredId, f.shopAId],
    );
    await createOffer("reward_grant", "grant2", { reward_ids: [expiredId] });
    const exp = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_redeem_reward($1,$2,$3,$4,NULL,NULL) AS result`,
            [f.shopAId, accountId, expiredId, `g3-${crypto.randomUUID()}`],
          )
        ).rows[0],
      ),
    );
    expect(exp.ok).toBe(false);
    expect(exp.error).toBe("reward_expired");
  });

  it("rejects invalid config and cross-shop reward ids", async () => {
    expect((await createOffer("earn_multiplier", "bad", { multiplier: 0 })).ok).toBe(false);
    expect((await createOffer("earn_multiplier", "bad", { multiplier: 99 })).ok).toBe(false);
    expect((await createOffer("earn_bonus_flat", "bad", { points: -1 })).ok).toBe(false);
    expect((await createOffer("status_badge", "bad", { label: "<script>" })).ok).toBe(false);
    const foreign = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, active)
       VALUES ($1, $2, 'B', 1, true)`,
      [foreign, f.shopBId],
    );
    const crossReward = await createOffer("reward_grant", "x", { reward_ids: [foreign] });
    expect(crossReward.ok).toBe(false);
    expect(crossReward.error).toBe("reward_not_in_shop");
  });
});

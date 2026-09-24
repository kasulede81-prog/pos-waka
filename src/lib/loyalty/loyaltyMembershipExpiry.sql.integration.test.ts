/**
 * C1 membership expiry — SQL integration (local harness only).
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

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId, { earnUnitUgx: 1000, earnPointsPerUnit: 1 });
}, 120_000);

afterAll(async () => {
  await exec.close();
});

async function enroll(userId: string, shopId: string, customerId: string) {
  return asUser(exec, userId, async () => {
    const { rows } = await exec.query(
      `SELECT public.loyalty_enroll_customer($1, $2, true, 'c1', '{}'::jsonb) AS result`,
      [shopId, customerId],
    );
    return rpcJson(rows[0]);
  });
}

async function setProgram(
  mode: "never" | "fixed_date" | "duration",
  fixedOn: string | null,
  months: number | null,
) {
  await asUser(exec, f.ownerAId, async () => {
    const r = rpcJson(
      (
        await exec.query(
          `SELECT public.loyalty_update_program($1, true, 1000, 1, 0, $2, $3::date, $4) AS result`,
          [f.shopAId, mode, fixedOn, months],
        )
      ).rows[0],
    );
    expect(r.ok).toBe(true);
  });
}

async function newCustomer(name: string) {
  const customerId = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, $3)`,
    [customerId, f.shopAId, name],
  );
  return customerId;
}

describe("C1 loyalty membership expiry", () => {
  it("helpers: Kampala inclusive end-of-day exclusive upper bound", async () => {
    const { rows } = await exec.query<{
      exp: string;
      on: string;
      active_on_day: boolean;
      active_after: boolean;
    }>(
      `WITH bound AS (
         SELECT public.loyalty_membership_expires_at_from_date('2027-12-31') AS exp
       )
       SELECT
         bound.exp::text AS exp,
         public.loyalty_membership_expires_on_date(bound.exp)::text AS on,
         public.loyalty_account_membership_active(
           'active', bound.exp, '2027-12-31 20:00:00+03'::timestamptz
         ) AS active_on_day,
         public.loyalty_account_membership_active(
           'active', bound.exp, '2028-01-01 00:00:00+03'::timestamptz
         ) AS active_after
       FROM bound`,
    );
    expect(rows[0]?.on).toBe("2027-12-31");
    expect(rows[0]?.active_on_day).toBe(true);
    expect(rows[0]?.active_after).toBe(false);
  });

  it("defaults: existing accounts stay never-expiring; program mode never", async () => {
    await setProgram("never", null, null);
    const enrolled = await enroll(f.ownerAId, f.shopAId, f.customerAId);
    expect(enrolled.ok).toBe(true);
    const { rows } = await exec.query<{ mode: string; expires: string | null }>(
      `SELECT p.membership_expiry_mode AS mode, a.membership_expires_at::text AS expires
       FROM public.loyalty_programs p
       JOIN public.loyalty_accounts a ON a.shop_id = p.shop_id
       WHERE p.shop_id = $1 AND a.id = $2`,
      [f.shopAId, enrolled.account_id],
    );
    expect(rows[0]?.mode).toBe("never");
    expect(rows[0]?.expires).toBeNull();
  });

  it("program rule change does not rewrite existing membership_expires_at", async () => {
    await setProgram("never", null, null);
    const customerId = await newCustomer("No Retro");
    const enrolled = await enroll(f.ownerAId, f.shopAId, customerId);
    expect(enrolled.membership_expires_at == null).toBe(true);
    await setProgram("fixed_date", "2030-06-15", null);
    const { rows } = await exec.query<{ expires: string | null }>(
      `SELECT membership_expires_at::text AS expires FROM public.loyalty_accounts WHERE id = $1`,
      [enrolled.account_id],
    );
    expect(rows[0]?.expires).toBeNull();
  });

  it("new enrollment stamps fixed_date from current program rule", async () => {
    await setProgram("fixed_date", "2030-06-15", null);
    const customerId = await newCustomer("Fixed Member");
    const enrolled = await enroll(f.ownerAId, f.shopAId, customerId);
    expect(enrolled.ok).toBe(true);
    const { rows } = await exec.query<{ on: string; active: boolean }>(
      `SELECT public.loyalty_membership_expires_on_date(membership_expires_at)::text AS on,
              public.loyalty_account_membership_active(status, membership_expires_at, now()) AS active
       FROM public.loyalty_accounts WHERE id = $1`,
      [enrolled.account_id],
    );
    expect(rows[0]?.on).toBe("2030-06-15");
    expect(rows[0]?.active).toBe(true);
  });

  it("new enrollment stamps duration from program rule", async () => {
    await setProgram("duration", null, 12);
    const customerId = await newCustomer("Duration Member");
    const enrolled = await enroll(f.ownerAId, f.shopAId, customerId);
    expect(enrolled.ok).toBe(true);
    const { rows } = await exec.query<{ expires: string | null; active: boolean }>(
      `SELECT membership_expires_at::text AS expires,
              public.loyalty_account_membership_active(status, membership_expires_at, now()) AS active
       FROM public.loyalty_accounts WHERE id = $1`,
      [enrolled.account_id],
    );
    expect(rows[0]?.expires).toBeTruthy();
    expect(rows[0]?.active).toBe(true);
  });

  it("award blocked when membership expired; sale still completes; balance unchanged", async () => {
    await setProgram("never", null, null);
    const customerId = await newCustomer("Expired Earner");
    const enrolled = await enroll(f.ownerAId, f.shopAId, customerId);
    await exec.query(
      `UPDATE public.loyalty_accounts
       SET membership_expires_at = now() - interval '1 hour', balance_points = 50
       WHERE id = $1`,
      [enrolled.account_id],
    );
    const beforeTx = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_transactions WHERE account_id = $1 AND kind = 'earned'`,
      [enrolled.account_id],
    );
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 5000, customerId });
    const sale = await exec.query<{ status: string; total: number }>(
      `SELECT status, total_ugx::int AS total FROM public.sales WHERE id = $1`,
      [saleId],
    );
    expect(sale.rows[0]?.status).toBe("completed");
    expect(sale.rows[0]?.total).toBe(5000);
    const award = await exec.query(
      `SELECT public.loyalty_award_for_sale($1) AS result`,
      [saleId],
    );
    const awardJson = rpcJson(award.rows[0]);
    expect(awardJson.ok).toBe(true);
    expect(awardJson.awarded).toBe(false);
    expect(awardJson.reason).toBe("membership_expired");
    const afterTx = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_transactions WHERE account_id = $1 AND kind = 'earned'`,
      [enrolled.account_id],
    );
    expect(afterTx.rows[0]?.n).toBe(beforeTx.rows[0]?.n);
    const bal = await exec.query<{ balance: number }>(
      `SELECT balance_points AS balance FROM public.loyalty_accounts WHERE id = $1`,
      [enrolled.account_id],
    );
    expect(bal.rows[0]?.balance).toBe(50);
  });

  it("redeem blocked when membership expired; FOR UPDATE + idempotency preserved in definition", async () => {
    const { rows: defRows } = await exec.query<{ def: string }>(
      `SELECT pg_get_functiondef('public.loyalty_redeem_reward(uuid,uuid,uuid,text,text,uuid)'::regprocedure) AS def`,
    );
    const def = defRows[0]?.def ?? "";
    expect(def.toLowerCase()).toContain("for update");
    expect(def).toContain("membership_expired");
    expect(def.toLowerCase()).toContain("idempotency_key");

    const customerId = await newCustomer("Expired Redeemer");
    const enrolled = await enroll(f.ownerAId, f.shopAId, customerId);
    await exec.query(
      `UPDATE public.loyalty_accounts
       SET membership_expires_at = now() - interval '1 day', balance_points = 200
       WHERE id = $1`,
      [enrolled.account_id],
    );
    const rewardId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, active)
       VALUES ($1, $2, 'Soap', 100, true)`,
      [rewardId, f.shopAId],
    );
    const key = `c1-redeem-${crypto.randomUUID()}`;
    const first = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_redeem_reward($1, $2, $3, $4, NULL, NULL) AS result`,
            [f.shopAId, enrolled.account_id, rewardId, key],
          )
        ).rows[0],
      ),
    );
    expect(first.ok).toBe(false);
    expect(first.error).toBe("membership_expired");
    const bal = await exec.query<{ balance: number }>(
      `SELECT balance_points AS balance FROM public.loyalty_accounts WHERE id = $1`,
      [enrolled.account_id],
    );
    expect(bal.rows[0]?.balance).toBe(200);
  });

  it("public card status helpers expose membership without private fields", async () => {
    await setProgram("never", null, null);
    const customerId = await newCustomer("Public Card Status");
    const enrolled = await enroll(f.ownerAId, f.shopAId, customerId);
    await exec.query(
      `UPDATE public.loyalty_accounts
       SET membership_expires_at = public.loyalty_membership_expires_at_from_date('2020-01-01')
       WHERE id = $1`,
      [enrolled.account_id],
    );
    const { rows } = await exec.query<{
      active: boolean;
      on: string | null;
      token: string;
    }>(
      `SELECT
         public.loyalty_account_membership_active(status, membership_expires_at, now()) AS active,
         public.loyalty_membership_expires_on_date(membership_expires_at)::text AS on,
         public_card_token AS token
       FROM public.loyalty_accounts WHERE id = $1`,
      [enrolled.account_id],
    );
    expect(rows[0]?.active).toBe(false);
    expect(rows[0]?.on).toBe("2020-01-01");
    expect(rows[0]?.token).toBeTruthy();
  });

  it("renewal reactivates without changing balance, token, or ledger", async () => {
    const customerId = await newCustomer("Renew Me");
    const enrolled = await enroll(f.ownerAId, f.shopAId, customerId);
    await exec.query(
      `UPDATE public.loyalty_accounts
       SET membership_expires_at = now() - interval '2 days', balance_points = 77
       WHERE id = $1`,
      [enrolled.account_id],
    );
    const before = await exec.query<{ token: string; balance: number; tx: number }>(
      `SELECT a.public_card_token AS token, a.balance_points AS balance,
              (SELECT count(*)::int FROM public.loyalty_transactions t WHERE t.account_id = a.id) AS tx
       FROM public.loyalty_accounts a WHERE a.id = $1`,
      [enrolled.account_id],
    );
    const renew = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_renew_membership($1, $2, 'fixed_date', '2031-01-15', NULL) AS result`,
            [f.shopAId, enrolled.account_id],
          )
        ).rows[0],
      ),
    );
    expect(renew.ok).toBe(true);
    expect(renew.membership_active).toBe(true);
    expect(renew.balance_points).toBe(77);
    const after = await exec.query<{
      token: string;
      balance: number;
      active: boolean;
      tx: number;
    }>(
      `SELECT a.public_card_token AS token, a.balance_points AS balance,
              public.loyalty_account_membership_active(a.status, a.membership_expires_at, now()) AS active,
              (SELECT count(*)::int FROM public.loyalty_transactions t WHERE t.account_id = a.id) AS tx
       FROM public.loyalty_accounts a WHERE a.id = $1`,
      [enrolled.account_id],
    );
    expect(after.rows[0]?.token).toBe(before.rows[0]?.token);
    expect(after.rows[0]?.balance).toBe(77);
    expect(after.rows[0]?.active).toBe(true);
    expect(after.rows[0]?.tx).toBe(before.rows[0]?.tx);
  });

  it("unauthorized / cross-shop renewal forbidden", async () => {
    const customerId = await newCustomer("Auth Boundary");
    const enrolled = await enroll(f.ownerAId, f.shopAId, customerId);
    const forbidden = await asUser(exec, f.outsiderId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_renew_membership($1, $2, 'never', NULL, NULL) AS result`,
            [f.shopAId, enrolled.account_id],
          )
        ).rows[0],
      ),
    );
    expect(forbidden.ok).toBe(false);
    expect(forbidden.error).toBe("forbidden");

    const cross = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(
            `SELECT public.loyalty_renew_membership($1, $2, 'never', NULL, NULL) AS result`,
            [f.shopBId, enrolled.account_id],
          )
        ).rows[0],
      ),
    );
    expect(cross.ok).toBe(false);
  });
});

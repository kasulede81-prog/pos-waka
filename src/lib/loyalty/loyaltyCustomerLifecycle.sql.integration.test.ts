/**
 * Decision 027 — customer membership lifecycle + individual expiry (SQL harness).
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
let accountId = "";
let rewardId = "";

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId, { earnUnitUgx: 1000, earnPointsPerUnit: 1 });

  const enrolled = await asUser(exec, f.ownerAId, async () =>
    rpcJson(
      (
        await exec.query<Record<string, unknown>>(
          `SELECT public.loyalty_enroll_customer($1,$2,true,'ok') AS result`,
          [f.shopAId, f.customerAId],
        )
      ).rows[0],
    ),
  );
  accountId = String(enrolled.account_id);

  const reward = await exec.query<{ id: string }>(
    `INSERT INTO public.loyalty_rewards (shop_id, name, points_required, active)
     VALUES ($1, 'Tea', 5, true) RETURNING id`,
    [f.shopAId],
  );
  rewardId = reward.rows[0]!.id;

  // Seed points via completed sale
  const saleId = await insertCompletedSale(exec, f, {
    totalUgx: 10_000,
    customerId: f.customerAId,
  });
  await exec.query(`SELECT public.loyalty_award_for_sale($1)`, [saleId]);
}, 120_000);

afterAll(async () => {
  await exec.close();
});

async function lifecycle(action: string, userId = f.ownerAId, shopId = f.shopAId, acct = accountId) {
  return asUser(exec, userId, async () =>
    rpcJson(
      (
        await exec.query<Record<string, unknown>>(
          `SELECT public.loyalty_set_account_lifecycle($1,$2,$3) AS result`,
          [shopId, acct, action],
        )
      ).rows[0],
    ),
  );
}

async function renew(mode: string | null, fixed: string | null = null) {
  return asUser(exec, f.ownerAId, async () =>
    rpcJson(
      (
        await exec.query<Record<string, unknown>>(
          `SELECT public.loyalty_renew_membership($1,$2,$3,$4::date,null) AS result`,
          [f.shopAId, accountId, mode, fixed],
        )
      ).rows[0],
    ),
  );
}

async function balance(): Promise<number> {
  const r = await exec.query<{ b: number }>(
    `SELECT balance_points::int AS b FROM public.loyalty_accounts WHERE id = $1`,
    [accountId],
  );
  return r.rows[0]!.b;
}

async function redeemOnce(key: string) {
  return asUser(exec, f.ownerAId, async () =>
    rpcJson(
      (
        await exec.query<Record<string, unknown>>(
          `SELECT public.loyalty_redeem_reward($1,$2,$3,$4,null,null) AS result`,
          [f.shopAId, accountId, rewardId, key],
        )
      ).rows[0],
    ),
  );
}

describe("Decision 027 individual membership expiry", () => {
  it("sets never / future / past expiry without changing balance", async () => {
    const before = await balance();
    expect((await renew("never")).ok).toBe(true);
    expect((await renew("never")).membership_expires_on == null).toBe(true);

    const future = await renew("fixed_date", "2030-12-31");
    expect(future.ok).toBe(true);
    expect(future.membership_expires_on).toBe("2030-12-31");
    expect(future.membership_active).toBe(true);

    const past = await renew("fixed_date", "2020-01-01");
    expect(past.ok).toBe(true);
    expect(past.membership_expires_on).toBe("2020-01-01");
    expect(past.membership_active).toBe(false);

    expect(await balance()).toBe(before);

    // clear back to never for later tests
    expect((await renew("never")).ok).toBe(true);
  });
});

describe("Decision 027 lifecycle suspend / reactivate / revoke", () => {
  it("suspends and reactivates without mutating balance or ledger kinds", async () => {
    const before = await balance();
    const txBefore = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_transactions WHERE account_id = $1`,
      [accountId],
    );

    expect((await lifecycle("suspend")).status).toBe("suspended");
    expect(await balance()).toBe(before);

    const sale = await insertCompletedSale(exec, f, {
      totalUgx: 5000,
      customerId: f.customerAId,
    });
    const award = rpcJson(
      (await exec.query<Record<string, unknown>>(`SELECT public.loyalty_award_for_sale($1) AS result`, [sale]))
        .rows[0],
    );
    expect(award.awarded).toBe(false);
    expect(award.reason).toBe("account_suspended");
    expect((await exec.query<{ status: string }>(`SELECT status FROM public.sales WHERE id = $1`, [sale])).rows[0]?.status).toBe(
      "completed",
    );

    const red = await redeemOnce(`suspend-${crypto.randomUUID()}`);
    expect(red.ok).toBe(false);
    expect(red.error).toBe("account_suspended");

    expect((await lifecycle("reactivate")).status).toBe("active");
    expect(await balance()).toBe(before);

    const txAfter = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_transactions WHERE account_id = $1`,
      [accountId],
    );
    expect(txAfter.rows[0]!.n).toBe(txBefore.rows[0]!.n);
  });

  it("authorization: cashier/outsider forbidden; cross-shop fails", async () => {
    expect((await lifecycle("suspend", f.cashierAId)).error).toBe("forbidden");
    expect((await lifecycle("suspend", f.outsiderId)).error).toBe("forbidden");
    // Owner of A is not a member of B → manage_shop fails closed.
    expect((await lifecycle("suspend", f.ownerAId, f.shopBId)).error).toBe("forbidden");
  });

  it("revokes with 30-day purge_after; cannot reactivate or renew", async () => {
    const before = await balance();
    const rev = await lifecycle("revoke");
    expect(rev.ok).toBe(true);
    expect(rev.status).toBe("revoked");
    expect(rev.revoked_at).toBeTruthy();
    expect(rev.purge_after).toBeTruthy();

    const gap = await exec.query<{ days: number }>(
      `SELECT extract(epoch from (purge_after - revoked_at))/86400.0 AS days
       FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    );
    expect(Number(gap.rows[0]!.days)).toBeCloseTo(30, 5);
    expect(await balance()).toBe(before);

    expect((await lifecycle("reactivate")).error).toBe("account_revoked");
    expect((await renew("never")).error).toBe("account_revoked");

    const sale = await insertCompletedSale(exec, f, {
      totalUgx: 5000,
      customerId: f.customerAId,
    });
    const award = rpcJson(
      (await exec.query<Record<string, unknown>>(`SELECT public.loyalty_award_for_sale($1) AS result`, [sale]))
        .rows[0],
    );
    expect(award.reason).toBe("account_revoked");

    const red = await redeemOnce(`revoked-${crypto.randomUUID()}`);
    expect(red.error).toBe("account_revoked");

    const enroll = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_enroll_customer($1,$2,true,'x') AS result`,
            [f.shopAId, f.customerAId],
          )
        ).rows[0],
      ),
    );
    expect(enroll.error).toBe("account_revoked");
  });
});

describe("Decision 027 offers + purge", () => {
  it("offers do not apply while suspended/revoked; purge deletes loyalty data only", async () => {
    const customerCId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.customers (id, shop_id, name, phone_e164)
       VALUES ($1, $2, 'Customer C', '+256700000099')`,
      [customerCId, f.shopAId],
    );

    const en = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_enroll_customer($1,$2,true,'ok') AS result`,
            [f.shopAId, customerCId],
          )
        ).rows[0],
      ),
    );
    expect(en.ok).toBe(true);
    const acctB = String(en.account_id);
    expect(acctB).toMatch(/^[0-9a-f-]{36}$/i);

    const created = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_create_customer_offer(
               $1,$2,'earn_multiplier','2x','{"multiplier":2}'::jsonb,10,null,null,null
             ) AS result`,
            [f.shopAId, acctB],
          )
        ).rows[0],
      ),
    );
    expect(created.ok).toBe(true);

    let resolved = (
      await exec.query<{ r: Record<string, unknown> }>(
        `SELECT public.loyalty_resolve_customer_offers($1) AS r`,
        [acctB],
      )
    ).rows[0]!.r;
    expect(Number(resolved.effective_multiplier)).toBe(2);

    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_set_account_lifecycle($1,$2,'suspend')`, [
        f.shopAId,
        acctB,
      ]);
    });
    resolved = (
      await exec.query<{ r: Record<string, unknown> }>(
        `SELECT public.loyalty_resolve_customer_offers($1) AS r`,
        [acctB],
      )
    ).rows[0]!.r;
    expect(Number(resolved.effective_multiplier)).toBe(1);
    expect(resolved.applicable_offers).toEqual([]);

    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_set_account_lifecycle($1,$2,'reactivate')`, [
        f.shopAId,
        acctB,
      ]);
      await exec.query(`SELECT public.loyalty_set_account_lifecycle($1,$2,'revoke')`, [
        f.shopAId,
        acctB,
      ]);
    });
    resolved = (
      await exec.query<{ r: Record<string, unknown> }>(
        `SELECT public.loyalty_resolve_customer_offers($1) AS r`,
        [acctB],
      )
    ).rows[0]!.r;
    expect(Number(resolved.effective_multiplier)).toBe(1);

    const offersBefore = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_customer_offers WHERE account_id = $1`,
      [acctB],
    );
    expect(offersBefore.rows[0]!.n).toBeGreaterThan(0);

    // Not due yet
    let purge = (
      await exec.query<{ r: Record<string, unknown> }>(
        `SELECT public.loyalty_purge_revoked_accounts(50) AS r`,
      )
    ).rows[0]!.r;
    expect(Number(purge.deleted)).toBe(0);
    expect(
      (await exec.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.loyalty_accounts WHERE id = $1`, [acctB]))
        .rows[0]!.n,
    ).toBe(1);

    await exec.query(
      `UPDATE public.loyalty_accounts
       SET purge_after = now() - interval '1 minute'
       WHERE id = $1 AND status = 'revoked'`,
      [acctB],
    );

    const salesBefore = (
      await exec.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.sales WHERE customer_id = $1`,
        [customerCId],
      )
    ).rows[0]!.n;
    const customerBefore = (
      await exec.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.customers WHERE id = $1`,
        [customerCId],
      )
    ).rows[0]!.n;

    purge = (
      await exec.query<{ r: Record<string, unknown> }>(
        `SELECT public.loyalty_purge_revoked_accounts(50) AS r`,
      )
    ).rows[0]!.r;
    expect(Number(purge.deleted)).toBeGreaterThanOrEqual(1);

    expect(
      (await exec.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.loyalty_accounts WHERE id = $1`, [acctB]))
        .rows[0]!.n,
    ).toBe(0);
    expect(
      (
        await exec.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public.loyalty_customer_offers WHERE account_id = $1`,
          [acctB],
        )
      ).rows[0]!.n,
    ).toBe(0);
    expect(
      (
        await exec.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public.sales WHERE customer_id = $1`,
          [customerCId],
        )
      ).rows[0]!.n,
    ).toBe(salesBefore);
    expect(
      (
        await exec.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public.customers WHERE id = $1`,
          [customerCId],
        )
      ).rows[0]!.n,
    ).toBe(customerBefore);

    // Idempotent re-run
    purge = (
      await exec.query<{ r: Record<string, unknown> }>(
        `SELECT public.loyalty_purge_revoked_accounts(50) AS r`,
      )
    ).rows[0]!.r;
    expect(Number(purge.deleted)).toBe(0);
  });
});

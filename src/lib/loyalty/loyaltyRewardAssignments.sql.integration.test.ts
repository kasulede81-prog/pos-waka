/**
 * Decision 029 — customer-specific reward assignments SQL integration.
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
let accountAId = "";
let accountBId = "";
let sugarId = "";
let riceId = "";
let grantOnlyId = "";

async function enroll(customerId: string): Promise<string> {
  const r = await asUser(exec, f.ownerAId, async () =>
    rpcJson(
      (
        await exec.query<Record<string, unknown>>(
          `SELECT public.loyalty_enroll_customer($1,$2,true,'d029','{}'::jsonb) AS result`,
          [f.shopAId, customerId],
        )
      ).rows[0],
    ),
  );
  expect(r.ok).toBe(true);
  return String(r.account_id);
}

async function adjust(accountId: string, points: number) {
  await asUser(exec, f.ownerAId, async () => {
    await exec.query(`SELECT public.loyalty_adjust_points($1,$2,'d029')`, [accountId, points]);
  });
}

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId, { earnUnitUgx: 1000, earnPointsPerUnit: 1 });

  accountAId = await enroll(f.customerAId);
  // Second customer in shop A
  const custB = crypto.randomUUID();
  await exec.exec(
    `INSERT INTO public.customers (id, shop_id, name, phone_e164)
     VALUES ('${custB}', '${f.shopAId}', 'Customer B2', '+256700000011')`,
  );
  accountBId = await enroll(custB);

  sugarId = crypto.randomUUID();
  riceId = crypto.randomUUID();
  grantOnlyId = crypto.randomUUID();
  await exec.exec(`
    INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, active, requires_offer_grant)
    VALUES
      ('${sugarId}', '${f.shopAId}', '1kg Sugar', 100, true, false),
      ('${riceId}', '${f.shopAId}', '1kg Rice', 100, true, false),
      ('${grantOnlyId}', '${f.shopAId}', 'VIP Gift', 50, true, true);
  `);
  await adjust(accountAId, 200);
  await adjust(accountBId, 200);
}, 120_000);

afterAll(async () => {
  await exec?.close();
});

describe("Decision 029 reward assignments", () => {
  it("merchant can assign; cashier forbidden; cross-shop blocked", async () => {
    const ok = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_assign_reward($1,$2,$3,null,null) AS result`,
            [f.shopAId, accountAId, sugarId],
          )
        ).rows[0],
      ),
    );
    expect(ok.ok).toBe(true);

    const denied = await asUser(exec, f.cashierAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_assign_reward($1,$2,$3,null,null) AS result`,
            [f.shopAId, accountAId, riceId],
          )
        ).rows[0],
      ),
    );
    expect(denied.error).toBe("forbidden");

    const foreignReward = crypto.randomUUID();
    await exec.exec(
      `INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, active)
       VALUES ('${foreignReward}', '${f.shopBId}', 'Foreign', 10, true)`,
    );
    const cross = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_assign_reward($1,$2,$3,null,null) AS result`,
            [f.shopAId, accountAId, foreignReward],
          )
        ).rows[0],
      ),
    );
    expect(cross.error).toBe("reward_not_found");
  });

  it("duplicate assign returns already_assigned without second active row", async () => {
    const again = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_assign_reward($1,$2,$3,null,null) AS result`,
            [f.shopAId, accountAId, sugarId],
          )
        ).rows[0],
      ),
    );
    expect(again.ok).toBe(true);
    expect(again.already_assigned).toBe(true);
    const n = (
      await exec.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.loyalty_reward_assignments
         WHERE account_id = $1 AND reward_id = $2 AND status = 'active'`,
        [accountAId, sugarId],
      )
    ).rows[0]!.n;
    expect(n).toBe(1);
  });

  it("customer B does not see A assignment; revoke works", async () => {
    const listB = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_list_reward_assignments($1,$2) AS result`,
            [f.shopAId, accountBId],
          )
        ).rows[0],
      ),
    );
    const rowsB = Array.isArray(listB.assignments) ? listB.assignments : [];
    expect(rowsB.every((r) => String((r as { reward_id: string }).reward_id) !== sugarId)).toBe(
      true,
    );

    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_assign_reward($1,$2,$3,null,null)`, [
        f.shopAId,
        accountBId,
        riceId,
      ]);
    });
    const listA = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_list_reward_assignments($1,$2) AS result`,
            [f.shopAId, accountAId],
          )
        ).rows[0],
      ),
    );
    const rowsA = Array.isArray(listA.assignments) ? listA.assignments : [];
    expect(rowsA.some((r) => String((r as { reward_id: string }).reward_id) === sugarId)).toBe(
      true,
    );
    expect(rowsA.every((r) => String((r as { reward_id: string }).reward_id) !== riceId)).toBe(
      true,
    );

    const assignId = String((rowsA[0] as { id: string }).id);
    const revoked = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_revoke_reward_assignment($1,$2) AS result`,
            [f.shopAId, assignId],
          )
        ).rows[0],
      ),
    );
    expect(revoked.ok).toBe(true);
  });

  it("grant-only reward redeemable via assignment; not without", async () => {
    const denied = await asUser(exec, f.cashierAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_redeem_reward($1,$2,$3,$4,null,null) AS result`,
            [f.shopAId, accountAId, grantOnlyId, `d029-deny-${crypto.randomUUID()}`],
          )
        ).rows[0],
      ),
    );
    expect(denied.error).toBe("reward_grant_required");

    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_assign_reward($1,$2,$3,null,null)`, [
        f.shopAId,
        accountAId,
        grantOnlyId,
      ]);
    });
    const ok = await asUser(exec, f.cashierAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_redeem_reward($1,$2,$3,$4,null,null) AS result`,
            [f.shopAId, accountAId, grantOnlyId, `d029-ok-${crypto.randomUUID()}`],
          )
        ).rows[0],
      ),
    );
    expect(ok.ok).toBe(true);
  });

  it("assignment expiry blocks grant-only redeem with assignment_expired", async () => {
    const rId = crypto.randomUUID();
    await exec.exec(
      `INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, active, requires_offer_grant)
       VALUES ('${rId}', '${f.shopAId}', 'Timed Gift', 10, true, true)`,
    );
    await asUser(exec, f.ownerAId, async () => {
      await exec.query(
        `SELECT public.loyalty_assign_reward($1,$2,$3,now() - interval '1 hour',null)`,
        [f.shopAId, accountBId, rId],
      );
    });
    const expired = await asUser(exec, f.cashierAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_redeem_reward($1,$2,$3,$4,null,null) AS result`,
            [f.shopAId, accountBId, rId, `d029-exp-${crypto.randomUUID()}`],
          )
        ).rows[0],
      ),
    );
    expect(expired.error).toBe("assignment_expired");
  });

  it("shop-wide rewards still redeem without assignment", async () => {
    const r = await asUser(exec, f.cashierAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_redeem_reward($1,$2,$3,$4,null,null) AS result`,
            [f.shopAId, accountBId, sugarId, `d029-global-${crypto.randomUUID()}`],
          )
        ).rows[0],
      ),
    );
    expect(r.ok).toBe(true);
  });

  it("suspended/revoked cannot redeem; purge removes assignments", async () => {
    const rId = crypto.randomUUID();
    await exec.exec(
      `INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, active, requires_offer_grant)
       VALUES ('${rId}', '${f.shopAId}', 'Life Gift', 10, true, true)`,
    );
    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_assign_reward($1,$2,$3,null,null)`, [
        f.shopAId,
        accountBId,
        rId,
      ]);
      await exec.query(`SELECT public.loyalty_set_account_lifecycle($1,$2,'suspend')`, [
        f.shopAId,
        accountBId,
      ]);
    });
    const sus = await asUser(exec, f.cashierAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_redeem_reward($1,$2,$3,$4,null,null) AS result`,
            [f.shopAId, accountBId, rId, `d029-sus-${crypto.randomUUID()}`],
          )
        ).rows[0],
      ),
    );
    expect(sus.error).toBe("account_suspended");

    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_set_account_lifecycle($1,$2,'reactivate')`, [
        f.shopAId,
        accountBId,
      ]);
      await exec.query(`SELECT public.loyalty_set_account_lifecycle($1,$2,'revoke')`, [
        f.shopAId,
        accountBId,
      ]);
    });
    const rev = await asUser(exec, f.cashierAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_redeem_reward($1,$2,$3,$4,null,null) AS result`,
            [f.shopAId, accountBId, rId, `d029-rev-${crypto.randomUUID()}`],
          )
        ).rows[0],
      ),
    );
    expect(rev.error).toBe("account_revoked");

    await exec.query(
      `UPDATE public.loyalty_accounts SET purge_after = now() - interval '1 minute' WHERE id = $1`,
      [accountBId],
    );
    const before = (
      await exec.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.loyalty_reward_assignments WHERE account_id = $1`,
        [accountBId],
      )
    ).rows[0]!.n;
    expect(before).toBeGreaterThan(0);
    await exec.query(`SELECT public.loyalty_purge_revoked_accounts(50)`);
    const after = (
      await exec.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.loyalty_reward_assignments WHERE account_id = $1`,
        [accountBId],
      )
    ).rows[0]!.n;
    expect(after).toBe(0);
  });
});

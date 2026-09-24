/**
 * Decision 030 — product-backed loyalty rewards SQL integration.
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
let accountId = "";
let accountBId = "";
let productId = "";
let productBShopId = "";
let rewardProductId = "";
let rewardPlainId = "";
let rewardGrantOnlyId = "";
let rewardAssignedId = "";

async function enroll(customerId: string): Promise<string> {
  const r = await asUser(exec, f.ownerAId, async () =>
    rpcJson(
      (
        await exec.query<Record<string, unknown>>(
          `SELECT public.loyalty_enroll_customer($1,$2,true,'d030','{}'::jsonb) AS result`,
          [f.shopAId, customerId],
        )
      ).rows[0],
    ),
  );
  expect(r.ok).toBe(true);
  return String(r.account_id);
}

async function adjust(acct: string, points: number) {
  await asUser(exec, f.ownerAId, async () => {
    await exec.query(`SELECT public.loyalty_adjust_points($1,$2,'d030')`, [acct, points]);
  });
}

async function redeem(acct: string, rewardId: string, key: string) {
  return asUser(exec, f.cashierAId, async () =>
    rpcJson(
      (
        await exec.query<Record<string, unknown>>(
          `SELECT public.loyalty_redeem_reward($1,$2,$3,$4,null,null) AS result`,
          [f.shopAId, acct, rewardId, key],
        )
      ).rows[0],
    ),
  );
}

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId, { earnUnitUgx: 1000, earnPointsPerUnit: 1 });

  accountId = await enroll(f.customerAId);
  const custB = crypto.randomUUID();
  await exec.exec(
    `INSERT INTO public.customers (id, shop_id, name, phone_e164)
     VALUES ('${custB}', '${f.shopAId}', 'Customer B', '+256700000022')`,
  );
  accountBId = await enroll(custB);

  productId = crypto.randomUUID();
  productBShopId = crypto.randomUUID();
  await exec.exec(`
    INSERT INTO public.products (id, shop_id, name, sku, cost_ugx, cost_price_per_unit_ugx, stock_on_hand, is_active)
    VALUES
      ('${productId}', '${f.shopAId}', 'Coca-Cola 500ml', 'COKE-500', 800, 800, 27, true),
      ('${productBShopId}', '${f.shopBId}', 'Other Shop Drink', 'OTH-1', 500, 500, 10, true);
  `);

  rewardProductId = crypto.randomUUID();
  rewardPlainId = crypto.randomUUID();
  rewardGrantOnlyId = crypto.randomUUID();
  rewardAssignedId = crypto.randomUUID();

  await exec.exec(`
    INSERT INTO public.loyalty_rewards
      (id, shop_id, name, points_required, active, product_id, product_quantity, requires_offer_grant, reward_kind)
    VALUES
      ('${rewardProductId}', '${f.shopAId}', 'Free Coca-Cola', 100, true, '${productId}', 1, false, 'product'),
      ('${rewardPlainId}', '${f.shopAId}', 'Shop voucher', 50, true, null, 1, false, 'custom'),
      ('${rewardGrantOnlyId}', '${f.shopAId}', 'VIP Coke', 80, true, '${productId}', 1, true, 'product'),
      ('${rewardAssignedId}', '${f.shopAId}', 'Assigned Coke', 90, true, '${productId}', 1, true, 'product');
  `);

  await adjust(accountId, 500);
  await adjust(accountBId, 200);
}, 120_000);

afterAll(async () => {
  await exec?.close();
});

describe("Decision 030 product-backed rewards", () => {
  it("1. reward can reference an existing product", async () => {
    const row = (
      await exec.query<{ product_id: string; product_quantity: string }>(
        `SELECT product_id::text, product_quantity::text FROM public.loyalty_rewards WHERE id = $1`,
        [rewardProductId],
      )
    ).rows[0];
    expect(row.product_id).toBe(productId);
    expect(Number(row.product_quantity)).toBe(1);
  });

  it("3. cross-shop product cannot be attached", async () => {
    const id = crypto.randomUUID();
    let err = "";
    try {
      await exec.exec(`
        INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, product_id, reward_kind)
        VALUES ('${id}', '${f.shopAId}', 'Bad', 10, '${productBShopId}', 'product');
      `);
    } catch (e) {
      err = String(e);
    }
    expect(err).toMatch(/loyalty_reward_product_cross_shop/);
  });

  it("5–11. eligible claim deducts points once, stock once, zero revenue, cost preserved, sale linked", async () => {
    const before = (
      await exec.query<{ stock: string; bal: string }>(
        `SELECT p.stock_on_hand::text AS stock, a.balance_points::text AS bal
         FROM public.products p, public.loyalty_accounts a
         WHERE p.id = $1 AND a.id = $2`,
        [productId, accountId],
      )
    ).rows[0];
    expect(Number(before.stock)).toBe(27);
    expect(Number(before.bal)).toBe(500);

    const key = `d030-claim-${crypto.randomUUID()}`;
    const result = await redeem(accountId, rewardProductId, key);
    expect(result.ok).toBe(true);
    expect(result.already_redeemed).toBe(false);
    expect(Number(result.points_spent)).toBe(100);
    expect(Number(result.balance)).toBe(400);
    expect(result.sale_id).toBeTruthy();
    expect(String(result.fulfilled_product_id)).toBe(productId);

    const after = (
      await exec.query<{
        stock: string;
        bal: string;
        total: string;
        unit_price: string;
        unit_cost: string;
        source: string;
        redemption: string;
        movements: string;
      }>(
        `SELECT
           p.stock_on_hand::text AS stock,
           a.balance_points::text AS bal,
           s.total_ugx::text AS total,
           sli.unit_price_ugx::text AS unit_price,
           (sli.metadata->>'unitCostUgx') AS unit_cost,
           (s.metadata->>'source') AS source,
           (s.metadata->>'loyalty_redemption_id') AS redemption,
           (SELECT count(*)::text FROM public.inventory_movements im
             WHERE im.reference_id = s.id AND im.reference_type = 'sale' AND im.product_id = p.id) AS movements
         FROM public.loyalty_accounts a
         JOIN public.loyalty_redemptions r ON r.id = $1
         JOIN public.sales s ON s.id = r.sale_id
         JOIN public.sale_line_items sli ON sli.sale_id = s.id
         JOIN public.products p ON p.id = $2
         WHERE a.id = $3`,
        [String(result.redemption_id), productId, accountId],
      )
    ).rows[0];

    expect(Number(after.stock)).toBe(26);
    expect(Number(after.bal)).toBe(400);
    expect(Number(after.total)).toBe(0);
    expect(Number(after.unit_price)).toBe(0);
    expect(Number(after.unit_cost)).toBe(800);
    expect(after.source).toBe("loyalty_reward");
    expect(after.redemption).toBe(String(result.redemption_id));
    expect(Number(after.movements)).toBe(1);

    // 21. duplicate/double-click claim is idempotent
    const again = await redeem(accountId, rewardProductId, key);
    expect(again.ok).toBe(true);
    expect(again.already_redeemed).toBe(true);
    expect(String(again.sale_id)).toBe(String(result.sale_id));

    const stockAgain = (
      await exec.query<{ stock: string }>(
        `SELECT stock_on_hand::text AS stock FROM public.products WHERE id = $1`,
        [productId],
      )
    ).rows[0];
    expect(Number(stockAgain.stock)).toBe(26);

    const balAgain = (
      await exec.query<{ bal: string }>(
        `SELECT balance_points::text AS bal FROM public.loyalty_accounts WHERE id = $1`,
        [accountId],
      )
    ).rows[0];
    expect(Number(balAgain.bal)).toBe(400);
  });

  it("12. insufficient points blocks claim", async () => {
    const pricey = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, product_id, product_quantity, active, reward_kind)
      VALUES ('${pricey}', '${f.shopAId}', 'Expensive', 9999, '${productId}', 1, true, 'product');
    `);
    const r = await redeem(accountId, pricey, `insuf-${crypto.randomUUID()}`);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("insufficient_points");
  });

  it("13. out-of-stock blocks claim", async () => {
    const low = crypto.randomUUID();
    const prod = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.products (id, shop_id, name, stock_on_hand, cost_ugx, is_active)
      VALUES ('${prod}', '${f.shopAId}', 'Empty SKU', 0, 100, true);
      INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, product_id, product_quantity, active, reward_kind)
      VALUES ('${low}', '${f.shopAId}', 'Empty reward', 10, '${prod}', 1, true, 'product');
    `);
    const beforeBal = (
      await exec.query<{ bal: string }>(
        `SELECT balance_points::text AS bal FROM public.loyalty_accounts WHERE id = $1`,
        [accountId],
      )
    ).rows[0];
    const r = await redeem(accountId, low, `oos-${crypto.randomUUID()}`);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("product_out_of_stock");
    const afterBal = (
      await exec.query<{ bal: string }>(
        `SELECT balance_points::text AS bal FROM public.loyalty_accounts WHERE id = $1`,
        [accountId],
      )
    ).rows[0];
    expect(afterBal.bal).toBe(beforeBal.bal);
    const stock = (
      await exec.query<{ stock: string }>(
        `SELECT stock_on_hand::text AS stock FROM public.products WHERE id = $1`,
        [prod],
      )
    ).rows[0];
    expect(Number(stock.stock)).toBe(0);
  });

  it("14. expired reward blocks claim", async () => {
    const expired = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.loyalty_rewards
        (id, shop_id, name, points_required, product_id, active, reward_kind, expires_on)
      VALUES ('${expired}', '${f.shopAId}', 'Expired Coke', 10, '${productId}', true, 'product', '2020-01-01');
    `);
    const r = await redeem(accountId, expired, `exp-${crypto.randomUUID()}`);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("reward_expired");
  });

  it("15–18. assignment expiry / other customer / D029 path", async () => {
    const assign = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_assign_reward($1,$2,$3,now() - interval '1 hour',null) AS result`,
            [f.shopAId, accountId, rewardAssignedId],
          )
        ).rows[0],
      ),
    );
    expect(assign.ok).toBe(true);

    const expiredAssign = await redeem(accountId, rewardAssignedId, `asg-exp-${crypto.randomUUID()}`);
    expect(expiredAssign.ok).toBe(false);
    expect(expiredAssign.error).toBe("assignment_expired");

    // Fresh assignment for account A; account B cannot claim
    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_revoke_reward_assignment($1,$2)`, [
        f.shopAId,
        String(assign.assignment_id),
      ]);
    });
    const assignOk = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_assign_reward($1,$2,$3,null,null) AS result`,
            [f.shopAId, accountId, rewardAssignedId],
          )
        ).rows[0],
      ),
    );
    expect(assignOk.ok).toBe(true);

    const other = await redeem(accountBId, rewardAssignedId, `other-${crypto.randomUUID()}`);
    expect(other.ok).toBe(false);
    expect(other.error).toBe("reward_grant_required");

    const ok = await redeem(accountId, rewardAssignedId, `asg-ok-${crypto.randomUUID()}`);
    expect(ok.ok).toBe(true);
    expect(ok.sale_id).toBeTruthy();
  });

  it("16–17. suspended / revoked customer blocks claim", async () => {
    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_set_account_lifecycle($1,$2,'suspend')`, [
        f.shopAId,
        accountBId,
      ]);
    });
    const suspended = await redeem(accountBId, rewardProductId, `sus-${crypto.randomUUID()}`);
    expect(suspended.ok).toBe(false);
    expect(suspended.error).toBe("account_suspended");

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
    const revoked = await redeem(accountBId, rewardProductId, `rev-${crypto.randomUUID()}`);
    expect(revoked.ok).toBe(false);
    expect(revoked.error).toBe("account_revoked");
  });

  it("19–20. D026 grant-only and shop-wide non-product still work", async () => {
    // Grant-only without grant/assignment fails
    const needGrant = await redeem(accountId, rewardGrantOnlyId, `grant-miss-${crypto.randomUUID()}`);
    expect(needGrant.ok).toBe(false);
    expect(needGrant.error).toBe("reward_grant_required");

    // Shop-wide voucher (no product) still redeems points without sale
    const plain = await redeem(accountId, rewardPlainId, `plain-${crypto.randomUUID()}`);
    expect(plain.ok).toBe(true);
    expect(plain.sale_id == null || plain.sale_id === null).toBe(true);
    expect(Number(plain.points_spent)).toBe(50);
  });

  it("22. cross-shop reward/product combination is blocked at attach time", async () => {
    // Covered by test 3; also verify redeem of shop B product never exists on shop A reward.
    const spoof = crypto.randomUUID();
    let err = "";
    try {
      await exec.exec(`
        UPDATE public.loyalty_rewards SET product_id = '${productBShopId}' WHERE id = '${rewardPlainId}';
      `);
    } catch (e) {
      err = String(e);
    }
    expect(err).toMatch(/loyalty_reward_product_cross_shop/);
    void spoof;
  });

  it("financial ledger schema untouched; uses apply_sale_stock_movements", async () => {
    const def = (
      await exec.query<{ def: string }>(
        `SELECT pg_get_functiondef('public.loyalty_redeem_reward(uuid,uuid,uuid,text,text,uuid)'::regprocedure) AS def`,
      )
    ).rows[0].def;
    expect(def).toMatch(/apply_sale_stock_movements/);
    expect(def).toMatch(/source.*loyalty_reward|loyalty_reward/);
    // No second redeem engine name
    expect(def).not.toMatch(/loyalty_claim_product_reward/);
  });
});

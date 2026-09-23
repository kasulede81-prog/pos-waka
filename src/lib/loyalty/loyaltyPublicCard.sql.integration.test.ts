import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  createLoyaltySqlHarness,
  rpcJson,
  seedLoyaltyFixture,
  type LoyaltyFixture,
  type SqlExec,
} from "../../test/sqlIntegration/loyaltyPgHarness";

/**
 * Phase 3 — public_card_token migration invariants.
 * Does not change qr_token, balances, or wallet metadata semantics.
 */

let exec: SqlExec;
let f: LoyaltyFixture;

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
}, 120_000);

afterAll(async () => {
  await exec.close();
});

async function enroll(userId: string, shopId: string, customerId: string) {
  return asUser(exec, userId, async () => {
    const { rows } = await exec.query(
      `SELECT public.loyalty_enroll_customer($1, $2, $3, 'in-store signup', '{}'::jsonb) AS result`,
      [shopId, customerId, true],
    );
    return rpcJson(rows[0]);
  });
}

describe("public_card_token migration", () => {
  it("backfills unique non-null tokens for existing accounts without changing qr_token or balance", async () => {
    const enrolled = await enroll(f.ownerAId, f.shopAId, f.customerAId);
    expect(enrolled.ok).toBe(true);

    const { rows: before } = await exec.query<{
      id: string;
      qr_token: string;
      balance_points: number;
      public_card_token: string;
    }>(
      `SELECT id, qr_token, balance_points, public_card_token
       FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
      [f.shopAId, f.customerAId],
    );
    expect(before).toHaveLength(1);
    const account = before[0];
    expect(account.public_card_token).toMatch(/^[a-f0-9]{64}$/i);
    expect(account.public_card_token).not.toBe(account.qr_token);

    // Simulate "existing" rows that somehow lack a token (pre-constraint path).
    await exec.exec(
      `ALTER TABLE public.loyalty_accounts ALTER COLUMN public_card_token DROP NOT NULL`,
    );
    await exec.query(
      `UPDATE public.loyalty_accounts SET public_card_token = NULL WHERE id = $1`,
      [account.id],
    );
    await exec.exec(`
      UPDATE public.loyalty_accounts
      SET public_card_token = public.loyalty_generate_public_card_token()
      WHERE public_card_token IS NULL OR btrim(public_card_token) = ''
    `);
    await exec.exec(
      `ALTER TABLE public.loyalty_accounts ALTER COLUMN public_card_token SET NOT NULL`,
    );

    const { rows: after } = await exec.query<{
      qr_token: string;
      balance_points: number;
      public_card_token: string;
    }>(
      `SELECT qr_token, balance_points, public_card_token
       FROM public.loyalty_accounts WHERE id = $1`,
      [account.id],
    );
    expect(after[0].qr_token).toBe(account.qr_token);
    expect(after[0].balance_points).toBe(account.balance_points);
    expect(after[0].public_card_token).toMatch(/^[a-f0-9]{64}$/i);
    expect(after[0].public_card_token).not.toBe(after[0].qr_token);
  });

  it("enforces uniqueness and auto-generates for new accounts", async () => {
    const customer2 = crypto.randomUUID();
    const customer3 = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.customers (id, shop_id, name, phone_e164) VALUES
         ($1, $2, 'Customer A2', '+256700000011'),
         ($3, $2, 'Customer A3', '+256700000012')`,
      [customer2, f.shopAId, customer3],
    );

    const a = await enroll(f.ownerAId, f.shopAId, customer2);
    const b = await enroll(f.ownerAId, f.shopAId, customer3);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    const { rows } = await exec.query<{ public_card_token: string; qr_token: string; n: number }>(
      `SELECT public_card_token, qr_token, count(*)::int AS n
       FROM public.loyalty_accounts
       WHERE shop_id = $1
       GROUP BY public_card_token, qr_token`,
      [f.shopAId],
    );
    expect(rows.every((r) => r.n === 1)).toBe(true);
    expect(rows.every((r) => r.public_card_token !== r.qr_token)).toBe(true);

    const { rows: nulls } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_accounts WHERE public_card_token IS NULL`,
    );
    expect(nulls[0].n).toBe(0);

    const { rows: dups } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (
         SELECT public_card_token FROM public.loyalty_accounts
         GROUP BY public_card_token HAVING count(*) > 1
       ) x`,
    );
    expect(dups[0].n).toBe(0);

    await expect(
      exec.query(
        `UPDATE public.loyalty_accounts
         SET public_card_token = (SELECT public_card_token FROM public.loyalty_accounts WHERE id = $1)
         WHERE id = $2`,
        [a.account_id, b.account_id],
      ),
    ).rejects.toThrow();
  });

  it("keeps qr_token identity for POS scan unchanged", async () => {
    const customer4 = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.customers (id, shop_id, name, phone_e164) VALUES
         ($1, $2, 'Customer A4', '+256700000014')`,
      [customer4, f.shopAId],
    );
    const enrolled = await enroll(f.ownerAId, f.shopAId, customer4);
    expect(enrolled.ok).toBe(true);
    const qr = String(enrolled.qr_token ?? "");
    expect(qr.length).toBeGreaterThan(8);

    const byToken = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_account_by_token($1, $2) AS result`,
        [f.shopAId, qr],
      );
      return rpcJson(rows[0]);
    });
    expect(byToken.ok).toBe(true);
    expect(byToken.account_id).toBe(enrolled.account_id);
  });
});

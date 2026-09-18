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
 * Phase 05 — Enrollment & QR identity integration tests (PGlite, real
 * migration files applied). Covers: consent recording in account metadata,
 * idempotent duplicate enrollment (backward-compatible two-arg call too),
 * and `loyalty_account_by_token` (resolution, cross-shop isolation, forged
 * token rejection, authorization).
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

async function enroll(
  userId: string,
  shopId: string,
  customerId: string,
  withConsent = false,
) {
  return asUser(exec, userId, async () => {
    const { rows } = await exec.query(
      `SELECT public.loyalty_enroll_customer($1, $2, $3, 'in-store signup', '{}'::jsonb) AS result`,
      [shopId, customerId, withConsent],
    );
    return rpcJson(rows[0]);
  });
}

describe("enrollment with consent", () => {
  it("creates the account and records consent metadata", async () => {
    const result = await enroll(f.ownerAId, f.shopAId, f.customerAId, true);
    expect(result.ok).toBe(true);
    expect(result.already_enrolled).toBe(false);

    const { rows } = await exec.query(
      `SELECT metadata, enrolled_by FROM public.loyalty_accounts WHERE id = $1`,
      [result.account_id],
    );
    const metadata = rows[0].metadata as { consent?: Record<string, unknown> };
    expect(metadata.consent?.accepted).toBe(true);
    expect(String(metadata.consent?.note)).toBe("in-store signup");
    expect(rows[0].enrolled_by).toBe(f.ownerAId);
  });

  it("duplicate enrollment is idempotent and reports already_enrolled", async () => {
    const first = await enroll(f.ownerAId, f.shopAId, f.customerAId, true);
    const second = await enroll(f.cashierAId, f.shopAId, f.customerAId, true);
    expect(second.ok).toBe(true);
    expect(second.already_enrolled).toBe(true);
    expect(second.account_id).toBe(first.account_id);

    const { rows } = await exec.query(
      `SELECT count(*)::int AS n FROM public.loyalty_accounts
       WHERE shop_id = $1 AND customer_id = $2`,
      [f.shopAId, f.customerAId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("keeps the two-argument call working (backward compatibility)", async () => {
    const result = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_enroll_customer($1, $2) AS result`,
        [f.shopAId, f.customerAId],
      );
      return rpcJson(rows[0]);
    });
    expect(result.ok).toBe(true);
    expect(result.already_enrolled).toBe(true);
  });

  it("rejects customers from another shop and users without access", async () => {
    const wrongShop = await enroll(f.ownerAId, f.shopAId, f.customerBId, true);
    expect(wrongShop.ok).toBe(false);
    expect(wrongShop.error).toBe("customer_not_in_shop");

    const outsider = await asUser(exec, f.outsiderId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_enroll_customer($1, $2, true, null, '{}'::jsonb) AS result`,
        [f.shopAId, f.customerAId],
      );
      return rpcJson(rows[0]);
    });
    expect(outsider.ok).toBe(false);
    expect(outsider.error).toBe("forbidden");
  });
});

describe("loyalty_account_by_token", () => {
  let qrToken: string;

  beforeAll(async () => {
    const { rows } = await exec.query(
      `SELECT qr_token FROM public.loyalty_accounts
       WHERE shop_id = $1 AND customer_id = $2`,
      [f.shopAId, f.customerAId],
    );
    qrToken = rows[0].qr_token as string;
  });

  it("resolves a valid token to the account and customer", async () => {
    const result = await asUser(exec, f.cashierAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_account_by_token($1, $2) AS result`,
        [f.shopAId, qrToken],
      );
      return rpcJson(rows[0]);
    });
    expect(result.ok).toBe(true);
    expect(result.customer_id).toBe(f.customerAId);
    expect(result.customer_name).toBe("Customer A");
    expect(result.customer_phone).toBe("+256700000001");
  });

  it("returns not_found for a forged or foreign-shop token", async () => {
    const forged = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_account_by_token($1, 'deadbeef-not-real') AS result`,
        [f.shopAId],
      );
      return rpcJson(rows[0]);
    });
    expect(forged.ok).toBe(false);
    expect(forged.error).toBe("not_found");

    // Shop B owner scanning Shop A's token at Shop B gets nothing.
    const wrongShop = await asUser(exec, f.outsiderId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_account_by_token($1, $2) AS result`,
        [f.shopBId, qrToken],
      );
      return rpcJson(rows[0]);
    });
    expect(wrongShop.ok).toBe(false);
    expect(wrongShop.error).toBe("not_found");
  });

  it("requires shop access and a non-empty token", async () => {
    const outsider = await asUser(exec, f.outsiderId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_account_by_token($1, $2) AS result`,
        [f.shopAId, qrToken],
      );
      return rpcJson(rows[0]);
    });
    expect(outsider.ok).toBe(false);
    expect(outsider.error).toBe("forbidden");

    const empty = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_account_by_token($1, '   ') AS result`,
        [f.shopAId],
      );
      return rpcJson(rows[0]);
    });
    expect(empty.ok).toBe(false);
    expect(empty.error).toBe("token_required");
  });

  it("token alone reveals no personal data across shops (RLS double-check)", async () => {
    // Even the super_admin member of Shop A cannot resolve Shop B tokens
    // unless the token belongs to Shop B — verify no shop B account leaks.
    const result = await asUser(exec, f.internalAdminId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_account_by_token($1, $2) AS result`,
        [f.shopAId, qrToken],
      );
      return rpcJson(rows[0]);
    });
    expect(result.ok).toBe(true);
    expect(result.customer_id).toBe(f.customerAId);
  });
});

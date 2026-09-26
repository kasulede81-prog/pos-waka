/**
 * Decision 028 enrollment links + Phase 2 public enrollment REQUESTS.
 *
 * Phase 2 replaced immediate public enrollment with a pending request that only a
 * merchant approval turns into a membership, so the enrollment assertions below are
 * about the request queue.
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
let token = "";

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId, { earnUnitUgx: 1000, earnPointsPerUnit: 1 });

  const created = await asUser(exec, f.ownerAId, async () =>
    rpcJson(
      (
        await exec.query<Record<string, unknown>>(
          `SELECT public.loyalty_regenerate_enrollment_link($1, 'Front desk') AS result`,
          [f.shopAId],
        )
      ).rows[0],
    ),
  );
  expect(created.ok).toBe(true);
  token = String(created.token);
  expect(token).toMatch(/^[a-f0-9]{64}$/);
}, 120_000);

afterAll(async () => {
  await exec.close();
});

describe("Decision 028 enrollment links", () => {
  it("merchant manage-shop can get link; cashier forbidden", async () => {
    const ok = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_get_enrollment_link($1) AS result`,
            [f.shopAId],
          )
        ).rows[0],
      ),
    );
    expect(ok.active).toBe(true);
    expect(ok.token).toBe(token);

    const denied = await asUser(exec, f.cashierAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_get_enrollment_link($1) AS result`,
            [f.shopAId],
          )
        ).rows[0],
      ),
    );
    expect(denied.error).toBe("forbidden");
  });

  it("preview returns branding only; invalid/revoked fail safely", async () => {
    const preview = (
      await exec.query<{ r: Record<string, unknown> }>(
        `SELECT public.loyalty_preview_enrollment_link($1) AS r`,
        [token],
      )
    ).rows[0]!.r;
    expect(preview.ok).toBe(true);
    expect(preview.shop_name).toBeTruthy();
    expect(preview).not.toHaveProperty("shop_id");
    expect(JSON.stringify(preview)).not.toContain(f.shopAId);

    expect(
      (
        await exec.query<{ r: Record<string, unknown> }>(
          `SELECT public.loyalty_preview_enrollment_link('aa') AS r`,
        )
      ).rows[0]!.r.error,
    ).toBe("token_invalid");

    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_revoke_enrollment_link($1)`, [f.shopAId]);
    });
    expect(
      (
        await exec.query<{ r: Record<string, unknown> }>(
          `SELECT public.loyalty_preview_enrollment_link($1) AS r`,
          [token],
        )
      ).rows[0]!.r.error,
    ).toBe("unavailable");

    // Restore active token for later tests
    const regen = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_regenerate_enrollment_link($1,null) AS result`,
            [f.shopAId],
          )
        ).rows[0],
      ),
    );
    token = String(regen.token);
  });
});

describe("Decision 028 public enroll — Phase 2: requests, not memberships", () => {
  /** Create a customer + active membership directly (the state approval would produce). */
  async function seedMemberWithPhone(shopId: string, phone: string, name: string): Promise<string> {
    const custId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.customers (id, shop_id, name, phone_e164) VALUES ($1,$2,$3,$4)`,
      [custId, shopId, name, phone],
    );
    const acctId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.loyalty_accounts (id, shop_id, customer_id) VALUES ($1,$2,$3)`,
      [acctId, shopId, custId],
    );
    return acctId;
  }

  async function requestRows(shopId: string, phone: string) {
    return (
      await exec.query<{ status: string; customer_id: string | null }>(
        `SELECT status, customer_id FROM public.loyalty_enrollment_requests
          WHERE shop_id = $1 AND phone_e164 = $2 ORDER BY requested_at`,
        [shopId, phone],
      )
    ).rows;
  }

  it("creates a PENDING request with no account, no customer, no card and no QR", async () => {
    const phone = "+256700111001";
    const result = (
      await exec.query<{ r: Record<string, unknown> }>(
        `SELECT public.loyalty_enroll_by_enrollment_token($1,'Ada',$2,null,true) AS r`,
        [token, phone],
      )
    ).rows[0]!.r;
    expect(result.ok).toBe(true);
    expect(result.status).toBe("pending");
    // The old contract returned a live card token; a pending requester must not get one.
    expect(result.public_card_token).toBeUndefined();
    expect(result).not.toHaveProperty("qr_token");
    expect(result).not.toHaveProperty("account_id");
    expect(result).not.toHaveProperty("shop_id");

    const rows = await requestRows(f.shopAId, phone);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("pending");

    // No membership and no customer were created by the public call.
    const accts = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_accounts a
        JOIN public.customers c ON c.id = a.customer_id
       WHERE a.shop_id = $1 AND c.phone_e164 = $2`,
      [f.shopAId, phone],
    );
    expect(accts.rows[0]!.n).toBe(0);
    const custs = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.customers WHERE shop_id = $1 AND phone_e164 = $2`,
      [f.shopAId, phone],
    );
    expect(custs.rows[0]!.n).toBe(0);
  });

  it("duplicate submission is idempotent — still one pending request", async () => {
    const phone = "+256700111001";
    const result = (
      await exec.query<{ r: Record<string, unknown> }>(
        `SELECT public.loyalty_enroll_by_enrollment_token($1,'Ada Again',$2,null,true) AS r`,
        [token, phone],
      )
    ).rows[0]!.r;
    expect(result.ok).toBe(true);
    expect(result.status).toBe("pending");
    expect(result.already_requested).toBe(true);
    expect(await requestRows(f.shopAId, phone)).toHaveLength(1);
  });

  it("active or suspended member already enrolled → already_member, no request", async () => {
    const phone = "+256700111010";
    const acctId = await seedMemberWithPhone(f.shopAId, phone, "Sam");
    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_set_account_lifecycle($1,$2,'suspend')`, [
        f.shopAId,
        acctId,
      ]);
    });

    const again = (
      await exec.query<{ r: Record<string, unknown> }>(
        `SELECT public.loyalty_enroll_by_enrollment_token($1,'Sam',$2,null,true) AS r`,
        [token, phone],
      )
    ).rows[0]!.r;
    expect(again.ok).toBe(true);
    expect(again.status).toBe("already_member");
    expect(again.public_card_token).toBeUndefined();
    // Suspension is preserved and nothing was queued.
    expect(await requestRows(f.shopAId, phone)).toHaveLength(0);
    const status = (
      await exec.query<{ status: string }>(`SELECT status FROM public.loyalty_accounts WHERE id = $1`, [
        acctId,
      ])
    ).rows[0]!.status;
    expect(status).toBe("suspended");
  });

  it("revoked account is not reactivated and cannot queue", async () => {
    const phone = "+256700111002";
    const acctId = await seedMemberWithPhone(f.shopAId, phone, "Ben");
    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_set_account_lifecycle($1,$2,'revoke')`, [
        f.shopAId,
        acctId,
      ]);
    });

    const again = (
      await exec.query<{ r: Record<string, unknown> }>(
        `SELECT public.loyalty_enroll_by_enrollment_token($1,'Ben',$2,null,true) AS r`,
        [token, phone],
      )
    ).rows[0]!.r;
    expect(again.error).toBe("account_revoked");
    expect(await requestRows(f.shopAId, phone)).toHaveLength(0);

    const status = (
      await exec.query<{ status: string }>(`SELECT status FROM public.loyalty_accounts WHERE id = $1`, [
        acctId,
      ])
    ).rows[0]!.status;
    expect(status).toBe("revoked");
  });

  it("cross-shop: a request made with shop A's token lands in shop A, never B", async () => {
    await enableProgram(exec, f.shopBId, { earnUnitUgx: 1000, earnPointsPerUnit: 1 });
    // Outsider owns shop B
    const bLink = await asUser(exec, f.outsiderId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_regenerate_enrollment_link($1,null) AS result`,
            [f.shopBId],
          )
        ).rows[0],
      ),
    );
    expect(bLink.ok).toBe(true);

    const phone = "+256700111003";
    await exec.query(`SELECT public.loyalty_enroll_by_enrollment_token($1,'Cara',$2,null,true)`, [
      token,
      phone,
    ]);

    expect(await requestRows(f.shopAId, phone)).toHaveLength(1);
    expect(await requestRows(f.shopBId, phone)).toHaveLength(0);
  });

  it("regenerate invalidates previous token", async () => {
    const old = token;
    const regen = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query<Record<string, unknown>>(
            `SELECT public.loyalty_regenerate_enrollment_link($1,null) AS result`,
            [f.shopAId],
          )
        ).rows[0],
      ),
    );
    token = String(regen.token);
    expect(token).not.toBe(old);
    expect(
      (
        await exec.query<{ r: Record<string, unknown> }>(
          `SELECT public.loyalty_enroll_by_enrollment_token($1,'Zed','+256700111099',null,true) AS r`,
          [old],
        )
      ).rows[0]!.r.error,
    ).toBe("unavailable");
  });
});

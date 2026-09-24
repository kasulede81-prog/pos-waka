/**
 * Decision 028 — public self-enrollment SQL integration.
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

describe("Decision 028 public enroll", () => {
  it("creates customer + loyalty account with zero points and public_card_token", async () => {
    const phone = "+256700111001";
    const result = (
      await exec.query<{ r: Record<string, unknown> }>(
        `SELECT public.loyalty_enroll_by_enrollment_token($1,'Ada',$2,null,true) AS r`,
        [token, phone],
      )
    ).rows[0]!.r;
    expect(result.ok).toBe(true);
    expect(String(result.public_card_token)).toMatch(/^[a-f0-9]{64}$/);
    expect(result).not.toHaveProperty("qr_token");
    expect(result).not.toHaveProperty("account_id");
    expect(result).not.toHaveProperty("shop_id");

    const acct = await exec.query<{ balance: number; status: string; src: string | null }>(
      `SELECT a.balance_points::int AS balance, a.status,
              a.metadata -> 'enrollment' ->> 'source' AS src
       FROM public.loyalty_accounts a
       JOIN public.customers c ON c.id = a.customer_id
       WHERE a.shop_id = $1 AND c.phone_e164 = $2`,
      [f.shopAId, phone],
    );
    expect(acct.rows[0]?.balance).toBe(0);
    expect(acct.rows[0]?.status).toBe("active");
    expect(acct.rows[0]?.src).toBe("public_enrollment_link");
  });

  it("duplicate phone returns already_member without card URL", async () => {
    const phone = "+256700111001";
    const result = (
      await exec.query<{ r: Record<string, unknown> }>(
        `SELECT public.loyalty_enroll_by_enrollment_token($1,'Ada',$2,null,true) AS r`,
        [token, phone],
      )
    ).rows[0]!.r;
    expect(result.ok).toBe(false);
    expect(result.error).toBe("already_member");
    expect(result.public_card_token).toBeUndefined();
  });

  it("suspended account returns already_member and stays suspended", async () => {
    const phone = "+256700111010";
    const first = (
      await exec.query<{ r: Record<string, unknown> }>(
        `SELECT public.loyalty_enroll_by_enrollment_token($1,'Sam',$2,null,true) AS r`,
        [token, phone],
      )
    ).rows[0]!.r;
    expect(first.ok).toBe(true);
    const acctId = (
      await exec.query<{ id: string }>(
        `SELECT a.id FROM public.loyalty_accounts a
         JOIN public.customers c ON c.id = a.customer_id
         WHERE a.shop_id = $1 AND c.phone_e164 = $2`,
        [f.shopAId, phone],
      )
    ).rows[0]!.id;
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
    expect(again.error).toBe("already_member");
    expect(again.public_card_token).toBeUndefined();
    const status = (
      await exec.query<{ status: string }>(
        `SELECT status FROM public.loyalty_accounts WHERE id = $1`,
        [acctId],
      )
    ).rows[0]!.status;
    expect(status).toBe("suspended");
  });

  it("revoked account is not reactivated", async () => {
    const phone = "+256700111002";
    const first = (
      await exec.query<{ r: Record<string, unknown> }>(
        `SELECT public.loyalty_enroll_by_enrollment_token($1,'Ben',$2,null,true) AS r`,
        [token, phone],
      )
    ).rows[0]!.r;
    expect(first.ok).toBe(true);

    const acctId = (
      await exec.query<{ id: string }>(
        `SELECT a.id FROM public.loyalty_accounts a
         JOIN public.customers c ON c.id = a.customer_id
         WHERE a.shop_id = $1 AND c.phone_e164 = $2`,
        [f.shopAId, phone],
      )
    ).rows[0]!.id;

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

    const status = (
      await exec.query<{ status: string }>(
        `SELECT status FROM public.loyalty_accounts WHERE id = $1`,
        [acctId],
      )
    ).rows[0]!.status;
    expect(status).toBe("revoked");
  });

  it("cross-shop: token of A cannot enroll into B", async () => {
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
    await exec.query(
      `SELECT public.loyalty_enroll_by_enrollment_token($1,'Cara',$2,null,true)`,
      [token, phone],
    );

    const inA = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_accounts a
       JOIN public.customers c ON c.id = a.customer_id
       WHERE a.shop_id = $1 AND c.phone_e164 = $2`,
      [f.shopAId, phone],
    );
    const inB = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_accounts a
       JOIN public.customers c ON c.id = a.customer_id
       WHERE a.shop_id = $1 AND c.phone_e164 = $2`,
      [f.shopBId, phone],
    );
    expect(inA.rows[0]!.n).toBe(1);
    expect(inB.rows[0]!.n).toBe(0);
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

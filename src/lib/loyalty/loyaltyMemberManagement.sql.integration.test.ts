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
 * Phase 3 — merchant management of membership lifecycle.
 *
 * Phase 1 gated the member allowance on loyalty_accounts INSERT. Suspend → reactivate,
 * and renewing an expired membership, reach the same state through UPDATE — so those
 * paths could exceed the allowance and the browser cannot be trusted to stop it. These
 * tests hold the server-side answer: the allowance is checked before any transition
 * INTO an active membership, from the lifecycle RPC, the renew RPC, and a raw UPDATE.
 *
 * They also pin the preservation guarantees: suspension and revocation must never touch
 * the ledger, the customer, or the wallet identity fields.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

async function newShop(label: string): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.shops (id, organization_id, name, shop_number) VALUES ($1,$2,$3,$4)`,
    [id, f.orgId, label, label.slice(0, 8).toUpperCase()],
  );
  await exec.query(`INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ($1,$2,'owner')`, [
    id,
    f.ownerAId,
  ]);
  await exec.query(
    `INSERT INTO public.loyalty_programs (shop_id, enabled, earn_unit_ugx, earn_points_per_unit)
     VALUES ($1, true, 1000, 1)`,
    [id],
  );
  return id;
}

/** Insert N active members and return their account ids. */
async function seedMembers(shopId: string, n: number): Promise<string[]> {
  await exec.query(
    `INSERT INTO public.customers (shop_id, name) SELECT $1, 'Member ' || g FROM generate_series(1,$2) g`,
    [shopId, n],
  );
  await exec.query(
    `INSERT INTO public.loyalty_accounts (shop_id, customer_id)
     SELECT $1, c.id FROM public.customers c
      WHERE c.shop_id = $1 AND NOT EXISTS (SELECT 1 FROM public.loyalty_accounts a WHERE a.customer_id = c.id)`,
    [shopId],
  );
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 ORDER BY created_at`,
    [shopId],
  );
  return rows.map((r) => r.id);
}

async function activeCount(shopId: string): Promise<number> {
  const { rows } = await exec.query<{ n: number }>(
    `SELECT public.count_shop_active_loyalty_members($1) AS n`,
    [shopId],
  );
  return Number(rows[0].n);
}

async function statusOf(accountId: string): Promise<string> {
  const { rows } = await exec.query<{ status: string }>(
    `SELECT status FROM public.loyalty_accounts WHERE id = $1`,
    [accountId],
  );
  return rows[0].status;
}

async function lifecycle(userId: string, shopId: string, accountId: string, action: string) {
  return asUser(exec, userId, async () => {
    const { rows } = await exec.query(
      `SELECT public.loyalty_set_account_lifecycle($1,$2,$3) AS result`,
      [shopId, accountId, action],
    );
    return rpcJson(rows[0]);
  });
}

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
}, T);

afterAll(async () => {
  await exec.close();
});

describe("merchant can see usage and members", () => {
  it("reports the allowance, usage, usage percentage and pending request count", async () => {
    const shop = await newShop("Usage View Shop");
    await seedMembers(shop, 3);
    // one pending request, so the counter is exercised
    await exec.query(
      `INSERT INTO public.loyalty_enrollment_requests (shop_id, name, phone_e164)
       VALUES ($1,'Waiting','+256782000001')`,
      [shop],
    );

    const usage = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(`SELECT public.shop_loyalty_usage($1) AS result`, [shop]);
      return rpcJson(rows[0]);
    });
    expect(usage.loyalty_enabled).toBe(true);
    expect(Number(usage.member_limit)).toBe(50);
    expect(Number(usage.active_members)).toBe(3);
    expect(Number(usage.remaining)).toBe(47);
    expect(Number(usage.usage_percent)).toBe(6);
    expect(Number(usage.pending_requests)).toBe(1);
    expect(usage.at_limit).toBe(false);
  });

  it("search returns members with their lifecycle status", async () => {
    const shop = await newShop("Search View Shop");
    const [first] = await seedMembers(shop, 1);
    await lifecycle(f.ownerAId, shop, first!, "suspend");

    const rows = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_search_accounts($1, null, null, 50) AS result`,
        [shop],
      );
      return rpcJson(rows[0]);
    });
    const accounts = rows.accounts as Array<Record<string, unknown>>;
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.status).toBe("suspended");
  });
});

describe("suspend and reactivate", () => {
  it("a merchant can suspend, and the member's history is preserved", async () => {
    const shop = await newShop("Suspend Shop");
    const [acct] = await seedMembers(shop, 1);
    // give the member ledger history
    await exec.query(
      `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause)
       VALUES ($1,$2,'earned',25,'sale')`,
      [shop, acct],
    );

    const r = await lifecycle(f.ownerAId, shop, acct!, "suspend");
    expect(r.ok).toBe(true);
    expect(r.status).toBe("suspended");
    expect(await statusOf(acct!)).toBe("suspended");

    // History and identity survive a suspension.
    const { rows } = await exec.query<{ n: number; bal: number }>(
      `SELECT (SELECT count(*)::int FROM public.loyalty_transactions WHERE account_id = $1) AS n,
              (SELECT balance_points::int FROM public.loyalty_accounts WHERE id = $1) AS bal`,
      [acct],
    );
    expect(Number(rows[0].n)).toBe(1);
    expect(Number(rows[0].bal)).toBe(25);
  });

  it("a merchant can reactivate, and the count moves correctly", async () => {
    const shop = await newShop("Reactivate Shop");
    const ids = await seedMembers(shop, 2);
    expect(await activeCount(shop)).toBe(2);

    await lifecycle(f.ownerAId, shop, ids[0]!, "suspend");
    expect(await activeCount(shop)).toBe(1);

    const r = await lifecycle(f.ownerAId, shop, ids[0]!, "reactivate");
    expect(r.ok).toBe(true);
    expect(r.status).toBe("active");
    expect(await activeCount(shop)).toBe(2);
  });

  it("suspend and reactivate are idempotent and never consume a slot twice", async () => {
    const shop = await newShop("Idempotent Lifecycle Shop");
    const ids = await seedMembers(shop, 2);
    await lifecycle(f.ownerAId, shop, ids[0]!, "suspend");
    const again = await lifecycle(f.ownerAId, shop, ids[0]!, "suspend");
    expect(again.ok).toBe(true);
    expect(again.already).toBe(true);

    await lifecycle(f.ownerAId, shop, ids[0]!, "reactivate");
    const reactivatedAgain = await lifecycle(f.ownerAId, shop, ids[0]!, "reactivate");
    expect(reactivatedAgain.ok).toBe(true);
    expect(reactivatedAgain.already).toBe(true);
    expect(await activeCount(shop)).toBe(2);
  });
});

describe("reactivation and renewal respect the member allowance (server-side)", () => {
  it("refuses reactivation at the cap and leaves the member suspended", async () => {
    const shop = await newShop("Reactivate At Cap Shop");
    const ids = await seedMembers(shop, 50);
    const suspended = ids[0]!;

    // Free a slot, then consume it with a brand-new member, so the shop is at 50 with a
    // suspended member waiting — the reactivation would be number 51.
    await lifecycle(f.ownerAId, shop, suspended, "suspend");
    expect(await activeCount(shop)).toBe(49);
    const extra = crypto.randomUUID();
    await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1,$2,'Extra')`, [
      extra,
      shop,
    ]);
    const enroll = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_enroll_customer($1,$2,true) AS loyalty_enroll_customer`,
        [shop, extra],
      );
      return rpcJson(rows[0]);
    });
    expect(enroll.ok).toBe(true);
    expect(await activeCount(shop)).toBe(50);

    const blocked = await lifecycle(f.ownerAId, shop, suspended, "reactivate");
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe("loyalty_member_limit_reached");
    expect(Number(blocked.member_limit)).toBe(50);
    expect(Number(blocked.active_count)).toBe(50);
    // The member stays suspended and the count is untouched.
    expect(await statusOf(suspended)).toBe("suspended");
    expect(await activeCount(shop)).toBe(50);
  });

  it("allows reactivation once a slot is freed", async () => {
    const shop = await newShop("Reactivate Freed Shop");
    const ids = await seedMembers(shop, 50);
    const suspended = ids[0]!;
    await lifecycle(f.ownerAId, shop, suspended, "suspend");
    // free a slot by suspending a different member → active 49
    await lifecycle(f.ownerAId, shop, ids[1]!, "suspend");
    expect(await activeCount(shop)).toBe(48);

    const allowed = await lifecycle(f.ownerAId, shop, suspended, "reactivate");
    expect(allowed.ok).toBe(true);
    expect(await statusOf(suspended)).toBe("active");
  });

  it("refuses renewing an expired membership at the cap", async () => {
    const shop = await newShop("Renew At Cap Shop");
    const ids = await seedMembers(shop, 50);
    // A 51st membership that is active but EXPIRED: inert, so it consumes no slot.
    const cust = crypto.randomUUID();
    await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1,$2,'Expired')`, [
      cust,
      shop,
    ]);
    const acct = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.loyalty_accounts (id, shop_id, customer_id, membership_expires_at)
       VALUES ($1,$2,$3, now() - interval '1 day')`,
      [acct, shop, cust],
    );
    expect(await activeCount(shop)).toBe(50);
    const { rows: before } = await exec.query<{ expires: string }>(
      `SELECT membership_expires_at AS expires FROM public.loyalty_accounts WHERE id = $1`,
      [acct],
    );

    const blocked = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_renew_membership($1,$2,null,null,null) AS result`,
        [shop, acct],
      );
      return rpcJson(rows[0]);
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe("loyalty_member_limit_reached");
    // The expiry was not moved.
    const { rows: after } = await exec.query<{ expires: string }>(
      `SELECT membership_expires_at AS expires FROM public.loyalty_accounts WHERE id = $1`,
      [acct],
    );
    expect(String(after[0].expires)).toBe(String(before[0].expires));
    expect(await activeCount(shop)).toBe(50);
    expect(ids.length).toBe(50);
  });

  it("renewing an ALREADY-ACTIVE member is unaffected by the cap", async () => {
    const shop = await newShop("Renew Active Shop");
    const ids = await seedMembers(shop, 50);
    const r = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_renew_membership($1,$2,'duration',null,3) AS result`,
        [shop, ids[0]!],
      );
      return rpcJson(rows[0]);
    });
    expect(r.ok).toBe(true);
    expect(await activeCount(shop)).toBe(50);
  });

  it("the UPDATE backstop blocks a raw reactivation that bypasses the RPC", async () => {
    const shop = await newShop("Raw Update Shop");
    const ids = await seedMembers(shop, 50);
    const suspended = ids[0]!;
    await lifecycle(f.ownerAId, shop, suspended, "suspend");
    const extra = crypto.randomUUID();
    await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1,$2,'Filler')`, [
      extra,
      shop,
    ]);
    await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_enroll_customer($1,$2,true) AS loyalty_enroll_customer`,
        [shop, extra],
      );
      return rpcJson(rows[0]);
    });
    expect(await activeCount(shop)).toBe(50);

    // Direct SQL, as the table owner — the guard must still refuse.
    await expect(
      exec.query(`UPDATE public.loyalty_accounts SET status = 'active' WHERE id = $1`, [suspended]),
    ).rejects.toThrow(/loyalty_member_limit_reached/);
    expect(await statusOf(suspended)).toBe("suspended");
  });

  it("a balance-only update never trips the guard", async () => {
    const shop = await newShop("Balance Update Shop");
    const ids = await seedMembers(shop, 50);
    // 50/50, so any false positive here would raise.
    await exec.query(
      `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause)
       VALUES ($1,$2,'earned',10,'sale')`,
      [shop, ids[0]],
    );
    const { rows } = await exec.query<{ bal: number }>(
      `SELECT balance_points::int AS bal FROM public.loyalty_accounts WHERE id = $1`,
      [ids[0]],
    );
    expect(Number(rows[0].bal)).toBe(10);
  });
});

describe("revoke preserves history and financial records", () => {
  it("revoking stops the membership without deleting the ledger or the customer", async () => {
    const shop = await newShop("Revoke Shop");
    const ids = await seedMembers(shop, 1);
    const acct = ids[0]!;
    await exec.query(
      `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause)
       VALUES ($1,$2,'earned',40,'sale')`,
      [shop, acct],
    );
    const { rows: acctRow } = await exec.query<{ customer_id: string }>(
      `SELECT customer_id FROM public.loyalty_accounts WHERE id = $1`,
      [acct],
    );
    const customerId = acctRow[0].customer_id;

    const r = await lifecycle(f.ownerAId, shop, acct, "revoke");
    expect(r.ok).toBe(true);
    expect(r.status).toBe("revoked");
    // Raw RPC payload is snake_case; the client mapper camel-cases it.
    expect(r.purge_after).toBeTruthy();

    // Ledger and customer are untouched; only the account's state changed.
    const { rows } = await exec.query<{ tx: number; cust: number; bal: number }>(
      `SELECT (SELECT count(*)::int FROM public.loyalty_transactions WHERE account_id = $1) AS tx,
              (SELECT count(*)::int FROM public.customers WHERE id = $2) AS cust,
              (SELECT balance_points::int FROM public.loyalty_accounts WHERE id = $1) AS bal`,
      [acct, customerId],
    );
    expect(Number(rows[0].tx)).toBe(1);
    expect(Number(rows[0].cust)).toBe(1);
    expect(Number(rows[0].bal)).toBe(40);
    expect(await activeCount(shop)).toBe(0);
  });

  it("a revoked member cannot be reactivated", async () => {
    const shop = await newShop("No Resurrect Shop");
    const ids = await seedMembers(shop, 1);
    await lifecycle(f.ownerAId, shop, ids[0]!, "revoke");
    const r = await lifecycle(f.ownerAId, shop, ids[0]!, "reactivate");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("account_revoked");
    expect(await statusOf(ids[0]!)).toBe("revoked");
  });
});

describe("lifecycle audit trail", () => {
  it("records the actor, action and time of a real transition", async () => {
    const shop = await newShop("Audit Trail Shop");
    const ids = await seedMembers(shop, 1);

    await lifecycle(f.ownerAId, shop, ids[0]!, "suspend");
    await lifecycle(f.ownerAId, shop, ids[0]!, "reactivate");
    await lifecycle(f.ownerAId, shop, ids[0]!, "revoke");

    const { rows } = await exec.query<{ history: Array<Record<string, unknown>> }>(
      `SELECT metadata -> 'lifecycle_history' AS history FROM public.loyalty_accounts WHERE id = $1`,
      [ids[0]],
    );
    const history = rows[0].history;
    expect(Array.isArray(history)).toBe(true);
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.action)).toEqual(["suspend", "reactivate", "revoke"]);
    for (const entry of history) {
      expect(entry.by).toBe(f.ownerAId);
      expect(entry.at).toBeTruthy();
    }
  });

  it("does not add an entry for an idempotent no-op", async () => {
    const shop = await newShop("Audit Noop Shop");
    const ids = await seedMembers(shop, 1);
    await lifecycle(f.ownerAId, shop, ids[0]!, "suspend");
    await lifecycle(f.ownerAId, shop, ids[0]!, "suspend"); // already suspended

    const { rows } = await exec.query<{ history: unknown[] }>(
      `SELECT metadata -> 'lifecycle_history' AS history FROM public.loyalty_accounts WHERE id = $1`,
      [ids[0]],
    );
    expect(rows[0].history).toHaveLength(1);
  });

  it("the audit write leaves balance and tokens untouched", async () => {
    const shop = await newShop("Audit Invariant Shop");
    const ids = await seedMembers(shop, 1);
    const { rows: before } = await exec.query<{ token: string; bal: number }>(
      `SELECT public_card_token AS token, balance_points::int AS bal FROM public.loyalty_accounts WHERE id = $1`,
      [ids[0]],
    );
    await lifecycle(f.ownerAId, shop, ids[0]!, "suspend");
    const { rows: after } = await exec.query<{ token: string; bal: number }>(
      `SELECT public_card_token AS token, balance_points::int AS bal FROM public.loyalty_accounts WHERE id = $1`,
      [ids[0]],
    );
    expect(after[0].token).toBe(before[0].token);
    expect(Number(after[0].bal)).toBe(Number(before[0].bal));
  });
});

describe("authorization", () => {
  it("a cashier cannot change membership state", async () => {
    const shop = await newShop("Cashier Lifecycle Shop");
    await exec.query(`INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ($1,$2,'cashier')`, [
      shop,
      f.cashierAId,
    ]);
    const ids = await seedMembers(shop, 1);

    for (const action of ["suspend", "reactivate", "revoke"]) {
      const r = await lifecycle(f.cashierAId, shop, ids[0]!, action);
      expect(r.ok).toBe(false);
      expect(r.error).toBe("forbidden");
    }
    expect(await statusOf(ids[0]!)).toBe("active");
  });

  it("a non-member cannot change membership state", async () => {
    const shop = await newShop("Outsider Lifecycle Shop");
    const ids = await seedMembers(shop, 1);
    const r = await lifecycle(f.outsiderId, shop, ids[0]!, "suspend");
    expect(r.error).toBe("forbidden");
    expect(await statusOf(ids[0]!)).toBe("active");
  });

  it("a cashier cannot renew or read another shop's usage", async () => {
    const shop = await newShop("Cashier Renew Shop");
    await exec.query(`INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ($1,$2,'cashier')`, [
      shop,
      f.cashierAId,
    ]);
    const ids = await seedMembers(shop, 1);
    const renew = await asUser(exec, f.cashierAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_renew_membership($1,$2,null,null,null) AS result`,
        [shop, ids[0]!],
      );
      return rpcJson(rows[0]);
    });
    expect(renew.error).toBe("forbidden");
  });
});

describe("server-side enforcement is unchanged", () => {
  it("the browser still cannot write loyalty_accounts directly", async () => {
    const shop = await newShop("No Direct Write Shop");
    const ids = await seedMembers(shop, 1);
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(
          `UPDATE public.loyalty_accounts SET status = 'active', balance_points = 9999 WHERE id = $1`,
          [ids[0]],
        );
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("a pending approval consumes exactly one slot and a rejection consumes none", async () => {
    const shop = await newShop("Approval Count Shop");
    const approveMe = await exec.query<{ id: string }>(
      `INSERT INTO public.loyalty_enrollment_requests (shop_id, name, phone_e164)
       VALUES ($1,'Approve Me','+256782000010') RETURNING id`,
      [shop],
    );
    const rejectMe = await exec.query<{ id: string }>(
      `INSERT INTO public.loyalty_enrollment_requests (shop_id, name, phone_e164)
       VALUES ($1,'Reject Me','+256782000011') RETURNING id`,
      [shop],
    );
    expect(await activeCount(shop)).toBe(0);

    const rejected = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_review_enrollment_request($1,$2,'reject','not wanted') AS result`,
        [shop, rejectMe.rows[0]!.id],
      );
      return rpcJson(rows[0]);
    });
    expect(rejected.ok).toBe(true);
    expect(await activeCount(shop)).toBe(0);

    const approved = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_review_enrollment_request($1,$2,'approve',null) AS result`,
        [shop, approveMe.rows[0]!.id],
      );
      return rpcJson(rows[0]);
    });
    expect(approved.ok).toBe(true);
    expect(await activeCount(shop)).toBe(1);
  });
});

describe("wallet state stays compatible with lifecycle", () => {
  it("lifecycle changes do not touch the wallet identity fields", async () => {
    const shop = await newShop("Wallet Compat Shop");
    const ids = await seedMembers(shop, 1);
    await exec.query(
      `UPDATE public.loyalty_accounts
          SET google_wallet_object_id = 'waka_loyalty.acct_test', google_wallet_issued_at = now()
        WHERE id = $1`,
      [ids[0]],
    );

    await lifecycle(f.ownerAId, shop, ids[0]!, "suspend");
    await lifecycle(f.ownerAId, shop, ids[0]!, "reactivate");
    await lifecycle(f.ownerAId, shop, ids[0]!, "revoke");

    const { rows } = await exec.query<{ obj: string | null; issued: string | null }>(
      `SELECT google_wallet_object_id AS obj, google_wallet_issued_at AS issued
         FROM public.loyalty_accounts WHERE id = $1`,
      [ids[0]],
    );
    expect(rows[0].obj).toBe("waka_loyalty.acct_test");
    expect(rows[0].issued).toBeTruthy();
  });

  it("only an active membership is eligible for issuance", async () => {
    const shop = await newShop("Issuance Gate Shop");
    const ids = await seedMembers(shop, 2);
    await lifecycle(f.ownerAId, shop, ids[0]!, "suspend");
    await lifecycle(f.ownerAId, shop, ids[1]!, "revoke");

    // The existing wallet gate requires status='active' AND an active membership, so a
    // suspended or revoked member simply has no eligible account.
    const { rows } = await exec.query<{ eligible: number }>(
      `SELECT count(*)::int AS eligible FROM public.loyalty_accounts
        WHERE shop_id = $1
          AND status = 'active'
          AND public.loyalty_account_membership_active(status, membership_expires_at, now())`,
      [shop],
    );
    expect(Number(rows[0].eligible)).toBe(0);
  });
});

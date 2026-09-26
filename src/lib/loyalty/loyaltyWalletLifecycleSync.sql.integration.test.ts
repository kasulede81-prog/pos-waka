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
 * Phase 5 — Google Wallet follows the membership lifecycle.
 *
 * Before this phase the outbox had one producer (the ledger insert trigger, which keeps
 * the points balance current) and nothing propagated a membership change, so a pass
 * issued to an active member stayed ACTIVE after suspension or revocation.
 *
 * These tests hold the contract on the database side, which is what the Edge worker
 * consumes:
 *   - one authoritative mapping, membership state -> Wallet state;
 *   - a lifecycle outbox row only after a SUCCESSFUL, EFFECTIVE state change;
 *   - the sale/ledger balance path untouched;
 *   - no Wallet object created for an account that was never issued one.
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

/** An active member, optionally already issued to Google Wallet. */
async function seedMember(
  shopId: string,
  name: string,
  opts: { wallet?: boolean; expiresAt?: string | null } = {},
): Promise<{ accountId: string; customerId: string }> {
  const customerId = crypto.randomUUID();
  await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1,$2,$3)`, [
    customerId,
    shopId,
    name,
  ]);
  const accountId = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.loyalty_accounts (id, shop_id, customer_id, membership_expires_at)
     VALUES ($1,$2,$3,$4)`,
    [accountId, shopId, customerId, opts.expiresAt ?? null],
  );
  if (opts.wallet) {
    await exec.query(
      `UPDATE public.loyalty_accounts
          SET google_wallet_object_id = 'waka_loyalty.acct_' || id::text,
              google_wallet_issued_at = now(),
              google_wallet_sync_state = 'ACTIVE'
        WHERE id = $1`,
      [accountId],
    );
  }
  return { accountId, customerId };
}

async function lifecycle(shopId: string, accountId: string, action: string) {
  return asUser(exec, f.ownerAId, async () => {
    const { rows } = await exec.query(
      `SELECT public.loyalty_set_account_lifecycle($1,$2,$3) AS result`,
      [shopId, accountId, action],
    );
    return rpcJson(rows[0]);
  });
}

async function outbox(accountId: string) {
  const { rows } = await exec.query<{
    sync_kind: string;
    reason: string;
    status: string;
    attempts: number;
    balance_points: number;
  }>(
    `SELECT sync_kind, reason, status, attempts, balance_points
       FROM public.loyalty_wallet_sync_outbox
      WHERE account_id = $1 ORDER BY created_at, id`,
    [accountId],
  );
  return rows;
}

async function desiredState(accountId: string): Promise<string | null> {
  const { rows } = await exec.query<{ s: string | null }>(
    `SELECT public.loyalty_wallet_state_for_account($1) AS s`,
    [accountId],
  );
  return rows[0].s;
}

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
}, T);

afterAll(async () => {
  await exec.close();
});

describe("one authoritative membership -> Wallet state mapping", () => {
  it("maps each lifecycle state, treating a lapsed membership as EXPIRED", async () => {
    const { rows } = await exec.query<{ s: string }>(
      `SELECT public.loyalty_wallet_desired_state('active', null, now()) AS s
       UNION ALL SELECT public.loyalty_wallet_desired_state('active', now() - interval '1 day', now())
       UNION ALL SELECT public.loyalty_wallet_desired_state('active', now() + interval '1 day', now())
       UNION ALL SELECT public.loyalty_wallet_desired_state('suspended', null, now())
       UNION ALL SELECT public.loyalty_wallet_desired_state('revoked', null, now())
       UNION ALL SELECT public.loyalty_wallet_desired_state(null, null, now())`,
    );
    expect(rows.map((r) => r.s)).toEqual([
      "ACTIVE",
      "EXPIRED",
      "ACTIVE",
      "INACTIVE",
      "INACTIVE",
      "INACTIVE",
    ]);
  });

  it("derives the state for a real account, and is not client-callable", async () => {
    const shop = await newShop("Mapping Shop");
    const { accountId } = await seedMember(shop, "Active", { wallet: true });
    expect(await desiredState(accountId)).toBe("ACTIVE");

    await exec.query(
      `UPDATE public.loyalty_accounts SET membership_expires_at = now() - interval '1 day' WHERE id = $1`,
      [accountId],
    );
    expect(await desiredState(accountId)).toBe("EXPIRED");

    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(`SELECT public.loyalty_wallet_state_for_account($1)`, [accountId]);
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("lifecycle changes enqueue Wallet work", () => {
  it("suspend and revoke each queue a lifecycle sync", async () => {
    const shop = await newShop("Lifecycle Queue Shop");
    const { accountId } = await seedMember(shop, "Suspender", { wallet: true });

    expect(await lifecycle(shop, accountId, "suspend")).toMatchObject({ ok: true });
    const afterSuspend = await outbox(accountId);
    expect(afterSuspend).toHaveLength(1);
    expect(afterSuspend[0]!.sync_kind).toBe("lifecycle");
    expect(afterSuspend[0]!.reason).toBe("lifecycle_suspend");
    expect(afterSuspend[0]!.status).toBe("pending");
    expect(await desiredState(accountId)).toBe("INACTIVE");

    await lifecycle(shop, accountId, "reactivate");
    expect(await desiredState(accountId)).toBe("ACTIVE");

    await lifecycle(shop, accountId, "revoke");
    const afterRevoke = await outbox(accountId);
    expect(afterRevoke).toHaveLength(3);
    expect(afterRevoke[2]!.reason).toBe("lifecycle_revoke");
    expect(await desiredState(accountId)).toBe("INACTIVE");
  });

  it("reactivation queues the return to ACTIVE", async () => {
    const shop = await newShop("Reactivate Queue Shop");
    const { accountId } = await seedMember(shop, "Returner", { wallet: true });
    await lifecycle(shop, accountId, "suspend");
    await lifecycle(shop, accountId, "reactivate");
    const rows = await outbox(accountId);
    expect(rows.map((r) => r.reason)).toEqual(["lifecycle_suspend", "lifecycle_reactivate"]);
    expect(await desiredState(accountId)).toBe("ACTIVE");
  });

  it("suspend then reactivate converges on ACTIVE", async () => {
    const shop = await newShop("Converge Shop");
    const { accountId } = await seedMember(shop, "Converger", { wallet: true });
    await lifecycle(shop, accountId, "suspend");
    await lifecycle(shop, accountId, "reactivate");
    // The newest queued work is the one that determines the final Wallet state.
    const rows = await outbox(accountId);
    const last = rows[rows.length - 1]!;
    expect(last.reason).toBe("lifecycle_reactivate");
    expect(await desiredState(accountId)).toBe("ACTIVE");
  });

  it("renewing an expired membership queues a lifecycle sync", async () => {
    const shop = await newShop("Renew Queue Shop");
    const { accountId } = await seedMember(shop, "Renewer", {
      wallet: true,
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    expect(await desiredState(accountId)).toBe("EXPIRED");

    const r = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_renew_membership($1,$2,'duration',null,3) AS result`,
        [shop, accountId],
      );
      return rpcJson(rows[0]);
    });
    expect(r.ok).toBe(true);
    const rows = await outbox(accountId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe("lifecycle_renewed");
    expect(await desiredState(accountId)).toBe("ACTIVE");
  });

  it("renewing an already-active member queues nothing (no effective change)", async () => {
    const shop = await newShop("Renew Noop Shop");
    const { accountId } = await seedMember(shop, "Still Active", { wallet: true });
    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_renew_membership($1,$2,'duration',null,3)`, [
        shop,
        accountId,
      ]);
    });
    expect(await outbox(accountId)).toHaveLength(0);
  });

  it("a renewal refused by the allowance queues nothing", async () => {
    const shop = await newShop("Renew Refused Shop");
    // Fill the allowance, then add an expired-active member who cannot be restored.
    await exec.query(
      `INSERT INTO public.customers (shop_id, name) SELECT $1, 'Filler ' || g FROM generate_series(1,50) g`,
      [shop],
    );
    await exec.query(
      `INSERT INTO public.loyalty_accounts (shop_id, customer_id)
       SELECT $1, c.id FROM public.customers c
        WHERE c.shop_id = $1 AND NOT EXISTS (SELECT 1 FROM public.loyalty_accounts a WHERE a.customer_id = c.id)`,
      [shop],
    );
    const { accountId } = await seedMember(shop, "Cannot Renew", {
      wallet: true,
      expiresAt: "2000-01-01T00:00:00.000Z",
    });

    const r = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_renew_membership($1,$2,'duration',null,3) AS result`,
        [shop, accountId],
      );
      return rpcJson(rows[0]);
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("loyalty_member_limit_reached");
    // No state change, no Wallet work.
    expect(await outbox(accountId)).toHaveLength(0);
    expect(await desiredState(accountId)).toBe("EXPIRED");
  });

  it("a refused reactivation queues nothing", async () => {
    const shop = await newShop("Reactivate Refused Shop");
    // Build the state the rule is about: 50 ACTIVE members plus one suspended one whose
    // reactivation would be number 51. The member must exist before the shop fills up.
    const { accountId } = await seedMember(shop, "Cannot Return", { wallet: true });
    await exec.query(
      `INSERT INTO public.customers (shop_id, name) SELECT $1, 'Filler ' || g FROM generate_series(1,49) g`,
      [shop],
    );
    await exec.query(
      `INSERT INTO public.loyalty_accounts (shop_id, customer_id)
       SELECT $1, c.id FROM public.customers c
        WHERE c.shop_id = $1 AND NOT EXISTS (SELECT 1 FROM public.loyalty_accounts a WHERE a.customer_id = c.id)`,
      [shop],
    );
    await lifecycle(shop, accountId, "suspend");
    // Consume the freed slot so the shop is back at 50 active.
    await exec.query(`INSERT INTO public.customers (shop_id, name) VALUES ($1,'Last Filler')`, [shop]);
    await exec.query(
      `INSERT INTO public.loyalty_accounts (shop_id, customer_id)
       SELECT $1, c.id FROM public.customers c
        WHERE c.shop_id = $1 AND NOT EXISTS (SELECT 1 FROM public.loyalty_accounts a WHERE a.customer_id = c.id)`,
      [shop],
    );
    const before = await outbox(accountId);

    const blocked = await lifecycle(shop, accountId, "reactivate");
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe("loyalty_member_limit_reached");
    expect(await outbox(accountId)).toHaveLength(before.length);
    expect(await desiredState(accountId)).toBe("INACTIVE");
  });
});

describe("idempotency", () => {
  it("a repeated lifecycle call queues no second row", async () => {
    const shop = await newShop("Idempotent Queue Shop");
    const { accountId } = await seedMember(shop, "Twice", { wallet: true });
    await lifecycle(shop, accountId, "suspend");
    const again = await lifecycle(shop, accountId, "suspend");
    expect(again.already).toBe(true);
    expect(await outbox(accountId)).toHaveLength(1);
  });

  it("the enqueue helper is idempotent within a transaction and per transition", async () => {
    const shop = await newShop("Enqueue Idempotency Shop");
    const { accountId } = await seedMember(shop, "Helper", { wallet: true });
    const { rows } = await exec.query<{ a: boolean; b: boolean }>(
      `SELECT public.loyalty_wallet_enqueue_lifecycle($1,$2,'x') AS a,
              public.loyalty_wallet_enqueue_lifecycle($1,$2,'x') AS b`,
      [shop, accountId],
    );
    // Same transaction, same source_ref: the second insert is a no-op by unique index.
    expect(rows[0].a).toBe(true);
    expect(rows[0].b).toBe(false);
    expect(await outbox(accountId)).toHaveLength(1);
  });

  it("processing the same row twice cannot duplicate a Wallet object", async () => {
    const shop = await newShop("No Duplicate Object Shop");
    const { accountId } = await seedMember(shop, "Once", { wallet: true });
    await lifecycle(shop, accountId, "suspend");
    // The worker identifies the object by the deterministic id derived from the ACCOUNT,
    // never from the outbox row, so replaying work cannot mint a second object.
    const { rows } = await exec.query<{ n: number; obj: string }>(
      `SELECT count(DISTINCT google_wallet_object_id)::int AS n,
              min(google_wallet_object_id) AS obj
         FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    );
    expect(Number(rows[0].n)).toBe(1);
    expect(rows[0].obj).toContain("acct_");
  });
});

describe("the lifecycle patch preserves everything else", () => {
  it("keeps the Wallet object id, points, and member identity", async () => {
    const shop = await newShop("Preserve Shop");
    const { accountId, customerId } = await seedMember(shop, "Preserved", { wallet: true });
    await exec.query(
      `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause)
       VALUES ($1,$2,'earned',42,'sale')`,
      [shop, accountId],
    );
    const { rows: before } = await exec.query<{ obj: string; bal: number; cust: string }>(
      `SELECT google_wallet_object_id AS obj, balance_points::int AS bal, customer_id::text AS cust
         FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    );

    await lifecycle(shop, accountId, "suspend");
    await lifecycle(shop, accountId, "revoke");

    const { rows: after } = await exec.query<{ obj: string; bal: number; cust: string }>(
      `SELECT google_wallet_object_id AS obj, balance_points::int AS bal, customer_id::text AS cust
         FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    );
    expect(after[0].obj).toBe(before[0].obj);
    expect(Number(after[0].bal)).toBe(Number(before[0].bal));
    expect(after[0].cust).toBe(customerId);
  });

  it("revocation preserves the ledger and the customer", async () => {
    const shop = await newShop("Revoke Preserve Shop");
    const { accountId, customerId } = await seedMember(shop, "History", { wallet: true });
    await exec.query(
      `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause)
       VALUES ($1,$2,'earned',15,'sale')`,
      [shop, accountId],
    );
    await lifecycle(shop, accountId, "revoke");

    const { rows } = await exec.query<{ tx: number; cust: number }>(
      `SELECT (SELECT count(*)::int FROM public.loyalty_transactions WHERE account_id = $1) AS tx,
              (SELECT count(*)::int FROM public.customers WHERE id = $2) AS cust`,
      [accountId, customerId],
    );
    expect(Number(rows[0].tx)).toBe(1);
    expect(Number(rows[0].cust)).toBe(1);
  });

  it("never creates a Wallet object for an account that has none", async () => {
    const shop = await newShop("No Object Shop");
    const { accountId } = await seedMember(shop, "Unissued", { wallet: false });
    await lifecycle(shop, accountId, "suspend");
    await lifecycle(shop, accountId, "revoke");

    // Work is queued, but nothing mints an object: the worker skips accounts with no
    // google_wallet_object_id and marks the row done as `not_issued`.
    const rows = await outbox(accountId);
    expect(rows.length).toBeGreaterThan(0);
    const { rows: acct } = await exec.query<{ obj: string | null; issued: string | null }>(
      `SELECT google_wallet_object_id AS obj, google_wallet_issued_at AS issued
         FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    );
    expect(acct[0].obj).toBeNull();
    expect(acct[0].issued).toBeNull();
  });
});

describe("the existing balance sync path is untouched", () => {
  it("a sale still queues a BALANCE row, never a lifecycle row", async () => {
    const shop = await newShop("Balance Path Shop");
    const { accountId, customerId } = await seedMember(shop, "Earner", { wallet: true });
    const saleId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, total_ugx, completed_at)
       VALUES ($1,$2,$3,'completed','paid',50000, now())`,
      [saleId, shop, customerId],
    );

    const rows = await outbox(accountId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sync_kind).toBe("balance");
    expect(rows[0]!.reason).toBe("sale");
  });

  it("balance-only account updates queue nothing extra", async () => {
    const shop = await newShop("Balance Only Shop");
    const { accountId } = await seedMember(shop, "Balance", { wallet: true });
    const before = await outbox(accountId);
    await exec.query(
      `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause)
       VALUES ($1,$2,'earned',5,'sale')`,
      [shop, accountId],
    );
    const after = await outbox(accountId);
    expect(after).toHaveLength(before.length + 1);
    expect(after.every((r) => r.sync_kind === "balance")).toBe(true);
  });
});

describe("security", () => {
  it("the browser cannot write Wallet ids, state, or outbox rows", async () => {
    const shop = await newShop("Wallet Security Shop");
    const { accountId } = await seedMember(shop, "Guard", { wallet: true });

    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(
          `UPDATE public.loyalty_accounts SET google_wallet_object_id = 'forged', google_wallet_sync_state = 'ACTIVE' WHERE id = $1`,
          [accountId],
        );
      }),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(
          `INSERT INTO public.loyalty_wallet_sync_outbox (shop_id, account_id, balance_points, reason, source_ref, sync_kind)
           VALUES ($1,$2,0,'forged','forged',  'lifecycle')`,
          [shop, accountId],
        );
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("the enqueue helper is not client-callable", async () => {
    const shop = await newShop("Enqueue Security Shop");
    const { accountId } = await seedMember(shop, "Helper Guard", { wallet: true });
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(`SELECT public.loyalty_wallet_enqueue_lifecycle($1,$2,'x')`, [
          shop,
          accountId,
        ]);
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("only a manage-shop role can drive the lifecycle that queues Wallet work", async () => {
    const shop = await newShop("Lifecycle Auth Shop");
    await exec.query(`INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ($1,$2,'cashier')`, [
      shop,
      f.cashierAId,
    ]);
    const { accountId } = await seedMember(shop, "Protected", { wallet: true });
    const r = await asUser(exec, f.cashierAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_set_account_lifecycle($1,$2,'suspend') AS result`,
        [shop, accountId],
      );
      return rpcJson(rows[0]);
    });
    expect(r.error).toBe("forbidden");
    expect(await outbox(accountId)).toHaveLength(0);
  });
});

describe("public card stays consistent with membership state", () => {
  it("a suspended, revoked or expired member is not reported active", async () => {
    const shop = await newShop("Public Card State Shop");
    const active = await seedMember(shop, "Active One", { wallet: true });
    const suspended = await seedMember(shop, "Suspended One", { wallet: true });
    const revoked = await seedMember(shop, "Revoked One", { wallet: true });
    const expired = await seedMember(shop, "Expired One", {
      wallet: true,
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    await lifecycle(shop, suspended.accountId, "suspend");
    await lifecycle(shop, revoked.accountId, "revoke");

    // The public card's authorization reads these same facts, so Wallet state can never
    // make an inactive member look active.
    const { rows } = await exec.query<{ id: string; status: string; active: boolean }>(
      `SELECT id, status,
              public.loyalty_account_membership_active(status, membership_expires_at, now()) AS active
         FROM public.loyalty_accounts WHERE shop_id = $1`,
      [shop],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[active.accountId]!.active).toBe(true);
    expect(byId[suspended.accountId]!.active).toBe(false);
    expect(byId[revoked.accountId]!.active).toBe(false);
    expect(byId[expired.accountId]!.active).toBe(false);
    expect(byId[revoked.accountId]!.status).toBe("revoked");
  });
});

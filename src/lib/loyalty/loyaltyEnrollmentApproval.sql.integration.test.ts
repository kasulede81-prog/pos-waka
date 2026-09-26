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
 * Phase 2 — public enrollment REQUESTS + merchant approval.
 *
 * The behaviour under test is the replacement of
 *   PUBLIC QR -> immediate ACTIVE membership
 * with
 *   PUBLIC QR -> PENDING request -> merchant approve/reject -> membership.
 *
 * The two properties worth protecting above all others:
 *   1. a public caller can never end up with a membership without a merchant decision;
 *   2. approval is atomic — the allowance is checked and consumed under the per-shop
 *      advisory lock, so the final free slot cannot be handed out twice.
 *
 * NOTE on concurrency: PGlite (the default harness) is a single connection, so a truly
 * simultaneous two-transaction approval cannot execute here. The two-approvals-on-the-
 * final-slot test below is deterministic and proves the count is re-read under the lock;
 * the lock itself is the same one proven in production for device slots
 * (141_owner_first_device_enrollment.sql:44).
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

async function newShop(label: string, withProgram = true): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.shops (id, organization_id, name, shop_number) VALUES ($1,$2,$3,$4)`,
    [id, f.orgId, label, label.slice(0, 8).toUpperCase()],
  );
  await exec.query(
    `INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ($1,$2,'owner')`,
    [id, f.ownerAId],
  );
  if (withProgram) {
    await exec.query(
      `INSERT INTO public.loyalty_programs (shop_id, enabled, earn_unit_ugx, earn_points_per_unit)
       VALUES ($1, true, 1000, 1)`,
      [id],
    );
  }
  return id;
}

async function seedMembers(shopId: string, n: number): Promise<void> {
  await exec.query(
    `INSERT INTO public.customers (shop_id, name)
     SELECT $1, 'Member ' || g FROM generate_series(1, $2) g`,
    [shopId, n],
  );
  await exec.query(
    `INSERT INTO public.loyalty_accounts (shop_id, customer_id)
     SELECT $1, c.id FROM public.customers c
     WHERE c.shop_id = $1
       AND NOT EXISTS (SELECT 1 FROM public.loyalty_accounts a WHERE a.customer_id = c.id)`,
    [shopId],
  );
}

async function makeRequest(shopId: string, name: string, phone: string): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.loyalty_enrollment_requests (id, shop_id, name, phone_e164)
     VALUES ($1,$2,$3,$4)`,
    [id, shopId, name, phone],
  );
  return id;
}

async function requestRow(id: string) {
  const { rows } = await exec.query<{
    status: string;
    reviewed_at: string | null;
    reviewed_by: string | null;
    rejection_reason: string | null;
    approved_loyalty_account_id: string | null;
    customer_id: string | null;
  }>(
    `SELECT status, reviewed_at, reviewed_by, rejection_reason,
            approved_loyalty_account_id, customer_id
       FROM public.loyalty_enrollment_requests WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function activeCount(shopId: string): Promise<number> {
  const { rows } = await exec.query<{ n: number }>(
    `SELECT public.count_shop_active_loyalty_members($1) AS n`,
    [shopId],
  );
  return Number(rows[0].n);
}

async function review(
  userId: string,
  shopId: string,
  requestId: string,
  action: string,
  reason?: string,
) {
  return asUser(exec, userId, async () => {
    const { rows } = await exec.query(
      `SELECT public.loyalty_review_enrollment_request($1,$2,$3,$4) AS result`,
      [shopId, requestId, action, reason ?? null],
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

describe("merchant approval", () => {
  it("approves a pending request, creating exactly one membership", async () => {
    const shop = await newShop("Approval Shop");
    const reqId = await makeRequest(shop, "Amina", "+256781000001");

    const before = await requestRow(reqId);
    expect(before.status).toBe("pending");

    const r = await review(f.ownerAId, shop, reqId, "approve");
    expect(r.ok).toBe(true);
    expect(r.status).toBe("approved");
    expect(r.new_membership).toBe(true);
    expect(r.loyalty_account_id).toBeTruthy();

    // Exactly one account, and it belongs to the newly created customer.
    const { rows: accts } = await exec.query<{ id: string; customer_id: string }>(
      `SELECT id, customer_id FROM public.loyalty_accounts WHERE shop_id = $1`,
      [shop],
    );
    expect(accts).toHaveLength(1);
    expect(accts[0].id).toBe(r.loyalty_account_id);
    expect(await activeCount(shop)).toBe(1);

    // The customer was created from the request (public calls create none).
    const { rows: custs } = await exec.query<{ id: string; name: string; phone_e164: string }>(
      `SELECT id, name, phone_e164 FROM public.customers WHERE shop_id = $1`,
      [shop],
    );
    expect(custs).toHaveLength(1);
    expect(custs[0].phone_e164).toBe("+256781000001");
    expect(accts[0].customer_id).toBe(custs[0].id);
  });

  it("marks the request approved and records the reviewer and time", async () => {
    const shop = await newShop("Reviewer Shop");
    const reqId = await makeRequest(shop, "Bosco", "+256781000002");
    const r = await review(f.ownerAId, shop, reqId, "approve");

    const row = await requestRow(reqId);
    expect(row.status).toBe("approved");
    expect(row.reviewed_at).toBeTruthy();
    expect(row.reviewed_by).toBe(f.ownerAId);
    expect(row.approved_loyalty_account_id).toBe(r.loyalty_account_id);
    expect(row.customer_id).toBe(r.customer_id);
  });

  it("links to an existing customer rather than duplicating one", async () => {
    const shop = await newShop("Existing Customer Shop");
    const custId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.customers (id, shop_id, name, phone_e164) VALUES ($1,$2,'Existing',$3)`,
      [custId, shop, "+256781000003"],
    );
    const reqId = await makeRequest(shop, "Existing", "+256781000003");
    const r = await review(f.ownerAId, shop, reqId, "approve");
    expect(r.ok).toBe(true);
    expect(r.customer_id).toBe(custId);

    const { rows } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.customers WHERE shop_id = $1`,
      [shop],
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it("is idempotent — a replayed approval creates nothing further", async () => {
    const shop = await newShop("Idempotent Shop");
    const reqId = await makeRequest(shop, "Cate", "+256781000004");
    const first = await review(f.ownerAId, shop, reqId, "approve");
    const second = await review(f.ownerAId, shop, reqId, "approve");

    expect(second.ok).toBe(true);
    expect(second.already_reviewed).toBe(true);
    expect(second.loyalty_account_id).toBe(first.loyalty_account_id);
    expect(await activeCount(shop)).toBe(1);
  });

  it("cannot be approved after rejection", async () => {
    const shop = await newShop("Rejected Then Approve Shop");
    const reqId = await makeRequest(shop, "Dan", "+256781000005");
    await review(f.ownerAId, shop, reqId, "reject", "not a customer");
    const r = await review(f.ownerAId, shop, reqId, "approve");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("already_reviewed");
    expect(await activeCount(shop)).toBe(0);
  });
});

describe("merchant rejection", () => {
  it("marks the request rejected and creates no membership", async () => {
    const shop = await newShop("Reject Shop");
    const reqId = await makeRequest(shop, "Eve", "+256781000010");
    const r = await review(f.ownerAId, shop, reqId, "reject", "duplicate account");
    expect(r.ok).toBe(true);
    expect(r.status).toBe("rejected");

    const row = await requestRow(reqId);
    expect(row.status).toBe("rejected");
    expect(row.reviewed_at).toBeTruthy();
    expect(row.reviewed_by).toBe(f.ownerAId);
    expect(row.rejection_reason).toBe("duplicate account");
    expect(row.approved_loyalty_account_id).toBeNull();

    expect(await activeCount(shop)).toBe(0);
    const { rows } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_accounts WHERE shop_id = $1`,
      [shop],
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it("keeps the rejected request as an audit record and frees the phone for a retry", async () => {
    const shop = await newShop("Retry Shop");
    const first = await makeRequest(shop, "Fiona", "+256781000011");
    await review(f.ownerAId, shop, first, "reject", "incomplete details");

    // A rejected request still exists for audit...
    expect((await requestRow(first)).status).toBe("rejected");
    // ...and does not block a fresh request for the same phone.
    const second = await makeRequest(shop, "Fiona", "+256781000011");
    expect(second).not.toBe(first);
    const { rows } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_enrollment_requests
        WHERE shop_id = $1 AND phone_e164 = $2 AND status = 'pending'`,
      [shop, "+256781000011"],
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it("rejects invalid input safely", async () => {
    const shop = await newShop("Invalid Input Shop");
    const reqId = await makeRequest(shop, "Gil", "+256781000012");
    const bad = await review(f.ownerAId, shop, reqId, "delete");
    expect(bad.error).toBe("invalid_action");
    const longReason = "x".repeat(281);
    const tooLong = await review(f.ownerAId, shop, reqId, "reject", longReason);
    expect(tooLong.error).toBe("invalid_reason");
    const missing = await review(f.ownerAId, shop, crypto.randomUUID(), "approve");
    expect(missing.error).toBe("request_not_found");
    // Still untouched by all of the above.
    expect((await requestRow(reqId)).status).toBe("pending");
  });
});

describe("authorization", () => {
  it("a cashier cannot approve or reject", async () => {
    const shop = await newShop("Cashier Shop");
    await exec.query(
      `INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ($1,$2,'cashier')`,
      [shop, f.cashierAId],
    );
    const reqId = await makeRequest(shop, "Hana", "+256781000020");

    for (const action of ["approve", "reject"]) {
      const r = await review(f.cashierAId, shop, reqId, action);
      expect(r.ok).toBe(false);
      expect(r.error).toBe("forbidden");
    }
    expect((await requestRow(reqId)).status).toBe("pending");
    expect(await activeCount(shop)).toBe(0);
  });

  it("a user with no membership on the shop cannot approve", async () => {
    const shop = await newShop("Outsider Shop");
    const reqId = await makeRequest(shop, "Ivan", "+256781000021");
    const r = await review(f.outsiderId, shop, reqId, "approve");
    expect(r.error).toBe("forbidden");
    expect((await requestRow(reqId)).status).toBe("pending");
  });

  it("a client cannot read another shop's request queue", async () => {
    const shopA = await newShop("Queue A");
    const shopB = await newShop("Queue B");
    await makeRequest(shopA, "Joan", "+256781000022");

    // ownerA owns both of these; the outsider owns neither.
    const denied = await asUser(exec, f.outsiderId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_list_enrollment_requests($1,'pending',100) AS result`,
        [shopA],
      );
      return rpcJson(rows[0]);
    });
    expect(denied.error).toBe("forbidden");

    const allowed = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_list_enrollment_requests($1,'pending',100) AS result`,
        [shopA],
      );
      return rpcJson(rows[0]);
    });
    expect(allowed.ok).toBe(true);
    expect((allowed.requests as unknown[]).length).toBe(1);

    const empty = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_list_enrollment_requests($1,'pending',100) AS result`,
        [shopB],
      );
      return rpcJson(rows[0]);
    });
    expect((empty.requests as unknown[]).length).toBe(0);
  });
});

describe("approval respects the member allowance", () => {
  it("fails safely at the cap and leaves the request PENDING", async () => {
    const shop = await newShop("Cap Approval Shop");
    await seedMembers(shop, 50);
    const reqId = await makeRequest(shop, "Kato", "+256781000030");

    const r = await review(f.ownerAId, shop, reqId, "approve");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("loyalty_member_limit_reached");
    expect(Number(r.member_limit)).toBe(50);
    expect(r.request_status).toBe("pending");

    // Nothing created, nothing consumed.
    expect((await requestRow(reqId)).status).toBe("pending");
    expect((await requestRow(reqId)).approved_loyalty_account_id).toBeNull();
    expect(await activeCount(shop)).toBe(50);
    const { rows } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_accounts WHERE shop_id = $1`,
      [shop],
    );
    expect(Number(rows[0].n)).toBe(50);
  });

  it("succeeds once a slot is freed", async () => {
    const shop = await newShop("Freed Slot Shop");
    await seedMembers(shop, 50);
    const reqId = await makeRequest(shop, "Lena", "+256781000031");

    const blocked = await review(f.ownerAId, shop, reqId, "approve");
    expect(blocked.error).toBe("loyalty_member_limit_reached");

    // Suspend one member to free a slot, then the same request goes through.
    await exec.query(
      `UPDATE public.loyalty_accounts SET status = 'suspended'
        WHERE shop_id = $1 AND id = (SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 LIMIT 1)`,
      [shop],
    );
    const allowed = await review(f.ownerAId, shop, reqId, "approve");
    expect(allowed.ok).toBe(true);
    expect((await requestRow(reqId)).status).toBe("approved");
    expect(await activeCount(shop)).toBe(50);
  });

  it("two approvals competing for the final slot cannot both succeed", async () => {
    const shop = await newShop("Final Slot Approval Shop");
    await seedMembers(shop, 49);
    const a = await makeRequest(shop, "Mia", "+256781000040");
    const b = await makeRequest(shop, "Nate", "+256781000041");

    const first = await review(f.ownerAId, shop, a, "approve");
    const second = await review(f.ownerAId, shop, b, "approve");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.error).toBe("loyalty_member_limit_reached");
    // The loser stays pending and can be retried; the winner consumed the slot.
    expect((await requestRow(a)).status).toBe("approved");
    expect((await requestRow(b)).status).toBe("pending");
    expect(await activeCount(shop)).toBe(50);
  });

  it("refuses to approve when the Loyalty entitlement is inactive", async () => {
    const shop = await newShop("No Entitlement Shop");
    const reqId = await makeRequest(shop, "Omar", "+256781000050");
    await exec.query(
      `DELETE FROM public.organization_feature_entitlements
        WHERE organization_id = $1 AND feature_code = 'loyalty'`,
      [f.orgId],
    );
    try {
      const r = await review(f.ownerAId, shop, reqId, "approve");
      expect(r.ok).toBe(false);
      expect(r.error).toBe("loyalty_not_enabled");
      expect((await requestRow(reqId)).status).toBe("pending");
      expect(await activeCount(shop)).toBe(0);
    } finally {
      await exec.query(
        `INSERT INTO public.organization_feature_entitlements (organization_id, feature_code, status, plan_code)
         VALUES ($1,'loyalty','active','free')
         ON CONFLICT (organization_id, feature_code) DO UPDATE
           SET status = 'active', plan_code = 'free'`,
        [f.orgId],
      );
    }
  });
});

describe("a pending request is not a membership", () => {
  it("awards no points and creates no ledger entry", async () => {
    const shop = await newShop("No Points Shop");
    await makeRequest(shop, "Pam", "+256781000060");

    const { rows: tx } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_transactions WHERE shop_id = $1`,
      [shop],
    );
    expect(Number(tx[0].n)).toBe(0);
  });

  it("issues no Google Wallet object and queues no Wallet sync", async () => {
    const shop = await newShop("No Wallet Shop");
    const reqId = await makeRequest(shop, "Quinn", "+256781000061");
    await review(f.ownerAId, shop, reqId, "approve");

    // Approval creates the membership; Wallet issuance is a separate, explicit step,
    // so nothing should have been enqueued by the request or by the approval itself.
    const { rows: outbox } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_wallet_sync_outbox WHERE shop_id = $1`,
      [shop],
    );
    expect(Number(outbox[0].n)).toBe(0);

    const { rows: acct } = await exec.query<{ wallet: string | null }>(
      `SELECT google_wallet_object_id AS wallet FROM public.loyalty_accounts WHERE shop_id = $1`,
      [shop],
    );
    expect(acct[0].wallet).toBeNull();
  });

  it("the merchant never sees a card token for a pending request", async () => {
    const shop = await newShop("No Card Shop");
    await makeRequest(shop, "Rita", "+256781000062");
    const listed = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_list_enrollment_requests($1,'pending',100) AS result`,
        [shop],
      );
      return rpcJson(rows[0]);
    });
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toContain("qr_token");
    expect(serialized).not.toContain("public_card_token");
  });
});

describe("clients cannot write membership or request state directly", () => {
  it("authenticated cannot insert a loyalty_account", async () => {
    const shop = await newShop("Direct Account Shop");
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(`INSERT INTO public.loyalty_accounts (shop_id, customer_id) VALUES ($1,$2)`, [
          shop,
          f.customerAId,
        ]);
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("authenticated cannot insert or update an enrollment request", async () => {
    const shop = await newShop("Direct Request Shop");
    const reqId = await makeRequest(shop, "Sara", "+256781000070");

    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(
          `INSERT INTO public.loyalty_enrollment_requests (shop_id, name, phone_e164)
           VALUES ($1,'Self Approved',$2)`,
          [shop, "+256781000071"],
        );
      }),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(
          `UPDATE public.loyalty_enrollment_requests SET status = 'approved' WHERE id = $1`,
          [reqId],
        );
      }),
    ).rejects.toThrow(/permission denied/i);

    expect((await requestRow(reqId)).status).toBe("pending");
  });

  it("no INSERT/UPDATE policy exists on the request table", async () => {
    const { rows } = await exec.query<{ cmd: string }>(
      `SELECT cmd FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'loyalty_enrollment_requests'`,
    );
    expect(rows.map((r) => r.cmd)).toEqual(["SELECT"]);
  });
});

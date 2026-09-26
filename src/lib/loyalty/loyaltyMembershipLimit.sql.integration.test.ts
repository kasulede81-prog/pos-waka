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
 * WAKA Loyalty monetisation — Phase 1 entitlement + member allowance.
 *
 * The allowance is enforced server-side in ONE place that covers every creation
 * path found in the forensic audit: the BEFORE INSERT guard on loyalty_accounts.
 * These tests hold the three claims that matter:
 *
 *   1. the allowance resolves from CONFIGURABLE catalog data (never hard-coded),
 *   2. no path can exceed it — RPC, sale auto-enroll, public link, or direct insert,
 *   3. a blocked loyalty write never damages a financial write.
 *
 * NOTE on concurrency: PGlite (the default harness) is a single connection, so a
 * genuinely simultaneous two-transaction race cannot be executed here. The
 * deterministic two-attempt test below proves the count is re-read after each
 * success; the advisory lock that serialises true concurrency is the same one
 * proven in production for device slots (141_owner_first_device_enrollment.sql:44).
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

// Dedicated shops keep each describe block's member counts independent: the
// allowance is per shop, while the entitlement is resolved from the organization.
let limitShop: string;
let countsShop: string;
let awardShop: string;
let publicShop: string;

async function newShop(orgId: string, label: string, ownerId = f.ownerAId): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.shops (id, organization_id, name, shop_number) VALUES ($1, $2, $3, $4)`,
    [id, orgId, label, label.slice(0, 8).toUpperCase()],
  );
  // The fixture only makes ownerA a member of shopA, so new shops need their own
  // membership row before ownerA can drive the enrollment RPC against them.
  await exec.query(
    `INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [id, ownerId],
  );
  return id;
}

/** Insert `n` customers in the shop and make them all active members. */
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

async function addCustomer(shopId: string, name: string): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, $3)`, [
    id,
    shopId,
    name,
  ]);
  return id;
}

async function activeCount(shopId: string): Promise<number> {
  const { rows } = await exec.query<{ n: number }>(
    `SELECT public.count_shop_active_loyalty_members($1) AS n`,
    [shopId],
  );
  return Number(rows[0].n);
}

async function resolve(shopId: string) {
  const { rows } = await exec.query<{
    loyalty_enabled: boolean;
    entitlement_status: string;
    tier_code: string | null;
    member_limit: number;
  }>(`SELECT * FROM public.resolve_shop_loyalty_entitlement($1)`, [shopId]);
  return rows[0];
}

async function setTier(orgId: string, planCode: string | null, status = "active") {
  await exec.query(
    `UPDATE public.organization_feature_entitlements
        SET plan_code = $2, status = $3
      WHERE organization_id = $1 AND feature_code = 'loyalty'`,
    [orgId, planCode, status],
  );
}

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  limitShop = await newShop(f.orgId, "Limit Shop");
  countsShop = await newShop(f.orgId, "Counts Shop");
  awardShop = await newShop(f.orgId, "Award Shop");
  publicShop = await newShop(f.orgId, "Public Shop");
  // Give the fixture's own shop a member so the write-denial tests have a real row
  // to attempt against (the denial itself is grant-based, not row-based).
  await seedMembers(f.shopAId, 1);
}, T);

afterAll(async () => {
  await exec.close();
});

describe("entitlement catalog is configurable data, not code", () => {
  it("seeds the four WAKA Loyalty tiers with their allowances", async () => {
    const { rows } = await exec.query<{ code: string; member_limit: number }>(
      `SELECT code, member_limit FROM public.loyalty_plan_tiers ORDER BY sort_order`,
    );
    const byCode = Object.fromEntries(rows.map((r) => [r.code, Number(r.member_limit)]));
    expect(byCode.free).toBe(50);
    expect(byCode.starter).toBe(500);
    expect(byCode.business).toBe(2000);
    expect(byCode.pro).toBe(10000);
  });

  it("resolves a tier allowance from the catalog", async () => {
    const { rows } = await exec.query<{ l: number }>(
      `SELECT public.loyalty_plan_tier_limit('pro') AS l`,
    );
    expect(Number(rows[0].l)).toBe(10000);
  });

  it("falls back to the default tier for an unknown or absent tier code", async () => {
    for (const bad of ["does_not_exist", "", null]) {
      const { rows } = await exec.query<{ l: number }>(
        `SELECT public.loyalty_plan_tier_limit($1) AS l`,
        [bad],
      );
      expect(Number(rows[0].l)).toBe(50);
    }
  });

  it("FREE is a real tier resolving to 50 — not the same as 'no entitlement'", async () => {
    await setTier(f.orgId, "free");
    const r = await resolve(limitShop);
    expect(r.loyalty_enabled).toBe(true);
    expect(r.tier_code).toBe("free");
    expect(Number(r.member_limit)).toBe(50);
  });

  it("changing the tier changes the allowance without any code change", async () => {
    await setTier(f.orgId, "business");
    expect(Number((await resolve(limitShop)).member_limit)).toBe(2000);
    await setTier(f.orgId, "free");
    expect(Number((await resolve(limitShop)).member_limit)).toBe(50);
  });
});

describe("member limit is enforced server-side", () => {
  it("allows enrollment while under the allowance", async () => {
    await seedMembers(limitShop, 10);
    expect(await activeCount(limitShop)).toBe(10);
    const customer = await addCustomer(limitShop, "Under Limit");
    const r = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_enroll_customer($1, $2, true) AS loyalty_enroll_customer`,
        [limitShop, customer],
      );
      return rpcJson(rows[0]);
    });
    expect(r.ok).toBe(true);
    expect(await activeCount(limitShop)).toBe(11);
  });

  it("allows the final slot, then rejects the next member (49 → 50 → 51)", async () => {
    // A fresh shop so the count is exactly what this test seeds.
    const shop = await newShop(f.orgId, "Slot Shop");
    await seedMembers(shop, 49);
    expect(await activeCount(shop)).toBe(49);

    // 50th — the final free slot — must succeed through the RPC.
    const fiftieth = await addCustomer(shop, "Fiftieth");
    const ok = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_enroll_customer($1, $2, true) AS loyalty_enroll_customer`,
        [shop, fiftieth],
      );
      return rpcJson(rows[0]);
    });
    expect(ok.ok).toBe(true);
    expect(await activeCount(shop)).toBe(50);

    // 51st — rejected, and the count must not move.
    const fiftyFirst = await addCustomer(shop, "Fifty First");
    const blocked = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_enroll_customer($1, $2, true) AS loyalty_enroll_customer`,
        [shop, fiftyFirst],
      );
      return rpcJson(rows[0]);
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe("loyalty_member_limit_reached");
    expect(Number(blocked.member_limit)).toBe(50);
    expect(Number(blocked.active_count)).toBe(50);
    expect(await activeCount(shop)).toBe(50);
  });

  it("cannot be pushed to 51 by a direct insert either (the backstop covers every path)", async () => {
    const shop = await newShop(f.orgId, "Direct Insert Shop");
    await seedMembers(shop, 50);
    const extra = await addCustomer(shop, "Direct Insert");
    await expect(
      exec.query(`INSERT INTO public.loyalty_accounts (shop_id, customer_id) VALUES ($1, $2)`, [
        shop,
        extra,
      ]),
    ).rejects.toThrow(/loyalty_member_limit_reached/);
    expect(await activeCount(shop)).toBe(50);
  });

  it("two attempts on the final free slot cannot both succeed", async () => {
    // Serialised attempt: the guard must re-read the count after the first success,
    // so the second caller sees the slot is already taken.
    const shop = await newShop(f.orgId, "Race Shop");
    await seedMembers(shop, 49);
    const a = await addCustomer(shop, "Race A");
    const b = await addCustomer(shop, "Race B");

    const results = [] as Array<Record<string, unknown>>;
    for (const customer of [a, b]) {
      results.push(
        await asUser(exec, f.ownerAId, async () => {
          const { rows } = await exec.query(
            `SELECT public.loyalty_enroll_customer($1, $2, true) AS loyalty_enroll_customer`,
            [shop, customer],
          );
          return rpcJson(rows[0]);
        }),
      );
    }

    expect(results.filter((r) => r.ok === true)).toHaveLength(1);
    expect(results.filter((r) => r.error === "loyalty_member_limit_reached")).toHaveLength(1);
    expect(await activeCount(shop)).toBe(50);
  });

  it("re-enrolling an existing member at the cap is idempotent and never consumes a slot", async () => {
    // A shop that is exactly full: re-enrolling an existing member must still work
    // (it creates no row), while a new member is refused.
    const shop = await newShop(f.orgId, "Full Idempotent Shop");
    await seedMembers(shop, 50);
    const { rows } = await exec.query<{ customer_id: string }>(
      `SELECT customer_id FROM public.loyalty_accounts WHERE shop_id = $1 LIMIT 1`,
      [shop],
    );
    const existing = rows[0].customer_id;

    const r = await asUser(exec, f.ownerAId, async () => {
      const { rows: out } = await exec.query(
        `SELECT public.loyalty_enroll_customer($1, $2, true) AS loyalty_enroll_customer`,
        [shop, existing],
      );
      return rpcJson(out[0]);
    });
    expect(r.ok).toBe(true);
    expect(r.already_enrolled).toBe(true);
    expect(await activeCount(shop)).toBe(50);
  });
});

describe("what counts toward the allowance", () => {
  it("counts only what the existing lifecycle already calls an active member", async () => {
    await seedMembers(countsShop, 3);
    expect(await activeCount(countsShop)).toBe(3);

    // suspended does not count
    await exec.query(
      `UPDATE public.loyalty_accounts SET status = 'suspended'
        WHERE shop_id = $1 AND id = (SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 LIMIT 1)`,
      [countsShop],
    );
    expect(await activeCount(countsShop)).toBe(2);

    // revoked does not count (and needs the shape constraint satisfied)
    await exec.query(
      `UPDATE public.loyalty_accounts
          SET status = 'revoked', revoked_at = now(), purge_after = now() + interval '30 days'
        WHERE shop_id = $1 AND id = (SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 LIMIT 1)`,
      [countsShop],
    );
    expect(await activeCount(countsShop)).toBe(1);

    // an expired membership does not count
    await exec.query(
      `UPDATE public.loyalty_accounts SET membership_expires_at = now() - interval '1 day'
        WHERE shop_id = $1`,
      [countsShop],
    );
    expect(await activeCount(countsShop)).toBe(0);
  });

  it("freeing a slot by suspending a member lets a new member in at the cap", async () => {
    const shop = await newShop(f.orgId, "Free Slot Shop");
    await seedMembers(shop, 50);
    expect(await activeCount(shop)).toBe(50);

    // At cap: rejected.
    const blockedCustomer = await addCustomer(shop, "Blocked");
    const blocked = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_enroll_customer($1, $2, true) AS loyalty_enroll_customer`,
        [shop, blockedCustomer],
      );
      return rpcJson(rows[0]);
    });
    expect(blocked.error).toBe("loyalty_member_limit_reached");

    // Suspend one member → one slot is freed → the same enrollment now succeeds.
    await exec.query(
      `UPDATE public.loyalty_accounts SET status = 'suspended'
        WHERE shop_id = $1 AND id = (SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 LIMIT 1)`,
      [shop],
    );
    const allowed = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_enroll_customer($1, $2, true) AS loyalty_enroll_customer`,
        [shop, blockedCustomer],
      );
      return rpcJson(rows[0]);
    });
    expect(allowed.ok).toBe(true);
    expect(await activeCount(shop)).toBe(50);
  });
});

describe("isolation", () => {
  it("one shop's allowance does not consume another shop's", async () => {
    // A shop filled to the brim must not affect a sibling shop in the same org.
    const fullShop = await newShop(f.orgId, "Full Sibling Shop");
    await seedMembers(fullShop, 50);
    expect(await activeCount(fullShop)).toBe(50);

    const otherShop = await newShop(f.orgId, "Other Shop");
    await seedMembers(otherShop, 30);
    expect(await activeCount(otherShop)).toBe(30);

    const customer = await addCustomer(otherShop, "Other Customer");
    const r = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_enroll_customer($1, $2, true) AS loyalty_enroll_customer`,
        [otherShop, customer],
      );
      return rpcJson(rows[0]);
    });
    expect(r.ok).toBe(true);
  });

  it("a client cannot enroll into a shop it has no access to", async () => {
    // ownerA owns shopA only; shopB's owner is a different user.
    const r = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_enroll_customer($1, $2, true) AS loyalty_enroll_customer`,
        [f.shopBId, f.customerBId],
      );
      return rpcJson(rows[0]);
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
  });

  it("the member count is per shop, not org-wide", async () => {
    const { rows } = await exec.query<{ n: number }>(
      `SELECT public.count_shop_active_loyalty_members($1) AS n`,
      [f.shopBId],
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});

describe("inactive entitlement cannot create new membership", () => {
  let lockedShop: string;

  beforeAll(async () => {
    // A dedicated org with the entitlement removed — tests the gate without
    // disturbing the fixture org used by every other test.
    const lockedOrg = crypto.randomUUID();
    await exec.query(`INSERT INTO public.organizations (id, name) VALUES ($1, 'Locked Org')`, [
      lockedOrg,
    ]);
    lockedShop = await newShop(lockedOrg, "Locked Shop");
    await exec.query(
      `DELETE FROM public.organization_feature_entitlements
        WHERE organization_id = $1 AND feature_code = 'loyalty'`,
      [lockedOrg],
    );
  }, T);

  it("resolves as not enabled with a zero allowance", async () => {
    const r = await resolve(lockedShop);
    expect(r.loyalty_enabled).toBe(false);
    expect(Number(r.member_limit)).toBe(0);
    expect(r.entitlement_status).toBe("none");
  });

  it("rejects enrollment through the RPC", async () => {
    const customer = await addCustomer(lockedShop, "Locked Customer");
    const r = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_enroll_customer($1, $2, true) AS loyalty_enroll_customer`,
        [lockedShop, customer],
      );
      return rpcJson(rows[0]);
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("loyalty_not_enabled");
  });

  it("rejects even a direct server-side insert (no path bypasses the gate)", async () => {
    const customer = await addCustomer(lockedShop, "Locked Direct");
    await expect(
      exec.query(`INSERT INTO public.loyalty_accounts (shop_id, customer_id) VALUES ($1, $2)`, [
        lockedShop,
        customer,
      ]),
    ).rejects.toThrow(/loyalty_not_enabled/);
  });
});

describe("the direct client INSERT/UPDATE hole is closed", () => {
  it("authenticated cannot INSERT a loyalty_account", async () => {
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(
          `INSERT INTO public.loyalty_accounts (shop_id, customer_id, balance_points)
           VALUES ($1, $2, 999999)`,
          [f.shopAId, f.customerAId],
        );
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("authenticated cannot write arbitrary balance_points", async () => {
    const { rows } = await exec.query<{ id: string }>(
      `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 LIMIT 1`,
      [f.shopAId],
    );
    expect(rows.length).toBe(1);
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(`UPDATE public.loyalty_accounts SET balance_points = 999999 WHERE id = $1`, [
          rows[0].id,
        ]);
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("authenticated cannot choose its own qr_token or public_card_token", async () => {
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(
          `INSERT INTO public.loyalty_accounts (shop_id, customer_id, qr_token, public_card_token)
           VALUES ($1, $2, 'attacker-chosen', 'attacker-chosen')`,
          [f.shopBId, f.customerBId],
        );
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("no client INSERT policy remains on the table", async () => {
    const { rows } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'loyalty_accounts' AND cmd = 'INSERT'`,
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it("the server-side RPC still writes (definer path is unaffected)", async () => {
    const shop = await newShop(f.orgId, "Definer Shop");
    const customer = await addCustomer(shop, "Definer Customer");
    const r = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_enroll_customer($1, $2, true) AS loyalty_enroll_customer`,
        [shop, customer],
      );
      return rpcJson(rows[0]);
    });
    expect(r.ok).toBe(true);
    expect(r.qr_token).toBeTruthy();
  });
});

describe("public enrollment queues a REQUEST and cannot bypass the entitlement", () => {
  // Phase 2 replaced public self-enrollment with merchant approval. The public RPC now
  // only ever writes a pending request, so these assertions are about the queue, not
  // about creating members.
  const TOKEN = "a".repeat(64);

  beforeAll(async () => {
    await exec.query(
      `INSERT INTO public.loyalty_enrollment_links (shop_id, token, status)
       VALUES ($1, $2, 'active')`,
      [publicShop, TOKEN],
    );
    await exec.query(
      `INSERT INTO public.loyalty_programs (shop_id, enabled) VALUES ($1, true)`,
      [publicShop],
    );
  }, T);

  async function requestCount(phone: string): Promise<number> {
    const { rows } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_enrollment_requests
        WHERE shop_id = $1 AND phone_e164 = $2`,
      [publicShop, phone],
    );
    return Number(rows[0].n);
  }

  it("creates a PENDING request and NO loyalty account", async () => {
    const { rows } = await exec.query(
      `SELECT public.loyalty_request_enrollment($1, 'Public One', '+256788000001', null, true) AS result`,
      [TOKEN],
    );
    const r = rpcJson(rows[0]);
    expect(r.ok).toBe(true);
    expect(r.status).toBe("pending");
    expect(await activeCount(publicShop)).toBe(0);
    expect(await requestCount("+256788000001")).toBe(1);

    const { rows: statusRows } = await exec.query<{ status: string }>(
      `SELECT status FROM public.loyalty_enrollment_requests
        WHERE shop_id = $1 AND phone_e164 = $2`,
      [publicShop, "+256788000001"],
    );
    expect(statusRows[0].status).toBe("pending");
  });

  it("is idempotent — a duplicate submission makes no second request", async () => {
    const { rows } = await exec.query(
      `SELECT public.loyalty_request_enrollment($1, 'Public One Again', '+256788000001', null, true) AS result`,
      [TOKEN],
    );
    const r = rpcJson(rows[0]);
    expect(r.ok).toBe(true);
    expect(r.status).toBe("pending");
    expect(r.already_requested).toBe(true);
    expect(await requestCount("+256788000001")).toBe(1);
  });

  it("the legacy public entry point now only queues a request", async () => {
    const { rows } = await exec.query(
      `SELECT public.loyalty_enroll_by_enrollment_token($1, 'Legacy Caller', '+256788000009', null, true) AS result`,
      [TOKEN],
    );
    const r = rpcJson(rows[0]);
    expect(r.status).toBe("pending");
    expect(r.public_card_token).toBeUndefined();
    expect(await activeCount(publicShop)).toBe(0);
  });

  it("refuses to queue requests when the Loyalty entitlement is inactive", async () => {
    const orgId = (await exec.query<{ organization_id: string }>(
      `SELECT organization_id FROM public.shops WHERE id = $1`,
      [publicShop],
    )).rows[0].organization_id;
    await setTier(orgId, "free", "rejected");
    try {
      const { rows } = await exec.query(
        `SELECT public.loyalty_request_enrollment($1, 'Public Three', '+256788000003', null, true) AS result`,
        [TOKEN],
      );
      const r = rpcJson(rows[0]);
      expect(r.ok).toBe(false);
      expect(r.error).toBe("unavailable");
      expect(await requestCount("+256788000003")).toBe(0);
    } finally {
      // Restore before the next test regardless of the outcome above.
      await setTier(orgId, "free", "active");
    }
  });

  it("a full allowance does not block queueing — the gate is at approval", async () => {
    const shop = await newShop(f.orgId, "Full Queue Shop");
    await seedMembers(shop, 50);
    await exec.query(
      `INSERT INTO public.loyalty_programs (shop_id, enabled) VALUES ($1, true)`,
      [shop],
    );
    await exec.query(
      `INSERT INTO public.loyalty_enrollment_links (shop_id, token, status) VALUES ($1, $2, 'active')`,
      [shop, "b".repeat(64)],
    );
    const { rows } = await exec.query(
      `SELECT public.loyalty_request_enrollment($1, 'Queued At Cap', '+256788000004', null, true) AS result`,
      ["b".repeat(64)],
    );
    expect(rpcJson(rows[0]).status).toBe("pending");
    // Still exactly 50 members: queueing never creates one.
    expect(await activeCount(shop)).toBe(50);
  });
});

describe("a full allowance never damages a financial sale", () => {
  beforeAll(async () => {
    await exec.query(
      `INSERT INTO public.loyalty_programs (shop_id, enabled) VALUES ($1, true)`,
      [awardShop],
    );
    await seedMembers(awardShop, 50);
    expect(await activeCount(awardShop)).toBe(50);
  }, T);

  it("a completed sale for a NON-member returns a clean reason instead of throwing", async () => {
    const customer = await addCustomer(awardShop, "New At Cap");
    const saleId = crypto.randomUUID();
    // Inserting the completed sale fires trg_loyalty_sales_status → loyalty_award_for_sale.
    await exec.query(
      `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, total_ugx, completed_at)
       VALUES ($1, $2, $3, 'completed', 'paid', 50000, now())`,
      [saleId, awardShop, customer],
    );

    // The sale row is untouched and still completed.
    const { rows: saleRows } = await exec.query<{ status: string }>(
      `SELECT status FROM public.sales WHERE id = $1`,
      [saleId],
    );
    expect(saleRows[0].status).toBe("completed");

    // No account was created and no points were awarded.
    const { rows: acctRows } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
      [awardShop, customer],
    );
    expect(Number(acctRows[0].n)).toBe(0);
    expect(await activeCount(awardShop)).toBe(50);

    // And the award function reports the reason rather than raising.
    const { rows: awardRows } = await exec.query(
      `SELECT public.loyalty_award_for_sale($1) AS result`,
      [saleId],
    );
    const award = rpcJson(awardRows[0]);
    expect(award.ok).toBe(true);
    expect(award.awarded).toBe(false);
    expect(award.reason).toBe("loyalty_limit_reached");
  });

  it("the limit never blocks awarding an EXISTING member", async () => {
    const { rows: memberRows } = await exec.query<{ customer_id: string }>(
      `SELECT customer_id FROM public.loyalty_accounts WHERE shop_id = $1 LIMIT 1`,
      [awardShop],
    );
    const saleId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, total_ugx, completed_at)
       VALUES ($1, $2, $3, 'completed', 'paid', 50000, now())`,
      [saleId, awardShop, memberRows[0].customer_id],
    );

    // The sale insert already awarded via trg_loyalty_sales_status, so assert the
    // ledger row exists rather than calling award twice (a second call is correctly
    // idempotent and reports `already_awarded`).
    const { rows } = await exec.query<{ kind: string; points: number }>(
      `SELECT kind, points FROM public.loyalty_transactions
        WHERE shop_id = $1 AND source_sale_id = $2`,
      [awardShop, saleId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("earned");
    expect(Number(rows[0].points)).toBeGreaterThan(0);
    expect(await activeCount(awardShop)).toBe(50);
  });

  it("a sale for a customer with no loyalty program still completes", async () => {
    const shopNoProgram = await newShop(f.orgId, "No Program Shop");
    const customer = await addCustomer(shopNoProgram, "No Program Customer");
    const saleId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, total_ugx, completed_at)
       VALUES ($1, $2, $3, 'completed', 'paid', 10000, now())`,
      [saleId, shopNoProgram, customer],
    );
    const { rows } = await exec.query<{ status: string }>(
      `SELECT status FROM public.sales WHERE id = $1`,
      [saleId],
    );
    expect(rows[0].status).toBe("completed");
  });
});

describe("usage reporting", () => {
  it("reports allowance, usage and remaining in one authoritative call", async () => {
    const shop = await newShop(f.orgId, "Usage Shop");
    await seedMembers(shop, 50);
    const { rows } = await exec.query(`SELECT public.shop_loyalty_usage($1) AS result`, [shop]);
    const usage = rpcJson(rows[0]);
    expect(usage.ok).toBe(true);
    expect(usage.loyalty_enabled).toBe(true);
    expect(usage.tier_code).toBe("free");
    expect(Number(usage.member_limit)).toBe(50);
    expect(Number(usage.active_members)).toBe(await activeCount(shop));
    expect(usage.at_limit).toBe(true);
    expect(Number(usage.remaining)).toBe(0);
  });

  it("reports remaining headroom while under the allowance", async () => {
    const shop = await newShop(f.orgId, "Headroom Shop");
    await seedMembers(shop, 12);
    const { rows } = await exec.query(`SELECT public.shop_loyalty_usage($1) AS result`, [shop]);
    const usage = rpcJson(rows[0]);
    expect(Number(usage.active_members)).toBe(12);
    expect(Number(usage.remaining)).toBe(38);
    expect(usage.at_limit).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
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
 * Phase 4 — public enrollment abuse protection.
 *
 * The threat is a public, unauthenticated endpoint: without server-side limits it can be
 * used to flood a merchant's queue or to hammer one phone number through a rejection
 * loop. Every rule here is enforced in the database, keyed on shop + normalised phone
 * (never IP — mobile/NAT traffic makes an IP meaningless for a per-customer decision),
 * and nothing trusts a client timer or counter.
 *
 * NOTE on concurrency: PGlite (the default harness) is a single connection, so two truly
 * simultaneous submissions cannot execute. The duplicate guarantee is a partial unique
 * index, and the test below proves the index rejects a second pending row for the same
 * shop+phone — which is exactly what serialises the concurrent case.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

/** Cheap queue cap so the backlog rule is testable without seeding 50 rows. */
const QUEUE_LIMIT = 3;
const COOLDOWN_DAYS = 3;

async function newShop(label: string, withLink = true): Promise<{ shopId: string; token: string }> {
  const shopId = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.shops (id, organization_id, name, shop_number) VALUES ($1,$2,$3,$4)`,
    [shopId, f.orgId, label, label.slice(0, 8).toUpperCase()],
  );
  await exec.query(`INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ($1,$2,'owner')`, [
    shopId,
    f.ownerAId,
  ]);
  await exec.query(
    `INSERT INTO public.loyalty_programs (shop_id, enabled, earn_unit_ugx, earn_points_per_unit)
     VALUES ($1, true, 1000, 1)`,
    [shopId],
  );
  const token = Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  if (withLink) {
    await exec.query(
      `INSERT INTO public.loyalty_enrollment_links (shop_id, token, status) VALUES ($1,$2,'active')`,
      [shopId, token],
    );
  }
  return { shopId, token };
}

async function request(token: string, name: string, phone: string) {
  const { rows } = await exec.query(
    `SELECT public.loyalty_request_enrollment($1,$2,$3,null,true) AS result`,
    [token, name, phone],
  );
  return rpcJson(rows[0]);
}

async function rowsFor(shopId: string, phone: string) {
  const { rows } = await exec.query<{ id: string; status: string; reviewed_at: string | null }>(
    `SELECT id, status, reviewed_at FROM public.loyalty_enrollment_requests
      WHERE shop_id = $1 AND phone_e164 = $2 ORDER BY requested_at`,
    [shopId, phone],
  );
  return rows;
}

async function activeCount(shopId: string): Promise<number> {
  const { rows } = await exec.query<{ n: number }>(
    `SELECT public.count_shop_active_loyalty_members($1) AS n`,
    [shopId],
  );
  return Number(rows[0].n);
}

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  // Configurable thresholds, proving the values are data rather than code.
  await exec.query(
    `INSERT INTO public.platform_settings (key, value) VALUES ('loyalty_enrollment_settings', $1)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify({ cooldown_days: COOLDOWN_DAYS, pending_queue_limit: QUEUE_LIMIT, pending_expiry_days: 30 })],
  );
}, T);

afterAll(async () => {
  await exec.close();
});

describe("thresholds are server-side configuration", () => {
  it("reads the configured values, with defaults when unset", async () => {
    const { rows } = await exec.query<{ s: Record<string, unknown> }>(
      `SELECT public.loyalty_enrollment_settings() AS s`,
    );
    expect(Number(rows[0].s.cooldown_days)).toBe(COOLDOWN_DAYS);
    expect(Number(rows[0].s.pending_queue_limit)).toBe(QUEUE_LIMIT);
  });

  it("the settings function is not client-callable", async () => {
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(`SELECT public.loyalty_enrollment_settings()`);
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("duplicate protection", () => {
  it("a duplicate pending submission is idempotent", async () => {
    const { shopId, token } = await newShop("Dup Shop");
    const first = await request(token, "Ada", "+256783000001");
    expect(first.status).toBe("pending");
    expect(first.already_requested).toBeUndefined();

    const second = await request(token, "Ada", "+256783000001");
    expect(second.status).toBe("pending");
    expect(second.already_requested).toBe(true);
    expect(await rowsFor(shopId, "+256783000001")).toHaveLength(1);
  });

  it("the database itself refuses a second pending row for the same shop+phone", async () => {
    // This is what makes the concurrent case safe: whichever insert loses gets a
    // unique violation, and the RPC turns that into the idempotent pending response.
    const { shopId } = await newShop("Dup Index Shop");
    await exec.query(
      `INSERT INTO public.loyalty_enrollment_requests (shop_id, name, phone_e164)
       VALUES ($1,'First','+256783000002')`,
      [shopId],
    );
    await expect(
      exec.query(
        `INSERT INTO public.loyalty_enrollment_requests (shop_id, name, phone_e164)
         VALUES ($1,'Second','+256783000002')`,
        [shopId],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("the same phone in a different shop is a different identity", async () => {
    const a = await newShop("Cross A");
    const b = await newShop("Cross B");
    const phone = "+256783000003";
    expect((await request(a.token, "Ada", phone)).status).toBe("pending");
    expect((await request(b.token, "Ada", phone)).status).toBe("pending");
    expect(await rowsFor(a.shopId, phone)).toHaveLength(1);
    expect(await rowsFor(b.shopId, phone)).toHaveLength(1);
  });
});

describe("cooldown after rejection or expiry", () => {
  it("a rejected request blocks an immediate retry", async () => {
    const { shopId, token } = await newShop("Cooldown Shop");
    const phone = "+256783000010";
    await request(token, "Ben", phone);
    const [row] = await rowsFor(shopId, phone);
    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_review_enrollment_request($1,$2,'reject','no')`, [
        shopId,
        row!.id,
      ]);
    });

    const retry = await request(token, "Ben", phone);
    expect(retry.ok).toBe(false);
    expect(retry.error).toBe("loyalty_enrollment_cooldown");
    // Nothing new was queued.
    expect(await rowsFor(shopId, phone)).toHaveLength(1);
  });

  it("an expired request also starts the cooldown", async () => {
    const { shopId, token } = await newShop("Cooldown Expired Shop");
    const phone = "+256783000011";
    await request(token, "Cara", phone);
    const [row] = await rowsFor(shopId, phone);
    await exec.query(`UPDATE public.loyalty_enrollment_requests SET status='expired', reviewed_at=now() WHERE id=$1`, [
      row!.id,
    ]);

    const retry = await request(token, "Cara", phone);
    expect(retry.error).toBe("loyalty_enrollment_cooldown");
  });

  it("after the cooldown window a legitimate request succeeds", async () => {
    const { shopId, token } = await newShop("Cooldown Elapsed Shop");
    const phone = "+256783000012";
    await request(token, "Dan", phone);
    const [row] = await rowsFor(shopId, phone);
    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_review_enrollment_request($1,$2,'reject','no')`, [
        shopId,
        row!.id,
      ]);
    });
    // Age the decision beyond the configured window.
    await exec.query(
      `UPDATE public.loyalty_enrollment_requests SET reviewed_at = now() - make_interval(days => $2) WHERE id = $1`,
      [row!.id, COOLDOWN_DAYS + 1],
    );

    const retry = await request(token, "Dan", phone);
    expect(retry.ok).toBe(true);
    expect(retry.status).toBe("pending");
    expect(await rowsFor(shopId, phone)).toHaveLength(2);
  });

  it("a rejection is not a permanent ban", async () => {
    const { shopId, token } = await newShop("Not Banned Shop");
    const phone = "+256783000013";
    await request(token, "Eve", phone);
    const [row] = await rowsFor(shopId, phone);
    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_review_enrollment_request($1,$2,'reject','no')`, [
        shopId,
        row!.id,
      ]);
    });
    await exec.query(
      `UPDATE public.loyalty_enrollment_requests SET reviewed_at = now() - interval '30 days' WHERE id = $1`,
      [row!.id],
    );
    expect((await request(token, "Eve", phone)).ok).toBe(true);
  });
});

describe("bounded pending queue", () => {
  it("refuses a request once the queue is full, creating nothing", async () => {
    const { shopId, token } = await newShop("Queue Shop");
    for (let i = 0; i < QUEUE_LIMIT; i += 1) {
      const r = await request(token, `P${i}`, `+2567830010${i}0`);
      expect(r.ok).toBe(true);
    }

    const limited = await request(token, "Overflow", "+256783001099");
    expect(limited.ok).toBe(false);
    expect(limited.error).toBe("loyalty_request_queue_full");

    const { rows } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_enrollment_requests WHERE shop_id = $1`,
      [shopId],
    );
    expect(Number(rows[0].n)).toBe(QUEUE_LIMIT);
    // Nothing else was created either.
    expect(await activeCount(shopId)).toBe(0);
    const { rows: cust } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.customers WHERE shop_id = $1`,
      [shopId],
    );
    expect(Number(cust[0].n)).toBe(0);
  });

  it("freeing a slot lets the next request in", async () => {
    const { shopId, token } = await newShop("Queue Free Shop");
    const ids: string[] = [];
    for (let i = 0; i < QUEUE_LIMIT; i += 1) {
      await request(token, `Q${i}`, `+2567830020${i}0`);
    }
    const listed = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_list_enrollment_requests($1,'pending',100) AS result`,
        [shopId],
      );
      return rpcJson(rows[0]);
    });
    for (const r of listed.requests as Array<{ id: string }>) ids.push(r.id);

    await asUser(exec, f.ownerAId, async () => {
      await exec.query(`SELECT public.loyalty_review_enrollment_request($1,$2,'reject','freed')`, [
        shopId,
        ids[0],
      ]);
    });

    const next = await request(token, "After Free", "+256783002099");
    expect(next.ok).toBe(true);
  });

  it("the queue limit is independent of the member allowance", async () => {
    const { shopId } = await newShop("Queue Vs Members Shop");
    // A full queue of 3 leaves the 50-member allowance untouched.
    const usage = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(`SELECT public.shop_loyalty_usage($1) AS result`, [shopId]);
      return rpcJson(rows[0]);
    });
    expect(Number(usage.member_limit)).toBe(50);
    expect(Number(usage.active_members)).toBe(0);
    expect(Number(usage.pending_queue_limit)).toBe(QUEUE_LIMIT);
  });
});

describe("pending and expired requests never consume the member allowance", () => {
  it("a pending request leaves the active-member count at zero", async () => {
    const { shopId, token } = await newShop("Pending Count Shop");
    await request(token, "Fay", "+256783003001");
    expect(await activeCount(shopId)).toBe(0);
  });

  it("an expired request leaves the active-member count at zero", async () => {
    const { shopId, token } = await newShop("Expired Count Shop");
    await request(token, "Gil", "+256783003002");
    const [row] = await rowsFor(shopId, "+256783003002");
    await exec.query(
      `UPDATE public.loyalty_enrollment_requests SET status='expired', reviewed_at=now() WHERE id=$1`,
      [row!.id],
    );
    expect(await activeCount(shopId)).toBe(0);
  });
});

describe("stale pending requests expire", () => {
  it("the sweep settles an overdue pending request", async () => {
    const { shopId, token } = await newShop("Sweep Shop");
    await request(token, "Hana", "+256783004001");
    const [row] = await rowsFor(shopId, "+256783004001");
    await exec.query(
      `UPDATE public.loyalty_enrollment_requests SET requested_at = now() - interval '40 days' WHERE id = $1`,
      [row!.id],
    );

    const { rows } = await exec.query<{ n: number }>(
      `SELECT public.loyalty_expire_stale_enrollment_requests($1) AS n`,
      [shopId],
    );
    expect(Number(rows[0].n)).toBe(1);

    const after = await rowsFor(shopId, "+256783004001");
    expect(after[0]!.status).toBe("expired");
    expect(after[0]!.reviewed_at).toBeTruthy();
  });

  it("an expired request stays in history and leaves the pending queue", async () => {
    const { shopId, token } = await newShop("Sweep History Shop");
    await request(token, "Ivy", "+256783004002");
    const [row] = await rowsFor(shopId, "+256783004002");
    // Age only requested_at: a pending row must keep reviewed_at null (shape constraint),
    // and the sweep is what stamps the settlement time.
    await exec.query(
      `UPDATE public.loyalty_enrollment_requests SET requested_at = now() - interval '40 days' WHERE id = $1`,
      [row!.id],
    );
    await exec.query(`SELECT public.loyalty_expire_stale_enrollment_requests($1)`, [shopId]);

    // Still there, as history.
    expect(await rowsFor(shopId, "+256783004002")).toHaveLength(1);
    // And no longer occupying a queue slot.
    const listed = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_list_enrollment_requests($1,'pending',100) AS result`,
        [shopId],
      );
      return rpcJson(rows[0]);
    });
    expect((listed.requests as unknown[]).length).toBe(0);
    const expired = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_list_enrollment_requests($1,'expired',100) AS result`,
        [shopId],
      );
      return rpcJson(rows[0]);
    });
    expect((expired.requests as unknown[]).length).toBe(1);
  });

  it("submitting a new request sweeps stale ones inline, with no cron involved", async () => {
    const { shopId, token } = await newShop("Inline Sweep Shop");
    await request(token, "Jo", "+256783004003");
    const [row] = await rowsFor(shopId, "+256783004003");
    await exec.query(
      `UPDATE public.loyalty_enrollment_requests SET requested_at = now() - interval '40 days' WHERE id = $1`,
      [row!.id],
    );
    // A fresh submit from a different phone triggers the sweep.
    await request(token, "Kay", "+256783004004");
    expect((await rowsFor(shopId, "+256783004003"))[0]!.status).toBe("expired");
  });
});

describe("request state machine", () => {
  it("refuses settling a request twice", async () => {
    const { shopId, token } = await newShop("Transition Shop");
    await request(token, "Lee", "+256783005001");
    const [row] = await rowsFor(shopId, "+256783005001");
    const first = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_review_enrollment_request($1,$2,'reject','no') AS result`,
        [shopId, row!.id],
      );
      return rpcJson(rows[0]);
    });
    expect(first.ok).toBe(true);

    // rejected -> approved must be impossible, from the RPC and from raw SQL alike.
    const viaRpc = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_review_enrollment_request($1,$2,'approve',null) AS result`,
        [shopId, row!.id],
      );
      return rpcJson(rows[0]);
    });
    expect(viaRpc.ok).toBe(false);
    expect(viaRpc.error).toBe("already_reviewed");

    await expect(
      exec.query(`UPDATE public.loyalty_enrollment_requests SET status='approved' WHERE id=$1`, [row!.id]),
    ).rejects.toThrow(/loyalty_request_already_settled|loyalty_enrollment_requests_review_shape/);
    expect((await rowsFor(shopId, "+256783005001"))[0]!.status).toBe("rejected");
  });
});

describe("member status filter is applied by the server", () => {
  async function seedMixed(shopId: string) {
    // 1 active, 1 suspended, 1 revoked, 1 expired
    await exec.query(
      `INSERT INTO public.customers (shop_id, name) VALUES
        ($1,'Aaron Active'),($1,'Bella Suspended'),($1,'Chris Revoked'),($1,'Dora Expired')`,
      [shopId],
    );
    await exec.query(
      `INSERT INTO public.loyalty_accounts (shop_id, customer_id)
       SELECT $1, c.id FROM public.customers c WHERE c.shop_id = $1 ORDER BY c.name`,
      [shopId],
    );
    await exec.query(
      `UPDATE public.loyalty_accounts a SET status = 'suspended'
        WHERE a.shop_id = $1 AND a.customer_id = (SELECT id FROM public.customers WHERE shop_id = $1 AND name = 'Bella Suspended')`,
      [shopId],
    );
    await exec.query(
      `UPDATE public.loyalty_accounts a SET status = 'revoked', revoked_at = now(), purge_after = now() + interval '30 days'
        WHERE a.shop_id = $1 AND a.customer_id = (SELECT id FROM public.customers WHERE shop_id = $1 AND name = 'Chris Revoked')`,
      [shopId],
    );
    await exec.query(
      `UPDATE public.loyalty_accounts a SET membership_expires_at = now() - interval '1 day'
        WHERE a.shop_id = $1 AND a.customer_id = (SELECT id FROM public.customers WHERE shop_id = $1 AND name = 'Dora Expired')`,
      [shopId],
    );
  }

  async function names(shopId: string, status: string): Promise<string[]> {
    const out = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_search_accounts($1, null, $2, 50) AS result`,
        [shopId, status],
      );
      return rpcJson(rows[0]);
    });
    expect(out.ok).toBe(true);
    return (out.accounts as Array<{ customer_name: string }>).map((a) => a.customer_name);
  }

  it("returns only the requested status, before the LIMIT", async () => {
    const { shopId } = await newShop("Filter Shop", false);
    await seedMixed(shopId);

    expect(await names(shopId, "all")).toHaveLength(4);
    expect(await names(shopId, "active")).toEqual(["Aaron Active"]);
    expect(await names(shopId, "suspended")).toEqual(["Bella Suspended"]);
    expect(await names(shopId, "revoked")).toEqual(["Chris Revoked"]);
    // 'expired' is the computed state, applied server-side.
    expect(await names(shopId, "expired")).toEqual(["Dora Expired"]);
  });

  it("an unknown filter is refused rather than ignored", async () => {
    const { shopId } = await newShop("Bad Filter Shop", false);
    await seedMixed(shopId);
    const out = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_search_accounts($1, null, 'nonsense', 50) AS result`,
        [shopId],
      );
      return rpcJson(rows[0]);
    });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("invalid_status");
  });

  it("the result stays bounded and deterministically ordered", async () => {
    const { shopId } = await newShop("Bounded Shop", false);
    await seedMixed(shopId);
    const out = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_search_accounts($1, null, 'all', 2) AS result`,
        [shopId],
      );
      return rpcJson(rows[0]);
    });
    const got = (out.accounts as Array<{ customer_name: string }>).map((a) => a.customer_name);
    expect(got).toHaveLength(2);
    // Same call twice → same page.
    expect(got).toEqual(["Aaron Active", "Bella Suspended"]);
  });
});

describe("existing protections are intact", () => {
  it("public IP/token rate limiting is still wired at both layers", async () => {
    // DB: the durable bucket scopes the Edge layer depends on still exist and remain
    // service-role only.
    const { rows } = await exec.query<{ def: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'edge_rate_limit_buckets' AND c.contype = 'c'`,
    );
    const defs = rows.map((r) => r.def).join(" ");
    expect(defs).toContain("enroll_join");
    expect(defs).toContain("enroll_submit");

    // Edge: the enrollment endpoint still rate-limits before it touches the database.
    const src = readFileSync(
      join(process.cwd(), "supabase/functions/loyalty-public-enroll/index.ts"),
      "utf8",
    );
    expect(src).toMatch(/enforceEnrollSubmitRateLimit/);
    expect(src).toMatch(/enforceEnrollJoinRateLimit/);
    expect(src).toMatch(/loyalty_request_enrollment/);
  });

  it("the browser still cannot write the request table or loyalty_accounts", async () => {
    const { shopId } = await newShop("Write Denied Shop", false);
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(
          `INSERT INTO public.loyalty_enrollment_requests (shop_id, name, phone_e164)
           VALUES ($1,'Self','+256783006001')`,
          [shopId],
        );
      }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(`INSERT INTO public.loyalty_accounts (shop_id, customer_id) VALUES ($1,$2)`, [
          shopId,
          f.customerAId,
        ]);
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("a cashier cannot review requests", async () => {
    const { shopId, token } = await newShop("Cashier Review Shop");
    await exec.query(`INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ($1,$2,'cashier')`, [
      shopId,
      f.cashierAId,
    ]);
    await request(token, "Moe", "+256783006002");
    const [row] = await rowsFor(shopId, "+256783006002");
    const out = await asUser(exec, f.cashierAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_review_enrollment_request($1,$2,'approve',null) AS result`,
        [shopId, row!.id],
      );
      return rpcJson(rows[0]);
    });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("forbidden");
  });

  it("approval still re-checks the member allowance at transaction time", async () => {
    const { shopId, token } = await newShop("Approval Limit Shop");
    await exec.query(
      `INSERT INTO public.customers (shop_id, name) SELECT $1, 'M' || g FROM generate_series(1,50) g`,
      [shopId],
    );
    await exec.query(
      `INSERT INTO public.loyalty_accounts (shop_id, customer_id)
       SELECT $1, c.id FROM public.customers c
        WHERE c.shop_id = $1 AND NOT EXISTS (SELECT 1 FROM public.loyalty_accounts a WHERE a.customer_id = c.id)`,
      [shopId],
    );
    expect(await activeCount(shopId)).toBe(50);

    await request(token, "Nia", "+256783006003");
    const [row] = await rowsFor(shopId, "+256783006003");
    const out = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_review_enrollment_request($1,$2,'approve',null) AS result`,
        [shopId, row!.id],
      );
      return rpcJson(rows[0]);
    });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("loyalty_member_limit_reached");
    expect(out.request_status).toBe("pending");
    expect(await activeCount(shopId)).toBe(50);
  });

  it("a pending request creates no points, no card and no Wallet row", async () => {
    const { shopId, token } = await newShop("No Side Effects Shop");
    await request(token, "Ola", "+256783006004");
    const { rows } = await exec.query<{ tx: number; outbox: number }>(
      `SELECT (SELECT count(*)::int FROM public.loyalty_transactions WHERE shop_id = $1) AS tx,
              (SELECT count(*)::int FROM public.loyalty_wallet_sync_outbox WHERE shop_id = $1) AS outbox`,
      [shopId],
    );
    expect(Number(rows[0].tx)).toBe(0);
    expect(Number(rows[0].outbox)).toBe(0);
  });

  it("existing members still earn on a completed sale", async () => {
    const { shopId } = await newShop("Earning Shop");
    await exec.query(`INSERT INTO public.customers (shop_id, name) VALUES ($1,'Earner')`, [shopId]);
    await exec.query(
      `INSERT INTO public.loyalty_accounts (shop_id, customer_id)
       SELECT $1, c.id FROM public.customers c WHERE c.shop_id = $1`,
      [shopId],
    );
    const { rows: account } = await exec.query<{ customer_id: string }>(
      `SELECT customer_id FROM public.loyalty_accounts WHERE shop_id = $1`,
      [shopId],
    );
    const saleId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, total_ugx, completed_at)
       VALUES ($1,$2,$3,'completed','paid',50000, now())`,
      [saleId, shopId, account[0].customer_id],
    );
    const { rows: tx } = await exec.query<{ kind: string; points: number }>(
      `SELECT kind, points FROM public.loyalty_transactions WHERE shop_id = $1`,
      [shopId],
    );
    expect(tx).toHaveLength(1);
    expect(tx[0].kind).toBe("earned");
    expect(Number(tx[0].points)).toBeGreaterThan(0);
  });
});

/**
 * Regression: 20260926094000 used to locate the status CHECK with a pattern match on
 * pg_get_constraintdef (`ilike '%status%' and ilike '%pending%'`), which ALSO matches
 * loyalty_enrollment_requests_review_shape. With no ORDER BY, `select ... into` picked an
 * arbitrary row: on Postgres 17.6 it chose review_shape, dropped that instead, and the
 * re-add then collided with the surviving status check (SQLSTATE 42710) — the migration
 * failed outright. PGlite happened to return the other row, so every suite passed while
 * production could not apply it. The guard now matches by exact name, so these assertions
 * pin the outcome that the pattern match only reached by luck.
 */
describe("regression: widening the status CHECK leaves review_shape intact (094000)", () => {
  async function constraints(): Promise<Record<string, string>> {
    const { rows } = await exec.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef (oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'public.loyalty_enrollment_requests'::regclass
          AND conname IN ('loyalty_enrollment_requests_status_check',
                          'loyalty_enrollment_requests_review_shape')`,
    );
    return Object.fromEntries(rows.map((r) => [r.conname, r.def]));
  }

  it("keeps BOTH constraints, widened to admit expired", async () => {
    const c = await constraints();

    // The bug dropped review_shape and lost the status check. Both must survive.
    expect(Object.keys(c).sort()).toEqual([
      "loyalty_enrollment_requests_review_shape",
      "loyalty_enrollment_requests_status_check",
    ]);

    // status CHECK widened to admit 'expired', with the pre-existing values kept.
    for (const s of ["pending", "approved", "rejected", "expired"]) {
      expect(c.loyalty_enrollment_requests_status_check, s).toContain(s);
    }

    // review_shape must be 094000's re-shaped version. The 091000 original has only
    // three branches and never mentions 'expired', so this also proves the constraint
    // was replaced rather than left stale.
    expect(c.loyalty_enrollment_requests_review_shape).toContain("expired");
  });

  it("accepts a system-settled expired row and still rejects an unknown status", async () => {
    const shop = await newShop("Status Constraint Shop");

    // 'expired' is system-settled: reviewed_at set, no reviewer, no account.
    await exec.query(
      `INSERT INTO public.loyalty_enrollment_requests (shop_id, phone_e164, name, status, reviewed_at)
       VALUES ($1, '+256700900001', 'Expired Tester', 'expired', now())`,
      [shop.shopId],
    );
    const { rows } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_enrollment_requests
        WHERE shop_id = $1 AND status = 'expired'`,
      [shop.shopId],
    );
    expect(Number(rows[0]!.n)).toBe(1);

    // A status outside the widened set is still refused.
    let rejected = false;
    try {
      await exec.query(
        `INSERT INTO public.loyalty_enrollment_requests (shop_id, phone_e164, name, status)
         VALUES ($1, '+256700900002', 'Bogus Status', 'bogus')`,
        [shop.shopId],
      );
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});

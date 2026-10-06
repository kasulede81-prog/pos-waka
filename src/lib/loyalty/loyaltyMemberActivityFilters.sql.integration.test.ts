import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  createLoyaltySqlHarness,
  enableProgram,
  insertCompletedSale,
  rpcJson,
  seedLoyaltyFixture,
  type LoyaltyFixture,
  type SqlExec,
} from "../../test/sqlIntegration/loyaltyPgHarness";

/**
 * CUSTOMER LOYALTY PHASE C — activity-center filters.
 *
 * Pins the four optional parameters added to `loyalty_member_activity` (date window,
 * own-shop, kind) against the ONE property that must never regress: every filtered
 * read is still resolved from auth.uid() alone through the caller's OWN active links.
 * A filter may narrow rows the member already owns; it can never widen them.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

async function makeMember(phone: string, name = "Filter Member"): Promise<{ userId: string; memberId: string }> {
  const userId = crypto.randomUUID();
  await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
    userId,
    `${userId.slice(0, 8)}@phasec.test`,
  ]);
  const r = await asUser(exec, userId, async () =>
    exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, [name, phone]),
  );
  return { userId, memberId: String(rpcJson(r.rows[0]).member_id ?? "") };
}

async function newCustomer(): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, $3)`, [
    id,
    f.shopAId,
    "Phase C Customer",
  ]);
  return id;
}

async function accountFor(shopId: string, customerId: string): Promise<string> {
  const r = await exec.query<{ id: string }>(
    `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
    [shopId, customerId],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("no loyalty account for customer");
  return id;
}

async function link(memberId: string, shopId: string, accountId: string): Promise<void> {
  await exec.query(
    `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source, status)
     VALUES ($1, $2, $3, 'merchant_confirmed', 'active')`,
    [memberId, accountId, shopId],
  );
}

type ActivityArgs = {
  limit?: number;
  before?: string | null;
  beforeId?: string | null;
  from?: string | null;
  to?: string | null;
  shopId?: string | null;
  kind?: string | null;
};

/** All seven parameters positionally — omitted values fall back to their defaults. */
const activity = async (userId: string, args: ActivityArgs = {}) => {
  const r = await asUser(exec, userId, async () =>
    exec.query(`SELECT public.loyalty_member_activity($1, $2, $3, $4, $5, $6, $7) AS result`, [
      args.limit ?? 20,
      args.before ?? null,
      args.beforeId ?? null,
      args.from ?? null,
      args.to ?? null,
      args.shopId ?? null,
      args.kind ?? null,
    ]),
  );
  return rpcJson(r.rows[0]) as {
    ok: boolean;
    items: Array<{ id: string; kind: string; shop: { id: string } }>;
    has_more: boolean;
    next_before: string | null;
    next_before_id: string | null;
    meta: { projection_version: number };
  };
};

/** A member linked to shop A with `sales` completed rows of earning history. */
async function seedMemberWithSales(sales: number): Promise<{ userId: string; memberId: string }> {
  const member = await makeMember(`+2567${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`);
  const customerId = await newCustomer();
  for (let i = 0; i < sales; i++) {
    await insertCompletedSale(exec, f, { totalUgx: 10_000 * (i + 1), customerId });
  }
  await link(member.memberId, f.shopAId, await accountFor(f.shopAId, customerId));
  return member;
}

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId);
  await enableProgram(exec, f.shopBId);
}, T);

afterAll(async () => {
  await exec?.close();
});

describe("1. own-shop filter", () => {
  it("returns rows for a shop the member is linked to and none for a shop they are not", async () => {
    const { userId } = await seedMemberWithSales(1);

    const linked = await activity(userId, { shopId: f.shopAId });
    expect(linked.ok).toBe(true);
    expect(linked.items.length).toBeGreaterThanOrEqual(1);

    const unlinked = await activity(userId, { shopId: f.shopBId });
    expect(unlinked.ok).toBe(true);
    expect(unlinked.items).toHaveLength(0);
  });
});

describe("2. date window", () => {
  it("bounds created_at without widening access", async () => {
    const { userId } = await seedMemberWithSales(1);
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();

    expect((await activity(userId, { from: past })).items.length).toBeGreaterThanOrEqual(1);
    expect((await activity(userId, { from: future })).items).toHaveLength(0);
    expect((await activity(userId, { to: past })).items).toHaveLength(0);
    expect((await activity(userId, {})).items.length).toBeGreaterThanOrEqual(1);
  });
});

describe("3. kind filter", () => {
  it("returns matching kinds, empty for absent kinds, and never errors on junk", async () => {
    const { userId } = await seedMemberWithSales(1);

    expect((await activity(userId, { kind: "earned" })).items.length).toBeGreaterThanOrEqual(1);
    expect((await activity(userId, { kind: "expired" })).items).toHaveLength(0);
    const junk = await activity(userId, { kind: "definitely_not_a_kind" });
    expect(junk.ok).toBe(true);
    expect(junk.items).toHaveLength(0);
  });
});

describe("4. keyset pagination under a filter", () => {
  it("pages strictly backwards through the filtered window", async () => {
    const { userId } = await seedMemberWithSales(3);

    const page1 = await activity(userId, { limit: 1, kind: "earned" });
    expect(page1.items).toHaveLength(1);
    expect(page1.has_more).toBe(true);
    expect(page1.next_before).not.toBeNull();

    const page2 = await activity(userId, {
      limit: 1,
      kind: "earned",
      before: page1.next_before,
      beforeId: page1.next_before_id,
    });
    expect(page2.ok).toBe(true);
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id);
  });
});

describe("5. shape and legacy calls", () => {
  it("reports projection_version 2 and keeps the positional 3-argument call working", async () => {
    const { userId } = await seedMemberWithSales(1);

    const dash = await activity(userId);
    expect(dash.meta.projection_version).toBe(2);

    // The pre-Phase-C call shape (limit, before, before_id) binds to the new
    // function through its defaults — the superseded overload was dropped.
    const r = await asUser(exec, userId, async () =>
      exec.query(`SELECT public.loyalty_member_activity($1, $2, $3) AS result`, [5, null, null]),
    );
    const legacy = rpcJson(r.rows[0]) as { ok: boolean; items: unknown[] };
    expect(legacy.ok).toBe(true);
    expect(legacy.items.length).toBeGreaterThanOrEqual(1);
  });
});

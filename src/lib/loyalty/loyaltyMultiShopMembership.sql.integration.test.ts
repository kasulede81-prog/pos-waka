import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/**
 * Phase 2A — one member, many shops.
 *
 * The defect: the enrollment-approval path created the customer and the loyalty account
 * but never a `loyalty_member_links` row, so `loyalty_member_dashboard()` (which joins
 * through that table) never showed a card obtained at a second shop. The card existed; the
 * member could not see it.
 *
 * These tests drive the REAL enrollment flow — request then approve — because the whole
 * point is that the link is created inside the merchant's approval transaction. They run
 * under the production privilege posture so the server-only nature of the link write is
 * genuinely exercised.
 *
 * Approvals go through the user who actually manages the shop: `ownerA` owns Shop A only,
 * and `outsider` owns Shop B. That is deliberate — `user_can_manage_shop` is the guard that
 * stops one merchant approving for another, and using the wrong approver here would make
 * TEST 10b and every Shop B case meaningless.
 */

const T = 120_000;
const PHONE = "+256700555111";

let exec: SqlExec;
let f: LoyaltyFixture;
let memberUserId: string;
let memberId: string;
/** Set by TEST 5b, consumed by TEST 5c. */
let ambiguousAccountId = "";
let ambiguousMember: { userId: string; memberId: string } | null = null;

/**
 * Give a shop an enrollment link and return its token (64 lowercase hex, per the CHECK).
 *
 * A shop may hold only ONE active link at a time (loyalty_enrollment_links_one_active_per_shop),
 * so the token is created once and reused — the same link is what a real shop would publish.
 */
const tokens = new Map<string, string>();
async function linkTokenFor(shopId: string): Promise<string> {
  const cached = tokens.get(shopId);
  if (cached) return cached;
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  await exec.query(
    `INSERT INTO public.loyalty_enrollment_links (shop_id, token, status, label)
     VALUES ($1, $2, 'active', 'p2a')`,
    [shopId, token],
  );
  tokens.set(shopId, token);
  return token;
}

/** Insert a pending request directly, to reach approval states the public path short-circuits. */
async function pendingRequest(
  shopId: string,
  customerId: string | null,
  phone: string,
  name = "John",
): Promise<string> {
  const { rows } = await exec.query<{ id: string }>(
    `INSERT INTO public.loyalty_enrollment_requests (shop_id, customer_id, name, phone_e164)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [shopId, customerId, name, phone],
  );
  return rows[0]!.id;
}

/** Approve a request as the user who manages that shop. */
async function approve(shopId: string, approverId: string, requestId: string): Promise<Record<string, unknown>> {
  return asUser(exec, approverId, async () => {
    const r = await exec.query(`SELECT public.loyalty_review_enrollment_request($1,$2,'approve',NULL) AS result`, [
      shopId,
      requestId,
    ]);
    return rpcJson(r.rows[0]);
  });
}

/** Full public request → merchant approval. Returns the approval result. */
async function enrollAndApprove(
  shopId: string,
  approverId: string,
  phone = PHONE,
  name = "John",
): Promise<Record<string, unknown>> {
  const token = await linkTokenFor(shopId);
  const requested = await exec.query<Record<string, unknown>>(
    `SELECT public.loyalty_request_enrollment($1,$2,$3,NULL,true) AS result`,
    [token, name, phone],
  );
  const req = rpcJson(requested.rows[0]);
  expect(req.ok, JSON.stringify(req)).toBe(true);

  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM public.loyalty_enrollment_requests WHERE shop_id = $1 AND phone_e164 = $2 AND status = 'pending' ORDER BY requested_at DESC LIMIT 1`,
    [shopId, phone],
  );
  return approve(shopId, approverId, rows[0]!.id);
}

type Link = { account_id: string; shop_id: string; link_source: string; status: string };

async function linksFor(): Promise<Link[]> {
  const { rows } = await exec.query<Link>(
    `SELECT account_id, shop_id, link_source, status FROM public.loyalty_member_links WHERE member_id = $1 ORDER BY shop_id, account_id`,
    [memberId],
  );
  return rows;
}

async function accountsAt(shopId: string): Promise<number> {
  const { rows } = await exec.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.loyalty_accounts WHERE shop_id = $1`,
    [shopId],
  );
  return Number(rows[0]!.n);
}

async function dashboard(userId: string): Promise<Record<string, unknown>> {
  return asUser(exec, userId, async () => {
    const res = await exec.query(`SELECT public.loyalty_member_dashboard() AS result`);
    return rpcJson(res.rows[0]);
  });
}

/**
 * Register a fresh member identity on a phone. Returns BOTH ids: `userId` is the auth user a
 * request must run as, `memberId` is the loyalty identity — passing one where the other is
 * expected yields `not_a_member`, not an error.
 */
async function registerMember(
  name: string,
  phone: string | null,
): Promise<{ userId: string; memberId: string }> {
  const userId = crypto.randomUUID();
  await exec.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1,$2,$3::jsonb)`, [
    userId,
    `m-${userId.slice(0, 8)}@test.local`,
    JSON.stringify({ account_kind: "member" }),
  ]);
  const r = await asUser(exec, userId, async () => {
    const res = await exec.query(`SELECT public.loyalty_member_register($1,$2) AS result`, [name, phone]);
    return rpcJson(res.rows[0]);
  });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return { userId, memberId: String(r.member_id) };
}

beforeAll(async () => {
  exec = await createLoyaltySqlHarness({ productionGrants: true });
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId);
  await enableProgram(exec, f.shopBId);

  memberUserId = crypto.randomUUID();
  await exec.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1,$2,$3::jsonb)`, [
    memberUserId,
    `john-${memberUserId.slice(0, 6)}@test.local`,
    JSON.stringify({ account_kind: "member" }),
  ]);
  const r = await asUser(exec, memberUserId, async () => {
    const res = await exec.query(`SELECT public.loyalty_member_register('John', $1) AS result`, [PHONE]);
    return rpcJson(res.rows[0]);
  });
  expect(r.ok).toBe(true);
  memberId = String(r.member_id);
}, T);

afterAll(async () => {
  await exec.close();
});

describe("Phase 2A: enrollment at a FIRST shop links the member", () => {
  it("TEST 1 — Shop A: account created, member linked, dashboard returns it", async () => {
    const approved = await enrollAndApprove(f.shopAId, f.ownerAId);
    expect(approved.ok, JSON.stringify(approved)).toBe(true);

    const links = await linksFor();
    expect(links).toHaveLength(1);
    expect(links[0]!.shop_id).toBe(f.shopAId);
    expect(links[0]!.status).toBe("active");
    expect(links[0]!.link_source).toBe("enrollment_approval");

    const dash = await dashboard(memberUserId);
    expect(dash.ok).toBe(true);
    expect((dash.accounts as unknown[]).length).toBe(1);
  });
});

describe("Phase 2A: the SAME member at a SECOND shop", () => {
  it("TEST 2 — Shop B links too, Shop A is untouched, dashboard returns BOTH", async () => {
    const before = await linksFor();
    expect(before).toHaveLength(1);

    const approved = await enrollAndApprove(f.shopBId, f.outsiderId);
    expect(approved.ok, JSON.stringify(approved)).toBe(true);

    const links = await linksFor();
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.shop_id).sort()).toEqual([f.shopAId, f.shopBId].sort());

    // The Shop A link must be unchanged by anything that happened at Shop B.
    expect(links.find((l) => l.shop_id === f.shopAId)).toEqual(before[0]);

    // And the dashboard now reaches both merchants — the actual reported bug.
    const dash = await dashboard(memberUserId);
    const accounts = dash.accounts as Array<{ shop: { id: string } }>;
    expect(accounts.length).toBe(2);
    expect(accounts.map((a) => a.shop.id).sort()).toEqual([f.shopAId, f.shopBId].sort());
    expect((dash.counts as Record<string, unknown>).linked_accounts).toBe(2);
  });
});

describe("Phase 2A: same person + same shop stays one card", () => {
  it("TEST 3 — replaying an approval for the same customer adds no account and no link", async () => {
    const accountsBefore = await accountsAt(f.shopAId);
    const linksBefore = await linksFor();

    // The public path short-circuits with `already_member`, so a stale pending request is
    // what actually reaches approval a second time at the same shop.
    const requestId = await pendingRequest(f.shopAId, null, PHONE);
    const replayed = await approve(f.shopAId, f.ownerAId, requestId);
    expect(replayed.ok, JSON.stringify(replayed)).toBe(true);
    // The customer matched by phone already holds the account.
    expect(replayed.new_membership).toBe(false);

    expect(await accountsAt(f.shopAId)).toBe(accountsBefore);
    expect(await linksFor()).toEqual(linksBefore);
  });

  it("TEST 3b — the guard is SHOP-scoped: a different account at the same shop is not linked", async () => {
    // A duplicate customer row for the same phone at Shop A — the only way a merchant can
    // reach a SECOND account at one shop. The existing resolution logic attaches the request
    // to whichever customer row it is told to; what Phase 2A must guarantee is that the member
    // still comes out of it with exactly one card at this merchant.
    const { rows } = await exec.query<{ id: string }>(
      `INSERT INTO public.customers (shop_id, name, phone_e164) VALUES ($1,'John (dup row)',$2) RETURNING id`,
      [f.shopAId, PHONE],
    );
    const secondCustomerId = rows[0]!.id;

    const requestId = await pendingRequest(f.shopAId, secondCustomerId, PHONE);
    const approved = await approve(f.shopAId, f.ownerAId, requestId);
    expect(approved.ok, JSON.stringify(approved)).toBe(true);

    // This is the assertion that separates a SHOP-scoped guard from an account-scoped one:
    // the member is already linked to a DIFFERENT account at Shop A, so nothing new is linked.
    const shopALinks = (await linksFor()).filter((l) => l.shop_id === f.shopAId);
    expect(shopALinks).toHaveLength(1);

    // The account that approval just produced carries no active member link.
    const unlinked = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_member_links WHERE account_id = $1 AND status = 'active'`,
      [String(approved.loyalty_account_id)],
    );
    expect(Number(unlinked.rows[0]!.n)).toBe(0);
  });
});

describe("Phase 2A: identity protection is preserved", () => {
  it("TEST 4 — one active member per account still holds", async () => {
    const aLink = (await linksFor()).find((l) => l.shop_id === f.shopAId)!;
    const { memberId: otherMemberId } = await registerMember("Other", "+256700555999");

    let blocked = false;
    try {
      await exec.query(
        `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source, status)
         VALUES ($1,$2,$3,'enrollment_approval','active')`,
        [otherMemberId, aLink.account_id, f.shopAId],
      );
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  });

  it("TEST 5 — an unknown phone creates the membership but NO link", async () => {
    const approved = await enrollAndApprove(f.shopBId, f.outsiderId, "+256700777333", "Stranger");
    // The merchant approval must succeed regardless — linking is additive.
    expect(approved.ok, JSON.stringify(approved)).toBe(true);

    const { rows } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_member_links WHERE account_id = $1`,
      [String(approved.loyalty_account_id)],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("TEST 5b — an AMBIGUOUS phone (two member identities) links nothing", async () => {
    // Phone is a matching hint, not a key: two active identities may share one number, and
    // an approval must never guess between them. Both identities are therefore left alone and
    // neither is preferred — the merchant approval still completes normally.
    const ambiguousPhone = "+256700888444";
    const one = await registerMember("Amb One", ambiguousPhone);
    await registerMember("Amb Two", ambiguousPhone);
    ambiguousMember = one;

    const approved = await enrollAndApprove(f.shopBId, f.outsiderId, ambiguousPhone, "Ambiguous");
    expect(approved.ok, JSON.stringify(approved)).toBe(true);
    ambiguousAccountId = String(approved.loyalty_account_id);

    const { rows } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_member_links WHERE account_id = $1`,
      [ambiguousAccountId],
    );
    expect(Number(rows[0]!.n)).toBe(0);

    // The account is unowned, so nobody's card was stolen to create it.
    const { rows: owners } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_member_links WHERE account_id = $1 AND status = 'active'`,
      [ambiguousAccountId],
    );
    expect(Number(owners[0]!.n)).toBe(0);
  });

  it("TEST 5c — ambiguity is recoverable through the explicit claim flow, not auto-linking", async () => {
    expect(ambiguousAccountId, "TEST 5b must run first").toBeTruthy();

    const acct = await exec.query<{ public_card_token: string }>(
      `SELECT public_card_token FROM public.loyalty_accounts WHERE id = $1`,
      [ambiguousAccountId],
    );

    // claim_start reports a pending request and links nothing — the ambiguity above is resolved
    // by a human, never by the phone match.
    const started = await asUser(exec, ambiguousMember!.userId, async () => {
      const res = await exec.query(`SELECT public.loyalty_member_claim_start($1,$2) AS result`, [
        f.shopBId,
        acct.rows[0]!.public_card_token,
      ]);
      return rpcJson(res.rows[0]);
    });
    expect(started.ok, JSON.stringify(started)).toBe(true);
    expect(started.status).toBe("pending");

    const before = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_member_links WHERE member_id = $1`,
      [ambiguousMember!.memberId],
    );
    expect(Number(before.rows[0]!.n)).toBe(0);

    // And the reviewer can settle it, which is the documented remedy for the ambiguous case.
    const reviewed = await asUser(exec, f.outsiderId, async () => {
      const res = await exec.query(`SELECT public.loyalty_member_claim_review($1,true,NULL) AS result`, [
        String(started.request_id),
      ]);
      return rpcJson(res.rows[0]);
    });
    expect(reviewed.ok, JSON.stringify(reviewed)).toBe(true);

    const after = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_member_links WHERE member_id = $1 AND status = 'active'`,
      [ambiguousMember!.memberId],
    );
    expect(Number(after.rows[0]!.n)).toBe(1);
  });
});

describe("Phase 2A: cross-shop isolation", () => {
  it("TEST 6 — every link points at an account belonging to the link's own shop", async () => {
    const links = await linksFor();
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      const { rows } = await exec.query<{ shop_id: string }>(
        `SELECT shop_id FROM public.loyalty_accounts WHERE id = $1`,
        [l.account_id],
      );
      expect(rows[0]!.shop_id, `link ${l.account_id}`).toBe(l.shop_id);
    }
  });

  it("TEST 6b — a cross-shop link is structurally impossible", async () => {
    const aLink = (await linksFor()).find((l) => l.shop_id === f.shopAId)!;
    // Shop B's account, claimed as if it belonged to Shop A.
    const bLink = (await linksFor()).find((l) => l.shop_id === f.shopBId)!;
    let blocked = false;
    try {
      await exec.query(
        `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source, status)
         VALUES ($1,$2,$3,'enrollment_approval','active')`,
        [memberId, bLink.account_id, f.shopAId],
      );
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
    expect(aLink.shop_id).toBe(f.shopAId);
  });
});

describe("Phase 2A: existing behaviour is untouched", () => {
  it("TEST 7 — the Phase 1 claim flow still runs start -> pending -> review -> link", async () => {
    const { userId: claimerUserId, memberId: claimerMemberId } = await registerMember(
      "Claimer",
      "+256700666222",
    );

    // Target the card the enrolled member already holds, so the one-active-per-account index
    // is what decides the outcome rather than whichever account the query happens to pick.
    const acct = await exec.query<{ id: string; public_card_token: string }>(
      `SELECT a.id, a.public_card_token
         FROM public.loyalty_accounts a
         JOIN public.loyalty_member_links l ON l.account_id = a.id
        WHERE l.member_id = $1 AND l.shop_id = $2 AND l.status = 'active'`,
      [memberId, f.shopAId],
    );
    expect(acct.rows).toHaveLength(1);

    const started = await asUser(exec, claimerUserId, async () => {
      const res = await exec.query(`SELECT public.loyalty_member_claim_start($1,$2) AS result`, [
        f.shopAId,
        acct.rows[0]!.public_card_token,
      ]);
      return rpcJson(res.rows[0]);
    });
    expect(started.ok, JSON.stringify(started)).toBe(true);
    expect(started.status).toBe("pending");

    // Still no link — Phase 1 never auto-links. (Phase 2A links only on enrollment approval.)
    const before = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_member_links WHERE member_id = $1`,
      [claimerMemberId],
    );
    expect(Number(before.rows[0]!.n)).toBe(0);

    const reviewed = await asUser(exec, f.ownerAId, async () => {
      const res = await exec.query(`SELECT public.loyalty_member_claim_review($1,true,NULL) AS result`, [
        String(started.request_id),
      ]);
      return rpcJson(res.rows[0]);
    });
    // The account is already owned by another member, so the one-active index refuses it.
    expect(reviewed.ok).toBe(false);
    expect(reviewed.error).toBe("already_claimed");
  });

  it("TEST 8 — enrollment anti-spam still refuses a duplicate pending request per shop", async () => {
    const token = await linkTokenFor(f.shopAId);
    const phone = "+256700444777";
    const first = await exec.query(`SELECT public.loyalty_request_enrollment($1,$2,$3,NULL,true) AS result`, [
      token,
      "Spam One",
      phone,
    ]);
    expect(rpcJson(first.rows[0]).ok).toBe(true);
    const second = await exec.query(`SELECT public.loyalty_request_enrollment($1,$2,$3,NULL,true) AS result`, [
      token,
      "Spam Two",
      phone,
    ]);
    const r = rpcJson(second.rows[0]);
    expect(r.status).toBe("pending");
    expect(r.already_requested).toBe(true);
  });

  it("TEST 9 — the member projection still leaks no tokens", async () => {
    const dash = await dashboard(memberUserId);
    const json = JSON.stringify(dash);
    expect(json).not.toContain("qr_token");
    expect(json).not.toContain("public_card_token");
    expect(json).not.toContain("WAKA-LOYALTY:");
  });

  it("TEST 10 — the merchant loyalty surface is unchanged", async () => {
    const overview = await asUser(exec, f.ownerAId, async () => {
      const res = await exec.query(`SELECT public.loyalty_shop_overview($1) AS result`, [f.shopAId]);
      return rpcJson(res.rows[0]);
    });
    expect(overview.ok, JSON.stringify(overview)).toBe(true);
  });

  it("TEST 10b — the approval RPC still refuses a merchant from another shop", async () => {
    const requestId = await pendingRequest(f.shopBId, null, "+256700333888", "Cross Shop");
    // ownerA manages Shop A only; approving for Shop B must be refused.
    const r = await approve(f.shopBId, f.ownerAId, requestId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
  });

  it("TEST 10c — the browser still cannot write loyalty_member_links", async () => {
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(
          `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source)
           VALUES ($1,$2,$3,'enrollment_approval')`,
          [memberId, (await linksFor())[0]!.account_id, f.shopAId],
        );
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

/**
 * The Phase 2A write path is server-side only and must stay that way. These assert the
 * posture directly against the catalogue rather than only behaviourally, because a
 * behavioural test can pass for the wrong reason — a privilege that was quietly re-granted
 * still refuses nothing until someone happens to try it as the right role.
 */
describe("Phase 2A: security posture is unchanged and server-controlled", () => {
  it("links the table with no browser privilege at all", async () => {
    const { rows } = await exec.query<Record<string, boolean>>(
      `SELECT has_table_privilege('authenticated','public.loyalty_member_links','SELECT') sel,
              has_table_privilege('authenticated','public.loyalty_member_links','INSERT') ins,
              has_table_privilege('authenticated','public.loyalty_member_links','UPDATE') upd,
              has_table_privilege('authenticated','public.loyalty_member_links','DELETE') del,
              has_table_privilege('authenticated','public.loyalty_member_links','TRUNCATE') trunc,
              has_table_privilege('authenticated','public.loyalty_member_links','REFERENCES') ref,
              has_table_privilege('authenticated','public.loyalty_member_links','TRIGGER') trg,
              has_table_privilege('anon','public.loyalty_member_links','SELECT') anon_sel,
              has_table_privilege('anon','public.loyalty_member_links','INSERT') anon_ins`,
    );
    expect(rows[0]).toEqual({
      sel: false,
      ins: false,
      upd: false,
      del: false,
      trunc: false,
      ref: false,
      trg: false,
      anon_sel: false,
      anon_ins: false,
    });
  });

  it("keeps the approval RPC staff-only: authenticated yes, anon no", async () => {
    const { rows } = await exec.query<{ auth: boolean; anon: boolean }>(
      `SELECT has_function_privilege('authenticated','public.loyalty_review_enrollment_request(uuid,uuid,text,text)','EXECUTE') auth,
              has_function_privilege('anon','public.loyalty_review_enrollment_request(uuid,uuid,text,text)','EXECUTE') anon`,
    );
    expect(rows[0]!.auth).toBe(true);
    expect(rows[0]!.anon).toBe(false);
  });

  it("keeps the RPC SECURITY DEFINER with the search_path pinned", async () => {
    const { rows } = await exec.query<{ secdef: boolean; cfg: string[] | null }>(
      `SELECT p.prosecdef AS secdef, p.proconfig AS cfg
         FROM pg_proc p
        WHERE p.oid = 'public.loyalty_review_enrollment_request(uuid,uuid,text,text)'::regprocedure`,
    );
    expect(rows[0]!.secdef).toBe(true);
    expect(rows[0]!.cfg).toEqual(["search_path=public"]);
  });

  it("widened link_source by ADDING a value, never by removing the CHECK", async () => {
    const { rows } = await exec.query<{ def: string }>(
      `SELECT pg_get_constraintdef(con.oid) AS def
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'loyalty_member_links' AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) LIKE '%link_source%'`,
    );
    // Exactly one CHECK governs the column — a leftover older CHECK would silently reject
    // 'enrollment_approval' and the insert would vanish into the fail-soft handler.
    expect(rows).toHaveLength(1);
    for (const v of ["member_claim", "merchant_confirmed", "enrollment_approval"]) {
      expect(rows[0]!.def).toContain(v);
    }
  });

  it("leaves the duplicate and cross-shop protections in place", async () => {
    const { rows } = await exec.query<{ idx: number; fk: number; rls: boolean; force: boolean; pol: number }>(
      `SELECT (SELECT count(*)::int FROM pg_indexes
                WHERE tablename='loyalty_member_links' AND indexname='loyalty_member_links_one_active_per_account') idx,
              (SELECT count(*)::int FROM pg_constraint WHERE conname='loyalty_member_links_account_shop_fk') fk,
              c.relrowsecurity rls, c.relforcerowsecurity force,
              (SELECT count(*)::int FROM pg_policies p WHERE p.tablename='loyalty_member_links') pol
         FROM pg_class c WHERE c.oid = 'public.loyalty_member_links'::regclass`,
    );
    expect(Number(rows[0]!.idx)).toBe(1);
    expect(Number(rows[0]!.fk)).toBe(1);
    expect(rows[0]!.rls).toBe(true);
    expect(rows[0]!.force).toBe(true);
    // No policy: the projection RPC is the only read path, and it runs as the owner.
    expect(Number(rows[0]!.pol)).toBe(0);
  });

  it("grants no EXECUTE to PUBLIC on the approval RPC", async () => {
    // has_function_privilege can only be asked of a role, so PUBLIC is checked the way
    // Postgres records it: an absence of an explicit PUBLIC entry in proacl.
    const { rows } = await exec.query<{ acl: string | null }>(
      `SELECT p.proacl::text AS acl FROM pg_proc p
        WHERE p.oid = 'public.loyalty_review_enrollment_request(uuid,uuid,text,text)'::regprocedure`,
    );
    const acl = rows[0]!.acl ?? "";
    // '=X/' would be the PUBLIC grantee entry.
    expect(acl).not.toMatch(/(^|,)=X\//);
    console.log("approval RPC acl:", acl);
  });

  it("returns no token material from a SUCCESSFUL approval", async () => {
    const approved = await enrollAndApprove(f.shopBId, f.outsiderId, "+256700222111", "Token Check");
    expect(approved.ok, JSON.stringify(approved)).toBe(true);
    // Byte-for-byte the deployed response shape — Phase 2A added no field, so the merchant
    // UI contract is unchanged.
    expect(Object.keys(approved).sort()).toEqual([
      "customer_id",
      "loyalty_account_id",
      "member_limit",
      "new_membership",
      "ok",
      "status",
      "tier_code",
    ]);
    const json = JSON.stringify(approved);
    expect(json).not.toContain("qr_token");
    expect(json).not.toContain("public_card_token");
    expect(json).not.toContain("WAKA-LOYALTY");
  });
});

describe("Phase 2A: cross-member isolation", () => {
  it("a different member's dashboard never returns this member's accounts", async () => {
    const { userId: strangerUserId } = await registerMember("Isolated", "+256700111222");

    // The enrolled member holds Shop A and Shop B cards.
    const mine = await dashboard(memberUserId);
    expect((mine.accounts as unknown[]).length).toBeGreaterThan(0);

    const theirs = await dashboard(strangerUserId);
    expect(theirs.ok).toBe(true);
    expect(theirs.accounts).toEqual([]);
    expect((theirs.counts as Record<string, unknown>).linked_accounts).toBe(0);

    // Not merely empty — none of the other member's shop or account identifiers appear at all.
    const json = JSON.stringify(theirs);
    expect(json).not.toContain(f.shopAId);
    expect(json).not.toContain(f.shopBId);
    for (const l of await linksFor()) {
      expect(json, `account ${l.account_id}`).not.toContain(l.account_id);
    }
  });
});

describe("Phase 2A: merchant enrollment is not gated on membership", () => {
  it("the direct counter enrollment still works with no member row involved", async () => {
    // loyalty_enroll_customer is the POS counter path. Phase 2A does not touch it, and it must
    // not start requiring a registered WAKA member — a merchant enrolls walk-in customers.
    const before = await accountsAt(f.shopAId);

    const enrolled = await asUser(exec, f.ownerAId, async () => {
      const res = await exec.query(`SELECT public.loyalty_enroll_customer($1,$2,true,NULL) AS result`, [
        f.shopAId,
        f.customerAId,
      ]);
      return rpcJson(res.rows[0]);
    });
    expect(enrolled.ok, JSON.stringify(enrolled)).toBe(true);
    expect(await accountsAt(f.shopAId)).toBe(before + 1);

    // Documents the residual gap rather than blessing it: the counter path creates an account
    // and no member link. See the Phase 2B note in the accompanying report.
    const { rows } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_member_links WHERE account_id = $1`,
      [String(enrolled.account_id)],
    );
    expect(Number(rows[0]!.n)).toBe(0);

    // Re-running is idempotent on (shop_id, customer_id) — no second counter account.
    const again = await asUser(exec, f.ownerAId, async () => {
      const res = await exec.query(`SELECT public.loyalty_enroll_customer($1,$2,true,NULL) AS result`, [
        f.shopAId,
        f.customerAId,
      ]);
      return rpcJson(res.rows[0]);
    });
    expect(again.ok).toBe(true);
    expect(again.already_enrolled).toBe(true);
    expect(await accountsAt(f.shopAId)).toBe(before + 1);
  });
});

describe("Phase 2A: the migration is safe to re-run and preserves existing rows", () => {
  const MIGRATION = join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260928110000_loyalty_multishop_member_link.sql",
  );

  it("re-running it is a no-op, and pre-existing links survive the CHECK swap", async () => {
    // A link carrying the OLD provenance vocabulary must remain valid across the change —
    // the CHECK was widened, never replaced, so nothing in production can be invalidated.
    const { rows: seed } = await exec.query<{ id: string }>(
      `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source, status)
       SELECT $1, a.id, a.shop_id, 'member_claim', 'active'
         FROM public.loyalty_accounts a
        WHERE a.shop_id = $2
          AND NOT EXISTS (SELECT 1 FROM public.loyalty_member_links l WHERE l.account_id = a.id)
        LIMIT 1
       RETURNING id`,
      [ambiguousMember!.memberId, f.shopBId],
    );
    // If Shop B has no free account left, that is itself a failure of the fixture assumptions.
    expect(seed).toHaveLength(1);

    const before = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_member_links`,
    );

    // Re-apply the migration exactly as the migration runner would.
    await exec.exec(readFileSync(MIGRATION, "utf8"));

    const after = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_member_links`,
    );
    expect(Number(after.rows[0]!.n)).toBe(Number(before.rows[0]!.n));

    // The old-vocabulary row survived, and every provenance is still accepted.
    const { rows: survived } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_member_links WHERE id = $1`,
      [seed[0]!.id],
    );
    expect(Number(survived[0]!.n)).toBe(1);

    const { rows: checks } = await exec.query<{ def: string }>(
      `SELECT pg_get_constraintdef(con.oid) AS def
         FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'loyalty_member_links' AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) LIKE '%link_source%'`,
    );
    expect(checks).toHaveLength(1);
    for (const v of ["member_claim", "merchant_confirmed", "enrollment_approval"]) {
      expect(checks[0]!.def).toContain(v);
    }

    // And the approval RPC still behaves after re-application.
    const approved = await enrollAndApprove(f.shopBId, f.outsiderId, "+256700444555", "Post Rerun");
    expect(approved.ok, JSON.stringify(approved)).toBe(true);
  });
});

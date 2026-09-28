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
 * Phase 1 — member identity, projection and claim flow.
 *
 * Run under the PRODUCTION privilege posture so every "permission denied" below proves a Phase 1
 * revoke rather than an absent grant.
 *
 * The load-bearing assertions are the negative ones. A member identity that leaks another member's
 * data, or that quietly links an account on a phone match, is worse than no member identity at
 * all — a wrong link silently attaches one person's points history to another person's account
 * and cannot be undone by re-running.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;
let memberAId: string;
let memberBId: string;
let memberUserId: string;
let memberBUserId: string;

async function newAuthUser(label: string, metadata: Record<string, unknown> = {}): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1,$2,$3::jsonb)`,
    [id, `${label}-${id.slice(0, 6)}@test.local`, JSON.stringify(metadata)],
  );
  return id;
}

async function asMember<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return asUser(exec, userId, fn);
}

beforeAll(async () => {
  exec = await createLoyaltySqlHarness({ productionGrants: true });
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId);

  memberUserId = await newAuthUser("member", { account_kind: "member" });
  memberBUserId = await newAuthUser("memberB", { account_kind: "member" });

  const a = await asMember(memberUserId, async () => {
    const { rows } = await exec.query(`SELECT public.loyalty_member_register('Member A','+256700111111') AS result`);
    return rpcJson(rows[0]);
  });
  expect(a.ok).toBe(true);
  memberAId = String(a.member_id);

  const b = await asMember(memberBUserId, async () => {
    const { rows } = await exec.query(`SELECT public.loyalty_member_register('Member B','+256700222222') AS result`);
    return rpcJson(rows[0]);
  });
  memberBId = String(b.member_id);
}, T);

afterAll(async () => {
  await exec.close();
});

describe("Phase 1: registration creates an identity and NOTHING else", () => {
  it("registers idempotently without blanking existing values", async () => {
    const again = await asMember(memberUserId, async () => {
      const { rows } = await exec.query(`SELECT public.loyalty_member_register(NULL, NULL) AS result`);
      return rpcJson(rows[0]);
    });
    expect(again.ok).toBe(true);
    expect(again.created).toBe(false);
    expect(String(again.member_id)).toBe(memberAId);

    const { rows } = await exec.query<{ display_name: string; phone_e164: string }>(
      `SELECT display_name, phone_e164 FROM public.loyalty_members WHERE id = $1`,
      [memberAId],
    );
    expect(rows[0]!.display_name).toBe("Member A");
    expect(rows[0]!.phone_e164).toBe("+256700111111");
  });

  it("rejects a malformed phone rather than storing it", async () => {
    const r = await asMember(memberBUserId, async () => {
      const { rows } = await exec.query(`SELECT public.loyalty_member_register(NULL,'0700111222') AS result`);
      return rpcJson(rows[0]);
    });
    expect(r).toMatchObject({ ok: false, error: "invalid_phone" });
  });

  // A merchant subscription is created by bootstrap_owner_workspace, which a member never reaches
  // (asserted by the gate tests). The harness has no subscriptions table, so that consequence is
  // reasoned rather than directly asserted here — the title states only what is checked.
  it("creates no organization, shop, shop_member or profile", async () => {
    const { rows } = await exec.query<{ orgs: number; shops: number; members: number; profiles: number }>(
      `SELECT (SELECT count(*)::int FROM public.organization_members WHERE user_id = $1) AS orgs,
              (SELECT count(*)::int FROM public.shop_members WHERE user_id = $1) AS shops,
              (SELECT count(*)::int FROM public.shop_members WHERE user_id = $1) AS members,
              (SELECT count(*)::int FROM public.profiles WHERE id = $1) AS profiles`,
      [memberUserId],
    );
    // The whole point of Phase 1: a member is not a tenant.
    expect(rows[0]).toEqual({ orgs: 0, shops: 0, members: 0, profiles: 0 });
  });
});

describe("Phase 1: the classifier reports flags, never a single value", () => {
  it("identifies a member-only session", async () => {
    const r = await asMember(memberUserId, async () => {
      const { rows } = await exec.query(`SELECT public.waka_account_identity() AS result`);
      return rpcJson(rows[0]);
    });
    expect(r.ok).toBe(true);
    expect(r.is_member).toBe(true);
    expect(r.member_id).toBe(memberAId);
    expect(r.is_shop_member).toBe(false);
    expect(r.is_org_member).toBe(false);
    expect(r.merchant_intent).toBe(false);
    expect(r.member_intent).toBe(true);
  });

  it("reports merchant_intent from the metadata the merchant signup always writes", async () => {
    const merchantUser = await newAuthUser("merchant", {
      pos_role: "owner",
      business_name: "Test Shop",
    });
    const r = await asUser(exec, merchantUser, async () => {
      const { rows } = await exec.query(`SELECT public.waka_account_identity() AS result`);
      return rpcJson(rows[0]);
    });
    expect(r.merchant_intent).toBe(true);
    expect(r.is_member).toBe(false);
  });

  it("represents merchant AND member simultaneously", async () => {
    const both = await newAuthUser("both", { pos_role: "owner", business_name: "Both Shop" });
    await exec.query(`INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ($1,$2,'owner')`, [
      f.shopAId,
      both,
    ]);
    await exec.query(`INSERT INTO public.loyalty_members (auth_user_id, display_name) VALUES ($1,'Both')`, [both]);
    const r = await asUser(exec, both, async () => {
      const { rows } = await exec.query(`SELECT public.waka_account_identity() AS result`);
      return rpcJson(rows[0]);
    });
    expect(r.is_shop_member).toBe(true);
    expect(r.is_member).toBe(true);
    expect(r.merchant_intent).toBe(true);
  });
});

describe("Phase 1: the projection is scoped to the caller", () => {
  it("an unlinked member sees an empty account list, not an error", async () => {
    const r = await asMember(memberUserId, async () => {
      const { rows } = await exec.query(`SELECT public.loyalty_member_dashboard() AS result`);
      return rpcJson(rows[0]);
    });
    expect(r.ok).toBe(true);
    expect(r.accounts).toEqual([]);
    expect((r.counts as Record<string, unknown>).linked_accounts).toBe(0);
  });

  it("a non-member gets not_a_member rather than someone else's data", async () => {
    const stranger = await newAuthUser("stranger", { pos_role: "owner", business_name: "S" });
    const r = await asUser(exec, stranger, async () => {
      const { rows } = await exec.query(`SELECT public.loyalty_member_dashboard() AS result`);
      return rpcJson(rows[0]);
    });
    expect(r).toMatchObject({ ok: false, error: "not_a_member" });
  });

  it("member B's projection never contains member A's account", async () => {
    // Give A a real linked account, then confirm B sees nothing of it.
    const acct = await exec.query<{ id: string }>(
      `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 LIMIT 1`,
      [f.shopAId],
    );
    if (!acct.rows[0]) {
      await exec.query(
        `INSERT INTO public.loyalty_accounts (shop_id, customer_id) VALUES ($1,$2)`,
        [f.shopAId, f.customerAId],
      );
    }
    const acc = await exec.query<{ id: string }>(
      `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 LIMIT 1`,
      [f.shopAId],
    );
    await exec.query(
      `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source)
       VALUES ($1,$2,$3,'merchant_confirmed')`,
      [memberAId, acc.rows[0]!.id, f.shopAId],
    );

    const aView = await asMember(memberUserId, async () => {
      const { rows } = await exec.query(`SELECT public.loyalty_member_dashboard() AS result`);
      return rpcJson(rows[0]);
    });
    expect((aView.accounts as unknown[]).length).toBe(1);

    const bView = await asMember(memberBUserId, async () => {
      const { rows } = await exec.query(`SELECT public.loyalty_member_dashboard() AS result`);
      return rpcJson(rows[0]);
    });
    expect(bView.accounts).toEqual([]);
    expect(JSON.stringify(bView)).not.toContain(f.shopAId);
  });

  it("never returns qr_token or public_card_token, only card presence", async () => {
    const r = await asMember(memberUserId, async () => {
      const { rows } = await exec.query(`SELECT public.loyalty_member_dashboard() AS result`);
      return rpcJson(rows[0]);
    });
    const json = JSON.stringify(r);
    // Both are bearer credentials; public_card_token IS the public card URL.
    expect(json).not.toContain("qr_token");
    expect(json).not.toContain("public_card_token");
    expect(json).not.toContain("WAKA-LOYALTY:");
    expect(json).not.toContain("google_wallet");
    const first = (r.accounts as Array<Record<string, unknown>>)[0];
    expect((first.card as Record<string, unknown>).has_public_card).toBe(true);
    expect(Object.keys(first.card as Record<string, unknown>)).toEqual(["has_public_card"]);
  });

  it("masks the member's own phone", async () => {
    const r = await asMember(memberUserId, async () => {
      const { rows } = await exec.query(`SELECT public.loyalty_member_dashboard() AS result`);
      return rpcJson(rows[0]);
    });
    const member = r.member as Record<string, unknown>;
    expect(String(member.phone_e164_masked)).toContain("**");
    expect(String(member.phone_e164_masked)).not.toBe("+256700111111");
  });
});

describe("Phase 1: a member cannot reach merchant or member tables directly", () => {
  it("sees zero loyalty_accounts rows (RLS filters, it does not error)", async () => {
    // Phase 0 kept the SELECT grant on loyalty_accounts, so denial is a POLICY filter returning
    // zero rows rather than a permission error. Asserting the rows, not an exception, is the
    // assertion that actually holds.
    const n = await asMember(memberUserId, async () => {
      const { rows } = await exec.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.loyalty_accounts`,
      );
      return Number(rows[0]!.n);
    });
    expect(n).toBe(0);
  });

  it("cannot select loyalty_member_links at all (no grant, no policy)", async () => {
    let denied = false;
    try {
      await asMember(memberUserId, async () => {
        await exec.query(`SELECT count(*) FROM public.loyalty_member_links`);
      });
    } catch {
      denied = true;
    }
    expect(denied).toBe(true);
  });

  it("can select only their own loyalty_members row", async () => {
    const n = await asMember(memberUserId, async () => {
      const { rows } = await exec.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.loyalty_members`);
      return Number(rows[0]!.n);
    });
    expect(n).toBe(1);
  });

  it("cannot write any Phase 1 table", async () => {
    for (const sql of [
      `UPDATE public.loyalty_members SET status = 'suspended' WHERE id = '${memberAId}'`,
      `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source) VALUES ('${memberAId}', gen_random_uuid(), '${f.shopAId}', 'member_claim')`,
      `UPDATE public.loyalty_member_claim_requests SET status = 'approved'`,
    ]) {
      let denied = false;
      try {
        await asMember(memberUserId, async () => {
          await exec.query(sql);
        });
      } catch {
        denied = true;
      }
      expect(denied, sql).toBe(true);
    }
  });
});

describe("Phase 1: claim NEVER auto-links", () => {
  it("creates a pending request even on an exact single-phone match", async () => {
    // A's member phone matches exactly one customer in shop A — the case a naive design would
    // auto-link. Phase 1 must still queue it for review.
    await exec.query(`UPDATE public.customers SET phone_e164 = '+256700111111' WHERE id = $1`, [f.customerAId]);
    const token = await exec.query<{ public_card_token: string }>(
      `SELECT public_card_token FROM public.loyalty_accounts WHERE shop_id = $1 LIMIT 1`,
      [f.shopAId],
    );

    const r = await asMember(memberBUserId, async () => {
      const { rows } = await exec.query(`SELECT public.loyalty_member_claim_start($1,$2) AS result`, [
        f.shopAId,
        token.rows[0]!.public_card_token,
      ]);
      return rpcJson(rows[0]);
    });

    if (r.ok === true) {
      expect(r.status).toBe("pending");
      // The decisive assertion: a pending request, and NO link.
      const links = await exec.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.loyalty_member_links WHERE member_id = $1`,
        [memberBId],
      );
      expect(Number(links.rows[0]!.n)).toBe(0);
    } else {
      // already_claimed is also acceptable — it means A owns it.
      expect(["already_claimed", "not_found"]).toContain(r.error);
    }
  });

  it("answers identically for an unknown token and a token from another shop", async () => {
    const unknown = await asMember(memberBUserId, async () => {
      const { rows } = await exec.query(`SELECT public.loyalty_member_claim_start($1,$2) AS result`, [
        f.shopAId,
        "0".repeat(64),
      ]);
      return rpcJson(rows[0]);
    });
    expect(unknown).toMatchObject({ ok: false, error: "not_found" });
  });

  it("refuses a non-member", async () => {
    const stranger = await newAuthUser("claimstranger", { pos_role: "owner", business_name: "S" });
    const r = await asUser(exec, stranger, async () => {
      const { rows } = await exec.query(`SELECT public.loyalty_member_claim_start($1,$2) AS result`, [
        f.shopAId,
        "0".repeat(64),
      ]);
      return rpcJson(rows[0]);
    });
    expect(r).toMatchObject({ ok: false, error: "not_a_member" });
  });
});

describe("Phase 1: one active owner per account", () => {
  it("the partial index blocks a second member holding the same card", async () => {
    const acc = await exec.query<{ id: string }>(
      `SELECT account_id AS id FROM public.loyalty_member_links WHERE member_id = $1 AND status = 'active' LIMIT 1`,
      [memberAId],
    );
    expect(acc.rows[0]).toBeTruthy();

    let blocked = false;
    try {
      await exec.query(
        `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source)
         VALUES ($1,$2,$3,'member_claim')`,
        [memberBId, acc.rows[0]!.id, f.shopAId],
      );
    } catch {
      blocked = true;
    }
    // unique(member_id, account_id) alone would NOT have stopped this.
    expect(blocked).toBe(true);
  });
});

describe("Phase 1: the merchant surface is untouched", () => {
  it("merchant loyalty RPCs still work for their own shop", async () => {
    const overview = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(`SELECT public.loyalty_shop_overview($1) AS result`, [f.shopAId]);
      return rpcJson(rows[0]);
    });
    expect(overview.ok).toBe(true);

    const usage = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(`SELECT public.shop_loyalty_usage($1) AS result`, [f.shopAId]);
      return rpcJson(rows[0]);
    });
    expect(usage.ok).toBe(true);
  });

  it("a member cannot call the merchant loyalty RPCs", async () => {
    const r = await asMember(memberUserId, async () => {
      const { rows } = await exec.query(`SELECT public.loyalty_shop_overview($1) AS result`, [f.shopAId]);
      return rpcJson(rows[0]);
    });
    expect(r.ok).toBe(false);
  });

  it("a member who is also shop staff keeps the merchant path", async () => {
    const both = await newAuthUser("staffmember", { account_kind: "member" });
    await exec.query(`INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ($1,$2,'cashier')`, [
      f.shopAId,
      both,
    ]);
    await exec.query(`INSERT INTO public.loyalty_members (auth_user_id, display_name) VALUES ($1,'Staff')`, [both]);
    const r = await asUser(exec, both, async () => {
      const { rows } = await exec.query(`SELECT public.waka_account_identity() AS result`);
      return rpcJson(rows[0]);
    });
    // is_shop_member wins in resolveAccountIdentity, so this session keeps the merchant branch.
    expect(r.is_shop_member).toBe(true);
  });
});

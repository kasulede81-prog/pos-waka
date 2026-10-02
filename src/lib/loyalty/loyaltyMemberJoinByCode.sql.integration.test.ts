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
 * Phase 2C — an AUTHENTICATED member joins a merchant's Loyalty program by WPL code.
 *
 * The rule this file exists to pin: the member identity comes from the SESSION, the merchant from
 * the CODE, and the client supplies neither. The function has no member/account/shop parameter at
 * all, so the only way to influence either is to be a different authenticated user or to name a
 * different public code — and naming a different code simply means joining a different merchant,
 * which is allowed.
 *
 * Approval is NOT bypassed. An authenticated join queues exactly the same PENDING request a
 * merchant must review; the difference is only that the request records WHO asked, so approval
 * binds the link to that identity instead of re-inferring it from a phone number.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;
let codeA = "";
let codeB = "";

/** A DKASU member: auth user + loyalty_members row, exactly what registration produces. */
async function makeMember(phone: string, name = "Member"): Promise<{ userId: string; memberId: string }> {
  const userId = crypto.randomUUID();
  await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
    userId,
    `${userId.slice(0, 8)}@member.test`,
  ]);
  const r = await asUser(exec, userId, async () =>
    exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, [name, phone]),
  );
  const memberId = String(rpcJson(r.rows[0]).member_id ?? "");
  return { userId, memberId };
}

/** Call the join RPC as the authenticated member. NOTE: the only argument is the code. */
async function join(userId: string, code: string): Promise<Record<string, unknown>> {
  const r = await asUser(exec, userId, async () =>
    exec.query(`SELECT public.loyalty_member_join_by_code($1) AS result`, [code]),
  );
  return rpcJson(r.rows[0]);
}

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId);
  await enableProgram(exec, f.shopBId);
  codeA = String(
    (await exec.query(`SELECT public_code FROM public.loyalty_programs WHERE shop_id = $1`, [f.shopAId]))
      .rows[0]?.public_code ?? "",
  );
  codeB = String(
    (await exec.query(`SELECT public_code FROM public.loyalty_programs WHERE shop_id = $1`, [f.shopBId]))
      .rows[0]?.public_code ?? "",
  );
}, T);

afterAll(async () => {
  await exec?.close();
});

// ===========================================================================
// Identity — the session, never the request
// ===========================================================================

describe("identity comes from auth.uid(), never from the caller", () => {
  it("refuses an unauthenticated caller", async () => {
    const r = await exec.query(`SELECT public.loyalty_member_join_by_code($1) AS result`, [codeA]);
    expect(rpcJson(r.rows[0])).toMatchObject({ ok: false, error: "not_authenticated" });
  });

  it("refuses an authenticated user who is not a WAKA member", async () => {
    const stranger = crypto.randomUUID();
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'stranger@test.local')`, [stranger]);
    expect(await join(stranger, codeA)).toMatchObject({ ok: false, error: "not_a_member" });
  });

  it("has NO member/account/shop/organization parameter to forge", async () => {
    const r = await exec.query(
      `SELECT pg_get_function_identity_arguments(oid) AS args
       FROM pg_proc WHERE proname = 'loyalty_member_join_by_code'`,
    );
    // The whole security property in one assertion: the only input is the public code.
    expect(String(r.rows[0]?.args)).toBe("p_code text");
  });

  it("is not callable by anon, and IS callable by authenticated", async () => {
    const r = await exec.query(
      `SELECT has_function_privilege('anon','public.loyalty_member_join_by_code(text)','EXECUTE') AS anon_ok,
              has_function_privilege('authenticated','public.loyalty_member_join_by_code(text)','EXECUTE') AS auth_ok`,
    );
    expect(r.rows[0]).toMatchObject({ anon_ok: false, auth_ok: true });
  });
});

// ===========================================================================
// The code — re-resolved server-side, with the same gates as everywhere else
// ===========================================================================

describe("the WPL code is re-resolved and gated server-side", () => {
  it("rejects a malformed code without touching anything", async () => {
    const m = await makeMember("+256700700001");
    expect(await join(m.userId, "nonsense")).toMatchObject({ ok: false, error: "code_invalid" });
  });

  it("rejects an unknown code", async () => {
    const m = await makeMember("+256700700002");
    expect(await join(m.userId, "WPL2026999")).toMatchObject({ ok: false, error: "not_found" });
  });

  it("refuses a DISABLED program — deactivation closes authenticated joining too", async () => {
    const m = await makeMember("+256700700003");
    await exec.query(`UPDATE public.loyalty_programs SET enabled = false WHERE shop_id = $1`, [f.shopBId]);
    expect(await join(m.userId, codeB)).toMatchObject({ ok: false, error: "unavailable" });
    await exec.query(`UPDATE public.loyalty_programs SET enabled = true WHERE shop_id = $1`, [f.shopBId]);
  });

  it("refuses when the shop has no active WAKA Loyalty entitlement", async () => {
    const m = await makeMember("+256700700004");
    await exec.query(
      `UPDATE public.organization_feature_entitlements SET status = 'none'
       WHERE organization_id = $1 AND feature_code = 'loyalty'`,
      [f.orgId],
    );
    expect(await join(m.userId, codeA)).toMatchObject({ ok: false, error: "unavailable" });
    await exec.query(
      `UPDATE public.organization_feature_entitlements SET status = 'active'
       WHERE organization_id = $1 AND feature_code = 'loyalty'`,
      [f.orgId],
    );
  });

  it("requires the member to have a phone — the merchant has to be able to reconcile them", async () => {
    // Phase 2F — a phone-less member can no longer be PRODUCED by registration: the RPC refuses
    // with `phone_required` and writes no row. Asserted first, because it is what makes the rest of
    // this test a statement about rows that already existed rather than about ones created here.
    const created = crypto.randomUUID();
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'nophone-create@test.local')`, [created]);
    const refused = await asUser(exec, created, async () =>
      exec.query(`SELECT public.loyalty_member_register('No Phone', null) AS result`),
    );
    expect(rpcJson(refused.rows[0])).toMatchObject({ ok: false, error: "phone_required" });

    // A phone-less member that ALREADY exists — a row written before the rule, or by another
    // writer — still cannot join. This is the guard that protects the merchant's reconciliation,
    // and it is unchanged.
    const userId = crypto.randomUUID();
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'nophone@test.local')`, [userId]);
    await exec.query(
      `INSERT INTO public.loyalty_members (auth_user_id, display_name, phone_e164) VALUES ($1, 'No Phone', null)`,
      [userId],
    );
    expect(await join(userId, codeA)).toMatchObject({ ok: false, error: "member_phone_required" });
  });
});

// ===========================================================================
// The join itself
// ===========================================================================

describe("joining queues a PENDING request bound to the AUTHENTICATED member", () => {
  it("creates a request whose member_id is the caller's member — not a phone match", async () => {
    const m = await makeMember("+256700700010", "Join Tester");
    const r = await join(m.userId, codeA);
    expect(r).toMatchObject({ ok: true, status: "pending" });

    const row = await exec.query(
      `SELECT shop_id, member_id, name, phone_e164, status, metadata
       FROM public.loyalty_enrollment_requests WHERE member_id = $1`,
      [m.memberId],
    );
    expect(row.rows[0]).toMatchObject({
      shop_id: f.shopAId,
      member_id: m.memberId,
      name: "Join Tester",
      phone_e164: "+256700700010",
      status: "pending",
    });
    expect(row.rows[0]?.metadata).toMatchObject({ source: "authenticated_program_code" });
  });

  it("does NOT bypass merchant approval — the request is pending, nothing is enrolled", async () => {
    const m = await makeMember("+256700700011");
    await join(m.userId, codeA);

    const accounts = await exec.query(
      `SELECT count(*)::int AS n FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id IN
         (SELECT id FROM public.customers WHERE phone_e164 = $2 AND shop_id = $1)`,
      [f.shopAId, "+256700700011"],
    );
    expect(accounts.rows[0]?.n).toBe(0);
    const links = await exec.query(
      `SELECT count(*)::int AS n FROM public.loyalty_member_links WHERE member_id = $1`,
      [m.memberId],
    );
    expect(links.rows[0]?.n).toBe(0);
  });

  it("is idempotent — a second attempt reports the pending request, does not duplicate it", async () => {
    const m = await makeMember("+256700700012");
    await join(m.userId, codeA);
    const second = await join(m.userId, codeA);
    expect(second).toMatchObject({ ok: true, status: "pending", already_requested: true });

    const rows = await exec.query(
      `SELECT count(*)::int AS n FROM public.loyalty_enrollment_requests WHERE member_id = $1`,
      [m.memberId],
    );
    expect(rows.rows[0]?.n).toBe(1);
  });

  it("two different members joining the same program each get their own request", async () => {
    const m1 = await makeMember("+256700700013");
    const m2 = await makeMember("+256700700014");
    await join(m1.userId, codeB);
    await join(m2.userId, codeB);

    const rows = await exec.query(
      `SELECT member_id FROM public.loyalty_enrollment_requests
       WHERE shop_id = $1 AND member_id = ANY($2::uuid[]) ORDER BY member_id`,
      [f.shopBId, [m1.memberId, m2.memberId]],
    );
    expect(rows.rows.length).toBe(2);
    expect(new Set(rows.rows.map((r) => r.member_id))).toEqual(new Set([m1.memberId, m2.memberId]));
  });

  it("creates no organization, shop, subscription or workspace", async () => {
    const before = await exec.query(
      `SELECT (SELECT count(*)::int FROM public.organizations) AS orgs,
              (SELECT count(*)::int FROM public.shops) AS shops,
              (SELECT count(*)::int FROM public.loyalty_programs) AS programs,
              (SELECT count(*)::int FROM public.profiles) AS profiles`,
    );
    const m = await makeMember("+256700700015");
    await join(m.userId, codeB);
    const after = await exec.query(
      `SELECT (SELECT count(*)::int FROM public.organizations) AS orgs,
              (SELECT count(*)::int FROM public.shops) AS shops,
              (SELECT count(*)::int FROM public.loyalty_programs) AS programs,
              (SELECT count(*)::int FROM public.profiles) AS profiles`,
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});

// ===========================================================================
// Approval binds the authenticated identity
// ===========================================================================

describe("merchant approval links the AUTHENTICATED member", () => {
  it("links by member_id even when the phone is ambiguous to the old phone matcher", async () => {
    // Two active members share a phone — the phone matcher would refuse to guess. The recorded
    // identity must still link, because there is nothing to guess.
    const SHARED = "+256700700020";
    const joiner = await makeMember(SHARED, "Joiner");
    const other = await makeMember(SHARED, "Other");

    await join(joiner.userId, codeA);
    const req = await exec.query(
      `SELECT id FROM public.loyalty_enrollment_requests WHERE member_id = $1 AND status = 'pending'`,
      [joiner.memberId],
    );
    const requestId = String(req.rows[0]?.id ?? "");
    expect(requestId).not.toBe("");

    const appr = await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_review_enrollment_request($1, $2, 'approve', null) AS result`, [
        f.shopAId,
        requestId,
      ]),
    );
    expect(rpcJson(appr.rows[0]).ok).toBe(true);

    const links = await exec.query(
      `SELECT l.member_id, l.link_source
       FROM public.loyalty_member_links l
       JOIN public.loyalty_accounts a ON a.id = l.account_id AND a.shop_id = l.shop_id
       WHERE a.shop_id = $1 AND l.status = 'active' AND l.member_id = ANY($2::uuid[])`,
      [f.shopAId, [joiner.memberId, other.memberId]],
    );
    expect(links.rows.map((r) => r.member_id)).toEqual([joiner.memberId]);
  }, T);

  it("an already-linked member is told so instead of queuing another request", async () => {
    const m = await makeMember("+256700700021");
    await join(m.userId, codeA);
    const req = await exec.query(
      `SELECT id FROM public.loyalty_enrollment_requests WHERE member_id = $1 AND status = 'pending'`,
      [m.memberId],
    );
    await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_review_enrollment_request($1, $2, 'approve', null)`, [
        f.shopAId,
        String(req.rows[0]?.id ?? ""),
      ]),
    );

    expect(await join(m.userId, codeA)).toMatchObject({ ok: true, status: "already_member" });
  }, T);

  it("the same member can afterwards join a SECOND merchant, still with one identity", async () => {
    const m = await makeMember("+256700700022");
    await join(m.userId, codeA);
    const req = await exec.query(
      `SELECT id FROM public.loyalty_enrollment_requests WHERE member_id = $1 AND status = 'pending'`,
      [m.memberId],
    );
    await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_review_enrollment_request($1, $2, 'approve', null)`, [
        f.shopAId,
        String(req.rows[0]?.id ?? ""),
      ]),
    );

    // Same person, different merchant.
    const second = await join(m.userId, codeB);
    expect(second).toMatchObject({ ok: true, status: "pending" });

    // Still exactly ONE DKASU member identity.
    const members = await exec.query(
      `SELECT count(*)::int AS n FROM public.loyalty_members WHERE auth_user_id = $1`,
      [m.userId],
    );
    expect(members.rows[0]?.n).toBe(1);
  }, T);
});

// ===========================================================================
// The anonymous path is untouched
// ===========================================================================

describe("the existing anonymous enrollment path is unchanged", () => {
  it("a request with NO member_id falls through to the original phone match", async () => {
    const phone = "+256700700030";
    const m = await makeMember(phone, "Anonymous Joiner");

    // Exactly what the public WPL/enrollment-link path produces: member_id NULL.
    await exec.query(
      `INSERT INTO public.loyalty_enrollment_requests
         (shop_id, name, phone_e164, status, consent_metadata, metadata)
       VALUES ($1, 'Anonymous Joiner', $2, 'pending', '{}'::jsonb, '{"source":"public_program_code"}'::jsonb)`,
      [f.shopBId, phone],
    );
    const req = await exec.query(
      `SELECT id FROM public.loyalty_enrollment_requests
       WHERE shop_id = $1 AND phone_e164 = $2 AND member_id IS NULL`,
      [f.shopBId, phone],
    );
    const requestId = String(req.rows[0]?.id ?? "");
    expect(requestId).not.toBe("");

    const appr = await asUser(exec, f.outsiderId, async () =>
      exec.query(`SELECT public.loyalty_review_enrollment_request($1, $2, 'approve', null) AS result`, [
        f.shopBId,
        requestId,
      ]),
    );
    expect(rpcJson(appr.rows[0]).ok).toBe(true);

    // The ORIGINAL behaviour: the link is found by the request's phone, exactly as before.
    const links = await exec.query(
      `SELECT l.member_id FROM public.loyalty_member_links l
       JOIN public.loyalty_accounts a ON a.id = l.account_id AND a.shop_id = l.shop_id
       WHERE a.shop_id = $1 AND l.status = 'active'`,
      [f.shopBId],
    );
    expect(links.rows.map((r) => r.member_id)).toContain(m.memberId);
  }, T);

  it("the anonymous request path still requires member_id to be absent by default", async () => {
    const cols = await exec.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name='loyalty_enrollment_requests' AND column_name='member_id'`,
    );
    expect(cols.rows[0]?.is_nullable).toBe("YES");
  });
});

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
 * WPL — the permanent public DKASU Loyalty Program code.
 *
 * A code is a PUBLIC IDENTIFIER, not a credential: `WPL` + issuance year + a sequence that is
 * zero-padded to a MINIMUM of three digits. It says WHICH merchant; it authorises nothing. The
 * shop id, the account id and the enrollment/card tokens stay internal and stay the only bearers.
 *
 * Because it is short, it is ENUMERABLE in a way no existing token is — `WPL2026###` is 999
 * guesses. That is why both public entry points are service-role only and reachable solely through
 * the rate-limited `loyalty-public-*` Edge Functions, and why the payload is asserted key-by-key
 * below to carry no internal identifier.
 *
 * CONCURRENCY IS NOT PROVEN HERE — READ THIS BEFORE TRUSTING THE WORD "CONCURRENT" BELOW.
 * ---------------------------------------------------------------------------------------
 * The harness is a single PGlite connection, so the "many rapid allocations" case is strictly
 * SEQUENTIAL: it proves the allocator never repeats a value across calls, and nothing more.
 *
 * It cannot be upgraded in place. PGlite's TCP socket server (`@electric-sql/pglite-socket`) looks
 * like it offers concurrent connections, but it SERIALISES all work behind any open transaction:
 * with one connection sitting in `BEGIN`, a second connection cannot execute even a plain
 * `SELECT 1` until the first commits. Measured directly, not assumed. So a "two transactions race
 * for the counter" test written against it passes for the wrong reason — and, tellingly, so does
 * the naive `max(code)+1` allocator, which is how the illusion was caught.
 *
 * Real concurrency therefore needs a real multi-connection PostgreSQL (a local install, or a CI
 * service container) supplied through `TEST_DATABASE_URL`. Until that runs, the concurrency
 * guarantee rests on two things that ARE verified here: the STRUCTURAL assertion below — the
 * allocator is one atomic `insert … on conflict do update … returning`, with no read-then-write and
 * no `max()` anywhere in it — and the fact that this is the same construct `next_waka_shop_number`
 * has used in production since 055.
 */

const T = 120_000;
const PHONE_A = "+256700660001";
const PHONE_B = "+256700660002";

let exec: SqlExec;
let f: LoyaltyFixture;

/** The code issued to shop A / shop B, captured once so later tests can assert stability. */
let codeA = "";
let codeB = "";

async function preview(code: string): Promise<Record<string, unknown>> {
  const r = await exec.query(`SELECT public.loyalty_program_public_preview($1) AS result`, [code]);
  return rpcJson(r.rows[0]);
}

async function enrollByCode(
  code: string,
  opts: { name?: string; phone?: string; consent?: boolean; email?: string | null } = {},
): Promise<Record<string, unknown>> {
  const r = await exec.query(
    `SELECT public.loyalty_request_enrollment_by_code($1, $2, $3, $4, $5) AS result`,
    [
      code,
      opts.name ?? "John Ssemakula",
      opts.phone ?? PHONE_A,
      opts.email ?? null,
      opts.consent ?? true,
    ],
  );
  return rpcJson(r.rows[0]);
}

async function enrollByToken(
  token: string,
  opts: { name?: string; phone?: string; consent?: boolean } = {},
): Promise<Record<string, unknown>> {
  const r = await exec.query(
    `SELECT public.loyalty_request_enrollment($1, $2, $3, $4, $5) AS result`,
    [token, opts.name ?? "Token Person", opts.phone ?? PHONE_B, null, opts.consent ?? true],
  );
  return rpcJson(r.rows[0]);
}

async function linkTokenFor(shopId: string): Promise<string> {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  await exec.query(
    `INSERT INTO public.loyalty_enrollment_links (shop_id, token, status, label)
     VALUES ($1, $2, 'active', 'wpl')`,
    [shopId, token],
  );
  return token;
}

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  // The shared harness deliberately stops short of the Wallet-outbox-on-program-change migration,
  // so apply the REAL production trigger here to make the Wallet assertions below mean something.
  // Loaded from the migration file rather than retyped, so this cannot drift from production.
  await exec.exec(
    readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260925070235_loyalty_wallet_enqueue_on_program_change.sql",
      ),
      "utf8",
    ),
  );
  f = await seedLoyaltyFixture(exec);
  // Order matters: the fixture issues codes in creation order, so shop A takes …001.
  await enableProgram(exec, f.shopAId);
  await enableProgram(exec, f.shopBId);
  codeA = String((await exec.query(`SELECT public_code FROM public.loyalty_programs WHERE shop_id = $1`, [f.shopAId])).rows[0]?.public_code ?? "");
  codeB = String((await exec.query(`SELECT public_code FROM public.loyalty_programs WHERE shop_id = $1`, [f.shopBId])).rows[0]?.public_code ?? "");
}, T);

afterAll(async () => {
  await exec?.close();
});

// ===========================================================================
// 1. Generation
// ===========================================================================

describe("WPL generation", async () => {
  it("issues the first 2026 code as WPL2026001, and the next as WPL2026002", async () => {
    expect(codeA).toBe("WPL2026001");
    expect(codeB).toBe("WPL2026002");
  });

  it("keeps 3 digits as a MINIMUM: sequence 1000 is WPL20261000, never truncated", async () => {
    // Regression. `lpad(x, 3, '0')` TRUNCATES a longer input, so the obvious formatter turned
    // sequence 1000 into '100' — i.e. WPL2026100, a code that collides with sequence 100. That
    // is precisely the silent-corruption case this phase had to rule out.
    expect(
      (await exec.query(`SELECT public.format_waka_loyalty_program_code(2026, 1000) AS c`)).rows[0]?.c,
    ).toBe("WPL20261000");
    expect(
      (await exec.query(`SELECT public.format_waka_loyalty_program_code(2026, 1) AS c`)).rows[0]?.c,
    ).toBe("WPL2026001");
    expect(
      (await exec.query(`SELECT public.format_waka_loyalty_program_code(2026, 99) AS c`)).rows[0]?.c,
    ).toBe("WPL2026099");
  });

  it("accepts 1000+ in the shape CHECK and rejects malformed codes", async () => {
    const r = await exec.query(`SELECT
        public.is_waka_loyalty_program_code('WPL2026001') AS a,
        public.is_waka_loyalty_program_code('WPL20261000') AS b,
        public.is_waka_loyalty_program_code('WPL202610001') AS c,
        public.is_waka_loyalty_program_code('WPL26') AS d,
        public.is_waka_loyalty_program_code('wpl2026001') AS e,
        public.is_waka_loyalty_program_code('') AS f,
        public.is_waka_loyalty_program_code(NULL) AS g`);
    expect(r.rows[0]).toMatchObject({ a: true, b: true, c: true, d: false, e: false, f: false, g: false });
  });

  it("allocates the year from Africa/Kampala", async () => {
    const r = await exec.query(
      `SELECT public.next_waka_loyalty_program_code() AS c,
              extract(year from (now() at time zone 'Africa/Kampala'))::int AS y`,
    );
    // Third allocation of the year: WPL + 2026 + 003 (three digits, not four).
    expect(String(r.rows[0]?.c)).toBe(`WPL${r.rows[0]?.y}003`);
  });

  it("starts each new year at 001 without disturbing an existing year", async () => {
    const y2027 = await exec.query(`SELECT public.next_waka_loyalty_program_code(2027) AS c`);
    expect(y2027.rows[0]?.c).toBe("WPL2027001");
    const again = await exec.query(`SELECT public.next_waka_loyalty_program_code(2027) AS c`);
    expect(again.rows[0]?.c).toBe("WPL2027002");
    // 2026's counter is untouched by 2027 activity.
    const y2026 = await exec.query(`SELECT public.next_waka_loyalty_program_code(2026) AS c`);
    expect(y2026.rows[0]?.c).toBe("WPL2026004");
  });

  it("refuses an impossible issuance year rather than emitting a malformed code", async () => {
    await expect(
      exec.query(`SELECT public.next_waka_loyalty_program_code(1200) AS c`),
    ).rejects.toThrow(/invalid issuance year/i);
  });

  it("sequential allocations never repeat a value (NOT a concurrency test — see header)", async () => {
    const codes: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      const r = await exec.query(`SELECT public.next_waka_loyalty_program_code(2031) AS c`);
      codes.push(String(r.rows[0]?.c));
    }
    expect(new Set(codes).size).toBe(codes.length);
    const seqs = codes.map((c) => Number(c.slice(7)));
    for (let i = 1; i < seqs.length; i += 1) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]!);
    expect(codes[0]).toBe("WPL2031001");
  });

  it("the allocator is ONE atomic statement, never max()+1", async () => {
    // The load-bearing concurrency property, asserted where it actually lives. Two sessions can
    // read the same max(code); they cannot both win the same row lock.
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260928120000_loyalty_program_public_code.sql"),
      "utf8",
    );
    const allocator = sql.slice(sql.indexOf("function public.next_waka_loyalty_program_code"));
    const body = allocator.slice(0, allocator.indexOf("$g$"));
    expect(body).toMatch(/on conflict \(year\) do update/i);
    expect(body).toMatch(/returning next_seq - 1/i);
    // A max()/count() over loyalty_programs here would be the defect this test exists to catch.
    expect(body).not.toMatch(/max\s*\(/i);
    expect(body).not.toMatch(/from\s+public\.loyalty_programs/i);
  });

  it("the counter is never decremented and cannot go below 1", async () => {
    await expect(
      exec.query(`UPDATE public.waka_loyalty_program_counter SET next_seq = 0 WHERE year = 2026`),
    ).rejects.toThrow();
  });
});

// ===========================================================================
// 2. Uniqueness and immutability
// ===========================================================================

describe("the code is unique, immutable and never recycled", async () => {
  it("a duplicate code is refused by the unique index", async () => {
    await expect(
      exec.query(`UPDATE public.loyalty_programs SET public_code = $1 WHERE shop_id = $2`, [
        codeA,
        f.shopBId,
      ]),
    ).rejects.toThrow();
    // Unchanged after the failed attempt.
    const r = await exec.query(`SELECT public_code FROM public.loyalty_programs WHERE shop_id = $1`, [f.shopBId]);
    expect(r.rows[0]?.public_code).toBe(codeB);
  });

  it("never changes after creation, even for the table owner", async () => {
    await expect(
      exec.query(`UPDATE public.loyalty_programs SET public_code = 'WPL2026999' WHERE shop_id = $1`, [f.shopAId]),
    ).rejects.toThrow(/immutable/i);
    // Re-asserting the same value is not a change and must stay allowed, so ordinary program
    // saves (which rewrite the whole row) keep working.
    await expect(
      exec.query(`UPDATE public.loyalty_programs SET public_code = $1, enabled = true WHERE shop_id = $2`, [
        codeA,
        f.shopAId,
      ]),
    ).resolves.toBeTruthy();
  });

  it("every program has exactly one code, never null", async () => {
    const r = await exec.query(
      `SELECT count(*)::int AS total, count(public_code)::int AS coded,
              count(DISTINCT public_code)::int AS distinct_codes
       FROM public.loyalty_programs`,
    );
    expect(r.rows[0]).toMatchObject({
      total: r.rows[0]?.distinct_codes,
      coded: r.rows[0]?.total,
    });
  });

  it("a deactivated program keeps its code, and the number is never reissued", async () => {
    // Retiring a program is `enabled = false`; the code is untouched, which is what makes it a
    // permanent identity rather than a lease.
    await exec.query(`UPDATE public.loyalty_programs SET enabled = false WHERE shop_id = $1`, [f.shopBId]);
    const r = await exec.query(`SELECT public_code, enabled FROM public.loyalty_programs WHERE shop_id = $1`, [f.shopBId]);
    expect(r.rows[0]).toMatchObject({ public_code: codeB, enabled: false });

    // The next allocation skips past every issued number, including the retired one.
    const next = await exec.query(`SELECT public.next_waka_loyalty_program_code(2026) AS c`);
    expect(next.rows[0]?.c).not.toBe(codeB);

    await exec.query(`UPDATE public.loyalty_programs SET enabled = true WHERE shop_id = $1`, [f.shopBId]);
  });

  it("a malformed code cannot be stored", async () => {
    await expect(
      exec.query(`UPDATE public.loyalty_programs SET public_code = 'NOPE' WHERE shop_id = $1`, [f.shopAId]),
    ).rejects.toThrow();
  });
});

// ===========================================================================
// 3. Public resolution
// ===========================================================================

describe("public code resolution", async () => {
  it("resolves a valid code to the correct program", async () => {
    const p = await preview(codeA);
    expect(p).toMatchObject({
      ok: true,
      code: "WPL2026001",
      shop_name: "Shop A",
      enabled: true,
    });
  });

  it("resolves the two shops to DIFFERENT programs", async () => {
    const a = await preview(codeA);
    const b = await preview(codeB);
    expect(a.shop_name).not.toBe(b.shop_name);
  });

  it("returns the same safe not-found for malformed and unknown codes", async () => {
    const malformed = await preview("WPL2026999");
    const garbage = await preview("not-a-code");
    const empty = await preview("");
    expect(malformed).toEqual({ ok: false, error: "not_found" });
    // Byte-identical: no existence oracle for probing or typos.
    expect(garbage).toEqual(malformed);
    expect(empty).toEqual(malformed);
  });

  it("lowercase input resolves the same program, so typing is forgiving", async () => {
    expect(await preview("wpl2026001")).toEqual(await preview(codeA));
  });

  it("NEVER leaks an internal identifier or customer data", async () => {
    const p = await preview(codeA);
    // Exact key set, not a spot-check: a future addition has to be a deliberate decision.
    expect(Object.keys(p).sort()).toEqual([
      "business_type",
      "code",
      "district",
      "enabled",
      "ok",
      "program_name",
      "shop_name",
    ]);
    const serialised = JSON.stringify(p);
    for (const forbidden of [
      "shop_id",
      "organization_id",
      "account_id",
      "customer_id",
      "member_id",
      "phone",
      "email",
      "qr_token",
      "public_card_token",
      "link_id",
    ]) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
    // Nor may any UUID appear as a value.
    expect(serialised).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("reports a deactivated program as not accepting members", async () => {
    await exec.query(`UPDATE public.loyalty_programs SET enabled = false WHERE shop_id = $1`, [f.shopAId]);
    const p = await preview(codeA);
    expect(p).toMatchObject({ ok: true, enabled: false });
    await exec.query(`UPDATE public.loyalty_programs SET enabled = true WHERE shop_id = $1`, [f.shopAId]);
  });
});

// ===========================================================================
// 4. Enrollment by code
// ===========================================================================

describe("enrollment by code", async () => {
  it("queues a request against the RESOLVED shop, with the code path recorded", async () => {
    const r = await enrollByCode(codeA, { phone: PHONE_A, name: "Code Joiner" });
    expect(r).toMatchObject({ ok: true, status: "pending" });

    const row = await exec.query(
      `SELECT shop_id, enrollment_link_id, metadata, status, name
       FROM public.loyalty_enrollment_requests WHERE phone_e164 = $1`,
      [PHONE_A],
    );
    expect(row.rows[0]?.shop_id).toBe(f.shopAId);
    // No link was involved: the code alone identified the program.
    expect(row.rows[0]?.enrollment_link_id).toBeNull();
    expect(row.rows[0]?.metadata).toMatchObject({ source: "public_program_code", link_id: null });
  });

  it("is idempotent for the same phone", async () => {
    const again = await enrollByCode(codeA, { phone: PHONE_A, name: "Code Joiner" });
    expect(again).toMatchObject({ ok: true, status: "pending", already_requested: true });
  });

  it("a code can never be used to reach a DIFFERENT shop", async () => {
    // Shop B's code routes to Shop B, and Shop A's request is untouched. There is no parameter
    // through which a caller could name a shop: the signature has none.
    const r = await enrollByCode(codeB, { phone: PHONE_B, name: "Shop B Joiner" });
    expect(r).toMatchObject({ ok: true, status: "pending" });

    const row = await exec.query(
      `SELECT shop_id FROM public.loyalty_enrollment_requests WHERE phone_e164 = $1`,
      [PHONE_B],
    );
    expect(row.rows[0]?.shop_id).toBe(f.shopBId);

    const sig = readFileSync(
      join(process.cwd(), "supabase/migrations/20260928121000_loyalty_program_code_resolution.sql"),
      "utf8",
    );
    const fn = sig.slice(sig.indexOf("function public.loyalty_request_enrollment_by_code"));
    const head = fn.slice(0, fn.indexOf("returns jsonb"));
    expect(head).not.toMatch(/p_shop_id|p_account_id|p_customer_id/);
  });

  it("refuses an inactive program — deactivation closes joining", async () => {
    await exec.query(`UPDATE public.loyalty_programs SET enabled = false WHERE shop_id = $1`, [f.shopBId]);
    const r = await enrollByCode(codeB, { phone: "+256700660099", name: "Blocked" });
    expect(r).toMatchObject({ ok: false, error: "unavailable" });
    await exec.query(`UPDATE public.loyalty_programs SET enabled = true WHERE shop_id = $1`, [f.shopBId]);
  });

  it("refuses when the shop has no active WAKA Loyalty entitlement", async () => {
    await exec.query(
      `UPDATE public.organization_feature_entitlements SET status = 'none'
       WHERE organization_id = $1 AND feature_code = 'loyalty'`,
      [f.orgId],
    );
    const r = await enrollByCode(codeA, { phone: "+256700660098", name: "No Entitlement" });
    expect(r).toMatchObject({ ok: false, error: "unavailable" });
    await exec.query(
      `UPDATE public.organization_feature_entitlements SET status = 'active'
       WHERE organization_id = $1 AND feature_code = 'loyalty'`,
      [f.orgId],
    );
  });

  it("requires consent and validates name, phone and email in the token path's order", async () => {
    expect(await enrollByCode(codeA, { consent: false })).toMatchObject({ error: "consent_required" });
    expect(await enrollByCode(codeA, { name: "J" })).toMatchObject({ error: "invalid_name" });
    expect(await enrollByCode(codeA, { phone: "0772" })).toMatchObject({ error: "invalid_phone" });
    expect(await enrollByCode(codeA, { email: "nope" })).toMatchObject({ error: "invalid_email" });
  });

  it("reports a malformed code distinctly from an unknown one, both safely", async () => {
    expect(await enrollByCode("nonsense")).toMatchObject({ ok: false, error: "code_invalid" });
    expect(await enrollByCode("WPL2026999")).toMatchObject({ ok: false, error: "not_found" });
  });

  it("an unknown member is NOT created by entering a code", async () => {
    const before = await exec.query(`SELECT count(*)::int AS n FROM public.loyalty_members`);
    await enrollByCode(codeA, { phone: "+256700660097", name: "Curious" });
    const after = await exec.query(`SELECT count(*)::int AS n FROM public.loyalty_members`);
    // Entering a code identifies the MERCHANT. Only registration/approval creates a member.
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });
});

// ===========================================================================
// 5. The token path is untouched
// ===========================================================================

describe("existing 64-hex enrollment is unchanged", async () => {
  it("still queues a request, with the original metadata source and the link recorded", async () => {
    const token = await linkTokenFor(f.shopAId);
    const r = await enrollByToken(token, { phone: "+256700660096", name: "Token Joiner" });
    expect(r).toMatchObject({ ok: true, status: "pending" });

    const row = await exec.query(
      `SELECT shop_id, enrollment_link_id, metadata FROM public.loyalty_enrollment_requests
       WHERE phone_e164 = $1`,
      ["+256700660096"],
    );
    expect(row.rows[0]?.shop_id).toBe(f.shopAId);
    expect(row.rows[0]?.enrollment_link_id).not.toBeNull();
    // Byte-identical to pre-WPL behaviour: same source string, same link_id key.
    expect(row.rows[0]?.metadata).toMatchObject({ source: "public_enrollment_link" });
  });

  it("still returns token_invalid / not_found for a bad token", async () => {
    expect(await enrollByToken("nope", { phone: "+256700660095" })).toMatchObject({ error: "token_invalid" });
    expect(await enrollByToken("a".repeat(64), { phone: "+256700660094" })).toMatchObject({ error: "not_found" });
  });

  it("still refuses a revoked link", async () => {
    const token = await linkTokenFor(f.shopBId);
    await exec.query(
      `UPDATE public.loyalty_enrollment_links SET status = 'revoked', revoked_at = now() WHERE token = $1`,
      [token],
    );
    expect(await enrollByToken(token, { phone: "+256700660093" })).toMatchObject({ error: "unavailable" });
  });

  it("still returns already_member for an existing account", async () => {
    const acct = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.loyalty_accounts (id, shop_id, customer_id, status)
       VALUES ($1, $2, $3, 'active')`,
      [acct, f.shopAId, f.customerAId],
    );
    const r = await enrollByCode(codeA, { phone: "+256700000001", name: "Existing" });
    expect(r).toMatchObject({ ok: true, status: "already_member" });
  });
});

// ===========================================================================
// 6. Multi-shop — one member, many programs
// ===========================================================================

describe("one member can belong to several programs", async () => {
  it("approving two shops' requests links ONE member to both, with a single members row", async () => {
    const memberUserId = crypto.randomUUID();
    const memberPhone = "+256700660050";
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'multi@test.local')`, [memberUserId]);
    // `loyalty_member_register` resolves the member from auth.uid(), so it needs a real session.
    const reg = await asUser(exec, memberUserId, async () =>
      exec.query(`SELECT public.loyalty_member_register('Multi Member', $1) AS result`, [memberPhone]),
    );
    const memberId = String(rpcJson(reg.rows[0]).member_id ?? "");
    expect(memberId).not.toBe("");

    for (const [shopId, phone, approverId] of [
      [f.shopAId, memberPhone, f.ownerAId],
      [f.shopBId, memberPhone, f.outsiderId],
    ] as const) {
      const req = await exec.query(
        `INSERT INTO public.loyalty_enrollment_requests
           (shop_id, name, phone_e164, status, consent_metadata, metadata)
         VALUES ($1, 'Multi Member', $2, 'pending', '{}'::jsonb, '{}'::jsonb)
         RETURNING id`,
        [shopId, phone],
      );
      const requestId = String(req.rows[0]?.id ?? "");
      // Each shop is approved by the user who actually manages it, because `user_can_manage_shop`
      // is the guard that stops one merchant approving for another. The Phase 2A approval path is
      // what creates the customer, the account AND the member link.
      const appr = await asUser(exec, approverId, async () =>
        exec.query(`SELECT public.loyalty_review_enrollment_request($1, $2, 'approve', null) AS result`, [
          shopId,
          requestId,
        ]),
      );
      expect(rpcJson(appr.rows[0]).ok, shopId).toBe(true);
    }

    const links = await exec.query(
      `SELECT l.status, a.shop_id
       FROM public.loyalty_member_links l
       JOIN public.loyalty_accounts a ON a.id = l.account_id AND a.shop_id = l.shop_id
       WHERE l.member_id = $1 AND l.status = 'active'`,
      [memberId],
    );
    expect(links.rows.length).toBe(2);
    expect(new Set(links.rows.map((r) => r.shop_id))).toEqual(new Set([f.shopAId, f.shopBId]));

    // Still exactly ONE DKASU member identity — never one per shop.
    const members = await exec.query(
      `SELECT count(*)::int AS n FROM public.loyalty_members WHERE auth_user_id = $1`,
      [memberUserId],
    );
    expect(members.rows[0]?.n).toBe(1);
  });
});

// ===========================================================================
// 7. Wallet
// ===========================================================================

describe("Wallet is untouched", async () => {
  it("issuing a code enqueues nothing", async () => {
    const outbox = await exec.query(
      `SELECT count(*)::int AS n FROM public.loyalty_wallet_sync_outbox WHERE shop_id = $1`,
      [f.shopBId],
    );
    expect(outbox.rows[0]?.n).toBe(0);
  });

  it("a non-card program change does not enqueue, but a card-visible one still does", async () => {
    // Control and negative together: proves the trigger is alive and that the code column is
    // simply not one of the fields it watches.
    await exec.query(
      `UPDATE public.loyalty_programs SET metadata = metadata WHERE shop_id = $1`,
      [f.shopAId],
    );
    let n = await exec.query(
      `SELECT count(*)::int AS n FROM public.loyalty_wallet_sync_outbox WHERE shop_id = $1`,
      [f.shopAId],
    );
    expect(n.rows[0]?.n).toBe(0);

    // The trigger only enqueues for accounts that already carry a Wallet pass — that is its own
    // documented filter, so the account has to look Wallet-issued for the control case to mean
    // anything.
    const acct = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.loyalty_accounts (id, shop_id, customer_id, status, google_wallet_object_id)
       VALUES ($1, $2, $3, 'active', $4)`,
      [acct, f.shopAId, f.customerBId, `waka.test.${acct}`],
    );
    await exec.query(`UPDATE public.loyalty_programs SET earn_points_per_unit = 2 WHERE shop_id = $1`, [f.shopAId]);
    n = await exec.query(
      `SELECT count(*)::int AS n FROM public.loyalty_wallet_sync_outbox WHERE shop_id = $1 AND account_id = $2`,
      [f.shopAId, acct],
    );
    expect(Number(n.rows[0]?.n)).toBeGreaterThan(0);

    await exec.query(`UPDATE public.loyalty_programs SET earn_points_per_unit = 1 WHERE shop_id = $1`, [f.shopAId]);
  });

  it("the wallet enqueue trigger does not watch public_code", async () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260925070235_loyalty_wallet_enqueue_on_program_change.sql"),
      "utf8",
    );
    expect(sql).not.toMatch(/public_code/);
  });
});

// ===========================================================================
// 8. Privileges — the code is never client-writable, the lookup never anon-callable
// ===========================================================================

describe("privileges", async () => {
  it("an authenticated merchant cannot execute the public preview at all", async () => {
    // The only route to the lookup is the rate-limited Edge Function (service role).
    await expect(
      asUser(exec, f.outsiderId, async () => {
        await exec.query(`SELECT public.loyalty_program_public_preview($1)`, [codeA]);
      }),
    ).rejects.toThrow();
  });

  it("an authenticated merchant cannot execute the code enrollment RPC", async () => {
    await expect(
      asUser(exec, f.outsiderId, async () => {
        await exec.query(`SELECT public.loyalty_request_enrollment_by_code($1,'Joiner','+256700660049',null,true)`, [codeA]);
      }),
    ).rejects.toThrow();
  });

  it("a merchant cannot allocate a code (no burning numbers)", async () => {
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(`SELECT public.next_waka_loyalty_program_code(2026)`);
      }),
    ).rejects.toThrow();
  });

  it("a merchant cannot write public_code on their own program", async () => {
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(`UPDATE public.loyalty_programs SET public_code = 'WPL2026500' WHERE shop_id = $1`, [f.shopAId]);
      }),
    ).rejects.toThrow();
  });

  it("the counter table is not readable by a merchant", async () => {
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(`SELECT * FROM public.waka_loyalty_program_counter`);
      }),
    ).rejects.toThrow();
  });
});

// ===========================================================================
// 9. Rate limiting
// ===========================================================================

describe("the public lookup path is rate limited", async () => {
  it("accepts the program_lookup scope and throttles past the limit", async () => {
    const first = await exec.query(
      `SELECT public.edge_rate_limit_consume('program_lookup','iphash0001',NULL,3,60000,1,60000) AS result`,
    );
    expect(rpcJson(first.rows[0])).toMatchObject({ ok: true });

    let limited: Record<string, unknown> = {};
    for (let i = 0; i < 4; i += 1) {
      const r = await exec.query(
        `SELECT public.edge_rate_limit_consume('program_lookup','iphash0001',NULL,3,60000,1,60000) AS result`,
      );
      limited = rpcJson(r.rows[0]);
    }
    expect(limited).toMatchObject({ ok: false, error: "rate_limited" });
    expect(Number(limited.retry_after_seconds)).toBeGreaterThan(0);
  });

  it("still rejects an unknown scope", async () => {
    const r = await exec.query(
      `SELECT public.edge_rate_limit_consume('not_a_scope','iphash0002',NULL,3,60000,1,60000) AS result`,
    );
    expect(rpcJson(r.rows[0])).toMatchObject({ ok: false, error: "invalid_scope" });
  });

  it("the rate-limit RPC is not executable by a browser session", async () => {
    await expect(
      asUser(exec, f.outsiderId, async () => {
        await exec.query(`SELECT public.edge_rate_limit_consume('program_lookup','x',NULL,1,1000,1,1000)`);
      }),
    ).rejects.toThrow();
  });
});

// ===========================================================================
// 10. Admin + merchant surfaces
// ===========================================================================

describe("internal admin", async () => {
  it("refuses a non-internal merchant", async () => {
    const r = await asUser(exec, f.outsiderId, async () =>
      exec.query(`SELECT public.internal_ops_loyalty_programs(NULL, 50) AS result`),
    );
    expect(rpcJson(r.rows[0])).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("lists programs with code, shop, organization, status and member counts", async () => {
    const r = await asUser(exec, f.internalAdminId, async () =>
      exec.query(`SELECT public.internal_ops_loyalty_programs(NULL, 50) AS result`),
    );
    const body = rpcJson(r.rows[0]);
    expect(body.ok).toBe(true);
    const programs = body.programs as Record<string, unknown>[];
    expect(Array.isArray(programs)).toBe(true);
    const rowA = programs.find((p) => p.public_code === codeA);
    expect(rowA).toMatchObject({
      shop_id: f.shopAId,
      organization_id: f.orgId,
      enabled: true,
    });
    expect(rowA).toHaveProperty("members_total");
    expect(rowA).toHaveProperty("created_at");
  });

  it("searches by code, by shop name and by shop number", async () => {
    const byCode = await asUser(exec, f.internalAdminId, async () =>
      exec.query(`SELECT public.internal_ops_loyalty_programs($1, 50) AS result`, [codeA]),
    );
    const codes = (rpcJson(byCode.rows[0]).programs as Record<string, unknown>[]).map((p) => p.public_code);
    expect(codes).toContain(codeA);
    expect(codes).not.toContain(codeB);

    const byName = await asUser(exec, f.internalAdminId, async () =>
      exec.query(`SELECT public.internal_ops_loyalty_programs('Shop B', 50) AS result`),
    );
    const names = (rpcJson(byName.rows[0]).programs as Record<string, unknown>[]).map((p) => p.public_code);
    expect(names).toContain(codeB);
  });

  it("resolves one program by code, and refuses a non-internal caller", async () => {
    const good = await asUser(exec, f.internalAdminId, async () =>
      exec.query(`SELECT public.internal_ops_loyalty_program_by_code($1) AS result`, [codeA]),
    );
    const body = rpcJson(good.rows[0]);
    expect(body.ok).toBe(true);
    expect((body.program as Record<string, unknown>).public_code).toBe(codeA);

    const denied = await asUser(exec, f.outsiderId, async () =>
      exec.query(`SELECT public.internal_ops_loyalty_program_by_code($1) AS result`, [codeA]),
    );
    expect(rpcJson(denied.rows[0])).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("returns a safe not-found for an unknown code", async () => {
    const r = await asUser(exec, f.internalAdminId, async () =>
      exec.query(`SELECT public.internal_ops_loyalty_program_by_code('WPL2026999') AS result`),
    );
    expect(rpcJson(r.rows[0])).toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("merchant overview", async () => {
  it("exposes the merchant's own code and join path, and no one else's", async () => {
    const r = await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_shop_overview($1) AS result`, [f.shopAId]),
    );
    const program = rpcJson(r.rows[0]).program as Record<string, unknown>;
    expect(program.public_code).toBe(codeA);
    expect(program.join_path).toBe(`/j/${codeA}`);
  });

  it("still refuses a shop the caller does not belong to", async () => {
    const r = await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_shop_overview($1) AS result`, [f.shopBId]),
    );
    expect(rpcJson(r.rows[0])).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("is read-only: no RPC accepts a code as a write input", async () => {
    for (const file of [
      "20260928120000_loyalty_program_public_code.sql",
      "20260928121000_loyalty_program_code_resolution.sql",
      "20260928122000_loyalty_program_code_admin_merchant.sql",
    ]) {
      const sql = readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8");
      // The only writes to the column are the allocator's own trigger; nothing sets it from an
      // argument.
      expect(sql).not.toMatch(/set\s+public_code\s*=\s*p_/i);
      expect(sql).not.toMatch(/public_code\s*=\s*p_code/i);
    }
  });
});

// ===========================================================================
// 11. The admin shop list projects the code onto the row
// ===========================================================================

describe("admin shop list carries the WPL code", () => {
  it("projects public_code onto every shop row that has a program", async () => {
    const r = await asUser(exec, f.internalAdminId, async () =>
      exec.query(`SELECT public.internal_ops_loyalty_admin_shop_states(NULL, 'all', 100) AS result`),
    );
    const rows = rpcJson(r.rows[0]).shops as Record<string, unknown>[];
    const rowA = rows.find((s) => s.shop_id === f.shopAId);
    const rowB = rows.find((s) => s.shop_id === f.shopBId);
    expect(rowA?.public_code).toBe(codeA);
    expect(rowB?.public_code).toBe(codeB);
  });

  it("finds a shop by pasting its WPL code, case-insensitively", async () => {
    // Server-side, so the admin never has to resolve a code and re-filter a list.
    const r = await asUser(exec, f.internalAdminId, async () =>
      exec.query(`SELECT public.internal_ops_loyalty_admin_shop_states($1, 'all', 100) AS result`, [
        codeA.toLowerCase(),
      ]),
    );
    const rows = rpcJson(r.rows[0]).shops as Record<string, unknown>[];
    expect(rows.length).toBe(1);
    expect(rows[0]?.shop_id).toBe(f.shopAId);
  });

  it("still shows a shop that has no program at all, with a null code", async () => {
    // A shop that never switched Loyalty on has no loyalty_programs row: it must still appear in
    // the admin list, and the LEFT JOIN must not drop it.
    const bareShopId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.shops (id, organization_id, name, shop_number)
       VALUES ($1, $2, 'Shop No Loyalty', 'WPL-BARE')`,
      [bareShopId, f.orgId],
    );
    const r = await asUser(exec, f.internalAdminId, async () =>
      exec.query(`SELECT public.internal_ops_loyalty_admin_shop_states($1, 'all', 100) AS result`, [
        "Shop No Loyalty",
      ]),
    );
    const rows = rpcJson(r.rows[0]).shops as Record<string, unknown>[];
    expect(rows.length).toBe(1);
    expect(rows[0]?.shop_id).toBe(bareShopId);
    expect(rows[0]?.public_code).toBeNull();
  });

  it("needs no second call: the code is on the row, past any program-list cap", async () => {
    // The defect this replaced: joining a capped, newest-first program list client-side left the
    // OLDEST merchants blank once a platform passed the cap. Projecting the code onto the row is
    // correct for every shop the list returns, whatever the cap is.
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260928122000_loyalty_program_code_admin_merchant.sql"),
      "utf8",
    );
    const fn = sql.slice(sql.indexOf("function public.internal_ops_loyalty_admin_shop_states"));
    expect(fn).toMatch(/left join public\.loyalty_programs lp on lp\.shop_id = sh\.id/i);
    expect(fn).toMatch(/lp\.public_code/);
    expect(fn).toMatch(/x\.public_code, ''\) ilike/i);
  });

  it("still refuses a non-internal caller", async () => {
    const r = await asUser(exec, f.outsiderId, async () =>
      exec.query(`SELECT public.internal_ops_loyalty_admin_shop_states(NULL, 'all', 100) AS result`),
    );
    expect(rpcJson(r.rows[0])).toMatchObject({ ok: false, error: "forbidden" });
  });
});

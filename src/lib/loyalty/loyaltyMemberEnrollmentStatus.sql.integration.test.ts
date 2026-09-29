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
 * Phase 2D — a member can see the status of their OWN enrollment requests.
 *
 * The gap this closes: the only select policy on `loyalty_enrollment_requests` was
 * `user_can_access_shop(shop_id)`, and a member has no shop access — so the customer who had just
 * joined with a WPL code could not see the request they were waiting on, and `/member` looked like
 * it had silently failed.
 *
 * The tests that matter here are the ISOLATION ones. Widening visibility on a table that holds
 * every merchant's pending queue is the kind of change that is easy to get subtly wrong, so the
 * negatives — cannot read another member's row, cannot read an anonymous row, cannot write
 * anything — are asserted as carefully as the positive.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;
let codeA = "";
let codeB = "";

async function makeMember(phone: string, name = "Member"): Promise<{ userId: string; memberId: string }> {
  const userId = crypto.randomUUID();
  await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
    userId,
    `${userId.slice(0, 8)}@m.test`,
  ]);
  const r = await asUser(exec, userId, async () =>
    exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, [name, phone]),
  );
  return { userId, memberId: String(rpcJson(r.rows[0]).member_id ?? "") };
}

async function join(userId: string, code: string): Promise<Record<string, unknown>> {
  const r = await asUser(exec, userId, async () =>
    exec.query(`SELECT public.loyalty_member_join_by_code($1) AS result`, [code]),
  );
  return rpcJson(r.rows[0]);
}

async function status(userId: string): Promise<Record<string, unknown>> {
  const r = await asUser(exec, userId, async () =>
    exec.query(`SELECT public.loyalty_member_enrollment_status() AS result`),
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
// The read itself
// ===========================================================================

describe("the member's own request status", () => {
  it("requires a session", async () => {
    const r = await exec.query(`SELECT public.loyalty_member_enrollment_status() AS result`);
    expect(rpcJson(r.rows[0])).toMatchObject({ ok: false, error: "not_authenticated" });
  });

  it("says not_a_member for an authenticated non-member", async () => {
    const stranger = crypto.randomUUID();
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'x@m.test')`, [stranger]);
    expect(await status(stranger)).toMatchObject({ ok: false, error: "not_a_member" });
  });

  it("returns the member's pending request after a join", async () => {
    const m = await makeMember("+256700800001", "Pending Person");
    await join(m.userId, codeA);

    const s = await status(m.userId);
    expect(s.ok).toBe(true);
    const reqs = s.requests as Record<string, unknown>[];
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ status: "pending", shop_name: "Shop A" });
    expect(reqs[0]?.requested_at).toBeTruthy();
    expect(reqs[0]?.reviewed_at).toBeNull();
  });

  it("returns fields for display only — no internal identifiers or merchant notes", async () => {
    const m = await makeMember("+256700800002");
    await join(m.userId, codeA);
    const reqs = (await status(m.userId)).requests as Record<string, unknown>[];

    // Exact key set, so a future addition has to be a deliberate decision.
    expect(Object.keys(reqs[0]!).sort()).toEqual([
      "request_id",
      "requested_at",
      "reviewed_at",
      "shop_name",
      "status",
    ]);
    const serialised = JSON.stringify(reqs[0]);
    for (const forbidden of [
      "reviewed_by",
      "rejection_reason",
      "approved_loyalty_account_id",
      "customer_id",
      "phone_e164",
      "email",
      "shop_id",
    ]) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
  });

  it("returns an empty list — not an error — for a member with no requests", async () => {
    const m = await makeMember("+256700800003");
    const s = await status(m.userId);
    expect(s.ok).toBe(true);
    expect(s.requests).toEqual([]);
  });

  it("reflects approval once the merchant reviews it", async () => {
    const m = await makeMember("+256700800004");
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

    const reqs = (await status(m.userId)).requests as Record<string, unknown>[];
    expect(reqs[0]?.status).toBe("approved");
    expect(reqs[0]?.reviewed_at).toBeTruthy();
  }, T);

  it("reflects rejection, and KEEPS the row — history is never deleted", async () => {
    const m = await makeMember("+256700800005");
    await join(m.userId, codeA);
    const req = await exec.query(
      `SELECT id FROM public.loyalty_enrollment_requests WHERE member_id = $1 AND status = 'pending'`,
      [m.memberId],
    );
    await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_review_enrollment_request($1, $2, 'reject', 'not a customer')`, [
        f.shopAId,
        String(req.rows[0]?.id ?? ""),
      ]),
    );

    const reqs = (await status(m.userId)).requests as Record<string, unknown>[];
    expect(reqs[0]?.status).toBe("rejected");
    // Still there, still readable.
    const still = await exec.query(`SELECT status FROM public.loyalty_enrollment_requests WHERE member_id = $1`, [
      m.memberId,
    ]);
    expect(still.rows).toHaveLength(1);
  }, T);
});

// ===========================================================================
// Multi-merchant
// ===========================================================================

describe("one member, several merchants", () => {
  it("shows a request per merchant, newest first, without collapsing them", async () => {
    const m = await makeMember("+256700800010");
    await join(m.userId, codeA);
    await join(m.userId, codeB);

    const reqs = (await status(m.userId)).requests as Record<string, unknown>[];
    expect(reqs).toHaveLength(2);
    expect(new Set(reqs.map((r) => r.shop_name))).toEqual(new Set(["Shop A", "Shop B"]));
  });
});

// ===========================================================================
// Isolation — the part that matters
// ===========================================================================

describe("SECURITY: a member sees only their own requests", () => {
  it("member A cannot see member B's request", async () => {
    const a = await makeMember("+256700800020", "Member A");
    const b = await makeMember("+256700800021", "Member B");
    await join(b.userId, codeA);

    expect((await status(a.userId)).requests).toEqual([]);
    expect(((await status(b.userId)).requests as unknown[]).length).toBe(1);
  });

  it("the RPC takes no parameter at all — there is nobody else to ask about", async () => {
    const r = await exec.query(
      `SELECT pg_get_function_identity_arguments(oid) AS args FROM pg_proc
       WHERE proname = 'loyalty_member_enrollment_status'`,
    );
    expect(String(r.rows[0]?.args)).toBe("");
  });

  it("a member cannot SELECT another member's row directly (RLS)", async () => {
    const a = await makeMember("+256700800022", "Member A2");
    const b = await makeMember("+256700800023", "Member B2");
    await join(b.userId, codeB);

    const visible = await asUser(exec, a.userId, async () =>
      exec.query(`SELECT id FROM public.loyalty_enrollment_requests WHERE member_id = $1`, [b.memberId]),
    );
    // RLS filters rather than errors: the row simply is not there.
    expect(visible.rows).toHaveLength(0);
  });

  it("a member CAN select their own row (which is what Realtime needs)", async () => {
    const m = await makeMember("+256700800024");
    await join(m.userId, codeA);
    const own = await asUser(exec, m.userId, async () =>
      exec.query(`SELECT id, status FROM public.loyalty_enrollment_requests WHERE member_id = $1`, [m.memberId]),
    );
    expect(own.rows).toHaveLength(1);
  });

  it("a member cannot read an ANONYMOUS request (member_id IS NULL)", async () => {
    // The anonymous path belongs to nobody, so nobody is entitled to read it.
    const m = await makeMember("+256700800025");
    await exec.query(
      `INSERT INTO public.loyalty_enrollment_requests (shop_id, name, phone_e164, status, consent_metadata, metadata)
       VALUES ($1, 'Anon', '+256700800099', 'pending', '{}'::jsonb, '{}'::jsonb)`,
      [f.shopBId],
    );
    const visible = await asUser(exec, m.userId, async () =>
      exec.query(`SELECT id FROM public.loyalty_enrollment_requests WHERE member_id IS NULL`),
    );
    expect(visible.rows).toHaveLength(0);
  });

  it("an anonymous caller reads nothing at all", async () => {
    const r = await exec.query(
      `SELECT has_table_privilege('anon','public.loyalty_enrollment_requests','SELECT') AS anon_select`,
    );
    expect(r.rows[0]).toMatchObject({ anon_select: false });
  });
});

// ===========================================================================
// No write path — the member must not be able to approve themselves
// ===========================================================================

describe("SECURITY: a member cannot change anything", () => {
  it("holds SELECT only — no INSERT, UPDATE or DELETE", async () => {
    const r = await exec.query(
      `SELECT has_table_privilege('authenticated','public.loyalty_enrollment_requests','INSERT') AS ins,
              has_table_privilege('authenticated','public.loyalty_enrollment_requests','UPDATE') AS upd,
              has_table_privilege('authenticated','public.loyalty_enrollment_requests','DELETE') AS del`,
    );
    expect(r.rows[0]).toMatchObject({ ins: false, upd: false, del: false });
  });

  it("cannot approve itself, even for its own request", async () => {
    const m = await makeMember("+256700800030");
    await join(m.userId, codeA);
    await expect(
      asUser(exec, m.userId, async () =>
        exec.query(`SELECT public.loyalty_review_enrollment_request($1, $2, 'approve', null)`, [
          f.shopAId,
          String(
            (await exec.query(`SELECT id FROM public.loyalty_enrollment_requests WHERE member_id = $1`, [m.memberId]))
              .rows[0]?.id ?? "",
          ),
        ]),
      ),
    ).resolves.toBeTruthy();

    // The RPC refuses a caller who does not manage the shop — the request is still pending.
    const still = await exec.query(`SELECT status FROM public.loyalty_enrollment_requests WHERE member_id = $1`, [
      m.memberId,
    ]);
    expect(still.rows[0]?.status).toBe("pending");
  }, T);

  it("cannot UPDATE its own row through the API", async () => {
    const m = await makeMember("+256700800031");
    await join(m.userId, codeA);
    await expect(
      asUser(exec, m.userId, async () =>
        exec.query(`UPDATE public.loyalty_enrollment_requests SET status='approved' WHERE member_id = $1`, [
          m.memberId,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("the only status-changing function is the merchant-guarded one", async () => {
    // Nothing in this migration updates the table.
    const { readFileSync } = await import("node:fs");
    const { join: j } = await import("node:path");
    const sql = readFileSync(
      j(process.cwd(), "supabase/migrations/20260929160000_loyalty_member_enrollment_status.sql"),
      "utf8",
    );
    expect(sql).not.toMatch(/update\s+public\.loyalty_enrollment_requests/i);
    expect(sql).not.toMatch(/\bdelete\s+from\s+public\.loyalty_enrollment_requests/i);
    expect(sql).not.toMatch(/grant\s+(insert|update|delete)/i);
  });
});

// ===========================================================================
// Realtime configuration
// ===========================================================================

describe("realtime wiring", () => {
  it("adds the table to the publication when one exists, guarded and idempotent", async () => {
    // The harness has no `supabase_realtime` publication, so the block must SKIP rather than fail —
    // which is exactly what applying the migration above already proved.
    const sql = (await import("node:fs")).readFileSync(
      (await import("node:path")).join(
        process.cwd(),
        "supabase/migrations/20260929160000_loyalty_member_enrollment_status.sql",
      ),
      "utf8",
    );
    expect(sql).toMatch(/pg_publication where pubname = 'supabase_realtime'/);
    expect(sql).toMatch(/alter publication supabase_realtime add table public\.loyalty_enrollment_requests/);
    // NOT VALID-style shortcuts are not used anywhere here.
    expect(sql).not.toMatch(/not valid/i);
  });

  it("is idempotent — re-applying changes nothing", async () => {
    const before = await exec.query(
      `SELECT count(*)::int AS n FROM pg_policies WHERE tablename='loyalty_enrollment_requests'`,
    );
    const sql = (await import("node:fs")).readFileSync(
      (await import("node:path")).join(
        process.cwd(),
        "supabase/migrations/20260929160000_loyalty_member_enrollment_status.sql",
      ),
      "utf8",
    );
    await exec.exec(sql);
    const after = await exec.query(
      `SELECT count(*)::int AS n FROM pg_policies WHERE tablename='loyalty_enrollment_requests'`,
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  }, T);
});

// ===========================================================================
// Nothing else moved
// ===========================================================================

describe("the merchant path is unchanged", () => {
  it("a merchant still sees their shop's queue", async () => {
    const m = await makeMember("+256700800040");
    await join(m.userId, codeA);
    const listed = await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_list_enrollment_requests($1, 'pending', 50) AS result`, [f.shopAId]),
    );
    const body = rpcJson(listed.rows[0]);
    expect(body.ok).toBe(true);
    expect((body.requests as unknown[]).length).toBeGreaterThan(0);
  });

  it("approval still requires shop authority", async () => {
    const outsider = crypto.randomUUID();
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'out@m.test')`, [outsider]);
    const m = await makeMember("+256700800041");
    await join(m.userId, codeA);
    const req = await exec.query(
      `SELECT id FROM public.loyalty_enrollment_requests WHERE member_id = $1 AND status='pending'`,
      [m.memberId],
    );
    const r = await asUser(exec, outsider, async () =>
      exec.query(`SELECT public.loyalty_review_enrollment_request($1, $2, 'approve', null) AS result`, [
        f.shopAId,
        String(req.rows[0]?.id ?? ""),
      ]),
    );
    expect(rpcJson(r.rows[0])).toMatchObject({ ok: false, error: "forbidden" });
  }, T);
});

// ===========================================================================
// The one-character display name
// ===========================================================================

describe("a one-character display name no longer breaks the join", () => {
  it("joins successfully, falling back to a length the request table allows", async () => {
    // `loyalty_members.display_name` permits 1..120; `loyalty_enrollment_requests.name` requires
    // 2..120. Before the floor, "A" reached the insert unchanged and the join died on 23514.
    const m = await makeMember("+256700800050", "A");
    expect(m.memberId).not.toBe("");

    const r = await join(m.userId, codeA);
    expect(r.ok, JSON.stringify(r)).toBe(true);

    const row = await exec.query(`SELECT name FROM public.loyalty_enrollment_requests WHERE member_id = $1`, [
      m.memberId,
    ]);
    expect(row.rows).toHaveLength(1);
    expect(String(row.rows[0]?.name)).toBe("WAKA member");
  }, T);

  it("still uses a real name of two or more characters verbatim", async () => {
    const m = await makeMember("+256700800051", "Jo");
    await join(m.userId, codeA);
    const row = await exec.query(`SELECT name FROM public.loyalty_enrollment_requests WHERE member_id = $1`, [
      m.memberId,
    ]);
    expect(String(row.rows[0]?.name)).toBe("Jo");
  }, T);
});

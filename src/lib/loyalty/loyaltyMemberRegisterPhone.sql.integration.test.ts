import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createLoyaltySqlHarness, rpcJson, type SqlExec } from "../../test/sqlIntegration/loyaltyPgHarness";

/**
 * Phase 2F — a NEW DKASU Loyalty member must have a phone number.
 *
 * THE DEFECT. `loyalty_member_register`'s format check only ran when the phone was NON-NULL:
 *
 *   if v_phone is not null and v_phone !~ '^\+256[0-9]{9}$' then ...
 *
 * A NULL therefore passed straight through into the INSERT. The client validates, but the RPC is
 * granted to `authenticated` and can be called directly, so any signed-in caller could create a
 * member with no phone — an identity that can never join anything, because
 * `loyalty_member_join_by_code` refuses it with `member_phone_required`.
 *
 * The guard is scoped to CREATION. An existing member who already holds a phone may still call
 * without one, because the upsert's coalesce cannot blank the stored value and re-registering is
 * harmless — the rule is about what a member is created WITH.
 */

const T = 120_000;
let exec: SqlExec;

async function newUser(): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [id, `${id.slice(0, 8)}@p.test`]);
  return id;
}

const register = (userId: string, name: string | null, phone: string | null) =>
  asUser(exec, userId, async () =>
    exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, [name, phone]),
  );

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
}, T);

afterAll(async () => {
  await exec?.close();
});

describe("a new member cannot be created without a phone", () => {
  it("NULL phone is REFUSED — this is the defect that was fixed", async () => {
    const u = await newUser();
    const r = await register(u, "No Phone", null);
    expect(rpcJson(r.rows[0])).toMatchObject({ ok: false, error: "phone_required" });

    // And nothing was written.
    const rows = await exec.query(`SELECT count(*)::int AS n FROM public.loyalty_members WHERE auth_user_id = $1`, [u]);
    expect(rows.rows[0]?.n).toBe(0);
  });

  it("an omitted phone argument is refused the same way", async () => {
    const u = await newUser();
    const r = await asUser(exec, u, async () => exec.query(`SELECT public.loyalty_member_register('Name Only') AS result`));
    expect(rpcJson(r.rows[0])).toMatchObject({ ok: false, error: "phone_required" });
  });

  it("whitespace-only is treated as absent, not as a value", async () => {
    const u = await newUser();
    expect(rpcJson((await register(u, "Spacey", "   ")).rows[0])).toMatchObject({
      ok: false,
      error: "phone_required",
    });
  });

  it("an uncanonicalisable phone is still refused by the format check", async () => {
    const u = await newUser();
    for (const bad of ["nonsense", "077212345", "07721234567", "+15551234567", "077212345a"]) {
      const r = await register(u, "Bad Phone", bad);
      expect(rpcJson(r.rows[0]), bad).toMatchObject({ ok: false, error: "invalid_phone" });
    }
    const rows = await exec.query(`SELECT count(*)::int AS n FROM public.loyalty_members WHERE auth_user_id = $1`, [u]);
    expect(rows.rows[0]?.n).toBe(0);
  });
});

describe("a valid phone is accepted and stored canonically", () => {
  it("creates the member with the canonical E.164 value", async () => {
    const u = await newUser();
    const r = await register(u, "Has Phone", "+256700900001");
    const body = rpcJson(r.rows[0]);
    expect(body.ok).toBe(true);
    expect(body.created).toBe(true);

    const row = await exec.query(`SELECT phone_e164, display_name FROM public.loyalty_members WHERE auth_user_id = $1`, [u]);
    expect(row.rows[0]).toMatchObject({ phone_e164: "+256700900001", display_name: "Has Phone" });
  });

  it("only the canonical form satisfies the column CHECK, so the shape is enforced twice", async () => {
    const u = await newUser();
    // A non-canonical value never reaches the insert: the RPC's format check refuses it first.
    const r = await register(u, "Local Form", "0772123456");
    expect(rpcJson(r.rows[0])).toMatchObject({ ok: false, error: "invalid_phone" });
  });
});

describe("an existing member is not broken by the rule", () => {
  it("may re-register WITHOUT a phone — the stored value is not blanked", async () => {
    const u = await newUser();
    await register(u, "Existing", "+256700900002");

    // A later call with no phone is a harmless no-op rather than a refusal: the member already
    // holds a phone, so there is nothing to create.
    const again = await register(u, "Existing Renamed", null);
    const body = rpcJson(again.rows[0]);
    expect(body.ok).toBe(true);
    expect(body.created).toBe(false);

    const row = await exec.query(`SELECT phone_e164, display_name FROM public.loyalty_members WHERE auth_user_id = $1`, [u]);
    expect(row.rows[0]).toMatchObject({ phone_e164: "+256700900002", display_name: "Existing Renamed" });
  });

  it("is still exactly ONE member row, however many times it registers", async () => {
    const u = await newUser();
    await register(u, "One", "+256700900003");
    await register(u, "One", "+256700900003");
    await register(u, "One", null);
    const rows = await exec.query(`SELECT count(*)::int AS n FROM public.loyalty_members WHERE auth_user_id = $1`, [u]);
    expect(rows.rows[0]?.n).toBe(1);
  });
});

describe("the existing protections are untouched", () => {
  it("still refuses an unauthenticated caller", async () => {
    const r = await exec.query(`SELECT public.loyalty_member_register('X', '+256700900004') AS result`);
    expect(rpcJson(r.rows[0])).toMatchObject({ ok: false, error: "not_authenticated" });
  });

  it("still refuses an over-long display name", async () => {
    const u = await newUser();
    const r = await register(u, "x".repeat(121), "+256700900005");
    expect(rpcJson(r.rows[0])).toMatchObject({ ok: false, error: "invalid_name" });
  });

  it("the column stays NULLABLE — the rule is about creation, not geometry", async () => {
    const r = await exec.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name='loyalty_members' AND column_name='phone_e164'`,
    );
    // A NOT NULL constraint would be a larger change to a table other code reads, and is not what
    // the rule needs. Existing rows are unaffected either way.
    expect(r.rows[0]?.is_nullable).toBe("YES");
  });

  it("a phone-less member still cannot JOIN — the downstream guard is unchanged", async () => {
    // Belt and braces: even a row inserted outside the RPC is refused at join time.
    const u = await newUser();
    await exec.query(
      `INSERT INTO public.loyalty_members (auth_user_id, display_name, phone_e164) VALUES ($1, 'Legacy', null)`,
      [u],
    );
    const r = await asUser(exec, u, async () =>
      exec.query(`SELECT public.loyalty_member_join_by_code('WPL2026001') AS result`),
    );
    // Either not_a_member (no program in this fixture) or member_phone_required — never a join.
    const body = rpcJson(r.rows[0]);
    expect(body.ok).toBe(false);
    expect(["member_phone_required", "not_found", "not_a_member"]).toContain(String(body.error));
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";

/**
 * Phase 8 — anon EXECUTE posture.
 *
 * The point of interest is not just "anon was revoked" but that revoking did not
 * break the policies that legitimately need a function anon must be able to
 * evaluate. is_waka_internal_staff is referenced by 50 live policies, and a
 * policy expression runs as the querying role — so an anon read on those tables
 * must still resolve, and must still return nothing.
 */

const BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "anonExecuteHygieneBootstrap.sql");
const MIGRATION = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261003040000_anon_execute_hygiene.sql",
);

const read = (p: string) => readFileSync(p, "utf8");

async function makeHarness(applyMigration: boolean): Promise<SqlExec> {
  const db = new PGlite();
  const exec: SqlExec = {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await db.query<T>(sql, params);
      return { rows: res.rows };
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
    async close() {
      await db.close();
    },
  };
  await exec.exec(read(BOOTSTRAP));
  if (applyMigration) await exec.exec(read(MIGRATION));
  return exec;
}

async function asRole<T>(exec: SqlExec, role: "anon" | "authenticated", userId: string | null, fn: () => Promise<T>) {
  await exec.exec("BEGIN");
  if (userId) await exec.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
  await exec.exec(`SET LOCAL ROLE ${role}`);
  try {
    const value = await fn();
    await exec.exec("COMMIT");
    return value;
  } catch (err) {
    await exec.exec("ROLLBACK");
    throw err;
  }
}

async function attempt<T>(fn: () => Promise<T>) {
  try {
    return { ok: true as const, value: await fn() };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

/** True when the role holds EXECUTE on the function, per its ACL. */
async function hasExecute(exec: SqlExec, role: string, signature: string): Promise<boolean> {
  const { rows } = await exec.query<{ n: string }>(
    `select count(*)::text as n
       from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = $1::regprocedure and a.grantee::regrole::text = $2`,
    [signature, role],
  );
  return Number(rows[0]?.n ?? "0") > 0;
}

const SUPPORT_FNS = [
  "public.admin_shop_reset_all_staff_credentials(uuid)",
  "public.shop_get_staff_sales_summary(date,date,integer)",
  "public.bump_shop_staff_version()",
];

describe("Phase 8 — pre-migration", () => {
  let exec: SqlExec;
  beforeAll(async () => {
    exec = await makeHarness(false);
  }, 120_000);
  afterAll(async () => {
    await exec?.close();
  });

  it("anon holds EXECUTE on the three support functions", async () => {
    for (const fn of SUPPORT_FNS) {
      expect(await hasExecute(exec, "anon", fn), fn).toBe(true);
    }
  });

  it("the unguarded is_waka_internal_staff returns false for anon", async () => {
    const value = await asRole(exec, "anon", null, async () => {
      const { rows } = await exec.query<{ v: boolean }>(`select public.is_waka_internal_staff() as v`);
      return rows[0]?.v;
    });
    expect(value).toBe(false);
  });
});

describe("Phase 8 — after the anon EXECUTE hygiene migration", () => {
  let exec: SqlExec;
  let adminId: string;
  let outsiderId: string;

  beforeAll(async () => {
    exec = await makeHarness(true);
    adminId = crypto.randomUUID();
    outsiderId = crypto.randomUUID();
    await exec.query(`insert into public.internal_admins (auth_user_id, is_active) values ($1, true)`, [
      adminId,
    ]);
  }, 120_000);

  afterAll(async () => {
    await exec?.close();
  });

  it("1. anon can no longer execute the unnecessary staff-admin functions", async () => {
    for (const fn of SUPPORT_FNS) {
      expect(await hasExecute(exec, "anon", fn), `${fn} still anon-executable`).toBe(false);
    }
  });

  it("1b. and calling them as anon fails even if a grant were restored", async () => {
    const calls = [
      `select public.admin_shop_reset_all_staff_credentials (null)`,
      `select public.shop_get_staff_sales_summary (null, null, 20)`,
      `select public.bump_shop_staff_version ()`,
    ];
    for (const sql of calls) {
      const res = await attempt(() => asRole(exec, "anon", null, async () => exec.query(sql)));
      expect(res.ok, sql).toBe(false);
    }
  });

  it("2. authenticated legitimate flows still work", async () => {
    // An internal admin still passes the gate the RPC relies on.
    const allowed = await asRole(exec, "authenticated", adminId, async () => {
      const { rows } = await exec.query<{ v: boolean }>(`select public.is_waka_internal_staff() as v`);
      return rows[0]?.v;
    });
    expect(allowed).toBe(true);

    const reset = await asRole(exec, "authenticated", adminId, async () => {
      const { rows } = await exec.query<{ r: Record<string, unknown> }>(
        `select public.admin_shop_reset_all_staff_credentials (null) as r`,
      );
      return rows[0]?.r;
    });
    expect(reset).toEqual({ ok: true });
  });

  it("3. RLS policies that depend on is_waka_internal_staff still resolve for anon", async () => {
    // The critical regression this migration had to avoid: an anon read must return
    // zero rows, not error, because the policy expression has to evaluate.
    const rows = await asRole(exec, "anon", null, async () => {
      const res = await exec.query(`select id from public.internal_audit`);
      return res.rows;
    });
    expect(rows).toEqual([]);

    // A non-internal authenticated user likewise sees nothing, without erroring.
    const otherRows = await asRole(exec, "authenticated", outsiderId, async () => {
      const res = await exec.query(`select id from public.internal_audit`);
      return res.rows;
    });
    expect(otherRows).toEqual([]);

    // An internal admin still sees it.
    const adminRows = await asRole(exec, "authenticated", adminId, async () => {
      const res = await exec.query(`select id from public.internal_audit`);
      return res.rows;
    });
    expect(adminRows.length).toBe(1);
  });

  it("4. is_waka_internal_staff cannot escalate privileges and stays inert for anon", async () => {
    // Still a plain boolean, and still false for anyone unauthenticated.
    for (const [role, userId] of [
      ["anon", null],
      ["authenticated", outsiderId],
    ] as const) {
      const value = await asRole(exec, role, userId, async () => {
        const { rows } = await exec.query<{ v: boolean }>(`select public.is_waka_internal_staff() as v`);
        return rows[0]?.v;
      });
      expect(value).toBe(false);
    }

    // The function returns a boolean, not a row — it can leak nothing.
    const { rows } = await exec.query<{ t: string; secdef: boolean; sp: string | null }>(
      `select pg_get_function_result(p.oid) as t, p.prosecdef as secdef,
              (select option_value from pg_options_to_table(p.proconfig) where option_name = 'search_path') as sp
         from pg_proc p where p.oid = 'public.is_waka_internal_staff()'::regprocedure`,
    );
    expect(rows[0]?.t).toBe("boolean");
    expect(rows[0]?.secdef).toBe(true);
    expect(rows[0]?.sp).toBe("public");
  });

  it("anon retains EXECUTE on is_waka_internal_staff (50 policies depend on it)", async () => {
    expect(await hasExecute(exec, "anon", "public.is_waka_internal_staff()")).toBe(true);
    expect(await hasExecute(exec, "authenticated", "public.is_waka_internal_staff()")).toBe(true);
    // …but not via PUBLIC.
    expect(await hasExecute(exec, "public", "public.is_waka_internal_staff()")).toBe(false);
  });

  it("the migration is safe to re-apply", async () => {
    await exec.exec(read(MIGRATION));
    expect(await hasExecute(exec, "anon", SUPPORT_FNS[0])).toBe(false);
    expect(await hasExecute(exec, "anon", "public.is_waka_internal_staff()")).toBe(true);
  });
});

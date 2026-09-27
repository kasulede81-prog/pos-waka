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
 * Phase 6D — final control-plane security audit, run under the PRODUCTION privilege posture.
 *
 * The default harness never grants table DML to `authenticated`, so a "permission denied"
 * there can mean "never granted". Here the harness reproduces 010_grants.sql (blanket DML on
 * every table) and the 030 `FOR ALL` internal-staff policy on internal_ops_admin_audit before
 * the migrations run, so each denial below proves a Phase 6 revoke or policy is doing the work.
 *
 * Regression for the 6D defect: any internal staff member (support_admin, field_agent, ...)
 * could erase, rewrite or forge Loyalty control-plane audit events through PostgREST.
 */

const T = 120_000;
const REASON = "phase 6d: audit hardening regression";

let exec: SqlExec;
let f: LoyaltyFixture;
let opsAdminId: string;
let supportAdminId: string;
let fieldAgentId: string;

const ADMIN_RPCS = [
  "public.internal_ops_loyalty_create_plan(text, text, integer, bigint, bigint, integer, text)",
  "public.internal_ops_loyalty_update_plan(text, text, integer, bigint, bigint, integer, text)",
  "public.internal_ops_loyalty_set_plan_active(text, boolean, text)",
  "public.internal_ops_loyalty_set_shop_entitlement(uuid, text, text, text)",
  "public.internal_ops_loyalty_plan_impact(text, integer)",
  "public.internal_ops_loyalty_shop_state(uuid)",
  "public.internal_ops_loyalty_admin_overview()",
  "public.internal_ops_loyalty_admin_plans()",
  "public.internal_ops_loyalty_admin_shop_states(text, text, integer)",
];

async function newUser(role: string): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, [id, `${role}-${id.slice(0, 6)}@test.local`]);
  await exec.query(`INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ($1,$2,$3)`, [f.shopAId, id, role]);
  return id;
}

/** Run a statement as `userId` and report how many rows it affected, or the error message. */
async function attempt(userId: string, sql: string, params: unknown[] = []): Promise<{ rows: number } | { error: string }> {
  try {
    return await asUser(exec, userId, async () => {
      const { rows } = await exec.query(`WITH w AS (${sql} RETURNING 1) SELECT count(*)::int AS n FROM w`, params);
      return { rows: Number((rows[0] as { n: number }).n) };
    });
  } catch (err) {
    return { error: String((err as Error).message) };
  }
}

async function loyaltyAuditRows(): Promise<Array<{ id: string; action: string; payload: string }>> {
  const { rows } = await exec.query<{ id: string; action: string; payload: string }>(
    `SELECT id::text, action, payload::text AS payload FROM public.internal_ops_admin_audit
      WHERE left(action, 8) = 'loyalty_' ORDER BY id`,
  );
  return rows;
}

beforeAll(async () => {
  exec = await createLoyaltySqlHarness({ productionGrants: true });
  f = await seedLoyaltyFixture(exec);
  opsAdminId = await newUser("operations_admin");
  supportAdminId = await newUser("support_admin");
  fieldAgentId = await newUser("field_agent");

  // Real Phase 6 audit events, written the only legitimate way: through the RPCs.
  await asUser(exec, opsAdminId, async () => {
    await exec.query(`SELECT public.internal_ops_loyalty_create_plan('p6d_plan','6D',25,0,0,0,$1)`, [REASON]);
    await exec.query(`SELECT public.internal_ops_loyalty_set_shop_entitlement($1,'active','p6d_plan',$2)`, [f.shopAId, REASON]);
  });
}, T);

afterAll(async () => {
  await exec.close();
});

describe("the harness really reproduces production grants", () => {
  it("authenticated holds the 010 blanket DML on an ordinary table", async () => {
    const { rows } = await exec.query<{ ok: boolean }>(
      `SELECT has_table_privilege('authenticated', 'public.internal_ops_admin_audit', 'DELETE') AS ok`,
    );
    expect(rows[0]!.ok).toBe(true);
  });
});

describe("control-plane tables: the Phase 6A revokes hold against the production grants", () => {
  it("authenticated has no INSERT/UPDATE/DELETE on the plan catalog or the entitlements", async () => {
    const { rows } = await exec.query<{ t: string; i: boolean; u: boolean; d: boolean }>(
      `SELECT t, has_table_privilege('authenticated', t, 'INSERT') i, has_table_privilege('authenticated', t, 'UPDATE') u,
              has_table_privilege('authenticated', t, 'DELETE') d
         FROM unnest(array['public.loyalty_plan_tiers','public.organization_feature_entitlements','public.loyalty_programs']) t`,
    );
    for (const r of rows) expect(r, r.t).toMatchObject({ i: false, u: false, d: false });
  });

  it("neither a merchant owner nor an authorized internal admin can bypass the RPCs", async () => {
    for (const user of [f.ownerAId, opsAdminId, f.internalAdminId]) {
      for (const sql of [
        `INSERT INTO public.loyalty_plan_tiers (code, name, member_limit) VALUES ('p6d_direct','D',1)`,
        `UPDATE public.loyalty_plan_tiers SET member_limit = 1 WHERE code = 'free'`,
        `UPDATE public.organization_feature_entitlements SET status = 'none' WHERE organization_id = '${f.orgId}'`,
        `DELETE FROM public.organization_feature_entitlements WHERE organization_id = '${f.orgId}'`,
      ]) {
        const r = await attempt(user, sql);
        expect("error" in r ? r.error : `affected ${r.rows}`, sql).toMatch(/permission denied/i);
      }
    }
  });
});

describe("Loyalty audit events are tamper-proof from the browser (6D regression)", () => {
  it("the RPCs still write their audit events under RLS", async () => {
    const actions = (await loyaltyAuditRows()).map((r) => r.action);
    expect(actions).toContain("loyalty_plan_created");
    expect(actions).toContain("loyalty_shop_entitlement_set");
  });

  it("no internal staff role can DELETE or UPDATE a Loyalty audit event", async () => {
    const before = await loyaltyAuditRows();
    expect(before.length).toBeGreaterThanOrEqual(2);
    for (const user of [supportAdminId, fieldAgentId, opsAdminId, f.internalAdminId]) {
      const del = await attempt(user, `DELETE FROM public.internal_ops_admin_audit WHERE left(action, 8) = 'loyalty_'`);
      expect(del).toEqual({ rows: 0 });
      const upd = await attempt(
        user,
        `UPDATE public.internal_ops_admin_audit SET payload = '{"reason":"rewritten"}'::jsonb WHERE left(action, 8) = 'loyalty_'`,
      );
      expect(upd).toEqual({ rows: 0 });
    }
    expect(await loyaltyAuditRows()).toEqual(before);
  });

  it("no internal staff role can forge a Loyalty audit event, or rename another event into one", async () => {
    const before = await loyaltyAuditRows();
    for (const user of [supportAdminId, fieldAgentId, opsAdminId]) {
      const forged = await attempt(
        user,
        `INSERT INTO public.internal_ops_admin_audit (actor, action, payload)
         VALUES ($1, 'loyalty_plan_updated', '{"reason":"forged"}'::jsonb)`,
        [user],
      );
      expect("error" in forged ? forged.error : "inserted", "forged insert").toMatch(/row-level security/i);
    }

    // A legitimate non-Loyalty event (the rescue console's direct insert path) still works...
    const rescue = await attempt(
      supportAdminId,
      `INSERT INTO public.internal_ops_admin_audit (actor, action, payload) VALUES ($1, 'rescue_pin_reset', '{}'::jsonb)`,
      [supportAdminId],
    );
    expect(rescue).toEqual({ rows: 1 });
    // ...but it cannot be renamed into the Loyalty namespace afterwards.
    const renamed = await attempt(
      supportAdminId,
      `UPDATE public.internal_ops_admin_audit SET action = 'loyalty_plan_created' WHERE action = 'rescue_pin_reset'`,
    );
    expect("error" in renamed ? renamed.error : "renamed").toMatch(/row-level security/i);

    expect(await loyaltyAuditRows()).toEqual(before);
  });

  it("non-Loyalty audit behavior is unchanged: staff can still read, edit and remove their own rows", async () => {
    const read = await asUser(exec, supportAdminId, async () => {
      const { rows } = await exec.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.internal_ops_admin_audit WHERE left(action, 8) = 'loyalty_'`,
      );
      return Number(rows[0]!.n);
    });
    expect(read).toBeGreaterThanOrEqual(2);
    expect(
      await attempt(supportAdminId, `UPDATE public.internal_ops_admin_audit SET payload = '{"x":1}'::jsonb WHERE action = 'rescue_pin_reset'`),
    ).toEqual({ rows: 1 });
    expect(await attempt(supportAdminId, `DELETE FROM public.internal_ops_admin_audit WHERE action = 'rescue_pin_reset'`)).toEqual({
      rows: 1,
    });
  });

  it("a merchant can neither read nor write the internal audit trail", async () => {
    const n = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.internal_ops_admin_audit`);
      return Number(rows[0]!.n);
    });
    expect(n).toBe(0);
    const ins = await attempt(
      f.ownerAId,
      `INSERT INTO public.internal_ops_admin_audit (actor, action, payload) VALUES ($1, 'rescue_pin_reset', '{}'::jsonb)`,
      [f.ownerAId],
    );
    expect("error" in ins ? ins.error : "inserted").toMatch(/row-level security/i);
  });
});

describe("function-level exposure of every Loyalty admin RPC", () => {
  it("all nine are SECURITY DEFINER with a pinned search_path", async () => {
    for (const sig of ADMIN_RPCS) {
      const { rows } = await exec.query<{ secdef: boolean; cfg: string[] | null }>(
        `SELECT prosecdef AS secdef, proconfig AS cfg FROM pg_proc WHERE oid = to_regprocedure($1)`,
        [sig],
      );
      expect(rows, sig).toHaveLength(1);
      expect(rows[0]!.secdef, sig).toBe(true);
      expect(rows[0]!.cfg ?? [], sig).toContain("search_path=public");
    }
  });

  it("none is executable by anon or PUBLIC; authenticated relies on the in-function role guard", async () => {
    for (const sig of ADMIN_RPCS) {
      const { rows } = await exec.query<{ anon: boolean; auth: boolean; pub: boolean }>(
        `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
                EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         WHERE p.oid = to_regprocedure($1) AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS pub`,
        [sig],
      );
      expect(rows[0], sig).toEqual({ anon: false, auth: true, pub: false });
    }
  });

  it("support_admin and field_agent are refused by every admin RPC even when invoked manually", async () => {
    for (const user of [supportAdminId, fieldAgentId]) {
      for (const sql of [
        `public.internal_ops_loyalty_create_plan('p6d_x','X',1,0,0,0,'${REASON}')`,
        `public.internal_ops_loyalty_update_plan('free','Free',1,0,0,0,'${REASON}')`,
        `public.internal_ops_loyalty_set_plan_active('p6d_plan',false,'${REASON}')`,
        `public.internal_ops_loyalty_set_shop_entitlement('${f.shopAId}','none',null,'${REASON}')`,
        `public.internal_ops_loyalty_plan_impact('free',1)`,
        `public.internal_ops_loyalty_shop_state('${f.shopAId}')`,
        `public.internal_ops_loyalty_admin_overview()`,
        `public.internal_ops_loyalty_admin_plans()`,
        `public.internal_ops_loyalty_admin_shop_states(null,'all',10)`,
      ]) {
        const r = await asUser(exec, user, async () => {
          const { rows } = await exec.query(`SELECT ${sql} AS result`);
          return rpcJson(rows[0]);
        });
        expect(r, sql).toMatchObject({ ok: false, error: "forbidden" });
      }
    }
  });
});

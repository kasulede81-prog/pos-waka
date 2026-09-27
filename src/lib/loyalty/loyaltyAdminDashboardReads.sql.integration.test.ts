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
 * Phase 6B — internal-admin Loyalty dashboard reads.
 *
 * The dashboard is a read surface: three new overview/catalog/shop readers plus the two
 * Phase 6A per-tier and per-shop readers. These tests hold the whole contract — an
 * authorized internal admin gets the numbers, nobody else does, and the dashboard has no
 * path to a protected table or to any mutation.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

async function asAnon<T>(fn: () => Promise<T>): Promise<T> {
  await exec.exec("BEGIN");
  await exec.exec("SET LOCAL ROLE anon");
  try {
    const out = await fn();
    await exec.exec("COMMIT");
    return out;
  } catch (err) {
    await exec.exec("ROLLBACK");
    throw err;
  }
}

async function newOrg(label: string): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO public.organizations (id, name) VALUES ($1,$2)`, [id, label]);
  return id;
}

async function newShop(label: string, orgId: string): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.shops (id, organization_id, name, shop_number) VALUES ($1,$2,$3,$4)`,
    [id, orgId, label, label.slice(0, 8).toUpperCase()],
  );
  return id;
}

async function seedMembers(shopId: string, n: number): Promise<void> {
  await exec.query(
    `INSERT INTO public.customers (shop_id, name) SELECT $1, 'M' || g FROM generate_series(1,$2) g`,
    [shopId, n],
  );
  await exec.query(
    `INSERT INTO public.loyalty_accounts (shop_id, customer_id)
     SELECT $1, c.id FROM public.customers c
      WHERE c.shop_id = $1 AND NOT EXISTS (SELECT 1 FROM public.loyalty_accounts a WHERE a.customer_id = c.id)`,
    [shopId],
  );
}

async function adminRpc(fn: string, args: unknown[] = []) {
  return asUser(exec, f.internalAdminId, async () => {
    const { rows } = await exec.query(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS result`, args);
    return rpcJson(rows[0]);
  });
}

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
}, T);

afterAll(async () => {
  await exec.close();
});

describe("authorized internal admin reads the dashboard", () => {
  it("returns the platform overview with a coherent shape", async () => {
    const org = await newOrg("Dash Org");
    const shop = await newShop("Dash Shop", org);
    await seedMembers(shop, 4);

    const o = await adminRpc("internal_ops_loyalty_admin_overview");
    expect(o.ok).toBe(true);
    // The seeded org counts, and the new org's members are included.
    expect(Number(o.organizations_enabled)).toBeGreaterThanOrEqual(1);
    expect(Number(o.shops_enabled)).toBeGreaterThanOrEqual(1);
    expect(Number(o.active_members)).toBeGreaterThanOrEqual(4);
    expect(Number(o.members_over_limit)).toBeGreaterThanOrEqual(0);
    expect(Number(o.plans_active)).toBeGreaterThanOrEqual(1);
    expect(o.default_tier_code).toBeTruthy();
  });

  it("returns the plan catalog with usage counts and the default tier", async () => {
    const r = await adminRpc("internal_ops_loyalty_admin_plans");
    expect(r.ok).toBe(true);
    const plans = r.plans as Array<Record<string, unknown>>;
    expect(plans.length).toBeGreaterThanOrEqual(4);

    const free = plans.find((p) => p.code === "free")!;
    expect(free.is_default).toBe(true);
    expect(free.is_active).toBe(true);
    expect(Number(free.member_limit)).toBe(50);
    // The default tier's usage includes organizations with no explicit assignment, which
    // is the whole point of counting it.
    expect(Number(free.organizations)).toBeGreaterThanOrEqual(1);

    const codes = plans.map((p) => p.code);
    expect(codes).toContain("starter");
    expect(codes).toContain("business");
    expect(codes).toContain("pro");
  });

  it("returns shop states, and supports search and the enabled/disabled filters", async () => {
    const orgOn = await newOrg("Filter On Org");
    const shopOn = await newShop("Alpha Enabled Shop", orgOn);
    const orgOff = await newOrg("Filter Off Org");
    await newShop("Beta Disabled Shop", orgOff);
    await seedMembers(shopOn, 2);
    await exec.query(
      `UPDATE public.organization_feature_entitlements SET status = 'none'
        WHERE organization_id = $1 AND feature_code = 'loyalty'`,
      [orgOff],
    );

    const all = await adminRpc("internal_ops_loyalty_admin_shop_states", [null, "all", 100]);
    expect(all.ok).toBe(true);
    const names = (all.shops as Array<Record<string, unknown>>).map((s) => s.shop_name);
    expect(names).toContain("Alpha Enabled Shop");
    expect(names).toContain("Beta Disabled Shop");

    const enabled = await adminRpc("internal_ops_loyalty_admin_shop_states", [null, "enabled", 100]);
    const enabledNames = (enabled.shops as Array<Record<string, unknown>>).map((s) => s.shop_name);
    expect(enabledNames).toContain("Alpha Enabled Shop");
    expect(enabledNames).not.toContain("Beta Disabled Shop");

    const disabled = await adminRpc("internal_ops_loyalty_admin_shop_states", [null, "disabled", 100]);
    const disabledNames = (disabled.shops as Array<Record<string, unknown>>).map((s) => s.shop_name);
    expect(disabledNames).toContain("Beta Disabled Shop");
    expect(disabledNames).not.toContain("Alpha Enabled Shop");

    const searched = await adminRpc("internal_ops_loyalty_admin_shop_states", ["Alpha", "all", 100]);
    const searchedNames = (searched.shops as Array<Record<string, unknown>>).map((s) => s.shop_name);
    expect(searchedNames).toEqual(["Alpha Enabled Shop"]);
  });

  it("an operations_admin (the other allowed role) can read too", async () => {
    const opsAdmin = crypto.randomUUID();
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, [
      opsAdmin,
      "ops@test.local",
    ]);
    await exec.query(`INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ($1,$2,'operations_admin')`, [
      f.shopAId,
      opsAdmin,
    ]);
    const o = await asUser(exec, opsAdmin, async () => {
      const { rows } = await exec.query(`SELECT public.internal_ops_loyalty_admin_overview() AS result`);
      return rpcJson(rows[0]);
    });
    expect(o.ok).toBe(true);
  });
});

describe("unauthorized callers are rejected server-side", () => {
  it("a merchant owner, a cashier and an anonymous caller are all refused", async () => {
    for (const userId of [f.ownerAId, f.cashierAId]) {
      for (const fn of [
        "internal_ops_loyalty_admin_overview()",
        "internal_ops_loyalty_admin_plans()",
        "internal_ops_loyalty_admin_shop_states(null,null,null)",
        "internal_ops_loyalty_shop_state(null)",
      ]) {
        const r = await asUser(exec, userId, async () => {
          const { rows } = await exec.query(`SELECT public.${fn} AS result`);
          return rpcJson(rows[0]);
        });
        expect(r.ok).toBe(false);
        expect(r.error).toBe("forbidden");
      }
    }

    await expect(
      asAnon(async () => {
        await exec.query(`SELECT public.internal_ops_loyalty_admin_overview()`);
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("an unknown filter is refused rather than silently ignored", async () => {
    const r = await adminRpc("internal_ops_loyalty_admin_shop_states", [null, "nonsense", 100]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("invalid_filter");
  });
});

describe("the dashboard cannot reach protected tables directly", () => {
  it("the client module reads only through RPCs", () => {
    const src = readFileSync(join(process.cwd(), "src", "lib", "loyaltyAdmin.ts"), "utf8");
    // No PostgREST table access at all.
    expect(src).not.toMatch(/\.from\(/);
    expect(src).toMatch(/supabase\.rpc\(/);
    // ...and no mutation RPC name appears anywhere in the read layer.
    for (const banned of [
      "internal_ops_loyalty_create_plan",
      "internal_ops_loyalty_update_plan",
      "internal_ops_loyalty_set_plan_active",
      "internal_ops_loyalty_set_shop_entitlement",
      "loyalty_adjust_points",
      "loyalty_set_account_lifecycle",
      "loyalty_review_enrollment_request",
    ]) {
      expect(src).not.toContain(banned);
    }
  });

  // Phase 6C added action dialogs, but they reach the mutation RPCs only through
  // lib/loyaltyAdminActions.ts — the page itself still never names an RPC or a table.
  it("the dashboard component never calls an RPC or table directly", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "internal-admin",
        "v2",
        "pages",
        "AdminLoyaltyPage.tsx",
      ),
      "utf8",
    );
    for (const banned of [
      "internal_ops_loyalty_create_plan",
      "internal_ops_loyalty_update_plan",
      "internal_ops_loyalty_set_plan_active",
      "internal_ops_loyalty_set_shop_entitlement",
      "loyalty_adjust_points",
      "loyalty_set_account_lifecycle",
    ]) {
      expect(src).not.toContain(banned);
    }
    expect(src).not.toMatch(/\.from\(|\.rpc\(/);
  });

  it("the entitlement table has no client write policy left", async () => {
    // Phase 6A narrowed the old `for all` internal policy to SELECT, so no INSERT/UPDATE/
    // DELETE policy admits any client role — the write path is the control-plane RPCs only.
    const { rows } = await exec.query<{ cmd: string }>(
      `SELECT cmd FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'organization_feature_entitlements'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) expect(r.cmd).toBe("SELECT");
  });

  it("a merchant cannot read another organization's entitlement", async () => {
    const otherOrg = await newOrg("Private Org");
    await exec.query(
      `INSERT INTO public.organization_feature_entitlements (organization_id, feature_code, status, plan_code)
       VALUES ($1,'loyalty','active','pro')
       ON CONFLICT (organization_id, feature_code) DO UPDATE SET status = 'active', plan_code = 'pro'`,
      [otherOrg],
    );

    // ownerA is not a member of that organization: the row must be invisible. Depending on
    // the environment this surfaces as a denial or as zero rows; either is the protection.
    let visible: number | null = null;
    try {
      const rows = await asUser(exec, f.ownerAId, async () => {
        const { rows } = await exec.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public.organization_feature_entitlements WHERE organization_id = $1`,
          [otherOrg],
        );
        return rows;
      });
      visible = Number(rows[0]!.n);
    } catch {
      visible = null;
    }
    expect(visible === null || visible === 0).toBe(true);
  });
});

describe("plan impact and shop detail read correctly", () => {
  it("reports the blast radius for a tier, and over-limit shops under it", async () => {
    // A tier with a generous limit, three shops on it, then measure against a tight limit.
    const created = await asUser(exec, f.internalAdminId, async () => {
      const { rows } = await exec.query(
        `SELECT public.internal_ops_loyalty_create_plan('p6b_impact','Impact',100,0,0,9,'phase 6b test') AS result`,
      );
      return rpcJson(rows[0]);
    });
    expect(created.ok).toBe(true);

    for (let i = 0; i < 3; i += 1) {
      const org = await newOrg(`Impact Org ${i}`);
      const shop = await newShop(`Impact Shop ${i}`, org);
      await exec.query(
        `INSERT INTO public.organization_feature_entitlements (organization_id, feature_code, status, plan_code)
         VALUES ($1,'loyalty','active','p6b_impact')
         ON CONFLICT (organization_id, feature_code) DO UPDATE SET plan_code = 'p6b_impact', status = 'active'`,
        [org],
      );
      await seedMembers(shop, 5);
    }

    const generous = await adminRpc("internal_ops_loyalty_plan_impact", ["p6b_impact", 100]);
    expect(generous.ok).toBe(true);
    expect(Number(generous.organizations)).toBe(3);
    expect(Number(generous.shops)).toBe(3);
    expect(Number(generous.shops_over_limit)).toBe(0);
    expect(Number(generous.members_over_limit)).toBe(0);

    const tight = await adminRpc("internal_ops_loyalty_plan_impact", ["p6b_impact", 2]);
    expect(tight.ok).toBe(true);
    expect(Number(tight.shops_over_limit)).toBe(3);
    expect(Number(tight.members_over_limit)).toBe(9); // 3 shops × (5 - 2)
  });

  it("reports a shop's authoritative state, including the over-limit flag", async () => {
    // A small tier so the shop is genuinely over its allowance.
    const created = await asUser(exec, f.internalAdminId, async () => {
      const { rows } = await exec.query(
        `SELECT public.internal_ops_loyalty_create_plan('p6b_tiny','Tiny',2,0,0,9,'phase 6b test') AS result`,
      );
      return rpcJson(rows[0]);
    });
    expect(created.ok).toBe(true);

    const org = await newOrg("Detail Org");
    const shop = await newShop("Detail Shop", org);
    // Members first (the default tier allows 50), then the tight tier — the enforcement
    // guard would rightly refuse the 3rd member if the allowance were already 2.
    await seedMembers(shop, 4);
    await exec.query(
      `INSERT INTO public.organization_feature_entitlements (organization_id, feature_code, status, plan_code)
       VALUES ($1,'loyalty','active','p6b_tiny')
       ON CONFLICT (organization_id, feature_code) DO UPDATE SET plan_code = 'p6b_tiny', status = 'active'`,
      [org],
    );

    const detail = await adminRpc("internal_ops_loyalty_shop_state", [shop]);
    expect(detail.ok).toBe(true);
    expect(detail.over_limit).toBe(true);
    const usage = detail.usage as Record<string, unknown>;
    expect(Number(usage.member_limit)).toBe(2);
    expect(Number(usage.active_members)).toBe(4);
    expect(Number(usage.remaining)).toBe(0);
  });

  it("a disabled shop reports disabled state and no allowance consumption", async () => {
    const org = await newOrg("Disabled Detail Org");
    const shop = await newShop("Disabled Detail Shop", org);
    await seedMembers(shop, 3);
    await exec.query(
      `UPDATE public.organization_feature_entitlements SET status = 'none'
        WHERE organization_id = $1 AND feature_code = 'loyalty'`,
      [org],
    );

    const detail = await adminRpc("internal_ops_loyalty_shop_state", [shop]);
    expect(detail.ok).toBe(true);
    const usage = detail.usage as Record<string, unknown>;
    expect(usage.loyalty_enabled).toBe(false);
    expect(Number(usage.member_limit)).toBe(0);
    expect(detail.over_limit).toBe(false);
    expect(detail.entitlement_status).toBe("none");

    // Disabled organizations are excluded from the platform "enabled" totals.
    const states = await adminRpc("internal_ops_loyalty_admin_shop_states", ["Disabled Detail Shop", "all", 10]);
    const row = (states.shops as Array<Record<string, unknown>>)[0]!;
    expect(row.loyalty_enabled).toBe(false);
    expect(row.entitlement_status).toBe("none");
    // The members are still there — disabling never removes them.
    expect(Number(row.active_members)).toBe(3);
  });
});

describe("no secrets on the read surface", () => {
  it("returns no tokens, wallet ids or credentials", async () => {
    const payloads = [
      JSON.stringify(await adminRpc("internal_ops_loyalty_admin_overview")),
      JSON.stringify(await adminRpc("internal_ops_loyalty_admin_plans")),
      JSON.stringify(await adminRpc("internal_ops_loyalty_admin_shop_states", [null, "all", 100])),
    ].join(" ");
    for (const banned of [
      "qr_token",
      "public_card_token",
      "google_wallet_object_id",
      "service_role",
      "private_key",
      "eyJ",
      "password",
    ]) {
      expect(payloads).not.toContain(banned);
    }
  });
});

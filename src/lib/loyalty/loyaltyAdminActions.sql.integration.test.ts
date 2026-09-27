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
 * Phase 6C — internal-admin Loyalty ACTIONS.
 *
 * The 6C UI calls exactly four Phase 6A mutation RPCs (create / update / set-active plan,
 * set shop entitlement) plus the two 6A readers for impact and read-back. These tests hold
 * the contract the UI relies on, exercised as the real caller roles:
 *
 *   - super_admin and operations_admin can perform every action; nobody else can
 *     (support/finance/subscriptions admins, merchants, cashiers, anonymous);
 *   - every mutation requires a reason, is validated server-side, and writes exactly one
 *     audit event with actor / reason / before / after — refusals write none;
 *   - the plan protections (default, in use, last active, inactive assignment) hold;
 *   - no action ever removes a member, changes points or history, or touches a Wallet or
 *     QR identity; only control-plane rows change.
 */

const T = 120_000;
const REASON = "phase 6c: merchant requested plan change";

let exec: SqlExec;
let f: LoyaltyFixture;
let opsAdminId: string;
let supportAdminId: string;
let financeAdminId: string;
let subscriptionsAdminId: string;

type Json = Record<string, unknown>;

async function call(userId: string, sql: string, params: unknown[] = []): Promise<Json> {
  return asUser(exec, userId, async () => {
    const { rows } = await exec.query(`SELECT ${sql} AS result`, params);
    return rpcJson(rows[0]);
  });
}

const createPlan = (user: string, code: string, name: string, limit: number, reason: string | null = REASON, prices = [0, 0]) =>
  call(user, `public.internal_ops_loyalty_create_plan($1,$2,$3,$4,$5,0,$6)`, [code, name, limit, prices[0], prices[1], reason]);

const updatePlan = (user: string, code: string, name: string, limit: number, reason: string | null = REASON, prices = [0, 0]) =>
  call(user, `public.internal_ops_loyalty_update_plan($1,$2,$3,$4,$5,0,$6)`, [code, name, limit, prices[0], prices[1], reason]);

const setActive = (user: string, code: string, active: boolean, reason: string | null = REASON) =>
  call(user, `public.internal_ops_loyalty_set_plan_active($1,$2,$3)`, [code, active, reason]);

const setEntitlement = (user: string, shopId: string, status: string, plan: string | null, reason: string | null = REASON) =>
  call(user, `public.internal_ops_loyalty_set_shop_entitlement($1,$2,$3,$4)`, [shopId, status, plan, reason]);

async function newUser(role: string): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, [id, `${role}-${id.slice(0, 6)}@test.local`]);
  await exec.query(`INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ($1,$2,$3)`, [f.shopAId, id, role]);
  return id;
}

/** A shop in its own organization (entitlements are organization-scoped). */
async function newShop(label: string): Promise<{ shopId: string; orgId: string }> {
  const orgId = crypto.randomUUID();
  const shopId = crypto.randomUUID();
  await exec.query(`INSERT INTO public.organizations (id, name) VALUES ($1,$2)`, [orgId, `${label} Org`]);
  await exec.query(`INSERT INTO public.shops (id, organization_id, name, shop_number) VALUES ($1,$2,$3,$4)`, [
    shopId,
    orgId,
    label,
    label.slice(0, 8).toUpperCase(),
  ]);
  await exec.query(
    `INSERT INTO public.loyalty_programs (shop_id, enabled, earn_unit_ugx, earn_points_per_unit) VALUES ($1,true,1000,1)`,
    [shopId],
  );
  return { shopId, orgId };
}

async function seedMembers(shopId: string, n: number): Promise<void> {
  await exec.query(`INSERT INTO public.customers (shop_id, name) SELECT $1, 'M' || g FROM generate_series(1,$2) g`, [shopId, n]);
  await exec.query(
    `INSERT INTO public.loyalty_accounts (shop_id, customer_id)
     SELECT $1, c.id FROM public.customers c
      WHERE c.shop_id = $1 AND NOT EXISTS (SELECT 1 FROM public.loyalty_accounts a WHERE a.customer_id = c.id)`,
    [shopId],
  );
}

/** Give every member points, a ledger row, a Wallet object and a public card token. */
async function seedMemberIdentity(shopId: string, tag: string): Promise<void> {
  await exec.query(
    `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause)
     SELECT $1, a.id, 'earned', 11, 'sale' FROM public.loyalty_accounts a WHERE a.shop_id = $1`,
    [shopId],
  );
  await exec.query(
    `UPDATE public.loyalty_accounts
        SET google_wallet_object_id = 'WALLETOBJ-' || $2 || '-' || id::text,
            public_card_token = 'PUBCARD-' || $2 || '-' || id::text
      WHERE shop_id = $1`,
    [shopId, tag],
  );
}

/** Everything a control-plane action must never change, for one shop. */
async function memberSnapshot(shopId: string) {
  const accounts = await exec.query(
    `SELECT id, customer_id, status, balance_points, lifetime_earned_points, lifetime_redeemed_points,
            qr_token, public_card_token, google_wallet_object_id, enrolled_at
       FROM public.loyalty_accounts WHERE shop_id = $1 ORDER BY id`,
    [shopId],
  );
  const ledger = await exec.query(
    `SELECT id, account_id, kind, points, balance_after, created_at
       FROM public.loyalty_transactions WHERE shop_id = $1 ORDER BY id`,
    [shopId],
  );
  const outbox = await exec.query(`SELECT count(*)::int AS n FROM public.loyalty_wallet_sync_outbox WHERE shop_id = $1`, [shopId]);
  const sales = await exec.query(`SELECT count(*)::int AS n FROM public.sales WHERE shop_id = $1`, [shopId]);
  return { accounts: accounts.rows, ledger: ledger.rows, outbox: outbox.rows[0], sales: sales.rows[0] };
}

async function auditCount(): Promise<number> {
  const { rows } = await exec.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.internal_ops_admin_audit`);
  return Number(rows[0]!.n);
}

async function lastAudit(action: string) {
  const { rows } = await exec.query<{ actor: string; target_shop_id: string | null; target_org_id: string | null; payload: Json }>(
    `SELECT actor, target_shop_id, target_org_id, payload FROM public.internal_ops_admin_audit
      WHERE action = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [action],
  );
  return rows[0];
}

async function entitlementRow(orgId: string) {
  const { rows } = await exec.query<{ status: string; plan_code: string | null }>(
    `SELECT status, plan_code FROM public.organization_feature_entitlements
      WHERE organization_id = $1 AND feature_code = 'loyalty'`,
    [orgId],
  );
  return rows[0];
}

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  opsAdminId = await newUser("operations_admin");
  supportAdminId = await newUser("support_admin");
  financeAdminId = await newUser("finance_admin");
  subscriptionsAdminId = await newUser("subscriptions_admin");
}, T);

afterAll(async () => {
  await exec.close();
});

// ---------------------------------------------------------------------------
// Plan actions
// ---------------------------------------------------------------------------

describe("plan actions — authorized", () => {
  it("operations_admin creates a plan: active, never default, audited with reason and after-state", async () => {
    const before = await auditCount();
    const r = await createPlan(opsAdminId, "p6c_gold", "Gold", 250, REASON, [30000, 300000]);
    expect(r.ok).toBe(true);
    expect(r.code).toBe("p6c_gold");

    const { rows } = await exec.query<{ is_active: boolean; is_default: boolean; member_limit: number }>(
      `SELECT is_active, is_default, member_limit FROM public.loyalty_plan_tiers WHERE code = 'p6c_gold'`,
    );
    expect(rows[0]).toEqual({ is_active: true, is_default: false, member_limit: 250 });

    expect(await auditCount()).toBe(before + 1);
    const a = await lastAudit("loyalty_plan_created");
    expect(a!.actor).toBe(opsAdminId);
    expect(a!.payload.reason).toBe(REASON);
    expect(a!.payload.target_id).toBe("p6c_gold");
    expect(a!.payload.before).toBeNull();
    expect((a!.payload.after as Json).member_limit).toBe(250);
  });

  it("super_admin updates a plan: before/after recorded, limit change flagged", async () => {
    const before = await auditCount();
    const r = await updatePlan(f.internalAdminId, "p6c_gold", "Gold Plus", 300, REASON, [35000, 350000]);
    expect(r.ok).toBe(true);
    expect(r.member_limit_changed).toBe(true);
    expect(await auditCount()).toBe(before + 1);

    const a = await lastAudit("loyalty_plan_updated");
    expect(a!.actor).toBe(f.internalAdminId);
    expect((a!.payload.before as Json).name).toBe("Gold");
    expect((a!.payload.after as Json).name).toBe("Gold Plus");
    expect((a!.payload.after as Json).member_limit).toBe(300);
    expect(a!.payload.member_limit_changed).toBe(true);
  });

  it("operations_admin deactivates and reactivates an unused plan, each audited", async () => {
    await createPlan(opsAdminId, "p6c_toggle", "Toggle", 20);
    const before = await auditCount();

    const off = await setActive(opsAdminId, "p6c_toggle", false);
    expect(off.ok).toBe(true);
    expect(off.is_active).toBe(false);
    const aOff = await lastAudit("loyalty_plan_active_changed");
    expect((aOff!.payload.before as Json).is_active).toBe(true);
    expect((aOff!.payload.after as Json).is_active).toBe(false);

    const on = await setActive(opsAdminId, "p6c_toggle", true);
    expect(on.ok).toBe(true);
    expect(on.is_active).toBe(true);
    expect(await auditCount()).toBe(before + 2);
  });
});

describe("plan actions — validation and protections", () => {
  it("rejects invalid plans and writes nothing", async () => {
    const before = await auditCount();
    expect((await createPlan(opsAdminId, "p6c_gold", "Dup", 10)).error).toBe("code_exists");
    expect((await createPlan(opsAdminId, "Has Space", "Bad", 10)).error).toBe("invalid_code");
    expect((await createPlan(opsAdminId, "9starts_digit", "Bad", 10)).error).toBe("invalid_code");
    expect((await createPlan(opsAdminId, "p6c_noname", "   ", 10)).error).toBe("invalid_name");
    expect((await createPlan(opsAdminId, "p6c_longname", "x".repeat(61), 10)).error).toBe("invalid_name");
    expect((await createPlan(opsAdminId, "p6c_neg", "Neg", -5)).error).toBe("invalid_member_limit");
    expect((await createPlan(opsAdminId, "p6c_price", "Price", 5, REASON, [-1, 0])).error).toBe("invalid_price");
    expect((await updatePlan(opsAdminId, "p6c_missing", "Missing", 5)).error).toBe("tier_not_found");
    expect((await updatePlan(opsAdminId, "p6c_gold", "Gold", -1)).error).toBe("invalid_member_limit");
    expect((await setActive(opsAdminId, "p6c_missing", false)).error).toBe("tier_not_found");

    const { rows } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_plan_tiers
        WHERE code IN ('has space','9starts_digit','p6c_noname','p6c_longname','p6c_neg','p6c_price','p6c_missing')`,
    );
    expect(Number(rows[0]!.n)).toBe(0);
    expect(await auditCount()).toBe(before);
  });

  it("the default plan cannot be deactivated", async () => {
    const r = await setActive(opsAdminId, "free", false);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("tier_is_default");
  });

  it("a plan in use cannot be deactivated, and says how many organizations use it", async () => {
    await createPlan(opsAdminId, "p6c_inuse", "In Use", 40);
    const { shopId } = await newShop("InUse Shop");
    expect((await setEntitlement(opsAdminId, shopId, "active", "p6c_inuse")).ok).toBe(true);

    const before = await auditCount();
    const r = await setActive(opsAdminId, "p6c_inuse", false);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("tier_in_use");
    expect(Number(r.organizations)).toBe(1);
    expect(await auditCount()).toBe(before);

    const { rows } = await exec.query<{ is_active: boolean }>(`SELECT is_active FROM public.loyalty_plan_tiers WHERE code = 'p6c_inuse'`);
    expect(rows[0]!.is_active).toBe(true);
  });

  it("the last active plan cannot be deactivated", async () => {
    // Run inside asUser and force a rollback, so the shared catalog is left untouched.
    const sentinel = new Error("rollback");
    let observed: Json | null = null;
    await expect(
      asUser(exec, opsAdminId, async () => {
        await exec.exec("RESET ROLE");
        await exec.query(`UPDATE public.loyalty_plan_tiers SET is_active = (code = 'p6c_toggle')`);
        await exec.exec("SET LOCAL ROLE authenticated");
        const { rows } = await exec.query(`SELECT public.internal_ops_loyalty_set_plan_active('p6c_toggle', false, $1) AS result`, [
          REASON,
        ]);
        observed = rpcJson(rows[0]);
        throw sentinel;
      }),
    ).rejects.toBe(sentinel);
    expect(observed!.ok).toBe(false);
    expect(observed!.error).toBe("last_active_tier");

    const { rows } = await exec.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.loyalty_plan_tiers WHERE is_active`);
    expect(Number(rows[0]!.n)).toBeGreaterThan(1);
  });

  it("an inactive plan cannot be assigned to a shop", async () => {
    await createPlan(opsAdminId, "p6c_retired", "Retired", 10);
    expect((await setActive(opsAdminId, "p6c_retired", false)).ok).toBe(true);
    const { shopId, orgId } = await newShop("Retired Shop");
    const before = await entitlementRow(orgId);

    const r = await setEntitlement(opsAdminId, shopId, "active", "p6c_retired");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("tier_inactive");
    expect(await entitlementRow(orgId)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Shop entitlement actions
// ---------------------------------------------------------------------------

describe("shop entitlement actions", () => {
  it("disable, enable with a plan, then change plan — read back through shop_state each time", async () => {
    await createPlan(opsAdminId, "p6c_basic", "Basic", 30);
    await createPlan(opsAdminId, "p6c_big", "Big", 500);
    const { shopId, orgId } = await newShop("Lifecycle Shop");
    await seedMembers(shopId, 3);

    const off = await setEntitlement(opsAdminId, shopId, "none", null);
    expect(off.ok).toBe(true);
    expect(off.loyalty_enabled).toBe(false);
    const stateOff = await call(opsAdminId, `public.internal_ops_loyalty_shop_state($1)`, [shopId]);
    expect((stateOff.usage as Json).loyalty_enabled).toBe(false);
    expect(stateOff.entitlement_status).toBe("none");

    const on = await setEntitlement(opsAdminId, shopId, "active", "p6c_basic");
    expect(on.ok).toBe(true);
    expect(on.loyalty_enabled).toBe(true);
    expect(on.tier_code).toBe("p6c_basic");
    expect(Number(on.member_limit)).toBe(30);
    const stateOn = await call(opsAdminId, `public.internal_ops_loyalty_shop_state($1)`, [shopId]);
    expect((stateOn.usage as Json).tier_code).toBe("p6c_basic");
    expect(Number((stateOn.usage as Json).active_members)).toBe(3);

    const change = await setEntitlement(f.internalAdminId, shopId, "active", "p6c_big");
    expect(change.ok).toBe(true);
    expect(change.tier_code).toBe("p6c_big");
    expect(Number(change.member_limit)).toBe(500);

    const a = await lastAudit("loyalty_shop_entitlement_set");
    expect(a!.actor).toBe(f.internalAdminId);
    expect(a!.target_shop_id).toBe(shopId);
    expect(a!.target_org_id).toBe(orgId);
    expect((a!.payload.before as Json).plan_code).toBe("p6c_basic");
    expect((a!.payload.after as Json).plan_code).toBe("p6c_big");
    expect(a!.payload.reason).toBe(REASON);
  });

  it("disabling keeps the assigned plan so re-enabling restores it", async () => {
    await createPlan(opsAdminId, "p6c_keep", "Keep", 60);
    const { shopId, orgId } = await newShop("Keep Shop");
    expect((await setEntitlement(opsAdminId, shopId, "active", "p6c_keep")).ok).toBe(true);
    expect((await setEntitlement(opsAdminId, shopId, "none", null)).ok).toBe(true);
    expect(await entitlementRow(orgId)).toEqual({ status: "none", plan_code: "p6c_keep" });

    // The UI always sends an explicit plan on enable; the preserved one is what it preselects.
    const back = await setEntitlement(opsAdminId, shopId, "active", "p6c_keep");
    expect(back.tier_code).toBe("p6c_keep");
  });

  it("rejects an unknown plan, an unsupported status and an unknown shop, writing nothing", async () => {
    const { shopId, orgId } = await newShop("Reject Shop");
    const beforeRow = await entitlementRow(orgId);
    const before = await auditCount();
    expect((await setEntitlement(opsAdminId, shopId, "active", "p6c_nope")).error).toBe("tier_not_found");
    expect((await setEntitlement(opsAdminId, shopId, "trial", "p6c_basic")).error).toBe("invalid_status");
    expect((await setEntitlement(opsAdminId, crypto.randomUUID(), "active", "p6c_basic")).error).toBe("shop_not_found");
    expect(await entitlementRow(orgId)).toEqual(beforeRow);
    expect(await auditCount()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

describe("security — only super_admin and operations_admin can act", () => {
  const MUTATIONS: Array<{ name: string; sql: string; params: () => unknown[] }> = [
    {
      name: "create_plan",
      sql: `public.internal_ops_loyalty_create_plan('p6c_hack','Hack',999999,0,0,0,$1)`,
      params: () => [REASON],
    },
    {
      name: "update_plan",
      sql: `public.internal_ops_loyalty_update_plan('free','Free',999999,0,0,0,$1)`,
      params: () => [REASON],
    },
    { name: "set_plan_active", sql: `public.internal_ops_loyalty_set_plan_active('p6c_gold', false, $1)`, params: () => [REASON] },
    {
      name: "set_shop_entitlement",
      sql: `public.internal_ops_loyalty_set_shop_entitlement($1,'none',null,$2)`,
      params: () => [f.shopAId, REASON],
    },
  ];

  async function catalogFingerprint() {
    const { rows } = await exec.query(`SELECT code, name, member_limit, is_active FROM public.loyalty_plan_tiers ORDER BY code`);
    const ent = await entitlementRow(f.orgId);
    return JSON.stringify({ rows, ent });
  }

  it("merchant owner, cashier and an outsider are refused, with no change and no audit", async () => {
    const fp = await catalogFingerprint();
    const before = await auditCount();
    for (const user of [f.ownerAId, f.cashierAId, f.outsiderId]) {
      for (const m of MUTATIONS) {
        const r = await call(user, m.sql, m.params());
        expect(r, `${m.name} as merchant`).toMatchObject({ ok: false, error: "forbidden" });
      }
    }
    expect(await catalogFingerprint()).toBe(fp);
    expect(await auditCount()).toBe(before);
  });

  it("support_admin, finance_admin and subscriptions_admin are refused (allowlist not widened)", async () => {
    const fp = await catalogFingerprint();
    const before = await auditCount();
    for (const user of [supportAdminId, financeAdminId, subscriptionsAdminId]) {
      for (const m of MUTATIONS) {
        const r = await call(user, m.sql, m.params());
        expect(r, `${m.name}`).toMatchObject({ ok: false, error: "forbidden" });
      }
      // The two readers the action dialogs use are equally closed to them.
      expect(await call(user, `public.internal_ops_loyalty_plan_impact('free', 1)`)).toMatchObject({ ok: false, error: "forbidden" });
      expect(await call(user, `public.internal_ops_loyalty_shop_state($1)`, [f.shopAId])).toMatchObject({
        ok: false,
        error: "forbidden",
      });
    }
    expect(await catalogFingerprint()).toBe(fp);
    expect(await auditCount()).toBe(before);
  });

  it("an anonymous caller cannot even execute the mutations", async () => {
    for (const m of MUTATIONS) {
      await exec.exec("BEGIN");
      await exec.exec("SET LOCAL ROLE anon");
      try {
        await expect(exec.query(`SELECT ${m.sql}`, m.params())).rejects.toThrow(/permission denied/i);
      } finally {
        await exec.exec("ROLLBACK");
      }
    }
  });

  it("the server allowlist is exactly super_admin + operations_admin in every 6A action RPC", async () => {
    const { rows } = await exec.query<{ proname: string; src: string; secdef: boolean }>(
      `SELECT p.proname, p.prosrc AS src, p.prosecdef AS secdef FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN (
          'internal_ops_loyalty_create_plan','internal_ops_loyalty_update_plan',
          'internal_ops_loyalty_set_plan_active','internal_ops_loyalty_set_shop_entitlement',
          'internal_ops_loyalty_plan_impact','internal_ops_loyalty_shop_state')`,
    );
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r.secdef, r.proname).toBe(true);
      expect(r.src).toContain("is_waka_internal_role (array['super_admin', 'operations_admin'])");
      for (const banned of ["support_admin", "finance_admin", "subscriptions_admin", "field_agent"]) {
        expect(r.src, `${r.proname} mentions ${banned}`).not.toContain(banned);
      }
    }
  });

  it("even an authorized admin cannot bypass the RPCs with direct table writes", async () => {
    const attempts = [
      `INSERT INTO public.loyalty_plan_tiers (code, name, member_limit) VALUES ('p6c_direct','Direct',1)`,
      `UPDATE public.loyalty_plan_tiers SET member_limit = 1 WHERE code = 'free'`,
      `UPDATE public.organization_feature_entitlements SET status = 'none' WHERE organization_id = '${f.orgId}'`,
      `INSERT INTO public.organization_feature_entitlements (organization_id, feature_code, status) VALUES ('${crypto.randomUUID()}','loyalty','active')`,
    ];
    for (const sql of attempts) {
      await expect(
        asUser(exec, opsAdminId, async () => {
          await exec.query(sql);
        }),
      ).rejects.toThrow(/permission denied|row-level security/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

describe("audit", () => {
  it("every action RPC refuses a missing, blank, too-short or too-long reason — and audits nothing", async () => {
    const { shopId } = await newShop("Reason Shop");
    const before = await auditCount();
    for (const bad of [null, "", "     ", "ab", "x".repeat(301)]) {
      expect((await createPlan(opsAdminId, "p6c_reason", "Reason", 5, bad)).error).toBe("reason_required");
      expect((await updatePlan(opsAdminId, "p6c_gold", "Gold Plus", 300, bad)).error).toBe("reason_required");
      expect((await setActive(opsAdminId, "p6c_toggle", false, bad)).error).toBe("reason_required");
      expect((await setEntitlement(opsAdminId, shopId, "none", null, bad)).error).toBe("reason_required");
    }
    expect(await auditCount()).toBe(before);
    const { rows } = await exec.query(`SELECT 1 FROM public.loyalty_plan_tiers WHERE code = 'p6c_reason'`);
    expect(rows).toHaveLength(0);
  });

  it("the stored reason is trimmed and attributed to the calling admin", async () => {
    const r = await createPlan(opsAdminId, "p6c_trim", "Trim", 5, "   onboarding new partner tier   ");
    expect(r.ok).toBe(true);
    const a = await lastAudit("loyalty_plan_created");
    expect(a!.payload.reason).toBe("onboarding new partner tier");
    expect(a!.actor).toBe(opsAdminId);
  });

  it("a refused action never leaves a misleading success audit entry", async () => {
    const before = await auditCount();
    await setActive(opsAdminId, "free", false); // tier_is_default
    await setActive(opsAdminId, "p6c_inuse", false); // tier_in_use
    await createPlan(supportAdminId, "p6c_sneak", "Sneak", 5); // forbidden
    await setEntitlement(opsAdminId, f.shopAId, "active", "p6c_retired"); // tier_inactive
    expect(await auditCount()).toBe(before);
  });

  it("audit payloads carry no Wallet credentials, card tokens or secrets", async () => {
    await createPlan(opsAdminId, "p6c_secret", "Secret", 100);
    const { shopId } = await newShop("Secret Shop");
    await seedMembers(shopId, 3);
    await seedMemberIdentity(shopId, "SECRETSHOP");
    expect((await setEntitlement(opsAdminId, shopId, "active", "p6c_secret")).ok).toBe(true);
    expect((await updatePlan(opsAdminId, "p6c_secret", "Secret", 1)).ok).toBe(true);
    expect((await setEntitlement(opsAdminId, shopId, "none", null)).ok).toBe(true);

    const { rows: tokens } = await exec.query<{ qr_token: string }>(`SELECT qr_token FROM public.loyalty_accounts WHERE shop_id = $1`, [
      shopId,
    ]);
    const { rows } = await exec.query<{ payload: string }>(`SELECT payload::text AS payload FROM public.internal_ops_admin_audit`);
    const joined = rows.map((r) => r.payload).join(" ");
    for (const banned of [
      "WALLETOBJ-",
      "PUBCARD-",
      "google_wallet_object_id",
      "public_card_token",
      "qr_token",
      "service_role",
      "private_key",
      "eyJ",
      "password",
      ...tokens.map((t) => t.qr_token),
    ]) {
      expect(joined).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Impact and data preservation
// ---------------------------------------------------------------------------

describe("impact and data preservation", () => {
  it("a limit reduction is measured first, then applied without touching any member, point, ledger or Wallet row", async () => {
    await createPlan(opsAdminId, "p6c_shrink", "Shrink", 100);
    const shops: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const { shopId } = await newShop(`Shrink Shop ${i}`);
      await seedMembers(shopId, 6);
      await seedMemberIdentity(shopId, `SHRINK${i}`);
      expect((await setEntitlement(opsAdminId, shopId, "active", "p6c_shrink")).ok).toBe(true);
      shops.push(shopId);
    }

    // What the edit dialog shows before the admin can confirm.
    const impact = await call(opsAdminId, `public.internal_ops_loyalty_plan_impact('p6c_shrink', 4)`);
    expect(impact).toMatchObject({ ok: true, organizations: 3, shops: 3, shops_over_limit: 3, members_over_limit: 6 });

    const snapshots = await Promise.all(shops.map(memberSnapshot));
    const r = await updatePlan(opsAdminId, "p6c_shrink", "Shrink", 4);
    expect(r.ok).toBe(true);
    // The impact the RPC recorded matches what the admin was shown.
    expect(r.impact).toMatchObject({ shops_over_limit: 3, members_over_limit: 6 });

    for (let i = 0; i < shops.length; i += 1) {
      expect(await memberSnapshot(shops[i]!)).toEqual(snapshots[i]);
      const state = await call(opsAdminId, `public.internal_ops_loyalty_shop_state($1)`, [shops[i]]);
      expect(state.over_limit).toBe(true);
      expect(Number((state.usage as Json).active_members)).toBe(6);
    }
  });

  it("disable → enable → change plan never deletes members, points, ledger rows or Wallet identities", async () => {
    await createPlan(opsAdminId, "p6c_small", "Small", 2);
    await createPlan(opsAdminId, "p6c_large", "Large", 1000);
    const { shopId } = await newShop("Preserve Shop");
    await seedMembers(shopId, 5);
    await seedMemberIdentity(shopId, "PRESERVE");
    const snap = await memberSnapshot(shopId);
    expect(snap.accounts).toHaveLength(5);
    expect(snap.ledger).toHaveLength(5);

    expect((await setEntitlement(opsAdminId, shopId, "none", null)).ok).toBe(true);
    expect(await memberSnapshot(shopId)).toEqual(snap);

    // Moving to a plan smaller than the current membership keeps everyone.
    expect((await setEntitlement(opsAdminId, shopId, "active", "p6c_small")).ok).toBe(true);
    expect(await memberSnapshot(shopId)).toEqual(snap);
    const tight = await call(opsAdminId, `public.internal_ops_loyalty_shop_state($1)`, [shopId]);
    expect(tight.over_limit).toBe(true);

    expect((await setEntitlement(opsAdminId, shopId, "active", "p6c_large")).ok).toBe(true);
    expect(await memberSnapshot(shopId)).toEqual(snap);
    const roomy = await call(opsAdminId, `public.internal_ops_loyalty_shop_state($1)`, [shopId]);
    expect(roomy.over_limit).toBe(false);
  });

  it("deactivating or reactivating a plan changes no member data anywhere", async () => {
    const { shopId } = await newShop("Toggle Preserve Shop");
    await seedMembers(shopId, 2);
    await seedMemberIdentity(shopId, "TOGGLE");
    const snap = await memberSnapshot(shopId);
    await createPlan(opsAdminId, "p6c_flip", "Flip", 10);
    expect((await setActive(opsAdminId, "p6c_flip", false)).ok).toBe(true);
    expect((await setActive(opsAdminId, "p6c_flip", true)).ok).toBe(true);
    expect(await memberSnapshot(shopId)).toEqual(snap);
  });
});

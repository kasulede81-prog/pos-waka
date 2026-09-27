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
 * Phase 6A — internal-admin control plane.
 *
 * The control plane exists so an internal admin can administer Loyalty through authorized
 * SECURITY DEFINER RPCs that mutate authoritative data and write an audit event in the same
 * transaction — never through direct table writes. These tests hold both halves: the
 * operations work for an authorized admin, and nobody else can reach them or the tables
 * behind them.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

/** Run `fn` with the anon role, so the public path is exercised as a real anonymous client. */
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

async function adminCreatePlan(code: string, name: string, limit: number, reason?: string) {
  return asUser(exec, f.internalAdminId, async () => {
    const { rows } = await exec.query(
      `SELECT public.internal_ops_loyalty_create_plan($1,$2,$3,0,0,0,$4) AS result`,
      [code, name, limit, reason ?? "phase 6a test"],
    );
    return rpcJson(rows[0]);
  });
}

async function adminUpdatePlan(code: string, name: string, limit: number, reason?: string) {
  return asUser(exec, f.internalAdminId, async () => {
    const { rows } = await exec.query(
      `SELECT public.internal_ops_loyalty_update_plan($1,$2,$3,0,0,0,$4) AS result`,
      [code, name, limit, reason ?? "phase 6a test"],
    );
    return rpcJson(rows[0]);
  });
}

async function adminSetActive(code: string, isActive: boolean) {
  return asUser(exec, f.internalAdminId, async () => {
    const { rows } = await exec.query(
      `SELECT public.internal_ops_loyalty_set_plan_active($1,$2,'phase 6a test') AS result`,
      [code, isActive],
    );
    return rpcJson(rows[0]);
  });
}

async function adminSetEntitlement(shopId: string, status: string, planCode: string | null) {
  return asUser(exec, f.internalAdminId, async () => {
    const { rows } = await exec.query(
      `SELECT public.internal_ops_loyalty_set_shop_entitlement($1,$2,$3,$4) AS result`,
      [shopId, status, planCode, "phase 6a test"],
    );
    return rpcJson(rows[0]);
  });
}

async function newShop(label: string, orgId?: string): Promise<string> {
  const id = crypto.randomUUID();
  // A fresh organization per shop by default: the entitlement is ORGANIZATION-scoped, so
  // sharing one would let a tier assigned in one test leak into every later test.
  const org = orgId ?? crypto.randomUUID();
  if (!orgId) {
    await exec.query(`INSERT INTO public.organizations (id, name) VALUES ($1,$2)`, [
      org,
      `${label} Org`,
    ]);
  }
  await exec.query(
    `INSERT INTO public.shops (id, organization_id, name, shop_number) VALUES ($1,$2,$3,$4)`,
    [id, org, label, label.slice(0, 8).toUpperCase()],
  );
  await exec.query(`INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ($1,$2,'owner')`, [
    id,
    f.ownerAId,
  ]);
  await exec.query(
    `INSERT INTO public.loyalty_programs (shop_id, enabled, earn_unit_ugx, earn_points_per_unit)
     VALUES ($1, true, 1000, 1)`,
    [id],
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

async function auditEvents(action: string, targetId?: string) {
  const { rows } = await exec.query<{ action: string; actor: string; payload: Record<string, unknown> }>(
    `SELECT action, actor, payload FROM public.internal_ops_admin_audit
      WHERE action = $1 ${targetId ? "AND payload ->> 'target_id' = $2" : ""}
      ORDER BY created_at`,
    targetId ? [action, targetId] : [action],
  );
  return rows;
}

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
}, T);

afterAll(async () => {
  await exec.close();
});

describe("authorization: only an internal admin reaches the control plane", () => {
  it("a merchant owner cannot create, update or deactivate a tier", async () => {
    const created = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.internal_ops_loyalty_create_plan('hacked','Hacked',999999,0,0,0,null) AS result`,
      );
      return rpcJson(rows[0]);
    });
    expect(created.ok).toBe(false);
    expect(created.error).toBe("forbidden");

    const updated = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.internal_ops_loyalty_update_plan('free','Free',999999,0,0,1,null) AS result`,
      );
      return rpcJson(rows[0]);
    });
    expect(updated.error).toBe("forbidden");

    const deactivated = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.internal_ops_loyalty_set_plan_active('starter', false, null) AS result`,
      );
      return rpcJson(rows[0]);
    });
    expect(deactivated.error).toBe("forbidden");

    // The catalog is untouched.
    const { rows } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_plan_tiers WHERE code = 'hacked'`,
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it("a cashier cannot use the control plane", async () => {
    const r = await asUser(exec, f.cashierAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.internal_ops_loyalty_set_shop_entitlement($1,'active','pro','x') AS result`,
        [f.shopAId],
      );
      return rpcJson(rows[0]);
    });
    expect(r.error).toBe("forbidden");
  });

  it("an anonymous caller cannot use the control plane", async () => {
    // anon holds no EXECUTE on the control-plane RPCs at all, so this is a hard denial
    // rather than an in-body refusal.
    await expect(
      asAnon(async () => {
        await exec.query(
          `SELECT public.internal_ops_loyalty_create_plan('anon','Anon',10,0,0,0,null)`,
        );
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("an unauthorized attempt creates no mutation and no audit event", async () => {
    const before = await auditEvents("loyalty_plan_created");
    await asUser(exec, f.ownerAId, async () => {
      await exec.query(
        `SELECT public.internal_ops_loyalty_create_plan('nope','Nope',10,0,0,0,null) AS result`,
      );
    });
    expect(await auditEvents("loyalty_plan_created")).toHaveLength(before.length);
  });
});

describe("cross-shop privacy", () => {
  it("Shop A's owner cannot read Shop B's Loyalty usage", async () => {
    const denied = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(`SELECT public.shop_loyalty_usage($1) AS result`, [f.shopBId]);
      return rpcJson(rows[0]);
    });
    expect(denied.ok).toBe(false);
    expect(denied.error).toBe("forbidden");

    // ...and their own shop still works.
    const allowed = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(`SELECT public.shop_loyalty_usage($1) AS result`, [f.shopAId]);
      return rpcJson(rows[0]);
    });
    expect(allowed.ok).toBe(true);
  });

  it("the internal resolvers are no longer client-callable at all", async () => {
    for (const sql of [
      `SELECT public.resolve_shop_loyalty_entitlement($1)`,
      `SELECT public.count_shop_active_loyalty_members($1)`,
    ]) {
      await expect(
        asUser(exec, f.ownerAId, async () => {
          await exec.query(sql, [f.shopBId]);
        }),
      ).rejects.toThrow(/permission denied/i);
    }
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(`SELECT public.loyalty_plan_tier_limit('free')`);
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("privilege hardening", () => {
  it("the browser cannot write the plan catalog", async () => {
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(`UPDATE public.loyalty_plan_tiers SET member_limit = 999999 WHERE code = 'free'`);
      }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(
          `INSERT INTO public.loyalty_plan_tiers (code, name, member_limit) VALUES ('x','X',1)`,
        );
      }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(`DELETE FROM public.loyalty_plan_tiers WHERE code = 'free'`);
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("the browser cannot write entitlements", async () => {
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(
          `UPDATE public.organization_feature_entitlements SET plan_code = 'pro'
            WHERE organization_id = $1 AND feature_code = 'loyalty'`,
          [f.orgId],
        );
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("the browser cannot write loyalty_programs directly", async () => {
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(`UPDATE public.loyalty_programs SET earn_unit_ugx = 1 WHERE shop_id = $1`, [
          f.shopAId,
        ]);
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("historical Loyalty tables stay protected", async () => {
    for (const sql of [
      `UPDATE public.loyalty_transactions SET points = 999999`,
      `UPDATE public.loyalty_accounts SET balance_points = 999999`,
    ]) {
      await expect(
        asUser(exec, f.ownerAId, async () => {
          await exec.query(sql);
        }),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it("the five never-revoked functions are no longer PUBLIC/anon-callable", async () => {
    await expect(
      asAnon(async () => {
        await exec.query(`SELECT public.loyalty_shop_overview($1)`, [f.shopAId]);
      }),
    ).rejects.toThrow(/permission denied/i);

    // ...while the merchant path still works.
    const merchant = await asUser(exec, f.cashierAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_shop_overview($1) AS result`,
        [f.shopAId],
      );
      return rpcJson(rows[0]);
    });
    expect(merchant.ok).toBe(true);
  });
});

describe("plan catalog control", () => {
  it("an internal admin can create a valid tier", async () => {
    const r = await adminCreatePlan("p6a_basic", "Phase 6A Basic", 120, "initial");
    expect(r.ok).toBe(true);
    expect(r.code).toBe("p6a_basic");

    const { rows } = await exec.query<{ n: number; active: boolean; def: boolean }>(
      `SELECT member_limit::int AS n, is_active AS active, is_default AS def
         FROM public.loyalty_plan_tiers WHERE code = $1`,
      ["p6a_basic"],
    );
    expect(Number(rows[0].n)).toBe(120);
    expect(rows[0].active).toBe(true);
    // A new tier must never steal the default flag.
    expect(rows[0].def).toBe(false);
  });

  it("rejects a duplicate code, an invalid code, an invalid name and an invalid limit", async () => {
    expect((await adminCreatePlan("p6a_basic", "Dup", 10)).error).toBe("code_exists");
    expect((await adminCreatePlan("Bad Code", "Bad", 10)).error).toBe("invalid_code");
    expect((await adminCreatePlan("p6a_nameless", "", 10)).error).toBe("invalid_name");
    expect((await adminCreatePlan("p6a_neglimit", "Neg", -1)).error).toBe("invalid_member_limit");
  });

  it("an internal admin can update a tier", async () => {
    const r = await adminUpdatePlan("p6a_basic", "Phase 6A Renamed", 150);
    expect(r.ok).toBe(true);
    expect(r.member_limit_changed).toBe(true);

    const { rows } = await exec.query<{ name: string; n: number }>(
      `SELECT name, member_limit::int AS n FROM public.loyalty_plan_tiers WHERE code = $1`,
      ["p6a_basic"],
    );
    expect(rows[0].name).toBe("Phase 6A Renamed");
    expect(Number(rows[0].n)).toBe(150);
  });

  it("updating a missing tier is rejected", async () => {
    expect((await adminUpdatePlan("does_not_exist", "X", 10)).error).toBe("tier_not_found");
  });

  it("an unused, non-default tier can be deactivated", async () => {
    await adminCreatePlan("p6a_unused", "Unused", 10);
    const r = await adminSetActive("p6a_unused", false);
    expect(r.ok).toBe(true);
    expect(r.is_active).toBe(false);

    const again = await adminSetActive("p6a_unused", true);
    expect(again.ok).toBe(true);
    expect(again.is_active).toBe(true);
  });

  it("deactivating a tier that organizations are assigned to is REFUSED, not silently applied", async () => {
    await adminCreatePlan("p6a_inuse", "In Use", 10);
    const shop = await newShop("In Use Shop");
    expect((await adminSetEntitlement(shop, "active", "p6a_inuse")).ok).toBe(true);

    const r = await adminSetActive("p6a_inuse", false);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("tier_in_use");
    expect(Number(r.organizations)).toBeGreaterThan(0);

    // Still active, and the merchant is untouched.
    const { rows } = await exec.query<{ active: boolean }>(
      `SELECT is_active AS active FROM public.loyalty_plan_tiers WHERE code = 'p6a_inuse'`,
    );
    expect(rows[0].active).toBe(true);
    const usage = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(`SELECT public.shop_loyalty_usage($1) AS result`, [shop]);
      return rpcJson(rows[0]);
    });
    expect(usage.tier_code).toBe("p6a_inuse");
  });

  it("the fallback tier cannot be deactivated", async () => {
    const r = await adminSetActive("free", false);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("tier_is_default");
  });

  it("the last remaining active tier cannot be deactivated", async () => {
    // Exercised inside a rolled-back transaction so the shared catalog is untouched.
    await exec.exec("BEGIN");
    try {
      await exec.query(`UPDATE public.loyalty_plan_tiers SET is_active = false`);
      await exec.query(`UPDATE public.loyalty_plan_tiers SET is_active = true WHERE code = 'starter'`);
      // Act as the internal admin for this transaction so the role guard passes and the
      // last-active-tier rule is the thing under test.
      await exec.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [f.internalAdminId]);
      const { rows } = await exec.query(
        `SELECT public.internal_ops_loyalty_set_plan_active('starter', false, 'phase 6a test') AS result`,
      );
      const r = rpcJson(rows[0]);
      expect(r.ok).toBe(false);
      expect(r.error).toBe("last_active_tier");
    } finally {
      await exec.exec("ROLLBACK");
    }
  });
});

describe("member-limit changes never touch member data", () => {
  it("a reduction records the over-limit impact and modifies nothing", async () => {
    await adminCreatePlan("p6a_limit", "Limit Test", 100);
    const shop = await newShop("Limit Shop");
    await seedMembers(shop, 5);
    await exec.query(
      `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause)
       SELECT $1, a.id, 'earned', 7, 'sale' FROM public.loyalty_accounts a WHERE a.shop_id = $1 LIMIT 1`,
      [shop],
    );
    await exec.query(
      `UPDATE public.loyalty_accounts SET google_wallet_object_id = 'waka_loyalty.acct_keep'
        WHERE shop_id = $1 AND id = (SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 LIMIT 1)`,
      [shop],
    );
    expect((await adminSetEntitlement(shop, "active", "p6a_limit")).ok).toBe(true);

    const before = await exec.query<{ accounts: number; points: number; wallets: number }>(
      `SELECT (SELECT count(*)::int FROM public.loyalty_accounts WHERE shop_id = $1) AS accounts,
              (SELECT coalesce(sum(balance_points),0)::int FROM public.loyalty_accounts WHERE shop_id = $1) AS points,
              (SELECT count(*)::int FROM public.loyalty_accounts WHERE shop_id = $1 AND google_wallet_object_id IS NOT NULL) AS wallets`,
      [shop],
    );

    const r = await adminUpdatePlan("p6a_limit", "Limit Test", 2, "shrink");
    expect(r.ok).toBe(true);
    expect(r.member_limit_changed).toBe(true);
    // The blast radius is reported, not remediated.
    const impact = r.impact as Record<string, unknown>;
    expect(Number(impact.shops_over_limit)).toBeGreaterThanOrEqual(1);
    expect(Number(impact.members_over_limit)).toBeGreaterThanOrEqual(3);

    const after = await exec.query<{ accounts: number; points: number; wallets: number }>(
      `SELECT (SELECT count(*)::int FROM public.loyalty_accounts WHERE shop_id = $1) AS accounts,
              (SELECT coalesce(sum(balance_points),0)::int FROM public.loyalty_accounts WHERE shop_id = $1) AS points,
              (SELECT count(*)::int FROM public.loyalty_accounts WHERE shop_id = $1 AND google_wallet_object_id IS NOT NULL) AS wallets`,
      [shop],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);

    // The over-limit state is observable to the future admin UI.
    const state = await asUser(exec, f.internalAdminId, async () => {
      const { rows } = await exec.query(`SELECT public.internal_ops_loyalty_shop_state($1) AS result`, [
        shop,
      ]);
      return rpcJson(rows[0]);
    });
    expect(state.ok).toBe(true);
    expect(state.over_limit).toBe(true);

    // Existing members still earn: the allowance only gates NEW memberships.
    const saleId = crypto.randomUUID();
    const { rows: cust } = await exec.query<{ customer_id: string }>(
      `SELECT customer_id FROM public.loyalty_accounts WHERE shop_id = $1 LIMIT 1`,
      [shop],
    );
    await exec.query(
      `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, total_ugx, completed_at)
       VALUES ($1,$2,$3,'completed','paid',50000, now())`,
      [saleId, shop, cust[0].customer_id],
    );
    const { rows: tx } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_transactions WHERE shop_id = $1 AND source_sale_id = $2`,
      [shop, saleId],
    );
    expect(Number(tx[0].n)).toBe(1);
  });
});

describe("shop entitlement control", () => {
  it("enable -> disable -> re-enable preserves the tier and all member data", async () => {
    const shop = await newShop("Entitlement Shop");
    await seedMembers(shop, 3);
    await adminCreatePlan("p6a_ent", "Ent Shop", 30);
    await exec.query(
      `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause)
       SELECT $1, a.id, 'earned', 11, 'sale' FROM public.loyalty_accounts a WHERE a.shop_id = $1 LIMIT 1`,
      [shop],
    );
    await exec.query(
      `UPDATE public.loyalty_accounts SET google_wallet_object_id = 'waka_loyalty.acct_ent'
        WHERE shop_id = $1 AND id = (SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 LIMIT 1)`,
      [shop],
    );

    const enabled = await adminSetEntitlement(shop, "active", "p6a_ent");
    expect(enabled.ok).toBe(true);
    expect(enabled.loyalty_enabled).toBe(true);
    expect(enabled.tier_code).toBe("p6a_ent");

    const disabled = await adminSetEntitlement(shop, "none", null);
    expect(disabled.ok).toBe(true);
    expect(disabled.loyalty_enabled).toBe(false);
    // A disabled entitlement resolves with tier_code null (that is what `loyalty_enabled`
    // false means), but the assigned tier stays on the row so re-enabling restores it.
    expect(disabled.tier_code).toBeNull();
    const { rows: kept } = await exec.query<{ plan_code: string | null; status: string }>(
      `SELECT plan_code, status FROM public.organization_feature_entitlements
        WHERE feature_code = 'loyalty'
          AND organization_id = (SELECT organization_id FROM public.shops WHERE id = $1)`,
      [shop],
    );
    expect(kept[0]!.plan_code).toBe("p6a_ent");
    expect(kept[0]!.status).toBe("none");

    const reenabled = await adminSetEntitlement(shop, "active", null);
    expect(reenabled.ok).toBe(true);
    expect(reenabled.loyalty_enabled).toBe(true);
    expect(reenabled.tier_code).toBe("p6a_ent");

    // Nothing was deleted or recreated.
    const { rows } = await exec.query<{ accounts: number; points: number; wallets: number; grants: number }>(
      `SELECT (SELECT count(*)::int FROM public.loyalty_accounts WHERE shop_id = $1) AS accounts,
              (SELECT coalesce(sum(balance_points),0)::int FROM public.loyalty_accounts WHERE shop_id = $1) AS points,
              (SELECT count(*)::int FROM public.loyalty_accounts WHERE shop_id = $1 AND google_wallet_object_id IS NOT NULL) AS wallets,
              (SELECT count(*)::int FROM public.loyalty_transactions WHERE shop_id = $1) AS grants`,
      [shop],
    );
    expect(Number(rows[0].accounts)).toBe(3);
    expect(Number(rows[0].points)).toBe(11);
    expect(Number(rows[0].wallets)).toBe(1);
    expect(Number(rows[0].grants)).toBe(1);
  });

  it("a disabled entitlement refuses new membership but keeps existing members", async () => {
    const shop = await newShop("Disabled Shop");
    await seedMembers(shop, 2);
    await adminSetEntitlement(shop, "none", null);

    const customer = crypto.randomUUID();
    await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1,$2,'New')`, [
      customer,
      shop,
    ]);
    const r = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_enroll_customer($1,$2,true) AS loyalty_enroll_customer`,
        [shop, customer],
      );
      return rpcJson(rows[0]);
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("loyalty_not_enabled");

    const { rows } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_accounts WHERE shop_id = $1`,
      [shop],
    );
    expect(Number(rows[0].n)).toBe(2);
  });

  it("an inactive tier cannot be assigned, and an unknown tier is rejected", async () => {
    const shop = await newShop("Assign Shop");
    await adminCreatePlan("p6a_off", "Off", 10);
    await adminSetActive("p6a_off", false);

    expect((await adminSetEntitlement(shop, "active", "p6a_off")).error).toBe("tier_inactive");
    expect((await adminSetEntitlement(shop, "active", "nope")).error).toBe("tier_not_found");
  });

  it("rejects an invalid status and an unknown shop", async () => {
    const shop = await newShop("Status Shop");
    expect((await adminSetEntitlement(shop, "trial", null)).error).toBe("invalid_status");
    expect((await adminSetEntitlement(crypto.randomUUID(), "active", null)).error).toBe("shop_not_found");
  });
});

describe("audit trail", () => {
  it("a plan mutation writes an audit event with before and after", async () => {
    await adminCreatePlan("p6a_audit", "Audit", 40, "create reason");
    const events = await auditEvents("loyalty_plan_created", "p6a_audit");
    expect(events).toHaveLength(1);
    expect(events[0]!.actor).toBe(f.internalAdminId);
    expect(events[0]!.payload.before).toBeNull();
    expect((events[0]!.payload.after as Record<string, unknown>).member_limit).toBe(40);
    expect(events[0]!.payload.reason).toBe("create reason");

    await adminUpdatePlan("p6a_audit", "Audit 2", 20, "update reason");
    const updated = await auditEvents("loyalty_plan_updated", "p6a_audit");
    expect(updated).toHaveLength(1);
    expect((updated[0]!.payload.before as Record<string, unknown>).member_limit).toBe(40);
    expect((updated[0]!.payload.after as Record<string, unknown>).member_limit).toBe(20);
    expect(updated[0]!.payload.reason).toBe("update reason");
    expect(updated[0]!.payload.member_limit_changed).toBe(true);
  });

  it("an entitlement mutation writes an audit event with before and after", async () => {
    const shop = await newShop("Audit Ent Shop");
    const set = await adminSetEntitlement(shop, "active", "p6a_basic");
    expect(set.ok).toBe(true);
    const orgId = String(set.organization_id);
    const events = await auditEvents("loyalty_shop_entitlement_set");
    const mine = events.filter((e) => (e.payload.target_id as string) === `${orgId}:loyalty`);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.actor).toBe(f.internalAdminId);
    // Both sides are captured: the org starts with the seeded active/no-tier entitlement,
    // and the mutation assigns the tier.
    const before = mine[0]!.payload.before as Record<string, unknown>;
    const after = mine[0]!.payload.after as Record<string, unknown>;
    expect(before.status).toBe("active");
    expect(before.plan_code).toBeNull();
    expect(after.status).toBe("active");
    expect(after.plan_code).toBe("p6a_basic");
    expect(mine[0]!.payload.reason).toBe("phase 6a test");
  });

  it("no audit event carries secrets", async () => {
    const { rows } = await exec.query<{ payload: string }>(
      `SELECT payload::text AS payload FROM public.internal_ops_admin_audit`,
    );
    const joined = rows.map((r) => r.payload).join(" ");
    for (const banned of ["service_role", "private_key", "BEGIN PRIVATE", "eyJ", "password"]) {
      expect(joined).not.toContain(banned);
    }
  });

  it("a refused mutation writes no audit event", async () => {
    const before = await auditEvents("loyalty_plan_updated", "free");
    await adminUpdatePlan("free", "", 50); // invalid name -> refused before any write
    expect(await auditEvents("loyalty_plan_updated", "free")).toHaveLength(before.length);
  });
});

describe("regression: the merchant surface is unchanged", () => {
  it("merchant program settings still work through the RPC", async () => {
    const shop = await newShop("Program Shop");
    const r = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_update_program($1,true,2000,2,0,'never',null,null,'never',null) AS result`,
        [shop],
      );
      return rpcJson(rows[0]);
    });
    expect(r.ok).toBe(true);
  });

  it("merchant reward CRUD still works directly", async () => {
    const shop = await newShop("Rewards Shop");
    const r = await asUser(exec, f.ownerAId, async () => {
      await exec.query(
        `INSERT INTO public.loyalty_rewards (shop_id, name, points_required) VALUES ($1,'Free gift',10)`,
        [shop],
      );
      await exec.query(`UPDATE public.loyalty_rewards SET points_required = 20 WHERE shop_id = $1`, [shop]);
      const { rows } = await exec.query<{ n: number }>(
        `SELECT points_required::int AS n FROM public.loyalty_rewards WHERE shop_id = $1`,
        [shop],
      );
      return rows;
    });
    expect(Number(r[0].n)).toBe(20);
  });

  it("enrollment approval, member lifecycle and wallet lifecycle still work", async () => {
    const shop = await newShop("Regression Shop");
    await seedMembers(shop, 2);

    // lifecycle: suspend -> reactivate
    const { rows: acct } = await exec.query<{ id: string }>(
      `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 ORDER BY id LIMIT 1`,
      [shop],
    );
    // Give this account an issued Wallet object. Trigger B is the ONE producer of
    // membership-state rows and is guarded on google_wallet_object_id, so without this
    // an account state change correctly enqueues nothing. Setting it here does not fire
    // the trigger: neither status nor membership_expires_at changes.
    await exec.query(
      `UPDATE public.loyalty_accounts SET google_wallet_object_id = 'waka_loyalty.acct_regress'
        WHERE id = $1`,
      [acct[0].id],
    );
    const suspended = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_set_account_lifecycle($1,$2,'suspend') AS result`,
        [shop, acct[0].id],
      );
      return rpcJson(rows[0]);
    });
    expect(suspended.ok).toBe(true);
    const reactivated = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_set_account_lifecycle($1,$2,'reactivate') AS result`,
        [shop, acct[0].id],
      );
      return rpcJson(rows[0]);
    });
    expect(reactivated.ok).toBe(true);

    // Trigger B (trg_loyalty_wallet_enqueue_on_account_state) is the single producer of
    // membership-state rows: the two transitions above are two distinct source_refs, so
    // exactly two rows — both classified 'lifecycle', never the 'balance' default.
    const { rows: outbox } = await exec.query<{ n: number; kinds: string | null }>(
      `SELECT count(*)::int AS n, string_agg(DISTINCT sync_kind, ',') AS kinds
         FROM public.loyalty_wallet_sync_outbox
        WHERE account_id = $1`,
      [acct[0].id],
    );
    expect(Number(outbox[0].n)).toBe(2);
    expect(outbox[0].kinds).toBe("lifecycle");

    // The other seeded member has no Wallet object, so its (untouched) state enqueues
    // nothing — the guard, not an accident of ordering.
    const { rows: others } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_wallet_sync_outbox o
        JOIN public.loyalty_accounts a ON a.id = o.account_id
       WHERE a.shop_id = $1 AND o.account_id <> $2`,
      [shop, acct[0].id],
    );
    expect(Number(others[0].n)).toBe(0);
  });

  it("sale points and balance sync still work", async () => {
    const shop = await newShop("Sale Sync Shop");
    await seedMembers(shop, 1);
    const { rows: acct } = await exec.query<{ customer_id: string }>(
      `SELECT customer_id FROM public.loyalty_accounts WHERE shop_id = $1`,
      [shop],
    );
    const saleId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, total_ugx, completed_at)
       VALUES ($1,$2,$3,'completed','paid',30000, now())`,
      [saleId, shop, acct[0].customer_id],
    );
    const { rows } = await exec.query<{ earned: number; balance: number; outbox: number }>(
      `SELECT (SELECT count(*)::int FROM public.loyalty_transactions WHERE shop_id = $1 AND kind = 'earned') AS earned,
              (SELECT coalesce(sum(balance_points),0)::int FROM public.loyalty_accounts WHERE shop_id = $1) AS balance,
              (SELECT count(*)::int FROM public.loyalty_wallet_sync_outbox WHERE shop_id = $1 AND sync_kind = 'balance') AS outbox`,
      [shop],
    );
    expect(Number(rows[0].earned)).toBe(1);
    expect(Number(rows[0].balance)).toBeGreaterThan(0);
    expect(Number(rows[0].outbox)).toBe(1);
  });
});

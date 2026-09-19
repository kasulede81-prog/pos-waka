/**
 * Shop business-data reset + certified hard delete — FK ordering, coverage, verification, authorization.
 *
 * Real migration bodies (20260920100000_shop_reset_fk_ordered_plan.sql) run against a PGlite schema rebuilt from the
 * REAL production foreign-key graph (src/test/sqlIntegration/shopResetTopology.txt). Every table gets a seeded row so
 * every RESTRICT / NO ACTION / SET NULL edge is exercised.
 *
 * Mutation evidence: the pre-fix functions (admin_reset_shop_business_data from 20260918024500 and
 * certified_hard_delete_organization_execute from 148) are loaded into the same schema and are shown to FAIL.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MIGRATIONS_DIR,
  NEW_MIGRATION,
  asUser,
  createShopResetHarness,
  extractFunction,
  json,
  readMigrationText,
  readTopology,
  seedEverything,
  tableCounts,
  type SqlExec,
} from "../test/sqlIntegration/shopResetPgHarness";

const NO_TRANSFERS = ["enterprise_stock_transfers"];
const OLD_RESET = join(MIGRATIONS_DIR, "20260918024500_loyalty_data_foundation.sql");
const OLD_HARD_DELETE = join(MIGRATIONS_DIR, "148_owner_self_delete_reliability.sql");

type PlanRow = { step: number; tbl: string };
const uuid = () => crypto.randomUUID();

async function addInternalAdmin(exec: SqlExec, role = "super_admin"): Promise<string> {
  const id = uuid();
  await exec.exec(`INSERT INTO auth.users (id, email) VALUES ('${id}', 'admin-${id.slice(0, 6)}@example.test')`);
  await exec.exec(
    `INSERT INTO public.internal_admins (id, auth_user_id, user_id, role, is_active, active) VALUES (gen_random_uuid(), '${id}', '${id}', '${role}', true, true)`,
  );
  return id;
}

async function reset(exec: SqlExec, adminId: string, shopId: string, phase = "execute", confirm = "RESET SHOP") {
  return asUser(exec, adminId, async () => {
    const { rows } = await exec.query(`SELECT public.admin_reset_shop_business_data($1, $2, $3) AS r`, [
      shopId,
      phase,
      confirm,
    ]);
    return json(rows[0], "r");
  });
}

async function plan(exec: SqlExec): Promise<PlanRow[]> {
  const { rows } = await exec.query<PlanRow>(`SELECT step, tbl FROM public.shop_reset_business_plan() ORDER BY step`);
  return rows;
}

/** per-plan-table row counts for this shop */
async function planCounts(exec: SqlExec, shopId: string): Promise<Record<string, number>> {
  const { rows } = await exec.query(`SELECT public.shop_reset_business_counts($1) AS c`, [shopId]);
  return json(rows[0], "c") as Record<string, number>;
}

describe("static: the deletion plan respects the production FK graph", () => {
  const edges = readTopology();

  function violations(order: string[], guarded: string[] = []): string[] {
    const step = new Map(order.map((t, i) => [t, i]));
    const out: string[] = [];
    for (const e of edges) {
      if (e.action !== "r" && e.action !== "a") continue; // CASCADE / SET NULL cannot block a parent delete
      if (!step.has(e.parent)) continue;
      if (e.parent === "shops" || e.child === e.parent) continue; // self references are deleted in ONE statement
      if (guarded.includes(e.child)) continue;
      const childStep = step.get(e.child);
      if (childStep === undefined) out.push(`${e.child}.${e.column} -> ${e.parent} (${e.action}) child is not deleted at all`);
      else if (childStep >= step.get(e.parent)!) out.push(`${e.child}.${e.column} -> ${e.parent} (${e.action}) child deleted after parent`);
    }
    return out;
  }

  it("new plan has no RESTRICT / NO ACTION ordering violation", async () => {
    const exec = await createShopResetHarness();
    try {
      const order = (await plan(exec)).map((p) => p.tbl);
      // enterprise transfers are refused up-front by the reset (and deleted first by the hard delete)
      const v = violations(order, ["enterprise_stock_transfer_lines", "enterprise_stock_transfers"]);
      expect(v).toEqual([]);
    } finally {
      await exec.close();
    }
  });

  it("MUTATION: the pre-fix delete order violates the graph (table_sessions after sales)", () => {
    const old = readMigrationText(OLD_RESET);
    const body = old.slice(old.indexOf("create or replace function public.admin_reset_shop_business_data"));
    const order = [...body.matchAll(/delete from public\.(\w+)/g)].map((m) => m[1]);
    const v = violations(order, ["enterprise_stock_transfer_lines", "enterprise_stock_transfers"]);
    expect(v.join("\n")).toContain("table_sessions.sale_id -> sales");
    expect(v.length).toBeGreaterThan(1);
  });
});

describe("classification drift guard", () => {
  it("every shop-scoped table is classified exactly once as reset or retained", async () => {
    const exec = await createShopResetHarness();
    try {
      const { rows } = await exec.query<{ tbl: string; disposition: string }>(
        `SELECT tbl, disposition FROM public.shop_reset_table_classification()`,
      );
      const names = rows.map((r) => r.tbl);
      expect(new Set(names).size).toBe(names.length); // no table both reset and retained

      const shopScoped = [
        ...new Set(readTopology().filter((e) => e.parent === "shops").map((e) => e.child)),
      ].filter((t) => !["shops", "profiles"].includes(t));
      expect(shopScoped.filter((t) => !names.includes(t))).toEqual([]);
    } finally {
      await exec.close();
    }
  });

  it("no migration creates a shop-scoped table that the topology / classification does not know", async () => {
    const exec = await createShopResetHarness();
    try {
      const { rows } = await exec.query<{ tbl: string }>(`SELECT tbl FROM public.shop_reset_table_classification()`);
      const known = new Set(rows.map((r) => r.tbl));
      for (const e of readTopology()) known.add(e.child);
      const ignore = new Set(["shops", "profiles", "sale_line_items", "sale_payments", "kitchen_ticket_items"]);
      const unknown: string[] = [];
      for (const f of readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql"))) {
        const text = readMigrationText(join(MIGRATIONS_DIR, f));
        for (const m of text.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\)\s*;/gi)) {
          const [, table, body] = m;
          if (!/references\s+public\.shops\s*\(/i.test(body)) continue;
          if (!known.has(table) && !ignore.has(table)) unknown.push(`${table} (${f})`);
        }
      }
      // A failure here means a NEW table references shops: add it to shop_reset_business_plan() (business data)
      // or shop_reset_table_classification() (retained + reason), and to shopResetTopology.txt.
      expect(unknown).toEqual([]);
    } finally {
      await exec.close();
    }
  });
});

describe("admin_reset_shop_business_data (new)", () => {
  let exec: SqlExec;
  let admin: string;

  beforeAll(async () => {
    exec = await createShopResetHarness();
    admin = await addInternalAdmin(exec);
  }, 60_000);
  afterAll(async () => {
    await exec.close();
  });

  it("seeds a row in every plan table (so the tests below are meaningful)", async () => {
    const s = await seedEverything(exec, NO_TRANSFERS);
    const counts = await planCounts(exec, s.shopId);
    const empty = Object.entries(counts).filter(([, n]) => n === 0).map(([t]) => t);
    expect(empty).toEqual([]);
  });

  it("resets every plan table, keeps identity + retained tables, leaves the control shop untouched, sets the marker", async () => {
    const control = await seedEverything(exec, NO_TRANSFERS);
    const beforeOnlyControl = await tableCounts(exec);
    const target = await seedEverything(exec, NO_TRANSFERS);
    // RESTRICT chain that only exists with two rows: a loyalty reversal points at another ledger row
    const tx = await exec.query<{ id: string; account_id: string }>(
      `SELECT id, account_id FROM public.loyalty_transactions WHERE shop_id = $1`,
      [target.shopId],
    );
    await exec.exec(
      `INSERT INTO public.loyalty_transactions (id, shop_id, account_id, reversal_of_id) VALUES (gen_random_uuid(), '${target.shopId}', '${tx.rows[0].account_id}', '${tx.rows[0].id}')`,
    );
    const withTarget = await tableCounts(exec);
    const controlBefore = await planCounts(exec, control.shopId);

    const preview = await reset(exec, admin, target.shopId, "preview");
    expect(preview.ok).toBe(true);
    expect((preview.counts as Record<string, number>).table_sessions).toBeGreaterThan(0);

    const result = await reset(exec, admin, target.shopId);
    expect(result.ok).toBe(true);
    const verification = result.verification as Record<string, number>;
    expect(Object.values(verification).every((n) => n === 0)).toBe(true);
    expect(Object.keys(verification).sort()).toEqual((await plan(exec)).map((p) => p.tbl).sort());

    const after = await tableCounts(exec);
    const planTables = (await plan(exec)).map((p) => p.tbl);
    for (const t of planTables) {
      expect(after[t], `plan table ${t}`).toBe(beforeOnlyControl[t]); // only the control shop's rows remain
    }
    const mayChange = new Set(["internal_ops_admin_audit"]);
    // merchant_notifications rows tied to a deleted correction request cascade with the request (FK CASCADE)
    expect(after.merchant_notifications).toBeLessThanOrEqual(withTarget.merchant_notifications);
    for (const [t, n] of Object.entries(after)) {
      if (planTables.includes(t) || mayChange.has(t) || t === "merchant_notifications") continue;
      expect(n, `retained/identity table ${t}`).toBe(withTarget[t]);
    }
    expect(await planCounts(exec, control.shopId)).toEqual(controlBefore);

    const { rows: shops } = await exec.query(`SELECT count(*)::int AS n FROM public.shops WHERE id = $1`, [target.shopId]);
    expect(shops[0].n).toBe(1);
    const { rows: marker } = await exec.query<{ force_full_resync_at: string | null }>(
      `SELECT force_full_resync_at FROM public.shop_recovery_signals WHERE shop_id = $1`,
      [target.shopId],
    );
    expect(marker[0].force_full_resync_at).not.toBeNull();
    const { rows: health } = await exec.query<{ pending_outbound: number }>(
      `SELECT pending_outbound FROM public.sync_health WHERE shop_id = $1`,
      [target.shopId],
    );
    expect(health[0].pending_outbound).toBe(0);
    const { rows: audit } = await exec.query(
      `SELECT action FROM public.internal_ops_admin_audit WHERE target_shop_id = $1 ORDER BY created_at`,
      [target.shopId],
    );
    expect(audit.map((a) => a.action)).toContain("shop_reset_executed");
  });

  it("is idempotent: a second execute succeeds with nothing left to delete and refreshes the marker", async () => {
    const s = await seedEverything(exec, NO_TRANSFERS);
    const first = await reset(exec, admin, s.shopId);
    expect(first.ok).toBe(true);
    const { rows: m1 } = await exec.query<{ t: string }>(
      `SELECT force_full_resync_at::text AS t FROM public.shop_recovery_signals WHERE shop_id = $1`,
      [s.shopId],
    );
    const second = await reset(exec, admin, s.shopId);
    expect(second.ok).toBe(true);
    expect(Object.values(second.deleted as Record<string, number>).every((n) => n === 0)).toBe(true);
    const { rows: m2 } = await exec.query<{ t: string }>(
      `SELECT force_full_resync_at::text AS t FROM public.shop_recovery_signals WHERE shop_id = $1`,
      [s.shopId],
    );
    expect(m2[0].t >= m1[0].t).toBe(true);
  });

  it("the shop is fully usable after a reset: new sale + table session + stock movement can be created, and reset again", async () => {
    const s = await seedEverything(exec, NO_TRANSFERS);
    expect((await reset(exec, admin, s.shopId)).ok).toBe(true);
    // fresh business rows in the SAME shop (the FK graph, sequences and identity are intact)
    const productId = uuid();
    const saleId = uuid();
    await exec.exec(`INSERT INTO public.products (id, shop_id) VALUES ('${productId}', '${s.shopId}')`);
    await exec.exec(`INSERT INTO public.sales (id, shop_id) VALUES ('${saleId}', '${s.shopId}')`);
    await exec.exec(`INSERT INTO public.sale_line_items (id, sale_id, product_id) VALUES (gen_random_uuid(), '${saleId}', '${productId}')`);
    await exec.exec(`INSERT INTO public.sale_payments (id, sale_id) VALUES (gen_random_uuid(), '${saleId}')`);
    await exec.exec(`INSERT INTO public.inventory_movements (id, shop_id, product_id) VALUES (gen_random_uuid(), '${s.shopId}', '${productId}')`);
    await exec.exec(`INSERT INTO public.table_sessions (id, shop_id, sale_id) VALUES (gen_random_uuid(), '${s.shopId}', '${saleId}')`);
    const counts = await planCounts(exec, s.shopId);
    expect(counts.sales).toBe(1);
    expect(counts.table_sessions).toBe(1);
    const again = await reset(exec, admin, s.shopId);
    expect(again.ok).toBe(true);
    expect((again.deleted as Record<string, number>).sales).toBe(1);
    expect((again.deleted as Record<string, number>).table_sessions).toBe(1);
  });

  it("VERIFICATION: leftover rows fail the reset, roll EVERYTHING back and name the table", async () => {
    const s = await seedEverything(exec, NO_TRANSFERS);
    await exec.exec(`
      CREATE OR REPLACE FUNCTION public.test_skip_delete () RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER test_skip_stock BEFORE DELETE ON public.shop_stock_movements
        FOR EACH ROW EXECUTE FUNCTION public.test_skip_delete ();
    `);
    try {
      const before = await planCounts(exec, s.shopId);
      const { rows: markerBefore } = await exec.query(
        `SELECT force_full_resync_at::text AS t FROM public.shop_recovery_signals WHERE shop_id = $1`,
        [s.shopId],
      );
      const result = await reset(exec, admin, s.shopId);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("reset_failed");
      expect(result.failed_table).toBe("shop_stock_movements");
      expect(String(result.detail)).toContain("verification_failed_rows_remaining");
      expect(await planCounts(exec, s.shopId)).toEqual(before); // atomic: not even the sales were deleted
      const { rows: markerAfter } = await exec.query(
        `SELECT force_full_resync_at::text AS t FROM public.shop_recovery_signals WHERE shop_id = $1`,
        [s.shopId],
      );
      expect(markerAfter[0].t).toBe(markerBefore[0].t); // no marker was published for a failed reset
      const { rows: failedAudit } = await exec.query(
        `SELECT payload->>'failed_table' AS t FROM public.internal_ops_admin_audit WHERE target_shop_id = $1 AND action = 'shop_reset_failed'`,
        [s.shopId],
      );
      expect(failedAudit.map((r) => r.t)).toContain("shop_stock_movements");
    } finally {
      await exec.exec(`DROP TRIGGER test_skip_stock ON public.shop_stock_movements`);
    }
  });

  it("FAILURE: a blocked delete rolls everything back, names the failing table and is retryable", async () => {
    const s = await seedEverything(exec, NO_TRANSFERS);
    await exec.exec(`
      CREATE OR REPLACE FUNCTION public.test_block_delete () RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'blocked_by_test'; END $$;
      CREATE TRIGGER test_block_loyalty BEFORE DELETE ON public.loyalty_accounts
        FOR EACH ROW EXECUTE FUNCTION public.test_block_delete ();
    `);
    const before = await planCounts(exec, s.shopId);
    try {
      const failed = await reset(exec, admin, s.shopId);
      expect(failed.ok).toBe(false);
      expect(failed.failed_table).toBe("loyalty_accounts");
      expect(String(failed.detail)).toContain("blocked_by_test");
      expect(await planCounts(exec, s.shopId)).toEqual(before);
    } finally {
      await exec.exec(`DROP TRIGGER test_block_loyalty ON public.loyalty_accounts`);
    }
    const retried = await reset(exec, admin, s.shopId);
    expect(retried.ok).toBe(true);
  });

  it("refuses a shop that takes part in an enterprise stock transfer instead of silently skipping it", async () => {
    const s = await seedEverything(exec); // includes a transfer (from = to = shop)
    const before = await planCounts(exec, s.shopId);
    const result = await reset(exec, admin, s.shopId);
    expect(result.ok).toBe(false);
    expect(result.failed_table).toBe("enterprise_stock_transfers");
    expect(await planCounts(exec, s.shopId)).toEqual(before);
  });

  it("AUTHORIZATION: unchanged — only super_admin / operations_admin, exact confirmation phrase", async () => {
    const s = await seedEverything(exec, NO_TRANSFERS);
    const before = await planCounts(exec, s.shopId);

    const stranger = uuid();
    const denied = await reset(exec, stranger, s.shopId);
    expect(denied.ok).toBe(false);
    expect(denied.error).toBe("forbidden");

    const support = await addInternalAdmin(exec, "support_admin");
    expect((await reset(exec, support, s.shopId)).error).toBe("forbidden");

    const noConfirm = await reset(exec, admin, s.shopId, "execute", "reset it");
    expect(noConfirm.error).toBe("confirmation_required");
    expect(await planCounts(exec, s.shopId)).toEqual(before);

    await expect(
      asUser(exec, stranger, async () => exec.query(`SELECT public.admin_shop_reset_preview_counts($1)`, [s.shopId])),
    ).rejects.toThrow(/Forbidden/);

    const ops = await addInternalAdmin(exec, "operations_admin");
    expect((await reset(exec, ops, s.shopId, "preview")).ok).toBe(true);
    expect((await reset(exec, admin, uuid())).error).toBe("shop_not_found");
  });

  it("helper functions are not callable by anon / authenticated", async () => {
    const { rows } = await exec.query<{ fn: string; anon: boolean; authed: boolean }>(`
      SELECT p.proname AS fn,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('shop_reset_business_plan','shop_reset_table_classification','shop_reset_business_counts','shop_reset_business_data_core')`);
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.anon, r.fn).toBe(false);
      expect(r.authed, r.fn).toBe(false);
    }
  });
});

describe("MUTATION: the pre-fix reset fails on the same data", () => {
  it("old admin_reset_shop_business_data cannot reset a shop that has a table session (table_sessions_sale_id_fkey)", async () => {
    const exec = await createShopResetHarness({ applyNewMigration: false });
    try {
      await exec.exec(extractFunction(OLD_RESET, "admin_shop_reset_preview_counts"));
      await exec.exec(extractFunction(OLD_RESET, "admin_reset_shop_business_data"));
      const admin = await addInternalAdmin(exec);
      // (1) the reported production failure in isolation: only a table session blocks the reset
      const s = await seedEverything(exec, [...NO_TRANSFERS, "loyalty_redemptions"]);
      const result = await reset(exec, admin, s.shopId);
      expect(result.ok).toBe(false);
      expect(String(result.detail)).toContain("table_sessions_sale_id_fkey");
      // (2) the loyalty RESTRICT chain the old list also could not handle
      const s2 = await seedEverything(exec, NO_TRANSFERS);
      const r2 = await reset(exec, admin, s2.shopId);
      expect(r2.ok).toBe(false);
      expect(String(r2.detail)).toMatch(/loyalty_redemptions|table_sessions_sale_id_fkey/);
    } finally {
      await exec.close();
    }
  });

  it("new function succeeds on exactly the same seeded data", async () => {
    const exec = await createShopResetHarness();
    try {
      const admin = await addInternalAdmin(exec);
      const s = await seedEverything(exec, NO_TRANSFERS);
      expect((await reset(exec, admin, s.shopId)).ok).toBe(true);
    } finally {
      await exec.close();
    }
  });
});

describe("certified_hard_delete_organization_execute", () => {
  it("MUTATION: the pre-fix function fails on corrections / loyalty / kitchen dependencies", async () => {
    const exec = await createShopResetHarness({ applyNewMigration: false });
    try {
      await exec.exec(extractFunction(OLD_HARD_DELETE, "hard_delete_verification_report"));
      await exec.exec(extractFunction(OLD_HARD_DELETE, "certified_hard_delete_organization_execute"));
      const s = await seedEverything(exec, NO_TRANSFERS);
      const { rows } = await exec.query(
        `SELECT public.certified_hard_delete_organization_execute($1, $2, $3, $3, 'internal', 'test') AS r`,
        [s.orgId, s.shopId, uuid()],
      );
      const out = json(rows[0], "r");
      expect(out.ok).toBe(false);
      expect(out.error).toBe("delete_failed");
      expect(String(out.detail)).toMatch(/sale_line_item_corrections|foreign key/);
    } finally {
      await exec.close();
    }
  });

  it("new function deletes the whole organization with every dependency, verifies all plan tables, spares other orgs", async () => {
    const exec = await createShopResetHarness();
    try {
      const other = await seedEverything(exec, NO_TRANSFERS);
      const otherBefore = await planCounts(exec, other.shopId);
      const s = await seedEverything(exec); // WITH an enterprise transfer
      const { rows } = await exec.query(
        `SELECT public.certified_hard_delete_organization_execute($1, $2, $3, $3, 'internal', 'test') AS r`,
        [s.orgId, s.shopId, uuid()],
      );
      const out = json(rows[0], "r");
      expect({ ok: out.ok, error: out.error, detail: out.detail }).toEqual({ ok: true, error: undefined, detail: undefined });
      const verification = out.verification as { all_passed: boolean; counts: Record<string, number> };
      expect(verification.all_passed).toBe(true);
      expect(Object.keys(verification.counts).filter((k) => k.startsWith("biz_")).length).toBe((await plan(exec)).length);
      expect(Object.values(verification.counts).every((n) => n === 0)).toBe(true);

      const { rows: gone } = await exec.query(
        `SELECT (SELECT count(*) FROM public.organizations WHERE id = $1)::int AS orgs,
                (SELECT count(*) FROM public.shops WHERE id = $2)::int AS shops`,
        [s.orgId, s.shopId],
      );
      expect(gone[0]).toEqual({ orgs: 0, shops: 0 });
      expect(await planCounts(exec, other.shopId)).toEqual(otherBefore);
    } finally {
      await exec.close();
    }
  });
});

describe("legacy one-shot delete overloads", () => {
  it("are dropped by the migration while the certified 3-arg wrappers stay", async () => {
    const exec = await createShopResetHarness({ applyNewMigration: false });
    try {
      await exec.exec(`
        CREATE FUNCTION public.owner_permanently_delete_own_account (p_confirmation text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
        CREATE FUNCTION public.owner_permanently_delete_own_account (p_confirmation text, p_phase text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
        CREATE FUNCTION public.admin_permanently_delete_shop_account (p_shop_id uuid, p_confirmation text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
        CREATE FUNCTION public.admin_permanently_delete_shop_account (p_shop_id uuid, p_confirmation text, p_phase text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
      `);
      const probe = async (sig: string) =>
        (await exec.query(`SELECT to_regprocedure('${sig}') IS NOT NULL AS x`)).rows[0].x;
      expect(await probe("public.owner_permanently_delete_own_account(text)")).toBe(true);
      await exec.exec(readMigrationText(NEW_MIGRATION));
      expect(await probe("public.owner_permanently_delete_own_account(text)")).toBe(false);
      expect(await probe("public.admin_permanently_delete_shop_account(uuid,text)")).toBe(false);
      expect(await probe("public.owner_permanently_delete_own_account(text,text)")).toBe(true);
      expect(await probe("public.admin_permanently_delete_shop_account(uuid,text,text)")).toBe(true);
    } finally {
      await exec.close();
    }
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { SqlExec } from "./transferEnginePgHarness";
export type { SqlExec };

const BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "loyaltyBootstrap.sql");
/**
 * Exported so a test can build a database at an INTERMEDIATE point in the chain — apply everything
 * up to (but not including) a given migration, seed the shape a real deployment already has, and
 * only then apply it. That is the only way to reproduce a migration against a table that already
 * holds rows, which is the one thing an empty-database harness can never exercise.
 */
export const MIGRATIONS = [
  join(process.cwd(), "supabase", "migrations", "20260918024500_loyalty_data_foundation.sql"),
  join(process.cwd(), "supabase", "migrations", "20260918090000_loyalty_merchant_ui.sql"),
  join(process.cwd(), "supabase", "migrations", "20260918100000_loyalty_enrollment_identity.sql"),
  join(process.cwd(), "supabase", "migrations", "20260918110000_loyalty_rewards.sql"),
  join(process.cwd(), "supabase", "migrations", "20260922222138_loyalty_engine_primitive_revoke.sql"),
  // Wallet outbox + google_wallet_* columns, so Wallet-safety assertions are real.
  join(process.cwd(), "supabase", "migrations", "20260923120000_loyalty_google_wallet_sync.sql"),
  join(process.cwd(), "supabase", "migrations", "20260923233000_loyalty_public_card_token.sql"),
  join(process.cwd(), "supabase", "migrations", "20260924010000_loyalty_redeem_auth_concurrency.sql"),
  join(process.cwd(), "supabase", "migrations", "20260924015233_loyalty_card_designs.sql"),
  join(process.cwd(), "supabase", "migrations", "20260924093000_loyalty_membership_expiry.sql"),
  join(process.cwd(), "supabase", "migrations", "20260924104500_loyalty_reward_expiry.sql"),
  join(process.cwd(), "supabase", "migrations", "20260924120000_loyalty_points_expiry.sql"),
  join(process.cwd(), "supabase", "migrations", "20260924150000_loyalty_customer_offers.sql"),
  join(process.cwd(), "supabase", "migrations", "20260924160000_loyalty_customer_lifecycle.sql"),
  // Rate-limit table required by D028 scope extension (fail-closed durable buckets).
  join(process.cwd(), "supabase", "migrations", "20260924001500_edge_rate_limit_buckets.sql"),
  join(process.cwd(), "supabase", "migrations", "20260924170000_loyalty_public_self_enrollment.sql"),
  join(process.cwd(), "supabase", "migrations", "20260924180000_loyalty_reward_assignments.sql"),
  join(process.cwd(), "supabase", "migrations", "20260924190000_loyalty_product_backed_rewards.sql"),
  // Phase 1 — loyalty add-on entitlement + server-side member allowance.
  join(process.cwd(), "supabase", "migrations", "20260926090000_loyalty_membership_entitlements.sql"),
  // Phase 2 — public enrollment requests + merchant approval.
  join(process.cwd(), "supabase", "migrations", "20260926091000_loyalty_enrollment_requests.sql"),
  // Phase 3 — lifecycle (reactivate/renew) respects the member allowance.
  join(process.cwd(), "supabase", "migrations", "20260926093000_loyalty_member_lifecycle_allowance.sql"),
  // Phase 4 — public enrollment abuse protection + member status filtering.
  join(process.cwd(), "supabase", "migrations", "20260926094000_loyalty_enrollment_abuse_protection.sql"),
  // Phase 5 — Google Wallet follows the membership lifecycle.
  join(process.cwd(), "supabase", "migrations", "20260926095000_loyalty_wallet_lifecycle_sync.sql"),
  // Phase 6A — internal-admin control plane + privilege hardening.
  join(process.cwd(), "supabase", "migrations", "20260926096000_loyalty_admin_control_plane.sql"),
  // Phase 6B — read-only internal-admin dashboard queries.
  join(process.cwd(), "supabase", "migrations", "20260926097000_loyalty_admin_dashboard_reads.sql"),
  // Phase 6D — Loyalty audit events cannot be forged/edited/erased from the browser.
  join(process.cwd(), "supabase", "migrations", "20260926098000_loyalty_admin_audit_integrity.sql"),
  // Phase 0 (Member Dashboard) — grant-layer hardening + over-exposed RPC revokes.
  join(process.cwd(), "supabase", "migrations", "20260928090000_loyalty_phase0_grant_hardening.sql"),
  join(process.cwd(), "supabase", "migrations", "20260928091000_loyalty_phase0_rpc_execute_revoke.sql"),
  // Phase 1 (Member Dashboard) — member identity, projection, claim queue.
  join(process.cwd(), "supabase", "migrations", "20260928100000_loyalty_member_identity.sql"),
  join(process.cwd(), "supabase", "migrations", "20260928101000_loyalty_member_projection.sql"),
  join(process.cwd(), "supabase", "migrations", "20260928102000_loyalty_member_grant_revoke.sql"),
  // Phase 2A — create the member link on enrollment approval (multi-shop membership).
  join(process.cwd(), "supabase", "migrations", "20260928110000_loyalty_multishop_member_link.sql"),
  // WPL — permanent public Loyalty Program code (WPL2026001) on loyalty_programs.
  join(process.cwd(), "supabase", "migrations", "20260928120000_loyalty_program_public_code.sql"),
  // WPL — public code resolution + code-based enrollment (shares the token path's core).
  join(process.cwd(), "supabase", "migrations", "20260928121000_loyalty_program_code_resolution.sql"),
  // WPL — merchant overview + internal admin lookup/search.
  join(process.cwd(), "supabase", "migrations", "20260928122000_loyalty_program_code_admin_merchant.sql"),
  // Phase 2C — authenticated member join by WPL code (adds a path; the anonymous one is unchanged).
  join(process.cwd(), "supabase", "migrations", "20260929120000_loyalty_member_join_by_code.sql"),
  // Phase 2D — a member can read the status of their OWN enrollment requests (+ realtime visibility).
  join(process.cwd(), "supabase", "migrations", "20260929160000_loyalty_member_enrollment_status.sql"),
  // Phase 2F — a NEW loyalty member must supply a phone (the RPC previously accepted NULL).
  join(process.cwd(), "supabase", "migrations", "20260929180000_loyalty_member_register_requires_phone.sql"),
  // Loyalty Phase 0 — integrity pass: proportional return reversal, ledger append-only
  // guard, balance-invariant checker, and the award-failure record + retry queue.
  join(process.cwd(), "supabase", "migrations", "20260930090000_loyalty_integrity_pass.sql"),
  // Loyalty Phase A — the member-scoped activity projection (auth.uid() only, no identity params).
  join(process.cwd(), "supabase", "migrations", "20260930120000_loyalty_member_activity.sql"),
  // Loyalty Phase B — the member-scoped rewards read model (auth.uid() only, no identity params).
  join(process.cwd(), "supabase", "migrations", "20260930150000_loyalty_member_rewards.sql"),
  // Loyalty Phase C — merchant-side Customer 360 (shop-scoped read model over sales + loyalty).
  join(process.cwd(), "supabase", "migrations", "20260930180000_loyalty_customer_360.sql"),
  // Loyalty Phase D — merchant-side redemption reversal (append-only credit, one per redemption).
  join(process.cwd(), "supabase", "migrations", "20260930210000_loyalty_redemption_reversal.sql"),
  // Loyalty Phase E — reward benefits (fixed UGX / percentage discount snapshots + application).
  join(process.cwd(), "supabase", "migrations", "20260930230000_loyalty_reward_benefits.sql"),
  // Loyalty Phase F — reward lifecycle: guarded removal of a reward that has no history.
  join(process.cwd(), "supabase", "migrations", "20260930250000_loyalty_reward_lifecycle.sql"),
  // Loyalty Phase G — customer visibility of running promotions (read-only member projection).
  join(process.cwd(), "supabase", "migrations", "20260930270000_loyalty_member_promotions.sql"),
  // Loyalty Phase G — spend-triggered promotions (threshold awards + member progress).
  join(process.cwd(), "supabase", "migrations", "20260930290000_loyalty_spend_promotions.sql"),
  // Member-scoped Wallet authority: auth.uid() -> member -> active link -> account (the pass
  // itself is still issued by the existing loyalty-wallet-pass Edge Function).
  join(process.cwd(), "supabase", "migrations", "20260930310000_loyalty_member_wallet_issue.sql"),
];

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Opt-in production privilege posture, applied after the bootstrap and BEFORE the migrations,
 * exactly where it sits in the real chain:
 *   - 010_grants.sql: blanket DML on every table (and future tables) to `authenticated`;
 *   - 030: RLS on internal_ops_admin_audit with the shared `FOR ALL` internal-staff policy.
 * Without it, a "permission denied" can mean "never granted" rather than "revoked by the
 * migration", so privilege tests that must prove a revoke use this mode.
 */
const PRODUCTION_GRANTS = `
  GRANT USAGE ON SCHEMA public TO authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
  -- Supabase's baseline also carries these, and production shows them on every loyalty table
  -- (010_grants.sql does NOT grant them, so they come from the platform defaults). Modelling
  -- them is what makes the Phase 0 TRUNCATE revokes testable rather than vacuous.
  GRANT TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO authenticated;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

  ALTER TABLE public.internal_ops_admin_audit ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS internal_ops_admin_audit_staff ON public.internal_ops_admin_audit;
  CREATE POLICY internal_ops_admin_audit_staff
    ON public.internal_ops_admin_audit FOR ALL
    USING (public.is_waka_internal_staff ())
    WITH CHECK (public.is_waka_internal_staff ());
`;

export async function createLoyaltySqlHarness(opts: { productionGrants?: boolean } = {}): Promise<SqlExec> {
  const url = process.env.TEST_DATABASE_URL?.trim();

  if (url) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const exec: SqlExec = {
      async query<T extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ) {
        const res = await client.query(sql, params);
        return { rows: res.rows as unknown as T[] };
      },
      async exec(sql: string) {
        await client.query(sql);
      },
      async close() {
        await client.end();
      },
    };
    await exec.exec(readSql(BOOTSTRAP));
    if (opts.productionGrants) await exec.exec(PRODUCTION_GRANTS);
    for (const migration of MIGRATIONS) await exec.exec(readSql(migration));
    await exec.exec(FORCE_RLS);
    return exec;
  }

  const db = new PGlite();
  const exec: SqlExec = {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ) {
      const res = await db.query(sql, params);
      return { rows: res.rows as unknown as T[] };
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
    async close() {
      await db.close();
    },
  };
  await exec.exec(readSql(BOOTSTRAP));
  if (opts.productionGrants) await exec.exec(PRODUCTION_GRANTS);
  for (const migration of MIGRATIONS) await exec.exec(readSql(migration));
  await exec.exec(FORCE_RLS);
  return exec;
}

// Enforce RLS for the test role so isolation tests are real: the harness
// superuser still sees everything (assertions), while `asUser` runs as the
// authenticated role subject to policies.
const FORCE_RLS = `
  ALTER TABLE public.loyalty_programs FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.loyalty_accounts FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.loyalty_transactions FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.loyalty_rewards FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.loyalty_redemptions FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.loyalty_card_designs FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.loyalty_point_lot_allocations FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.loyalty_customer_offers FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.loyalty_enrollment_links FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.loyalty_reward_assignments FORCE ROW LEVEL SECURITY;
`;

export async function asUser<T>(exec: SqlExec, userId: string, fn: () => Promise<T>): Promise<T> {
  await exec.exec("BEGIN");
  await exec.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
  await exec.exec("SET LOCAL ROLE authenticated");
  try {
    const result = await fn();
    await exec.exec("COMMIT");
    return result;
  } catch (err) {
    await exec.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Run `fn` as the `anon` role, so a public path is exercised as a real anonymous
 * client rather than merely as "somebody with no JWT". Two suites had grown their own
 * copy of this; it lives here now.
 */
export async function asAnon<T>(exec: SqlExec, fn: () => Promise<T>): Promise<T> {
  await exec.exec("BEGIN");
  await exec.exec("SET LOCAL ROLE anon");
  try {
    const result = await fn();
    await exec.exec("COMMIT");
    return result;
  } catch (err) {
    await exec.exec("ROLLBACK");
    throw err;
  }
}

export function rpcJson(row: Record<string, unknown> | undefined): Record<string, unknown> {
  const raw =
    row?.loyalty_award_for_sale ??
    row?.loyalty_reverse_for_return ??
    row?.loyalty_reverse_for_sale ??
    row?.loyalty_enroll_customer ??
    row?.loyalty_adjust_points ??
    row?.loyalty_shop_overview ??
    row?.loyalty_update_program ??
    row?.loyalty_search_accounts ??
    row?.loyalty_account_by_token ??
    row?.loyalty_redeem_reward ??
    row?.loyalty_upsert_card_design ??
    row?.loyalty_reset_card_design ??
    row?.loyalty_renew_membership ??
    row?.loyalty_set_account_lifecycle ??
    row?.loyalty_purge_revoked_accounts ??
    row?.loyalty_get_enrollment_link ??
    row?.loyalty_regenerate_enrollment_link ??
    row?.loyalty_revoke_enrollment_link ??
    row?.loyalty_preview_enrollment_link ??
    row?.loyalty_enroll_by_enrollment_token ??
    row?.loyalty_list_reward_assignments ??
    row?.loyalty_assign_reward ??
    row?.loyalty_revoke_reward_assignment ??
    row?.result;
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") return JSON.parse(raw) as Record<string, unknown>;
  return (row ?? {}) as Record<string, unknown>;
}

export type LoyaltyFixture = {
  orgId: string;
  shopAId: string;
  shopBId: string;
  ownerAId: string;
  cashierAId: string;
  outsiderId: string;
  internalAdminId: string;
  customerAId: string;
  customerBId: string;
  productAId: string;
};

export async function seedLoyaltyFixture(exec: SqlExec): Promise<LoyaltyFixture> {
  const f: LoyaltyFixture = {
    orgId: crypto.randomUUID(),
    shopAId: crypto.randomUUID(),
    shopBId: crypto.randomUUID(),
    ownerAId: crypto.randomUUID(),
    cashierAId: crypto.randomUUID(),
    outsiderId: crypto.randomUUID(),
    internalAdminId: crypto.randomUUID(),
    customerAId: crypto.randomUUID(),
    customerBId: crypto.randomUUID(),
    productAId: crypto.randomUUID(),
  };

  await exec.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${f.ownerAId}', 'owner-a@test.local'),
      ('${f.cashierAId}', 'cashier-a@test.local'),
      ('${f.outsiderId}', 'outsider@test.local'),
      ('${f.internalAdminId}', 'internal@test.local');

    INSERT INTO public.organizations (id, name) VALUES ('${f.orgId}', 'Loyalty Org');

    INSERT INTO public.shops (id, organization_id, name, shop_number) VALUES
      ('${f.shopAId}', '${f.orgId}', 'Shop A', 'LOY-A'),
      ('${f.shopBId}', '${f.orgId}', 'Shop B', 'LOY-B');

    INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
      ('${f.shopAId}', '${f.ownerAId}', 'owner'),
      ('${f.shopAId}', '${f.cashierAId}', 'cashier'),
      ('${f.shopAId}', '${f.internalAdminId}', 'super_admin'),
      ('${f.shopBId}', '${f.outsiderId}', 'owner');

    INSERT INTO public.customers (id, shop_id, name, phone_e164) VALUES
      ('${f.customerAId}', '${f.shopAId}', 'Customer A', '+256700000001'),
      ('${f.customerBId}', '${f.shopBId}', 'Customer B', '+256700000002');

    INSERT INTO public.products (id, shop_id, name) VALUES
      ('${f.productAId}', '${f.shopAId}', 'Product A');
  `);

  return f;
}

export async function enableProgram(
  exec: SqlExec,
  shopId: string,
  opts: { earnUnitUgx?: number; earnPointsPerUnit?: number; minEligibleSpendUgx?: number } = {},
): Promise<void> {
  await exec.query(
    `INSERT INTO public.loyalty_programs (shop_id, enabled, earn_unit_ugx, earn_points_per_unit, min_eligible_spend_ugx)
     VALUES ($1, true, $2, $3, $4)`,
    [
      shopId,
      opts.earnUnitUgx ?? 1000,
      opts.earnPointsPerUnit ?? 1,
      opts.minEligibleSpendUgx ?? 0,
    ],
  );
}

export async function insertCompletedSale(
  exec: SqlExec,
  f: LoyaltyFixture,
  opts: { totalUgx: number; customerId?: string | null },
): Promise<string> {
  const saleId = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, total_ugx, completed_at)
     VALUES ($1, $2, $3, 'completed', 'paid', $4, now())`,
    [saleId, f.shopAId, opts.customerId ?? null, opts.totalUgx],
  );
  return saleId;
}

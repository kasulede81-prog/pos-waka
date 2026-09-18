import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { SqlExec } from "./transferEnginePgHarness";
export type { SqlExec };

const BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "loyaltyBootstrap.sql");
const MIGRATIONS = [
  join(process.cwd(), "supabase", "migrations", "20260918024500_loyalty_data_foundation.sql"),
  join(process.cwd(), "supabase", "migrations", "20260918090000_loyalty_merchant_ui.sql"),
  join(process.cwd(), "supabase", "migrations", "20260918100000_loyalty_enrollment_identity.sql"),
];

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

export async function createLoyaltySqlHarness(): Promise<SqlExec> {
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

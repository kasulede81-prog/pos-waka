import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { asUser, rpcJson, type SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";

const BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "transferEngineBootstrap.sql");
const LOOKUP_BOOTSTRAP = join(
  process.cwd(),
  "src",
  "test",
  "sqlIntegration",
  "historicalFinancialCorrectionLookupBootstrap.sql",
);
const REQUESTS_BOOTSTRAP = join(
  process.cwd(),
  "src",
  "test",
  "sqlIntegration",
  "financialCorrectionRequestsBootstrap.sql",
);
const MIGRATION_195 = join(process.cwd(), "supabase/migrations/195_financial_correction_requests.sql");

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

async function createHarness(): Promise<SqlExec> {
  const url = process.env.TEST_DATABASE_URL?.trim();
  const build = async (queryImpl: SqlExec["query"], execImpl: SqlExec["exec"], closeImpl: SqlExec["close"]) => {
    const exec: SqlExec = { query: queryImpl, exec: execImpl, close: closeImpl };
    await exec.exec(readSql(BOOTSTRAP));
    await exec.exec(readSql(LOOKUP_BOOTSTRAP));
    await exec.exec(readSql(REQUESTS_BOOTSTRAP));
    await exec.exec(readSql(MIGRATION_195));
    return exec;
  };

  if (url) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    return build(
      async (sql, params = []) => ({ rows: (await client.query(sql, params)).rows }) as never,
      async (sql) => void (await client.query(sql)),
      async () => client.end(),
    );
  }

  const db = new PGlite();
  return build(
    async (sql, params = []) => ({ rows: (await db.query(sql, params)).rows }) as never,
    async (sql) => void (await db.exec(sql)),
    async () => db.close(),
  );
}

async function report(exec: SqlExec, shopId: string, lineId: string, reason: string, evidence: string | null = null) {
  const { rows } = await exec.query<Record<string, unknown>>(
    `SELECT public.shop_report_financial_issue($1::uuid, $2::uuid, $3::text, $4::text) AS result`,
    [shopId, lineId, reason, evidence],
  );
  return rpcJson(rows[0]);
}

async function setStatus(exec: SqlExec, requestId: string, status: string, notes: string | null = null) {
  const { rows } = await exec.query<Record<string, unknown>>(
    `SELECT public.internal_set_financial_correction_request_status($1::uuid, $2::text, $3::text) AS result`,
    [requestId, status, notes],
  );
  return rpcJson(rows[0]);
}

async function link(exec: SqlExec, requestId: string, correctionId: string) {
  const { rows } = await exec.query<Record<string, unknown>>(
    `SELECT public.internal_link_financial_correction_request($1::uuid, $2::uuid) AS result`,
    [requestId, correctionId],
  );
  return rpcJson(rows[0]);
}

async function list(exec: SqlExec) {
  const { rows } = await exec.query<Record<string, unknown>>(
    `SELECT public.internal_list_financial_correction_requests(null) AS result`,
  );
  return rpcJson(rows[0]);
}

describe("FIN-ISSUE-REPORT financial_correction_requests workflow", () => {
  let exec: SqlExec;

  const orgId = "b1950000-0000-4000-8000-000000000001";
  const shopAId = "b1950000-0000-4000-8000-000000000002";
  const shopBId = "b1950000-0000-4000-8000-000000000003";
  const productAId = "b1950000-0000-4000-8000-000000000004";

  const superAdminId = "b1950000-0000-4000-8000-000000000010";
  const financeAdminId = "b1950000-0000-4000-8000-000000000011";
  const supportAdminId = "b1950000-0000-4000-8000-000000000012";
  const shopOwnerId = "b1950000-0000-4000-8000-000000000013";
  const outsiderId = "b1950000-0000-4000-8000-000000000014";

  const saleAId = "b1950000-0000-4000-8000-000000000020";
  const lineAId = "b1950000-0000-4000-8000-000000000021"; // qty 2.5, fresh, never corrected
  const lineAlreadyCorrectedId = "b1950000-0000-4000-8000-000000000022";

  beforeAll(async () => {
    exec = await createHarness();

    await exec.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${superAdminId}'::uuid, 'super195@waka.ug'),
        ('${financeAdminId}'::uuid, 'finance195@waka.ug'),
        ('${supportAdminId}'::uuid, 'support195@waka.ug'),
        ('${shopOwnerId}'::uuid, 'owner195@shopA.ug'),
        ('${outsiderId}'::uuid, 'outsider195@nowhere.ug')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.internal_admins (user_id, auth_user_id, email, role, active, is_active, can_view_sensitive_data)
      VALUES
        ('${superAdminId}'::uuid, '${superAdminId}'::uuid, 'super195@waka.ug', 'super_admin', true, true, false),
        ('${financeAdminId}'::uuid, '${financeAdminId}'::uuid, 'finance195@waka.ug', 'finance_admin', true, true, false),
        ('${supportAdminId}'::uuid, '${supportAdminId}'::uuid, 'support195@waka.ug', 'support_admin', true, true, false)
      ON CONFLICT (user_id) DO NOTHING;

      INSERT INTO public.organizations (id, name) VALUES ('${orgId}'::uuid, 'Report Test Org')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.shops (id, organization_id, name, is_active) VALUES
        ('${shopAId}'::uuid, '${orgId}'::uuid, 'Shop A', true),
        ('${shopBId}'::uuid, '${orgId}'::uuid, 'Shop B', true)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
        ('${shopAId}'::uuid, '${shopOwnerId}'::uuid, 'owner'),
        ('${shopBId}'::uuid, '${shopOwnerId}'::uuid, 'owner')
      ON CONFLICT (shop_id, user_id) DO NOTHING;

      INSERT INTO public.products (id, shop_id, name, cost_price_per_unit_ugx, conversion_rate)
      VALUES ('${productAId}'::uuid, '${shopAId}'::uuid, 'basimat', 3000, 25)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.sales (id, shop_id, status, created_at) VALUES
        ('${saleAId}'::uuid, '${shopAId}'::uuid, 'completed', '2026-09-14T14:09:00Z')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.sale_line_items (id, sale_id, product_id, quantity, line_total_ugx, metadata, financial_revision)
      VALUES
        ('${lineAId}'::uuid, '${saleAId}'::uuid, '${productAId}'::uuid, 2.5, 10000,
          '{"unitCostUgx":3600,"cogsUgx":9000,"grossProfitUgx":1000,"estimatedProfitUgx":1000}'::jsonb, 0),
        ('${lineAlreadyCorrectedId}'::uuid, '${saleAId}'::uuid, '${productAId}'::uuid, 1, 3000,
          '{"unitCostUgx":3000,"cogsUgx":3000,"grossProfitUgx":0,"estimatedProfitUgx":0}'::jsonb, 1)
      ON CONFLICT (id) DO NOTHING;
    `);
  });

  afterAll(async () => {
    await exec.close();
  });

  it("1. a shop user can report a financial issue from a completed sale", async () => {
    const result = await asUser(exec, shopOwnerId, () =>
      report(exec, shopAId, lineAId, "The cost on this line looks wrong for a 2.5kg sale."),
    );
    expect(result.ok).toBe(true);
    expect(typeof result.request_id).toBe("string");
  });

  it("2-3. sale_id and sale_line_item_id are captured automatically, not client-supplied", async () => {
    const listing = await asUser(exec, superAdminId, () => list(exec));
    expect(listing.ok).toBe(true);
    const requests = listing.requests as Record<string, unknown>[];
    const row = requests.find((r) => r.saleLineItemId === lineAId);
    expect(row).toBeTruthy();
    expect(row?.saleId).toBe(saleAId);
    expect(row?.productId).toBe(productAId);
  });

  it("4. shop_id is captured/validated, not merely echoed — a fabricated line/shop combination is rejected", async () => {
    const result = await asUser(exec, shopOwnerId, () => report(exec, shopBId, lineAId, "trying to misattribute this line to shop B"));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("line_not_found");
  });

  it("5. a user without access to the shop cannot submit a report for it", async () => {
    const result = await asUser(exec, outsiderId, () => report(exec, shopAId, lineAId, "outsider trying to report"));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("forbidden");
  });

  it("11. duplicate open report for the same line is rejected", async () => {
    // lineAId already has an open ('submitted') report from test 1.
    const result = await asUser(exec, shopOwnerId, () => report(exec, shopAId, lineAId, "second report attempt"));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("report_already_open_for_line");
  });

  it("12. a line that was already corrected (financial_revision > 0) refuses a new report", async () => {
    const result = await asUser(exec, shopOwnerId, () =>
      report(exec, shopAId, lineAlreadyCorrectedId, "reporting an already-corrected line"),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("already_corrected");
  });

  it("7. an internal admin can view the report", async () => {
    const listing = await asUser(exec, financeAdminId, () => list(exec));
    expect(listing.ok).toBe(true);
    expect((listing.requests as unknown[]).length).toBeGreaterThan(0);
  });

  it("8. an internal admin (support_admin) can investigate — move status to under_review", async () => {
    const listing = await asUser(exec, superAdminId, () => list(exec));
    const row = (listing.requests as Record<string, unknown>[]).find((r) => r.saleLineItemId === lineAId)!;
    const result = await asUser(exec, supportAdminId, () => setStatus(exec, String(row.id), "under_review", "looking into it"));
    expect(result.ok).toBe(true);
    expect(result.status).toBe("under_review");
  });

  it("6/9a. the investigation function itself can never set correction_applied", async () => {
    const listing = await asUser(exec, superAdminId, () => list(exec));
    const row = (listing.requests as Record<string, unknown>[]).find((r) => r.saleLineItemId === lineAId)!;
    const result = await asUser(exec, superAdminId, () => setStatus(exec, String(row.id), "correction_applied"));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_status");
  });

  it("9b. only super_admin/finance_admin may link a request to a correction — support_admin is rejected", async () => {
    const listing = await asUser(exec, superAdminId, () => list(exec));
    const row = (listing.requests as Record<string, unknown>[]).find((r) => r.saleLineItemId === lineAId)!;

    // Create a real correction record for this line (as the already-tested correction
    // RPC would have) so the link function has something legitimate to reject the
    // wrong caller for.
    const correctionId = "b1950000-0000-4000-8000-000000000099";
    await exec.exec(`
      INSERT INTO public.sale_line_item_corrections (
        id, sale_id, sale_line_item_id, shop_id, product_id, before, after, correction_basis,
        reason, corrected_by, corrected_role, resulting_revision
      ) VALUES (
        '${correctionId}'::uuid, '${saleAId}'::uuid, '${lineAId}'::uuid, '${shopAId}'::uuid, '${productAId}'::uuid,
        '{"unitCostUgx":3600,"cogsUgx":9000,"grossProfitUgx":1000,"estimatedProfitUgx":1000}'::jsonb,
        '{"unitCostUgx":3000,"cogsUgx":7500,"grossProfitUgx":2500,"estimatedProfitUgx":2500}'::jsonb,
        '{"basisType":"pack_cost_conversion","packCostUgx":75000,"conversionRate":25}'::jsonb,
        'test correction', '${superAdminId}'::uuid, 'super_admin', 1
      )
      ON CONFLICT (id) DO NOTHING;
    `);

    const forbidden = await asUser(exec, supportAdminId, () => link(exec, String(row.id), correctionId));
    expect(forbidden.ok).toBe(false);
    expect(forbidden.error).toBe("forbidden");
  });

  it("10. a correction_id that doesn't match the request's line is rejected (correction_line_mismatch)", async () => {
    const listing = await asUser(exec, superAdminId, () => list(exec));
    const row = (listing.requests as Record<string, unknown>[]).find((r) => r.saleLineItemId === lineAId)!;

    const wrongCorrectionId = "b1950000-0000-4000-8000-000000000098";
    await exec.exec(`
      INSERT INTO public.sale_line_item_corrections (
        id, sale_id, sale_line_item_id, shop_id, product_id, before, after, correction_basis,
        reason, corrected_by, corrected_role, resulting_revision
      ) VALUES (
        '${wrongCorrectionId}'::uuid, '${saleAId}'::uuid, '${lineAlreadyCorrectedId}'::uuid, '${shopAId}'::uuid, '${productAId}'::uuid,
        '{}'::jsonb, '{}'::jsonb, '{"basisType":"pack_cost_conversion","packCostUgx":1,"conversionRate":1}'::jsonb,
        'unrelated line correction', '${superAdminId}'::uuid, 'super_admin', 1
      )
      ON CONFLICT (id) DO NOTHING;
    `);

    const result = await asUser(exec, superAdminId, () => link(exec, String(row.id), wrongCorrectionId));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("correction_line_mismatch");
  });

  it("successful link moves the request to correction_applied and records who/when/which correction", async () => {
    const listing = await asUser(exec, superAdminId, () => list(exec));
    const row = (listing.requests as Record<string, unknown>[]).find((r) => r.saleLineItemId === lineAId)!;
    const correctionId = "b1950000-0000-4000-8000-000000000099"; // created in the "9b" test above

    const result = await asUser(exec, financeAdminId, () => link(exec, String(row.id), correctionId));
    expect(result.ok).toBe(true);

    const after = await asUser(exec, superAdminId, () => list(exec));
    const updated = (after.requests as Record<string, unknown>[]).find((r) => r.saleLineItemId === lineAId)!;
    expect(updated.status).toBe("correction_applied");
    expect(updated.correctionId).toBe(correctionId);
    expect(updated.resolvedBy).toBe(financeAdminId);
  });

  it("already-linked request cannot be linked again", async () => {
    const listing = await asUser(exec, superAdminId, () => list(exec));
    const row = (listing.requests as Record<string, unknown>[]).find((r) => r.saleLineItemId === lineAId)!;
    const result = await asUser(exec, superAdminId, () => link(exec, String(row.id), "b1950000-0000-4000-8000-000000000099"));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("already_corrected");
  });

  it("13/14. rejecting a report, and a failed report attempt, both leave financial data untouched", async () => {
    const before = await exec.query<Record<string, unknown>>(
      `SELECT financial_revision, metadata FROM public.sale_line_items WHERE id IN ($1::uuid, $2::uuid) ORDER BY id`,
      [lineAId, lineAlreadyCorrectedId],
    );

    // A rejected report (submit + reject a fresh one on a still-clean line) …
    const productBId = "b1950000-0000-4000-8000-000000000005";
    const saleCId = "b1950000-0000-4000-8000-000000000023";
    const lineCId = "b1950000-0000-4000-8000-000000000024";
    await exec.exec(`
      INSERT INTO public.products (id, shop_id, name, cost_price_per_unit_ugx, conversion_rate)
      VALUES ('${productBId}'::uuid, '${shopAId}'::uuid, 'other product', 1000, 10)
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.sales (id, shop_id, status, created_at)
      VALUES ('${saleCId}'::uuid, '${shopAId}'::uuid, 'completed', now())
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.sale_line_items (id, sale_id, product_id, quantity, line_total_ugx, metadata, financial_revision)
      VALUES ('${lineCId}'::uuid, '${saleCId}'::uuid, '${productBId}'::uuid, 1, 500,
        '{"unitCostUgx":100,"cogsUgx":100,"grossProfitUgx":400,"estimatedProfitUgx":400}'::jsonb, 0)
      ON CONFLICT (id) DO NOTHING;
    `);
    const submitted = await asUser(exec, shopOwnerId, () => report(exec, shopAId, lineCId, "testing rejection path"));
    expect(submitted.ok).toBe(true);
    const rejected = await asUser(exec, supportAdminId, () => setStatus(exec, String(submitted.request_id), "rejected"));
    expect(rejected.ok).toBe(true);

    // … and a failed submission (cross-shop) …
    await asUser(exec, shopOwnerId, () => report(exec, shopBId, lineCId, "should fail"));

    const after = await exec.query<Record<string, unknown>>(
      `SELECT financial_revision, metadata FROM public.sale_line_items WHERE id IN ($1::uuid, $2::uuid) ORDER BY id`,
      [lineAId, lineAlreadyCorrectedId],
    );
    expect(after.rows).toEqual(before.rows);

    const cLine = await exec.query<Record<string, unknown>>(
      `SELECT financial_revision FROM public.sale_line_items WHERE id = $1::uuid`,
      [lineCId],
    );
    expect(cLine.rows[0]?.financial_revision).toBe(0);
  });

  it("15. the audit chain answers who/what/when for every step of this workflow", async () => {
    const { rows } = await exec.query<Record<string, unknown>>(
      `SELECT action, actor_user_id, payload FROM public.audit_logs WHERE action LIKE 'financial_issue%' ORDER BY created_at`,
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("financial_issue_reported");
    expect(actions).toContain("financial_issue_request_status_changed");
    expect(actions).toContain("financial_issue_request_linked_to_correction");

    const linked = rows.find((r) => r.action === "financial_issue_request_linked_to_correction")!;
    expect(linked.actor_user_id).toBe(financeAdminId);
    const payload = linked.payload as Record<string, unknown>;
    expect(payload.correctionId).toBe("b1950000-0000-4000-8000-000000000099");
  });
});

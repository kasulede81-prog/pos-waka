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
const MIGRATION_SUPPORT = join(
  process.cwd(),
  "supabase/migrations/20260917003000_merchant_support_center.sql",
);

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
    await exec.exec(readSql(MIGRATION_SUPPORT));
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

/**
 * Runs fn as the given user WITH the authenticated role so table-level RLS
 * policies are enforced (the harness connection is otherwise the table owner,
 * which bypasses RLS by design).
 */
async function asRoleUser<T>(exec: SqlExec, userId: string, fn: () => Promise<T>): Promise<T> {
  await exec.exec("BEGIN");
  try {
    await exec.exec("SET LOCAL ROLE authenticated");
    await exec.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    const result = await fn();
    await exec.exec("COMMIT");
    return result;
  } catch (err) {
    await exec.exec("ROLLBACK");
    throw err;
  }
}

async function rpc(exec: SqlExec, sql: string, params: unknown[] = []) {
  const { rows } = await exec.query<Record<string, unknown>>(sql, params);
  return rpcJson(rows[0]);
}

const createTicket = (exec: SqlExec, shopId: string, subject: string, category: string, body: string) =>
  rpc(
    exec,
    `SELECT public.shop_create_support_ticket($1::uuid, $2::text, $3::text, $4::text) AS result`,
    [shopId, subject, category, body],
  );

const replyTicket = (exec: SqlExec, ticketId: string, body: string) =>
  rpc(exec, `SELECT public.shop_reply_support_ticket($1::uuid, $2::text) AS result`, [ticketId, body]);

const markTicketRead = (exec: SqlExec, ticketId: string) =>
  rpc(exec, `SELECT public.shop_mark_ticket_messages_read($1::uuid) AS result`, [ticketId]);

const markNotifRead = (exec: SqlExec, notificationId: string) =>
  rpc(exec, `SELECT public.shop_mark_notification_read($1::uuid) AS result`, [notificationId]);

const markAllRead = (exec: SqlExec, shopId: string) =>
  rpc(exec, `SELECT public.shop_mark_all_notifications_read($1::uuid) AS result`, [shopId]);

const listCorrections = (exec: SqlExec, shopId: string) =>
  rpc(exec, `SELECT public.shop_list_my_financial_correction_requests($1::uuid) AS result`, [shopId]);

const report = (exec: SqlExec, shopId: string, lineId: string, reason: string) =>
  rpc(exec, `SELECT public.shop_report_financial_issue($1::uuid, $2::uuid, $3::text, null) AS result`, [
    shopId,
    lineId,
    reason,
  ]);

const setStatus = (exec: SqlExec, requestId: string, status: string) =>
  rpc(exec, `SELECT public.internal_set_financial_correction_request_status($1::uuid, $2::text, null) AS result`, [
    requestId,
    status,
  ]);

const linkCorrection = (exec: SqlExec, requestId: string, correctionId: string) =>
  rpc(exec, `SELECT public.internal_link_financial_correction_request($1::uuid, $2::uuid) AS result`, [
    requestId,
    correctionId,
  ]);

describe("MERCHANT-SUPPORT Notifications & Support Center (migration 20260917003000)", () => {
  let exec: SqlExec;

  const orgId = "b1970000-0000-4000-8000-000000000001";
  const shopAId = "b1970000-0000-4000-8000-000000000002";
  const shopBId = "b1970000-0000-4000-8000-000000000003";
  const productAId = "b1970000-0000-4000-8000-000000000004";

  const ownerAId = "b1970000-0000-4000-8000-000000000010";
  const ownerBId = "b1970000-0000-4000-8000-000000000011";
  const outsiderId = "b1970000-0000-4000-8000-000000000012";
  const superAdminId = "b1970000-0000-4000-8000-000000000013";
  const supportAdminId = "b1970000-0000-4000-8000-000000000014";

  const saleAId = "b1970000-0000-4000-8000-000000000020";
  const lineFresh1Id = "b1970000-0000-4000-8000-000000000021";
  const lineFresh2Id = "b1970000-0000-4000-8000-000000000022";

  let ticketAId = "";
  let notificationForTicketId = "";
  let correctionRequestId = "";

  beforeAll(async () => {
    exec = await createHarness();

    await exec.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${ownerAId}'::uuid, 'owner197a@shop.ug'),
        ('${ownerBId}'::uuid, 'owner197b@shop.ug'),
        ('${outsiderId}'::uuid, 'outsider197@nowhere.ug'),
        ('${superAdminId}'::uuid, 'super197@waka.ug'),
        ('${supportAdminId}'::uuid, 'support197@waka.ug');

      INSERT INTO public.internal_admins (user_id, auth_user_id, email, role, active, is_active, can_view_sensitive_data)
      VALUES
        ('${superAdminId}'::uuid, '${superAdminId}'::uuid, 'super197@waka.ug', 'super_admin', true, true, false),
        ('${supportAdminId}'::uuid, '${supportAdminId}'::uuid, 'support197@waka.ug', 'support_admin', true, true, false)
      ON CONFLICT (user_id) DO NOTHING;

      INSERT INTO public.organizations (id, name) VALUES ('${orgId}'::uuid, 'Support Test Org');

      INSERT INTO public.shops (id, organization_id, name, is_active) VALUES
        ('${shopAId}'::uuid, '${orgId}'::uuid, 'Support Shop A', true),
        ('${shopBId}'::uuid, '${orgId}'::uuid, 'Support Shop B', true);

      INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
        ('${shopAId}'::uuid, '${ownerAId}'::uuid, 'owner'),
        ('${shopBId}'::uuid, '${ownerBId}'::uuid, 'owner');

      INSERT INTO public.products (id, shop_id, name, cost_price_per_unit_ugx, conversion_rate)
      VALUES ('${productAId}'::uuid, '${shopAId}'::uuid, 'basimat', 3000, 25);

      INSERT INTO public.sales (id, shop_id, status, created_at) VALUES
        ('${saleAId}'::uuid, '${shopAId}'::uuid, 'completed', '2026-09-15T10:00:00Z');

      INSERT INTO public.sale_line_items (id, sale_id, product_id, quantity, line_total_ugx, metadata, financial_revision)
      VALUES
        ('${lineFresh1Id}'::uuid, '${saleAId}'::uuid, '${productAId}'::uuid, 2.5, 10000,
          '{"unitCostUgx":3600,"cogsUgx":9000,"grossProfitUgx":1000,"estimatedProfitUgx":1000}'::jsonb, 0),
        ('${lineFresh2Id}'::uuid, '${saleAId}'::uuid, '${productAId}'::uuid, 1, 3000,
          '{"unitCostUgx":3000,"cogsUgx":3000,"grossProfitUgx":0,"estimatedProfitUgx":0}'::jsonb, 0);
    `);
  });

  afterAll(async () => {
    await exec.close();
  });

  // ------------------------------------------------------------------
  // Support tickets
  // ------------------------------------------------------------------

  it("1. merchant can create a support ticket and load it (with its messages)", async () => {
    const created = await asUser(exec, ownerAId, () =>
      createTicket(exec, shopAId, "Printer not responding", "printing", "The receipt printer stopped working this morning."),
    );
    expect(created.ok).toBe(true);
    expect(typeof created.ticket_id).toBe("string");
    expect(Number(created.ticket_number)).toBeGreaterThan(0);
    ticketAId = String(created.ticket_id);

    const tickets = await asRoleUser(exec, ownerAId, () =>
      exec.query(`SELECT id, status, category, subject, ticket_number FROM public.merchant_support_tickets WHERE shop_id = $1::uuid`, [shopAId]),
    );
    expect(tickets.rows).toHaveLength(1);
    expect(tickets.rows[0].status).toBe("open");
    expect(tickets.rows[0].category).toBe("printing");

    const messages = await asRoleUser(exec, ownerAId, () =>
      exec.query(`SELECT author_kind, body FROM public.merchant_support_messages WHERE ticket_id = $1::uuid`, [ticketAId]),
    );
    expect(messages.rows).toHaveLength(1);
    expect(messages.rows[0].author_kind).toBe("merchant");
  });

  it("2. ticket creation writes a support_request_received notification linked to the ticket", async () => {
    const rows = await asRoleUser(exec, ownerAId, () =>
      exec.query(
        `SELECT id, type, title, related_ticket_id, related_request_id FROM public.merchant_notifications WHERE shop_id = $1::uuid`,
        [shopAId],
      ),
    );
    const n = rows.rows.find((r) => r.type === "support_request_received");
    expect(n).toBeTruthy();
    expect(n?.related_ticket_id).toBe(ticketAId);
    expect(n?.related_request_id).toBeNull();
    notificationForTicketId = String(n?.id);
  });

  it("3. merchant cannot load another merchant's tickets or messages", async () => {
    const bTickets = await asRoleUser(exec, ownerBId, () =>
      exec.query(`SELECT id FROM public.merchant_support_tickets WHERE shop_id = $1::uuid`, [shopAId]),
    );
    expect(bTickets.rows).toHaveLength(0);

    const outsiderTickets = await asRoleUser(exec, outsiderId, () =>
      exec.query(`SELECT id FROM public.merchant_support_tickets`),
    );
    expect(outsiderTickets.rows).toHaveLength(0);

    const bMessages = await asRoleUser(exec, ownerBId, () =>
      exec.query(`SELECT id FROM public.merchant_support_messages WHERE ticket_id = $1::uuid`, [ticketAId]),
    );
    expect(bMessages.rows).toHaveLength(0);
  });

  it("4. merchant can reply; WAKA can set waiting_for_you; merchant read state persists", async () => {
    const replied = await asUser(exec, ownerAId, () => replyTicket(exec, ticketAId, "I checked the cable, still nothing."));
    expect(replied.ok).toBe(true);

    // WAKA support replies internally and moves the ticket to waiting_for_merchant.
    await asRoleUser(exec, supportAdminId, async () => {
      await exec.query(
        `INSERT INTO public.merchant_support_messages (ticket_id, author_user_id, author_kind, body)
         VALUES ($1::uuid, $2::uuid, 'waka', 'Please confirm the printer model number.')`,
        [ticketAId, supportAdminId],
      );
      await exec.query(
        `UPDATE public.merchant_support_tickets SET status = 'waiting_for_merchant', last_message_at = now() WHERE id = $1::uuid`,
        [ticketAId],
      );
    });

    const unread = await asRoleUser(exec, ownerAId, () =>
      exec.query(
        `SELECT count(*)::int AS n FROM public.merchant_support_messages
         WHERE ticket_id = $1::uuid AND author_kind = 'waka' AND read_by_merchant_at IS NULL`,
        [ticketAId],
      ),
    );
    expect(unread.rows[0].n).toBe(1);

    const marked = await asUser(exec, ownerAId, () => markTicketRead(exec, ticketAId));
    expect(marked.ok).toBe(true);

    // Re-checked in a brand-new transaction: the read state is persisted server-side.
    const after = await asRoleUser(exec, ownerAId, () =>
      exec.query(
        `SELECT count(*)::int AS n FROM public.merchant_support_messages
         WHERE ticket_id = $1::uuid AND author_kind = 'waka' AND read_by_merchant_at IS NULL`,
        [ticketAId],
      ),
    );
    expect(after.rows[0].n).toBe(0);
  });

  it("5. merchant reply from waiting_for_you hands the ticket back to open", async () => {
    const replied = await asUser(exec, ownerAId, () => replyTicket(exec, ticketAId, "Model is POS-80C."));
    expect(replied.ok).toBe(true);
    const row = await exec.query(`SELECT status FROM public.merchant_support_tickets WHERE id = $1::uuid`, [ticketAId]);
    expect(row.rows[0].status).toBe("open");
  });

  it("6. resolved tickets are not replyable by the merchant", async () => {
    await asRoleUser(exec, supportAdminId, () =>
      exec.query(`UPDATE public.merchant_support_tickets SET status = 'resolved', resolved_at = now() WHERE id = $1::uuid`, [ticketAId]),
    );
    const result = await asUser(exec, ownerAId, () => replyTicket(exec, ticketAId, "still broken!"));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("ticket_not_replyable");
  });

  it("7. RLS blocks a merchant from forging a WAKA message or updating a ticket", async () => {
    await expect(
      asRoleUser(exec, ownerAId, () =>
        exec.query(
          `INSERT INTO public.merchant_support_messages (ticket_id, author_user_id, author_kind, body)
           VALUES ($1::uuid, $2::uuid, 'waka', 'forged')`,
          [ticketAId, ownerAId],
        ),
      ),
    ).rejects.toThrow();

    // RLS UPDATE: merchant matches no policy row — silently updates nothing.
    const blockedUpdate = await asRoleUser(exec, ownerAId, () =>
      exec.query(`UPDATE public.merchant_support_tickets SET status = 'closed' WHERE id = $1::uuid RETURNING id`, [ticketAId]),
    );
    expect(blockedUpdate.rows).toHaveLength(0);

    // Unchanged after both attempts.
    const row = await exec.query(`SELECT status FROM public.merchant_support_tickets WHERE id = $1::uuid`, [ticketAId]);
    expect(row.rows[0].status).toBe("resolved");
  });

  // ------------------------------------------------------------------
  // Notifications
  // ------------------------------------------------------------------

  it("8. merchant can load own notifications; other merchants and outsiders cannot", async () => {
    const own = await asRoleUser(exec, ownerAId, () =>
      exec.query(`SELECT id FROM public.merchant_notifications WHERE shop_id = $1::uuid`, [shopAId]),
    );
    expect(own.rows.length).toBeGreaterThan(0);

    const other = await asRoleUser(exec, ownerBId, () =>
      exec.query(`SELECT id FROM public.merchant_notifications WHERE shop_id = $1::uuid`, [shopAId]),
    );
    expect(other.rows).toHaveLength(0);

    const outsider = await asRoleUser(exec, outsiderId, () =>
      exec.query(`SELECT id FROM public.merchant_notifications`),
    );
    expect(outsider.rows).toHaveLength(0);
  });

  it("9. merchant can mark own notification read (and it stays read); cannot mark another's", async () => {
    const result = await asUser(exec, ownerAId, () => markNotifRead(exec, notificationForTicketId));
    expect(result.ok).toBe(true);

    const persisted = await exec.query(`SELECT read_at FROM public.merchant_notifications WHERE id = $1::uuid`, [
      notificationForTicketId,
    ]);
    expect(persisted.rows[0].read_at).not.toBeNull();

    const asOther = await asUser(exec, ownerBId, () => markNotifRead(exec, notificationForTicketId));
    expect(asOther.ok).toBe(false);
    expect(asOther.error).toBe("not_found");

    const asOutsider = await asUser(exec, outsiderId, () => markNotifRead(exec, notificationForTicketId));
    expect(asOutsider.ok).toBe(false);
  });

  it("10. RLS UPDATE policy blocks cross-shop mark-read even at table level", async () => {
    await exec.query(
      `INSERT INTO public.merchant_notifications (shop_id, type, title, message)
       VALUES ($1::uuid, 'system_announcement', 'Announcement', 'Shop A only')`,
      [shopAId],
    );

    const attempt = await asRoleUser(exec, ownerBId, () =>
      exec.query(
        `UPDATE public.merchant_notifications SET read_at = now() WHERE shop_id = $1::uuid AND read_at IS NULL`,
        [shopAId],
      ),
    );
    // RLS silently filters: no row updated.
    expect(attempt.rows).toHaveLength(0);

    const stillUnread = await exec.query(
      `SELECT count(*)::int AS n FROM public.merchant_notifications WHERE shop_id = $1::uuid AND read_at IS NULL`,
      [shopAId],
    );
    expect(stillUnread.rows[0].n).toBe(1);
  });

  it("11. unread count is correct and mark-all-read clears it shop-wide", async () => {
    const before = await asRoleUser(exec, ownerAId, () =>
      exec.query(`SELECT count(*)::int AS n FROM public.merchant_notifications WHERE shop_id = $1::uuid AND read_at IS NULL`, [shopAId]),
    );
    expect(before.rows[0].n).toBe(1);

    const cleared = await asUser(exec, ownerAId, () => markAllRead(exec, shopAId));
    expect(cleared.ok).toBe(true);

    const after = await asRoleUser(exec, ownerAId, () =>
      exec.query(`SELECT count(*)::int AS n FROM public.merchant_notifications WHERE shop_id = $1::uuid AND read_at IS NULL`, [shopAId]),
    );
    expect(after.rows[0].n).toBe(0);

    // Shop B is untouched.
    const shopB = await asRoleUser(exec, ownerBId, () =>
      exec.query(`SELECT count(*)::int AS n FROM public.merchant_notifications WHERE shop_id = $1::uuid`, [shopBId]),
    );
    expect(shopB.rows[0].n).toBe(0);
  });

  it("12. outsiders cannot create tickets for a shop they don't belong to", async () => {
    const result = await asUser(exec, outsiderId, () =>
      createTicket(exec, shopAId, "not mine", "other", "trying to open a ticket on shop A"),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("forbidden");
  });

  // ------------------------------------------------------------------
  // Financial correction integration (existing system untouched)
  // ------------------------------------------------------------------

  it("13. reporting a financial issue notifies the merchant and appears in the merchant list RPC", async () => {
    const before = await exec.query(
      `SELECT financial_revision, metadata FROM public.sale_line_items WHERE id = $1::uuid`,
      [lineFresh1Id],
    );

    const reported = await asUser(exec, ownerAId, () =>
      report(exec, shopAId, lineFresh1Id, "The cost on this line looks wrong."),
    );
    expect(reported.ok).toBe(true);
    correctionRequestId = String(reported.request_id);

    // Trigger wrote a shop notification linked to the request.
    const n = await exec.query(
      `SELECT type, title, message, related_request_id, metadata FROM public.merchant_notifications
       WHERE related_request_id = $1::uuid`,
      [correctionRequestId],
    );
    expect(n.rows).toHaveLength(1);
    expect(n.rows[0].type).toBe("financial_issue_received");
    expect(String((n.rows[0].metadata as Record<string, unknown>).saleRef)).toMatch(/^#[0-9a-f]{8}$/);

    // Merchant-facing projection: friendly, no admin notes / internals.
    const listed = await asUser(exec, ownerAId, () => listCorrections(exec, shopAId));
    expect(listed.ok).toBe(true);
    const requests = listed.requests as Record<string, unknown>[];
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe("submitted");
    expect(String(requests[0].saleRef)).toMatch(/^#[0-9a-f]{8}$/);
    expect(requests[0].productName).toBe("basimat");
    expect(requests[0]).not.toHaveProperty("adminNotes");
    expect(requests[0]).not.toHaveProperty("admin_notes");
    expect(requests[0]).not.toHaveProperty("correctionId");

    // Financial data untouched by reporting + notification trigger.
    const after = await exec.query(
      `SELECT financial_revision, metadata FROM public.sale_line_items WHERE id = $1::uuid`,
      [lineFresh1Id],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("14. existing investigation workflow still works and notifies the merchant on each transition", async () => {
    const moved = await asUser(exec, supportAdminId, () => setStatus(exec, correctionRequestId, "under_review"));
    expect(moved.ok).toBe(true);

    const n = await exec.query(
      `SELECT type FROM public.merchant_notifications WHERE related_request_id = $1::uuid ORDER BY created_at`,
      [correctionRequestId],
    );
    expect(n.rows.map((r) => r.type)).toEqual(["financial_issue_received", "financial_issue_under_review"]);

    // Existing audit chain intact.
    const audit = await exec.query(
      `SELECT action FROM public.audit_logs WHERE action = 'financial_issue_request_status_changed'`,
    );
    expect(audit.rows.length).toBeGreaterThan(0);

    // Merchant list RPC reflects the real status.
    const listed = await asUser(exec, ownerAId, () => listCorrections(exec, shopAId));
    expect((listed.requests as Record<string, unknown>[])[0].status).toBe("under_review");
  });

  it("15. merchant list RPC is scoped: another shop's owner gets nothing, foreign shop is forbidden", async () => {
    const foreign = await asUser(exec, ownerBId, () => listCorrections(exec, shopAId));
    expect(foreign.ok).toBe(false);
    expect(foreign.error).toBe("forbidden");

    const ownShop = await asUser(exec, ownerBId, () => listCorrections(exec, shopBId));
    expect(ownShop.ok).toBe(true);
    expect(ownShop.requests).toHaveLength(0);
  });

  it("16. resolution through the existing link flow notifies 'Financial issue resolved' without touching financial logic", async () => {
    const correctionId = "b1970000-0000-4000-8000-000000000099";
    await exec.exec(`
      INSERT INTO public.sale_line_item_corrections (
        id, sale_id, sale_line_item_id, shop_id, product_id, before, after, correction_basis,
        reason, corrected_by, corrected_role, resulting_revision
      ) VALUES (
        '${correctionId}'::uuid, '${saleAId}'::uuid, '${lineFresh1Id}'::uuid, '${shopAId}'::uuid, '${productAId}'::uuid,
        '{"unitCostUgx":3600,"cogsUgx":9000,"grossProfitUgx":1000,"estimatedProfitUgx":1000}'::jsonb,
        '{"unitCostUgx":3000,"cogsUgx":7500,"grossProfitUgx":2500,"estimatedProfitUgx":2500}'::jsonb,
        '{"basisType":"pack_cost_conversion","packCostUgx":75000,"conversionRate":25}'::jsonb,
        'test correction', '${superAdminId}'::uuid, 'super_admin', 1
      );
    `);

    const linked = await asUser(exec, superAdminId, () => linkCorrection(exec, correctionRequestId, correctionId));
    expect(linked.ok).toBe(true);

    const n = await exec.query(
      `SELECT type, title FROM public.merchant_notifications WHERE related_request_id = $1::uuid ORDER BY created_at`,
      [correctionRequestId],
    );
    expect(n.rows.map((r) => r.type)).toEqual([
      "financial_issue_received",
      "financial_issue_under_review",
      "financial_issue_resolved",
    ]);
    expect(n.rows[2].title).toBe("Financial issue resolved");

    const listed = await asUser(exec, ownerAId, () => listCorrections(exec, shopAId));
    expect((listed.requests as Record<string, unknown>[])[0].status).toBe("correction_applied");
  });
});

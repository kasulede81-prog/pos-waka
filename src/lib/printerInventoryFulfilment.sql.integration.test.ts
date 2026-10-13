/**
 * WAKA printer inventory and fulfilment — Phase 1 SQL contract.
 *
 * WHAT THIS PINS. A WAKA-owned registry of physical printers, and an append-only
 * record of handing one to an eligible customer. Three things matter most, and
 * each has its own describe block:
 *
 *   1. ELIGIBILITY is read from the subscription ROW — active, annual, business,
 *      future period end — so a monthly trial and a promotional grant can never
 *      qualify anyone.
 *   2. ALLOCATION cannot double-allocate: one unit per open assignment, one open
 *      assignment per organization per promotion, enforced by partial unique
 *      indexes and a status-predicate update rather than by hope.
 *   3. HISTORY survives. A cancelled, expired or completed attempt is never
 *      rewritten, and a handed-over printer can never be taken back by any
 *      ordinary RPC.
 *
 * CONCURRENCY, HONESTLY. This harness is PGlite — one connection — so genuine
 * two-session races CANNOT be exercised here and nothing below claims they were.
 * The allocation test proves the mechanism deterministically (a unit already
 * taken is not handed out twice, and the pool is exhausted in order); real
 * two-session proof needs `TEST_DATABASE_URL` and the pattern used by
 * `subscriptionPaymentConcurrency.sql.integration.test.ts`, which fails loudly
 * without it rather than pretending.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, type SqlExec } from "../test/sqlIntegration/loyaltyPgHarness";
import {
  createSubscriptionPaymentSqlHarness,
  rpcJson,
  seedSubscriptionPaymentFixture,
  type SubscriptionPaymentFixture,
} from "../test/sqlIntegration/subscriptionPaymentPgHarness";

const PROMO = "business_annual_printer_v1";

describe("printer inventory and fulfilment — SQL contract", () => {
  let exec: SqlExec & { isRealPostgres: boolean };
  let fx: SubscriptionPaymentFixture;
  let stockAdminId: string;
  let financeAdminId: string;
  let supportAdminId: string;
  let opAdminId: string;
  let subscriptionsAdminId: string;
  let fieldAgentId: string;

  beforeAll(async () => {
    exec = await createSubscriptionPaymentSqlHarness();
    fx = await seedSubscriptionPaymentFixture(exec);

    stockAdminId = crypto.randomUUID(); // super_admin         → stock AND fulfilment
    opAdminId = crypto.randomUUID(); // operations_admin   → stock AND fulfilment
    subscriptionsAdminId = crypto.randomUUID(); // subscriptions_admin→ fulfilment only
    financeAdminId = crypto.randomUUID(); // finance_admin      → NEITHER
    supportAdminId = crypto.randomUUID(); // support_admin      → NEITHER
    fieldAgentId = crypto.randomUUID(); // field_agent        → NEITHER

    await exec.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${stockAdminId}', 'printer-super@test.local'),
        ('${opAdminId}', 'printer-ops@test.local'),
        ('${subscriptionsAdminId}', 'printer-subs@test.local'),
        ('${financeAdminId}', 'printer-finance@test.local'),
        ('${supportAdminId}', 'printer-support@test.local'),
        ('${fieldAgentId}', 'printer-field@test.local');

      INSERT INTO public.internal_admins (user_id, role, active) VALUES
        ('${stockAdminId}', 'super_admin', true),
        ('${opAdminId}', 'operations_admin', true),
        ('${subscriptionsAdminId}', 'subscriptions_admin', true),
        ('${financeAdminId}', 'finance_admin', true),
        ('${supportAdminId}', 'support_admin', true),
        ('${fieldAgentId}', 'field_agent', true);

      -- The harness's is_waka_internal_role reads shop_members (see the
      -- hardening suite): each actor needs its real role name there so refusals
      -- are decided by the ROLE, not by a missing row.
      INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
        ('${fx.shopAId}', '${stockAdminId}', 'super_admin'),
        ('${fx.shopAId}', '${opAdminId}', 'operations_admin'),
        ('${fx.shopAId}', '${subscriptionsAdminId}', 'subscriptions_admin'),
        ('${fx.shopAId}', '${financeAdminId}', 'finance_admin'),
        ('${fx.shopAId}', '${supportAdminId}', 'support_admin'),
        ('${fx.shopAId}', '${fieldAgentId}', 'field_agent');

      -- Both subscriptions start on the CATALOG business plan, so a test only
      -- has to change the one dimension it is about.
      UPDATE public.subscriptions
         SET plan_id = (SELECT id FROM public.subscription_plans WHERE code = 'business')
       WHERE id IN ('${fx.subscriptionAId}', '${fx.subscriptionBId}');
    `);
  }, 300_000);

  afterAll(async () => {
    await exec?.close();
  });

  beforeEach(async () => {
    await exec.exec("DELETE FROM public.waka_printer_assignments;");
    await exec.exec("DELETE FROM public.waka_printer_units;");
    await exec.exec("DELETE FROM public.internal_ops_admin_audit;");
    await exec.exec(`DELETE FROM public.promotional_grants WHERE organization_id = '${fx.orgAId}';`);
    // Subscription A back to the fixture shape, then made eligible by default so
    // each eligibility test only has to BREAK the one dimension it is about.
    await exec.exec(`
      UPDATE public.subscriptions
         SET status = 'active', billing_interval = 'year',
             plan_id = (SELECT id FROM public.subscription_plans WHERE code = 'business'),
             current_period_start = now() - interval '10 days',
             current_period_end = now() + interval '355 days',
             shop_id = '${fx.shopAId}'
       WHERE id = '${fx.subscriptionAId}';
      UPDATE public.subscriptions
         SET status = 'trialing', billing_interval = 'month',
             plan_id = (SELECT id FROM public.subscription_plans WHERE code = 'business'),
             current_period_end = now() + interval '20 days',
             shop_id = '${fx.shopBId}'
       WHERE id = '${fx.subscriptionBId}';
    `);
  });

  // ---------------------------------------------------------------- helpers

  async function callRaw(userId: string, fn: string, args: unknown[]) {
    return asUser(exec, userId, async () => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await exec.query<Record<string, unknown>>(
        `SELECT public.${fn}(${placeholders}) AS result`,
        args,
      );
      return rows[0];
    });
  }

  async function rpc(userId: string, fn: string, args: unknown[]): Promise<Record<string, unknown>> {
    return rpcJson(await callRaw(userId, fn, args));
  }

  /**
   * The batch segment of a confirmed-format serial, so the common case supplies
   * an AGREEING batch code without every test restating it. Tests that are about
   * a mismatch pass the wrong code explicitly.
   */
  const batchFor = (serial: string): string | null => {
    const m = /^WP58-([0-9]{4})-[0-9]{3}$/.exec(serial.toUpperCase().trim());
    return m ? m[1]! : null;
  };

  const register = (admin: string, serial: string) =>
    rpc(admin, "internal_ops_printer_unit_create", [serial, batchFor(serial), fx.shopAId, null, "WP-58", 58, "new"]);

  const assign = (admin: string, shopId = fx.shopAId, promo = PROMO) =>
    rpc(admin, "internal_ops_printer_assign", [shopId, promo, 14]);

  /** Put subscription A into a specific shape, so each case differs by one fact. */
  async function shapeSubscription(patch: Record<string, string>) {
    const sets = Object.entries(patch).map(([k, v]) => {
      if (k === "plan_code") return `plan_id = (SELECT id FROM public.subscription_plans WHERE code = '${v}')`;
      return `${k} = ${v}`;
    });
    await exec.exec(`UPDATE public.subscriptions SET ${sets.join(", ")} WHERE id = '${fx.subscriptionAId}'`);
  }

  async function scalar<T = number>(sql: string, params: unknown[] = []): Promise<T> {
    const { rows } = await exec.query<Record<string, unknown>>(sql, params);
    return Object.values(rows[0] ?? {})[0] as T;
  }

  const unitStatus = (serial: string) =>
    scalar<string>(`SELECT status FROM public.waka_printer_units WHERE serial_number = $1`, [serial]);

  async function handoverFull(admin: string, assignmentId: string, shopId = fx.shopAId) {
    return rpc(admin, "internal_ops_printer_handover", [
      assignmentId, shopId, "Amina Nakato", "branch_collection", "+256700000001", "handover-photo-1.jpg", null,
    ]);
  }

  // ==========================================================================
  // Registration — only real serials, only by stock admins
  // ==========================================================================

  describe("registration", () => {
    it("registers a serial exactly as printed on the label", async () => {
      const res = await register(stockAdminId, "WP58-2609-001");
      expect(res.ok).toBe(true);
      expect(res.serial_number).toBe("WP58-2609-001");
      expect(res.status).toBe("available");
      expect(await unitStatus("WP58-2609-001")).toBe("available");
    });

    it("accepts the confirmed batch and does not hard-code a future format", async () => {
      // The confirmed first batch. `2609` is recorded as data, never decoded.
      expect((await register(stockAdminId, "WP58-2609-002")).ok).toBe(true);

      // A different, plausible future batch must NOT need a migration.
      expect((await register(stockAdminId, "WP58-2701-001")).ok).toBe(true);
      const other = await rpc(stockAdminId, "internal_ops_printer_unit_create", [
        "WAKA-WP80-0007", "2702", fx.shopAId, null, "WP-80", 80, "new",
      ]);
      expect(other.ok).toBe(true);
    });

    it("normalises case and surrounding whitespace rather than rejecting them", async () => {
      const res = await register(stockAdminId, "  wp58-2609-003  ");
      expect(res.ok).toBe(true);
      expect(res.serial_number).toBe("WP58-2609-003");
    });

    it("requires the batch code to AGREE with the serial's own batch segment", async () => {
      // WP58-2609-003 is this batch, so a batch code of anything else is a
      // self-contradicting record and is refused before it is written.
      const mismatch = await rpc(stockAdminId, "internal_ops_printer_unit_create", [
        "WP58-2609-003", "2610", fx.shopAId, null, "WP-58", 58, "new",
      ]);
      expect(mismatch.ok).toBe(false);
      expect(mismatch.error).toBe("batch_code_mismatch");
      expect(mismatch.expected_batch_code).toBe("2609");
      expect(await scalar<number>(`SELECT count(*)::int FROM public.waka_printer_units`)).toBe(0);

      // Missing entirely is refused too — not treated as "unknown".
      const missing = await rpc(stockAdminId, "internal_ops_printer_unit_create", [
        "WP58-2609-004", null, fx.shopAId, null, "WP-58", 58, "new",
      ]);
      expect(missing.ok).toBe(false);
      expect(missing.error).toBe("batch_code_mismatch");

      // The agreeing code is accepted, and stored as the segment itself.
      const ok = await register(stockAdminId, "WP58-2609-005");
      expect(ok.ok).toBe(true);
      expect(await scalar<string>(
        `SELECT batch_code FROM public.waka_printer_units WHERE serial_number = 'WP58-2609-005'`,
      )).toBe("2609");
    });

    it("leaves a FUTURE batch format unconstrained, and still accepts it", async () => {
      // Not the confirmed shape, so no batch agreement is imposed — a format we
      // have not been told about must never be rejected by a rule written for
      // this one, and must not need a migration.
      const future = await rpc(stockAdminId, "internal_ops_printer_unit_create", [
        "WAKA-WP80-2701-0007", null, fx.shopAId, null, "WP-80", 80, "new",
      ]);
      expect(future.ok).toBe(true);

      const withCode = await rpc(stockAdminId, "internal_ops_printer_unit_create", [
        "WP58-2701-001", "2701", fx.shopAId, null, "WP-58", 58, "new",
      ]);
      expect(withCode.ok).toBe(true);
    });

    it("refuses a batch code that contradicts the serial at the DATABASE too", async () => {
      // The RPC is not the only possible writer, so the table carries the rule.
      await expect(
        exec.exec(`
          INSERT INTO public.waka_printer_units (serial_number, batch_code)
          VALUES ('WP58-2609-777', '2610')
        `),
      ).rejects.toThrow(/waka_printer_units_batch_matches_serial|check constraint/i);
    });

    it("refuses to clear the batch code of a confirmed-batch unit", async () => {
      await register(stockAdminId, "WP58-2609-006");
      const unitId = await scalar<string>(
        `SELECT id FROM public.waka_printer_units WHERE serial_number = 'WP58-2609-006'`,
      );
      const res = await rpc(stockAdminId, "internal_ops_printer_unit_update", [
        unitId, "trying to blank the batch", "new", null, fx.shopAId, null,
      ]);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("batch_code_mismatch");
      expect(await scalar<string>(
        `SELECT batch_code FROM public.waka_printer_units WHERE id = $1`, [unitId],
      )).toBe("2609");
    });

    it("rejects a duplicate serial", async () => {
      await register(stockAdminId, "WP58-2609-004");
      const again = await register(stockAdminId, "WP58-2609-004");
      expect(again.ok).toBe(false);
      expect(again.error).toBe("serial_exists");
      expect(await scalar<number>(`SELECT count(*)::int AS v FROM public.waka_printer_units`)).toBe(1);
    });

    it("rejects a malformed serial", async () => {
      for (const bad of ["WP58 2609 001", "WP58/2609/001", "WP58-2609-00!", "AB"]) {
        const res = await register(stockAdminId, bad);
        expect(res.ok, `serial '${bad}'`).toBe(false);
        expect(res.error, `serial '${bad}'`).toBe("serial_malformed");
      }
      expect(await scalar<number>(`SELECT count(*)::int FROM public.waka_printer_units`)).toBe(0);
    });

    it("rejects a blank serial", async () => {
      const res = await register(stockAdminId, "   ");
      expect(res.ok).toBe(false);
      expect(res.error).toBe("serial_required");
    });

    it("refuses a holding branch that does not exist or is not active", async () => {
      const missing = await rpc(stockAdminId, "internal_ops_printer_unit_create", [
        "WP58-2609-005", "2609", crypto.randomUUID(), null, "WP-58", 58, "new",
      ]);
      expect(missing.ok).toBe(false);
      expect(missing.error).toBe("shop_not_found");

      await exec.exec(`UPDATE public.shops SET branch_status = 'archived' WHERE id = '${fx.shopAId}'`);
      const archived = await register(stockAdminId, "WP58-2609-006");
      expect(archived.ok).toBe(false);
      expect(archived.error).toBe("shop_not_active");
      await exec.exec(`UPDATE public.shops SET branch_status = 'active' WHERE id = '${fx.shopAId}'`);
    });

    it("separates stock permissions from fulfilment permissions", async () => {
      // Stock: super_admin and operations_admin only.
      expect((await register(opAdminId, "WP58-2609-010")).ok).toBe(true);

      for (const [actor, label] of [
        [financeAdminId, "finance_admin"],
        [supportAdminId, "support_admin"],
        [fx.ownerAId, "shop owner"],
        [fx.cashierAId, "cashier"],
        [fx.outsiderId, "outsider"],
      ] as const) {
        await expect(callRaw(actor, "internal_ops_printer_unit_create", [
          "WP58-2609-011", "2609", null, null, "WP-58", 58, "new",
        ])).rejects.toThrow(/forbidden/i);
        expect(label).toBeTruthy();
      }
    });

    it("enforces the full permission matrix on every RPC", async () => {
      // Granted: super_admin, subscriptions_admin, operations_admin for
      // fulfilment; super_admin and operations_admin for stock.
      // Denied: finance_admin (a billing role, but not a fulfilment one),
      // support_admin, field_agent, and every customer role.
      await register(stockAdminId, "WP58-2609-020");
      const assignment = await assign(opAdminId);
      expect(assignment.ok).toBe(true);
      const unitId = await scalar<string>(
        `SELECT id FROM public.waka_printer_units WHERE serial_number = 'WP58-2609-020'`,
      );

      /** [fn, args, may these roles call it] */
      const stockOnly: Array<[string, unknown[]]> = [
        ["internal_ops_printer_unit_create", ["WP58-2609-021", "2609", null, null, "WP-58", 58, "new"]],
        ["internal_ops_printer_unit_update", [unitId, "reason", "new", "2609", null, null]],
        ["internal_ops_printer_unit_retire", [unitId, "reason"]],
      ];
      const fulfilmentOnly: Array<[string, unknown[]]> = [
        ["internal_ops_printer_assign", [fx.shopAId, PROMO, 14]],
        ["internal_ops_printer_mark_ready", [assignment.assignment_id, fx.shopAId]],
        ["internal_ops_printer_handover", [assignment.assignment_id, fx.shopAId, "X", "branch_collection"]],
        ["internal_ops_printer_assignment_cancel", [assignment.assignment_id, "reason"]],
        ["internal_ops_printer_inventory", [null, 50]],
      ];

      // DENIED for everything: finance_admin, support_admin, field_agent, and the
      // shop-side roles.
      for (const [fn, args] of [...stockOnly, ...fulfilmentOnly]) {
        for (const actor of [financeAdminId, supportAdminId, fieldAgentId, fx.ownerAId, fx.cashierAId, fx.outsiderId]) {
          await expect(callRaw(actor, fn, args), `${fn} for a denied role`).rejects.toThrow(/forbidden/i);
        }
      }

      // DENIED for stock, ALLOWED for fulfilment: subscriptions_admin.
      for (const [fn, args] of stockOnly) {
        await expect(callRaw(subscriptionsAdminId, fn, args), `${fn} for subscriptions_admin`)
          .rejects.toThrow(/forbidden/i);
      }
      expect((await rpc(subscriptionsAdminId, "internal_ops_printer_inventory", [null, 50])).ok).toBe(true);

      // ALLOWED for stock: operations_admin (and super_admin, exercised above).
      const forOps = await rpc(opAdminId, "internal_ops_printer_unit_create", [
        "WP58-2609-022", "2609", fx.shopAId, null, "WP-58", 58, "new",
      ]);
      expect(forOps.ok).toBe(true);
    });

    it("writes an audit row for a registration", async () => {
      await register(stockAdminId, "WP58-2609-012");
      const actions = await scalar<string[]>(
        `SELECT array_agg(action) AS v FROM public.internal_ops_admin_audit`,
      );
      expect(actions).toContain("printer_unit_registered");
    });
  });

  // ==========================================================================
  // Eligibility — from the subscription ROW
  // ==========================================================================

  describe("eligibility", () => {
    beforeEach(async () => {
      for (const s of ["WP58-2609-101", "WP58-2609-102", "WP58-2609-103"]) {
        await register(stockAdminId, s);
      }
    });

    it("accepts active + annual + business + future period end", async () => {
      const res = await assign(subscriptionsAdminId);
      expect(res.ok).toBe(true);
      expect(res.status).toBe("reserved");
    });

    it("refuses a default monthly Business TRIAL", async () => {
      // Exactly how every new shop is bootstrapped.
      await shapeSubscription({ status: "'trialing'", billing_interval: "'month'" });
      expect((await assign(subscriptionsAdminId)).error).toBe("not_eligible");
    });

    it("refuses BUSINESS billed monthly", async () => {
      await shapeSubscription({ billing_interval: "'month'" });
      expect((await assign(subscriptionsAdminId)).error).toBe("not_eligible");
    });

    it("refuses an expired subscription", async () => {
      await shapeSubscription({ current_period_end: "now() - interval '1 day'" });
      expect((await assign(subscriptionsAdminId)).error).toBe("not_eligible");
    });

    it("refuses a past_due subscription", async () => {
      await shapeSubscription({ status: "'past_due'" });
      expect((await assign(subscriptionsAdminId)).error).toBe("not_eligible");
    });

    it("refuses Starter and Waka Plus, annual or not", async () => {
      await shapeSubscription({ plan_code: "starter" });
      expect((await assign(subscriptionsAdminId)).error).toBe("not_eligible");

      await shapeSubscription({ plan_code: "waka_plus" });
      expect((await assign(subscriptionsAdminId)).error).toBe("not_eligible");
    });

    it("refuses a PROMOTIONAL GRANT with no qualifying purchase", async () => {
      // Starter billed monthly, granted Business until next year. The grant is an
      // overlay; it never changes the subscription row, and eligibility reads the
      // row — so this must NOT qualify.
      await shapeSubscription({ plan_code: "starter", billing_interval: "'month'" });
      await exec.exec(`
        INSERT INTO public.promotional_grants
          (organization_id, shop_id, plan_code, granted_by, reason, expires_at)
        VALUES ('${fx.orgAId}', '${fx.shopAId}', 'business', 'manual_admin', 'grant-only case', now() + interval '1 year');
      `);

      const res = await assign(subscriptionsAdminId);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("not_eligible");
    });

    it("refuses when the shop has no subscription at all", async () => {
      // A throwaway org, so the shared fixture is not disturbed for later tests.
      const orgId = crypto.randomUUID();
      const shopId = crypto.randomUUID();
      await exec.exec(`
        INSERT INTO public.organizations (id, name) VALUES ('${orgId}', 'No Subscription Ltd');
        INSERT INTO public.shops (id, organization_id, name, shop_number)
        VALUES ('${shopId}', '${orgId}', 'Bare Shop', 'PAY-NS');
      `);

      const res = await assign(subscriptionsAdminId, shopId);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("subscription_not_found");

      await exec.exec(`DELETE FROM public.shops WHERE id = '${shopId}';
                       DELETE FROM public.organizations WHERE id = '${orgId}';`);
    });
  });

  // ==========================================================================
  // Allocation
  // ==========================================================================

  describe("allocation", () => {
    it("hands out the lowest serial first", async () => {
      await register(stockAdminId, "WP58-2609-202");
      await register(stockAdminId, "WP58-2609-201");
      const res = await assign(subscriptionsAdminId);
      expect(res.ok).toBe(true);
      expect(await scalar<string>(
        `SELECT serial_number FROM public.waka_printer_units WHERE id = $1`, [res.unit_id as string],
      )).toBe("WP58-2609-201");
    });

    it("refuses a second open claim for the same organization and promotion", async () => {
      await register(stockAdminId, "WP58-2609-203");
      await register(stockAdminId, "WP58-2609-204");
      expect((await assign(subscriptionsAdminId)).ok).toBe(true);

      const second = await assign(subscriptionsAdminId);
      expect(second.ok).toBe(false);
      expect(second.error).toBe("already_assigned");
    });

    it("allows a different promotion alongside an open claim", async () => {
      await register(stockAdminId, "WP58-2609-205");
      await register(stockAdminId, "WP58-2609-206");
      expect((await assign(subscriptionsAdminId)).ok).toBe(true);
      const other = await assign(subscriptionsAdminId, fx.shopAId, "business_annual_printer_v2");
      expect(other.ok).toBe(true);
    });

    it("will not put one unit on two open claims, whatever the writer does", async () => {
      // The RPC only ever picks from the pool, so the durable guarantee is the
      // partial unique index. Race past the pool logic deliberately and prove the
      // constraint holds on its own.
      await register(stockAdminId, "WP58-2609-207");
      const first = await assign(subscriptionsAdminId);
      expect(first.ok).toBe(true);

      await expect(
        exec.exec(`
          INSERT INTO public.waka_printer_assignments
            (unit_id, organization_id, subscription_id, promotion_code, status, reserved_until)
          VALUES ('${first.unit_id}', '${fx.orgBId}', '${fx.subscriptionBId}', 'other_promo',
                  'reserved', now() + interval '14 days')
        `),
      ).rejects.toThrow(/waka_printer_assignments_one_open_per_unit|duplicate key/i);
    });

    it("refuses when the pool is empty, and does not create a phantom unit", async () => {
      const res = await assign(subscriptionsAdminId);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("no_unit_available");
      expect(await scalar<number>(`SELECT count(*)::int FROM public.waka_printer_units`)).toBe(0);
    });

    it("gives the LAST printer to exactly one of two organizations", async () => {
      // This is the "two customers, one printer" case at the level a single
      // connection can prove it: the pool is consumed once and the second claim
      // is refused. The two-SESSION race needs TEST_DATABASE_URL and is not
      // claimed here.
      await register(stockAdminId, "WP58-2609-208");

      const first = await assign(subscriptionsAdminId, fx.shopAId);
      expect(first.ok).toBe(true);

      // Organization B is on a monthly trial, so make it properly eligible first.
      await exec.exec(`
        UPDATE public.subscriptions SET status = 'active', billing_interval = 'year',
               current_period_end = now() + interval '300 days'
         WHERE id = '${fx.subscriptionBId}'
      `);
      const second = await assign(subscriptionsAdminId, fx.shopBId);
      expect(second.ok).toBe(false);
      expect(second.error).toBe("no_unit_available");

      expect(await scalar<number>(
        `SELECT count(*)::int FROM public.waka_printer_assignments WHERE status = 'reserved'`,
      )).toBe(1);
    });

    it("requires a fulfilment role, not merely an internal one", async () => {
      await register(stockAdminId, "WP58-2609-209");
      for (const actor of [supportAdminId, fx.ownerAId, fx.cashierAId, fx.outsiderId]) {
        await expect(callRaw(actor, "internal_ops_printer_assign", [fx.shopAId, PROMO, 14]))
          .rejects.toThrow(/forbidden/i);
      }
      // ...while the billing roles may.
      expect((await assign(opAdminId)).ok).toBe(true);
    });
  });

  // ==========================================================================
  // Reservation expiry
  // ==========================================================================

  describe("14-day reservation expiry", () => {
    it("sets a 14-day lease on the reservation", async () => {
      await register(stockAdminId, "WP58-2609-301");
      const res = await assign(subscriptionsAdminId);
      const days = await scalar<number>(
        `SELECT round(extract(epoch FROM (reserved_until - reserved_at)) / 86400)::int AS v
           FROM public.waka_printer_assignments WHERE id = $1`,
        [res.assignment_id as string],
      );
      expect(days).toBe(14);
    });

    it("does NOT reclaim a reservation that is still inside its lease", async () => {
      await register(stockAdminId, "WP58-2609-302");
      const res = await assign(subscriptionsAdminId);

      // Well inside the window: a sweep here must leave it alone.
      await exec.exec(`
        UPDATE public.waka_printer_assignments
           SET reserved_until = now() + interval '13 days'
         WHERE id = '${res.assignment_id}'
      `);
      await rpc(fx.ownerAId, "my_org_printer_assignments", []);

      expect(await scalar<string>(
        `SELECT status FROM public.waka_printer_assignments WHERE id = $1`, [res.assignment_id as string],
      )).toBe("reserved");
      expect(await unitStatus("WP58-2609-302")).toBe("reserved");
    });

    it("reclaims an expired reservation, frees the unit, and keeps the history", async () => {
      await register(stockAdminId, "WP58-2609-303");
      const res = await assign(subscriptionsAdminId);
      await exec.exec(`
        UPDATE public.waka_printer_assignments
           SET reserved_until = now() - interval '1 minute'
         WHERE id = '${res.assignment_id}'
      `);

      // Reclamation happens during the read path, with no scheduler involved.
      await rpc(fx.ownerAId, "my_org_printer_assignments", []);

      const row = await exec.query<{ status: string; reason: string }>(
        `SELECT status, reason FROM public.waka_printer_assignments WHERE id = $1`,
        [res.assignment_id as string],
      );
      expect(row.rows[0]!.status).toBe("failed_collection");
      expect(row.rows[0]!.reason).toBe("reservation_expired");
      expect(await unitStatus("WP58-2609-303")).toBe("available");

      // The attempt itself is still on the record.
      expect(await scalar<number>(
        `SELECT count(*)::int FROM public.waka_printer_assignments WHERE id = $1`, [res.assignment_id as string],
      )).toBe(1);
    });

    it("lets the organization claim again after expiry, as a NEW record", async () => {
      await register(stockAdminId, "WP58-2609-304");
      const first = await assign(subscriptionsAdminId);
      await exec.exec(`
        UPDATE public.waka_printer_assignments
           SET reserved_until = now() - interval '1 minute'
         WHERE id = '${first.assignment_id}'
      `);

      const second = await assign(subscriptionsAdminId);
      expect(second.ok).toBe(true);
      expect(second.assignment_id).not.toBe(first.assignment_id);

      // Two rows: the lapsed attempt and the live one.
      expect(await scalar<number>(
        `SELECT count(*)::int FROM public.waka_printer_assignments WHERE organization_id = $1`,
        [fx.orgAId],
      )).toBe(2);
    });

    it("NEVER expires a handed-over printer", async () => {
      await register(stockAdminId, "WP58-2609-305");
      const res = await assign(subscriptionsAdminId);
      await rpc(subscriptionsAdminId, "internal_ops_printer_mark_ready", [res.assignment_id, fx.shopAId]);
      expect((await handoverFull(subscriptionsAdminId, res.assignment_id as string)).ok).toBe(true);

      // Backdate the lease hard and reclaim.
      await exec.exec(`
        UPDATE public.waka_printer_assignments
           SET reserved_until = now() - interval '100 days'
         WHERE id = '${res.assignment_id}'
      `);
      await rpc(fx.ownerAId, "my_org_printer_assignments", []);

      expect(await scalar<string>(
        `SELECT status FROM public.waka_printer_assignments WHERE id = $1`, [res.assignment_id as string],
      )).toBe("handed_over");
      expect(await unitStatus("WP58-2609-305")).toBe("assigned");
    });

    it("reclaims a READY-FOR-COLLECTION reservation that was never picked up", async () => {
      await register(stockAdminId, "WP58-2609-306");
      const res = await assign(subscriptionsAdminId);
      await rpc(subscriptionsAdminId, "internal_ops_printer_mark_ready", [res.assignment_id, fx.shopAId]);
      await exec.exec(`
        UPDATE public.waka_printer_assignments
           SET reserved_until = now() - interval '1 second'
         WHERE id = '${res.assignment_id}'
      `);

      await rpc(fx.ownerAId, "my_org_printer_assignments", []);
      expect(await scalar<string>(
        `SELECT status FROM public.waka_printer_assignments WHERE id = $1`, [res.assignment_id as string],
      )).toBe("failed_collection");
      expect(await unitStatus("WP58-2609-306")).toBe("available");
    });

    it("reclaims on the ADMIN list too, so the console never shows a stale hold", async () => {
      await register(stockAdminId, "WP58-2609-308");
      const res = await assign(subscriptionsAdminId);
      await exec.exec(`
        UPDATE public.waka_printer_assignments SET reserved_until = now() - interval '1 minute'
         WHERE id = '${res.assignment_id}'
      `);

      // No customer call at all — the internal inventory read is the only thing
      // that runs before the assertions.
      const inventory = await rpc(subscriptionsAdminId, "internal_ops_printer_inventory", [null, 50]);
      expect(inventory.ok).toBe(true);

      expect(await scalar<string>(
        `SELECT status FROM public.waka_printer_assignments WHERE id = $1`, [res.assignment_id as string],
      )).toBe("failed_collection");
      expect(await unitStatus("WP58-2609-308")).toBe("available");
      // ...and the pool it reports agrees.
      expect((inventory.counts as Record<string, number>).available).toBe(1);
      expect(inventory.open_assignments).toEqual([]);
    });

    it("records the expiry in the platform audit", async () => {
      await register(stockAdminId, "WP58-2609-307");
      const res = await assign(subscriptionsAdminId);
      await exec.exec(`
        UPDATE public.waka_printer_assignments
           SET reserved_until = now() - interval '1 minute'
         WHERE id = '${res.assignment_id}'
      `);
      await rpc(fx.ownerAId, "my_org_printer_assignments", []);
      const actions = await scalar<string[]>(`SELECT array_agg(action) AS v FROM public.internal_ops_admin_audit`);
      expect(actions).toContain("printer_reservation_expired");
    });
  });

  // ==========================================================================
  // Cancellation and reassignment
  // ==========================================================================

  describe("cancellation", () => {
    it("cancels an unfulfilled claim, frees the unit, and keeps the row", async () => {
      await register(stockAdminId, "WP58-2609-401");
      const res = await assign(subscriptionsAdminId);

      const cancelled = await rpc(subscriptionsAdminId, "internal_ops_printer_assignment_cancel", [
        res.assignment_id, "customer changed their mind",
      ]);
      expect(cancelled.ok).toBe(true);
      expect(cancelled.unit_released).toBe(true);
      expect(await unitStatus("WP58-2609-401")).toBe("available");
      expect(await scalar<number>(
        `SELECT count(*)::int FROM public.waka_printer_assignments WHERE id = $1`, [res.assignment_id as string],
      )).toBe(1);
    });

    it("requires a reason", async () => {
      await register(stockAdminId, "WP58-2609-402");
      const res = await assign(subscriptionsAdminId);
      const bad = await rpc(subscriptionsAdminId, "internal_ops_printer_assignment_cancel", [res.assignment_id, "no"]);
      expect(bad.ok).toBe(false);
      expect(bad.error).toBe("reason_required");
    });

    it("frees the unit and allows a fresh claim afterwards", async () => {
      await register(stockAdminId, "WP58-2609-403");
      const first = await assign(subscriptionsAdminId);
      await rpc(subscriptionsAdminId, "internal_ops_printer_assignment_cancel", [first.assignment_id, "not collected"]);

      const second = await assign(subscriptionsAdminId);
      expect(second.ok).toBe(true);
      expect(second.unit_id).toBe(first.unit_id);
      expect(second.assignment_id).not.toBe(first.assignment_id);
    });

    it("cannot cancel a printer that was handed over", async () => {
      await register(stockAdminId, "WP58-2609-404");
      const res = await assign(subscriptionsAdminId);
      await rpc(subscriptionsAdminId, "internal_ops_printer_mark_ready", [res.assignment_id, fx.shopAId]);
      await handoverFull(subscriptionsAdminId, res.assignment_id as string);

      const cancelled = await rpc(subscriptionsAdminId, "internal_ops_printer_assignment_cancel", [
        res.assignment_id, "trying to undo a handover",
      ]);
      expect(cancelled.ok).toBe(false);
      expect(cancelled.error).toBe("already_handed_over");
      expect(await unitStatus("WP58-2609-404")).toBe("assigned");
    });
  });

  // ==========================================================================
  // Handover
  // ==========================================================================

  describe("handover", () => {
    it("records recipient, actor, time, method, branch and reference", async () => {
      await register(stockAdminId, "WP58-2609-501");
      const res = await assign(subscriptionsAdminId);
      await rpc(subscriptionsAdminId, "internal_ops_printer_mark_ready", [res.assignment_id, fx.shopAId]);

      const done = await handoverFull(subscriptionsAdminId, res.assignment_id as string);
      expect(done.ok).toBe(true);
      expect(done.status).toBe("handed_over");

      const row = await exec.query<Record<string, unknown>>(
        `SELECT status, fulfilment_method, received_by_name, received_by_phone,
                evidence_reference, shop_id, handed_over_by, handed_over_at
           FROM public.waka_printer_assignments WHERE id = $1`,
        [res.assignment_id as string],
      );
      expect(row.rows[0]!.status).toBe("handed_over");
      expect(row.rows[0]!.fulfilment_method).toBe("branch_collection");
      expect(row.rows[0]!.received_by_name).toBe("Amina Nakato");
      expect(row.rows[0]!.received_by_phone).toBe("+256700000001");
      expect(row.rows[0]!.evidence_reference).toBe("handover-photo-1.jpg");
      expect(row.rows[0]!.shop_id).toBe(fx.shopAId);
      expect(row.rows[0]!.handed_over_by).toBeTruthy();
      expect(row.rows[0]!.handed_over_at).toBeTruthy();
      expect(await unitStatus("WP58-2609-501")).toBe("assigned");
    });

    it("requires the actual collection branch", async () => {
      await register(stockAdminId, "WP58-2609-502");
      const res = await assign(subscriptionsAdminId);
      const noBranch = await rpc(subscriptionsAdminId, "internal_ops_printer_handover", [
        res.assignment_id, null, "Amina Nakato", "branch_collection",
      ]);
      expect(noBranch.ok).toBe(false);
      expect(noBranch.error).toBe("collection_branch_required");
    });

    it("refuses a collection branch belonging to another organization", async () => {
      await register(stockAdminId, "WP58-2609-503");
      const res = await assign(subscriptionsAdminId, fx.shopAId);

      const wrongBranch = await handoverFull(subscriptionsAdminId, res.assignment_id as string, fx.shopBId);
      expect(wrongBranch.ok).toBe(false);
      expect(wrongBranch.error).toBe("collection_branch_not_organization");
      expect(await unitStatus("WP58-2609-503")).toBe("reserved");
    });

    it("requires a recipient and a known method", async () => {
      await register(stockAdminId, "WP58-2609-504");
      const res = await assign(subscriptionsAdminId);

      const noName = await rpc(subscriptionsAdminId, "internal_ops_printer_handover", [
        res.assignment_id, fx.shopAId, "   ", "branch_collection",
      ]);
      expect(noName.error).toBe("recipient_required");

      const badMethod = await rpc(subscriptionsAdminId, "internal_ops_printer_handover", [
        res.assignment_id, fx.shopAId, "Amina Nakato", "teleport",
      ]);
      expect(badMethod.error).toBe("invalid_fulfilment_method");
    });

    it("supports the WhatsApp request method", async () => {
      await register(stockAdminId, "WP58-2609-505");
      const res = await assign(subscriptionsAdminId);
      const done = await rpc(subscriptionsAdminId, "internal_ops_printer_handover", [
        res.assignment_id, fx.shopAId, "Amina Nakato", "whatsapp_request",
      ]);
      expect(done.ok).toBe(true);
      expect(await scalar<string>(
        `SELECT fulfilment_method FROM public.waka_printer_assignments WHERE id = $1`,
        [res.assignment_id as string],
      )).toBe("whatsapp_request");
    });

    it("cannot hand the same printer over twice", async () => {
      await register(stockAdminId, "WP58-2609-506");
      const res = await assign(subscriptionsAdminId);
      expect((await handoverFull(subscriptionsAdminId, res.assignment_id as string)).ok).toBe(true);

      const again = await handoverFull(subscriptionsAdminId, res.assignment_id as string);
      expect(again.ok).toBe(false);
      expect(again.error).toBe("already_handed_over");
    });

    it("cannot be reversed by a direct write", async () => {
      await register(stockAdminId, "WP58-2609-507");
      const res = await assign(subscriptionsAdminId);
      await handoverFull(subscriptionsAdminId, res.assignment_id as string);

      // A completed handover is a historical fact. The guard refuses even a
      // writer that bypasses every RPC.
      await expect(
        exec.exec(`UPDATE public.waka_printer_assignments SET status = 'cancelled' WHERE id = '${res.assignment_id}'`),
      ).rejects.toThrow(/printer_assignment_invalid_transition/);
    });

    it("records the handover in the platform audit", async () => {
      await register(stockAdminId, "WP58-2609-508");
      const res = await assign(subscriptionsAdminId);
      await handoverFull(subscriptionsAdminId, res.assignment_id as string);
      const actions = await scalar<string[]>(`SELECT array_agg(action) AS v FROM public.internal_ops_admin_audit`);
      expect(actions).toContain("printer_assigned");
      expect(actions).toContain("printer_handed_over");
    });
  });

  // ==========================================================================
  // Expiry vs handover ordering — they cannot both succeed
  // ==========================================================================

  describe("expiry and handover cannot both win", () => {
    it("handover wins first: the sweep then leaves the completed record alone", async () => {
      await register(stockAdminId, "WP58-2609-901");
      const res = await assign(subscriptionsAdminId);
      await handoverFull(subscriptionsAdminId, res.assignment_id as string);

      // The lease lapses AFTER the handover. A customer collecting late must not
      // lose the printer because a lazy sweep had not run yet.
      await exec.exec(`
        UPDATE public.waka_printer_assignments SET reserved_until = now() - interval '30 days'
         WHERE id = '${res.assignment_id}'
      `);
      await rpc(fx.ownerAId, "my_org_printer_assignments", []);

      expect(await scalar<string>(
        `SELECT status FROM public.waka_printer_assignments WHERE id = $1`, [res.assignment_id as string],
      )).toBe("handed_over");
      expect(await unitStatus("WP58-2609-901")).toBe("assigned");
    });

    it("sweep wins first: the handover is then refused, not applied to a dead claim", async () => {
      await register(stockAdminId, "WP58-2609-902");
      const res = await assign(subscriptionsAdminId);
      await exec.exec(`
        UPDATE public.waka_printer_assignments SET reserved_until = now() - interval '1 minute'
         WHERE id = '${res.assignment_id}'
      `);
      // The sweep runs during a read, before anyone reaches the counter.
      await rpc(fx.ownerAId, "my_org_printer_assignments", []);
      expect(await unitStatus("WP58-2609-902")).toBe("available");

      const late = await handoverFull(subscriptionsAdminId, res.assignment_id as string);
      expect(late.ok).toBe(false);
      expect(late.error).toBe("invalid_state");
      expect(await unitStatus("WP58-2609-902")).toBe("available");
    });

    it("keeps unit and assignment status consistent at every terminal state", async () => {
      // Each case asserts on the unit the claim ACTUALLY took, rather than a
      // guessed serial — allocation is lowest-serial-first, so a released unit
      // is legitimately handed out again to the next claim.
      const statusOfUnit = (unitId: unknown) =>
        scalar<string>(`SELECT status FROM public.waka_printer_units WHERE id = $1`, [unitId as string]);

      // cancelled
      await register(stockAdminId, "WP58-2609-903");
      const a = await assign(subscriptionsAdminId);
      await rpc(subscriptionsAdminId, "internal_ops_printer_assignment_cancel", [a.assignment_id, "withdrawn"]);
      expect(await statusOfUnit(a.unit_id)).toBe("available");

      // expired
      await register(stockAdminId, "WP58-2609-904");
      const b = await assign(subscriptionsAdminId);
      await exec.exec(`
        UPDATE public.waka_printer_assignments SET reserved_until = now() - interval '1 minute'
         WHERE id = '${b.assignment_id}'
      `);
      await rpc(fx.ownerAId, "my_org_printer_assignments", []);
      expect(await statusOfUnit(b.unit_id)).toBe("available");

      // handed over
      await register(stockAdminId, "WP58-2609-905");
      const c = await assign(subscriptionsAdminId);
      await handoverFull(subscriptionsAdminId, c.assignment_id as string);
      expect(await statusOfUnit(c.unit_id)).toBe("assigned");

      // No unit is left in a state no assignment can explain.
      const orphans = await scalar<number>(`
        SELECT count(*)::int AS v
          FROM public.waka_printer_units u
         WHERE (u.status = 'reserved'
                and not exists (select 1 from public.waka_printer_assignments a
                                 where a.unit_id = u.id and a.status in ('reserved','ready_for_collection')))
            or (u.status = 'assigned'
                and not exists (select 1 from public.waka_printer_assignments a
                                 where a.unit_id = u.id and a.status = 'handed_over'))
      `);
      expect(orphans).toBe(0);
    });
  });

  // ==========================================================================
  // Retirement and correction
  // ==========================================================================

  describe("retirement and correction", () => {
    it("retires an available unit and takes it out of the pool", async () => {
      await register(stockAdminId, "WP58-2609-601");
      const res = await rpc(stockAdminId, "internal_ops_printer_unit_retire", [
        await scalar<string>(`SELECT id FROM public.waka_printer_units WHERE serial_number = 'WP58-2609-601'`),
        "screen cracked in transit",
      ]);
      expect(res.ok).toBe(true);
      expect(await unitStatus("WP58-2609-601")).toBe("retired");

      await exec.exec(`UPDATE public.subscriptions SET status = 'active', billing_interval = 'year'
                        WHERE id = '${fx.subscriptionAId}'`);
      const assignRes = await assign(subscriptionsAdminId);
      expect(assignRes.error).toBe("no_unit_available");
    });

    it("refuses to retire a unit that is reserved or already handed over", async () => {
      await register(stockAdminId, "WP58-2609-602");
      const res = await assign(subscriptionsAdminId);
      const unitId = await scalar<string>(`SELECT id FROM public.waka_printer_units WHERE serial_number = 'WP58-2609-602'`);

      const reserved = await rpc(stockAdminId, "internal_ops_printer_unit_retire", [unitId, "trying anyway"]);
      expect(reserved.ok).toBe(false);
      expect(reserved.error).toBe("unit_committed");

      await handoverFull(subscriptionsAdminId, res.assignment_id as string);
      const assigned = await rpc(stockAdminId, "internal_ops_printer_unit_retire", [unitId, "trying again"]);
      expect(assigned.ok).toBe(false);
      expect(assigned.error).toBe("unit_committed");
    });

    it("retires idempotently", async () => {
      await register(stockAdminId, "WP58-2609-603");
      const unitId = await scalar<string>(`SELECT id FROM public.waka_printer_units WHERE serial_number = 'WP58-2609-603'`);
      await rpc(stockAdminId, "internal_ops_printer_unit_retire", [unitId, "damaged"]);
      const again = await rpc(stockAdminId, "internal_ops_printer_unit_retire", [unitId, "damaged"]);
      expect(again.ok).toBe(true);
      expect(again.idempotent).toBe(true);
    });

    it("requires a reason to retire", async () => {
      await register(stockAdminId, "WP58-2609-604");
      const unitId = await scalar<string>(`SELECT id FROM public.waka_printer_units WHERE serial_number = 'WP58-2609-604'`);
      const res = await rpc(stockAdminId, "internal_ops_printer_unit_retire", [unitId, "x"]);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("reason_required");
    });

    it("corrects metadata but can never rewrite the serial", async () => {
      await register(stockAdminId, "WP58-2609-605");
      const unitId = await scalar<string>(`SELECT id FROM public.waka_printer_units WHERE serial_number = 'WP58-2609-605'`);

      // The batch code is corrected to the value that AGREES with the label; a
      // contradictory one is refused (see the batch-agreement tests above).
      const res = await rpc(stockAdminId, "internal_ops_printer_unit_update", [
        unitId, "label re-read, batch confirmed", "refurbished", "2609", fx.shopAId, "opened box",
      ]);
      expect(res.ok).toBe(true);
      const row = await exec.query<Record<string, unknown>>(
        `SELECT serial_number, condition, batch_code, notes FROM public.waka_printer_units WHERE id = $1`, [unitId],
      );
      expect(row.rows[0]!.serial_number).toBe("WP58-2609-605");
      expect(row.rows[0]!.condition).toBe("refurbished");
      expect(row.rows[0]!.batch_code).toBe("2609");
      expect(row.rows[0]!.notes).toBe("opened box");

      // There is no parameter for it, so the RPC cannot change it at all.
      await expect(callRaw(stockAdminId, "internal_ops_printer_unit_update", [
        unitId, "reason", null, null, null, null, "WP58-9999-999",
      ])).rejects.toThrow();
    });

    it("refuses to correct a unit that is out with a customer", async () => {
      await register(stockAdminId, "WP58-2609-606");
      const res = await assign(subscriptionsAdminId);
      await handoverFull(subscriptionsAdminId, res.assignment_id as string);
      const unitId = await scalar<string>(`SELECT id FROM public.waka_printer_units WHERE serial_number = 'WP58-2609-606'`);

      const update = await rpc(stockAdminId, "internal_ops_printer_unit_update", [
        unitId, "trying to edit an issued unit", "damaged", null, null, null,
      ]);
      expect(update.ok).toBe(false);
      expect(update.error).toBe("unit_assigned");
    });
  });

  // ==========================================================================
  // Customer reads and access control
  // ==========================================================================

  describe("customer reads", () => {
    it("shows an organization its own claim, with the serial and the branch", async () => {
      await register(stockAdminId, "WP58-2609-701");
      const res = await assign(subscriptionsAdminId);
      await handoverFull(subscriptionsAdminId, res.assignment_id as string);

      const mine = await rpc(fx.ownerAId, "my_org_printer_assignments", []);
      expect(mine.ok).toBe(true);
      const list = mine.assignments as Array<Record<string, unknown>>;
      expect(list).toHaveLength(1);
      expect(list[0]!.serial_number).toBe("WP58-2609-701");
      expect(list[0]!.status).toBe("handed_over");
      expect(list[0]!.collection_shop_name).toBeTruthy();
    });

    it("shows a different organization nothing of it", async () => {
      await register(stockAdminId, "WP58-2609-702");
      await assign(subscriptionsAdminId, fx.shopAId);

      const other = await rpc(fx.ownerId, "my_org_printer_assignments", []);
      expect(other.ok).toBe(true);
      expect(other.assignments).toEqual([]);
    });

    it("shows an organization member with no ownership role the same records", async () => {
      await register(stockAdminId, "WP58-2609-703");
      await assign(subscriptionsAdminId, fx.shopAId);
      const cashier = await rpc(fx.cashierAId, "my_org_printer_assignments", []);
      expect((cashier.assignments as unknown[]).length).toBe(1);
    });

    it("gives a non-member nothing", async () => {
      await register(stockAdminId, "WP58-2609-704");
      await assign(subscriptionsAdminId, fx.shopAId);
      const outsider = await rpc(fx.outsiderId, "my_org_printer_assignments", []);
      expect(outsider.assignments).toEqual([]);
    });

    it("denies direct table access to every client role", async () => {
      for (const actor of [fx.ownerAId, fx.cashierAId, fx.internalAdminId]) {
        await expect(
          asUser(exec, actor, () => exec.query(`SELECT * FROM public.waka_printer_units`)),
        ).rejects.toThrow(/permission denied|denied/i);
        await expect(
          asUser(exec, actor, () => exec.query(`SELECT * FROM public.waka_printer_assignments`)),
        ).rejects.toThrow(/permission denied|denied/i);
      }
    });

    it("keeps the inventory RPC to fulfilment roles only", async () => {
      for (const actor of [supportAdminId, fx.ownerAId, fx.outsiderId]) {
        await expect(callRaw(actor, "internal_ops_printer_inventory", [null, 50]))
          .rejects.toThrow(/forbidden/i);
      }
      const list = await rpc(subscriptionsAdminId, "internal_ops_printer_inventory", [null, 50]);
      expect(list.ok).toBe(true);
      expect(list.counts).toBeTruthy();
    });
  });

  // ==========================================================================
  // History retention when an organization is deleted
  // ==========================================================================

  describe("organization deletion", () => {
    /**
     * A disposable account, never the shared fixture.
     *
     * Closing orgA for real would cascade through `shops` to `shop_members` —
     * and this harness resolves internal roles from `shop_members`, so every
     * later test would start failing with `forbidden`. A throwaway account also
     * proves the thing we actually care about: the printer record does not
     * depend on which account it was.
     */
    async function throwawayAccount(name: string) {
      const orgId = crypto.randomUUID();
      const shopId = crypto.randomUUID();
      await exec.exec(`
        INSERT INTO public.organizations (id, name) VALUES ('${orgId}', '${name}');
        INSERT INTO public.shops (id, organization_id, name, shop_number)
        VALUES ('${shopId}', '${orgId}', '${name} Branch', 'PAY-TW');
        -- The acting admin keeps a role row on the throwaway branch, so the
        -- calls made BEFORE closure are authorized normally.
        INSERT INTO public.shop_members (shop_id, user_id, role)
        VALUES ('${shopId}', '${subscriptionsAdminId}', 'subscriptions_admin');
        INSERT INTO public.subscriptions
          (organization_id, shop_id, plan_id, status, billing_interval, current_period_start, current_period_end)
        VALUES ('${orgId}', '${shopId}',
                (SELECT id FROM public.subscription_plans WHERE code = 'business'),
                'active', 'year', now() - interval '10 days', now() + interval '355 days');
      `);
      return { orgId, shopId };
    }

    async function closeAccount(orgId: string) {
      await exec.exec(`DELETE FROM public.subscriptions WHERE organization_id = '${orgId}'`);
      await exec.exec(`DELETE FROM public.organizations WHERE id = '${orgId}'`);
    }

    it("keeps a completed handover, detached and still readable", async () => {
      const { orgId, shopId } = await throwawayAccount("Kampala Hardware Ltd");
      await register(stockAdminId, "WP58-2609-950");
      const res = await assign(subscriptionsAdminId, shopId);
      expect(res.ok).toBe(true);
      await handoverFull(subscriptionsAdminId, res.assignment_id as string, shopId);

      // Close the account. This must not be blocked, and must not erase the
      // record that a printer was issued.
      await closeAccount(orgId);

      const row = await exec.query<Record<string, unknown>>(
        `SELECT status, organization_id, organization_name_snapshot, shop_name_snapshot,
                received_by_name, received_by_phone, handed_over_at, fulfilment_method, unit_id
           FROM public.waka_printer_assignments WHERE id = $1`,
        [res.assignment_id as string],
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]!.status).toBe("handed_over");
      expect(row.rows[0]!.organization_id).toBeNull();
      expect(row.rows[0]!.organization_name_snapshot).toBe("Kampala Hardware Ltd");
      expect(row.rows[0]!.shop_name_snapshot).toBe("Kampala Hardware Ltd Branch");
      expect(row.rows[0]!.received_by_name).toBe("Amina Nakato");
      expect(row.rows[0]!.received_by_phone).toBe("+256700000001");
      expect(row.rows[0]!.handed_over_at).toBeTruthy();
      expect(row.rows[0]!.fulfilment_method).toBe("branch_collection");

      // The printer is still out with the customer and is NOT back in the pool.
      const unit = await exec.query<Record<string, unknown>>(
        `SELECT serial_number, status FROM public.waka_printer_units WHERE id = $1`,
        [row.rows[0]!.unit_id as string],
      );
      expect(unit.rows[0]!.serial_number).toBe("WP58-2609-950");
      expect(unit.rows[0]!.status).toBe("assigned");
    });

    it("drops an unfulfilled reservation with the account and frees the unit", async () => {
      const { orgId, shopId } = await throwawayAccount("Never Collected Ltd");
      await register(stockAdminId, "WP58-2609-951");
      const res = await assign(subscriptionsAdminId, shopId);
      expect(res.ok).toBe(true);

      await closeAccount(orgId);

      // The attempt is not a record of anything that reached a customer, so it
      // goes — and the printer returns to the pool rather than being stranded
      // against a claim that no longer exists.
      expect(await scalar<number>(
        `SELECT count(*)::int FROM public.waka_printer_assignments WHERE id = $1`,
        [res.assignment_id as string],
      )).toBe(0);
      expect(await unitStatus("WP58-2609-951")).toBe("available");
    });
  });

  // ==========================================================================
  // Isolation from merchant stock and reporting
  // ==========================================================================

  describe("isolation from merchant inventory", () => {
    it("has no foreign key path to products or inventory movements", async () => {
      const { rows } = await exec.query<{ n: number }>(`
        SELECT count(*)::int AS n
          FROM pg_constraint c
          JOIN pg_class src ON src.oid = c.conrelid
          JOIN pg_class dst ON dst.oid = c.confrelid
         WHERE c.contype = 'f'
           AND ((src.relname LIKE 'waka_printer%' AND dst.relname IN ('products', 'inventory_movements', 'shop_stock_movements'))
             OR (dst.relname LIKE 'waka_printer%' AND src.relname IN ('products', 'inventory_movements', 'shop_stock_movements')))
      `);
      expect(rows[0]!.n).toBe(0);
    });

    // NOTE: the shop-reset classification itself is not asserted here — the
    // classification function calls `shop_reset_business_plan()`, which this
    // harness never creates. That guard lives in
    // `shopResetFkOrder.sql.integration.test.ts`, which applies
    // 20261013100100_printer_reset_classification.sql.

    it("leaves merchant stock untouched when printers are registered and issued", async () => {
      const before = await scalar<number>(`SELECT count(*)::int AS v FROM public.products`);
      await register(stockAdminId, "WP58-2609-801");
      const res = await assign(subscriptionsAdminId);
      await handoverFull(subscriptionsAdminId, res.assignment_id as string);
      const after = await scalar<number>(`SELECT count(*)::int AS v FROM public.products`);
      expect(after).toBe(before);
    });
  });

  // ==========================================================================
  // Read-only additions (20261013110000)
  // ==========================================================================

  describe("handover history (read-only)", () => {
    it("returns the recorded handover with its snapshots", async () => {
      await register(stockAdminId, "WP58-2609-960");
      const res = await assign(subscriptionsAdminId);
      await handoverFull(subscriptionsAdminId, res.assignment_id as string);

      const history = await rpc(subscriptionsAdminId, "internal_ops_printer_handover_history", [50, null]);
      expect(history.ok).toBe(true);
      const rows = history.handovers as Array<Record<string, unknown>>;
      expect(rows.length).toBe(1);
      expect(rows[0]!.serial_number).toBe("WP58-2609-960");
      expect(rows[0]!.received_by_name).toBe("Amina Nakato");
      expect(rows[0]!.received_by_phone).toBe("+256700000001");
      expect(rows[0]!.fulfilment_method).toBe("branch_collection");
      expect(rows[0]!.handed_over_at).toBeTruthy();
      expect(rows[0]!.organization_name).toBe("Payment Org A");
      expect(rows[0]!.branch_name).toBe("Payment Shop A");
      expect(rows[0]!.account_deleted).toBe(false);
      expect(Number(history.total)).toBe(1);
    });

    it("lists only COMPLETED handovers, never an open claim", async () => {
      await register(stockAdminId, "WP58-2609-961");
      await assign(subscriptionsAdminId);
      const history = await rpc(subscriptionsAdminId, "internal_ops_printer_handover_history", [50, null]);
      expect(history.handovers).toEqual([]);
    });

    it("keeps a handover readable after the account is deleted", async () => {
      const orgId = crypto.randomUUID();
      const shopId = crypto.randomUUID();
      await exec.exec(`
        INSERT INTO public.organizations (id, name) VALUES ('${orgId}', 'History Retention Ltd');
        INSERT INTO public.shops (id, organization_id, name, shop_number)
        VALUES ('${shopId}', '${orgId}', 'Retention Branch', 'PAY-HR');
        INSERT INTO public.shop_members (shop_id, user_id, role)
        VALUES ('${shopId}', '${subscriptionsAdminId}', 'subscriptions_admin');
        INSERT INTO public.subscriptions
          (organization_id, shop_id, plan_id, status, billing_interval, current_period_start, current_period_end)
        VALUES ('${orgId}', '${shopId}', (SELECT id FROM public.subscription_plans WHERE code = 'business'),
                'active', 'year', now() - interval '10 days', now() + interval '355 days');
      `);
      await register(stockAdminId, "WP58-2609-962");
      const res = await assign(subscriptionsAdminId, shopId);
      await handoverFull(subscriptionsAdminId, res.assignment_id as string, shopId);

      await exec.exec(`DELETE FROM public.subscriptions WHERE organization_id = '${orgId}'`);
      await exec.exec(`DELETE FROM public.organizations WHERE id = '${orgId}'`);

      const history = await rpc(subscriptionsAdminId, "internal_ops_printer_handover_history", [50, null]);
      const row = (history.handovers as Array<Record<string, unknown>>).find(
        (h) => h.serial_number === "WP58-2609-962",
      )!;
      expect(row).toBeTruthy();
      expect(row.account_deleted).toBe(true);
      expect(row.organization_id).toBeNull();
      expect(row.organization_name).toBe("History Retention Ltd");
      expect(row.branch_name).toBe("Retention Branch");
      expect(row.received_by_name).toBe("Amina Nakato");
    });

    it("is refused for every role without fulfilment authority", async () => {
      for (const actor of [financeAdminId, supportAdminId, fieldAgentId, fx.ownerAId, fx.cashierAId, fx.outsiderId]) {
        await expect(callRaw(actor, "internal_ops_printer_handover_history", [50, null]))
          .rejects.toThrow(/forbidden/i);
      }
    });
  });

  describe("eligibility preview (read-only)", () => {
    it("reports an eligible account without reserving anything", async () => {
      const res = await rpc(subscriptionsAdminId, "internal_ops_printer_eligibility", [fx.shopAId, PROMO]);
      expect(res.ok).toBe(true);
      expect(res.eligible).toBe(true);
      expect(res.can_reserve).toBe(true);
      expect(res.reason).toBeNull();
      expect(res.plan_code).toBe("business");
      expect(res.billing_interval).toBe("year");
      expect(await scalar<number>(`SELECT count(*)::int FROM public.waka_printer_assignments`)).toBe(0);
    });

    it("explains each refusal, and the verdict agrees with the reservation rule", async () => {
      await shapeSubscription({ billing_interval: "'month'" });
      const monthly = await rpc(subscriptionsAdminId, "internal_ops_printer_eligibility", [fx.shopAId, PROMO]);
      expect(monthly.eligible).toBe(false);
      expect(monthly.reason).toBe("not_annual");

      await shapeSubscription({ plan_code: "starter", billing_interval: "'year'" });
      const starter = await rpc(subscriptionsAdminId, "internal_ops_printer_eligibility", [fx.shopAId, PROMO]);
      expect(starter.eligible).toBe(false);
      expect(starter.reason).toBe("not_business");

      await shapeSubscription({ plan_code: "business", status: "'trialing'" });
      const trial = await rpc(subscriptionsAdminId, "internal_ops_printer_eligibility", [fx.shopAId, PROMO]);
      expect(trial.eligible).toBe(false);
      expect(trial.reason).toBe("subscription_not_active");

      await shapeSubscription({ status: "'active'", current_period_end: "now() - interval '1 day'" });
      const ended = await rpc(subscriptionsAdminId, "internal_ops_printer_eligibility", [fx.shopAId, PROMO]);
      expect(ended.eligible).toBe(false);
      expect(ended.reason).toBe("period_ended");

      // The preview must agree with what the reservation actually does.
      const blocked = await assign(subscriptionsAdminId);
      expect(blocked.error).toBe("not_eligible");
    });

    it("reports an eligible account that already holds its printer", async () => {
      await register(stockAdminId, "WP58-2609-963");
      const claimed = await assign(subscriptionsAdminId);
      expect(claimed.ok).toBe(true);

      const res = await rpc(subscriptionsAdminId, "internal_ops_printer_eligibility", [fx.shopAId, PROMO]);
      expect(res.eligible).toBe(true);
      expect(res.can_reserve).toBe(false);
      const claim = res.open_claim as Record<string, unknown>;
      expect(claim.serial_number).toBe("WP58-2609-963");
      expect(claim.status).toBe("reserved");
    });

    it("is refused for every role without fulfilment authority", async () => {
      for (const actor of [financeAdminId, supportAdminId, fieldAgentId, fx.ownerAId, fx.outsiderId]) {
        await expect(callRaw(actor, "internal_ops_printer_eligibility", [fx.shopAId, PROMO]))
          .rejects.toThrow(/forbidden/i);
      }
    });
  });

  describe("inventory carries display names", () => {
    it("names the account and branch on an open claim", async () => {
      await register(stockAdminId, "WP58-2609-964");
      await assign(subscriptionsAdminId);

      const inventory = await rpc(subscriptionsAdminId, "internal_ops_printer_inventory", [null, 50]);
      const claim = (inventory.open_assignments as Array<Record<string, unknown>>)[0]!;
      expect(claim.organization_name).toBe("Payment Org A");
      expect(claim.shop_name).toBe("Payment Shop A");
    });

    it("names the branch a unit is held at", async () => {
      await register(stockAdminId, "WP58-2609-965");
      const inventory = await rpc(subscriptionsAdminId, "internal_ops_printer_inventory", [null, 50]);
      const unit = (inventory.units as Array<Record<string, unknown>>).find(
        (u) => u.serial_number === "WP58-2609-965",
      )!;
      expect(unit.held_at_shop_name).toBe("Payment Shop A");
    });
  });
});

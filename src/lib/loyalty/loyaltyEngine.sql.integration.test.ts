import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  createLoyaltySqlHarness,
  enableProgram,
  insertCompletedSale,
  rpcJson,
  seedLoyaltyFixture,
  type LoyaltyFixture,
  type SqlExec,
} from "../../test/sqlIntegration/loyaltyPgHarness";

/**
 * Phase 02 — Loyalty data foundation integration tests (PGlite in-memory
 * Postgres, real migration file applied on a minimal bootstrap).
 *
 * Covers: award trigger on completed-sale transition, spend-rule math,
 * idempotency (retries / replays / re-update), partial-return reversals,
 * void reversals capped by outstanding, offline ordering gap (return syncs
 * before its sale), merchant isolation via RLS, server-only ledger writes,
 * enrollment RPC authorization, manual adjustment authorization, and the
 * internal admin shop-reset integration.
 */

let exec: SqlExec;
let f: LoyaltyFixture;

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
}, 120_000);

afterAll(async () => {
  await exec.close();
});

async function accountRow(customerId: string) {
  const { rows } = await exec.query(
    `SELECT * FROM public.loyalty_accounts WHERE customer_id = $1`,
    [customerId],
  );
  return rows[0] as Record<string, unknown> | undefined;
}

async function ledgerRows(saleId: string) {
  const { rows } = await exec.query(
    `SELECT * FROM public.loyalty_transactions WHERE source_sale_id = $1 ORDER BY created_at, id`,
    [saleId],
  );
  return rows as Record<string, unknown>[];
}

describe("spend rule award", () => {
  it("awards floor(total / unit) points when a sale completes with a customer", async () => {
    await enableProgram(exec, f.shopAId);
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 35_000, customerId: f.customerAId });

    const ledger = await ledgerRows(saleId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].kind).toBe("earned");
    expect(Number(ledger[0].points)).toBe(35);

    const account = await accountRow(f.customerAId);
    expect(account).toBeDefined();
    expect(Number(account!.balance_points)).toBe(35);
    expect(Number(account!.lifetime_earned_points)).toBe(35);
    expect(Number(ledger[0].balance_after)).toBe(35);
  });

  it("respects earn_points_per_unit multiplier", async () => {
    await exec.query(
      `UPDATE public.loyalty_programs SET earn_points_per_unit = 2 WHERE shop_id = $1`,
      [f.shopAId],
    );
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 10_000, customerId: f.customerAId });
    const ledger = await ledgerRows(saleId);
    expect(Number(ledger[0].points)).toBe(20);
    await exec.query(
      `UPDATE public.loyalty_programs SET earn_points_per_unit = 1 WHERE shop_id = $1`,
      [f.shopAId],
    );
  });

  it("respects min_eligible_spend_ugx", async () => {
    await exec.query(
      `UPDATE public.loyalty_programs SET min_eligible_spend_ugx = 5000 WHERE shop_id = $1`,
      [f.shopAId],
    );
    const small = await insertCompletedSale(exec, f, { totalUgx: 4_000, customerId: f.customerAId });
    expect(await ledgerRows(small)).toHaveLength(0);
    const big = await insertCompletedSale(exec, f, { totalUgx: 7_000, customerId: f.customerAId });
    const ledger = await ledgerRows(big);
    expect(Number(ledger[0].points)).toBe(2); // floor((7000 - 5000) / 1000)
    await exec.query(
      `UPDATE public.loyalty_programs SET min_eligible_spend_ugx = 0 WHERE shop_id = $1`,
      [f.shopAId],
    );
  });

  it("does not award without a customer or with a disabled program", async () => {
    const noCustomer = await insertCompletedSale(exec, f, { totalUgx: 20_000, customerId: null });
    expect(await ledgerRows(noCustomer)).toHaveLength(0);

    await exec.query(
      `INSERT INTO public.loyalty_programs (shop_id, enabled)
       VALUES ($1, false) ON CONFLICT (shop_id) DO UPDATE SET enabled = false`,
      [f.shopBId],
    );
    const saleBId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, total_ugx, completed_at)
       VALUES ($1, $2, $3, 'completed', 'paid', 9000, now())`,
      [saleBId, f.shopBId, f.customerBId],
    );
    expect(await ledgerRows(saleBId)).toHaveLength(0);
  });

  it("does not award for drafts", async () => {
    const draftId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.sales (id, shop_id, customer_id, status, total_ugx)
       VALUES ($1, $2, $3, 'draft', 99000)`,
      [draftId, f.shopAId, f.customerAId],
    );
    expect(await ledgerRows(draftId)).toHaveLength(0);
  });
});

describe("idempotency", () => {
  it("replay of the award RPC never double-awards", async () => {
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 12_000, customerId: f.customerAId });
    const first = rpcJson(
      (await exec.query(`SELECT public.loyalty_award_for_sale($1) AS result`, [saleId])).rows[0],
    );
    expect(first.awarded).toBe(false);
    expect(first.reason).toBe("already_awarded");
    expect(await ledgerRows(saleId)).toHaveLength(1);
  });

  it("re-updating a completed sale does not re-award", async () => {
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 8_000, customerId: f.customerAId });
    await exec.query(`UPDATE public.sales SET payment_status = 'paid' WHERE id = $1`, [saleId]);
    await exec.query(`UPDATE public.sales SET internal_note = 'touch' WHERE id = $1`).catch(() => {
      /* column may not exist in bootstrap — status-only update below is the real check */
    });
    await exec.query(
      `UPDATE public.sales SET status = 'completed' WHERE id = $1 AND status = 'completed'`,
      [saleId],
    );
    expect(await ledgerRows(saleId)).toHaveLength(1);
  });
});

describe("reversals", () => {
  it("partial return reverses proportional points and links reversal_of", async () => {
    const customerId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, 'Return Customer')`,
      [customerId, f.shopAId],
    );
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 35_000, customerId });
    const returnId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.sale_returns (id, shop_id, sale_id, product_id, quantity, refund_amount_ugx, reason)
       VALUES ($1, $2, $3, $4, 1, 10000, 'other')`,
      [returnId, f.shopAId, saleId, f.productAId],
    );

    const ledger = await ledgerRows(saleId);
    expect(ledger).toHaveLength(2);
    const reversal = ledger.find((r) => r.kind === "reversed");
    expect(reversal).toBeDefined();
    expect(Number(reversal!.points)).toBe(-10);
    expect(reversal!.reversal_of_id).toBe(ledger.find((r) => r.kind === "earned")!.id);
    expect(Number(reversal!.balance_after)).toBe(25);

    const account = await accountRow(customerId);
    expect(Number(account!.balance_points)).toBe(25);
    expect(Number(account!.lifetime_redeemed_points)).toBe(10);
  });

  it("return reversal is idempotent across retries", async () => {
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 9_000, customerId: f.customerAId });
    const returnId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.sale_returns (id, shop_id, sale_id, product_id, quantity, refund_amount_ugx, reason)
       VALUES ($1, $2, $3, $4, 1, 4000, 'other')`,
      [returnId, f.shopAId, saleId, f.productAId],
    );
    const again = rpcJson(
      (
        await exec.query(`SELECT public.loyalty_reverse_for_return($1) AS result`, [returnId])
      ).rows[0],
    );
    expect(again.reversed).toBe(false);
    expect(again.reason).toBe("already_reversed");
    expect(await ledgerRows(saleId)).toHaveLength(2);
  });

  it("void after partial return caps the void reversal at outstanding points", async () => {
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 35_000, customerId: f.customerAId });
    const returnId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.sale_returns (id, shop_id, sale_id, product_id, quantity, refund_amount_ugx, reason)
       VALUES ($1, $2, $3, $4, 1, 10000, 'other')`,
      [returnId, f.shopAId, saleId, f.productAId],
    );
    await exec.query(
      `INSERT INTO public.sale_voids (id, shop_id, sale_id, product_id, quantity, amount_ugx, line_index)
       VALUES ($1, $2, $3, $4, 1, 25000, 0)`,
      [crypto.randomUUID(), f.shopAId, saleId, f.productAId],
    );

    const ledger = await ledgerRows(saleId);
    const points = ledger.reduce((a, r) => a + Number(r.points), 0);
    expect(points).toBe(0); // 35 earned - 10 return - 25 void = 0
    const voidReversal = ledger.find((r) => r.kind === "reversed" && r.source_return_id === null);
    expect(Number(voidReversal!.points)).toBe(-25);
  });

  it("closes the offline ordering gap: return synced before its sale", async () => {
    const customerId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, 'Offline Order Customer')`,
      [customerId, f.shopAId],
    );
    const saleId = crypto.randomUUID();
    const returnId = crypto.randomUUID();
    // Return lands first, linked to a not-yet-completed sale row.
    await exec.query(
      `INSERT INTO public.sales (id, shop_id, customer_id, status, total_ugx)
       VALUES ($1, $2, $3, 'draft', 20000)`,
      [saleId, f.shopAId, customerId],
    );
    await exec.query(
      `INSERT INTO public.sale_returns (id, shop_id, sale_id, product_id, quantity, refund_amount_ugx, reason)
       VALUES ($1, $2, $3, $4, 1, 5000, 'other')`,
      [returnId, f.shopAId, saleId, f.productAId],
    );
    // No earned row exists yet → reversal is a no-op, nothing negative.
    expect(await ledgerRows(saleId)).toHaveLength(0);

    // Sale completes later → award fires, then pending reversals apply.
    await exec.query(`UPDATE public.sales SET status = 'completed', completed_at = now() WHERE id = $1`, [
      saleId,
    ]);
    const ledger = await ledgerRows(saleId);
    const earned = ledger.filter((r) => r.kind === "earned");
    const reversed = ledger.filter((r) => r.kind === "reversed");
    expect(earned).toHaveLength(1);
    expect(Number(earned[0].points)).toBe(20);
    expect(reversed).toHaveLength(1);
    expect(Number(reversed[0].points)).toBe(-5);
    expect(reversed[0].source_return_id).toBeTruthy();
    const account = await accountRow(customerId);
    expect(Number(account!.balance_points)).toBe(15);
  });
});

describe("security / merchant isolation", () => {
  it("outsider cannot see shop A loyalty data; owner can", async () => {
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 6_000, customerId: f.customerAId });

    const outsiderVisible = await asUser(exec, f.outsiderId, async () => {
      const { rows } = await exec.query(`SELECT count(*)::int AS n FROM public.loyalty_accounts`);
      return rows[0].n;
    });
    expect(outsiderVisible).toBe(0);

    const ownerVisible = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT count(*)::int AS n FROM public.loyalty_accounts WHERE shop_id = $1`,
        [f.shopAId],
      );
      const tx = await exec.query(
        `SELECT count(*)::int AS n FROM public.loyalty_transactions WHERE source_sale_id = $1`,
        [saleId],
      );
      return { accounts: rows[0].n, tx: tx.rows[0].n };
    });
    expect(ownerVisible.accounts).toBeGreaterThan(0);
    expect(ownerVisible.tx).toBe(1);
  });

  it("ledger writes are server-only: insert denied even for the shop owner", async () => {
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(
          `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points)
           SELECT shop_id, id, 'earned', 999999 FROM public.loyalty_accounts LIMIT 1`,
        );
      }),
    ).rejects.toThrow();
  });

  it("enrollment: cashier can enroll, outsider is forbidden, foreign customer rejected, idempotent", async () => {
    const enrolled = await asUser(exec, f.cashierAId, async () =>
      rpcJson(
        (
          await exec.query(`SELECT public.loyalty_enroll_customer($1, $2) AS result`, [
            f.shopAId,
            f.customerAId,
          ])
        ).rows[0],
      ),
    );
    expect(enrolled.ok).toBe(true);
    expect(enrolled.account_id).toBeTruthy();

    const again = await asUser(exec, f.cashierAId, async () =>
      rpcJson(
        (
          await exec.query(`SELECT public.loyalty_enroll_customer($1, $2) AS result`, [
            f.shopAId,
            f.customerAId,
          ])
        ).rows[0],
      ),
    );
    expect(again.already_enrolled).toBe(true);

    const forbidden = await asUser(exec, f.outsiderId, async () =>
      rpcJson(
        (
          await exec.query(`SELECT public.loyalty_enroll_customer($1, $2) AS result`, [
            f.shopAId,
            f.customerAId,
          ])
        ).rows[0],
      ),
    );
    expect(forbidden.error).toBe("forbidden");

    const foreign = await asUser(exec, f.cashierAId, async () =>
      rpcJson(
        (
          await exec.query(`SELECT public.loyalty_enroll_customer($1, $2) AS result`, [
            f.shopAId,
            f.customerBId,
          ])
        ).rows[0],
      ),
    );
    expect(foreign.error).toBe("customer_not_in_shop");
  });

  it("adjustments: manager role allowed, cashier forbidden, zero points rejected", async () => {
    const account = await accountRow(f.customerAId);
    const accountId = account!.id as string;

    const denied = await asUser(exec, f.cashierAId, async () =>
      rpcJson(
        (
          await exec.query(`SELECT public.loyalty_adjust_points($1, 5, null) AS result`, [accountId])
        ).rows[0],
      ),
    );
    expect(denied.error).toBe("forbidden");

    const zero = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(`SELECT public.loyalty_adjust_points($1, 0, null) AS result`, [accountId])
        ).rows[0],
      ),
    );
    expect(zero.error).toBe("points_required");

    const adjusted = await asUser(exec, f.ownerAId, async () =>
      rpcJson(
        (
          await exec.query(`SELECT public.loyalty_adjust_points($1, 5, 'goodwill') AS result`, [
            accountId,
          ])
        ).rows[0],
      ),
    );
    expect(adjusted.ok).toBe(true);
    expect(adjusted.balance).toBe(Number(account!.balance_points) + 5);

    const { rows } = await exec.query(
      `SELECT kind, points, cause, actor_source FROM public.loyalty_transactions
       WHERE account_id = $1 AND kind = 'adjusted'`,
      [accountId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cause).toBe("manual_adjustment");
  });
});

describe("admin shop reset integration", () => {
  it("preview counts include loyalty tables and execute wipes them but keeps program config", async () => {
    const preview = rpcJson(
      await asUser(exec, f.internalAdminId, async () =>
        (
          await exec.query(`SELECT public.admin_reset_shop_business_data($1, 'preview') AS result`, [
            f.shopAId,
          ])
        ).rows[0],
      ),
    );
    expect(preview.ok).toBe(true);
    const counts = preview.counts as Record<string, number>;
    expect(counts.loyalty_transactions).toBeGreaterThan(0);
    expect(counts.loyalty_accounts).toBeGreaterThan(0);

    const executed = rpcJson(
      await asUser(exec, f.internalAdminId, async () =>
        (
          await exec.query(
            `SELECT public.admin_reset_shop_business_data($1, 'execute', 'RESET SHOP') AS result`,
            [f.shopAId],
          )
        ).rows[0],
      ),
    );
    expect(executed.ok).toBe(true);
    const deleted = executed.deleted as Record<string, number>;
    expect(deleted.loyalty_transactions).toBeGreaterThan(0);
    expect(deleted.loyalty_accounts).toBeGreaterThan(0);
    expect(deleted.customers).toBeGreaterThan(0);

    const { rows: programs } = await exec.query(
      `SELECT count(*)::int AS n FROM public.loyalty_programs WHERE shop_id = $1`,
      [f.shopAId],
    );
    expect(programs[0].n).toBe(1); // program config survives

    const { rows: leftovers } = await exec.query(
      `SELECT
         (SELECT count(*) FROM public.loyalty_transactions WHERE shop_id = $1) +
         (SELECT count(*) FROM public.loyalty_accounts WHERE shop_id = $1) AS n`,
      [f.shopAId],
    );
    expect(Number(leftovers[0].n)).toBe(0);
  });
});

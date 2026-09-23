import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  createLoyaltySqlHarness,
  enableProgram,
  rpcJson,
  seedLoyaltyFixture,
  type LoyaltyFixture,
  type SqlExec,
} from "../../test/sqlIntegration/loyaltyPgHarness";

/**
 * Phase 0 — the loyalty engine primitives must be unreachable from a client, and
 * must keep working from the triggers.
 *
 * Before 20260922222138, all four were SECURITY DEFINER with no authorization
 * check AND client-executable, so the anon key alone could force an award or
 * erase another shop's points over PostgREST. The revoke closes that without
 * touching a single function body — these tests hold both halves of that claim:
 * the direct call is denied, and every trigger-driven path still awards/reverses.
 */

const ENGINE_FNS = [
  "public.loyalty_award_for_sale(uuid)",
  "public.loyalty_reverse_for_sale(uuid,text)",
  "public.loyalty_reverse_for_return(uuid)",
  "public.loyalty_apply_pending_reversals(uuid)",
] as const;

/** Gated client RPCs — these must KEEP their client EXECUTE. */
const CLIENT_FNS = [
  "public.loyalty_enroll_customer(uuid,uuid,boolean,text,jsonb)",
  "public.loyalty_adjust_points(uuid,integer,text)",
] as const;

let exec: SqlExec;
let f: LoyaltyFixture;

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId, { earnUnitUgx: 1000, earnPointsPerUnit: 1 });
  await exec.query(
    `INSERT INTO public.loyalty_accounts (shop_id, customer_id) VALUES ($1, $2)`,
    [f.shopAId, f.customerAId],
  );
}, 120_000);

afterAll(async () => {
  await exec.close();
});

async function balanceOf(customerId: string): Promise<number> {
  const { rows } = await exec.query(
    `SELECT balance_points FROM public.loyalty_accounts WHERE customer_id = $1`,
    [customerId],
  );
  return Number(rows[0].balance_points);
}

async function completedSale(totalUgx: number, customerId: string | null): Promise<string> {
  const saleId = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, total_ugx, completed_at)
     VALUES ($1, $2, $3, 'completed', 'paid', $4, now())`,
    [saleId, f.shopAId, customerId, totalUgx],
  );
  return saleId;
}

describe("engine primitives are not client-executable", () => {
  it.each(ENGINE_FNS)("anon has no EXECUTE on %s", async (sig) => {
    const { rows } = await exec.query(
      `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS allowed`,
      [sig],
    );
    expect(rows[0].allowed).toBe(false);
  });

  it.each(ENGINE_FNS)("authenticated has no EXECUTE on %s", async (sig) => {
    const { rows } = await exec.query(
      `SELECT has_function_privilege('authenticated', $1, 'EXECUTE') AS allowed`,
      [sig],
    );
    expect(rows[0].allowed).toBe(false);
  });

  it.each(ENGINE_FNS)("PUBLIC has no EXECUTE on %s (the default grant is gone)", async (sig) => {
    const { rows } = await exec.query(
      `SELECT has_function_privilege('public', $1, 'EXECUTE') AS allowed`,
      [sig],
    );
    expect(rows[0].allowed).toBe(false);
  });

  it("a signed-in cashier calling the award RPC directly is denied at runtime", async () => {
    const saleId = await completedSale(50_000, f.customerAId);
    await expect(
      asUser(exec, f.cashierAId, () =>
        exec.query(`SELECT public.loyalty_award_for_sale($1) AS result`, [saleId]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("a signed-in owner calling the void-reversal RPC directly is denied at runtime", async () => {
    const saleId = await completedSale(9_000, f.customerAId);
    await expect(
      asUser(exec, f.ownerAId, () =>
        exec.query(`SELECT public.loyalty_reverse_for_sale($1) AS result`, [saleId]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("an outsider cannot erase another shop's points by calling the reversal RPC", async () => {
    const saleId = await completedSale(30_000, f.customerAId);
    const before = await balanceOf(f.customerAId);
    expect(before).toBeGreaterThan(0);

    await expect(
      asUser(exec, f.outsiderId, () =>
        exec.query(`SELECT public.loyalty_reverse_for_sale($1) AS result`, [saleId]),
      ),
    ).rejects.toThrow(/permission denied/i);

    expect(await balanceOf(f.customerAId)).toBe(before);
  });

  it.each(CLIENT_FNS)("the gated client RPC %s keeps its EXECUTE", async (sig) => {
    const { rows } = await exec.query(
      `SELECT has_function_privilege('authenticated', $1, 'EXECUTE') AS allowed`,
      [sig],
    );
    expect(rows[0].allowed).toBe(true);
  });
});

describe("trigger-driven awarding still works after the revoke", () => {
  it("completing a sale still awards points through trg_loyalty_sales_status", async () => {
    const before = await balanceOf(f.customerAId);
    await completedSale(25_000, f.customerAId);
    expect(await balanceOf(f.customerAId)).toBe(before + 25);
  });

  it("the draft → completed transition awards exactly once, as production writes it", async () => {
    const before = await balanceOf(f.customerAId);
    const saleId = crypto.randomUUID();
    // shop_push_sale_complete inserts as 'draft', then UPDATEs to 'completed'.
    await exec.query(
      `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, total_ugx)
       VALUES ($1, $2, $3, 'draft', 'pending', 12_000)`,
      [saleId, f.shopAId, f.customerAId],
    );
    expect(await balanceOf(f.customerAId)).toBe(before);

    await exec.query(
      `UPDATE public.sales SET status = 'completed', completed_at = now()
        WHERE id = $1 AND status IS DISTINCT FROM 'completed'`,
      [saleId],
    );
    expect(await balanceOf(f.customerAId)).toBe(before + 12);

    // Re-running the same guarded UPDATE is a no-op, so no second award.
    await exec.query(
      `UPDATE public.sales SET status = 'completed'
        WHERE id = $1 AND status IS DISTINCT FROM 'completed'`,
      [saleId],
    );
    expect(await balanceOf(f.customerAId)).toBe(before + 12);

    const { rows } = await exec.query(
      `SELECT count(*) AS n FROM public.loyalty_transactions
        WHERE source_sale_id = $1 AND kind = 'earned'`,
      [saleId],
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it("a partial return still reverses proportionally through trg_loyalty_sale_returns", async () => {
    const saleId = await completedSale(20_000, f.customerAId);
    const afterAward = await balanceOf(f.customerAId);

    await exec.query(
      `INSERT INTO public.sale_returns (id, shop_id, sale_id, product_id, quantity, refund_amount_ugx, reason)
       VALUES ($1, $2, $3, $4, 1, 5000, 'other')`,
      [crypto.randomUUID(), f.shopAId, saleId, f.productAId],
    );

    expect(await balanceOf(f.customerAId)).toBe(afterAward - 5);
  });

  it("a void still reverses fully through trg_loyalty_sale_voids", async () => {
    const saleId = await completedSale(15_000, f.customerAId);
    const afterAward = await balanceOf(f.customerAId);

    await exec.query(
      `INSERT INTO public.sale_voids (id, shop_id, sale_id, product_id, quantity, amount_ugx, created_by)
       VALUES ($1, $2, $3, $4, 1, 15000, $5)`,
      [crypto.randomUUID(), f.shopAId, saleId, f.productAId, f.ownerAId],
    );

    expect(await balanceOf(f.customerAId)).toBe(afterAward - 15);
  });

  it("a sale with no customer is still skipped without error", async () => {
    const before = await balanceOf(f.customerAId);
    const saleId = await completedSale(40_000, null);
    expect(await balanceOf(f.customerAId)).toBe(before);

    const { rows } = await exec.query(
      `SELECT count(*) AS n FROM public.loyalty_transactions WHERE source_sale_id = $1`,
      [saleId],
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it("loyalty still cannot block a financial write — the sale row lands regardless", async () => {
    const saleId = await completedSale(7_000, f.customerAId);
    const { rows } = await exec.query(`SELECT status, total_ugx FROM public.sales WHERE id = $1`, [
      saleId,
    ]);
    expect(rows[0].status).toBe("completed");
    expect(Number(rows[0].total_ugx)).toBe(7_000);
  });
});

describe("the definer call path the triggers rely on is intact", () => {
  it("a SECURITY DEFINER caller owned by postgres can still reach the engine", async () => {
    // Stands in for shop_push_sale_complete: a definer function owned by the same
    // role runs the nested call as the owner, which needs no client EXECUTE.
    await exec.exec(`
      create or replace function public.test_definer_award (p_sale_id uuid)
      returns jsonb language plpgsql security definer set search_path = public
      as $fn$ begin return public.loyalty_award_for_sale (p_sale_id); end $fn$;
      grant execute on function public.test_definer_award (uuid) to authenticated;
    `);

    // Land a completed-but-unawarded sale by muting the trigger, so the award
    // below is unambiguously the nested definer call's own work.
    const saleId = crypto.randomUUID();
    await exec.exec(`ALTER TABLE public.sales DISABLE TRIGGER trg_loyalty_sales_status`);
    await exec.query(
      `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, total_ugx, completed_at)
       VALUES ($1, $2, $3, 'completed', 'paid', 6000, now())`,
      [saleId, f.shopAId, f.customerAId],
    );
    await exec.exec(`ALTER TABLE public.sales ENABLE TRIGGER trg_loyalty_sales_status`);

    const before = await balanceOf(f.customerAId);

    const result = rpcJson(
      await asUser(exec, f.cashierAId, async () =>
        (await exec.query(`SELECT public.test_definer_award($1) AS result`, [saleId])).rows[0],
      ),
    );

    expect(result.ok).toBe(true);
    expect(result.awarded).toBe(true);
    expect(await balanceOf(f.customerAId)).toBe(before + 6);
  });
});

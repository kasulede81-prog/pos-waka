/**
 * WAKA-02 / WAKA-03 / R8 — privilege and RLS checks against real PostgreSQL
 * catalog state (PGLite). Role switching, not source-text assertions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, rpcJson, type SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";
import {
  applyWakaSecurityHotfix,
  createWakaSecuritySqlHarness,
  seedR3StockFixture,
  seedWakaSecurityCatalog,
  type R3StockFixture,
} from "../test/sqlIntegration/wakaSecurityHotfixPgHarness";

const DELTA_IDENT =
  "public._apply_durable_stock_delta(uuid,uuid,text,uuid,numeric,text,text)";
const EXPENSES_IDENT = "public._report_cash_drawer_expenses_ugx(uuid,date,date)";
const SALES_COUNT_IDENT = "public._shop_completed_sales_count_for_day(uuid,text)";
const CASH_DEBT_IDENT = "public._report_period_remaining_cash_debt(uuid,date,date,boolean)";
const ADJUST_IDENT = "public.shop_apply_stock_adjustment(uuid,jsonb)";

describe("WAKA-02 / WAKA-03 / R8 security hotfix (migration 183)", () => {
  let exec: SqlExec;
  let fx: R3StockFixture;

  beforeAll(async () => {
    exec = await createWakaSecuritySqlHarness();
    fx = await seedR3StockFixture(exec);
    await seedWakaSecurityCatalog(exec);
  }, 120_000);

  afterAll(async () => {
    await exec?.close();
  });

  async function hasExec(role: string, ident: string): Promise<boolean> {
    const { rows } = await exec.query<{ ok: boolean }>(
      `SELECT has_function_privilege($1, $2::text, 'EXECUTE') AS ok`,
      [role, ident],
    );
    return Boolean(rows[0]?.ok);
  }

  async function tableRls(name: string) {
    const { rows } = await exec.query<{ relrowsecurity: boolean }>(
      `SELECT c.relrowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1`,
      [name],
    );
    return rows[0]?.relrowsecurity === true;
  }

  async function searchPathPinned(name: string): Promise<boolean> {
    const { rows } = await exec.query<{ pinned: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           CROSS JOIN LATERAL unnest(coalesce(p.proconfig, '{}'::text[])) AS cfg
          WHERE n.nspname = 'public'
            AND p.proname = $1
            AND p.prosecdef
            AND cfg LIKE 'search_path=%'
       ) AS pinned`,
      [name],
    );
    return rows[0]?.pinned === true;
  }

  it("pre-hotfix: anon EXECUTE on the stock-delta primitive survives PUBLIC/authenticated revoke (WAKA-02)", async () => {
    expect(await hasExec("anon", DELTA_IDENT)).toBe(true);
    expect(await hasExec("anon", EXPENSES_IDENT)).toBe(true);
    expect(await hasExec("anon", SALES_COUNT_IDENT)).toBe(true);
    expect(await hasExec("anon", CASH_DEBT_IDENT)).toBe(true);
    expect(await tableRls("shop_pos_staff_revisions")).toBe(false);
    expect(await tableRls("waka_shop_number_counter")).toBe(false);
    expect(await tableRls("waka_shop_number_released")).toBe(false);
    expect(await searchPathPinned("waka_r8_mutable_search_path_probe")).toBe(false);
  });

  it("applies migration 183", async () => {
    await applyWakaSecurityHotfix(exec);
  });

  it("1 / 7 — anon cannot EXECUTE _apply_durable_stock_delta (catalog)", async () => {
    expect(await hasExec("anon", DELTA_IDENT)).toBe(false);
    expect(await hasExec("authenticated", DELTA_IDENT)).toBe(false);
  });

  it("1 — SET ROLE anon cannot invoke the stock-delta primitive", async () => {
    await exec.exec("BEGIN");
    try {
      await exec.exec("SET LOCAL ROLE anon");
      await expect(
        exec.query(
          `SELECT public._apply_durable_stock_delta($1::uuid, $2::uuid, 'adjustment', $3::uuid, -1, 'adjustment', null)`,
          [fx.shopAId, fx.productAId, crypto.randomUUID()],
        ),
      ).rejects.toThrow();
    } finally {
      await exec.exec("ROLLBACK");
    }
  });

  it("2 — authenticated member still applies stock through shop_apply_stock_adjustment", async () => {
    expect(await hasExec("authenticated", ADJUST_IDENT)).toBe(true);
    const before = await exec.query<{ stock_on_hand: string }>(
      `SELECT stock_on_hand::text FROM public.products WHERE id = $1`,
      [fx.productAId],
    );
    const start = Number(before.rows[0]!.stock_on_hand);
    const adjustmentId = crypto.randomUUID();

    await exec.exec("BEGIN");
    try {
      await exec.exec("SET LOCAL ROLE authenticated");
      await exec.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [fx.userAId]);
      const { rows } = await exec.query(
        `SELECT public.shop_apply_stock_adjustment($1::uuid, $2::jsonb) AS result`,
        [
          fx.shopAId,
          JSON.stringify({
            product_id: fx.productAId,
            adjustment_id: adjustmentId,
            delta: -3,
            note: "hotfix",
          }),
        ],
      );
      const result = rpcJson(rows[0]);
      expect(result.ok).toBe(true);
    } finally {
      await exec.exec("COMMIT");
    }

    const after = await exec.query<{ stock_on_hand: string }>(
      `SELECT stock_on_hand::text FROM public.products WHERE id = $1`,
      [fx.productAId],
    );
    expect(Number(after.rows[0]!.stock_on_hand)).toBe(start - 3);
  });

  it("3 / 7 — anon cannot EXECUTE WAKA-03 financial helpers (catalog)", async () => {
    expect(await hasExec("anon", EXPENSES_IDENT)).toBe(false);
    expect(await hasExec("anon", SALES_COUNT_IDENT)).toBe(false);
    expect(await hasExec("anon", CASH_DEBT_IDENT)).toBe(false);
    expect(await hasExec("authenticated", EXPENSES_IDENT)).toBe(false);
  });

  it("3 — SET ROLE anon cannot call the reporting helpers", async () => {
    await exec.exec("BEGIN");
    try {
      await exec.exec("SET LOCAL ROLE anon");
      await expect(
        exec.query(`SELECT public._report_cash_drawer_expenses_ugx($1::uuid, current_date, current_date)`, [
          fx.shopAId,
        ]),
      ).rejects.toThrow();
      await expect(
        exec.query(`SELECT public._shop_completed_sales_count_for_day($1::uuid, '2026-09-08')`, [fx.shopAId]),
      ).rejects.toThrow();
    } finally {
      await exec.exec("ROLLBACK");
    }
  });

  it("4 — authenticated keeps shop_* EXECUTE; financial helpers stay internal", async () => {
    expect(await hasExec("authenticated", ADJUST_IDENT)).toBe(true);
    expect(await hasExec("authenticated", EXPENSES_IDENT)).toBe(false);
    expect(await hasExec("authenticated", SALES_COUNT_IDENT)).toBe(false);
    await exec.exec("BEGIN");
    try {
      await exec.exec("SET LOCAL ROLE authenticated");
      await exec.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [fx.userAId]);
      await expect(
        exec.query(`SELECT public._report_cash_drawer_expenses_ugx($1::uuid, current_date, current_date)`, [
          fx.shopAId,
        ]),
      ).rejects.toThrow();
    } finally {
      await exec.exec("ROLLBACK");
    }
  });

  it("4 — shop-access guard keeps member totals and zeros outsiders", async () => {
    await exec.exec(`
      INSERT INTO public.expenses (shop_id, expense_type, amount_ugx, paid_on)
      VALUES ('${fx.shopAId}', 'cash_drawer', 7500, current_date)
    `);
    const member = await asUser(exec, fx.userAId, async () =>
      exec.query<{ n: string }>(
        `SELECT public._report_cash_drawer_expenses_ugx($1::uuid, current_date, current_date)::text AS n`,
        [fx.shopAId],
      ),
    );
    expect(Number(member.rows[0]!.n)).toBe(7500);
    const outsider = await asUser(exec, fx.outsiderId, async () =>
      exec.query<{ n: string }>(
        `SELECT public._report_cash_drawer_expenses_ugx($1::uuid, current_date, current_date)::text AS n`,
        [fx.shopAId],
      ),
    );
    expect(Number(outsider.rows[0]!.n)).toBe(0);
  });

  it("5 / 7 — RLS is enabled on the three WAKA-03 tables (pg_class)", async () => {
    expect(await tableRls("shop_pos_staff_revisions")).toBe(true);
    expect(await tableRls("waka_shop_number_counter")).toBe(true);
    expect(await tableRls("waka_shop_number_released")).toBe(true);

    const { rows } = await exec.query<{
      revisions_anon: boolean;
      revisions_auth: boolean;
      counter_anon: boolean;
      counter_auth: boolean;
      released_anon: boolean;
      released_auth: boolean;
    }>(
      `SELECT
         has_table_privilege('anon', 'public.shop_pos_staff_revisions', 'SELECT') AS revisions_anon,
         has_table_privilege('authenticated', 'public.shop_pos_staff_revisions', 'SELECT') AS revisions_auth,
         has_table_privilege('anon', 'public.waka_shop_number_counter', 'SELECT') AS counter_anon,
         has_table_privilege('authenticated', 'public.waka_shop_number_counter', 'SELECT') AS counter_auth,
         has_table_privilege('anon', 'public.waka_shop_number_released', 'SELECT') AS released_anon,
         has_table_privilege('authenticated', 'public.waka_shop_number_released', 'SELECT') AS released_auth`,
    );
    expect(rows[0]!.revisions_anon).toBe(false);
    expect(rows[0]!.revisions_auth).toBe(true);
    expect(rows[0]!.counter_anon).toBe(false);
    expect(rows[0]!.counter_auth).toBe(false);
    expect(rows[0]!.released_anon).toBe(false);
    expect(rows[0]!.released_auth).toBe(false);
  });

  it("5 — shop member can SELECT own-shop staff revisions; anon cannot", async () => {
    await exec.exec(`
      INSERT INTO public.shop_pos_staff_revisions (shop_id, shop_version, action)
      VALUES ('${fx.shopAId}', 1, 'upsert')
    `);
    await exec.exec("BEGIN");
    try {
      await exec.exec("SET LOCAL ROLE authenticated");
      await exec.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [fx.userAId]);
      const { rows } = await exec.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM public.shop_pos_staff_revisions WHERE shop_id = $1`,
        [fx.shopAId],
      );
      expect(Number(rows[0]!.c)).toBeGreaterThan(0);
    } finally {
      await exec.exec("ROLLBACK");
    }

    await exec.exec("BEGIN");
    try {
      await exec.exec("SET LOCAL ROLE anon");
      await expect(exec.query(`SELECT * FROM public.shop_pos_staff_revisions`)).rejects.toThrow();
      await expect(exec.query(`SELECT * FROM public.waka_shop_number_counter`)).rejects.toThrow();
      await expect(exec.query(`SELECT * FROM public.waka_shop_number_released`)).rejects.toThrow();
    } finally {
      await exec.exec("ROLLBACK");
    }
  });

  it("6 — R8 pins search_path on previously mutable SECURITY DEFINER functions", async () => {
    expect(await searchPathPinned("waka_r8_mutable_search_path_probe")).toBe(true);
    expect(await searchPathPinned("_apply_durable_stock_delta")).toBe(true);
    const { rows } = await exec.query<{ n: number }>(
      `SELECT public.waka_r8_mutable_search_path_probe() AS n`,
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("6 — leftover SECURITY DEFINER functions in public have a search_path", async () => {
    const { rows } = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef
          AND n.nspname = 'public'
          AND p.prokind IN ('f', 'p')
          AND NOT EXISTS (
            SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) cfg
             WHERE cfg LIKE 'search_path=%'
          )`,
    );
    expect(Number(rows[0]!.c)).toBe(0);
  });
});

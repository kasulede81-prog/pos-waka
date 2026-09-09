/**
 * Migration 186 — drop obsolete trg_sales_status_stock reverse branch.
 * Probe-table + catalog only. Does not call real stock or deletion RPCs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";
import {
  applyWakaSalesStatusStockTriggerFix,
  createWakaSecuritySqlHarness,
  seedSalesStatusStockTriggerCatalog,
} from "../test/sqlIntegration/wakaSecurityHotfixPgHarness";

const MIGRATION_186 = join(
  process.cwd(),
  "supabase",
  "migrations",
  "186_sales_status_stock_drop_legacy_reverse.sql",
);

const MIGRATION_184 = join(
  process.cwd(),
  "supabase",
  "migrations",
  "184_ungated_definer_primitive_revoke.sql",
);

const SALE_A = "00000000-0000-4000-8000-000000000186";
const SALE_B = "00000000-0000-4000-8000-000000000187";
const SALE_C = "00000000-0000-4000-8000-000000000188";

describe("sales status stock drop legacy reverse (migration 186)", () => {
  let exec: SqlExec;
  let voidRpcBefore: string;

  beforeAll(async () => {
    exec = await createWakaSecuritySqlHarness();
    await seedSalesStatusStockTriggerCatalog(exec);
    voidRpcBefore = await functionDef("public.shop_apply_sale_void_stock(uuid,jsonb)");
    await exec.exec(`
      INSERT INTO public.waka186_sales_probe (id, status, issue_receipt) VALUES
        ('${SALE_A}', 'completed', false),
        ('${SALE_B}', 'draft', true),
        ('${SALE_C}', 'completed', false);
    `);
  }, 120_000);

  afterAll(async () => {
    await exec?.close();
  });

  async function functionDef(ident: string): Promise<string> {
    const { rows } = await exec.query<{ def: string }>(
      `SELECT pg_get_functiondef($1::regprocedure) AS def`,
      [ident],
    );
    return rows[0]?.def ?? "";
  }

  async function probeCount(fn: string, saleId: string): Promise<number> {
    const { rows } = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.waka186_trigger_probe WHERE fn = $1 AND sale_id = $2::uuid`,
      [fn, saleId],
    );
    return Number(rows[0]?.c ?? 0);
  }

  async function hasExec(role: string, ident: string): Promise<boolean> {
    const { rows } = await exec.query<{ ok: boolean }>(
      `SELECT has_function_privilege($1, $2::text, 'EXECUTE') AS ok`,
      [role, ident],
    );
    return Boolean(rows[0]?.ok);
  }

  it("migration 186 replaces only the trigger function and keeps the apply branch", () => {
    const sql = readFileSync(MIGRATION_186, "utf8");
    expect(sql).toMatch(/create or replace function public\.trg_sales_status_stock/i);
    expect(sql).toMatch(/perform public\.apply_sale_stock_movements \(new\.id\)/i);
    expect(sql).toMatch(/perform public\.create_receipt_for_sale \(new\.id\)/i);
    expect(sql).not.toMatch(/perform public\.reverse_sale_stock_movements/i);
    expect(sql).not.toMatch(/create or replace function public\.reverse_sale_stock_movements/i);
    expect(sql).not.toMatch(/create or replace function public\.shop_apply_sale_void_stock/i);
    expect(sql).not.toMatch(/grant execute/i);
    expect(sql).not.toMatch(/from service_role/i);
    const revoke184 = readFileSync(MIGRATION_184, "utf8");
    expect(revoke184).toMatch(
      /revoke all on function public\.reverse_sale_stock_movements \(uuid\) from authenticated/i,
    );
  });

  it("pre-hotfix: completed → void/refunded still calls reverse", async () => {
    const def = await functionDef("public.trg_sales_status_stock()");
    expect(def).toMatch(/reverse_sale_stock_movements/i);
    expect(def).toMatch(/apply_sale_stock_movements/i);

    await exec.exec(`UPDATE public.waka186_sales_probe SET status = 'void' WHERE id = '${SALE_A}'`);
    expect(await probeCount("reverse", SALE_A)).toBe(1);
    expect(await probeCount("apply", SALE_A)).toBe(0);
  });

  it("applies migration 186", async () => {
    await applyWakaSalesStatusStockTriggerFix(exec);
  });

  it("post-hotfix: trigger keeps apply/receipt and drops reverse", async () => {
    const def = await functionDef("public.trg_sales_status_stock()");
    expect(def).toMatch(/apply_sale_stock_movements/i);
    expect(def).toMatch(/create_receipt_for_sale/i);
    expect(def).not.toMatch(/reverse_sale_stock_movements/i);
    expect(def).not.toMatch(/'void',\s*'refunded'/i);
  });

  it("post-hotfix: completed → void/refunded no longer invokes reverse", async () => {
    const before = await probeCount("reverse", SALE_C);
    await exec.exec(`UPDATE public.waka186_sales_probe SET status = 'void' WHERE id = '${SALE_C}'`);
    await exec.exec(`UPDATE public.waka186_sales_probe SET status = 'refunded' WHERE id = '${SALE_C}'`);
    expect(await probeCount("reverse", SALE_C)).toBe(before);
    expect(await probeCount("apply", SALE_C)).toBe(0);
  });

  it("post-hotfix: draft → completed still applies stock and receipt", async () => {
    await exec.exec(`UPDATE public.waka186_sales_probe SET status = 'completed' WHERE id = '${SALE_B}'`);
    expect(await probeCount("apply", SALE_B)).toBe(1);
    expect(await probeCount("receipt", SALE_B)).toBe(1);
    expect(await probeCount("reverse", SALE_B)).toBe(0);
  });

  it("shop_apply_sale_void_stock body is unchanged and client EXECUTE on reverse stays revoked", async () => {
    const voidRpcAfter = await functionDef("public.shop_apply_sale_void_stock(uuid,jsonb)");
    expect(voidRpcAfter.length).toBeGreaterThan(0);
    expect(voidRpcAfter).toBe(voidRpcBefore);
    expect(await hasExec("public", "public.reverse_sale_stock_movements(uuid)")).toBe(false);
    expect(await hasExec("anon", "public.reverse_sale_stock_movements(uuid)")).toBe(false);
    expect(await hasExec("authenticated", "public.reverse_sale_stock_movements(uuid)")).toBe(false);
  });
});

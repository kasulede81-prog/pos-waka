/**
 * Migration 184 — revoke client EXECUTE on ungated SECURITY DEFINER primitives.
 * Catalog ACL only. Does not invoke hard-delete or stock mutation functions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";
import {
  applyWakaUngatedPrimitiveHotfix,
  createWakaSecuritySqlHarness,
  seedUngatedDefinerPrimitiveCatalog,
} from "../test/sqlIntegration/wakaSecurityHotfixPgHarness";

const MIGRATION_184 = join(
  process.cwd(),
  "supabase",
  "migrations",
  "184_ungated_definer_primitive_revoke.sql",
);

const INTERNALS = [
  "public.certified_hard_delete_organization_execute(uuid,uuid,uuid,uuid,text,text)",
  "public.hard_delete_collect_org_user_ids(uuid)",
  "public.hard_delete_collect_org_shop_ids(uuid)",
  "public.hard_delete_verification_report(uuid,uuid[],uuid,uuid[])",
  "public.reverse_sale_stock_movements(uuid)",
  "public.apply_sale_stock_movements(uuid)",
  "public.apply_sale_return_stock(uuid)",
  "public.create_receipt_for_sale(uuid)",
  "public.next_shop_counter(uuid,text)",
  "public.shop_org_id(uuid)",
] as const;

const WRAPPERS = [
  "public.owner_permanently_delete_own_account(text,text)",
  "public.admin_permanently_delete_shop_account(uuid,text,text)",
] as const;

const REVOKE_SNIPPETS = [
  "revoke all on function public.certified_hard_delete_organization_execute (uuid, uuid, uuid, uuid, text, text) from public",
  "revoke all on function public.certified_hard_delete_organization_execute (uuid, uuid, uuid, uuid, text, text) from anon",
  "revoke all on function public.certified_hard_delete_organization_execute (uuid, uuid, uuid, uuid, text, text) from authenticated",
  "revoke all on function public.hard_delete_collect_org_user_ids (uuid) from public",
  "revoke all on function public.hard_delete_collect_org_user_ids (uuid) from anon",
  "revoke all on function public.hard_delete_collect_org_user_ids (uuid) from authenticated",
  "revoke all on function public.hard_delete_collect_org_shop_ids (uuid) from public",
  "revoke all on function public.hard_delete_collect_org_shop_ids (uuid) from anon",
  "revoke all on function public.hard_delete_collect_org_shop_ids (uuid) from authenticated",
  "revoke all on function public.hard_delete_verification_report (uuid, uuid[], uuid, uuid[]) from public",
  "revoke all on function public.hard_delete_verification_report (uuid, uuid[], uuid, uuid[]) from anon",
  "revoke all on function public.hard_delete_verification_report (uuid, uuid[], uuid, uuid[]) from authenticated",
  "revoke all on function public.reverse_sale_stock_movements (uuid) from public",
  "revoke all on function public.reverse_sale_stock_movements (uuid) from anon",
  "revoke all on function public.reverse_sale_stock_movements (uuid) from authenticated",
  "revoke all on function public.apply_sale_stock_movements (uuid) from public",
  "revoke all on function public.apply_sale_stock_movements (uuid) from anon",
  "revoke all on function public.apply_sale_stock_movements (uuid) from authenticated",
  "revoke all on function public.apply_sale_return_stock (uuid) from public",
  "revoke all on function public.apply_sale_return_stock (uuid) from anon",
  "revoke all on function public.apply_sale_return_stock (uuid) from authenticated",
  "revoke all on function public.create_receipt_for_sale (uuid) from public",
  "revoke all on function public.create_receipt_for_sale (uuid) from anon",
  "revoke all on function public.create_receipt_for_sale (uuid) from authenticated",
  "revoke all on function public.next_shop_counter (uuid, text) from public",
  "revoke all on function public.next_shop_counter (uuid, text) from anon",
  "revoke all on function public.next_shop_counter (uuid, text) from authenticated",
  "revoke all on function public.shop_org_id (uuid) from public",
  "revoke all on function public.shop_org_id (uuid) from anon",
  "revoke all on function public.shop_org_id (uuid) from authenticated",
] as const;

describe("ungated DEFINER primitive revoke (migration 184)", () => {
  let exec: SqlExec;

  beforeAll(async () => {
    exec = await createWakaSecuritySqlHarness();
    await seedUngatedDefinerPrimitiveCatalog(exec);
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

  it("migration 184 contains the exact PUBLIC/anon/authenticated revokes", () => {
    const sql = readFileSync(MIGRATION_184, "utf8").replace(/\s+/g, " ");
    for (const snippet of REVOKE_SNIPPETS) {
      expect(sql).toContain(snippet);
    }
    expect(sql).not.toMatch(
      /revoke all on function public\.owner_permanently_delete_own_account/i,
    );
    expect(sql).not.toMatch(
      /revoke all on function public\.admin_permanently_delete_shop_account/i,
    );
    expect(sql).not.toMatch(/grant execute on function public\./i);
  });

  it("pre-hotfix: anon and authenticated still EXECUTE the internals", async () => {
    for (const ident of INTERNALS) {
      expect(await hasExec("anon", ident), ident).toBe(true);
      expect(await hasExec("authenticated", ident), ident).toBe(true);
    }
    expect(await hasExec("authenticated", WRAPPERS[0])).toBe(true);
    expect(await hasExec("authenticated", WRAPPERS[1])).toBe(true);
    expect(await hasExec("anon", WRAPPERS[0])).toBe(false);
    expect(await hasExec("anon", WRAPPERS[1])).toBe(false);
  });

  it("applies migration 184", async () => {
    await applyWakaUngatedPrimitiveHotfix(exec);
  });

  it("anon and authenticated lose EXECUTE on every revoked primitive", async () => {
    for (const ident of INTERNALS) {
      expect(await hasExec("anon", ident), ident).toBe(false);
      expect(await hasExec("authenticated", ident), ident).toBe(false);
    }
  });

  it("gated wrappers keep authenticated EXECUTE and stay denied to anon", async () => {
    for (const ident of WRAPPERS) {
      expect(await hasExec("authenticated", ident), ident).toBe(true);
      expect(await hasExec("anon", ident), ident).toBe(false);
    }
  });
});

/**
 * Migration 185 — revoke leftover anon EXECUTE on deletion wrappers.
 * Catalog ACL only. Does not invoke deletion functions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";
import {
  applyWakaAccountDeletionWrapperHotfix,
  createWakaSecuritySqlHarness,
  seedAccountDeletionWrapperCatalog,
} from "../test/sqlIntegration/wakaSecurityHotfixPgHarness";

const MIGRATION_185 = join(
  process.cwd(),
  "supabase",
  "migrations",
  "185_account_deletion_wrapper_anon_revoke.sql",
);

const WRAPPERS = [
  "public.owner_permanently_delete_own_account(text,text)",
  "public.owner_permanently_delete_own_account(text)",
  "public.admin_permanently_delete_shop_account(uuid,text,text)",
  "public.admin_permanently_delete_shop_account(uuid,text)",
] as const;

const PRIVILEGE_SNIPPETS = [
  "revoke all on function public.owner_permanently_delete_own_account (text, text) from public",
  "revoke all on function public.owner_permanently_delete_own_account (text, text) from anon",
  "grant execute on function public.owner_permanently_delete_own_account (text, text) to authenticated",
  "revoke all on function public.owner_permanently_delete_own_account (text) from public",
  "revoke all on function public.owner_permanently_delete_own_account (text) from anon",
  "grant execute on function public.owner_permanently_delete_own_account (text) to authenticated",
  "revoke all on function public.admin_permanently_delete_shop_account (uuid, text, text) from public",
  "revoke all on function public.admin_permanently_delete_shop_account (uuid, text, text) from anon",
  "grant execute on function public.admin_permanently_delete_shop_account (uuid, text, text) to authenticated",
  "revoke all on function public.admin_permanently_delete_shop_account (uuid, text) from public",
  "revoke all on function public.admin_permanently_delete_shop_account (uuid, text) from anon",
  "grant execute on function public.admin_permanently_delete_shop_account (uuid, text) to authenticated",
] as const;

describe("account-deletion wrapper anon revoke (migration 185)", () => {
  let exec: SqlExec;

  beforeAll(async () => {
    exec = await createWakaSecuritySqlHarness();
    await seedAccountDeletionWrapperCatalog(exec);
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

  it("migration 185 contains the exact PUBLIC/anon revoke and authenticated grant", () => {
    const sql = readFileSync(MIGRATION_185, "utf8").replace(/\s+/g, " ");
    for (const snippet of PRIVILEGE_SNIPPETS) {
      expect(sql).toContain(snippet);
    }
    expect(sql).not.toMatch(/create or replace function/i);
    expect(sql).not.toMatch(/revoke all on function public\.\S+ from authenticated/i);
    expect(sql).not.toMatch(/from service_role/i);
  });

  it("pre-hotfix: anon and authenticated EXECUTE on all four overloads", async () => {
    for (const ident of WRAPPERS) {
      expect(await hasExec("anon", ident), ident).toBe(true);
      expect(await hasExec("authenticated", ident), ident).toBe(true);
    }
  });

  it("applies migration 185", async () => {
    await applyWakaAccountDeletionWrapperHotfix(exec);
  });

  it("post-hotfix: PUBLIC and anon lose EXECUTE; authenticated keeps it", async () => {
    for (const ident of WRAPPERS) {
      expect(await hasExec("public", ident), ident).toBe(false);
      expect(await hasExec("anon", ident), ident).toBe(false);
      expect(await hasExec("authenticated", ident), ident).toBe(true);
    }
  });
});

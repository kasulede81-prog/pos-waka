import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSrc(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("owner deletion surfaces (Phase 39.3)", () => {
  it("does not render SelfDeleteHealthPanel on the owner deletion page", () => {
    const page = readSrc("src/pages/AccountDeletionPage.tsx");
    expect(page).not.toContain("SelfDeleteHealthPanel");
    expect(page).not.toContain("HardDeleteReportPanel");
    expect(page).not.toContain("supabase:deploy:admin");
    expect(page).not.toContain("setError(result.message");
  });

  it("keeps SelfDeleteHealthPanel on diagnostics", () => {
    const page = readSrc("src/pages/SettingsDiagnosticsPage.tsx");
    expect(page).toContain("SelfDeleteHealthPanel");
  });

  it("SQL database verification no longer counts auth.users for all_passed", () => {
    const sql = readSrc("supabase/migrations/148_owner_self_delete_reliability.sql");
    const reportFn = sql.split("create or replace function public.certified_hard_delete_organization_execute")[0] ?? "";
    expect(reportFn).toContain("scope', 'database'");
    expect(reportFn).not.toMatch(/from auth\.users/);
    expect(sql).toContain("owner_deletion_confirmation_matches");
    expect(sql).toContain("delete from public.table_sessions");
    expect(sql).toContain("delete from public.enterprise_stock_transfers");
  });
});

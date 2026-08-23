import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SQL_160 = readFileSync(
  resolve(ROOT, "supabase/migrations/160_staff_v2_link_constraints.sql"),
  "utf8",
);
const SQL_158 = readFileSync(
  resolve(ROOT, "supabase/migrations/158_staff_v2_identity_foothold.sql"),
  "utf8",
);
const SQL_159 = readFileSync(
  resolve(ROOT, "supabase/migrations/159_staff_v2_sales_identity_observe_only.sql"),
  "utf8",
);
const CLOUD_SYNC = readFileSync(resolve(ROOT, "src/offline/cloudSync.ts"), "utf8");
const SESSION_ACTOR = readFileSync(resolve(ROOT, "src/lib/sessionActor.ts"), "utf8");
const USE_AUTH = readFileSync(resolve(ROOT, "src/hooks/useAuth.ts"), "utf8");
const MERGE = readFileSync(resolve(ROOT, "src/lib/saleFinancialMerge.ts"), "utf8");

describe("STAFF-V2 Phase 4 link constraints", () => {
  it("adds only a partial unique (shop_id, user_id) where user_id is not null", () => {
    expect(SQL_160).toMatch(
      /create unique index if not exists shop_pos_staff_shop_user_id_uidx/,
    );
    expect(SQL_160).toMatch(/on public\.shop_pos_staff \(shop_id, user_id\)/);
    expect(SQL_160).toMatch(/where user_id is not null/);
    expect(SQL_160).toMatch(/NULL = legacy PIN-only staff/);
    expect(SQL_160).toMatch(/UUID = linked Auth identity/);
    expect(SQL_160).not.toMatch(/create unique index[\s\S]*on public\.shop_pos_staff \(user_id\)/);
    expect(SQL_160).not.toMatch(/alter table public\.shop_members/i);
    expect(SQL_160).not.toMatch(/create or replace function/i);
    expect(SQL_160).not.toMatch(/create policy/i);
    expect(SQL_160).not.toMatch(/create table[\s\S]*invitation/i);
    expect(SQL_160).not.toMatch(/sold_by_user_id/);
    expect(SQL_160).not.toMatch(/created_by/);
  });

  it("does not rewrite Phase 2 or Phase 3 migrations", () => {
    expect(SQL_158).toMatch(/shop_pos_staff[\s\S]*user_id uuid references auth\.users/);
    expect(SQL_159).toMatch(/staff_v2_observe_sold_by_user_id/);
  });

  it("D. frozen identity and sales files keep staff: actor and Phase 8 push split", () => {
    expect(CLOUD_SYNC).toMatch(/created_by: ctx\.userId/);
    expect(CLOUD_SYNC).toMatch(/sold_by_user_id: resolveSoldByAuthUserIdForPush\(sale\)/);
    expect(CLOUD_SYNC).toMatch(/soldByUserId: soldByUserIdFromCloudSaleRow\(row\)/);
    expect(SESSION_ACTOR).toMatch(/userId: `staff:\$\{params\.staffSession\.staffId\}`/);
    expect(USE_AUTH).toMatch(/await supabase\.auth\.signOut\(\)/);
    expect(MERGE).not.toMatch(/sold_by_user_id/);
  });
});

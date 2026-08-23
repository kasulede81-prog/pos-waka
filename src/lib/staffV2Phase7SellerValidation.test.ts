import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SQL_162 = readFileSync(
  resolve(ROOT, "supabase/migrations/162_staff_v2_seller_validation.sql"),
  "utf8",
);
const SQL_159 = readFileSync(
  resolve(ROOT, "supabase/migrations/159_staff_v2_sales_identity_observe_only.sql"),
  "utf8",
);
const SQL_158 = readFileSync(
  resolve(ROOT, "supabase/migrations/158_staff_v2_identity_foothold.sql"),
  "utf8",
);
const SQL_160 = readFileSync(
  resolve(ROOT, "supabase/migrations/160_staff_v2_link_constraints.sql"),
  "utf8",
);
const SQL_161 = readFileSync(
  resolve(ROOT, "supabase/migrations/161_staff_invitation_system.sql"),
  "utf8",
);
const CLOUD_SYNC = readFileSync(resolve(ROOT, "src/offline/cloudSync.ts"), "utf8");
const SESSION_ACTOR = readFileSync(resolve(ROOT, "src/lib/sessionActor.ts"), "utf8");
const USE_AUTH = readFileSync(resolve(ROOT, "src/hooks/useAuth.ts"), "utf8");
const MERGE = readFileSync(resolve(ROOT, "src/lib/saleFinancialMerge.ts"), "utf8");

describe("STAFF-V2 Phase 7 seller validation", () => {
  it("adds shop-scoped membership validator without rewriting observe helper", () => {
    expect(SQL_162).toMatch(
      /create or replace function public\.staff_v2_validate_sold_by_user_id \(\s*p_shop_id uuid,\s*p_sale jsonb,\s*p_writer_id uuid\s*\)/,
    );
    expect(SQL_162).toMatch(/inner join public\.shop_members sm/);
    expect(SQL_162).toMatch(/sm\.shop_id = p_shop_id/);
    expect(SQL_162).toMatch(/from auth\.users u/);
    expect(SQL_162).toMatch(/invalid_text_representation/);
    expect(SQL_162).not.toMatch(/create or replace function public\.staff_v2_observe_sold_by_user_id/);
    expect(SQL_159).toMatch(/create or replace function public\.staff_v2_observe_sold_by_user_id/);
  });

  it("swap push RPC call sites to validate; keep created_by and fill-once", () => {
    expect(SQL_162).toMatch(
      /v_sold_by := public\.staff_v2_validate_sold_by_user_id \(p_shop_id, v_sale, v_uid\);/,
    );
    expect(SQL_162.match(/staff_v2_validate_sold_by_user_id \(p_shop_id, v_sale, v_uid\)/g)?.length).toBe(
      2,
    );
    expect(SQL_162).not.toMatch(/staff_v2_observe_sold_by_user_id \(v_sale\)/);
    expect(SQL_162).toMatch(
      /coalesce \(nullif \(v_sale ->> 'created_by', ''\)::uuid, v_uid\)/,
    );
    expect(SQL_162).toMatch(
      /sold_by_user_id = coalesce \(public\.sales\.sold_by_user_id, excluded\.sold_by_user_id\)/,
    );
    expect(SQL_162).toMatch(/sold_by_user_id = coalesce \(sold_by_user_id, v_sold_by\)/);
    expect(SQL_162).toMatch(/validate_sale_push_financials/);
    expect(SQL_162).toMatch(/apply_sale_stock_movements/);
  });

  it("does not rewrite frozen migrations 158–161", () => {
    expect(SQL_158).toMatch(/sold_by_user_id uuid references auth\.users/);
    expect(SQL_159).toMatch(/staff_v2_observe_sold_by_user_id/);
    expect(SQL_160).toMatch(/shop_pos_staff_shop_user_id_uidx/);
    expect(SQL_161).toMatch(/shop_staff_invitations/);
  });

  it("keeps client PIN identity; Phase 8 push uses writer/seller split", () => {
    expect(CLOUD_SYNC).toMatch(/created_by: ctx\.userId/);
    expect(CLOUD_SYNC).toMatch(/sold_by_user_id: resolveSoldByAuthUserIdForPush\(sale\)/);
    expect(CLOUD_SYNC).toMatch(/soldByUserId: soldByUserIdFromCloudSaleRow\(row\)/);
    expect(SESSION_ACTOR).toMatch(/userId: `staff:\$\{params\.staffSession\.staffId\}`/);
    expect(USE_AUTH).toMatch(/await supabase\.auth\.signOut\(\)/);
    expect(MERGE).not.toMatch(/sold_by_user_id/);
  });

  it("documents Phase 8 linked-PIN deferral was server-side only in 162 (no pos_staff_id)", () => {
    expect(SQL_162).toMatch(/Phase 8/);
    expect(SQL_162).not.toMatch(/pos_staff_id/);
    expect(SQL_162).not.toMatch(/shop_pos_staff/);
  });
});

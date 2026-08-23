import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SQL_158 = readFileSync(
  resolve(ROOT, "supabase/migrations/158_staff_v2_identity_foothold.sql"),
  "utf8",
);
const CLOUD_SYNC = readFileSync(resolve(ROOT, "src/offline/cloudSync.ts"), "utf8");
const SESSION_ACTOR = readFileSync(resolve(ROOT, "src/lib/sessionActor.ts"), "utf8");
const USE_AUTH = readFileSync(resolve(ROOT, "src/hooks/useAuth.ts"), "utf8");

describe("STAFF-V2 Phase 2 identity foothold", () => {
  it("adds unused nullable Auth FKs only", () => {
    expect(SQL_158).toMatch(/shop_pos_staff[\s\S]*user_id uuid references auth\.users \(id\) on delete set null/);
    expect(SQL_158).toMatch(/sales[\s\S]*sold_by_user_id uuid references auth\.users \(id\) on delete set null/);
    expect(SQL_158).not.toMatch(/\bunique\s+(index|constraint)\b/i);
    expect(SQL_158).not.toMatch(/add constraint/i);
    expect(SQL_158).not.toMatch(/create or replace function/i);
    expect(SQL_158).not.toMatch(/create policy/i);
    expect(SQL_158).not.toMatch(/\b(drop|rename|alter)\s+column\b/i);
    expect(SQL_158).not.toMatch(/alter table public\.shop_members/i);
    expect(SQL_158).not.toMatch(/create table[\s\S]*invitation/i);
  });

  it("does not change PIN identity; pull still maps from created_by (Phase 8 updated push)", () => {
    expect(CLOUD_SYNC).toMatch(/created_by: ctx\.userId/);
    expect(CLOUD_SYNC).toMatch(/soldByUserId: soldByUserIdFromCloudSaleRow\(row\)/);
    expect(SESSION_ACTOR).toMatch(/userId: `staff:\$\{params\.staffSession\.staffId\}`/);
    expect(USE_AUTH).toMatch(/await supabase\.auth\.signOut\(\)/);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { membershipRoleForPosRole, staffAcceptReturnPath } from "./staffInvite";

const ROOT = process.cwd();
const SQL_161 = readFileSync(
  resolve(ROOT, "supabase/migrations/161_staff_invitation_system.sql"),
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
const SQL_160 = readFileSync(
  resolve(ROOT, "supabase/migrations/160_staff_v2_link_constraints.sql"),
  "utf8",
);
const CLOUD_SYNC = readFileSync(resolve(ROOT, "src/offline/cloudSync.ts"), "utf8");
const SESSION_ACTOR = readFileSync(resolve(ROOT, "src/lib/sessionActor.ts"), "utf8");
const USE_AUTH = readFileSync(resolve(ROOT, "src/hooks/useAuth.ts"), "utf8");
const MERGE = readFileSync(resolve(ROOT, "src/lib/saleFinancialMerge.ts"), "utf8");
const AUTH_CALLBACK = readFileSync(resolve(ROOT, "src/pages/AuthCallbackPage.tsx"), "utf8");
const OWNER_BOOTSTRAP = readFileSync(resolve(ROOT, "src/lib/ownerWorkspaceOnSignIn.ts"), "utf8");
const CONFIG = readFileSync(resolve(ROOT, "supabase/config.toml"), "utf8");

describe("STAFF-V2 Phase 5 invitation system", () => {
  it("adds invitation table and owner-only RPCs only", () => {
    expect(SQL_161).toMatch(/create table if not exists public\.shop_staff_invitations/);
    expect(SQL_161).toMatch(/token_hash text not null/);
    expect(SQL_161).toMatch(/membership_role <> 'owner'/);
    expect(SQL_161).toMatch(/shop_staff_invitations_pending_shop_email_uidx/);
    expect(SQL_161).toMatch(/create or replace function public\.shop_invite_staff/);
    expect(SQL_161).toMatch(/create or replace function public\.shop_accept_staff_invite/);
    expect(SQL_161).toMatch(/create or replace function public\.shop_has_pending_staff_invite_for_me/);
    expect(SQL_161).toMatch(/if not public\.user_is_shop_owner \(p_shop_id\)/);
    expect(SQL_161).toMatch(/revoke insert on table public\.shop_members from authenticated/);
    expect(SQL_161).not.toMatch(/signInStaff/);
    expect(SQL_161).not.toMatch(/sold_by_user_id/);
    expect(SQL_161).not.toMatch(/bootstrap_owner_workspace/);
  });

  it("does not rewrite frozen Staff V2 migrations", () => {
    expect(SQL_158).toMatch(/shop_pos_staff[\s\S]*user_id uuid references auth\.users/);
    expect(SQL_159).toMatch(/staff_v2_observe_sold_by_user_id/);
    expect(SQL_160).toMatch(/shop_pos_staff_shop_user_id_uidx/);
    expect(SQL_158).not.toMatch(/shop_staff_invitations/);
    expect(SQL_159).not.toMatch(/shop_staff_invitations/);
    expect(SQL_160).not.toMatch(/shop_staff_invitations/);
  });

  it("Auth callback accepts or skips before owner bootstrap", () => {
    const acceptIdx = AUTH_CALLBACK.lastIndexOf("resolveStaffInviteBeforeOwnerBootstrap(session)");
    const bootstrapIdx = AUTH_CALLBACK.lastIndexOf("ensureOwnerWorkspaceIfNeeded(session)");
    expect(acceptIdx).toBeGreaterThan(0);
    expect(bootstrapIdx).toBeGreaterThan(acceptIdx);
    expect(AUTH_CALLBACK).toMatch(/if \(!inviteGate\.skipOwnerBootstrap\)/);
    expect(OWNER_BOOTSTRAP).toMatch(/resolveStaffInviteBeforeOwnerBootstrap/);
    expect(OWNER_BOOTSTRAP).toMatch(/staff_invite_pending/);
    expect(USE_AUTH).toMatch(/resolveStaffInviteBeforeOwnerBootstrap/);
    expect(USE_AUTH).toMatch(/inviteGate\.skipOwnerBootstrap/);
  });

  it("maps POS roles without inviting owner", () => {
    expect(membershipRoleForPosRole("supervisor")).toBe("cashier");
    expect(membershipRoleForPosRole("kitchen")).toBe("waiter");
    expect(membershipRoleForPosRole("bar")).toBe("waiter");
    expect(membershipRoleForPosRole("cashier")).toBe("cashier");
    expect(membershipRoleForPosRole("owner")).toBe("cashier");
    expect(staffAcceptReturnPath("/staff/accept?token=abc")).toBe("/staff/accept?token=abc");
    expect(staffAcceptReturnPath("/onboarding")).toBeNull();
  });

  it("staff-invite edge function requires JWT", () => {
    expect(CONFIG).toMatch(/\[functions\.staff-invite\][\s\S]*verify_jwt = true/);
  });

  it("frozen identity and sales files stay on Phase 8 push rules", () => {
    expect(CLOUD_SYNC).toMatch(/created_by: ctx\.userId/);
    expect(CLOUD_SYNC).toMatch(/sold_by_user_id: resolveSoldByAuthUserIdForPush\(sale\)/);
    expect(CLOUD_SYNC).toMatch(/soldByUserId: soldByUserIdFromCloudSaleRow\(row\)/);
    expect(SESSION_ACTOR).toMatch(/staff:\$\{params\.staffSession\.staffId\}/);
    expect(USE_AUTH).toMatch(/await supabase\.auth\.signOut\(\)/);
    expect(MERGE).not.toMatch(/sold_by_user_id/);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isNonOwnerShopMemberRole } from "./staffAuthHydrate";
import { computeAccountKey } from "../offline/accountScope";

const ROOT = process.cwd();
const USE_AUTH = readFileSync(resolve(ROOT, "src/hooks/useAuth.ts"), "utf8");
const SESSION_ACTOR = readFileSync(resolve(ROOT, "src/lib/sessionActor.ts"), "utf8");
const CLOUD_SYNC = readFileSync(resolve(ROOT, "src/offline/cloudSync.ts"), "utf8");
const MERGE = readFileSync(resolve(ROOT, "src/lib/saleFinancialMerge.ts"), "utf8");
const STAFF_HYDRATE = readFileSync(resolve(ROOT, "src/lib/staffAuthHydrate.ts"), "utf8");
const ONBOARDING_GATE = readFileSync(
  resolve(ROOT, "src/components/onboarding/OnboardingRouteGate.tsx"),
  "utf8",
);
const STAFF_ACCEPT = readFileSync(resolve(ROOT, "src/pages/StaffAcceptPage.tsx"), "utf8");
const SQL_158 = readFileSync(
  resolve(ROOT, "supabase/migrations/158_staff_v2_identity_foothold.sql"),
  "utf8",
);
const SQL_161 = readFileSync(
  resolve(ROOT, "supabase/migrations/161_staff_invitation_system.sql"),
  "utf8",
);

describe("STAFF-V2 Phase 6 independent Auth staff login", () => {
  it("hydrates Auth staff after invite accept / membership without owner bootstrap", () => {
    expect(STAFF_HYDRATE).toMatch(/hydrateAccountFromCloud\(\{ forcePull: true \}\)/);
    expect(STAFF_HYDRATE).not.toMatch(/hasFirstTimeOwnerMarker/);
    expect(USE_AUTH).toMatch(/finishStaffAuthWorkspace/);
    expect(USE_AUTH).toMatch(/hydrateStaffAuthWorkspace/);
    expect(USE_AUTH).toMatch(/staff_invite_accepted/);
    expect(USE_AUTH).toMatch(/staff_member_hydrate|staff_membership_hydrate/);
    expect(STAFF_ACCEPT).toMatch(/hydrateStaffAuthWorkspace/);
    expect(ONBOARDING_GATE).toMatch(/fetchShopMemberRoleForUser/);
    expect(ONBOARDING_GATE).toMatch(/shopMemberRole !== "owner"/);
  });

  it("keeps Auth staff on their own accountKey namespace", () => {
    const owner = computeAccountKey({
      mode: "supabase",
      userId: "11111111-1111-4111-8111-111111111111",
    });
    const cashier = computeAccountKey({
      mode: "supabase",
      userId: "22222222-2222-4222-8222-222222222222",
    });
    expect(owner).toBe("sb:11111111-1111-4111-8111-111111111111");
    expect(cashier).toBe("sb:22222222-2222-4222-8222-222222222222");
    expect(owner).not.toBe(cashier);
    expect(isNonOwnerShopMemberRole("cashier")).toBe(true);
    expect(isNonOwnerShopMemberRole("owner")).toBe(false);
  });

  it("does not rewrite PIN / SessionActor; seller push uses Phase 8 writer split", () => {
    expect(USE_AUTH).toMatch(/const signInStaff = useCallback/);
    expect(USE_AUTH).toMatch(/await supabase\.auth\.signOut\(\)/);
    expect(SESSION_ACTOR).toMatch(/userId: `staff:\$\{params\.staffSession\.staffId\}`/);
    expect(CLOUD_SYNC).toMatch(/created_by: ctx\.userId/);
    expect(CLOUD_SYNC).toMatch(/sold_by_user_id: resolveSoldByAuthUserIdForPush\(sale\)/);
    expect(CLOUD_SYNC).toMatch(/soldByUserId: soldByUserIdFromCloudSaleRow\(row\)/);
    expect(MERGE).not.toMatch(/sold_by_user_id/);
    expect(SQL_158).toMatch(/shop_pos_staff[\s\S]*user_id uuid references auth\.users/);
    expect(SQL_161).toMatch(/shop_invite_staff/);
  });
});

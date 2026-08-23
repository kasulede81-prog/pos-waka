import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { StaffAccount } from "../types";
import {
  invitePosRoleForStaff,
  isLegacyPinStaffUpgradeable,
  membershipRoleForPosRole,
  staffHasPendingUpgradeInvite,
  type StaffInvitationRow,
} from "./staffInvite";
import {
  buildSalePushPayload,
  resolveSoldByAuthUserIdForPush,
} from "../offline/cloudSync";
import type { Sale } from "../types";

const ROOT = process.cwd();
const SQL_164 = readFileSync(
  resolve(ROOT, "supabase/migrations/164_staff_v2_invite_staff_id_or_client_id.sql"),
  "utf8",
);
const SQL_161 = readFileSync(
  resolve(ROOT, "supabase/migrations/161_staff_invitation_system.sql"),
  "utf8",
);
const SESSION_ACTOR = readFileSync(resolve(ROOT, "src/lib/sessionActor.ts"), "utf8");
const USE_AUTH = readFileSync(resolve(ROOT, "src/hooks/useAuth.ts"), "utf8");
const CLOUD_SYNC = readFileSync(resolve(ROOT, "src/offline/cloudSync.ts"), "utf8");
const UPGRADE_UI = readFileSync(
  resolve(ROOT, "src/components/staff/StaffLegacyUpgradeDialog.tsx"),
  "utf8",
);
const TEAM_LIST = readFileSync(resolve(ROOT, "src/components/staff/StaffTeamList.tsx"), "utf8");
const INVITE_CARD = readFileSync(
  resolve(ROOT, "src/components/staff/StaffCloudInviteCard.tsx"),
  "utf8",
);

const OWNER_UUID = "11111111-1111-4111-8111-111111111111";
const WORKER_UUID = "22222222-2222-4222-8222-222222222222";
const STAFF_CLIENT = "33333333-3333-4333-8333-333333333333";
const CTX = { shopId: "44444444-4444-4444-8444-444444444444", userId: OWNER_UUID };

function staff(partial: Partial<StaffAccount> & { id: string; name: string }): StaffAccount {
  return {
    role: "cashier",
    active: true,
    pinHash: "hash",
    linkedAuthUserId: null,
    ...partial,
  };
}

function sale(partial: Partial<Sale>): Sale {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    lines: [],
    totalUgx: 1000,
    subtotalUgx: 1000,
    cashPaidUgx: 1000,
    debtUgx: 0,
    estimatedProfitUgx: 0,
    createdAt: "2026-08-23T10:00:00.000Z",
    status: "completed",
    updatedAt: "2026-08-23T10:00:00.000Z",
    pendingSync: true,
    soldByUserId: `staff:${STAFF_CLIENT}`,
    soldByAuthUserId: WORKER_UUID,
    ...partial,
  };
}

describe("STAFF-V2 Phase 9 legacy PIN upgrade", () => {
  it("164 only patches shop_invite_staff id/client_id resolution", () => {
    expect(SQL_164).toMatch(/create or replace function public\.shop_invite_staff/);
    expect(SQL_164).toMatch(/s\.client_id = p_staff_id/);
    expect(SQL_164).toMatch(/v_resolved_staff_id := v_staff\.id/);
    expect(SQL_164).not.toMatch(/alter table/i);
    expect(SQL_164).not.toMatch(/create table/i);
    expect(SQL_164).not.toMatch(/sold_by_user_id/);
    expect(SQL_164).not.toMatch(/signInStaff/);
  });

  it("does not invent a second invitation system", () => {
    expect(SQL_161).toMatch(/shop_staff_invitations/);
    expect(SQL_164).toMatch(/shop_staff_invitations/);
    expect(UPGRADE_UI).toMatch(/sendStaffInvite/);
    expect(UPGRADE_UI).toMatch(/staffId: staff\.id/);
    expect(INVITE_CARD).toMatch(/StaffCloudInviteCard/);
    expect(TEAM_LIST).toMatch(/staffUpgradeAction/);
    expect(TEAM_LIST).toMatch(/onUpgradeToCloud/);
  });

  it("keeps frozen auth / session / seller push surfaces", () => {
    expect(SESSION_ACTOR).toMatch(/staff:\$\{/);
    expect(USE_AUTH).toMatch(/signInStaff/);
    expect(CLOUD_SYNC).toMatch(/created_by: ctx\.userId/);
    expect(SQL_164).not.toMatch(/rowToSale/);
  });

  it("isLegacyPinStaffUpgradeable only for unlinked active PIN workers", () => {
    expect(
      isLegacyPinStaffUpgradeable(
        staff({ id: STAFF_CLIENT, name: "John", linkedAuthUserId: null }),
      ),
    ).toBe(true);
    expect(
      isLegacyPinStaffUpgradeable(
        staff({ id: STAFF_CLIENT, name: "John", linkedAuthUserId: WORKER_UUID }),
      ),
    ).toBe(false);
    expect(
      isLegacyPinStaffUpgradeable(
        staff({ id: STAFF_CLIENT, name: "John", active: false }),
      ),
    ).toBe(false);
  });

  it("maps staff role onto invite roles without owner", () => {
    expect(invitePosRoleForStaff("kitchen")).toBe("kitchen");
    expect(membershipRoleForPosRole(invitePosRoleForStaff("kitchen"))).toBe("waiter");
    expect(invitePosRoleForStaff("owner")).toBe("cashier");
  });

  it("pending upgrade invite matches by email when staff_id present", () => {
    const invites: StaffInvitationRow[] = [
      {
        id: "i1",
        email: "john@waka.invalid",
        membership_role: "cashier",
        pos_role: "cashier",
        staff_id: "server-pk",
        expires_at: "2099-01-01T00:00:00.000Z",
        accepted_at: null,
        revoked_at: null,
        created_at: "2026-08-23T00:00:00.000Z",
      },
    ];
    expect(
      staffHasPendingUpgradeInvite(
        staff({ id: STAFF_CLIENT, name: "John", email: "john@waka.invalid" }),
        invites,
      ),
    ).toBe(true);
    expect(
      staffHasPendingUpgradeInvite(
        staff({ id: STAFF_CLIENT, name: "John", email: "other@waka.invalid" }),
        invites,
      ),
    ).toBe(false);
  });

  it("M5 shared terminal push: created_by stays device JWT; sold_by is linked Auth", () => {
    const payload = buildSalePushPayload(sale({}), CTX);
    expect(payload.sale.created_by).toBe(OWNER_UUID);
    expect(payload.sale.sold_by_user_id).toBe(WORKER_UUID);
    expect(resolveSoldByAuthUserIdForPush(sale({}))).toBe(WORKER_UUID);
  });
});

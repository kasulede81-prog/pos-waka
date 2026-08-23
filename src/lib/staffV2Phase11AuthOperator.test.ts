import { describe, expect, it } from "vitest";
import { actorHasPermission } from "./actorAuthorization";
import {
  commercialAuthUserIdFromActor,
  resolveSessionActor,
  type SessionActor,
} from "./sessionActor";

const OWNER_UUID = "11111111-1111-4111-8111-111111111111";
const CASHIER_UUID = "22222222-2222-4222-8222-222222222222";
const STAFF_ROW_ID = "33333333-3333-4333-8333-333333333333";

function ownerPreferences(activeStaffId?: string) {
  return {
    activeStaffId: activeStaffId ?? null,
    staffAccounts: [
      {
        id: STAFF_ROW_ID,
        name: "John",
        role: "cashier" as const,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        linkedAuthUserId: CASHIER_UUID,
      },
    ],
  };
}

describe("STAFF-V2 Phase 11a auth operator identity split", () => {
  it("A — owner normal: authRole and seller role both owner", () => {
    const actor = resolveSessionActor({
      mode: "supabase",
      user: { id: OWNER_UUID, email: "owner@waka.invalid" } as never,
      email: "owner@waka.invalid",
      shopMemberRole: "owner",
      preferences: ownerPreferences() as never,
    });
    expect(actor.authUserId).toBe(OWNER_UUID);
    expect(actor.userId).toBe(OWNER_UUID);
    expect(actor.authRole).toBe("owner");
    expect(actor.role).toBe("owner");
    expect(actor.activeStaffId).toBeNull();
  });

  it("B — owner switches John: operator stays owner, seller becomes staff", () => {
    const actor = resolveSessionActor({
      mode: "supabase",
      user: { id: OWNER_UUID, email: "owner@waka.invalid" } as never,
      email: "owner@waka.invalid",
      shopMemberRole: "owner",
      preferences: ownerPreferences(STAFF_ROW_ID) as never,
    });
    expect(actor.authUserId).toBe(OWNER_UUID);
    expect(actor.authRole).toBe("owner");
    expect(actor.userId).toBe(`staff:${STAFF_ROW_ID}`);
    expect(actor.role).toBe("cashier");
    expect(actor.activeStaffId).toBe(STAFF_ROW_ID);
  });

  it("C — seller attribution unchanged on Path S switch", () => {
    const actor = resolveSessionActor({
      mode: "supabase",
      user: { id: OWNER_UUID, email: "owner@waka.invalid" } as never,
      email: "owner@waka.invalid",
      shopMemberRole: "owner",
      preferences: ownerPreferences(STAFF_ROW_ID) as never,
    });
    expect(actor.userId).toBe(`staff:${STAFF_ROW_ID}`);
    expect(actor.linkedAuthUserId).toBe(CASHIER_UUID);
    expect(commercialAuthUserIdFromActor(actor)).toBe(CASHIER_UUID);
    expect(actor.authUserId).toBe(OWNER_UUID);
  });

  it("D — owner permissions preserved while selling as John", () => {
    const actor = resolveSessionActor({
      mode: "supabase",
      user: { id: OWNER_UUID, email: "owner@waka.invalid" } as never,
      email: "owner@waka.invalid",
      shopMemberRole: "owner",
      preferences: ownerPreferences(STAFF_ROW_ID) as never,
    });
    expect(actorHasPermission(actor, "settings.shop")).toBe(true);
    expect(actorHasPermission(actor, "reports.view")).toBe(true);
    expect(actorHasPermission(actor, "owner.dashboard")).toBe(true);
    expect(actor.role).toBe("cashier");
  });

  it("E — dedicated Auth cashier login unchanged", () => {
    const actor = resolveSessionActor({
      mode: "supabase",
      user: { id: CASHIER_UUID, email: "cashier@waka.invalid" } as never,
      email: "cashier@waka.invalid",
      shopMemberRole: "cashier",
      preferences: {} as never,
    });
    expect(actor.authUserId).toBe(CASHIER_UUID);
    expect(actor.userId).toBe(CASHIER_UUID);
    expect(actor.authRole).toBe("cashier");
    expect(actor.role).toBe("cashier");
    expect(actorHasPermission(actor, "settings.shop")).toBe(false);
  });

  it("Path L staff session: auth and seller ids align on staff prefix", () => {
    const actor = resolveSessionActor({
      mode: "supabase",
      user: null,
      email: null,
      preferences: ownerPreferences() as never,
      staffSession: {
        staffId: STAFF_ROW_ID,
        staffName: "John",
        role: "cashier",
      },
    });
    expect(actor.userId).toBe(`staff:${STAFF_ROW_ID}`);
    expect(actor.authUserId).toBe(`staff:${STAFF_ROW_ID}`);
    expect(actor.authRole).toBe("cashier");
    expect(actor.role).toBe("cashier");
  });

  it("legacy SessionActor fixtures fall back authRole to role", () => {
    const legacy = { userId: "owner-1", role: "owner" as const } satisfies Partial<SessionActor>;
    expect(actorHasPermission(legacy as SessionActor, "settings.shop")).toBe(true);
  });
});

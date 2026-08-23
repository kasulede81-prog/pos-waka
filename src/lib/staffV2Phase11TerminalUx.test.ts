import { describe, expect, it } from "vitest";
import type { StaffAccount } from "../types";
import { completePosUnlock } from "./auth/staffLockScreen";
import { applyStaffDeltaToCache } from "./staffCacheSync";
import { resolveTerminalIdentityView } from "./terminalIdentity";
import { resolveSessionActor } from "./sessionActor";
import { usePosStore } from "../store/usePosStore";

const OWNER_UUID = "11111111-1111-4111-8111-111111111111";
const CASHIER_UUID = "22222222-2222-4222-8222-222222222222";
const STAFF_JOHN = "33333333-3333-4333-8333-333333333333";

function staffPrefs(activeStaffId: string | null) {
  return {
    activeStaffId,
    staffAccounts: [
      {
        id: STAFF_JOHN,
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

function ownerActor(activeStaffId: string | null) {
  return resolveSessionActor({
    mode: "supabase",
    user: { id: OWNER_UUID, email: "owner@waka.invalid" } as never,
    email: "owner@waka.invalid",
    shopMemberRole: "owner",
    preferences: staffPrefs(activeStaffId) as never,
  });
}

describe("STAFF-V2 Phase 11d shared terminal UX", () => {
  it("A — owner only: operator and seller are the owner", () => {
    const actor = ownerActor(null);
    const view = resolveTerminalIdentityView(actor, staffPrefs(null), "Owner Name");
    expect(view.splitIdentity).toBe(false);
    expect(view.operatorAuthUserId).toBe(OWNER_UUID);
    expect(view.sellerUserId).toBe(OWNER_UUID);
    expect(view.operatorName).toBe("Owner Name");
    expect(view.sellerName).toBe("Owner Name");
  });

  it("B — owner selling as John: operator owner UUID, seller staff:john", () => {
    const actor = ownerActor(STAFF_JOHN);
    const view = resolveTerminalIdentityView(actor, staffPrefs(STAFF_JOHN), "Owner Name");
    expect(view.splitIdentity).toBe(true);
    expect(view.operatorAuthUserId).toBe(OWNER_UUID);
    expect(view.sellerUserId).toBe(`staff:${STAFF_JOHN}`);
    expect(view.sellerLinkedAuthUserId).toBe(CASHIER_UUID);
    expect(view.operatorName).toBe("Owner Name");
    expect(view.sellerName).toBe("John");
  });

  it("C — dedicated cashier login: operator and seller match", () => {
    const actor = resolveSessionActor({
      mode: "supabase",
      user: { id: CASHIER_UUID, email: "john@waka.invalid" } as never,
      email: "john@waka.invalid",
      shopMemberRole: "cashier",
      preferences: {} as never,
    });
    const view = resolveTerminalIdentityView(actor, {}, "John Cashier");
    expect(view.splitIdentity).toBe(false);
    expect(view.operatorAuthUserId).toBe(CASHIER_UUID);
    expect(view.sellerUserId).toBe(CASHIER_UUID);
    expect(view.operatorName).toBe("John Cashier");
    expect(view.sellerName).toBe("John Cashier");
  });

  it("D — lock/unlock preserves activeStaffId", () => {
    usePosStore.setState({
      _hydrated: true,
      preferences: {
        ...usePosStore.getState().preferences,
        activeStaffId: STAFF_JOHN,
        posLocked: true,
      },
    });
    const unlock = completePosUnlock(STAFF_JOHN);
    expect(unlock.ok).toBe(true);
    expect(usePosStore.getState().preferences.activeStaffId).toBe(STAFF_JOHN);
    expect(usePosStore.getState().preferences.posLocked).toBe(false);
  });

  it("E — staff cache refresh applies linkedAuthUserId", () => {
    const existing = {
      shopId: "shop-1",
      version: 1,
      downloadedAt: "2026-01-01T00:00:00.000Z",
      staff: [
        {
          id: STAFF_JOHN,
          name: "John",
          role: "cashier" as const,
          active: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          linkedAuthUserId: null,
        } satisfies StaffAccount,
      ],
    };
    const next = applyStaffDeltaToCache(existing, "shop-1", {
      unchanged: false,
      version: 2,
      changed: [
        {
          id: STAFF_JOHN,
          name: "John",
          role: "cashier",
          active: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
          linkedAuthUserId: CASHIER_UUID,
        },
      ],
      removedClientIds: [],
    });
    expect(next.staff[0]?.linkedAuthUserId).toBe(CASHIER_UUID);
  });
});

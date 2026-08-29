import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  isSharedTerminalLockOperator,
  shouldShowEnterpriseStaffLockScreen,
} from "./lockPos";
import { clearPersonalStaffTerminalRuntimeState } from "./staffAuthHydrate";
import { authOperatorRole, resolveSessionActor } from "./sessionActor";
import { usePosStore } from "../store/usePosStore";

const ROOT = resolve(import.meta.dirname, "../..");
const APP_SHELL = readFileSync(resolve(ROOT, "src/components/layout/AppShell.tsx"), "utf8");
const STAFF_ACCEPT = readFileSync(resolve(ROOT, "src/pages/StaffAcceptPage.tsx"), "utf8");
const STAFF_HYDRATE = readFileSync(resolve(ROOT, "src/lib/staffAuthHydrate.ts"), "utf8");

const OWNER_UUID = "11111111-1111-4111-8111-111111111111";
const CASHIER_UUID = "22222222-2222-4222-8222-222222222222";
const STAFF_JOHN = "33333333-3333-4333-8333-333333333333";

function johnPrefs(overrides?: { posLocked?: boolean; activeStaffId?: string | null }) {
  return {
    posLocked: overrides?.posLocked ?? false,
    activeStaffId: overrides?.activeStaffId ?? null,
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

describe("STAFF-V2 Phase 11k personal device lock hardening", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      preferences: {
        ...usePosStore.getState().preferences,
        ...johnPrefs({ posLocked: false, activeStaffId: null }),
      },
    });
  });

  it("A — invited staff email login: Path L identity, no lock screen / SellerPicker", () => {
    const actor = resolveSessionActor({
      mode: "supabase",
      user: { id: CASHIER_UUID, email: "john@waka.invalid" } as never,
      email: "john@waka.invalid",
      shopMemberRole: "cashier",
      preferences: johnPrefs({ posLocked: false, activeStaffId: null }) as never,
    });
    expect(actor.authUserId).toBe(CASHIER_UUID);
    expect(actor.authRole).toBe("cashier");
    expect(actor.userId).toBe(CASHIER_UUID);
    expect(actor.activeStaffId).toBeNull();
    expect(authOperatorRole(actor)).toBe("cashier");

    // Even if cloud left posLocked on the device, Path L never shows Choose seller.
    const polluted = resolveSessionActor({
      mode: "supabase",
      user: { id: CASHIER_UUID, email: "john@waka.invalid" } as never,
      email: "john@waka.invalid",
      shopMemberRole: "cashier",
      preferences: johnPrefs({ posLocked: true, activeStaffId: STAFF_JOHN }) as never,
    });
    expect(polluted.userId).toBe(CASHIER_UUID);
    expect(polluted.authRole).toBe("cashier");
    expect(
      shouldShowEnterpriseStaffLockScreen({
        posLocked: true,
        authOperatorRole: authOperatorRole(polluted),
        hasPathSStaffSession: false,
        pathname: "/pos/sell",
        canManageShopSettings: false,
      }),
    ).toBe(false);
    expect(isSharedTerminalLockOperator({ authOperatorRole: "cashier", hasPathSStaffSession: false })).toBe(
      false,
    );
  });

  it("B — owner terminal lock: EnterpriseStaffLockScreen shown", () => {
    expect(
      shouldShowEnterpriseStaffLockScreen({
        posLocked: true,
        authOperatorRole: "owner",
        hasPathSStaffSession: false,
        pathname: "/pos/sell",
        canManageShopSettings: true,
      }),
    ).toBe(true);
  });

  it("C — owner chooses seller: identity unchanged (staff:john)", () => {
    const actor = resolveSessionActor({
      mode: "supabase",
      user: { id: OWNER_UUID, email: "owner@waka.invalid" } as never,
      email: "owner@waka.invalid",
      shopMemberRole: "owner",
      preferences: johnPrefs({ posLocked: false, activeStaffId: STAFF_JOHN }) as never,
    });
    expect(actor.authUserId).toBe(OWNER_UUID);
    expect(actor.authRole).toBe("owner");
    expect(actor.userId).toBe(`staff:${STAFF_JOHN}`);
    expect(actor.activeStaffId).toBe(STAFF_JOHN);
  });

  it("D — staff device inherits cloud posLocked: still no PIN / seller UI", () => {
    usePosStore.setState({
      preferences: {
        ...usePosStore.getState().preferences,
        ...johnPrefs({ posLocked: true, activeStaffId: STAFF_JOHN }),
      },
    });
    clearPersonalStaffTerminalRuntimeState();
    expect(usePosStore.getState().preferences.posLocked).toBe(false);
    expect(usePosStore.getState().preferences.activeStaffId).toBeNull();

    expect(
      shouldShowEnterpriseStaffLockScreen({
        posLocked: true,
        authOperatorRole: "cashier",
        hasPathSStaffSession: false,
        pathname: "/",
        canManageShopSettings: false,
      }),
    ).toBe(false);
  });

  it("Path S staff session may still see lock screen when posLocked", () => {
    expect(
      shouldShowEnterpriseStaffLockScreen({
        posLocked: true,
        authOperatorRole: "cashier",
        hasPathSStaffSession: true,
        pathname: "/pos/sell",
        canManageShopSettings: false,
      }),
    ).toBe(true);
  });

  it("wiring — AppShell gates lock + clears personal terminal runtime; invite metadata", () => {
    expect(APP_SHELL).toMatch(/shouldShowEnterpriseStaffLockScreen/);
    expect(APP_SHELL).toMatch(/isSharedTerminalLockOperator/);
    expect(APP_SHELL).toMatch(/authMembershipRole\(actor\)/);
    expect(APP_SHELL).toMatch(/clearPersonalStaffTerminalRuntimeState/);
    expect(STAFF_HYDRATE).toMatch(/clearPersonalStaffTerminalRuntimeState\(\)/);
    expect(STAFF_ACCEPT).toMatch(/invite_type:\s*"staff"/);
    expect(STAFF_ACCEPT).not.toMatch(/pos_role:\s*"staff"/);
  });
});

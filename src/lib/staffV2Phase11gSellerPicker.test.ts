import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StaffAccount } from "../types";
import { filterActiveSellersForPicker, findSellerPickerOption } from "./staffSellerPicker";
import { completePosUnlock } from "./auth/staffLockScreen";
import { resolveSessionActor } from "./sessionActor";
import { usePosStore } from "../store/usePosStore";
import { t } from "./i18n";

const ROOT = process.cwd();
const LOGIN_PANEL = readFileSync(resolve(ROOT, "src/components/auth/EnterpriseStaffLoginPanel.tsx"), "utf8");
const LOCK = readFileSync(resolve(ROOT, "src/components/auth/EnterpriseStaffLockScreen.tsx"), "utf8");
const PICKER = readFileSync(resolve(ROOT, "src/components/auth/SellerPicker.tsx"), "utf8");
const SESSION_ACTOR = readFileSync(resolve(ROOT, "src/lib/sessionActor.ts"), "utf8");

const OWNER_UUID = "11111111-1111-4111-8111-111111111111";
const JOHN_AUTH = "22222222-2222-4222-8222-222222222222";
const MARY_AUTH = "44444444-4444-4444-8444-444444444444";
const STAFF_JOHN = "33333333-3333-4333-8333-333333333333";
const STAFF_MARY = "55555555-5555-4555-8555-555555555555";
const STAFF_INACTIVE = "66666666-6666-4666-8666-666666666666";

function staff(partial: Partial<StaffAccount> & Pick<StaffAccount, "id" | "name" | "role">): StaffAccount {
  return {
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const DIRECTORY = [
  staff({ id: STAFF_JOHN, name: "John", role: "cashier", linkedAuthUserId: JOHN_AUTH }),
  staff({ id: STAFF_MARY, name: "Mary", role: "cashier", linkedAuthUserId: MARY_AUTH }),
  staff({ id: STAFF_INACTIVE, name: "Ghost", role: "cashier", active: false }),
];

describe("STAFF-V2 Phase 11g shared terminal seller picker", () => {
  it("G1 — staff list shows active John and Mary only", () => {
    const sellers = filterActiveSellersForPicker(DIRECTORY);
    expect(sellers.map((s) => s.name)).toEqual(["John", "Mary"]);
    expect(sellers.find((s) => s.name === "Ghost")).toBeUndefined();
  });

  it("G2 — seller name free-text input does not exist on login panel", () => {
    expect(LOGIN_PANEL).toMatch(/SellerPicker/);
    expect(LOGIN_PANEL).toMatch(/selectedStaffId/);
    expect(LOGIN_PANEL).not.toMatch(/staffLoginNamePh/);
    expect(LOGIN_PANEL).not.toMatch(/placeholder=\{t\(lang, "staffLoginName/);
    expect(PICKER).toMatch(/data-testid="seller-picker"/);
    expect(t("en", "sellerPickerEmpty").toLowerCase()).toContain("no sellers");
  });

  it("G3 — selecting John sets selectedStaffId to john", () => {
    const sellers = filterActiveSellersForPicker(DIRECTORY);
    const john = findSellerPickerOption(sellers, STAFF_JOHN);
    expect(john?.id).toBe(STAFF_JOHN);
    expect(john?.name).toBe("John");
  });

  it("G4 — John PIN unlock sets activeStaffId to John", () => {
    usePosStore.setState((s) => ({
      ...s,
      preferences: {
        ...s.preferences,
        activeStaffId: null,
        staffAccounts: DIRECTORY,
      },
    }));
    const unlock = completePosUnlock(STAFF_JOHN);
    expect(unlock).toEqual({ ok: true });
    expect(usePosStore.getState().preferences.activeStaffId).toBe(STAFF_JOHN);
  });

  it("G5 — owner authUserId remains owner after seller switch", () => {
    usePosStore.setState((s) => ({
      ...s,
      preferences: {
        ...s.preferences,
        activeStaffId: STAFF_JOHN,
        staffAccounts: DIRECTORY,
      },
    }));
    const actor = resolveSessionActor({
      mode: "supabase",
      user: { id: OWNER_UUID, email: "owner@waka.invalid" } as never,
      email: "owner@waka.invalid",
      shopMemberRole: "owner",
      preferences: usePosStore.getState().preferences,
    });
    expect(actor.authUserId).toBe(OWNER_UUID);
    expect(actor.authRole).toBe("owner");
    expect(actor.userId).toBe(`staff:${STAFF_JOHN}`);
    expect(actor.role).toBe("cashier");
    expect(actor.linkedAuthUserId).toBe(JOHN_AUTH);
    expect(SESSION_ACTOR).toMatch(/authUserId: baseUserId/);
  });

  it("G6 — switch seller John → Mary without new account login", () => {
    usePosStore.setState((s) => ({
      ...s,
      preferences: {
        ...s.preferences,
        activeStaffId: STAFF_JOHN,
        staffAccounts: DIRECTORY,
      },
    }));
    expect(completePosUnlock(STAFF_MARY)).toEqual({ ok: true });
    expect(usePosStore.getState().preferences.activeStaffId).toBe(STAFF_MARY);

    const actor = resolveSessionActor({
      mode: "supabase",
      user: { id: OWNER_UUID, email: "owner@waka.invalid" } as never,
      email: "owner@waka.invalid",
      shopMemberRole: "owner",
      preferences: usePosStore.getState().preferences,
    });
    expect(actor.userId).toBe(`staff:${STAFF_MARY}`);
    expect(actor.authUserId).toBe(OWNER_UUID);
    expect(LOCK).toMatch(/SellerPicker/);
    expect(LOCK).not.toMatch(/<select/);
    expect(LOGIN_PANEL).toMatch(/identifier: selectedSeller\.id/);
  });
});

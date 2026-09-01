import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SessionActor } from "./sessionActor";
import { hasEffectivePermission, type RemoteSubscriptionRow, type SubscriptionSnapshot } from "./subscriptionEntitlements";
import { authorizePreferencesPatch } from "./settingsAuthorization";
import {
  SETTINGS_CAPABILITIES,
  canAccessSettingsCapability,
  capabilityForSettingsPath,
  resolveSettingsCapabilityDenialTarget,
  type SettingsCapabilityId,
} from "./settingsCapabilityMatrix";

function actor(role: SessionActor["role"]): SessionActor {
  return { userId: "user-1", role, displayName: "Test" };
}

function remote(
  row: Partial<RemoteSubscriptionRow> & Pick<RemoteSubscriptionRow, "plan_code" | "status">,
): SubscriptionSnapshot {
  return {
    kind: "remote",
    row: {
      id: "1",
      organization_id: "o1",
      shop_id: "s1",
      trial_ends_at: null,
      current_period_start: null,
      current_period_end: null,
      max_pos_users: null,
      max_shops: null,
      max_devices: null,
      ...row,
    } as RemoteSubscriptionRow,
  };
}

const FREE = remote({ plan_code: "free", status: "active" });
const STARTER = remote({ plan_code: "starter", status: "active" });
const BUSINESS = remote({ plan_code: "business", status: "active" });

const HUB_ROUTE_CAPS: SettingsCapabilityId[] = [
  "shop_profile",
  "staff",
  "receipt",
  "selling",
  "pin",
  "password",
  "biometric",
  "cash_drawer",
  "appearance",
  "notifications",
  "devices",
  "home_menu",
  "office_menu",
  "shelves",
  "health",
  "retention",
];

describe("SETTINGS-P0-TIER-ROUTE-GATES capability matrix", () => {
  it("T1 Free owner can see and open free shop profile settings", () => {
    const owner = actor("owner");
    expect(canAccessSettingsCapability(owner, "shop_profile", FREE, "supabase")).toBe(true);
    expect(canAccessSettingsCapability(owner, "pin", FREE, "supabase")).toBe(true);
    expect(canAccessSettingsCapability(owner, "receipt", FREE, "supabase")).toBe(true);
    expect(resolveSettingsCapabilityDenialTarget(owner, "shop_profile", FREE, "supabase")).toBeNull();
    expect(resolveSettingsCapabilityDenialTarget(owner, "pin", FREE, "supabase")).toBeNull();
  });

  it("T2 Starter owner can access Starter-entitled settings", () => {
    const owner = actor("owner");
    expect(canAccessSettingsCapability(owner, "shop_profile", STARTER, "supabase")).toBe(true);
    expect(canAccessSettingsCapability(owner, "staff", STARTER, "supabase")).toBe(true);
    expect(canAccessSettingsCapability(owner, "backup", STARTER, "supabase")).toBe(true);
    expect(canAccessSettingsCapability(owner, "pin", STARTER, "supabase")).toBe(true);
    expect(resolveSettingsCapabilityDenialTarget(owner, "staff", STARTER, "supabase")).toBeNull();
    expect(resolveSettingsCapabilityDenialTarget(owner, "backup", STARTER, "supabase")).toBeNull();
  });

  it("T3 Free owner cannot access Business-only settings", () => {
    const owner = actor("owner");
    expect(canAccessSettingsCapability(owner, "selling", FREE, "supabase")).toBe(false);
    expect(canAccessSettingsCapability(owner, "staff", FREE, "supabase")).toBe(false);
    expect(canAccessSettingsCapability(owner, "backup", FREE, "supabase")).toBe(false);
    expect(canAccessSettingsCapability(owner, "retention", FREE, "supabase")).toBe(false);
    expect(canAccessSettingsCapability(owner, "health", FREE, "supabase")).toBe(false);
    expect(canAccessSettingsCapability(owner, "home_menu", FREE, "supabase")).toBe(false);
    expect(resolveSettingsCapabilityDenialTarget(owner, "selling", FREE, "supabase")).toBe("/upgrade");
    expect(resolveSettingsCapabilityDenialTarget(owner, "staff", FREE, "supabase")).toBe("/upgrade");
  });

  it("T4 Starter owner cannot access Business-only settings", () => {
    const owner = actor("owner");
    expect(canAccessSettingsCapability(owner, "selling", STARTER, "supabase")).toBe(false);
    expect(canAccessSettingsCapability(owner, "retention", STARTER, "supabase")).toBe(false);
    expect(canAccessSettingsCapability(owner, "health", STARTER, "supabase")).toBe(false);
    expect(canAccessSettingsCapability(owner, "shelves", STARTER, "supabase")).toBe(false);
    expect(canAccessSettingsCapability(owner, "finance_diagnostics", STARTER, "supabase")).toBe(false);
    expect(resolveSettingsCapabilityDenialTarget(owner, "selling", STARTER, "supabase")).toBe("/upgrade");
    expect(canAccessSettingsCapability(owner, "selling", BUSINESS, "supabase")).toBe(true);
  });

  it("T5 Visible hub item: route does not redirect to upgrade incorrectly", () => {
    const owner = actor("owner");
    for (const id of HUB_ROUTE_CAPS) {
      if (!canAccessSettingsCapability(owner, id, FREE, "supabase")) continue;
      expect(
        resolveSettingsCapabilityDenialTarget(owner, id, FREE, "supabase"),
        `${id} visible on free but denied`,
      ).toBeNull();
    }
    for (const id of HUB_ROUTE_CAPS) {
      if (!canAccessSettingsCapability(owner, id, STARTER, "supabase")) continue;
      expect(resolveSettingsCapabilityDenialTarget(owner, id, STARTER, "supabase")).toBeNull();
    }
  });

  it("T6 Hidden feature: direct URL remains protected", () => {
    const owner = actor("owner");
    expect(capabilityForSettingsPath("/settings/selling")).toBe("selling");
    expect(capabilityForSettingsPath("/staff-center/team")).toBe("staff");
    expect(resolveSettingsCapabilityDenialTarget(owner, "selling", FREE, "supabase")).toBe("/upgrade");
    expect(resolveSettingsCapabilityDenialTarget(owner, "retention", STARTER, "supabase")).toBe("/upgrade");
    expect(resolveSettingsCapabilityDenialTarget(owner, "staff", FREE, "supabase")).toBe("/upgrade");
  });

  it("T7 Preference mutation: allowed user can save allowed settings", () => {
    const owner = actor("owner");
    expect(
      authorizePreferencesPatch(owner, { shopDisplayName: "Kira Shop", shopPhoneE164: "+256700000000" }, {
        snapshot: FREE,
        authMode: "supabase",
      }).ok,
    ).toBe(true);
    expect(
      authorizePreferencesPatch(owner, { backOfficePin: "1234" }, { snapshot: FREE, authMode: "supabase" }).ok,
    ).toBe(true);
    expect(
      authorizePreferencesPatch(
        owner,
        { staffAccounts: [{ id: "s1", name: "Ann", role: "cashier", pinHash: "x", active: true }] as never },
        { snapshot: STARTER, authMode: "supabase", currentStaffAccounts: [] },
      ).ok,
    ).toBe(true);
  });

  it("T8 Unauthorized mutation: Business-only preference remains blocked", () => {
    const owner = actor("owner");
    expect(
      authorizePreferencesPatch(owner, { discountControlMode: "max_percent" }, {
        snapshot: FREE,
        authMode: "supabase",
      }),
    ).toEqual({ ok: false, errorKey: "forbidden" });
    expect(
      authorizePreferencesPatch(owner, { dataRetentionPolicy: { mode: "keep_forever" } as never }, {
        snapshot: STARTER,
        authMode: "supabase",
      }),
    ).toEqual({ ok: false, errorKey: "forbidden" });
    expect(
      authorizePreferencesPatch(owner, { catalogHierarchyEnabled: true }, {
        snapshot: STARTER,
        authMode: "supabase",
      }),
    ).toEqual({ ok: false, errorKey: "forbidden" });
    expect(
      authorizePreferencesPatch(owner, { discountControlMode: "max_percent" }, {
        snapshot: BUSINESS,
        authMode: "supabase",
      }).ok,
    ).toBe(true);
  });

  it("T9 Role boundary: manager cannot access owner-only settings", () => {
    const manager = actor("manager");
    expect(canAccessSettingsCapability(manager, "shop_profile", BUSINESS, "supabase")).toBe(false);
    expect(canAccessSettingsCapability(manager, "staff", BUSINESS, "supabase")).toBe(false);
    expect(canAccessSettingsCapability(manager, "pin", BUSINESS, "supabase")).toBe(false);
    expect(canAccessSettingsCapability(manager, "biometric", BUSINESS, "supabase")).toBe(false);
    expect(canAccessSettingsCapability(manager, "selling", BUSINESS, "supabase")).toBe(false);
    expect(resolveSettingsCapabilityDenialTarget(manager, "shop_profile", BUSINESS, "supabase")).toBe("/settings");
    expect(canAccessSettingsCapability(manager, "receipt", BUSINESS, "supabase")).toBe(true);
    expect(canAccessSettingsCapability(manager, "appearance", FREE, "supabase")).toBe(true);
    expect(
      authorizePreferencesPatch(manager, { shopDisplayName: "Nope" }, { snapshot: BUSINESS, authMode: "supabase" }),
    ).toEqual({ ok: false, errorKey: "forbidden" });
    expect(
      authorizePreferencesPatch(manager, { receiptCustomHeaderText: "Hi" }, {
        snapshot: FREE,
        authMode: "supabase",
      }).ok,
    ).toBe(true);
  });

  it("T10 generic settings.shop permission-effective API remains Business-plus", () => {
    expect(hasEffectivePermission("owner", "settings.shop", FREE, "supabase")).toBe(false);
    expect(hasEffectivePermission("owner", "settings.shop", STARTER, "supabase")).toBe(false);
    expect(hasEffectivePermission("owner", "settings.shop", BUSINESS, "supabase")).toBe(true);
  });

  it("hub visibility source matches route capability lookup", () => {
    expect(capabilityForSettingsPath("/settings/shop")).toBe("shop_profile");
    expect(capabilityForSettingsPath("/settings/receipt")).toBe("receipt");
    expect(capabilityForSettingsPath("/staff-center")).toBe("staff");
    expect(SETTINGS_CAPABILITIES.shop_profile.entitlement).toBe("free");
    expect(SETTINGS_CAPABILITIES.staff.entitlement).toBe("staff");
    expect(SETTINGS_CAPABILITIES.backup.entitlement).toBe("backup");
    expect(SETTINGS_CAPABILITIES.selling.entitlement).toBe("business");
  });

  it("App.tsx Settings routes declare the same capability as the matrix", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../App.tsx"), "utf8");
    const expected: Array<[string, SettingsCapabilityId]> = [
      ["staff-center", "staff"],
      ["settings/shop", "shop_profile"],
      ["settings/receipt", "receipt"],
      ["settings/selling", "selling"],
      ["settings/pin", "pin"],
      ["settings/password", "password"],
      ["settings/biometric", "biometric"],
      ["settings/health", "health"],
      ["settings/retention", "retention"],
      ["settings/home-menu", "home_menu"],
      ["settings/cash-drawer", "cash_drawer"],
    ];
    for (const [path, cap] of expected) {
      const start = src.indexOf(`path="${path}"`);
      expect(start, path).toBeGreaterThan(-1);
      const slice = src.slice(start, start + 420);
      expect(slice, path).toContain(`capability="${cap}"`);
    }
    const receipt = src.slice(src.indexOf('path="settings/receipt"'), src.indexOf('path="settings/receipt"') + 420);
    expect(receipt).toContain('permission="settings.receipt"');
  });
});

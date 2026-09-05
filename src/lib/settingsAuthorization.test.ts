import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach } from "vitest";
import { usePosStore } from "../store/usePosStore";
import type { SessionActor } from "./sessionActor";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import {
  authorizePreferencesPatch,
  canPersistCatalogShelfPreferences,
  canPersistInventoryArchivePreferences,
  canPersistInventoryProductTagsPreferences,
  requiredPermissionsForPreferencesPatch,
} from "./settingsAuthorization";

function actor(role: SessionActor["role"]): SessionActor {
  return { userId: "user-1", role, displayName: "Test" };
}

describe("settingsAuthorization — permission map", () => {
  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
  });
  it("operational keys require no permission", () => {
    expect(requiredPermissionsForPreferencesPatch({ favoriteProductIds: ["p1"] })).toEqual([]);
    expect(requiredPermissionsForPreferencesPatch({ posLocked: true })).toEqual([]);
    expect(authorizePreferencesPatch(actor("cashier"), { favoriteProductIds: ["p1"] }).ok).toBe(true);
  });

  it("shop settings require settings.shop", () => {
    expect(requiredPermissionsForPreferencesPatch({ backOfficePin: "1234" })).toEqual(["settings.shop"]);
    expect(requiredPermissionsForPreferencesPatch({ shopDisplayName: "My Shop" })).toEqual(["settings.shop"]);
    expect(authorizePreferencesPatch(actor("owner"), { shopDisplayName: "My Shop" }).ok).toBe(true);
    expect(authorizePreferencesPatch(actor("manager"), { shopDisplayName: "My Shop" }).ok).toBe(false);
    expect(authorizePreferencesPatch(actor("cashier"), { backOfficePin: "1234" }).ok).toBe(false);
  });

  it("biometric setting is owner-only", () => {
    expect(authorizePreferencesPatch(actor("owner"), { biometricAuthEnabled: true }).ok).toBe(true);
    expect(authorizePreferencesPatch(actor("manager"), { biometricAuthEnabled: true })).toEqual({
      ok: false,
      errorKey: "forbidden",
    });
  });

  it("receipt settings require settings.receipt", () => {
    expect(requiredPermissionsForPreferencesPatch({ receiptCustomHeaderText: "Hello" })).toEqual([
      "settings.receipt",
    ]);
    expect(authorizePreferencesPatch(actor("manager"), { receiptCustomHeaderText: "Hello" }).ok).toBe(true);
    expect(authorizePreferencesPatch(actor("cashier"), { receiptCustomHeaderText: "Hello" }).ok).toBe(false);
  });

  it("device settings require settings.devices", () => {
    expect(requiredPermissionsForPreferencesPatch({ receiptPaperSize: "80mm" })).toEqual(["settings.devices"]);
    expect(requiredPermissionsForPreferencesPatch({ hospitalityHardware: undefined })).toEqual(["settings.devices"]);
    expect(authorizePreferencesPatch(actor("owner"), { receiptPaperSize: "80mm" }).ok).toBe(true);
    expect(authorizePreferencesPatch(actor("manager"), { receiptPaperSize: "80mm" }).ok).toBe(false);
    expect(authorizePreferencesPatch(actor("supervisor"), { hospitalityHardware: undefined }).ok).toBe(false);
  });

  it("shelf customization requires settings.shop", () => {
    expect(requiredPermissionsForPreferencesPatch({ posPinnedShelfKeys: ["cat:General"] })).toEqual([
      "settings.shop",
    ]);
    expect(requiredPermissionsForPreferencesPatch({ catalogHierarchyEnabled: true })).toEqual(["settings.shop"]);
    expect(requiredPermissionsForPreferencesPatch({ posCatalogNodes: [] })).toEqual(["settings.shop"]);
    expect(authorizePreferencesPatch(actor("owner"), { posPinnedShelfKeys: ["cat:General"] }).ok).toBe(true);
    expect(authorizePreferencesPatch(actor("manager"), { posPinnedShelfKeys: ["cat:General"] }).ok).toBe(false);
  });

  it("INV-NEW-05 — inventory archive persist matches setPreferences (settings.shop)", () => {
    const ctx = { snapshot: { kind: "local_full" as const }, authMode: "local" as const };
    expect(requiredPermissionsForPreferencesPatch({ inventoryArchivedProductIds: ["p1"] })).toEqual([
      "settings.shop",
    ]);
    expect(canPersistInventoryArchivePreferences(actor("owner"), ctx)).toBe(true);
    expect(canPersistInventoryArchivePreferences(actor("manager"), ctx)).toBe(false);
    expect(canPersistInventoryArchivePreferences(actor("stock_keeper"), ctx)).toBe(false);
    expect(canPersistInventoryArchivePreferences(actor("cashier"), ctx)).toBe(false);
    expect(authorizePreferencesPatch(actor("manager"), { inventoryArchivedProductIds: ["p1"] }).ok).toBe(false);
    expect(authorizePreferencesPatch(actor("owner"), { inventoryArchivedProductIds: ["p1"] }).ok).toBe(true);
  });

  it("INV-POST-01 — inventory product tags persist matches setPreferences (settings.shop)", () => {
    const ctx = { snapshot: { kind: "local_full" as const }, authMode: "local" as const };
    expect(requiredPermissionsForPreferencesPatch({ inventoryProductTags: {} })).toEqual(["settings.shop"]);
    expect(canPersistInventoryProductTagsPreferences(actor("owner"), ctx)).toBe(true);
    expect(canPersistInventoryProductTagsPreferences(actor("manager"), ctx)).toBe(false);
    expect(canPersistInventoryProductTagsPreferences(actor("stock_keeper"), ctx)).toBe(false);
    expect(canPersistInventoryProductTagsPreferences(actor("cashier"), ctx)).toBe(false);
    expect(authorizePreferencesPatch(actor("manager"), { inventoryProductTags: {} }).ok).toBe(false);
    expect(authorizePreferencesPatch(actor("owner"), { inventoryProductTags: {} }).ok).toBe(true);
  });

  it("create CatalogNode persist matches createCatalogShelf gates", () => {
    const ctx = { snapshot: { kind: "local_full" as const }, authMode: "local" as const };
    expect(canPersistCatalogShelfPreferences(actor("owner"), ctx)).toBe(true);
    expect(canPersistCatalogShelfPreferences(actor("manager"), ctx)).toBe(false);
    expect(canPersistCatalogShelfPreferences(actor("stock_keeper"), ctx)).toBe(false);
    expect(canPersistCatalogShelfPreferences(actor("cashier"), ctx)).toBe(false);
  });

  it("cash drawer settings require day.open_drawer (not Business shop tier)", () => {
    expect(requiredPermissionsForPreferencesPatch({ cashDrawerFormulaVersion: "v2" })).toEqual([
      "day.open_drawer",
    ]);
    expect(requiredPermissionsForPreferencesPatch({ cashVarianceThresholdPct: 5 })).toEqual(["day.open_drawer"]);
    expect(
      authorizePreferencesPatch(actor("owner"), { ownerDayOpenCorrectionAfterSales: true }).ok,
    ).toBe(true);
    expect(authorizePreferencesPatch(actor("manager"), { cashDrawerFormulaVersion: "v2" }).ok).toBe(true);
    expect(authorizePreferencesPatch(actor("supervisor"), { cashVarianceThresholdPct: 8 }).ok).toBe(true);
    expect(authorizePreferencesPatch(actor("cashier"), { cashDrawerFormulaVersion: "v2" }).ok).toBe(false);
    expect(authorizePreferencesPatch(actor("manager"), { ownerDayOpenCorrectionAfterSales: true }).ok).toBe(false);
  });

  it("owner on free plan can save cash drawer settings", () => {
    setStoreSubscriptionContext({
      snapshot: { kind: "remote", row: { plan_code: "free", status: "active" } as never },
      authMode: "supabase",
    });
    expect(
      authorizePreferencesPatch(actor("owner"), {
        cashDrawerFormulaVersion: "v2",
        ownerDayOpenCorrectionAfterSales: true,
      }).ok,
    ).toBe(true);
  });

  it("denies when actor is null", () => {
    expect(authorizePreferencesPatch(null, { shopDisplayName: "X" })).toEqual({
      ok: false,
      errorKey: "noSelection",
    });
  });
});

describe("usePosStore — setPreferences authorization", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: actor("cashier"),
      preferences: usePosStore.getState().preferences,
      auditLogs: [],
    });
  });

  it("cashier cannot mutate shop settings", () => {
    const before = usePosStore.getState().preferences.shopDisplayName;
    usePosStore.getState().setPreferences({ shopDisplayName: "Hacked Shop" });
    expect(usePosStore.getState().preferences.shopDisplayName).toBe(before);
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "auth_forbidden")).toBe(true);
  });

  it("silent setPreferences skips auth_forbidden audit", () => {
    const before = usePosStore.getState().auditLogs.length;
    usePosStore.getState().setPreferences({ shopDisplayName: "Silent Hack" }, { silent: true });
    expect(usePosStore.getState().preferences.shopDisplayName).not.toBe("Silent Hack");
    expect(usePosStore.getState().auditLogs.length).toBe(before);
  });

  it("cashier can mutate operational favorites", () => {
    usePosStore.getState().setPreferences({ favoriteProductIds: ["prod-a"] });
    expect(usePosStore.getState().preferences.favoriteProductIds).toEqual(["prod-a"]);
  });

  it("owner can mutate shop settings", () => {
    usePosStore.setState({ sessionActor: actor("owner") });
    usePosStore.getState().setPreferences({ shopDisplayName: "Owner Shop" });
    expect(usePosStore.getState().preferences.shopDisplayName).toBe("Owner Shop");
  });

  it("owner cannot enable biometric without back office PIN", () => {
    usePosStore.setState({
      sessionActor: actor("owner"),
      preferences: { ...usePosStore.getState().preferences, backOfficePin: "", biometricAuthEnabled: false },
    });
    usePosStore.getState().setPreferences({ biometricAuthEnabled: true });
    expect(usePosStore.getState().preferences.biometricAuthEnabled).not.toBe(true);
  });

  it("removing the shop PIN also turns biometric off", () => {
    usePosStore.setState({
      sessionActor: actor("owner"),
      preferences: {
        ...usePosStore.getState().preferences,
        backOfficePin: "argon2id:testhash",
        biometricAuthEnabled: true,
      },
    });
    usePosStore.getState().setPreferences({ backOfficePin: null });
    expect(usePosStore.getState().preferences.backOfficePin).toBeNull();
    expect(usePosStore.getState().preferences.biometricAuthEnabled).toBe(false);
  });

  it("manager can mutate receipt settings", () => {
    usePosStore.setState({ sessionActor: actor("manager") });
    usePosStore.getState().setPreferences({ receiptCustomHeaderText: "Manager header" });
    expect(usePosStore.getState().preferences.receiptCustomHeaderText).toBe("Manager header");
  });
});

describe("shop PIN setup route", () => {
  it("does not wrap /settings/pin in SettingsChangeGate", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../App.tsx"), "utf8");
    const start = src.indexOf('path="settings/pin"');
    const end = src.indexOf('path="settings/biometric"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(src.slice(start, end)).not.toContain("SettingsChangeGate");
  });
});

describe("receipt settings route", () => {
  it("gates /settings/receipt on settings.receipt (not owner-only settings.shop)", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../App.tsx"), "utf8");
    const start = src.indexOf('path="settings/receipt"');
    const end = src.indexOf('path="settings/selling"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const slice = src.slice(start, end);
    expect(slice).toContain('permission="settings.receipt"');
    expect(slice).not.toContain('permission="settings.shop"');
    expect(slice).toContain("SettingsChangeGate");
  });
});

describe("hardware settings route", () => {
  it("keeps /office/hardware on settings.view (view, not mutate)", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../App.tsx"), "utf8");
    const start = src.indexOf('path="office/hardware"');
    const end = src.indexOf('path="office/vision"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const slice = src.slice(start, end);
    expect(slice).toContain('permission="settings.view"');
    expect(slice).not.toContain('permission="settings.devices"');
    expect(slice).not.toContain('permission="settings.shop"');
  });
});

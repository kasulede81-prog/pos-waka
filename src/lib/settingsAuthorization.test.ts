import { describe, expect, it, beforeEach } from "vitest";
import { usePosStore } from "../store/usePosStore";
import type { SessionActor } from "./sessionActor";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import {
  authorizePreferencesPatch,
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
    expect(authorizePreferencesPatch(actor("owner"), { receiptPaperSize: "80mm" }).ok).toBe(true);
    expect(authorizePreferencesPatch(actor("manager"), { receiptPaperSize: "80mm" }).ok).toBe(false);
  });

  it("shelf customization requires settings.shop", () => {
    expect(requiredPermissionsForPreferencesPatch({ posPinnedShelfKeys: ["cat:General"] })).toEqual([
      "settings.shop",
    ]);
    expect(authorizePreferencesPatch(actor("owner"), { posPinnedShelfKeys: ["cat:General"] }).ok).toBe(true);
    expect(authorizePreferencesPatch(actor("manager"), { posPinnedShelfKeys: ["cat:General"] }).ok).toBe(false);
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

  it("cashier can mutate operational favorites", () => {
    usePosStore.getState().setPreferences({ favoriteProductIds: ["prod-a"] });
    expect(usePosStore.getState().preferences.favoriteProductIds).toEqual(["prod-a"]);
  });

  it("owner can mutate shop settings", () => {
    usePosStore.setState({ sessionActor: actor("owner") });
    usePosStore.getState().setPreferences({ shopDisplayName: "Owner Shop" });
    expect(usePosStore.getState().preferences.shopDisplayName).toBe("Owner Shop");
  });

  it("manager can mutate receipt settings", () => {
    usePosStore.setState({ sessionActor: actor("manager") });
    usePosStore.getState().setPreferences({ receiptCustomHeaderText: "Manager header" });
    expect(usePosStore.getState().preferences.receiptCustomHeaderText).toBe("Manager header");
  });
});

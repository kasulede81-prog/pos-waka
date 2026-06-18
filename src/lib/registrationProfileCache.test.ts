import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachePendingRegistrationProfile,
  clearPendingRegistrationProfile,
  readPendingRegistrationProfileForUser,
} from "./registrationProfileCache";
import { usePosStore } from "../store/usePosStore";
import { createDefaultPreferences } from "../data/defaultSeed";
import { readCachedOwnerOnboardingComplete } from "./ownerOnboarding";
import { isWorkspaceBootstrapped } from "./workspaceBootstrapCache";

/** Mirror of usePosStore bootstrap helper — regression guard for signup profile wipe. */
function preferencesForAccountBootstrap(key: string) {
  const preferences = createDefaultPreferences();
  const userId = key.startsWith("sb:") ? key.slice(3) : null;
  const pending = userId ? readPendingRegistrationProfileForUser(userId) : null;
  const existing = usePosStore.getState().preferences;

  const shopDisplayName = pending?.shopDisplayName?.trim() || existing.shopDisplayName?.trim() || null;
  if (shopDisplayName) preferences.shopDisplayName = shopDisplayName;

  const shopPhone = pending?.phoneE164 ?? existing.shopPhoneE164 ?? null;
  if (shopPhone) preferences.shopPhoneE164 = shopPhone;

  if (userId && (isWorkspaceBootstrapped(userId) || readCachedOwnerOnboardingComplete(userId) === true)) {
    preferences.onboardingDone = true;
    preferences.onboardingWizardDone = true;
    preferences.schemaVersion = 2;
  }
  return preferences;
}

describe("registration profile bootstrap", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
    });
    clearPendingRegistrationProfile();
    usePosStore.getState().resetForSignOut();
  });

  it("preserves signup shop name through empty disk bootstrap", () => {
    cachePendingRegistrationProfile(
      {
        shopDisplayName: "Kampala Mini Mart",
        ownerFullName: "Jane Doe",
        phoneE164: "+256700000001",
        districtId: "district-kla",
      },
      "user-abc",
    );

    const prefs = preferencesForAccountBootstrap("sb:user-abc");
    expect(prefs.shopDisplayName).toBe("Kampala Mini Mart");
    expect(prefs.shopPhoneE164).toBe("+256700000001");
    expect(prefs.onboardingDone).toBe(false);
  });
});

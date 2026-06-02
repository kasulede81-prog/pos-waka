import { beforeEach, describe, expect, it } from "vitest";
import { persistOnboardingChoices } from "./shopOnboardingPersist";
import { usePosStore } from "../store/usePosStore";

describe("persistOnboardingChoices", () => {
  beforeEach(() => {
    (globalThis as { window?: { dispatchEvent: (event: Event) => void } }).window = {
      dispatchEvent: () => undefined,
    };
    usePosStore.setState({
      preferences: {
        ...usePosStore.getState().preferences,
        shopDisplayName: "My Shop",
        shopPhoneE164: "",
      },
    });
  });

  it("completes local onboarding without cloud-required phone", async () => {
    await expect(
      persistOnboardingChoices({
        shopName: "Local Shop",
        businessType: "kiosk_duka",
        sellingStyle: "piece",
        phone: "",
        districtId: "district-kla",
        gpsSkipped: true,
      }),
    ).resolves.toBeUndefined();

    const prefs = usePosStore.getState().preferences;
    expect(prefs.shopDisplayName).toBe("Local Shop");
    expect(usePosStore.getState().preferences.onboardingWizardDone).toBe(true);
  });
});

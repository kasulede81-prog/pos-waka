import type { BusinessType, ShopSellingStyle } from "../types";
import { saveBusinessProfileToCloud } from "./businessProfile";
import { usePosStore } from "../store/usePosStore";

export async function persistOnboardingChoices(input: {
  shopName: string;
  businessType: BusinessType;
  sellingStyle: ShopSellingStyle;
  phone?: string;
  latitude?: number;
  longitude?: number;
  gpsSkipped: boolean;
}): Promise<void> {
  const store = usePosStore.getState();
  store.completeShopOnboardingWizard({
    businessType: input.businessType,
    sellingStyle: input.sellingStyle,
    latitude: input.latitude,
    longitude: input.longitude,
    gpsSkipped: input.gpsSkipped,
  });
  store.setPreferences({
    shopDisplayName: input.shopName,
    shopPhoneE164: input.phone?.trim() || store.preferences.shopPhoneE164,
    shopCurrency: "UGX",
  });
  try {
    await saveBusinessProfileToCloud(
      {
        shopName: input.shopName,
        businessType: input.businessType,
        currency: "UGX",
        phone: input.phone ?? "",
        address: "",
        latitude: input.gpsSkipped ? null : input.latitude,
        longitude: input.gpsSkipped ? null : input.longitude,
        recordGpsInHistory: !input.gpsSkipped && input.latitude != null,
        applyShopLocation: !input.gpsSkipped && input.latitude != null,
      },
      true,
    );
  } catch {
    /* offline-first — local prefs already updated */
  }
  window.dispatchEvent(new Event("waka:onboarding-updated"));
}

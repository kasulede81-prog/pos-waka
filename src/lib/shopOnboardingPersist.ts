import type { BusinessType, ShopSellingStyle } from "../types";
import {
  finalizeOwnerOnboardingAfterCloudSave,
  messageForProfileSaveError,
  normalizeUgPhoneE164,
  saveOwnerBusinessProfileBundleRpc,
} from "./businessProfile";
import { clearFirstTimeOwnerMarker } from "./firstTimeOwnerDevice";
import { supabase } from "./supabase";
import { usePosStore } from "../store/usePosStore";

export async function persistOnboardingChoices(input: {
  shopName: string;
  businessType: BusinessType;
  sellingStyle: ShopSellingStyle;
  phone?: string;
  districtId: string;
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
  const ph = normalizeUgPhoneE164(input.phone ?? "");
  store.setPreferences({
    shopDisplayName: input.shopName,
    shopPhoneE164: ph ?? store.preferences.shopPhoneE164,
    shopCurrency: "UGX",
  });
  if (supabase && ph && input.districtId) {
    const rpc = await saveOwnerBusinessProfileBundleRpc({
      shopName: input.shopName,
      businessType: input.businessType,
      districtId: input.districtId,
      phoneE164: ph,
      currency: "UGX",
      latitude: input.gpsSkipped ? null : (input.latitude ?? null),
      longitude: input.gpsSkipped ? null : (input.longitude ?? null),
    });
    if (!rpc.ok) throw new Error(messageForProfileSaveError(rpc.message ?? "save_failed", "en"));
    const { data: authData } = await supabase.auth.getUser();
    if (authData.user?.id) {
      await finalizeOwnerOnboardingAfterCloudSave(authData.user.id);
      clearFirstTimeOwnerMarker(authData.user.id);
    }
  }
  if (typeof window !== "undefined") {
    try {
      const { scheduleBackgroundCloudSync } = await import("../offline/cloudSync");
      scheduleBackgroundCloudSync({ pull: true, delayMs: 2_000 });
    } catch {
      /* background sync is best-effort after wizard */
    }
    window.dispatchEvent(new Event("waka:onboarding-updated"));
  }
}

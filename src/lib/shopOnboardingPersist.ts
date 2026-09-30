import type { BusinessType, HospitalityOperatingStyle, ShopSellingStyle } from "../types";
import {
  finalizeOwnerOnboardingAfterCloudSave,
  messageForProfileSaveError,
  normalizeUgPhoneE164,
  saveOwnerBusinessProfileBundleRpc,
} from "./businessProfile";
import { clearFirstTimeOwnerMarker } from "./firstTimeOwnerDevice";
import { supabase } from "./supabase";
import { usePosStore } from "../store/usePosStore";

/**
 * Thrown when the wizard cannot be completed as asked. Carries a message that is already fit to
 * show the merchant, so callers render `error.message` and nothing else.
 */
export class OnboardingIncompleteError extends Error {
  /** Which pieces the server needs, for callers that want to point at the right field. */
  readonly missing: string[];
  constructor(message: string, missing: string[]) {
    super(message);
    this.name = "OnboardingIncompleteError";
    this.missing = missing;
  }
}

/**
 * Persist the wizard's choices.
 *
 * ORDER IS THE WHOLE POINT. This used to write the LOCAL "onboarding complete" flags first and
 * only then attempt the cloud save, and it SKIPPED the cloud save entirely when the phone or the
 * district was missing. A merchant whose save failed — or was skipped — was left with a device
 * that said "onboarding is done" and a server that had no business profile at all: every gate
 * that trusts local state then let them into the POS with a shop that was never configured, and
 * nothing ever went back to finish it.
 *
 * So now:
 *   1. validate what the cloud needs, and refuse with a specific reason if it is absent;
 *   2. write the cloud FIRST — it is the source of truth;
 *   3. only after the server has accepted it, record completion locally.
 *
 * In local mode (no Supabase configured) there is no cloud to write, and step 1 is skipped — that
 * path is unchanged.
 */
export async function persistOnboardingChoices(input: {
  shopName: string;
  businessType: BusinessType;
  sellingStyle: ShopSellingStyle;
  /** Operating configuration when businessType is "hospitality". */
  hospitalityStyle?: HospitalityOperatingStyle | null;
  phone?: string;
  districtId: string;
  latitude?: number;
  longitude?: number;
  gpsSkipped: boolean;
}): Promise<void> {
  const store = usePosStore.getState();
  const ph = normalizeUgPhoneE164(input.phone ?? "");

  if (supabase) {
    // Name exactly what is missing rather than silently completing a wizard the server cannot
    // record. The message is per-field so the merchant knows which step to go back to.
    const missing: string[] = [];
    if (!ph) missing.push("phone");
    if (!input.districtId) missing.push("district");
    if (!String(input.shopName ?? "").trim()) missing.push("shop_name");
    if (!ph || !input.districtId || missing.length > 0) {
      throw new OnboardingIncompleteError(
        "We couldn't finish setting up your business. Please complete your phone number and district, then try again.",
        missing,
      );
    }

    const rpc = await saveOwnerBusinessProfileBundleRpc({
      shopName: input.shopName,
      businessType: input.businessType,
      districtId: input.districtId,
      phoneE164: ph,
      currency: "UGX",
      latitude: input.gpsSkipped ? null : (input.latitude ?? null),
      longitude: input.gpsSkipped ? null : (input.longitude ?? null),
    });
    if (!rpc.ok) {
      // Mapped, never raw — and nothing local is marked complete by this throw.
      throw new OnboardingIncompleteError(
        messageForProfileSaveError(rpc.message ?? "save_failed", "en"),
        [],
      );
    }
  }

  // The server has accepted the business profile (or there is no server): only now does the
  // device get to say the wizard is finished.
  store.completeShopOnboardingWizard({
    businessType: input.businessType,
    sellingStyle: input.sellingStyle,
    hospitalityStyle: input.hospitalityStyle ?? null,
    latitude: input.latitude,
    longitude: input.longitude,
    gpsSkipped: input.gpsSkipped,
  });
  store.setPreferences({
    shopDisplayName: input.shopName,
    shopPhoneE164: ph ?? store.preferences.shopPhoneE164,
    shopCurrency: "UGX",
  });

  if (supabase) {
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

import type { User } from "@supabase/supabase-js";
import type { BusinessType } from "../types";
import { isSupabaseEmailVerified } from "./emailVerification";
import { reportAuthIssue } from "./monitoring";
import { supabase } from "./supabase";

export type BootstrapArgs = {
  /** Registered / legal business name (organization + profile.business_name). */
  organizationName: string;
  /** Trading name on the shop row; falls back to organization name. */
  shopDisplayName?: string;
  businessType: BusinessType;
  fullName?: string;
  districtId?: string;
  phoneE164?: string;
  address?: string;
  /** When true, shop has no usable GPS pin yet. */
  gpsMissing?: boolean;
  latitude?: number | null;
  longitude?: number | null;
};

/**
 * Idempotent owner-workspace bootstrap.
 * Safe to call multiple times on the same user/session.
 */
export async function bootstrapOwnerWorkspace(user: User, args: BootstrapArgs): Promise<void> {
  if (!supabase) return;
  if (!isSupabaseEmailVerified(user)) {
    throw new Error("Confirm your email before creating your shop in the cloud.");
  }
  const orgName = args.organizationName.trim();
  if (!orgName) {
    throw new Error("Could not finish creating your shop. Please try again.");
  }
  const shopLabel = (args.shopDisplayName ?? "").trim() || orgName;

  const fullName = (args.fullName ?? "").trim() || null;
  const email = user.email?.trim().toLowerCase() ?? null;

  const hasLat =
    args.latitude != null && args.longitude != null && !Number.isNaN(args.latitude) && !Number.isNaN(args.longitude);

  console.info("[waka-auth] bootstrap_owner_workspace:start", {
    userId: user.id,
    businessType: args.businessType,
    hasEmail: Boolean(email),
    hasDistrict: Boolean(args.districtId),
    hasGps: Boolean(hasLat),
  });

  const rpcArgs = {
    p_org_name: orgName,
    p_business_type: args.businessType,
    p_full_name: fullName,
    p_email: email,
    p_district_id: args.districtId?.trim() || null,
    p_phone_e164: args.phoneE164?.trim() || null,
    p_address: args.address?.trim() || null,
    p_gps_missing: args.gpsMissing ?? !hasLat,
    p_latitude: hasLat ? args.latitude! : null,
    p_longitude: hasLat ? args.longitude! : null,
    p_shop_display_name: shopLabel,
  };

  const maxAttempts = 3;
  let lastError: { message?: string; code?: string } | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { error } = await supabase.rpc("bootstrap_owner_workspace", rpcArgs);
    if (!error) {
      console.info("[waka-auth] bootstrap_owner_workspace:ok", { userId: user.id, attempt });
      return;
    }
    lastError = error;
    const msg = (error.message ?? "").toLowerCase();
    const retryable =
      attempt < maxAttempts &&
      (msg.includes("jwt") ||
        msg.includes("not authenticated") ||
        msg.includes("timeout") ||
        msg.includes("network") ||
        msg.includes("email_not_verified"));
    if (retryable) {
      await new Promise((r) => setTimeout(r, 350 * attempt));
      continue;
    }
    break;
  }

  reportAuthIssue("workspace_bootstrap_failed", {
    status: lastError?.code ?? "unknown",
  });
  console.error("[waka-auth] bootstrap_owner_workspace:error", {
    userId: user.id,
    code: lastError?.code,
    message: lastError?.message,
  });
  throw new Error(lastError?.message || "Could not finish creating your shop. Please try again.");
}

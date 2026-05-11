import type { User } from "@supabase/supabase-js";
import type { BusinessType } from "../types";
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

  const { error } = await supabase.rpc("bootstrap_owner_workspace", {
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
  });

  if (error) {
    reportAuthIssue("workspace_bootstrap_failed", {
      status: error.code ?? "unknown",
    });
    console.error("[waka-auth] bootstrap_owner_workspace:error", {
      userId: user.id,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    throw new Error(error.message || "Could not finish creating your shop. Please try again.");
  }

  console.info("[waka-auth] bootstrap_owner_workspace:ok", { userId: user.id });
}

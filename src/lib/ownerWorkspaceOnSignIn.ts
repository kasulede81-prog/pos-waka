import type { Session } from "@supabase/supabase-js";
import type { BusinessType } from "../types";
import { normalizeUgPhoneE164 } from "./businessProfile";
import { resolvePrimaryOrganizationForUser } from "./fetchShopSubscription";
import { bootstrapOwnerWorkspace } from "./workspaceBootstrap";
import { isWorkspaceBootstrapped, markWorkspaceBootstrapped } from "./workspaceBootstrapCache";
import { supabase } from "./supabase";

/**
 * Idempotent owner workspace bootstrap after email confirmation or first sign-in.
 * Safe to call from AuthCallback and useAuth.
 */
export async function ensureOwnerWorkspaceIfNeeded(session: Session): Promise<void> {
  if (!supabase || !session.user) return;
  const uid = session.user.id;
  if (isWorkspaceBootstrapped(uid)) return;

  const existing = await resolvePrimaryOrganizationForUser(uid);
  if (existing?.shopId) {
    markWorkspaceBootstrapped(uid);
    return;
  }

  const meta = session.user.user_metadata as Record<string, unknown> | undefined;
  const orgFromMeta =
    String(meta?.organization_name ?? "").trim() ||
    String(meta?.business_name ?? "").trim() ||
    String(meta?.shop_name ?? "").trim() ||
    String(session.user.email ?? "").split("@")[0] ||
    "My Shop";
  const shopFromMeta =
    String(meta?.shop_display_name ?? "").trim() ||
    String(meta?.shop_name ?? "").trim() ||
    orgFromMeta;
  const businessType = (String(meta?.business_type ?? "kiosk_duka") || "kiosk_duka") as BusinessType;
  const fullName = String(meta?.full_name ?? "").trim();
  const phoneRaw = String(meta?.phone_e164 ?? meta?.phone ?? "").trim();
  const phoneE164 = normalizeUgPhoneE164(phoneRaw) ?? undefined;
  const districtId =
    typeof meta?.district_id === "string" && meta.district_id.length > 0 ? meta.district_id : undefined;
  const gpsSkipped = meta?.gps_skipped === true;
  const latRaw = meta?.latitude;
  const lngRaw = meta?.longitude;
  const latitude =
    typeof latRaw === "number" ? latRaw : typeof latRaw === "string" ? Number.parseFloat(latRaw) : undefined;
  const longitude =
    typeof lngRaw === "number" ? lngRaw : typeof lngRaw === "string" ? Number.parseFloat(lngRaw) : undefined;
  const hasGps =
    latitude != null && longitude != null && !Number.isNaN(latitude) && !Number.isNaN(longitude);

  await bootstrapOwnerWorkspace(session.user, {
    organizationName: orgFromMeta,
    shopDisplayName: shopFromMeta,
    businessType,
    fullName: fullName || undefined,
    districtId,
    phoneE164,
    gpsMissing: gpsSkipped || !hasGps,
    latitude: hasGps ? latitude : undefined,
    longitude: hasGps ? longitude : undefined,
  });

  const cur = String(meta?.default_currency ?? "").trim().toUpperCase();
  if (cur.length === 3 && /^[A-Z]{3}$/.test(cur)) {
    const { data: om } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", uid)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const oid = om?.organization_id as string | undefined;
    if (oid) {
      await supabase.from("organizations").update({ default_currency: cur }).eq("id", oid);
    }
  }

  markWorkspaceBootstrapped(uid);
}

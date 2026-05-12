import type { BusinessType } from "../types";
import { supabase } from "./supabase";
import { bootstrapOwnerWorkspace } from "./workspaceBootstrap";

export type SaveOwnerBundleArgs = {
  shopName: string;
  businessType: BusinessType;
  districtId: string;
  phoneE164: string;
  currency: string;
  address?: string;
  city?: string;
  area?: string;
  latitude?: number | null;
  longitude?: number | null;
};

/** Single transactional save (organizations + shops + profiles + starter trial if missing). */
export async function saveOwnerBusinessProfileBundleRpc(
  args: SaveOwnerBundleArgs,
): Promise<{ ok: boolean; message?: string; shopId?: string; organizationId?: string }> {
  const sb = supabase;
  if (!sb) return { ok: false, message: "Offline" };
  const callSaveRpc = async () =>
    sb.rpc("save_owner_business_profile_bundle", {
      p_shop_name: args.shopName.trim(),
      p_business_type: args.businessType,
      p_district_id: args.districtId,
      p_phone_e164: args.phoneE164.trim(),
      p_currency: args.currency.trim().toUpperCase(),
      p_address: args.address?.trim() || null,
      p_city: args.city?.trim() || null,
      p_area: args.area?.trim() || null,
      p_latitude: args.latitude ?? null,
      p_longitude: args.longitude ?? null,
    });
  let { data, error } = await callSaveRpc();
  if (error) return { ok: false, message: error.message };
  const j = (data ?? {}) as { ok?: boolean; error?: string; detail?: string; shop_id?: string; organization_id?: string };
  if (!j.ok && j.error === "no_shop") {
    const { data: authData } = await sb.auth.getUser();
    if (authData?.user) {
      const meta = (authData.user.user_metadata ?? {}) as Record<string, unknown>;
      const fullName =
        String(meta.full_name ?? meta.name ?? "")
          .trim() || authData.user.email?.split("@")[0] || "Owner";
      const hasGps =
        args.latitude != null &&
        args.longitude != null &&
        !Number.isNaN(args.latitude) &&
        !Number.isNaN(args.longitude);
      await bootstrapOwnerWorkspace(authData.user, {
        organizationName: args.shopName.trim(),
        shopDisplayName: args.shopName.trim(),
        businessType: args.businessType,
        fullName,
        districtId: args.districtId,
        phoneE164: args.phoneE164.trim(),
        address: args.address?.trim() || undefined,
        gpsMissing: !hasGps,
        latitude: hasGps ? args.latitude : undefined,
        longitude: hasGps ? args.longitude : undefined,
      });
      ({ data, error } = await callSaveRpc());
      if (error) return { ok: false, message: error.message };
    }
  }
  const jRetry = (data ?? {}) as { ok?: boolean; error?: string; detail?: string; shop_id?: string; organization_id?: string };
  if (jRetry.ok) return { ok: true, shopId: jRetry.shop_id, organizationId: jRetry.organization_id };
  const detail = jRetry.detail ? ` (${jRetry.detail})` : "";
  return { ok: false, message: `${jRetry.error ?? "save_failed"}${detail}` };
}

export type BusinessProfileInput = {
  shopName: string;
  businessType: BusinessType;
  currency: string;
  phone: string;
  address: string;
  ownerName?: string;
  /** FK to public.districts.id */
  districtId?: string | null;
  city?: string;
  area?: string;
  latitude?: number | null;
  longitude?: number | null;
  /** When true and lat/lng set, append a row to shop_locations */
  recordGpsInHistory?: boolean;
  /** When true, writes district / city / area / GPS columns on shops (Settings only). */
  applyShopLocation?: boolean;
};

export type PrimaryShopLocationSnapshot = {
  shopId: string;
  organizationId: string;
  districtId: string | null;
  city: string | null;
  area: string | null;
  latitude: number | null;
  longitude: number | null;
};

export function normalizeUgPhoneE164(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  if (digits.startsWith("256") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+256${digits.slice(1)}`;
  if (v.startsWith("+256") && /^\+256[0-9]{9}$/.test(v)) return v;
  return null;
}

async function getPrimaryShopForUser(userId: string) {
  if (!supabase) return null;
  const { data: member, error: memberErr } = await supabase
    .from("shop_members")
    .select("shop_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (memberErr) throw memberErr;
  if (!member?.shop_id) return null;
  const { data: shop, error: shopErr } = await supabase
    .from("shops")
    .select("id, organization_id, business_type, district_id, city, area, latitude, longitude")
    .eq("id", member.shop_id)
    .maybeSingle();
  if (shopErr) throw shopErr;
  if (!shop) return null;
  return { shop };
}

/** Load primary shop row fields used by the location section in Settings. */
export async function loadPrimaryShopLocationFromCloud(): Promise<PrimaryShopLocationSnapshot | null> {
  if (!supabase) return null;
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user) return null;
  const primary = await getPrimaryShopForUser(authData.user.id);
  if (!primary?.shop) return null;
  const s = primary.shop as {
    id: string;
    organization_id: string;
    district_id: string | null;
    city: string | null;
    area: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  return {
    shopId: s.id,
    organizationId: s.organization_id,
    districtId: s.district_id,
    city: s.city,
    area: s.area,
    latitude: s.latitude,
    longitude: s.longitude,
  };
}

export async function saveBusinessProfileToCloud(input: BusinessProfileInput, allowBusinessTypeChange: boolean): Promise<void> {
  if (!supabase) return;
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user) throw authErr ?? new Error("Not signed in");
  const user = authData.user;

  const safePhone = normalizeUgPhoneE164(input.phone);
  const safeCurrency = (input.currency || "UGX").trim().toUpperCase();

  let primary = await getPrimaryShopForUser(user.id);
  if (!primary?.shop?.id) {
    const hasGps =
      input.applyShopLocation &&
      input.latitude != null &&
      input.longitude != null &&
      !Number.isNaN(input.latitude) &&
      !Number.isNaN(input.longitude);
    await bootstrapOwnerWorkspace(user, {
      organizationName: input.shopName.trim(),
      shopDisplayName: input.shopName.trim(),
      businessType: input.businessType,
      fullName: input.ownerName,
      districtId: input.districtId?.trim() || undefined,
      phoneE164: safePhone ?? undefined,
      address: input.address?.trim() || undefined,
      gpsMissing: !hasGps,
      latitude: hasGps ? input.latitude! : undefined,
      longitude: hasGps ? input.longitude! : undefined,
    });
    primary = await getPrimaryShopForUser(user.id);
    if (!primary?.shop?.id) throw new Error("Workspace not ready");
  }

  const shopId = primary.shop.id;
  const orgId = primary.shop.organization_id;
  const currentType = primary.shop.business_type;

  const shopPatch: Record<string, string | number | boolean | null> = {
    name: input.shopName.trim() || "My Shop",
    phone_e164: safePhone,
    address_line: input.address.trim() || null,
  };

  if (input.applyShopLocation) {
    let districtName: string | null = null;
    const did = input.districtId?.trim() || null;
    if (did) {
      const { data: drow } = await supabase.from("districts").select("name").eq("id", did).maybeSingle();
      districtName = (drow?.name as string | undefined)?.trim() || null;
    }
    shopPatch.district_id = did;
    shopPatch.district = districtName;
    shopPatch.city = (input.city ?? "").trim() || null;
    shopPatch.area = (input.area ?? "").trim() || null;
    if (input.latitude != null && input.longitude != null && !Number.isNaN(input.latitude) && !Number.isNaN(input.longitude)) {
      shopPatch.latitude = input.latitude;
      shopPatch.longitude = input.longitude;
    } else {
      shopPatch.latitude = null;
      shopPatch.longitude = null;
    }
    shopPatch.gps_missing = !(
      shopPatch.latitude != null &&
      shopPatch.longitude != null &&
      !Number.isNaN(Number(shopPatch.latitude)) &&
      !Number.isNaN(Number(shopPatch.longitude))
    );
  }

  if (allowBusinessTypeChange || !currentType) {
    shopPatch.business_type = input.businessType;
  }

  const { error: shopErr } = await supabase.from("shops").update(shopPatch).eq("id", shopId);
  if (shopErr) throw shopErr;

  if (
    input.applyShopLocation &&
    input.recordGpsInHistory &&
    input.latitude != null &&
    input.longitude != null &&
    !Number.isNaN(input.latitude) &&
    !Number.isNaN(input.longitude)
  ) {
    const { error: locErr } = await supabase.from("shop_locations").insert({
      shop_id: shopId,
      latitude: input.latitude,
      longitude: input.longitude,
      source: "device_gps",
      is_primary: true,
    });
    if (locErr) throw locErr;
  }

  const { error: orgErr } = await supabase.from("organizations").update({ default_currency: safeCurrency }).eq("id", orgId);
  if (orgErr) throw orgErr;

  const profilePatch = {
    id: user.id,
    full_name: input.ownerName?.trim() || null,
    business_name: input.shopName.trim() || null,
    phone_e164: safePhone,
  };
  const { error: profileErr } = await supabase.from("profiles").upsert(profilePatch);
  if (profileErr) throw profileErr;
}


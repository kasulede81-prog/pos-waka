import type { BusinessType } from "../types";
import { supabase } from "./supabase";
import { bootstrapOwnerWorkspace } from "./workspaceBootstrap";

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

function normalizeUgPhone(raw: string): string | null {
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

  let primary = await getPrimaryShopForUser(user.id);
  if (!primary?.shop?.id) {
    await bootstrapOwnerWorkspace(user, {
      businessName: input.shopName,
      businessType: input.businessType,
      fullName: input.ownerName,
    });
    primary = await getPrimaryShopForUser(user.id);
    if (!primary?.shop?.id) throw new Error("Workspace not ready");
  }

  const shopId = primary.shop.id;
  const orgId = primary.shop.organization_id;
  const currentType = primary.shop.business_type;

  const safePhone = normalizeUgPhone(input.phone);
  const safeCurrency = (input.currency || "UGX").trim().toUpperCase();

  const shopPatch: Record<string, string | number | null> = {
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


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
    .select("id, organization_id, business_type")
    .eq("id", member.shop_id)
    .maybeSingle();
  if (shopErr) throw shopErr;
  if (!shop) return null;
  return { shop };
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

  const shopPatch: Record<string, string | null> = {
    name: input.shopName.trim() || "My Shop",
    phone_e164: safePhone,
    address_line: input.address.trim() || null,
  };
  if (allowBusinessTypeChange || !currentType) {
    shopPatch.business_type = input.businessType;
  }

  const { error: shopErr } = await supabase.from("shops").update(shopPatch).eq("id", shopId);
  if (shopErr) throw shopErr;

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


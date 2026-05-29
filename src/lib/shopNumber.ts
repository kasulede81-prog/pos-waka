/** Waka public shop number label (e.g. A001). */
export function formatWakaShopNumber(shopNumber: string | null | undefined): string | null {
  const n = String(shopNumber ?? "").trim().toUpperCase();
  return n || null;
}

/** Load the signed-in owner's Waka shop number (A001, …) from Supabase. */
export async function fetchMyShopNumber(): Promise<string | null> {
  const { hasSupabaseConfig, supabase } = await import("./supabase");
  if (!hasSupabaseConfig || !supabase) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return null;

  const { resolvePrimaryOrganizationForUser } = await import("./fetchShopSubscription");
  const orgShop = await resolvePrimaryOrganizationForUser(userId);
  if (!orgShop?.shopId) return null;

  const { data, error } = await supabase
    .from("shops")
    .select("shop_number")
    .eq("id", orgShop.shopId)
    .maybeSingle();

  if (error || !data?.shop_number) return null;
  return formatWakaShopNumber(data.shop_number as string);
}

export function isWakaShopNumberInput(value: string): boolean {
  return /^A\d{3,}$/i.test(value.trim());
}

/** Accept A001 or UUID; returns normalized shop number or uuid string. */
export function normalizeShopLookupInput(raw: string): { kind: "number" | "uuid"; value: string } | null {
  const v = raw.trim();
  if (!v) return null;
  if (isWakaShopNumberInput(v)) return { kind: "number", value: v.toUpperCase() };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) {
    return { kind: "uuid", value: v.toLowerCase() };
  }
  return null;
}

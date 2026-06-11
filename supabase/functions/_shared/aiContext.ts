import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function resolveShopIdForUser(
  admin: SupabaseClient,
  userId: string,
  preferredShopId?: string | null,
): Promise<string | null> {
  if (preferredShopId) return preferredShopId;
  const { data } = await admin
    .from("shop_members")
    .select("shop_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.shop_id ?? null;
}

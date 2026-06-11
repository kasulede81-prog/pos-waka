import { supabase } from "../supabase";
import { invokeSupabaseEdgeFunction } from "../supabaseEdgeInvoke";
import { normalizeAiErrorCode } from "./aiErrors";
import { parseAiEdgeFailure } from "./parseAiEdgeResponse";
import { parseAiBusinessSetup, type AiBusinessSetupResult } from "./aiBusinessSchemas";
import { readLocalAiSetupTemplate, writeLocalAiSetupTemplate } from "./aiSetupTemplateStore";

export type BusinessSetupAiResult =
  | { ok: true; setup: AiBusinessSetupResult; fromCache: boolean; shopId: string }
  | { ok: false; error: string; errorCode?: string };

type EdgeResponse = {
  ok?: boolean;
  success?: boolean;
  error?: string;
  reason?: string;
  code?: string;
  from_cache?: boolean;
  shop_id?: string;
  setup?: unknown;
};

let shopIdCached: { value: string; at: number } | null = null;
let shopIdInflight: Promise<string | null> | null = null;
const SHOP_ID_CACHE_MS = 60_000;

export async function resolveActiveShopId(): Promise<string | null> {
  if (!supabase) return null;
  if (shopIdCached && Date.now() - shopIdCached.at < SHOP_ID_CACHE_MS) {
    return shopIdCached.value;
  }
  if (shopIdInflight) return shopIdInflight;
  shopIdInflight = (async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user?.id) return null;
      const { data } = await supabase
        .from("shop_members")
        .select("shop_id")
        .eq("user_id", auth.user.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      const id = data?.shop_id ?? null;
      if (id) shopIdCached = { value: id, at: Date.now() };
      return id;
    } finally {
      shopIdInflight = null;
    }
  })();
  return shopIdInflight;
}

export async function fetchShopAiSetupCompleted(shopId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase
    .from("shops")
    .select("ai_setup_completed_at")
    .eq("id", shopId)
    .maybeSingle();
  return Boolean(data?.ai_setup_completed_at);
}

export async function fetchShopAiSetupTemplate(shopId: string): Promise<AiBusinessSetupResult | null> {
  const local = await readLocalAiSetupTemplate(shopId);
  if (local) return local;

  if (!supabase) return null;
  const { data } = await supabase
    .from("shop_ai_setup_templates")
    .select("detected_nature, shelves, starter_products")
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!data) return null;

  const setup = parseAiBusinessSetup({
    detected_nature: data.detected_nature,
    shelves: data.shelves,
    starter_products: data.starter_products,
  });
  if (setup) await writeLocalAiSetupTemplate(shopId, setup);
  return setup;
}

export async function generateBusinessSetupWithAi(params: {
  shopId?: string | null;
  shopName: string;
  businessType: string;
  businessDescription?: string;
  forceRegenerate?: boolean;
}): Promise<BusinessSetupAiResult> {
  const res = await invokeSupabaseEdgeFunction<EdgeResponse>("ai-business-setup", {
    shop_id: params.shopId ?? undefined,
    shop_name: params.shopName.trim(),
    business_type: params.businessType,
    business_description: params.businessDescription?.trim() || undefined,
    force_regenerate: params.forceRegenerate === true,
  });

  if (!res.ok) {
    return {
      ok: false,
      error: res.message,
      errorCode: res.errorCode ?? normalizeAiErrorCode("invoke_failed", res.message),
    };
  }

  const data = res.data;
  const failure = parseAiEdgeFailure(data);
  if (failure.failed) {
    return { ok: false, error: failure.error, errorCode: failure.errorCode };
  }

  const setup = parseAiBusinessSetup(data.setup);
  if (!setup) {
    return { ok: false, error: "Invalid AI response.", errorCode: "invalid_schema" };
  }

  const shopId = String(data.shop_id ?? params.shopId ?? "");
  if (shopId) await writeLocalAiSetupTemplate(shopId, setup);

  return {
    ok: true,
    setup,
    fromCache: data.from_cache === true,
    shopId,
  };
}

export async function finalizeShopAiSetup(shopId: string, skipped: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: true };
  const { data, error } = await supabase.rpc("finalize_shop_ai_setup", {
    p_shop_id: shopId,
    p_skipped: skipped,
  });
  if (error) return { ok: false, error: error.message };
  const row = (data ?? {}) as { ok?: boolean };
  return { ok: row.ok !== false };
}

export async function adminResetShopAiSetup(shopId: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase not configured." };
  const { data, error } = await supabase.rpc("admin_reset_shop_ai_setup", { p_shop_id: shopId });
  if (error) return { ok: false, error: error.message };
  const row = (data ?? {}) as { ok?: boolean };
  return { ok: row.ok !== false };
}

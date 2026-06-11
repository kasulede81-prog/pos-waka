import { readKv, writeKv } from "../../offline/localDb";
import type { AiProductSuggestion } from "./aiProductSchemas";
import { normalizeProductNameKey } from "./aiProductSchemas";

const KV_PREFIX = "ai_product_cache";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CachedEntry = {
  suggestion: AiProductSuggestion;
  cachedAt: string;
  businessType: string;
};

export function localProductAiCacheKey(productName: string, businessType = ""): string {
  return `${KV_PREFIX}::${normalizeProductNameKey(productName)}::${businessType.trim().toLowerCase()}`;
}

export async function lookupLocalProductAiCache(
  productName: string,
  businessType = "",
): Promise<AiProductSuggestion | null> {
  const row = await readKv<CachedEntry>(localProductAiCacheKey(productName, businessType));
  if (!row?.suggestion || !row.cachedAt) return null;
  const age = Date.now() - new Date(row.cachedAt).getTime();
  if (!Number.isFinite(age) || age > TTL_MS) return null;
  return row.suggestion;
}

export async function upsertLocalProductAiCache(
  productName: string,
  businessType: string,
  suggestion: AiProductSuggestion,
): Promise<void> {
  await writeKv(localProductAiCacheKey(productName, businessType), {
    suggestion,
    cachedAt: new Date().toISOString(),
    businessType: businessType.trim().toLowerCase(),
  } satisfies CachedEntry);
}

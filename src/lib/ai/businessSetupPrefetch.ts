import type { BusinessSetupAiResult } from "./businessSetupAi";
import {
  fetchShopAiSetupCompleted,
  generateBusinessSetupWithAi,
  resolveActiveShopId,
} from "./businessSetupAi";

export function businessSetupPrefetchKey(shopName: string, businessType: string): string {
  return `${businessType.trim()}:${shopName.trim().toLowerCase()}`;
}

const inflight = new Map<string, Promise<BusinessSetupAiResult>>();

/** Fire-and-forget AI template draft for onboarding; deduped per shop name + business type. */
export function prefetchBusinessSetupTemplates(params: {
  shopName: string;
  businessType: string;
  businessDescription?: string;
}): Promise<BusinessSetupAiResult> {
  const key = businessSetupPrefetchKey(params.shopName, params.businessType);
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<BusinessSetupAiResult> => {
    const shopId = await resolveActiveShopId();
    if (shopId) {
      const done = await fetchShopAiSetupCompleted(shopId);
      if (done) return { ok: false, error: "already_completed", errorCode: "already_completed" };
    }

    return generateBusinessSetupWithAi({
      shopId,
      shopName: params.shopName,
      businessType: params.businessType,
      businessDescription: params.businessDescription,
    });
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

/** Await an in-flight prefetch for the same shop + business type, if any. */
export function awaitBusinessSetupPrefetch(
  shopName: string,
  businessType: string,
): Promise<BusinessSetupAiResult | null> {
  return inflight.get(businessSetupPrefetchKey(shopName, businessType)) ?? Promise.resolve(null);
}

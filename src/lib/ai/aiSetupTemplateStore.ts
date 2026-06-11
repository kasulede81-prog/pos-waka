import { readKv, writeKv } from "../../offline/localDb";
import type { AiBusinessSetupResult } from "./aiBusinessSchemas";

const KV_KEY = "ai_setup_template";

type StoredTemplate = {
  shopId: string;
  setup: AiBusinessSetupResult;
  cachedAt: string;
};

export async function readLocalAiSetupTemplate(shopId: string): Promise<AiBusinessSetupResult | null> {
  const row = await readKv<StoredTemplate>(KV_KEY);
  if (!row || row.shopId !== shopId) return null;
  return row.setup;
}

export async function writeLocalAiSetupTemplate(shopId: string, setup: AiBusinessSetupResult): Promise<void> {
  await writeKv(KV_KEY, {
    shopId,
    setup,
    cachedAt: new Date().toISOString(),
  } satisfies StoredTemplate);
}

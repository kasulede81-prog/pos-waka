import { readKv, writeKv } from "../../offline/localDb";
import type { VisionRecorderMeta, VisionRecorderMetaMap } from "./recorders";

type Snap = {
  version: 1;
  shopScopeId: string;
  recorders: VisionRecorderMetaMap;
  updatedAt: string;
};

function kvKey(shopScopeId: string): string {
  return `vision-recorder-meta::${shopScopeId}`;
}

export async function loadVisionRecorderMeta(shopScopeId: string): Promise<VisionRecorderMetaMap> {
  const snap = await readKv<Snap>(kvKey(shopScopeId));
  if (!snap || snap.version !== 1 || !snap.recorders) return {};
  return snap.recorders;
}

export async function upsertVisionRecorderMeta(
  shopScopeId: string,
  host: string,
  patch: VisionRecorderMeta,
): Promise<VisionRecorderMetaMap> {
  const current = await loadVisionRecorderMeta(shopScopeId);
  const next = {
    ...current,
    [host]: { ...(current[host] ?? {}), ...patch },
  };
  await writeKv(kvKey(shopScopeId), {
    version: 1,
    shopScopeId,
    recorders: next,
    updatedAt: new Date().toISOString(),
  } satisfies Snap);
  return next;
}

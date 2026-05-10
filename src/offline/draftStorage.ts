import type { LineInputMode, Product, SaleLine } from "../types";
import { deleteKv, readKv, writeKv } from "./localDb";

const KEY = "draft_sale";
const VERSION = 1 as const;

export type PersistedDraftV1 = {
  v: typeof VERSION;
  draftLines: SaleLine[];
  draftInput: { productId: string; inputMode: LineInputMode; value: number } | null;
};

export async function readPersistedDraft(): Promise<PersistedDraftV1 | null> {
  const row = await readKv<PersistedDraftV1>(KEY);
  if (!row || row.v !== VERSION || !Array.isArray(row.draftLines)) return null;
  return row;
}

export async function writePersistedDraft(lines: SaleLine[], input: PersistedDraftV1["draftInput"]): Promise<void> {
  if (!lines.length && !input) {
    await deleteKv(KEY);
    return;
  }
  const payload: PersistedDraftV1 = {
    v: VERSION,
    draftLines: lines,
    draftInput: input,
  };
  await writeKv(KEY, payload);
}

export async function clearPersistedDraft(): Promise<void> {
  await deleteKv(KEY);
}

/** Re-bind product objects from current catalog */
export function resolveDraftFromPersisted(
  draft: PersistedDraftV1,
  products: Product[],
): { draftLines: SaleLine[]; draftInput: { product: Product; inputMode: LineInputMode; value: number } | null } {
  const idSet = new Set(products.map((p) => p.id));
  const draftLines = draft.draftLines.filter((l) => idSet.has(l.productId));
  let draftInput: { product: Product; inputMode: LineInputMode; value: number } | null = null;
  if (draft.draftInput) {
    const p = products.find((x) => x.id === draft.draftInput!.productId);
    if (p) {
      draftInput = {
        product: p,
        inputMode: draft.draftInput.inputMode,
        value: draft.draftInput.value,
      };
    }
  }
  return { draftLines, draftInput };
}

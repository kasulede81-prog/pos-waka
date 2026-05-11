/** Weighing scale (serial / BLE) — read stable weight in grams. */
export async function readStableWeightGrams(): Promise<{ ok: boolean; grams?: number; error?: string }> {
  return { ok: false, error: "Scale adapter not connected." };
}

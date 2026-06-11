import { invokeSupabaseEdgeFunction } from "../supabaseEdgeInvoke";
import { parseAiBulkInventory, type AiBulkInventoryRow } from "./aiBusinessSchemas";

export type BulkInventoryPreviewRow = AiBulkInventoryRow & {
  enabled: boolean;
  stockQty: number;
  priceUgx: number;
};

export type BulkInventoryAiResult =
  | { ok: true; products: BulkInventoryPreviewRow[] }
  | { ok: false; error: string; errorCode?: string };

type EdgeResponse = {
  ok?: boolean;
  success?: boolean;
  error?: string;
  reason?: string;
  code?: string;
  products?: unknown;
  count?: number;
};

export function mapBulkRowsToQuickAdd(
  rows: BulkInventoryPreviewRow[],
): Array<{
  name: string;
  priceUgx: number;
  stockQty: number;
  category: string;
  inferName: string;
  sellingMode: "unit" | "weighted" | "portion";
  baseUnit: string;
}> {
  return rows
    .filter((r) => r.enabled && r.name.trim() && r.priceUgx > 0)
    .map((r) => ({
      name: r.name.trim(),
      priceUgx: Math.floor(r.priceUgx),
      stockQty: Math.max(0, Math.floor(r.stockQty)),
      category: r.category.trim() || "General",
      inferName: r.name.trim(),
      sellingMode: r.sellingMode,
      baseUnit: r.unit.trim() || "piece",
    }));
}

export async function generateBulkInventoryWithAi(params: {
  shopDescription: string;
  businessType: string;
}): Promise<BulkInventoryAiResult> {
  const description = params.shopDescription.trim();
  if (!description) {
    return { ok: false, error: "Shop description is required.", errorCode: "invalid_description" };
  }

  const res = await invokeSupabaseEdgeFunction<EdgeResponse>("ai-bulk-inventory", {
    shop_description: description,
    business_type: params.businessType,
  });

  if (!res.ok) {
    return { ok: false, error: res.message, errorCode: "invoke_failed" };
  }

  const data = res.data;
  if (data.success === false || data.ok === false || data.error || data.reason) {
    return {
      ok: false,
      error: String(data.reason ?? data.error ?? "ai_failed"),
      errorCode: String(data.code ?? data.error ?? "ai_failed"),
    };
  }

  const parsed = parseAiBulkInventory({ products: data.products });
  if (parsed.length === 0) {
    return { ok: false, error: "Invalid AI response.", errorCode: "invalid_schema" };
  }

  const products: BulkInventoryPreviewRow[] = parsed.map((row) => ({
    ...row,
    enabled: true,
    stockQty: 0,
    priceUgx: row.suggestedPriceUgx,
  }));

  return { ok: true, products };
}

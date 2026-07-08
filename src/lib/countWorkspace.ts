import type { InventoryCountLine, InventoryCountSession, InventoryCountSessionStatus, Product } from "../types";
import { productMatchesSellSearch } from "./productCategories";

export type CountProgressStage = "choose" | "count" | "review" | "apply" | "complete";

const STAGE_ORDER: CountProgressStage[] = ["choose", "count", "review", "apply", "complete"];

export function countProgressStage(status: InventoryCountSessionStatus): CountProgressStage {
  switch (status) {
    case "draft":
      return "choose";
    case "counting":
      return "count";
    case "submitted":
      return "review";
    case "approved":
      return "apply";
    case "applied":
      return "complete";
    default:
      return "choose";
  }
}

export function countProgressIndex(stage: CountProgressStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export type VarianceTone = "neutral" | "positive" | "negative";

/** Presentation-only — matches existing count line variance colours. */
export function inventoryCountVarianceTone(varianceQty: number): VarianceTone {
  if (varianceQty < 0) return "negative";
  if (varianceQty > 0) return "positive";
  return "neutral";
}

export function varianceToneClass(tone: VarianceTone): string {
  switch (tone) {
    case "negative":
      return "text-rose-700";
    case "positive":
      return "text-emerald-700";
    default:
      return "text-foreground";
  }
}

export function filterInventoryCountLines(
  lines: InventoryCountLine[],
  productsById: Map<string, Product>,
  query: string,
): InventoryCountLine[] {
  const q = query.trim();
  if (!q) return lines;
  return lines.filter((line) => {
    const product = productsById.get(line.productId);
    if (product) return productMatchesSellSearch(product, q);
    return (line.productName ?? "").toLowerCase().includes(q.toLowerCase());
  });
}

/** Presentation-only duration between session start and apply (or latest update). */
export function formatCountSessionDuration(session: InventoryCountSession): string | null {
  if (!session.startedAt) return null;
  const endMs = new Date(session.appliedAt ?? session.updatedAt).getTime();
  const startMs = new Date(session.startedAt).getTime();
  if (!Number.isFinite(endMs) || !Number.isFinite(startMs) || endMs <= startMs) return null;
  const mins = Math.round((endMs - startMs) / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

export const COUNT_PROGRESS_STAGES: CountProgressStage[] = STAGE_ORDER;

/**
 * Phase 31.1 — Unified receive architecture.
 *
 * Two entry points, one operation stack:
 * - Purchase / multi-line → RestockPage (hub "Receive" / New purchase)
 * - Quick SKU restock → SimpleProductRestockModal
 *
 * Shared:
 * - ReceiveOperationShell (ModalSheet chrome)
 * - receive validation banners / totals / line editors
 * - stock update + audit via existing store actions (unchanged)
 *
 * Only the entry point and line cardinality differ.
 */

export type ReceiveEntryPoint = "purchase_order" | "sku_restock";

export const RECEIVE_ENTRY_POINTS: Record<
  ReceiveEntryPoint,
  { surface: string; multiLine: boolean }
> = {
  purchase_order: { surface: "RestockPage", multiLine: true },
  sku_restock: { surface: "SimpleProductRestockModal", multiLine: false },
};

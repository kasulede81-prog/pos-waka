/** User-selected inventory list presentation preference. */
export type InventoryViewPreference = "auto" | "card" | "compact" | "table";

/** Resolved display mode applied to product lists. */
export type InventoryViewMode = "card" | "compact" | "table";

export type InventoryListSortKey = "name_az" | "name_za" | "stock_low" | "updated";

export type InventoryRowAction = "edit" | "sell" | "restock" | "duplicate" | "remove";

export const INVENTORY_VIEW_ROW_ESTIMATE: Record<InventoryViewMode, number> = {
  card: 110,
  compact: 68,
  table: 44,
};

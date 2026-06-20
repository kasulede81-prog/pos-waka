import { reportSyncIssue } from "./monitoring";

export type InventoryConflictEvent = {
  at: string;
  productId: string;
  productName: string;
  requestedQty: number;
  stockBefore: number;
  stockAfter: number;
  minimumStockAlert: number;
  saleId?: string;
  kind: "oversell_risk" | "critical_level";
};

const MAX_EVENTS = 50;
let recentConflicts: InventoryConflictEvent[] = [];

export function logInventoryConflict(event: InventoryConflictEvent): void {
  recentConflicts = [event, ...recentConflicts].slice(0, MAX_EVENTS);
  reportSyncIssue("inventory_stock_conflict", {
    productId: event.productId,
    kind: event.kind,
    stockBefore: event.stockBefore,
    stockAfter: event.stockAfter,
    requestedQty: event.requestedQty,
  });
}

export function getRecentInventoryConflicts(): InventoryConflictEvent[] {
  return [...recentConflicts];
}

export function clearInventoryConflictLog(): void {
  recentConflicts = [];
}

/** Detect oversell / critical-level conflicts before stock deduction. */
export function detectSaleStockConflict(input: {
  productId: string;
  productName: string;
  stockOnHand: number;
  quantity: number;
  minimumStockAlert: number;
  saleId?: string;
}): InventoryConflictEvent | null {
  const stockAfter = input.stockOnHand - input.quantity;
  if (stockAfter < 0) {
    return {
      at: new Date().toISOString(),
      productId: input.productId,
      productName: input.productName,
      requestedQty: input.quantity,
      stockBefore: input.stockOnHand,
      stockAfter,
      minimumStockAlert: input.minimumStockAlert,
      saleId: input.saleId,
      kind: "oversell_risk",
    };
  }
  const alert = Number(input.minimumStockAlert) || 0;
  if (alert > 0 && stockAfter <= alert && input.stockOnHand > alert) {
    return {
      at: new Date().toISOString(),
      productId: input.productId,
      productName: input.productName,
      requestedQty: input.quantity,
      stockBefore: input.stockOnHand,
      stockAfter,
      minimumStockAlert: alert,
      saleId: input.saleId,
      kind: "critical_level",
    };
  }
  return null;
}

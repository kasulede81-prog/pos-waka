import type { AuditAction, AuditLogEntry, Product, UserRole } from "../types";
import { dateKeyKampala } from "./datesUg";

/** Actions that change the product catalog or on-hand stock outside a sale. */
export const CATALOG_TAMPER_ACTIONS: ReadonlySet<AuditAction> = new Set([
  "product_add",
  "product_remove",
  "product_update",
  "price_change",
  "stock_adjust",
  "expired_stock_writeoff",
]);

export type ProductFieldChange = {
  field: "name" | "price" | "cost" | "stock" | "category" | "sku" | "packaging" | "other";
  from: string | number | null;
  to: string | number | null;
};

export function isCatalogTamperAction(action: AuditAction): boolean {
  return CATALOG_TAMPER_ACTIONS.has(action);
}

export function isNonOwnerCatalogEvent(entry: AuditLogEntry): boolean {
  return entry.role !== "owner";
}

export function catalogEventsForDay(
  auditLogs: AuditLogEntry[],
  dayKey: string,
  opts?: { nonOwnerOnly?: boolean },
): AuditLogEntry[] {
  return auditLogs.filter((e) => {
    if (!isCatalogTamperAction(e.action)) return false;
    if (dateKeyKampala(e.at) !== dayKey) return false;
    if (opts?.nonOwnerOnly && !isNonOwnerCatalogEvent(e)) return false;
    return true;
  });
}

export function diffProductCatalog(prev: Product, next: Product): ProductFieldChange[] {
  const changes: ProductFieldChange[] = [];
  if (prev.name !== next.name) changes.push({ field: "name", from: prev.name, to: next.name });
  if (prev.sellingPricePerUnitUgx !== next.sellingPricePerUnitUgx) {
    changes.push({ field: "price", from: prev.sellingPricePerUnitUgx, to: next.sellingPricePerUnitUgx });
  }
  if (prev.costPricePerUnitUgx !== next.costPricePerUnitUgx) {
    changes.push({ field: "cost", from: prev.costPricePerUnitUgx, to: next.costPricePerUnitUgx });
  }
  if (Math.abs(prev.stockOnHand - next.stockOnHand) > 1e-6) {
    changes.push({ field: "stock", from: prev.stockOnHand, to: next.stockOnHand });
  }
  if (prev.category !== next.category) changes.push({ field: "category", from: prev.category, to: next.category });
  if (prev.sku !== next.sku) changes.push({ field: "sku", from: prev.sku, to: next.sku });
  if (JSON.stringify(prev.pharmacyPackaging ?? null) !== JSON.stringify(next.pharmacyPackaging ?? null)) {
    changes.push({ field: "packaging", from: null, to: null });
  }
  return changes;
}

export function formatCatalogChangeField(field: ProductFieldChange["field"]): string {
  switch (field) {
    case "name":
      return "name";
    case "price":
      return "price";
    case "cost":
      return "cost";
    case "stock":
      return "stock";
    case "category":
      return "category";
    case "sku":
      return "SKU";
    case "packaging":
      return "packaging";
    default:
      return "details";
  }
}

export function formatCatalogAuditSummary(productName: string, changes: ProductFieldChange[]): string {
  if (changes.length === 0) return productName;
  const parts = changes.slice(0, 3).map((c) => {
    if (c.field === "stock" || c.field === "price" || c.field === "cost") {
      return `${c.field} ${c.from}→${c.to}`;
    }
    if (c.field === "name") return `name→${c.to}`;
    return c.field;
  });
  const tail = changes.length > 3 ? ` +${changes.length - 3}` : "";
  return `${productName}: ${parts.join(", ")}${tail}`;
}

export function isSensitiveCatalogEvent(entry: AuditLogEntry): boolean {
  if (entry.action === "product_remove") return true;
  if (entry.action === "price_change") return true;

  const pl = entry.payload;
  const changes = Array.isArray(pl.changes) ? (pl.changes as ProductFieldChange[]) : [];
  if (changes.some((c) => c.field === "price" || c.field === "stock")) return true;

  if (entry.action === "stock_adjust") {
    const delta = typeof pl.delta === "number" ? pl.delta : 0;
    if (Math.abs(delta) >= 10) return true;
  }

  if (entry.action === "product_add") {
    const bulk = pl.bulk === true;
    const stock = typeof pl.stock === "number" ? pl.stock : 0;
    if (!bulk && stock >= 50) return true;
  }

  return false;
}

export function staffCatalogCountsByRole(
  events: AuditLogEntry[],
): Map<UserRole | "unknown", number> {
  const map = new Map<UserRole | "unknown", number>();
  for (const e of events) {
    const role = e.role ?? "unknown";
    map.set(role, (map.get(role) ?? 0) + 1);
  }
  return map;
}

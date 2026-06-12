import type { AuditAction, AuditLogEntry, Customer, Product, Supplier } from "../types";
import { dateKeyKampala } from "./datesUg";

export type AuditSearchFilters = {
  dateFrom?: string;
  dateTo?: string;
  actorUserId?: string;
  action?: AuditAction | "all";
  productId?: string;
  customerId?: string;
  supplierId?: string;
  searchText?: string;
};

/** Actions shown on the staff activity feed (grouped by staff member). */
export const STAFF_ACTIVITY_ACTIONS: ReadonlySet<AuditAction> = new Set([
  "staff_login",
  "staff_logout",
  "sale_completed",
  "sale_void",
  "sale_return",
  "product_update",
  "price_change",
  "stock_adjust",
  "cash_expense_created",
  "cash_expense_voided",
  "debt_payment",
  "debt_manual_adjust",
  "purchase_saved",
  "purchase_void",
]);

export const INVESTIGATION_ACTIONS: ReadonlySet<AuditAction> = new Set([
  "sale_completed",
  "sale_void",
  "sale_return",
  "product_add",
  "product_remove",
  "product_update",
  "price_change",
  "stock_adjust",
  "purchase_saved",
  "purchase_void",
  "cash_expense_created",
  "cash_expense_voided",
  "cash_expense_approved",
  "cash_expense_rejected",
  "debt_payment",
  "debt_manual_adjust",
  "debt_reconcile",
  "supplier_add",
  "supplier_edit",
  "supplier_payment",
  "back_office_unlock",
  "back_office_unlock_success",
  "back_office_unlock_failed",
  "receipt_reprint",
  "receipt_pdf_export",
  "shift_start",
  "shift_end",
  "staff_login",
  "staff_logout",
  "discount_given",
  "expired_stock_writeoff",
  "customer_add",
  "customer_merge",
  "product_restore",
]);

function haystack(entry: AuditLogEntry): string {
  const pl = entry.payload;
  const parts = [
    entry.payloadSummary,
    entry.actorName ?? "",
    entry.actorUserId,
    entry.action,
    entry.role,
    entry.deviceId ?? "",
    typeof pl.name === "string" ? pl.name : "",
    typeof pl.productName === "string" ? pl.productName : "",
    typeof pl.supplierName === "string" ? pl.supplierName : "",
    typeof pl.reason === "string" ? pl.reason : "",
    typeof pl.note === "string" ? pl.note : "",
    JSON.stringify(pl),
  ];
  return parts.join(" ").toLowerCase();
}

function matchesEntity(
  entry: AuditLogEntry,
  filters: AuditSearchFilters,
  productById: Map<string, Product>,
  customerById: Map<string, Customer>,
  supplierById: Map<string, Supplier>,
): boolean {
  const pl = entry.payload;
  if (filters.productId) {
    const pid = typeof pl.productId === "string" ? pl.productId : "";
    if (pid === filters.productId) return true;
    const name = productById.get(filters.productId)?.name?.toLowerCase() ?? "";
    if (name && haystack(entry).includes(name)) return true;
    return false;
  }
  if (filters.customerId) {
    const cid = typeof pl.customerId === "string" ? pl.customerId : "";
    if (cid === filters.customerId) return true;
    const name = customerById.get(filters.customerId)?.name?.toLowerCase() ?? "";
    return name ? haystack(entry).includes(name) : false;
  }
  if (filters.supplierId) {
    const sid = typeof pl.supplierId === "string" ? pl.supplierId : "";
    if (sid === filters.supplierId) return true;
    const name = supplierById.get(filters.supplierId)?.name?.toLowerCase() ?? "";
    return name ? haystack(entry).includes(name) : false;
  }
  return true;
}

export function filterAuditLogs(
  auditLogs: AuditLogEntry[],
  filters: AuditSearchFilters,
  ctx?: {
    products?: Product[];
    customers?: Customer[];
    suppliers?: Supplier[];
  },
): AuditLogEntry[] {
  const productById = new Map((ctx?.products ?? []).map((p) => [p.id, p]));
  const customerById = new Map((ctx?.customers ?? []).map((c) => [c.id, c]));
  const supplierById = new Map((ctx?.suppliers ?? []).map((s) => [s.id, s]));
  const q = (filters.searchText ?? "").trim().toLowerCase();

  return auditLogs
    .filter((e) => {
      if (filters.dateFrom && dateKeyKampala(e.at) < filters.dateFrom) return false;
      if (filters.dateTo && dateKeyKampala(e.at) > filters.dateTo) return false;
      if (filters.actorUserId && filters.actorUserId !== "all" && e.actorUserId !== filters.actorUserId) {
        return false;
      }
      if (filters.action && filters.action !== "all" && e.action !== filters.action) return false;
      if (!matchesEntity(e, filters, productById, customerById, supplierById)) return false;
      if (q && !haystack(e).includes(q)) return false;
      return true;
    })
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export function uniqueAuditActors(logs: AuditLogEntry[]): Array<{ userId: string; name: string }> {
  const map = new Map<string, string>();
  for (const e of logs) {
    const id = e.actorUserId || "unknown";
    if (!map.has(id)) map.set(id, e.actorName?.trim() || id);
  }
  return [...map.entries()]
    .map(([userId, name]) => ({ userId, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function groupAuditByStaff(logs: AuditLogEntry[]): Array<{ actorId: string; actorLabel: string; entries: AuditLogEntry[] }> {
  const map = new Map<string, AuditLogEntry[]>();
  for (const e of logs) {
    const id = e.actorUserId || "unknown";
    const cur = map.get(id) ?? [];
    cur.push(e);
    map.set(id, cur);
  }
  return [...map.entries()]
    .map(([actorId, entries]) => ({
      actorId,
      actorLabel: entries[0]?.actorName?.trim() || actorId,
      entries: entries.sort((a, b) => (a.at < b.at ? 1 : -1)),
    }))
    .sort((a, b) => {
      const ta = a.entries[0]?.at ?? "";
      const tb = b.entries[0]?.at ?? "";
      return ta < tb ? 1 : ta > tb ? -1 : 0;
    });
}

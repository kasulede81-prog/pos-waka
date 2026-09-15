import type { AuditAction, AuditLogEntry, Customer, Language, Product, Supplier } from "../types";
import { dateKeyKampala } from "./datesUg";
import { describeAuditLine } from "./activityNarrative";

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

/** Max rows returned before expensive UI formatting (pagination-ready). */
export const AUDIT_FILTER_RESULT_LIMIT = 200;

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

export type AuditLogSearchIndex = {
  entries: AuditLogEntry[];
  haystacks: string[];
  dateKeys: string[];
  /** Entry indices sorted newest-first by `at`. */
  sortedIndices: number[];
  actors: Array<{ userId: string; name: string }>;
};

function haystack(
  entry: AuditLogEntry,
  ctx?: {
    productById: Map<string, Product>;
    customerById: Map<string, Customer>;
    supplierById: Map<string, Supplier>;
    lang?: Language;
  },
): string {
  const pl = entry.payload;
  const pid = typeof pl.productId === "string" ? pl.productId : "";
  const cid = typeof pl.customerId === "string" ? pl.customerId : "";
  const sid = typeof pl.supplierId === "string" ? pl.supplierId : "";
  const resolvedProduct = pid ? ctx?.productById.get(pid)?.name ?? "" : "";
  const resolvedCustomer = cid ? ctx?.customerById.get(cid)?.name ?? "" : "";
  const resolvedSupplier = sid ? ctx?.supplierById.get(sid)?.name ?? "" : "";
  const narrative =
    ctx?.lang != null
      ? describeAuditLine(
          ctx.lang,
          entry,
          new Map([...ctx.productById.entries()].map(([id, p]) => [id, { name: p.name }])),
          new Map([...ctx.customerById.entries()].map(([id, c]) => [id, { name: c.name }])),
        )
      : "";

  const parts = [
    entry.payloadSummary,
    entry.actorName ?? "",
    entry.actorUserId,
    entry.action,
    entry.role,
    typeof pl.name === "string" ? pl.name : "",
    typeof pl.productName === "string" ? pl.productName : "",
    typeof pl.supplierName === "string" ? pl.supplierName : "",
    typeof pl.customerName === "string" ? pl.customerName : "",
    resolvedProduct,
    resolvedCustomer,
    resolvedSupplier,
    typeof pl.reason === "string" ? pl.reason : "",
    typeof pl.note === "string" ? pl.note : "",
    typeof pl.category === "string" ? pl.category : "",
    narrative,
  ];
  return parts.join(" ").toLowerCase();
}

/** Precompute searchable fields once per audit log snapshot. */
export function buildAuditLogSearchIndex(
  auditLogs: AuditLogEntry[],
  ctx?: {
    products?: Product[];
    customers?: Customer[];
    suppliers?: Supplier[];
    lang?: Language;
  },
): AuditLogSearchIndex {
  const productById = new Map((ctx?.products ?? []).map((p) => [p.id, p]));
  const customerById = new Map((ctx?.customers ?? []).map((c) => [c.id, c]));
  const supplierById = new Map((ctx?.suppliers ?? []).map((s) => [s.id, s]));
  const searchCtx = { productById, customerById, supplierById, lang: ctx?.lang };

  const haystacks: string[] = new Array(auditLogs.length);
  const dateKeys: string[] = new Array(auditLogs.length);
  const sortedIndices = auditLogs.map((_, i) => i);

  sortedIndices.sort((a, b) => {
    const at = auditLogs[a]!.at;
    const bt = auditLogs[b]!.at;
    return at < bt ? 1 : at > bt ? -1 : 0;
  });

  const actorMap = new Map<string, string>();
  for (let i = 0; i < auditLogs.length; i += 1) {
    const e = auditLogs[i]!;
    haystacks[i] = haystack(e, searchCtx);
    dateKeys[i] = dateKeyKampala(e.at);
    const id = e.actorUserId || "unknown";
    if (!actorMap.has(id)) actorMap.set(id, e.actorName?.trim() || id);
  }

  const actors = [...actorMap.entries()]
    .map(([userId, name]) => ({ userId, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { entries: auditLogs, haystacks, dateKeys, sortedIndices, actors };
}

function matchesEntityIndexed(
  entry: AuditLogEntry,
  hay: string,
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
    if (name && hay.includes(name)) return true;
    return false;
  }
  if (filters.customerId) {
    const cid = typeof pl.customerId === "string" ? pl.customerId : "";
    if (cid === filters.customerId) return true;
    const name = customerById.get(filters.customerId)?.name?.toLowerCase() ?? "";
    return name ? hay.includes(name) : false;
  }
  if (filters.supplierId) {
    const sid = typeof pl.supplierId === "string" ? pl.supplierId : "";
    if (sid === filters.supplierId) return true;
    const name = supplierById.get(filters.supplierId)?.name?.toLowerCase() ?? "";
    return name ? hay.includes(name) : false;
  }
  return true;
}

export function filterAuditLogsIndexed(
  index: AuditLogSearchIndex,
  filters: AuditSearchFilters,
  ctx?: {
    products?: Product[];
    customers?: Customer[];
    suppliers?: Supplier[];
    lang?: Language;
  },
  limit: number = AUDIT_FILTER_RESULT_LIMIT,
): AuditLogEntry[] {
  const productById = new Map((ctx?.products ?? []).map((p) => [p.id, p]));
  const customerById = new Map((ctx?.customers ?? []).map((c) => [c.id, c]));
  const supplierById = new Map((ctx?.suppliers ?? []).map((s) => [s.id, s]));
  const q = (filters.searchText ?? "").trim().toLowerCase();
  const actorFilter = filters.actorUserId && filters.actorUserId !== "all" ? filters.actorUserId : null;
  const actionFilter = filters.action && filters.action !== "all" ? filters.action : null;

  const out: AuditLogEntry[] = [];
  for (const idx of index.sortedIndices) {
    if (out.length >= limit) break;
    const e = index.entries[idx]!;
    const dk = index.dateKeys[idx]!;
    if (filters.dateFrom && dk < filters.dateFrom) continue;
    if (filters.dateTo && dk > filters.dateTo) continue;
    if (actorFilter && e.actorUserId !== actorFilter) continue;
    if (actionFilter && e.action !== actionFilter) continue;
    if (!matchesEntityIndexed(e, index.haystacks[idx]!, filters, productById, customerById, supplierById)) continue;
    if (q && !index.haystacks[idx]!.includes(q)) continue;
    out.push(e);
  }
  return out;
}

export function filterAuditLogs(
  auditLogs: AuditLogEntry[],
  filters: AuditSearchFilters,
  ctx?: {
    products?: Product[];
    customers?: Customer[];
    suppliers?: Supplier[];
    lang?: Language;
  },
  limit?: number,
): AuditLogEntry[] {
  if (auditLogs.length === 0) return [];
  const index = buildAuditLogSearchIndex(auditLogs, ctx);
  return filterAuditLogsIndexed(index, filters, ctx, limit ?? Number.MAX_SAFE_INTEGER);
}

export function uniqueAuditActors(logs: AuditLogEntry[]): Array<{ userId: string; name: string }> {
  return buildAuditLogSearchIndex(logs).actors;
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

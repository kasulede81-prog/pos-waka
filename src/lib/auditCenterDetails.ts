import type { AuditLogEntry, Language } from "../types";
import { describeAuditLine } from "./activityNarrative";
import { t } from "./i18n";

export type AuditDetailRow = {
  before: string | null;
  after: string | null;
  reason: string | null;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  deviceId: string | null;
  payloadJson: string;
};

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

export function extractAuditDetails(entry: AuditLogEntry): AuditDetailRow {
  const pl = entry.payload;
  const reason = str(pl.reason) ?? str(pl.note) ?? str(pl.voidReason) ?? null;
  let before: string | null = null;
  let after: string | null = null;

  if (typeof pl.priceBefore === "number" || typeof pl.priceAfter === "number") {
    before = pl.priceBefore != null ? String(pl.priceBefore) : null;
    after = pl.priceAfter != null ? String(pl.priceAfter) : null;
  } else if (typeof pl.stockBefore === "number" || typeof pl.stockAfter === "number") {
    before = pl.stockBefore != null ? String(pl.stockBefore) : null;
    after = pl.stockAfter != null ? String(pl.stockAfter) : null;
  } else if (Array.isArray(pl.changes)) {
    const lines = (pl.changes as Array<{ field?: string; from?: unknown; to?: unknown }>).map(
      (c) => `${c.field ?? "?"}: ${String(c.from ?? "—")} → ${String(c.to ?? "—")}`,
    );
    if (lines.length) {
      before = lines.join("; ");
      after = null;
    }
  } else if (Array.isArray(pl.mismatches)) {
    before = JSON.stringify(pl.mismatches);
    after = str(pl.healedCount);
  }

  const entityType =
    pl.productId != null
      ? "product"
      : pl.customerId != null
        ? "customer"
        : pl.supplierId != null
          ? "supplier"
          : pl.saleId != null
            ? "sale"
            : pl.expenseId != null
              ? "expense"
              : pl.purchaseId != null
                ? "purchase"
                : null;

  const entityId =
    str(pl.productId) ??
    str(pl.customerId) ??
    str(pl.supplierId) ??
    str(pl.saleId) ??
    str(pl.expenseId) ??
    str(pl.purchaseId);

  const entityLabel =
    str(pl.name) ??
    str(pl.productName) ??
    str(pl.supplierName) ??
    str(pl.customerName) ??
    entry.payloadSummary;

  return {
    before,
    after,
    reason,
    entityType,
    entityId,
    entityLabel,
    deviceId: entry.deviceId ?? null,
    payloadJson: JSON.stringify(pl, null, 2),
  };
}

export function auditActionLabel(lang: Language, action: string): string {
  const key = `auditAction_${action}` as Parameters<typeof t>[1];
  const label = t(lang, key);
  return label === key ? action : label;
}

export function formatAuditRowSummary(
  lang: Language,
  entry: AuditLogEntry,
  ctx?: {
    productById?: Map<string, { name: string }>;
    customerById?: Map<string, { name: string }>;
  },
): string {
  const products = ctx?.productById ?? new Map<string, { name: string }>();
  const customers = ctx?.customerById ?? new Map<string, { name: string }>();
  return describeAuditLine(lang, entry, products, customers);
}

export function formatAuditBeforeAfter(before: string | null, after: string | null): { before: string | null; after: string | null } {
  const fmt = (v: string | null) => {
    if (v == null) return null;
    const n = Number(v);
    if (Number.isFinite(n) && String(n) === v.trim()) return `UGX ${Math.round(n).toLocaleString()}`;
    return v;
  };
  return { before: fmt(before), after: fmt(after) };
}

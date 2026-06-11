import type { AuditLogEntry, Language } from "../types";
import { dateKeyKampala } from "./datesUg";
import type { ProductFieldChange } from "./catalogAudit";
import { t, tTemplate } from "./i18n";

export function actorDisplayLabel(actorUserId: string, lang: Language): string {
  if (!actorUserId || actorUserId === "unknown") return t(lang, "actorUnknown");
  if (actorUserId.startsWith("local:")) {
    const rest = actorUserId.slice("local:".length).trim();
    return rest || t(lang, "actorTeam");
  }
  return `${actorUserId.slice(0, 6)}…`;
}

function actorLabelFromParts(actorUserId: string, actorName: string | undefined, lang: Language): string {
  if (actorName?.trim()) return actorName.trim();
  return actorDisplayLabel(actorUserId, lang);
}

function formatChangeLine(lang: Language, c: ProductFieldChange): string {
  if (c.field === "price") {
    return tTemplate(lang, "narrativeChangePrice", {
      from: String(c.from ?? "—"),
      to: String(c.to ?? "—"),
    });
  }
  if (c.field === "stock") {
    return tTemplate(lang, "narrativeChangeStock", {
      from: String(c.from ?? "—"),
      to: String(c.to ?? "—"),
    });
  }
  if (c.field === "name") {
    return tTemplate(lang, "narrativeChangeName", { name: String(c.to ?? "—") });
  }
  return `${c.field}: ${String(c.from ?? "—")} → ${String(c.to ?? "—")}`;
}

function changesFromPayload(pl: Record<string, unknown>): ProductFieldChange[] {
  if (!Array.isArray(pl.changes)) return [];
  return pl.changes.filter(
    (c): c is ProductFieldChange =>
      !!c &&
      typeof c === "object" &&
      typeof (c as ProductFieldChange).field === "string",
  );
}
function productNameFromPayload(
  lang: Language,
  payload: Record<string, unknown>,
  productById: Map<string, { name: string }>,
): string {
): string {
  const id = typeof payload.productId === "string" ? payload.productId : "";
  const fromMap = id ? productById.get(id)?.name : undefined;
  const n = typeof payload.name === "string" ? payload.name : "";
  return fromMap ?? n ?? t(lang, "productUnnamed");
}

/** One friendly line per audit row (for timelines). */
export function describeAuditLine(
  lang: Language,
  e: AuditLogEntry,
  productById: Map<string, { name: string }>,
  customerById: Map<string, { name: string }>,
): string {
  const pl = e.payload;
  switch (e.action) {
    case "sale_completed": {
      const total = typeof pl.totalUgx === "number" ? pl.totalUgx : 0;
      const count = typeof pl.lineCount === "number" ? pl.lineCount : 0;
      const debt = typeof pl.debtUgx === "number" ? pl.debtUgx : 0;
      const firstLineName = typeof pl.firstLineName === "string" ? pl.firstLineName : "";
      if (total < 0) {
        return tTemplate(lang, "narrativeRefundLike", { amount: Math.abs(total).toLocaleString() });
      }
      if (debt > 0 && total > 0) {
        return tTemplate(lang, "narrativeSaleCredit", {
          amount: total.toLocaleString(),
          credit: debt.toLocaleString(),
        });
      }
      if (firstLineName) {
        return tTemplate(lang, "narrativeSaleItem", {
          product: firstLineName,
          amount: total.toLocaleString(),
        });
      }
      return tTemplate(lang, "narrativeSaleCash", {
        count: String(Math.max(1, count)),
        amount: total.toLocaleString(),
      });
    }
    case "stock_adjust": {
      const delta = typeof pl.delta === "number" ? pl.delta : 0;
      const name = productNameFromPayload(lang, pl, productById);
      if (delta < 0) {
        return tTemplate(lang, "narrativeStockDown", { product: name, amount: String(Math.abs(delta)) });
      }
      return tTemplate(lang, "narrativeStockUp", { product: name, amount: String(delta) });
    }
    case "debt_payment": {
      const pay = typeof pl.amountUgx === "number" ? pl.amountUgx : 0;
      return tTemplate(lang, "narrativeDebtPaid", { amount: pay.toLocaleString() });
    }
    case "day_close": {
      const dk = typeof pl.dateKey === "string" ? pl.dateKey : "";
      return tTemplate(lang, "narrativeDayClosed", { date: dk || "—" });
    }
    case "back_office_unlock":
      return t(lang, "narrativeBackOfficeUnlock");
    case "shift_start":
      return t(lang, "narrativeShiftStart");
    case "shift_end":
      return t(lang, "narrativeShiftEnd");
    case "product_add": {
      const name = typeof pl.name === "string" ? pl.name : productNameFromPayload(lang, pl, productById);
      if (pl.bulk === true) {
        const added = typeof pl.added === "number" ? pl.added : 0;
        return tTemplate(lang, "narrativeBulkProductsAdded", { count: String(added) });
      }
      const stock = typeof pl.stock === "number" ? pl.stock : null;
      const price = typeof pl.priceUgx === "number" ? pl.priceUgx : null;
      if (stock != null && price != null) {
        return tTemplate(lang, "narrativeProductAddedDetail", {
          product: name,
          stock: String(stock),
          price: price.toLocaleString(),
        });
      }
      return tTemplate(lang, "narrativeProductAdded", { product: name });
    }
    case "product_remove": {
      const name = typeof pl.name === "string" ? pl.name : e.payloadSummary;
      const stock = typeof pl.stock === "number" ? pl.stock : null;
      if (stock != null) {
        return tTemplate(lang, "narrativeProductRemovedDetail", { product: name, stock: String(stock) });
      }
      return tTemplate(lang, "narrativeProductRemoved", { product: name });
    }
    case "product_presets": {
      const name = productNameFromPayload(lang, pl, productById);
      return tTemplate(lang, "narrativePresets", { product: name });
    }
    case "product_update": {
      const name = productNameFromPayload(lang, pl, productById);
      const changes = changesFromPayload(pl);
      if (changes.length > 0) {
        const detail = changes.slice(0, 2).map((c) => formatChangeLine(lang, c)).join(" · ");
        return tTemplate(lang, "narrativeProductUpdatedDetail", { product: name, detail });
      }
      return tTemplate(lang, "narrativeProductUpdated", { product: name });
    }
    case "price_change": {
      const name = productNameFromPayload(lang, pl, productById);
      const before = typeof pl.priceBefore === "number" ? pl.priceBefore : null;
      const after = typeof pl.priceAfter === "number" ? pl.priceAfter : null;
      if (before != null && after != null) {
        return tTemplate(lang, "narrativePriceChanged", {
          product: name,
          from: before.toLocaleString(),
          to: after.toLocaleString(),
        });
      }
      return tTemplate(lang, "narrativeProductUpdated", { product: name });
    }
    case "customer_add": {
      const cid = typeof pl.customerId === "string" ? pl.customerId : "";
      const name =
        (typeof pl.name === "string" ? pl.name : "") || (cid ? customerById.get(cid)?.name : "") || e.payloadSummary;
      return tTemplate(lang, "narrativeCustomerAdded", { name });
    }
    case "supplier_add": {
      const name = typeof pl.name === "string" ? pl.name : e.payloadSummary;
      return tTemplate(lang, "narrativeSupplierAdded", { name });
    }
    case "purchase_saved": {
      const total = typeof pl.totalCostUgx === "number" ? pl.totalCostUgx : 0;
      const paid = typeof pl.amountPaidUgx === "number" ? pl.amountPaidUgx : 0;
      const lines = typeof pl.lineCount === "number" ? pl.lineCount : 0;
      const supplier = typeof pl.supplierName === "string" ? pl.supplierName : "";
      return tTemplate(lang, "narrativePurchaseSaved", {
        lines: String(Math.max(1, lines)),
        total: total.toLocaleString(),
        paid: paid.toLocaleString(),
        supplier: supplier || "—",
      });
    }
    case "supplier_payment": {
      const pay = typeof pl.amountUgx === "number" ? pl.amountUgx : 0;
      const supplier = typeof pl.supplierName === "string" ? pl.supplierName : "";
      return tTemplate(lang, "narrativeSupplierPaid", {
        amount: pay.toLocaleString(),
        supplier: supplier || t(lang, "supplierGeneric"),
      });
    }
    default:
      return e.payloadSummary;
  }
}

export type ActivityTimelineGroup = {
  id: string;
  bucketKey: "lastHour" | "todayEarlier" | "older";
  bucketLabel: string;
  actorLabel: string;
  lines: string[];
  /** Latest event time in group (ISO) */
  at: string;
};

const HOUR_MS = 60 * 60 * 1000;

function bucketForAudit(atIso: string, now: number, todayKey: string): ActivityTimelineGroup["bucketKey"] {
  const t0 = new Date(atIso).getTime();
  if (Number.isNaN(t0)) return "older";
  if (now - t0 < HOUR_MS) return "lastHour";
  if (dateKeyKampala(atIso) === todayKey) return "todayEarlier";
  return "older";
}

function bucketLabel(key: ActivityTimelineGroup["bucketKey"], lang: Language): string {
  if (key === "lastHour") return t(lang, "activityBucketLastHour");
  if (key === "todayEarlier") return t(lang, "activityBucketToday");
  return t(lang, "activityBucketEarlier");
}

/**
 * Groups audit rows by time bucket + actor for a calmer, human-friendly feed.
 */
export function buildGroupedActivityTimeline(
  lang: Language,
  auditLogs: AuditLogEntry[],
  productById: Map<string, { name: string }>,
  customerById: Map<string, { name: string }>,
  opts?: { maxGroups?: number },
): ActivityTimelineGroup[] {
  const maxGroups = opts?.maxGroups ?? 14;
  const now = Date.now();
  const todayKey = dateKeyKampala(new Date());

  const sorted = [...auditLogs].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  type Proto = {
    bucketKey: ActivityTimelineGroup["bucketKey"];
    actorId: string;
    actorName?: string;
    lines: string[];
    at: string;
  };

  const protos: Proto[] = [];
  const keyOf = (p: Proto) => `${p.bucketKey}|${p.actorId}`;

  for (const e of sorted) {
    const bk = bucketForAudit(e.at, now, todayKey);
    const line = describeAuditLine(lang, e, productById, customerById);
    const actorId = e.actorUserId || "unknown";
    const last = protos[protos.length - 1];
    if (last && keyOf(last) === `${bk}|${actorId}` && last.lines.length < 4) {
      last.lines.push(line);
      if (new Date(e.at) > new Date(last.at)) last.at = e.at;
    } else {
      protos.push({ bucketKey: bk, actorId: e.actorUserId || "unknown", actorName: e.actorName, lines: [line], at: e.at });
    }
    if (protos.length >= maxGroups * 2) break;
  }

  const out: ActivityTimelineGroup[] = protos.slice(0, maxGroups).map((p, i) => ({
    id: `${p.bucketKey}-${p.actorId}-${i}`,
    bucketKey: p.bucketKey,
    bucketLabel: bucketLabel(p.bucketKey, lang),
    actorLabel: actorLabelFromParts(p.actorId, p.actorName, lang),
    lines: p.lines,
    at: p.at,
  }));

  return out;
}

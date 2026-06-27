import type { AuditAction, AuditLogEntry, Language } from "../../../types";
import type { AuditLogSearchIndex } from "../../../lib/auditSearch";
import { dateKeyKampala } from "../../../lib/datesUg";
import { t } from "../../../lib/i18n";
import {
  extractAuditDetails,
  auditActionLabel,
  formatAuditBeforeAfter,
  formatAuditRowSummary,
} from "../../../lib/auditCenterDetails";
import { actorDisplayLabel } from "../../../lib/activityNarrative";
import { formatAuditDeviceLabel } from "../../../lib/auditDeviceLabel";
import { buildAuditCsv } from "../../../lib/auditExport";
import type {
  ActivitySeverity,
  InvestigationCategory,
  InvestigationKpiCard,
  InvestigationKpiId,
  TimelineRow,
} from "../types";

const SALES: ReadonlySet<AuditAction> = new Set(["sale_completed", "sale_void", "receipt_reprint", "receipt_pdf_export"]);
const INVENTORY: ReadonlySet<AuditAction> = new Set([
  "stock_adjust",
  "expired_stock_writeoff",
  "inventory_count_started",
  "inventory_count_submitted",
  "inventory_count_approved",
  "inventory_count_applied",
  "inventory_count_cancelled",
]);
const PRODUCTS: ReadonlySet<AuditAction> = new Set([
  "product_add",
  "product_remove",
  "product_update",
  "product_presets",
  "product_restore",
]);
const PURCHASES: ReadonlySet<AuditAction> = new Set(["purchase_saved", "purchase_void"]);
const SUPPLIERS: ReadonlySet<AuditAction> = new Set(["supplier_add", "supplier_edit", "supplier_payment"]);
const CUSTOMERS: ReadonlySet<AuditAction> = new Set(["customer_add", "customer_merge"]);
const DEBTS: ReadonlySet<AuditAction> = new Set(["debt_payment", "debt_manual_adjust", "debt_reconcile"]);
const EXPENSES: ReadonlySet<AuditAction> = new Set([
  "cash_expense_created",
  "cash_expense_voided",
  "cash_expense_approved",
  "cash_expense_rejected",
  "cash_expense_edited",
]);
const CASH_DRAWER: ReadonlySet<AuditAction> = new Set(["cash_drawer_adjustment", "shift_start", "shift_end", "shift_close_count"]);
const REFUNDS: ReadonlySet<AuditAction> = new Set(["sale_return", "sale_refund"]);
const DISCOUNTS: ReadonlySet<AuditAction> = new Set(["discount_given"]);
const PRICE_CHANGES: ReadonlySet<AuditAction> = new Set(["price_change"]);
const RETURNS: ReadonlySet<AuditAction> = new Set(["sale_return"]);
const AUTH: ReadonlySet<AuditAction> = new Set(["staff_login", "staff_logout"]);
const SECURITY: ReadonlySet<AuditAction> = new Set([
  "back_office_unlock",
  "back_office_unlock_success",
  "back_office_unlock_failed",
  "auth_forbidden",
  "device_viewed",
  "device_disconnected",
  "device_reactivated",
  "device_heartbeat_rejected",
  "device_limit_hit",
  "device_login_blocked",
  "device_replacement_completed",
  "device_new_activation",
  "device_suspicious_fingerprint",
]);
const USERS: ReadonlySet<AuditAction> = new Set(["staff_login", "staff_logout"]);
const PERMISSIONS: ReadonlySet<AuditAction> = new Set(["auth_forbidden"]);
const SETTINGS: ReadonlySet<AuditAction> = new Set(["day_close", "day_close_override", "day_close_preflight_warning"]);
const CLOUD_SYNC: ReadonlySet<AuditAction> = new Set(["sync_unknown_operation"]);
const SYSTEM: ReadonlySet<AuditAction> = new Set([
  "archive_purge",
  "archive_purge_blocked",
  "day_close_preflight_warning",
]);

const ERROR_ACTIONS: ReadonlySet<AuditAction> = new Set([
  "sale_void",
  "purchase_void",
  "cash_expense_voided",
  "cash_expense_rejected",
  "back_office_unlock_failed",
  "auth_forbidden",
  "archive_purge_blocked",
  "device_heartbeat_rejected",
  "device_login_blocked",
  "device_limit_hit",
  "sync_unknown_operation",
]);

const WARNING_ACTIONS: ReadonlySet<AuditAction> = new Set([
  "discount_given",
  "price_change",
  "stock_adjust",
  "debt_manual_adjust",
  "day_close_preflight_warning",
  "day_close_override",
  "device_suspicious_fingerprint",
  "cash_drawer_adjustment",
]);

const FAILED_SYNC_ACTIONS: ReadonlySet<AuditAction> = new Set(["sync_unknown_operation"]);

const CATEGORY_SETS: Partial<Record<InvestigationCategory, ReadonlySet<AuditAction>>> = {
  sales: SALES,
  inventory: INVENTORY,
  products: PRODUCTS,
  purchases: PURCHASES,
  suppliers: SUPPLIERS,
  customers: CUSTOMERS,
  debts: DEBTS,
  payments: new Set<AuditAction>(["debt_payment", "supplier_payment", "debt_reconcile"]),
  expenses: EXPENSES,
  cash_drawer: CASH_DRAWER,
  refunds: REFUNDS,
  discounts: DISCOUNTS,
  price_changes: PRICE_CHANGES,
  returns: RETURNS,
  authentication: AUTH,
  security: SECURITY,
  users: USERS,
  permissions: PERMISSIONS,
  settings: SETTINGS,
  cloud_sync: CLOUD_SYNC,
  system: SYSTEM,
};

export function categoryLabelKey(category: InvestigationCategory): string {
  if (category === "all") return "icCategoryAll";
  return `icCategory_${category}`;
}

export function matchesCategory(entry: AuditLogEntry, category: InvestigationCategory): boolean {
  if (category === "all") return true;
  if (category === "errors") return getActivitySeverity(entry) === "error";
  if (category === "warnings") return getActivitySeverity(entry) === "warning";
  const set = CATEGORY_SETS[category];
  return set ? set.has(entry.action) : false;
}

export function getActivitySeverity(entry: AuditLogEntry): ActivitySeverity {
  if (ERROR_ACTIONS.has(entry.action) || entry.action === "auth_forbidden") return "error";
  if (SECURITY.has(entry.action)) return "security";
  if (WARNING_ACTIONS.has(entry.action)) return "warning";
  if (
    entry.action === "sale_completed" ||
    entry.action === "debt_payment" ||
    entry.action === "purchase_saved" ||
    entry.action === "inventory_count_applied" ||
    entry.action === "back_office_unlock_success" ||
    entry.action === "staff_login"
  ) {
    return "completed";
  }
  return "info";
}

export function severityLabelKey(severity: ActivitySeverity): string {
  if (severity === "completed") return "icStatusCompleted";
  if (severity === "info") return "icStatusInfo";
  if (severity === "warning") return "icStatusWarning";
  if (severity === "security") return "icStatusSecurity";
  return "icStatusError";
}

export function severityBadgeClass(severity: ActivitySeverity): string {
  if (severity === "completed") return "bg-emerald-50 text-emerald-800 ring-emerald-200/80";
  if (severity === "info") return "bg-sky-50 text-sky-800 ring-sky-200/80";
  if (severity === "warning") return "bg-amber-50 text-amber-900 ring-amber-200/80";
  if (severity === "security") return "bg-violet-50 text-violet-800 ring-violet-200/80";
  return "bg-rose-50 text-rose-800 ring-rose-200/80";
}

export function severityIconClass(severity: ActivitySeverity): string {
  if (severity === "completed") return "bg-emerald-100 text-emerald-700";
  if (severity === "info") return "bg-sky-100 text-sky-700";
  if (severity === "warning") return "bg-amber-100 text-amber-700";
  if (severity === "security") return "bg-violet-100 text-violet-700";
  return "bg-rose-100 text-rose-700";
}

export function applyKpiFilter(
  entries: AuditLogEntry[],
  kpiId: InvestigationKpiId | null,
  todayKey: string,
): AuditLogEntry[] {
  if (!kpiId) return entries;
  if (kpiId === "activities_today") {
    return entries.filter((e) => dateKeyKampala(e.at) === todayKey);
  }
  if (kpiId === "sales") return entries.filter((e) => SALES.has(e.action) || e.action === "sale_completed");
  if (kpiId === "inventory") return entries.filter((e) => INVENTORY.has(e.action));
  if (kpiId === "security") return entries.filter((e) => SECURITY.has(e.action));
  if (kpiId === "warnings") return entries.filter((e) => getActivitySeverity(e) === "warning");
  if (kpiId === "errors") return entries.filter((e) => getActivitySeverity(e) === "error");
  if (kpiId === "failed_syncs") return entries.filter((e) => FAILED_SYNC_ACTIONS.has(e.action));
  if (kpiId === "refunds") return entries.filter((e) => REFUNDS.has(e.action));
  return entries;
}

export function computeInvestigationKpis(
  index: AuditLogSearchIndex,
  dateFrom: string,
  dateTo: string,
  refundsCount: number,
): InvestigationKpiCard[] {
  const todayKey = dateKeyKampala(new Date());
  let activitiesToday = 0;
  let sales = 0;
  let inventory = 0;
  let security = 0;
  let warnings = 0;
  let errors = 0;
  let failedSyncs = 0;

  for (const idx of index.sortedIndices) {
    const e = index.entries[idx]!;
    const dk = index.dateKeys[idx]!;
    if (dk < dateFrom || dk > dateTo) continue;
    if (dk === todayKey) activitiesToday += 1;
    if (SALES.has(e.action) || e.action === "sale_completed") sales += 1;
    if (INVENTORY.has(e.action)) inventory += 1;
    if (SECURITY.has(e.action)) security += 1;
    if (getActivitySeverity(e) === "warning") warnings += 1;
    if (getActivitySeverity(e) === "error") errors += 1;
    if (FAILED_SYNC_ACTIONS.has(e.action)) failedSyncs += 1;
  }

  return [
    { id: "activities_today", labelKey: "icKpiActivitiesToday", value: activitiesToday, iconTone: "orange" },
    { id: "sales", labelKey: "icKpiSales", value: sales, iconTone: "green" },
    { id: "inventory", labelKey: "icKpiInventory", value: inventory, iconTone: "slate" },
    { id: "security", labelKey: "icKpiSecurity", value: security, iconTone: "purple" },
    { id: "warnings", labelKey: "icKpiWarnings", value: warnings, iconTone: "yellow" },
    { id: "errors", labelKey: "icKpiErrors", value: errors, iconTone: "red" },
    { id: "failed_syncs", labelKey: "icKpiFailedSyncs", value: failedSyncs, iconTone: "red" },
    { id: "refunds", labelKey: "icKpiRefunds", value: refundsCount, iconTone: "orange" },
  ];
}

export function dateGroupLabel(lang: Language, dateKey: string, todayKey: string, yesterdayKey: string): string {
  if (dateKey === todayKey) return t(lang, "dateFilterPresetToday");
  if (dateKey === yesterdayKey) return t(lang, "dateFilterPresetYesterday");
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

export function buildTimelineRows(
  lang: Language,
  entries: AuditLogEntry[],
): { rows: TimelineRow[]; entryByIndex: AuditLogEntry[] } {
  const todayKey = dateKeyKampala(new Date());
  const yesterdayKey = dateKeyKampala(new Date(Date.now() - 86_400_000));
  const rows: TimelineRow[] = [];
  const entryByIndex: AuditLogEntry[] = [];
  let lastGroup: string | null = null;

  for (const entry of entries) {
    const dk = dateKeyKampala(entry.at);
    if (dk !== lastGroup) {
      lastGroup = dk;
      rows.push({
        kind: "header",
        id: `h-${dk}`,
        label: dateGroupLabel(lang, dk, todayKey, yesterdayKey),
      });
    }
    entryByIndex.push(entry);
    rows.push({ kind: "entry", id: entry.id, entryIndex: entryByIndex.length - 1 });
  }

  return { rows, entryByIndex };
}

export function buildActivityDetailText(
  lang: Language,
  entry: AuditLogEntry,
  ctx?: {
    productById?: Map<string, { name: string }>;
    customerById?: Map<string, { name: string }>;
  },
): string {
  const detail = extractAuditDetails(entry);
  const staff = entry.actorName?.trim() || actorDisplayLabel(entry.actorUserId, lang);
  const when = new Date(entry.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const summary = formatAuditRowSummary(lang, entry, ctx);
  const { before, after } = formatAuditBeforeAfter(detail.before, detail.after);
  const deviceLabel = formatAuditDeviceLabel(detail.deviceId ?? entry.deviceId, entry.payload);
  const lines = [
    auditActionLabel(lang, entry.action),
    summary,
    `${t(lang, "auditColWho")}: ${staff}`,
    `${t(lang, "auditColRole")}: ${entry.role}`,
    `${t(lang, "auditColWhen")}: ${when}`,
  ];
  if (before) lines.push(`${t(lang, "auditExportColBefore")}: ${before}`);
  if (after) lines.push(`${t(lang, "auditExportColAfter")}: ${after}`);
  if (detail.reason) lines.push(`${t(lang, "auditExportColReason")}: ${detail.reason}`);
  if (deviceLabel) lines.push(`${t(lang, "auditColDevice")}: ${deviceLabel}`);
  if (detail.entityLabel) lines.push(`${t(lang, "auditColEntity")}: ${detail.entityLabel}`);
  lines.push(`${t(lang, "icReferenceId")}: ${entry.id}`);
  return lines.join("\n");
}

export function buildEventTimelineSteps(lang: Language, action: AuditAction): string[] {
  if (action === "sale_completed") {
    return [
      t(lang, "icStepSaleCreated"),
      t(lang, "icStepPaymentCaptured"),
      t(lang, "icStepStockDeducted"),
      t(lang, "icStepSaleCompleted"),
    ];
  }
  if (action === "purchase_saved") {
    return [t(lang, "icStepPurchaseCreated"), t(lang, "icStepStockReceived"), t(lang, "icStepPurchaseSaved")];
  }
  if (action === "stock_adjust") {
    return [t(lang, "icStepAdjustStarted"), t(lang, "icStepStockUpdated")];
  }
  if (action === "price_change") {
    return [t(lang, "icStepPriceReviewed"), t(lang, "icStepPriceUpdated")];
  }
  if (action === "staff_login") {
    return [t(lang, "icStepAuthRequested"), t(lang, "icStepLoginSuccess")];
  }
  return [auditActionLabel(lang, action)];
}

export function buildAuditJsonExport(lang: Language, entries: AuditLogEntry[]): string {
  const rows = entries.map((e) => {
    const d = extractAuditDetails(e);
    return {
      id: e.id,
      at: e.at,
      action: e.action,
      actionLabel: auditActionLabel(lang, e.action),
      actor: e.actorName?.trim() || actorDisplayLabel(e.actorUserId, lang),
      role: e.role,
      summary: e.payloadSummary,
      before: d.before,
      after: d.after,
      reason: d.reason,
      deviceId: d.deviceId ?? e.deviceId ?? null,
      entity: d.entityLabel,
      payload: e.payload,
    };
  });
  return JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, entries: rows }, null, 2);
}

export function buildAuditPrintHtml(lang: Language, entries: AuditLogEntry[], shopName: string): string {
  const rows = entries
    .map((e) => {
      const staff = e.actorName?.trim() || actorDisplayLabel(e.actorUserId, lang);
      const when = new Date(e.at).toLocaleString();
      return `<tr>
        <td>${when}</td>
        <td>${staff}</td>
        <td>${auditActionLabel(lang, e.action)}</td>
        <td>${e.payloadSummary}</td>
      </tr>`;
    })
    .join("");
  return `<h1>${shopName} — ${t(lang, "auditCenterTitle")}</h1>
    <p>${t(lang, "auditResultCount")}: ${entries.length}</p>
    <table border="1" cellpadding="6" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr><th>${t(lang, "auditExportColTimestamp")}</th><th>${t(lang, "auditExportColStaff")}</th><th>${t(lang, "auditExportColAction")}</th><th>${t(lang, "auditExportColSummary")}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export function buildExcelCompatibleCsv(lang: Language, entries: AuditLogEntry[]): string {
  return `\uFEFF${buildAuditCsv(lang, entries)}`;
}

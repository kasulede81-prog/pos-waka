import type { AuditLogEntry, Language } from "../types";
import { t, tTemplate } from "./i18n";

/** Store mutation / settings keys logged on auth_forbidden rows. */
const DENIED_MUTATION_KEYS = [
  "setPreferences",
  "runDataArchive",
  "permanentlyDeleteArchived",
  "addStaffAccount",
  "updateStaffAccount",
  "removeStaffAccount",
  "resetStaffSecret",
  "addProduct",
  "addCashExpense",
  "beginShift",
  "closeShiftWithCashCount",
  "finalizeDraftSale",
  "voidSaleLine",
  "returnProduct",
  "quickAddProduct",
  "duplicateProduct",
  "removeProduct",
  "updateProductQuickPresets",
  "updateProduct",
  "adjustStock",
  "writeOffExpiredStock",
  "addCustomer",
  "assignOrphanDebtSale",
  "addDebtPayment",
  "addSupplier",
  "updateSupplier",
  "addSupplierPayment",
  "voidPurchase",
  "recordPurchase",
  "addCashDrawerAdjustment",
  "approveCashExpense",
  "rejectCashExpense",
  "voidCashExpense",
  "recordDayClose",
  "repairCustomerDebtIntegrity",
  "recordDayDrawerOpen",
  "supersedeDayDrawerOpen",
  "voidDayDrawerOpen",
  "openTable",
  "openNamedTab",
  "resumeTableSession",
  "saveTableBill",
  "fireTableKitchenTickets",
  "requestTableBill",
  "transferTableSession",
  "mergeTableSessions",
  "updateKitchenTicketStatus",
  "cancelKitchenTicket",
  "cleanupKitchenTickets",
  "addDiningArea",
  "renameDiningArea",
  "removeDiningArea",
  "addDiningTable",
  "updateDiningTable",
  "removeDiningTable",
  "savePendingSale",
  "resumePendingSale",
  "cancelPendingSale",
  "backup persist",
  "backup restore",
] as const;

function mutationLabel(lang: Language, mutation: string): string | null {
  const normalized = mutation.trim();
  if (!normalized) return null;
  const slug = normalized.replace(/\s+/g, "_").replace(/[^\w_]/g, "");
  const key = `auditDeniedMutation_${slug}` as Parameters<typeof t>[1];
  const label = t(lang, key);
  return label === key ? null : label;
}

function parseDeniedSummary(summary: string): { mutation: string; note: string | null } | null {
  const trimmed = summary.trim();
  if (!trimmed.toLowerCase().startsWith("denied ")) return null;
  let rest = trimmed.slice("Denied ".length).trim();
  let note: string | null = null;
  const paren = rest.match(/^(.+?)\s+\((.+)\)$/);
  if (paren) {
    rest = paren[1]?.trim() ?? rest;
    note = paren[2]?.trim() ?? null;
  } else if (rest.includes(" — ")) {
    const parts = rest.split(" — ");
    rest = parts[0]?.trim() ?? rest;
    note = parts.slice(1).join(" — ").trim() || null;
  }
  return { mutation: rest, note };
}

function planLimitNoteLabel(lang: Language, note: string | null): string | null {
  if (!note) return null;
  const lower = note.toLowerCase();
  if (lower.includes("plan staff limit")) return t(lang, "auditDeniedNoteStaffPlanLimit");
  if (lower.includes("plan product limit")) return t(lang, "auditDeniedNoteProductPlanLimit");
  if (lower.includes("organization deleted")) return t(lang, "auditDeniedNoteOrgDeleted");
  if (lower.includes("owner pin")) return t(lang, "auditDeniedNoteOwnerPinRequired");
  return null;
}

/** Human-readable one-liner for auth_forbidden audit rows. */
export function describeAuthForbiddenLine(lang: Language, entry: AuditLogEntry): string {
  const pl = entry.payload;
  const payloadAction = typeof pl.action === "string" ? pl.action.trim() : "";
  const parsed = parseDeniedSummary(entry.payloadSummary ?? "");

  const mutation = payloadAction || parsed?.mutation || "";
  const actionLabel = mutationLabel(lang, mutation);
  const noteLabel = planLimitNoteLabel(lang, parsed?.note ?? null);

  if (actionLabel && noteLabel) {
    return tTemplate(lang, "narrativeAuthForbiddenWithReason", { action: actionLabel, reason: noteLabel });
  }
  if (actionLabel) {
    return tTemplate(lang, "narrativeAuthForbiddenMutation", { action: actionLabel });
  }
  if (parsed?.mutation) {
    return tTemplate(lang, "narrativeAuthForbiddenMutation", {
      action: parsed.mutation.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim(),
    });
  }
  return t(lang, "narrativeAuthForbiddenGeneric");
}

/** Prefer friendly audit copy over raw payloadSummary in timelines. */
export function humanizePayloadSummary(lang: Language, entry: AuditLogEntry): string {
  if (entry.action === "auth_forbidden") return describeAuthForbiddenLine(lang, entry);
  if (entry.action === "sensitive_action_auth_denied") return t(lang, "narrativeSensitiveAuthDenied");
  if (entry.action === "sensitive_action_auth_granted") return t(lang, "narrativeSensitiveAuthGranted");

  const summary = entry.payloadSummary?.trim() ?? "";
  if (!summary) return auditActionLabel(lang, entry.action);

  if (/^Denied\s+/i.test(summary)) return describeAuthForbiddenLine(lang, entry);

  for (const mutation of DENIED_MUTATION_KEYS) {
    if (summary === mutation || summary.includes(mutation)) {
      const label = mutationLabel(lang, mutation);
      if (label) return tTemplate(lang, "narrativeAuthForbiddenMutation", { action: label });
    }
  }

  if (/^[a-z][a-zA-Z0-9_]+$/.test(summary) && summary.includes("_")) {
    return auditActionLabel(lang, summary);
  }

  if (/^[0-9a-f-]{20,}$/i.test(summary)) {
    return auditActionLabel(lang, entry.action);
  }

  return summary;
}

export function auditActionLabel(lang: Language, action: string): string {
  const key = `auditAction_${action}` as Parameters<typeof t>[1];
  const label = t(lang, key);
  if (label !== key) return label;
  return action
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

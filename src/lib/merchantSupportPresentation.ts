import type {
  MerchantFinancialCorrectionSummary,
  MerchantNotificationRow,
  MerchantTicketStatus,
  SupportTicketCategory,
} from "./merchantSupportApi";
import type { Language } from "../types";

/**
 * Pure presentation helpers for the merchant "Notifications & Support" center.
 * No I/O here — everything is deterministic mapping so it can be unit-tested:
 * human-friendly ticket references, merchant-facing status labels, safe
 * presentation mapping for financial correction statuses (the financial system
 * stays authoritative; this layer only relabels), and notification deep links.
 */

/** WAKA-1048 — never a raw UUID. */
export function formatTicketReference(ticketNumber: number): string {
  return `WAKA-${String(Math.max(0, Math.trunc(ticketNumber))).padStart(4, "0")}`;
}

/** SUPPORT category display labels (bilingual). Categories never grant access to the
 *  systems they name — they are labels for the support conversation only. */
export const SUPPORT_CATEGORY_LABELS: Record<Language, Record<SupportTicketCategory, string>> = {
  en: {
    account: "Account",
    pos: "POS",
    inventory: "Inventory",
    sales: "Sales",
    payments: "Payments",
    customers: "Customers",
    staff: "Staff",
    printing: "Printing",
    sync_offline: "Sync / Offline",
    technical: "Technical Issue",
    other: "Other",
  },
  lg: {
    account: "Akawunti",
    pos: "POS",
    inventory: "Eby'okutunda",
    sales: "Sales",
    payments: "Okusasula",
    customers: "Abaguzi",
    staff: "Abakozi",
    printing: "Okuprinta",
    sync_offline: "Sync / Offline",
    technical: "Eky'obuzibu",
    other: "Ebyirala",
  },
  sw: {
    account: "Account",
    pos: "POS",
    inventory: "Inventory",
    sales: "Sales",
    payments: "Payments",
    customers: "Customers",
    staff: "Staff",
    printing: "Printing",
    sync_offline: "Sync / Offline",
    technical: "Technical Issue",
    other: "Other",
  },
};

export function supportCategoryLabel(lang: Language, category: SupportTicketCategory): string {
  return SUPPORT_CATEGORY_LABELS[lang]?.[category] ?? SUPPORT_CATEGORY_LABELS.en[category] ?? category;
}

export const MERCHANT_TICKET_STATUS_LABELS: Record<MerchantTicketStatus, string> = {
  open: "Open",
  under_review: "Under Review",
  waiting_for_merchant: "Waiting for You",
  resolved: "Resolved",
  closed: "Closed",
};

export function merchantTicketStatusLabel(status: MerchantTicketStatus): string {
  return MERCHANT_TICKET_STATUS_LABELS[status] ?? status;
}

/** A merchant may respond only while the ticket is in a replyable state. */
export function isTicketReplyable(status: MerchantTicketStatus): boolean {
  return status === "open" || status === "under_review" || status === "waiting_for_merchant";
}

export type MerchantVisibleCorrectionStatus = "open" | "under_review" | "resolved" | "closed";

/**
 * Safe presentation mapping from the financial correction request's internal
 * statuses to the merchant-facing vocabulary. This NEVER changes the stored
 * status — the financial correction system remains authoritative.
 */
export function mapFinancialCorrectionStatus(
  status: MerchantFinancialCorrectionSummary["status"],
): MerchantVisibleCorrectionStatus {
  switch (status) {
    case "submitted":
      return "open";
    case "under_review":
    case "approved":
    case "requires_manual_review":
      return "under_review";
    case "correction_applied":
      return "resolved";
    case "rejected":
      return "closed";
    default:
      return "open";
  }
}

export const FINANCIAL_CORRECTION_STATUS_LABELS: Record<MerchantVisibleCorrectionStatus, string> =
  {
    open: "Open",
    under_review: "Under Review",
    resolved: "Resolved",
    closed: "Closed",
  };

export function financialCorrectionStatusLabel(
  status: MerchantFinancialCorrectionSummary["status"],
): string {
  return FINANCIAL_CORRECTION_STATUS_LABELS[mapFinancialCorrectionStatus(status)];
}

/** Merchant-safe summary line for a financial correction request card. */
export function financialCorrectionSummaryLine(
  correction: Pick<MerchantFinancialCorrectionSummary, "status" | "saleRef">,
): string {
  switch (mapFinancialCorrectionStatus(correction.status)) {
    case "under_review":
      return `Our team is reviewing the financial information associated with Sale ${correction.saleRef}.`;
    case "resolved":
      return `Your reported issue for Sale ${correction.saleRef} has been reviewed and resolved.`;
    case "closed":
      return `Your reported issue for Sale ${correction.saleRef} was reviewed. Our records show the sale information is correct.`;
    default:
      return `We received your report for Sale ${correction.saleRef}. Our team will review it.`;
  }
}

/**
 * Deterministic deep link for a notification. Related entities win over type
 * heuristics; everything falls back to the Support Center home.
 */
export function notificationDeepLink(notification: {
  type: MerchantNotificationRow["type"];
  relatedTicketId: string | null;
  relatedRequestId: string | null;
}): string {
  if (notification.relatedTicketId) {
    return `/support-center/tickets/${notification.relatedTicketId}`;
  }
  if (notification.relatedRequestId) {
    return "/support-center/tickets?tab=financial";
  }
  return "/support-center";
}

/** Action button label for the notification detail view. */
export function notificationActionLabel(notification: {
  type: MerchantNotificationRow["type"];
  relatedTicketId: string | null;
  relatedRequestId: string | null;
}): string | null {
  if (notification.relatedTicketId) return "View support request";
  if (notification.relatedRequestId) return "View financial issue";
  if (notification.type.startsWith("support_")) return "Open Support";
  return null;
}

export type FinancialIssueCard = {
  id: string;
  headline: string;
  statusLabel: string;
  status: MerchantVisibleCorrectionStatus;
  relatedLabel: string;
  message: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Friendly merchant-facing projection of a financial correction request.
 * Deliberately excludes internal correction IDs (kept only as the React key /
 * never rendered), admin notes, and correction implementation details.
 */
export function toFinancialIssueCard(
  correction: MerchantFinancialCorrectionSummary,
): FinancialIssueCard {
  const mapped = mapFinancialCorrectionStatus(correction.status);
  return {
    id: correction.id,
    headline: mapped === "resolved" ? "Financial issue resolved" : "Financial issue",
    statusLabel: financialCorrectionStatusLabel(correction.status),
    status: mapped,
    relatedLabel: `Sale ${correction.saleRef}`,
    message: financialCorrectionSummaryLine(correction),
    createdAt: correction.createdAt,
    updatedAt: correction.updatedAt,
  };
}

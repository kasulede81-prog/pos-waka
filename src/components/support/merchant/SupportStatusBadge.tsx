import clsx from "clsx";
import type { MerchantTicketStatus, MerchantNotificationType } from "../../../lib/merchantSupportApi";
import type { MerchantVisibleCorrectionStatus } from "../../../lib/merchantSupportPresentation";

const TICKET_STATUS_STYLES: Record<MerchantTicketStatus, string> = {
  open: "border-sky-200 bg-sky-50 text-sky-700",
  under_review: "border-amber-200 bg-amber-50 text-amber-700",
  waiting_for_merchant: "border-waka-300 bg-waka-50 text-waka-800",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  closed: "border-border bg-muted text-muted-foreground",
};

const CORRECTION_STATUS_STYLES: Record<MerchantVisibleCorrectionStatus, string> = {
  open: "border-sky-200 bg-sky-50 text-sky-700",
  under_review: "border-amber-200 bg-amber-50 text-amber-700",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  closed: "border-border bg-muted text-muted-foreground",
};

export function SupportStatusBadge({
  label,
  status,
  kind = "ticket",
}: {
  label: string;
  status: MerchantTicketStatus | MerchantVisibleCorrectionStatus;
  kind?: "ticket" | "correction";
}) {
  const styles =
    kind === "ticket"
      ? TICKET_STATUS_STYLES[status as MerchantTicketStatus]
      : CORRECTION_STATUS_STYLES[status as MerchantVisibleCorrectionStatus];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide",
        styles ?? "border-border bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

const NOTIFICATION_TYPE_ICONS: Record<MerchantNotificationType, string> = {
  financial_issue_received: "💰",
  financial_issue_under_review: "🔎",
  financial_issue_resolved: "✅",
  financial_issue_closed: "🗂️",
  support_request_received: "🎫",
  support_under_review: "🔎",
  support_waiting_for_you: "⏰",
  support_resolved: "✅",
  support_closed: "🗂️",
  account_security: "🔐",
  system_announcement: "📢",
  license_announcement: "📜",
  service_announcement: "📣",
};

export function notificationIcon(type: MerchantNotificationType): string {
  return NOTIFICATION_TYPE_ICONS[type] ?? "🔔";
}

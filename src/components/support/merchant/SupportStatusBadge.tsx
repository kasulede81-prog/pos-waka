import clsx from "clsx";
import {
  Bell,
  CircleCheck,
  Clock3,
  FileArchive,
  FileText,
  LockKeyhole,
  Megaphone,
  Search,
  TicketCheck,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
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

const NOTIFICATION_TYPE_ICONS: Record<MerchantNotificationType, LucideIcon> = {
  financial_issue_received: WalletCards,
  financial_issue_under_review: Search,
  financial_issue_resolved: CircleCheck,
  financial_issue_closed: FileArchive,
  support_request_received: TicketCheck,
  support_under_review: Search,
  support_waiting_for_you: Clock3,
  support_resolved: CircleCheck,
  support_closed: FileArchive,
  account_security: LockKeyhole,
  system_announcement: Megaphone,
  license_announcement: FileText,
  service_announcement: Megaphone,
};

export function NotificationTypeIcon({ type, className }: { type: MerchantNotificationType; className?: string }) {
  const Icon = NOTIFICATION_TYPE_ICONS[type] ?? Bell;
  return <Icon className={className ?? "size-5"} strokeWidth={1.8} aria-hidden />;
}

import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { Language } from "../../../types";
import type { MerchantSupportTicketRow } from "../../../lib/merchantSupportApi";
import {
  formatTicketReference,
  merchantTicketStatusLabel,
  supportCategoryLabel,
} from "../../../lib/merchantSupportPresentation";
import { SupportStatusBadge } from "./SupportStatusBadge";
import { formatSupportDateTime } from "./SupportCenterUi";
import { t } from "../../../lib/i18n";

/**
 * Merchant support ticket card: human-friendly reference (WAKA-1048), subject,
 * category, status badge, created/updated timestamps, unread-reply indicator.
 */
export function SupportTicketCard({
  lang,
  ticket,
  hasUnreadReply,
}: {
  lang: Language;
  ticket: MerchantSupportTicketRow;
  hasUnreadReply: boolean;
}) {
  return (
    <Link
      to={`/support-center/tickets/${ticket.id}`}
      className="flex items-start gap-3 rounded-2xl border border-border/90 bg-card p-3 shadow-waka-sm transition active:scale-[0.99] motion-reduce:active:scale-100"
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-black uppercase tracking-wide text-waka-800">
            {formatTicketReference(ticket.ticketNumber)}
          </span>
          <SupportStatusBadge label={merchantTicketStatusLabel(ticket.status)} status={ticket.status} />
          {hasUnreadReply ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-rose-700">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden />
              {t(lang, "supportCenterUnreadReply")}
            </span>
          ) : null}
        </span>
        <span className="mt-1 block truncate text-sm font-bold text-foreground">{ticket.subject}</span>
        <span className="mt-0.5 block text-xs font-medium text-muted-foreground">
          {supportCategoryLabel(lang, ticket.category)}
          <span className="mx-1.5 text-muted-foreground/60" aria-hidden>
            ·
          </span>
          {t(lang, "supportCenterCreatedLabel")} {formatSupportDateTime(ticket.createdAt)}
          <span className="mx-1.5 text-muted-foreground/60" aria-hidden>
            ·
          </span>
          {t(lang, "supportCenterUpdatedLabel")} {formatSupportDateTime(ticket.updatedAt)}
        </span>
      </span>
      <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

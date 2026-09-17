import clsx from "clsx";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { MerchantNotificationRow } from "../../../lib/merchantSupportApi";
import { notificationDeepLink } from "../../../lib/merchantSupportPresentation";
import { formatSupportDateTime } from "./SupportCenterUi";
import { notificationIcon } from "./SupportStatusBadge";

/**
 * One notification row: title, short message, timestamp, unread state, type icon.
 * Clicking navigates to the notification's deep link — the parent marks it read.
 */
export function NotificationRow({
  notification,
  onOpen,
}: {
  notification: MerchantNotificationRow;
  onOpen?: (notification: MerchantNotificationRow) => void;
}) {
  const unread = notification.readAt == null;
  const to = notificationDeepLink(notification);

  return (
    <Link
      to={to}
      onClick={() => onOpen?.(notification)}
      className={clsx(
        "flex items-start gap-3 rounded-2xl border p-3 transition active:scale-[0.99] motion-reduce:active:scale-100",
        unread ? "border-waka-200 bg-waka-50/70" : "border-border/80 bg-card",
      )}
    >
      <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-lg">
        {notificationIcon(notification.type)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={clsx(
              "truncate text-sm font-bold",
              unread ? "text-foreground" : "text-foreground/80",
            )}
          >
            {notification.title}
          </span>
          {unread ? (
            <span className="h-2 w-2 shrink-0 rounded-full bg-waka-500" aria-label="unread" />
          ) : null}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-xs font-medium text-muted-foreground">
          {notification.message}
        </span>
        <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
          {formatSupportDateTime(notification.createdAt)}
        </span>
      </span>
      <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useMarkNotificationRead, useNotification } from "../hooks/useMerchantSupport";
import {
  notificationActionLabel,
  notificationDeepLink,
} from "../lib/merchantSupportPresentation";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import {
  SupportErrorBlock,
  SupportLoadingBlock,
  formatSupportDateTime,
} from "../components/support/merchant/SupportCenterUi";
import { notificationIcon, SupportStatusBadge } from "../components/support/merchant/SupportStatusBadge";
import { KeyboardSafePage } from "../components/layout/KeyboardSafePage";

/**
 * Notification detail: title, message, date, read state, related ticket/request,
 * and a single contextual action. Opening it persists the read state server-side.
 * Internal admin notes / correction internals are never rendered here.
 */
export function NotificationDetailPage({ lang }: { lang: Language }) {
  const { notificationId } = useParams<{ notificationId: string }>();
  const notification = useNotification(notificationId ?? null);
  const markRead = useMarkNotificationRead(null);

  useEffect(() => {
    if (notification.data?.ok === true && notification.data.notification.readAt == null) {
      markRead.mutate(notification.data.notification.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notification.data?.ok === true]);

  return (
    <KeyboardSafePage className="px-3 sm:px-4 md:px-6">
      <BackOfficePageLayout
        header={
          <EnterprisePageHeader
            lang={lang}
            title={t(lang, "supportCenterNotificationsSection")}
            backFallback="/support-center/notifications"
            compact
          />
        }
        className="pb-8"
      >
        {notification.isLoading ? (
          <SupportLoadingBlock lang={lang} />
        ) : notification.data?.ok === false || !notification.data ? (
          <SupportErrorBlock lang={lang} onRetry={() => void notification.refetch()} />
        ) : (
          <article className="rounded-2xl border border-border/90 bg-card p-4 shadow-waka-sm">
            <div className="flex items-start gap-3">
              <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-2xl">
                {notificationIcon(notification.data.notification.type)}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-black text-foreground">
                  {notification.data.notification.title}
                </h2>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {formatSupportDateTime(notification.data.notification.createdAt)}
                </p>
              </div>
              <SupportStatusBadge
                label={
                  notification.data.notification.readAt == null
                    ? t(lang, "supportCenterUnreadLabel")
                    : t(lang, "supportCenterReadLabel")
                }
                status={notification.data.notification.readAt == null ? "waiting_for_merchant" : "closed"}
              />
            </div>

            <p className="mt-4 whitespace-pre-wrap text-sm font-medium leading-relaxed text-foreground">
              {notification.data.notification.message}
            </p>

            {(() => {
              const n = notification.data.notification;
              const saleRef = typeof n.metadata.saleRef === "string" ? n.metadata.saleRef : null;
              if (!saleRef) return null;
              return (
                <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-xs font-bold text-muted-foreground">
                  {saleRef}
                </p>
              );
            })()}

            {(() => {
              const n = notification.data.notification;
              const label = notificationActionLabel(n);
              if (!label) return null;
              return (
                <Link
                  to={notificationDeepLink(n)}
                  className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-2xl bg-waka-600 px-5 text-sm font-black text-white shadow-md active:scale-[0.99]"
                >
                  {label}
                </Link>
              );
            })()}
          </article>
        )}

        <Link
          to="/support-center/notifications"
          className="inline-flex items-center gap-1 text-xs font-black text-waka-800 underline decoration-waka-300 underline-offset-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {t(lang, "supportCenterBackToNotifications")}
        </Link>
      </BackOfficePageLayout>
    </KeyboardSafePage>
  );
}

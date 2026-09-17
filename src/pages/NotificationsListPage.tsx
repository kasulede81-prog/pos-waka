import { useSearchParams } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useActiveShopId } from "../hooks/useActiveShopId";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationList,
  useSupportCenterRealtime,
} from "../hooks/useMerchantSupport";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import {
  SupportEmptyState,
  SupportErrorBlock,
  SupportLoadingBlock,
} from "../components/support/merchant/SupportCenterUi";
import { NotificationRow } from "../components/support/merchant/NotificationRow";
import { KeyboardSafePage } from "../components/layout/KeyboardSafePage";

/** Full notification list — newest first, with persisted mark-read (server-side). */
export function NotificationsListPage({ lang }: { lang: Language }) {
  const { shopId, loading: shopLoading } = useActiveShopId();
  const [searchParams] = useSearchParams();
  const unreadOnly = searchParams.get("filter") === "unread";

  const notifications = useNotificationList(shopLoading ? null : shopId, unreadOnly);
  const markRead = useMarkNotificationRead(shopId);
  const markAll = useMarkAllNotificationsRead(shopId);
  useSupportCenterRealtime(shopLoading ? null : shopId);

  return (
    <KeyboardSafePage className="px-3 sm:px-4 md:px-6">
      <BackOfficePageLayout
        header={
          <EnterprisePageHeader
            lang={lang}
            title={t(lang, "supportCenterNotificationsSection")}
            backFallback="/support-center"
            compact
          >
            <button
              type="button"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="rounded-xl border border-waka-300 bg-waka-50 px-3 py-1.5 text-xs font-black text-waka-800 active:scale-[0.99] disabled:opacity-60"
            >
              {t(lang, "supportCenterMarkAllRead")}
            </button>
          </EnterprisePageHeader>
        }
        className="pb-8"
      >
        {notifications.isLoading || shopLoading ? (
          <SupportLoadingBlock lang={lang} />
        ) : notifications.data?.ok === false ? (
          <SupportErrorBlock lang={lang} onRetry={() => void notifications.refetch()} />
        ) : (notifications.data?.notifications.length ?? 0) === 0 ? (
          <SupportEmptyState message={t(lang, "supportCenterNoNotifications")} />
        ) : (
          <div className="space-y-2">
            {notifications.data?.notifications.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                onOpen={(row) => {
                  if (row.readAt == null) markRead.mutate(row.id);
                }}
              />
            ))}
          </div>
        )}
      </BackOfficePageLayout>
    </KeyboardSafePage>
  );
}

import { Link } from "react-router-dom";
import { ArrowRight, Bell, Plus } from "lucide-react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { useActiveShopId } from "../hooks/useActiveShopId";
import {
  useNotificationList,
  useSupportCenterRealtime,
  useSupportTicketList,
  useSupportUnreadCounts,
  useMarkNotificationRead,
} from "../hooks/useMerchantSupport";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import {
  SupportEmptyState,
  SupportErrorBlock,
  SupportLoadingBlock,
  SupportSectionCard,
} from "../components/support/merchant/SupportCenterUi";
import { NotificationRow } from "../components/support/merchant/NotificationRow";
import { SupportTicketCard } from "../components/support/merchant/SupportTicketCard";
import { KeyboardSafePage } from "../components/layout/KeyboardSafePage";

/**
 * "Notifications & Support" home — the merchant's answer to
 * "What needs my attention?": latest notifications plus support request status.
 */
export function SupportCenterHomePage({ lang }: { lang: Language }) {
  const { shopId, loading: shopLoading } = useActiveShopId();

  const counts = useSupportUnreadCounts(shopLoading ? null : shopId);
  const notifications = useNotificationList(shopLoading ? null : shopId, false, 3);
  const tickets = useSupportTicketList(shopLoading ? null : shopId, "all");
  const markRead = useMarkNotificationRead(shopId);
  useSupportCenterRealtime(shopLoading ? null : shopId);

  const ticketList = tickets.data?.ok === true ? tickets.data.tickets : [];
  const openCount = ticketList.filter((x) => x.status === "open").length;
  const waitingCount = ticketList.filter((x) => x.status === "waiting_for_merchant").length;
  const recentlyResolved = ticketList.filter((x) => x.status === "resolved").slice(0, 3);
  const unreadNotifications = (counts.data?.unreadNotifications ?? 0) as number;

  const sectionLinkClass =
    "inline-flex items-center gap-1 text-xs font-black text-waka-800 underline decoration-waka-300 underline-offset-2";

  return (
    <KeyboardSafePage className="px-3 sm:px-4 md:px-6">
      <BackOfficePageLayout
        header={
          <EnterprisePageHeader
            lang={lang}
            title={t(lang, "supportCenterTitle")}
            subtitle={t(lang, "supportCenterSub")}
            backFallback="/"
            compact
          />
        }
        className="pb-8"
      >
        <SupportSectionCard
          title={t(lang, "supportCenterNotificationsSection")}
          action={
            <Link to="/support-center/notifications" className={sectionLinkClass}>
              {t(lang, "supportCenterViewAll")}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          }
        >
          {unreadNotifications > 0 ? (
            <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-waka-100 px-2.5 py-1 text-[11px] font-black text-waka-800">
              <Bell className="h-3.5 w-3.5" aria-hidden />
              {tTemplate(lang, "supportCenterUnreadBadge", { count: unreadNotifications })}
            </p>
          ) : null}
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
        </SupportSectionCard>

        <SupportSectionCard
          title={t(lang, "supportCenterSupportSection")}
          action={
            <div className="flex items-center gap-3">
              <Link to="/support-center/new" className={sectionLinkClass}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t(lang, "supportCenterReportProblem")}
              </Link>
              <Link to="/support-center/tickets" className={sectionLinkClass}>
                {t(lang, "supportCenterViewAllTickets")}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          }
        >
          {tickets.isLoading || shopLoading ? (
            <SupportLoadingBlock lang={lang} />
          ) : tickets.data?.ok === false ? (
            <SupportErrorBlock lang={lang} onRetry={() => void tickets.refetch()} />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { label: t(lang, "supportCenterOpenTickets"), value: openCount, to: "/support-center/tickets?status=open" },
                    {
                      label: t(lang, "supportCenterWaitingForYou"),
                      value: waitingCount,
                      to: "/support-center/tickets?status=waiting_for_merchant",
                    },
                    { label: t(lang, "supportCenterRecentlyResolved"), value: recentlyResolved.length, to: "/support-center/tickets?status=resolved" },
                  ] as const
                ).map((stat) => (
                  <Link
                    key={stat.label}
                    to={stat.to}
                    className="rounded-2xl border border-border/80 bg-muted/50 px-3 py-3 text-center transition active:scale-[0.99]"
                  >
                    <span className="block text-2xl font-black text-foreground">{stat.value}</span>
                    <span className="mt-0.5 block text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                      {stat.label}
                    </span>
                  </Link>
                ))}
              </div>

              {ticketList.length === 0 ? (
                <div className="mt-3">
                  <SupportEmptyState message={t(lang, "supportCenterNoTickets")} />
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {ticketList.slice(0, 3).map((ticket) => (
                    <SupportTicketCard
                      key={ticket.id}
                      lang={lang}
                      ticket={ticket}
                      hasUnreadReply={
                        ticket.status === "waiting_for_merchant" &&
                        (counts.data?.ticketsWithUnreadReplies ?? 0) > 0
                      }
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </SupportSectionCard>
      </BackOfficePageLayout>
    </KeyboardSafePage>
  );
}

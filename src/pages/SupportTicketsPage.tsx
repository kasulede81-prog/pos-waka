import { Link, useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { Plus } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useActiveShopId } from "../hooks/useActiveShopId";
import {
  useMyFinancialCorrections,
  useSupportCenterRealtime,
  useSupportTicketList,
} from "../hooks/useMerchantSupport";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import {
  SupportEmptyState,
  SupportErrorBlock,
  SupportLoadingBlock,
  formatSupportDateTime,
} from "../components/support/merchant/SupportCenterUi";
import { SupportTicketCard } from "../components/support/merchant/SupportTicketCard";
import { SupportStatusBadge } from "../components/support/merchant/SupportStatusBadge";
import { toFinancialIssueCard } from "../lib/merchantSupportPresentation";
import type { MerchantTicketStatus } from "../lib/merchantSupportApi";
import { KeyboardSafePage } from "../components/layout/KeyboardSafePage";

const STATUS_TABS: Array<{ value: MerchantTicketStatus | "all"; labelKey: string }> = [
  { value: "all", labelKey: "supportCenterTabAll" },
  { value: "open", labelKey: "supportCenterStatusOpen" },
  { value: "under_review", labelKey: "supportCenterStatusUnderReview" },
  { value: "waiting_for_merchant", labelKey: "supportCenterStatusWaitingForYou" },
  { value: "resolved", labelKey: "supportCenterStatusResolved" },
  { value: "closed", labelKey: "supportCenterStatusClosed" },
];

/**
 * "My Support Requests": merchant support tickets with status filters, plus a
 * "Financial issues" tab projecting the merchant's OWN financial correction
 * reports (read-only — the financial correction system remains authoritative).
 */
export function SupportTicketsPage({ lang }: { lang: Language }) {
  const { shopId, loading: shopLoading } = useActiveShopId();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "financial" ? "financial" : "tickets";
  const statusParam = searchParams.get("status") ?? "all";
  const activeStatus = (
    STATUS_TABS.some((s) => s.value === statusParam) ? statusParam : "all"
  ) as MerchantTicketStatus | "all";

  const tickets = useSupportTicketList(
    shopLoading ? null : shopId,
    activeStatus,
    tab === "tickets",
  );
  const corrections = useMyFinancialCorrections(shopLoading ? null : shopId, tab === "financial");
  useSupportCenterRealtime(shopLoading ? null : shopId);

  const setTab = (next: "tickets" | "financial") => {
    const nextParams = new URLSearchParams();
    if (next === "financial") nextParams.set("tab", "financial");
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <KeyboardSafePage className="px-3 sm:px-4 md:px-6">
      <BackOfficePageLayout
        header={
          <EnterprisePageHeader
            lang={lang}
            title={t(lang, "supportCenterViewAllTickets")}
            backFallback="/support-center"
            compact
          >
            <Link
              to="/support-center/new"
              className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-xs font-black text-primary-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] motion-reduce:active:scale-100"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t(lang, "supportCenterReportProblem")}
            </Link>
          </EnterprisePageHeader>
        }
        className="pb-8"
      >
        <div className="flex gap-2">
          {(
            [
              { value: "tickets", label: t(lang, "supportCenterTicketsTab") },
              { value: "financial", label: t(lang, "supportCenterFinancialTab") },
            ] as const
          ).map((tabItem) => (
            <button
              key={tabItem.value}
              type="button"
              onClick={() => setTab(tabItem.value)}
              aria-pressed={tab === tabItem.value}
              className={clsx(
                "min-h-[44px] flex-1 rounded-lg border px-3 text-xs font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] motion-reduce:active:scale-100 motion-reduce:transition-none",
                tab === tabItem.value
                  ? "border-waka-300 bg-waka-50 text-waka-800"
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              {tabItem.label}
            </button>
          ))}
        </div>

        {tab === "tickets" ? (
          <>
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
              {STATUS_TABS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => {
                    const nextParams = new URLSearchParams();
                    if (s.value !== "all") nextParams.set("status", s.value);
                    setSearchParams(nextParams, { replace: true });
                  }}
                  aria-pressed={activeStatus === s.value}
                  className={clsx(
                    "min-h-[44px] whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] motion-reduce:active:scale-100 motion-reduce:transition-none",
                    activeStatus === s.value
                      ? "border-waka-400 bg-waka-100 text-waka-800"
                      : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {t(lang, s.labelKey)}
                </button>
              ))}
            </div>

            {tickets.isLoading || shopLoading ? (
              <SupportLoadingBlock lang={lang} />
            ) : tickets.data?.ok === false ? (
              <SupportErrorBlock lang={lang} onRetry={() => void tickets.refetch()} />
            ) : (tickets.data?.tickets.length ?? 0) === 0 ? (
              <SupportEmptyState message={t(lang, "supportCenterNoTickets")} />
            ) : (
              <div className="space-y-2">
                {tickets.data?.tickets.map((ticket) => (
                  <SupportTicketCard
                    key={ticket.id}
                    lang={lang}
                    ticket={ticket}
                    hasUnreadReply={ticket.status === "waiting_for_merchant"}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="rounded-2xl bg-muted px-3 py-2 text-[11px] font-semibold text-muted-foreground">
              {t(lang, "supportCenterFinancialHint")}
            </p>
            {corrections.isLoading || shopLoading ? (
              <SupportLoadingBlock lang={lang} />
            ) : corrections.data?.ok === false ? (
              <SupportErrorBlock lang={lang} onRetry={() => void corrections.refetch()} />
            ) : (corrections.data?.requests.length ?? 0) === 0 ? (
              <SupportEmptyState message={t(lang, "supportCenterFinancialEmpty")} />
            ) : (
              <div className="space-y-2">
                {corrections.data?.requests.map((correction) => {
                  const card = toFinancialIssueCard(correction);
                  return (
                    <div
                      key={card.id}
                      className="rounded-2xl border border-border/90 bg-card p-3 shadow-waka-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-foreground">{card.headline}</span>
                        <SupportStatusBadge
                          label={card.statusLabel}
                          status={card.status}
                          kind="correction"
                        />
                      </div>
                      <p className="mt-1 text-xs font-medium text-muted-foreground">
                        {card.relatedLabel}
                        <span className="mx-1.5 text-muted-foreground/60" aria-hidden>
                          ·
                        </span>
                        {card.message}
                      </p>
                      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                        {t(lang, "supportCenterUpdatedLabel")} {formatSupportDateTime(card.updatedAt)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </BackOfficePageLayout>
    </KeyboardSafePage>
  );
}

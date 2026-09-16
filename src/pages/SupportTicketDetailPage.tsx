import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, Send } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import {
  useMarkTicketMessagesRead,
  useReplySupportTicket,
  useSupportTicket,
  useTicketMessages,
} from "../hooks/useMerchantSupport";
import { useActiveShopId } from "../hooks/useActiveShopId";
import {
  formatTicketReference,
  isTicketReplyable,
  merchantTicketStatusLabel,
  supportCategoryLabel,
} from "../lib/merchantSupportPresentation";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import {
  SupportErrorBlock,
  SupportLoadingBlock,
  formatSupportDateTime,
} from "../components/support/merchant/SupportCenterUi";
import { SupportStatusBadge } from "../components/support/merchant/SupportStatusBadge";
import { KeyboardSafePage } from "../components/layout/KeyboardSafePage";

/**
 * Support conversation: reference, subject, category, status, timestamps, the
 * merchant/WAKA message thread, and a reply composer while the ticket is
 * replyable. Opening the conversation persists the merchant read state
 * server-side (unread-reply indicator resets across devices).
 */
export function SupportTicketDetailPage({ lang }: { lang: Language }) {
  const { ticketId } = useParams<{ ticketId: string }>();
  const { shopId } = useActiveShopId();
  const ticket = useSupportTicket(ticketId ?? null);
  const messages = useTicketMessages(ticketId ?? null);
  const markRead = useMarkTicketMessagesRead(shopId, ticketId ?? null);
  const reply = useReplySupportTicket(shopId, ticketId ?? null);
  const [draft, setDraft] = useState("");
  const markedRef = useRef<string | null>(null);

  const messageList = messages.data?.ok === true ? messages.data.messages : [];
  const hasUnreadWakaReply = messageList.some(
    (m) => m.authorKind === "waka" && m.readByMerchantAt == null,
  );

  useEffect(() => {
    if (
      ticketId &&
      hasUnreadWakaReply &&
      messages.data?.ok === true &&
      markedRef.current !== ticketId
    ) {
      markedRef.current = ticketId;
      markRead.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnreadWakaReply, messages.data?.ok, ticketId]);

  const submitReply = () => {
    const body = draft.trim();
    if (!body || reply.isPending) return;
    reply.mutate(body, {
      onSuccess: () => setDraft(""),
    });
  };

  const row = ticket.data?.ok === true ? ticket.data.ticket : null;

  return (
    <KeyboardSafePage className="px-3 sm:px-4 md:px-6">
      <BackOfficePageLayout
        header={
          <EnterprisePageHeader
            lang={lang}
            title={row ? formatTicketReference(row.ticketNumber) : t(lang, "supportCenterSupportSection")}
            subtitle={row?.subject}
            backFallback="/support-center/tickets"
            compact
          >
            {row ? (
              <div className="flex flex-wrap items-center gap-2">
                <SupportStatusBadge
                  label={merchantTicketStatusLabel(row.status)}
                  status={row.status}
                />
                <span className="text-[11px] font-bold text-muted-foreground">
                  {supportCategoryLabel(lang, row.category)}
                </span>
              </div>
            ) : null}
          </EnterprisePageHeader>
        }
        className="pb-8"
      >
        {ticket.isLoading || messages.isLoading ? (
          <SupportLoadingBlock lang={lang} />
        ) : ticket.data?.ok === false || !row ? (
          <SupportErrorBlock lang={lang} onRetry={() => void ticket.refetch()} />
        ) : (
          <>
            {row.status === "waiting_for_merchant" ? (
              <p className="rounded-2xl border border-waka-300 bg-waka-50 px-4 py-3 text-sm font-bold text-waka-800">
                {t(lang, "supportCenterReplyWaitingBanner")}
              </p>
            ) : null}

            <section className="rounded-2xl border border-border/90 bg-card p-4 shadow-waka-sm">
              <h2 className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                {t(lang, "supportCenterConversationTitle")}
              </h2>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                {t(lang, "supportCenterCreatedLabel")} {formatSupportDateTime(row.createdAt)}
                <span className="mx-1.5" aria-hidden>
                  ·
                </span>
                {t(lang, "supportCenterUpdatedLabel")} {formatSupportDateTime(row.updatedAt)}
              </p>
              <div className="mt-3 space-y-3">
                {messageList.map((m) => {
                  const fromMerchant = m.authorKind === "merchant";
                  return (
                    <div key={m.id} className={clsx("flex", fromMerchant ? "justify-end" : "justify-start")}>
                      <div
                        className={clsx(
                          "max-w-[85%] rounded-2xl px-3.5 py-2.5 sm:max-w-[70%]",
                          fromMerchant
                            ? "rounded-br-md bg-waka-600 text-white"
                            : "rounded-bl-md border border-border bg-muted text-foreground",
                        )}
                      >
                        <p className="text-[10px] font-black uppercase tracking-wide opacity-80">
                          {fromMerchant ? t(lang, "supportCenterYouLabel") : t(lang, "supportCenterWakaTeamLabel")}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-relaxed">
                          {m.body}
                        </p>
                        <p className={clsx("mt-1 text-[10px] font-semibold", fromMerchant ? "text-white/70" : "text-muted-foreground")}>
                          {formatSupportDateTime(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {isTicketReplyable(row.status) ? (
              <section className="rounded-2xl border border-border/90 bg-card p-4 shadow-waka-sm">
                <label htmlFor="support-reply" className="sr-only">
                  {t(lang, "supportCenterReplyPlaceholder")}
                </label>
                <textarea
                  id="support-reply"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  placeholder={t(lang, "supportCenterReplyPlaceholder")}
                  className="w-full rounded-xl border border-border bg-muted/60 px-3 py-2.5 text-sm font-medium text-foreground outline-none focus:border-waka-400"
                />
                {reply.isError ? (
                  <p className="mt-2 text-xs font-bold text-rose-600">{t(lang, "supportCenterLoadError")}</p>
                ) : null}
                <button
                  type="button"
                  onClick={submitReply}
                  disabled={reply.isPending || draft.trim().length === 0}
                  className={clsx(
                    "mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black text-white shadow-md active:scale-[0.99] disabled:opacity-50 sm:w-auto",
                    row.status === "waiting_for_merchant" ? "bg-waka-600" : "bg-foreground",
                  )}
                >
                  <Send className="h-4 w-4" aria-hidden />
                  {t(lang, "supportCenterReplySubmit")}
                </button>
              </section>
            ) : (
              <p className="rounded-2xl border border-border bg-muted/60 px-4 py-3 text-xs font-semibold text-muted-foreground">
                {row.status === "resolved"
                  ? t(lang, "supportCenterTicketReadOnlyResolved")
                  : t(lang, "supportCenterTicketReadOnlyClosed")}
              </p>
            )}

            <Link
              to="/support-center/tickets"
              className="inline-flex items-center gap-1 text-xs font-black text-waka-800 underline decoration-waka-300 underline-offset-2"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              {t(lang, "supportCenterBackToTickets")}
            </Link>
          </>
        )}
      </BackOfficePageLayout>
    </KeyboardSafePage>
  );
}

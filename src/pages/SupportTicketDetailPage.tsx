import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, Send } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import {
  useMarkTicketMessagesRead,
  useReplySupportTicket,
  useSupportTicket,
  useTicketAttachments,
  useTicketMessages,
} from "../hooks/useMerchantSupport";
import { useActiveShopId } from "../hooks/useActiveShopId";
import {
  formatTicketReference,
  isTicketReplyable,
  merchantTicketStatusLabel,
  supportCategoryLabel,
} from "../lib/merchantSupportPresentation";
import {
  removeStagedAttachments,
  uploadStagedAttachments,
  type PendingAttachment,
} from "../lib/supportAttachments";
import { useSupportTicketRealtime } from "../lib/supportRealtime";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import {
  SupportErrorBlock,
  SupportLoadingBlock,
  formatSupportDateTime,
} from "../components/support/merchant/SupportCenterUi";
import { SupportStatusBadge } from "../components/support/merchant/SupportStatusBadge";
import { AttachmentComposer } from "../components/support/AttachmentComposer";
import { MessageAttachments } from "../components/support/MessageAttachments";
import { MerchantLiveSessionSection } from "../components/support/merchant/MerchantLiveSessionSection";
import { KeyboardSafePage } from "../components/layout/KeyboardSafePage";

/**
 * Support conversation: reference, subject, category, status, timestamps, the
 * merchant/WAKA message thread (now with image/PDF/voice-note attachments), and
 * a reply composer while the ticket is replyable. Phase 2.5: the conversation is
 * realtime — both sides see new messages, status changes and notifications
 * without refreshing. Closed tickets stay fully immutable server-side (the UI
 * simply hides the composer; the RPC and storage policies reject anything).
 */
export function SupportTicketDetailPage({ lang }: { lang: Language }) {
  const { ticketId } = useParams<{ ticketId: string }>();
  const { shopId } = useActiveShopId();
  const qc = useQueryClient();
  const ticket = useSupportTicket(ticketId ?? null);
  const messages = useTicketMessages(ticketId ?? null);
  const attachments = useTicketAttachments(ticketId ?? null);
  const markRead = useMarkTicketMessagesRead(shopId, ticketId ?? null);
  const reply = useReplySupportTicket(shopId, ticketId ?? null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const markedRef = useRef<string | null>(null);

  useSupportTicketRealtime(ticketId ?? null, {
    onMessageInserted: () => {
      void messages.refetch();
      void attachments.refetch();
      void ticket.refetch();
      void qc.invalidateQueries({ queryKey: ["merchant-support", "tickets"] });
      void qc.invalidateQueries({ queryKey: ["merchant-support", "unread-counts"] });
    },
    onTicketUpdated: () => {
      void ticket.refetch();
      void qc.invalidateQueries({ queryKey: ["merchant-support", "tickets"] });
    },
  });

  const messageList = messages.data?.ok === true ? messages.data.messages : [];
  const attachmentList = attachments.data?.ok === true ? attachments.data.attachments : [];
  const attachmentsByMessage = new Map<string, typeof attachmentList>();
  for (const a of attachmentList) {
    const list = attachmentsByMessage.get(a.messageId) ?? [];
    list.push(a);
    attachmentsByMessage.set(a.messageId, list);
  }
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

  const row = ticket.data?.ok === true ? ticket.data.ticket : null;
  const replyable = row ? isTicketReplyable(row.status) : false;
  const busy = reply.isPending || uploading;

  const submitReply = async () => {
    const body = draft.trim();
    if ((!body && pending.length === 0) || busy || !row || !shopId) return;
    setComposerError(null);
    setUploading(true);
    try {
      let uploads: Awaited<ReturnType<typeof uploadStagedAttachments>> | null = null;
      if (pending.length > 0) {
        uploads = await uploadStagedAttachments({
          shopId,
          ticketId: row.id,
          pending,
        });
        if (!uploads.ok) {
          // Unwind whatever reached the bucket (RLS allows removing staged
          // files that have no metadata yet), then surface the failure.
          await removeStagedAttachments(uploads.uploadedPaths);
          setComposerError(uploads.error);
          return;
        }
      }
      reply.mutate(
        { body, attachments: uploads?.ok ? uploads.uploads : [] },
        {
          onSuccess: async () => {
            if (uploads && !uploads.ok) return;
            setDraft("");
            setPending([]);
          },
          onError: async () => {
            if (uploads?.ok) await removeStagedAttachments(uploads.uploads.map((u) => u.storagePath));
          },
        },
      );
    } finally {
      setUploading(false);
    }
  };

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

            <MerchantLiveSessionSection
              lang={lang}
              shopId={shopId}
              ticketId={row.id}
              ticketStatus={row.status}
            />

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
                  const messageAttachments = attachmentsByMessage.get(m.id) ?? [];
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
                        {m.body ? (
                          <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-relaxed">
                            {m.body}
                          </p>
                        ) : null}
                        <MessageAttachments
                          lang={lang}
                          attachments={messageAttachments}
                        />
                        <p className={clsx("mt-1 text-[10px] font-semibold", fromMerchant ? "text-white/70" : "text-muted-foreground")}>
                          {formatSupportDateTime(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {replyable ? (
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
                <div className="mt-2.5">
                  <AttachmentComposer
                    lang={lang}
                    pending={pending}
                    onChange={setPending}
                    onRecordError={setComposerError}
                    disabled={busy}
                    idPrefix="merchant-support"
                  />
                </div>
                {reply.isError || composerError ? (
                  <p className="mt-2 text-xs font-bold text-rose-600">
                    {composerError ?? t(lang, "supportCenterLoadError")}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => void submitReply()}
                  disabled={busy || (draft.trim().length === 0 && pending.length === 0)}
                  className={clsx(
                    "mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black text-white shadow-md active:scale-[0.99] disabled:opacity-50 sm:w-auto",
                    row.status === "waiting_for_merchant" ? "bg-waka-600" : "bg-foreground",
                  )}
                >
                  <Send className="h-4 w-4" aria-hidden />
                  {uploading ? t(lang, "supportCenterSending") : t(lang, "supportCenterReplySubmit")}
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

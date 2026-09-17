import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Headset, MessageSquare, SendHorizonal } from "lucide-react";
import {
  fetchMerchantTicketMessages,
  fetchMerchantTicketQueue,
  merchantTicketMatchesFilter,
  merchantTicketReference,
  replyToMerchantTicket,
  setMerchantTicketStatus,
  type MerchantTicketFilter,
  type MerchantTicketMessageRow,
  type MerchantTicketQueueRow,
  type MerchantTicketStatus,
} from "../../../../lib/merchantTicketsAdmin";
import { whatsappUrlFromPhone } from "../../../../lib/wakaInternalAdmin";

type Props = {
  /** super_admin / support_admin may write; other roles get read-only. */
  canWorkTickets: boolean;
  /** True when viewing the preview dataset — writes are disabled. */
  previewMode: boolean;
};

const FILTERS: { id: MerchantTicketFilter; label: string }[] = [
  { id: "attention", label: "Needs attention" },
  { id: "waiting", label: "Waiting for merchant" },
  { id: "done", label: "Resolved / closed" },
  { id: "all", label: "All" },
];

const STATUS_STYLE: Record<MerchantTicketStatus, string> = {
  open: "bg-sky-100 text-sky-900 ring-sky-200",
  under_review: "bg-amber-100 text-amber-900 ring-amber-200",
  waiting_for_merchant: "bg-violet-100 text-violet-900 ring-violet-200",
  resolved: "bg-emerald-100 text-emerald-900 ring-emerald-200",
  closed: "bg-muted text-muted-foreground ring-border",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function MerchantTicketsConsole({ canWorkTickets, previewMode }: Props) {
  const [filter, setFilter] = useState<MerchantTicketFilter>("attention");
  const [tickets, setTickets] = useState<MerchantTicketQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [messagesByTicket, setMessagesByTicket] = useState<Record<string, MerchantTicketMessageRow[]>>({});
  const [messagesLoading, setMessagesLoading] = useState<string | null>(null);
  const [draftByTicket, setDraftByTicket] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async (activeFilter: MerchantTicketFilter) => {
    setLoading(true);
    setError(null);
    const rows = await fetchMerchantTicketQueue(activeFilter);
    setTickets(rows.filter((r) => merchantTicketMatchesFilter(r.status, activeFilter)));
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload(filter);
  }, [filter, reload]);

  const toggleTicket = async (ticketId: string) => {
    if (expandedId === ticketId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(ticketId);
    if (!messagesByTicket[ticketId]) {
      setMessagesLoading(ticketId);
      const msgs = await fetchMerchantTicketMessages(ticketId);
      setMessagesByTicket((prev) => ({ ...prev, [ticketId]: msgs }));
      setMessagesLoading(null);
    }
  };

  const sendReply = async (tk: MerchantTicketQueueRow) => {
    const body = (draftByTicket[tk.id] ?? "").trim();
    if (!body) return;
    setBusyId(tk.id);
    setNotice(null);
    const r = await replyToMerchantTicket({
      ticketId: tk.id,
      shopId: tk.shopId,
      ticketNumber: tk.ticketNumber,
      subject: tk.subject,
      body,
    });
    setBusyId(null);
    if (!r.ok) {
      setNotice(r.message ?? "Reply failed.");
      return;
    }
    setDraftByTicket((prev) => ({ ...prev, [tk.id]: "" }));
    const msgs = await fetchMerchantTicketMessages(tk.id);
    setMessagesByTicket((prev) => ({ ...prev, [tk.id]: msgs }));
    void reload(filter);
  };

  const changeStatus = async (tk: MerchantTicketQueueRow, status: MerchantTicketStatus) => {
    setBusyId(tk.id);
    setNotice(null);
    const r = await setMerchantTicketStatus({
      ticketId: tk.id,
      shopId: tk.shopId,
      ticketNumber: tk.ticketNumber,
      subject: tk.subject,
      status,
    });
    setBusyId(null);
    if (!r.ok) {
      setNotice(r.message ?? "Status change failed.");
      return;
    }
    void reload(filter);
  };

  const writeDisabled = !canWorkTickets || previewMode;

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-waka-500 to-orange-600 text-white shadow-sm">
            <Headset className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-black text-foreground">Merchant tickets</h2>
            <p className="text-xs font-semibold text-muted-foreground">
              Support Center conversations from the app (Phase 1) — replies notify the shop instantly.
            </p>
          </div>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-black text-muted-foreground">
          {loading ? "…" : tickets.length}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={clsx(
              "min-h-[36px] rounded-full px-3.5 text-[11px] font-black uppercase tracking-wide transition-colors",
              filter === f.id ? "bg-waka-600 text-white shadow-sm" : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {previewMode ? (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 ring-1 ring-amber-200">
          Preview mode — replies and status changes are disabled.
        </p>
      ) : null}
      {error ? <p className="mt-3 text-xs font-bold text-rose-600">{error}</p> : null}
      {notice ? <p className="mt-3 text-xs font-bold text-rose-600">{notice}</p> : null}

      <div className="mt-3 space-y-2">
        {loading && tickets.length === 0 ? (
          [1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />)
        ) : tickets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <MessageSquare className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-bold text-muted-foreground">No merchant tickets in this view.</p>
          </div>
        ) : (
          tickets.map((tk) => {
            const expanded = expandedId === tk.id;
            const waUrl = whatsappUrlFromPhone(tk.shopPhoneE164);
            return (
              <article key={tk.id} className="overflow-hidden rounded-xl border border-border bg-muted/40">
                <button
                  type="button"
                  onClick={() => void toggleTicket(tk.id)}
                  className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-black text-foreground">
                      <span className="mr-1.5 font-mono text-waka-700">{merchantTicketReference(tk.ticketNumber)}</span>
                      {tk.subject}
                    </p>
                    <p className="mt-0.5 truncate text-xs font-semibold text-muted-foreground">
                      {[tk.shopName, tk.shopDistrict].filter(Boolean).join(" · ") || "Unknown shop"} · {tk.category} ·{" "}
                      {formatWhen(tk.lastMessageAt)}
                    </p>
                  </div>
                  <span className={clsx("mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase ring-1", STATUS_STYLE[tk.status])}>
                    {tk.status.replace(/_/g, " ")}
                  </span>
                </button>

                {expanded ? (
                  <div className="border-t border-border bg-card px-3 py-3">
                    {messagesLoading === tk.id ? (
                      <div className="space-y-2">
                        {[1, 2].map((i) => (
                          <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
                        ))}
                      </div>
                    ) : (
                      <ul className="space-y-2">
                        {(messagesByTicket[tk.id] ?? []).map((m) => (
                          <li
                            key={m.id}
                            className={clsx(
                              "max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                              m.authorKind === "merchant"
                                ? "ml-auto rounded-br-sm bg-gradient-to-br from-waka-500 to-orange-600 text-white"
                                : "mr-auto rounded-bl-sm bg-muted text-foreground ring-1 ring-border",
                            )}
                          >
                            <p className="whitespace-pre-wrap">{m.body}</p>
                            <p className={clsx("mt-1 text-[10px] font-bold", m.authorKind === "merchant" ? "text-white/70" : "text-muted-foreground")}>
                              {m.authorKind === "merchant" ? "Merchant" : "WAKA"} · {formatWhen(m.createdAt)}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {tk.status !== "under_review" && tk.status !== "resolved" && tk.status !== "closed" ? (
                        <button
                          type="button"
                          disabled={writeDisabled || busyId === tk.id}
                          onClick={() => void changeStatus(tk, "under_review")}
                          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-black text-white disabled:opacity-40"
                        >
                          Start review
                        </button>
                      ) : null}
                      {tk.status !== "resolved" && tk.status !== "closed" ? (
                        <button
                          type="button"
                          disabled={writeDisabled || busyId === tk.id}
                          onClick={() => void changeStatus(tk, "resolved")}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white disabled:opacity-40"
                        >
                          Mark resolved
                        </button>
                      ) : null}
                      {tk.status !== "closed" ? (
                        <button
                          type="button"
                          disabled={writeDisabled || busyId === tk.id}
                          onClick={() => void changeStatus(tk, "closed")}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs font-black disabled:opacity-40"
                        >
                          Close
                        </button>
                      ) : null}
                      {waUrl ? (
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white"
                        >
                          WhatsApp shop
                        </a>
                      ) : null}
                    </div>

                    {writeDisabled ? null : (
                      <div className="mt-3 flex items-end gap-2">
                        <textarea
                          value={draftByTicket[tk.id] ?? ""}
                          onChange={(e) => setDraftByTicket((prev) => ({ ...prev, [tk.id]: e.target.value }))}
                          rows={2}
                          placeholder="Reply to the merchant…"
                          className="min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium outline-none ring-waka-500/40 focus:ring-2"
                        />
                        <button
                          type="button"
                          disabled={busyId === tk.id || !(draftByTicket[tk.id] ?? "").trim()}
                          onClick={() => void sendReply(tk)}
                          className="flex h-11 items-center gap-1.5 rounded-xl bg-gradient-to-br from-waka-500 to-orange-600 px-4 text-sm font-black text-white shadow-sm transition-transform active:scale-95 disabled:opacity-40"
                        >
                          <SendHorizonal className="h-4 w-4" aria-hidden />
                          {busyId === tk.id ? "…" : "Send"}
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

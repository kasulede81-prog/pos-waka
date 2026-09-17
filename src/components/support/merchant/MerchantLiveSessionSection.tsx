import { useState } from "react";
import clsx from "clsx";
import { MonitorPlay, ShieldCheck } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { SUPPORT_SESSION_DEFAULT_MINUTES, type SupportSessionRow } from "../../../lib/supportSessions";
import {
  useMerchantRespondSupportSession,
  useRequestSupportSession,
  useRevokeSupportSession,
  useTicketSupportSession,
} from "../../../hooks/useSupportSessions";
import { useShopSupportSessionsRealtime } from "../../../lib/supportRealtime";

function sessionStateLabel(lang: Language, session: SupportSessionRow): string {
  if (session.status === "requested") {
    return session.requestedByRole === "support"
      ? t(lang, "supportSessionAgentWaitingBanner")
      : t(lang, "supportSessionRequestedBanner");
  }
  if (session.status === "active") return t(lang, "supportSessionActiveBanner");
  return "";
}

/**
 * Phase 3 merchant entry point: request a time-boxed live support session from
 * an open ticket. The consent dialog spells out exactly what the agent can
 * see (the current screen name, via curated labels only) and that they get no
 * control and see no amounts, stock values, or passwords. The AppShell banner
 * takes over once a session exists.
 */
export function MerchantLiveSessionSection({
  lang,
  shopId,
  ticketId,
  ticketStatus,
}: {
  lang: Language;
  shopId: string | null;
  ticketId: string;
  ticketStatus: string;
}) {
  const sessionQuery = useTicketSupportSession(ticketId);
  const request = useRequestSupportSession(shopId, ticketId);
  const revoke = useRevokeSupportSession(shopId);
  const merchantRespond = useMerchantRespondSupportSession(shopId, ticketId);
  const [consentOpen, setConsentOpen] = useState(false);

  useShopSupportSessionsRealtime(shopId, {
    onSessionsChanged: () => void sessionQuery.refetch(),
  });

  if (ticketStatus !== "open" && ticketStatus !== "under_review" && ticketStatus !== "waiting_for_merchant") {
    return null;
  }

  const session = sessionQuery.data?.ok === true ? sessionQuery.data.session : null;

  return (
    <section className="rounded-2xl border border-border/90 bg-card p-4 shadow-waka-sm">
      <div className="flex items-center gap-3">
        <span
          className={clsx(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
            session?.status === "active"
              ? "bg-emerald-100 text-emerald-700"
              : session
                ? "bg-amber-100 text-amber-700"
                : "bg-waka-100 text-waka-700",
          )}
        >
          <MonitorPlay className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-black uppercase tracking-wide text-muted-foreground">
            {t(lang, "supportSessionSectionTitle")}
          </h2>
          {session && sessionQuery.data?.ok === true ? (
            <p
              className={clsx(
                "mt-0.5 text-[11px] font-bold",
                session.status === "active" ? "text-emerald-700" : "text-amber-700",
              )}
            >
              {sessionStateLabel(lang, session)}
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
              {t(lang, "supportSessionSectionHint")}
            </p>
          )}
        </div>
        {session ? (
          session.status === "requested" && session.requestedByRole === "support" ? (
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => merchantRespond.mutate({ sessionId: session.id, approve: true })}
                disabled={merchantRespond.isPending}
                className="rounded-xl bg-sky-700 px-3.5 py-2 text-[11px] font-black text-white active:scale-[0.98] disabled:opacity-50"
              >
                {t(lang, "supportSessionAllowCta")}
              </button>
              <button
                type="button"
                onClick={() => merchantRespond.mutate({ sessionId: session.id, approve: false })}
                disabled={merchantRespond.isPending}
                className="rounded-xl border border-border bg-card px-3 py-2 text-[11px] font-black text-foreground disabled:opacity-50"
              >
                {t(lang, "supportSessionNotNow")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => revoke.mutate(session.id)}
              disabled={revoke.isPending}
              className="shrink-0 rounded-xl px-3 py-2 text-[11px] font-black text-rose-700 underline decoration-rose-300 underline-offset-2 disabled:opacity-50"
            >
              {t(lang, "supportSessionCancelRequest")}
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={() => setConsentOpen(true)}
            className="shrink-0 rounded-xl bg-waka-600 px-3.5 py-2 text-[11px] font-black text-white shadow-md active:scale-[0.98]"
          >
            {t(lang, "supportSessionRequestCta")}
          </button>
        )}
      </div>

      {consentOpen && !session ? (
        <div className="mt-3 rounded-2xl border border-waka-200 bg-waka-50 p-3.5">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 h-4.5 w-4.5 shrink-0 text-waka-700" aria-hidden />
            <p className="text-[11px] font-semibold leading-relaxed text-waka-900">
              {t(lang, "supportSessionConsentBody")}
            </p>
          </div>
          {request.isError ? (
            <p className="mt-2 text-[11px] font-bold text-rose-600">
              {t(lang, "supportSessionRequestFailed")}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                request.mutate(SUPPORT_SESSION_DEFAULT_MINUTES, {
                  onSuccess: () => setConsentOpen(false),
                })
              }
              disabled={request.isPending}
              className="min-h-[40px] rounded-xl bg-waka-600 px-4 text-xs font-black text-white shadow-md active:scale-[0.98] disabled:opacity-50"
            >
              {t(lang, "supportSessionAllowCta")}
            </button>
            <button
              type="button"
              onClick={() => setConsentOpen(false)}
              className="min-h-[40px] rounded-xl border border-border bg-card px-4 text-xs font-black text-foreground"
            >
              {t(lang, "supportSessionNotNow")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

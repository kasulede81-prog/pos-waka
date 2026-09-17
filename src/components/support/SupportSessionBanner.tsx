import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Eye, ShieldCheck, XCircle,
} from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  latestRouteEvent,
  supportSessionSecondsRemaining,
  SUPPORT_SESSION_ROUTES,
  type SupportSessionRow,
} from "../../lib/supportSessions";
import {
  useMerchantRespondSupportSession,
  useRevokeSupportSession,
  useSessionEvents,
  useShopOpenSessions,
} from "../../hooks/useSupportSessions";
import { useShopSupportSessionsRealtime, useSupportSessionFeedRealtime } from "../../lib/supportRealtime";

function formatCountdown(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function routeLabel(lang: Language, path: string | null): string {
  const entry = SUPPORT_SESSION_ROUTES.find((r) => r.path === path);
  return entry ? t(lang, entry.labelKey) : path ?? "";
}

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Phase 3 merchant live-session banner. Persistent across the whole merchant
 * app (AppShell), hidden only on POS sell / login / internal-admin surfaces by
 * the parent. States:
 *  - requested: waiting for an agent, merchant can cancel;
 *  - active: countdown to hard expiry, agent's latest guided screen, recent
 *    curated activity, and an always-visible STOP (revoke) action;
 *  - just-ended: transient notice explaining why the session closed.
 */
export function SupportSessionBanner({ lang, shopId }: { lang: Language; shopId: string | null }) {
  const sessions = useShopOpenSessions(shopId);
  const revoke = useRevokeSupportSession(shopId);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const prevOpenRef = useRef<SupportSessionRow[]>([]);

  const openSessions = sessions.data?.ok === true ? sessions.data.sessions : [];
  const session = openSessions[0] ?? null;
  const merchantRespond = useMerchantRespondSupportSession(shopId, session?.ticketId ?? null);
  const active = session?.status === "active" ? session : null;
  const requested = session?.status === "requested" ? session : null;
  const agentWaiting = requested?.requestedByRole === "support" ? requested : null;

  const events = useSessionEvents(active?.id ?? null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active?.id]);

  // Transient notice when an open session disappears (ended/expired/revoked).
  useEffect(() => {
    const prev = prevOpenRef.current;
    if (prev.length > 0 && openSessions.length === 0) {
      const reason = prev[0].status === "active" ? prev[0].endedReason : null;
      setNotice(
        reason === "expired"
          ? t(lang, "supportSessionExpiredNotice")
          : t(lang, "supportSessionEndedNotice"),
      );
      const timer = window.setTimeout(() => setNotice(null), 8000);
      prevOpenRef.current = [];
      return () => window.clearTimeout(timer);
    }
    prevOpenRef.current = openSessions;
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.data]);

  useShopSupportSessionsRealtime(shopId, {
    onSessionsChanged: () => void sessions.refetch(),
    onEventInserted: () => void events.refetch(),
  });
  useSupportSessionFeedRealtime(active?.id ?? null, () => void events.refetch());

  const remaining = useMemo(
    () => (active ? supportSessionSecondsRemaining(active) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, now],
  );
  const eventList = events.data?.ok === true ? events.data.events : [];
  const viewing = latestRouteEvent(eventList);
  const recentEvents = expanded ? eventList.slice(0, 8) : [];

  if (!session && notice) {
    return (
      <div className="pointer-events-auto fixed inset-x-3 bottom-24 z-40 mx-auto max-w-md sm:inset-x-auto sm:right-6 sm:bottom-28 sm:w-96">
        <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3 shadow-waka-md">
          <XCircle className="h-4.5 w-4.5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-xs font-bold text-foreground">{notice}</p>
        </div>
      </div>
    );
  }
  if (!session) return null;

  if (requested) {
    if (agentWaiting) {
      return (
        <div className="pointer-events-auto fixed inset-x-3 bottom-24 z-40 mx-auto max-w-md sm:inset-x-auto sm:right-6 sm:bottom-28 sm:w-96">
          <div className="rounded-2xl border border-sky-300 bg-sky-50 px-4 py-3 shadow-waka-md">
            <div className="flex items-center gap-3">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-500" />
              </span>
              <p className="min-w-0 flex-1 text-xs font-bold text-sky-900">
                {t(lang, "supportSessionAgentWaitingBanner")}
              </p>
            </div>
            <p className="mt-1.5 text-[10px] font-semibold leading-snug text-sky-800/90">
              {t(lang, "supportSessionActiveBody")}
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={() => merchantRespond.mutate({ sessionId: agentWaiting.id, approve: true })}
                disabled={merchantRespond.isPending}
                className="min-h-[36px] flex-1 rounded-xl bg-sky-700 px-3 text-[11px] font-black text-white active:scale-[0.98] disabled:opacity-50"
              >
                {t(lang, "supportSessionAllowCta")}
              </button>
              <button
                type="button"
                onClick={() => merchantRespond.mutate({ sessionId: agentWaiting.id, approve: false })}
                disabled={merchantRespond.isPending}
                className="min-h-[36px] rounded-xl border border-sky-300 bg-white px-3 text-[11px] font-black text-sky-900 active:scale-[0.98] disabled:opacity-50"
              >
                {t(lang, "supportSessionNotNow")}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="pointer-events-auto fixed inset-x-3 bottom-24 z-40 mx-auto max-w-md sm:inset-x-auto sm:right-6 sm:bottom-28 sm:w-96">
        <div className="flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-waka-md">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
          </span>
          <p className="min-w-0 flex-1 text-xs font-bold text-amber-900">
            {t(lang, "supportSessionRequestedBanner")}
          </p>
          <button
            type="button"
            onClick={() => revoke.mutate(requested.id)}
            disabled={revoke.isPending}
            className="shrink-0 rounded-xl px-2.5 py-1.5 text-[11px] font-black text-amber-900 underline decoration-amber-400 underline-offset-2 disabled:opacity-50"
          >
            {t(lang, "supportSessionCancelRequest")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto fixed inset-x-3 bottom-24 z-40 mx-auto max-w-md sm:inset-x-auto sm:right-6 sm:bottom-28 sm:w-96">
      <div className="overflow-hidden rounded-2xl border border-emerald-300 bg-emerald-50 shadow-waka-md">
        <div className="flex items-center gap-3 px-4 pt-3">
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black uppercase tracking-wide text-emerald-800">
              {t(lang, "supportSessionActiveBanner")}
            </p>
            <p className="text-[11px] font-semibold text-emerald-700">
              {t(lang, "supportSessionEndsIn")} {formatCountdown(remaining)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={t(lang, "supportSessionRecentActivity")}
            className="shrink-0 rounded-xl p-1.5 text-emerald-700 hover:bg-emerald-100"
          >
            <Activity className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => revoke.mutate(active!.id)}
            disabled={revoke.isPending}
            className="shrink-0 rounded-xl bg-emerald-700 px-2.5 py-1.5 text-[11px] font-black text-white active:scale-[0.98] disabled:opacity-50"
          >
            {t(lang, "supportSessionStop")}
          </button>
        </div>

        {viewing ? (
          <p className="flex items-center gap-1.5 px-4 pt-2 text-[11px] font-bold text-emerald-800">
            <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t(lang, "supportSessionAgentGuiding")} {routeLabel(lang, viewing.routePath)}
          </p>
        ) : null}

        <p className="px-4 pt-1.5 text-[10px] font-semibold leading-snug text-emerald-700/90">
          {t(lang, "supportSessionActiveBody")}
        </p>

        {expanded ? (
          <div className="mx-3 mt-2 mb-3 max-h-44 space-y-1 overflow-y-auto rounded-xl bg-white/70 p-2">
            {recentEvents.length === 0 ? (
              <p className="px-1 py-2 text-[11px] font-semibold text-muted-foreground">
                {t(lang, "supportSessionNoActivity")}
              </p>
            ) : (
              recentEvents.map((e) => (
                <div key={e.id} className="flex items-start gap-2 rounded-lg px-1.5 py-1">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                  <p className="min-w-0 flex-1 text-[11px] font-semibold text-foreground">{e.label}</p>
                  <span className="shrink-0 text-[10px] font-bold text-muted-foreground">
                    {formatEventTime(e.createdAt)}
                  </span>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="h-2" />
        )}
      </div>
    </div>
  );
}

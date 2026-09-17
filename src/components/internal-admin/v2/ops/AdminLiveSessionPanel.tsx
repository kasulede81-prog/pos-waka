import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { MonitorPlay, Navigation, ShieldCheck, Timer } from "lucide-react";
import type { Language } from "../../../../types";
import { t } from "../../../../lib/i18n";
import {
  adminRequestSupportSession,
  emitSupportSessionEvent,
  endSupportSession,
  fetchSessionEvents,
  getTicketSession,
  respondSupportSession,
  revokeSupportSession,
  SUPPORT_SESSION_DEFAULT_MINUTES,
  SUPPORT_SESSION_ROUTES,
  supportSessionSecondsRemaining,
  type SupportSessionEventRow,
  type SupportSessionRow,
} from "../../../../lib/supportSessions";
import {
  useAdminTicketSessionRealtime,
  useSupportSessionFeedRealtime,
} from "../../../../lib/supportRealtime";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatCountdown(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Phase 3 internal-admin live session panel, embedded in the expanded ticket
 * of MerchantTicketsConsole. Self-contained state (the console predates
 * react-query) with the same RLS + SECURITY DEFINER RPC contract as the app.
 *
 * The agent NEVER gets control of the merchant app: this panel can only
 * request/approve/end a time-boxed session and emit curated activity events
 * (allowlisted screen names, capped labels, sanitized metadata). All writes
 * are re-authorized server-side from auth.uid().
 */
export function AdminLiveSessionPanel({
  lang,
  ticketId,
  ticketStatus,
  writeDisabled,
}: {
  lang: Language;
  ticketId: string;
  ticketStatus: string;
  writeDisabled: boolean;
}) {
  const [session, setSession] = useState<SupportSessionRow | null>(null);
  const [events, setEvents] = useState<SupportSessionEventRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const loadedRef = useRef(false);

  const reload = useCallback(async () => {
    const r = await getTicketSession(ticketId);
    if (r.ok) {
      setSession(r.session);
      if (r.session) {
        const ev = await fetchSessionEvents(r.session.id);
        if (ev.ok) setEvents(ev.events);
      }
    }
  }, [ticketId]);

  useEffect(() => {
    loadedRef.current = false;
    setSession(null);
    setEvents([]);
    void reload().then(() => {
      loadedRef.current = true;
    });
  }, [reload]);

  useAdminTicketSessionRealtime(ticketId, {
    onSessionChanged: () => void reload(),
    onEventInserted: () => void reload(),
  });
  useSupportSessionFeedRealtime(session?.status === "active" ? session.id : null, () => void reload());

  useEffect(() => {
    if (session?.status !== "active") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session?.id, session?.status]);

  const remaining = useMemo(
    () => (session?.status === "active" ? supportSessionSecondsRemaining(session) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, now],
  );

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await fn();
    if (!r.ok) setError(r.error ?? "failed");
    await reload();
    setBusy(false);
  };

  const ticketOpen = ticketStatus !== "resolved" && ticketStatus !== "closed";

  if (!session && !loadedRef.current) {
    return <div className="mt-3 h-10 animate-pulse rounded-xl bg-muted" />;
  }

  return (
    <div className="mt-3 rounded-2xl border border-border bg-background p-3">
      <div className="flex items-center gap-2.5">
        <span
          className={clsx(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
            session?.status === "active"
              ? "bg-emerald-100 text-emerald-700"
              : session
                ? "bg-amber-100 text-amber-700"
                : "bg-muted text-muted-foreground",
          )}
        >
          <MonitorPlay className="h-4.5 w-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-black uppercase tracking-wide text-muted-foreground">
            {t(lang, "supportSessionSectionTitle")}
          </h3>
          <p className="text-[11px] font-bold text-foreground">
            {session?.status === "active"
              ? t(lang, "supportSessionActiveBanner")
              : session?.status === "requested"
                ? session.requestedByRole === "merchant"
                  ? t(lang, "supportSessionMerchantRequestedBanner")
                  : t(lang, "supportSessionWaitingMerchantBanner")
                : t(lang, "supportSessionSectionHint")}
          </p>
        </div>
        {session?.status === "active" ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black text-emerald-800">
            <Timer className="h-3.5 w-3.5" aria-hidden />
            {formatCountdown(remaining)}
          </span>
        ) : null}
      </div>

      {error ? <p className="mt-2 text-[11px] font-bold text-rose-600">{error}</p> : null}

      {!session ? (
        <div className="mt-2.5">
          <button
            type="button"
            disabled={writeDisabled || !ticketOpen || busy}
            onClick={() =>
              void run(async () => {
                const r = await adminRequestSupportSession(ticketId, SUPPORT_SESSION_DEFAULT_MINUTES);
                return r.ok ? { ok: true } : { ok: false, error: r.error };
              })
            }
            className="rounded-xl bg-waka-600 px-3.5 py-2 text-[11px] font-black text-white shadow-sm active:scale-[0.98] disabled:opacity-40"
          >
            {t(lang, "supportSessionRequestLiveCta")}
          </button>
        </div>
      ) : null}

      {session?.status === "requested" ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {session.requestedByRole === "merchant" && !writeDisabled ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    respondSupportSession(session.id, true).then((r) =>
                      r.ok ? { ok: true } : { ok: false, error: r.error },
                    ),
                  )
                }
                className="rounded-xl bg-emerald-600 px-3.5 py-2 text-[11px] font-black text-white active:scale-[0.98] disabled:opacity-40"
              >
                {t(lang, "supportSessionApproveCta")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    respondSupportSession(session.id, false).then((r) =>
                      r.ok ? { ok: true } : { ok: false, error: r.error },
                    ),
                  )
                }
                className="rounded-xl border border-border px-3.5 py-2 text-[11px] font-black text-foreground disabled:opacity-40"
              >
                {t(lang, "supportSessionDeclineCta")}
              </button>
            </>
          ) : null}
          {session.requestedByRole === "support" && !writeDisabled ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  revokeSupportSession(session.id).then((r) =>
                    r.ok ? { ok: true } : { ok: false, error: r.error },
                  ),
                )
              }
              className="rounded-xl border border-border px-3.5 py-2 text-[11px] font-black text-foreground disabled:opacity-40"
            >
              {t(lang, "supportSessionCancelRequest")}
            </button>
          ) : null}
        </div>
      ) : null}

      {session?.status === "active" ? (
        <div className="mt-3 space-y-2.5">
          <p className="flex items-start gap-1.5 text-[10px] font-semibold leading-snug text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t(lang, "supportSessionAdminReadOnlyHint")}
          </p>

          <div>
            <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
              {t(lang, "supportSessionGuideMerchant")}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {SUPPORT_SESSION_ROUTES.map((route) => (
                <button
                  key={route.path}
                  type="button"
                  disabled={busy || writeDisabled}
                  onClick={() =>
                    void run(() =>
                      emitSupportSessionEvent(
                        session.id,
                        "route_changed",
                        `Guide merchant to ${t(lang, route.labelKey)}`,
                        route.path,
                      ).then((r) => (r.ok ? { ok: true } : { ok: false, error: r.error })),
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2.5 py-1.5 text-[11px] font-bold text-foreground active:scale-[0.98] disabled:opacity-40"
                >
                  <Navigation className="h-3 w-3" aria-hidden />
                  {t(lang, route.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {events.length > 0 ? (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                {t(lang, "supportSessionRecentActivity")}
              </p>
              <ul className="mt-1.5 max-h-36 space-y-1 overflow-y-auto rounded-xl bg-muted/50 p-2">
                {events.slice(0, 10).map((e) => (
                  <li key={e.id} className="flex items-start gap-2 rounded-lg px-1.5 py-0.5">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-waka-500" aria-hidden />
                    <p className="min-w-0 flex-1 text-[11px] font-semibold text-foreground">{e.label}</p>
                    <span className="shrink-0 text-[10px] font-bold text-muted-foreground">
                      {formatWhen(e.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!writeDisabled ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  endSupportSession(session.id).then((r) =>
                    r.ok ? { ok: true } : { ok: false, error: r.error },
                  ),
                )
              }
              className="rounded-xl bg-rose-600 px-3.5 py-2 text-[11px] font-black text-white active:scale-[0.98] disabled:opacity-40"
            >
              {t(lang, "supportSessionEndCta")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

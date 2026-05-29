import { useEffect, useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../types";
import { PosPage } from "./PosPage";
import { t } from "../lib/i18n";
import { SessionActorProvider } from "../context/SessionActorContext";
import { ActivationProvider } from "../context/ActivationContext";
import { SubscriptionProvider } from "../context/SubscriptionContext";
import { PosDataProvider } from "../providers/PosDataProvider";
import { SyncStatusProvider } from "../hooks/useSyncStatus";
import { BackOfficeSessionProvider } from "../context/BackOfficeSessionContext";
import { flushPendingPersist, usePosStore } from "../store/usePosStore";
import { setActiveAccountKey, getActiveAccountKey } from "../offline/accountScope";
import { unauthenticatedEntryPath } from "../lib/nativeApp";

type Props = {
  lang: Language;
  /** When true, “Exit demo” sends the user toward activation instead of the marketing page. */
  isAuthenticated?: boolean;
};

/**
 * Public, offline-first demo: seeded sample data, demo-prefixed sync/snapshot no-ops, session-scoped reset.
 */
export function DemoExperiencePage({ lang, isAuthenticated = false }: Props) {
  const demoKey = useMemo(() => {
    if (typeof sessionStorage === "undefined") return `demo:${crypto.randomUUID()}`;
    const sess = sessionStorage.getItem("waka_demo_session_id") ?? crypto.randomUUID();
    sessionStorage.setItem("waka_demo_session_id", sess);
    return `demo:${sess}`;
  }, []);

  useEffect(() => {
    return () => {
      flushPendingPersist();
      usePosStore.getState().resetForSignOut();
      const cur = getActiveAccountKey();
      if (cur === demoKey || (cur ?? "").startsWith("demo:")) {
        setActiveAccountKey(null);
      }
    };
  }, [demoKey]);

  const exitTo = isAuthenticated ? "/" : unauthenticatedEntryPath();
  const exitLabel = t(lang, "activationDemoExit");

  const wrap = (children: ReactNode) => (
    <ActivationProvider authMode="local" user={null}>
      <SubscriptionProvider user={null} authMode="local">
        <SessionActorProvider value={{ userId: demoKey, role: "owner", displayName: "Demo" }}>
          <SyncStatusProvider>
            <BackOfficeSessionProvider>
              <PosDataProvider accountKey={demoKey} lang={lang}>
                {children}
              </PosDataProvider>
            </BackOfficeSessionProvider>
          </SyncStatusProvider>
        </SessionActorProvider>
      </SubscriptionProvider>
    </ActivationProvider>
  );

  return wrap(
    <div className="relative min-h-dvh bg-gradient-to-b from-orange-50/80 to-stone-50 pb-nav-safe">
      <div className={clsx("sticky top-0 z-[60] border-b border-orange-200 bg-orange-600 px-4 py-3 text-white shadow-md")}>
        <div className="mx-auto flex max-w-xl flex-wrap items-center justify-between gap-2">
          <p className="max-w-[min(100%,20rem)] text-xs font-black uppercase tracking-wide">{t(lang, "activationDemoBanner")}</p>
          <Link
            to={exitTo}
            className="shrink-0 rounded-full bg-white/95 px-3 py-1.5 text-xs font-black text-orange-950 shadow-sm"
          >
            {exitLabel}
          </Link>
        </div>
      </div>
      <PosPage lang={lang} />
    </div>,
  );
}

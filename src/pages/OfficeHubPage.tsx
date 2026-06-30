import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Cloud, Share2 } from "lucide-react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { OfficePremiumSection } from "../components/office/OfficePremiumSection";
import { OfficeHubSectionTile } from "../components/office/OfficeHubSectionTile";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
import { runWhenIdle } from "../lib/uiYield";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { countSalesWithSyncErrors } from "../offline/cloudSync";
import { usePosStore } from "../store/usePosStore";
import { useOfficeHubAccess, fetchOfficeHubAdminFlags } from "../hooks/useOfficeHubAccess";
import { resolveOfficeHubSections } from "../lib/officeHubSections";
import { internalAdminPreviewHref, isInternalAdminPreviewEnabled } from "../lib/internalAdminPreview";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { hasEffectivePermission } from "../lib/subscriptionEntitlements";
import { dateKeyKampala } from "../lib/datesUg";
import { activeDayDrawerOpenForDate, isFormulaV2 } from "../lib/dayDrawerOpen";
import { DayDrawerOpenAlert } from "../components/office/DayDrawerOpenAlert";

const OfficeHubRiskBadge = lazy(() =>
  import("../components/office/OfficeHubRiskBadge").then((m) => ({ default: m.OfficeHubRiskBadge })),
);

function OfficeSyncStatusChip({ lang }: { lang: Language }) {
  const sync = useSyncStatus();
  const syncErrors = countSalesWithSyncErrors();
  const pending = sync.pendingCount;
  const ok = pending === 0 && syncErrors === 0;

  const label = ok
    ? t(lang, "officeSyncBadgeOk")
    : pending > 0
      ? tTemplate(lang, "officeSyncBadgePending", { count: String(pending) })
      : tTemplate(lang, "officeSyncBadgeErrors", { count: String(syncErrors) });

  return (
    <Link
      to="/office/backup"
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-black ${
        ok
          ? "border border-emerald-200/80 bg-emerald-50 text-emerald-900"
          : "border border-amber-200 bg-amber-50 text-amber-950"
      }`}
    >
      <Cloud className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function OfficeHubPage({ lang }: { lang: Language }) {
  const { sectionVisible, canOwnerDashboard, showAgentPortal } = useOfficeHubAccess();
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const preferences = usePosStore((s) => s.preferences);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const savedOrder = usePosStore((s) => s.preferences.officeHubTileOrder) ?? [];
  const layout = usePosStore((s) => s.preferences.officeHubTileLayout) ?? {};
  const [showInternalAdmin, setShowInternalAdmin] = useState(false);
  const [showRiskBadge, setShowRiskBadge] = useState(false);

  const visibleSections = useMemo(
    () => resolveOfficeHubSections({ savedOrder, layout, sectionVisible }),
    [savedOrder, layout, sectionVisible],
  );
  const empty = visibleSections.length === 0;
  const todayKey = dateKeyKampala(new Date());
  const needsDayOpen =
    isFormulaV2(preferences) &&
    !activeDayDrawerOpenForDate(dayDrawerOpens, todayKey) &&
    hasEffectivePermission(actor.role, "day.open_drawer", snapshot, authMode);

  useEffect(() => {
    let cancelled = false;
    runWhenIdle(() => {
      void fetchOfficeHubAdminFlags().then((flags) => {
        if (!cancelled) setShowInternalAdmin(flags.showInternalAdmin);
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!canOwnerDashboard) return;
    runWhenIdle(() => setShowRiskBadge(true));
  }, [canOwnerDashboard]);

  return (
    <BackOfficePageLayout
      header={
        <div className="space-y-1.5">
          <div>
            <h1 className="text-xl font-black tracking-tight text-stone-950 sm:text-2xl">{t(lang, "officeHubTitle")}</h1>
            <p className="text-xs font-medium text-stone-500">{t(lang, "officeHubSub")}</p>
          </div>
          <OfficeSyncStatusChip lang={lang} />
        </div>
      }
    >
      {canOwnerDashboard && showRiskBadge ? (
        <Suspense fallback={null}>
          <OfficeHubRiskBadge lang={lang} />
        </Suspense>
      ) : null}

      {needsDayOpen ? <DayDrawerOpenAlert lang={lang} /> : null}

      <OfficePremiumSection lang={lang} />

      {empty ? (
        <p className="rounded-xl bg-amber-50 px-3 py-3 text-sm font-bold text-amber-950">{t(lang, "officeHubEmpty")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:gap-2.5 lg:max-w-4xl">
          {visibleSections.map((section, index) => (
            <OfficeHubSectionTile
              key={section.id}
              section={section}
              lang={lang}
              mode="live"
              className={visibleSections.length % 2 === 1 && index === visibleSections.length - 1 ? "col-span-2" : undefined}
            />
          ))}
        </div>
      )}

      {(showInternalAdmin || showAgentPortal || isInternalAdminPreviewEnabled()) && (
        <div className="space-y-2 border-t border-stone-100 pt-3">
          {showAgentPortal ? (
            <Link
              to="/agent"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-waka-200 bg-waka-50 px-3 py-2 text-xs font-black text-waka-900"
            >
              <Share2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t(lang, "officeCardAgentPortal")}
            </Link>
          ) : null}
          {showInternalAdmin ? (
            <Link
              to="/internal/waka"
              className="inline-flex min-h-[36px] items-center text-xs font-bold text-stone-500 underline decoration-stone-300"
            >
              {t(lang, "internalAdminFooterLink")}
            </Link>
          ) : null}
          {isInternalAdminPreviewEnabled() ? (
            <Link
              to={internalAdminPreviewHref("/internal/waka")}
              className="ml-4 inline-flex min-h-[36px] items-center text-xs font-bold text-waka-700 underline"
            >
              {t(lang, "internalAdminPreviewOfficeLink")}
            </Link>
          ) : null}
        </div>
      )}
    </BackOfficePageLayout>
  );
}

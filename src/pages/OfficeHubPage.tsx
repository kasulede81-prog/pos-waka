import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Cloud } from "lucide-react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { OfficePremiumSection } from "../components/office/OfficePremiumSection";
import { OfficeHubSectionTile } from "../components/office/OfficeHubSectionTile";
import { runWhenIdle } from "../lib/uiYield";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { countSalesWithSyncErrors } from "../offline/cloudSync";
import { useOfficeHubAccess, fetchOfficeHubAdminFlags } from "../hooks/useOfficeHubAccess";
import { OFFICE_HUB_SECTIONS, officeHubSectionPath } from "../lib/officeHubSections";
import { internalAdminPreviewHref, isInternalAdminPreviewEnabled } from "../lib/internalAdminPreview";

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
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black ${
        ok
          ? "border border-emerald-200/80 bg-emerald-50 text-emerald-900"
          : "border border-amber-200 bg-amber-50 text-amber-950"
      }`}
    >
      <Cloud className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function OfficeHubPage({ lang }: { lang: Language }) {
  const { sectionVisible, canOwnerDashboard } = useOfficeHubAccess();
  const [showInternalAdmin, setShowInternalAdmin] = useState(false);
  const [showRiskBadge, setShowRiskBadge] = useState(false);

  const visibleSections = OFFICE_HUB_SECTIONS.filter((s) => sectionVisible[s.id]);
  const empty = visibleSections.length === 0;

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
    <div className="space-y-5 pb-4">
      <header>
        <h1 className="text-2xl font-black tracking-tight text-stone-950 sm:text-3xl">{t(lang, "officeHubTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "officeHubSub")}</p>
        <div className="mt-2">
          <OfficeSyncStatusChip lang={lang} />
        </div>
        {canOwnerDashboard && showRiskBadge ? (
          <div className="mt-3">
            <Suspense fallback={null}>
              <OfficeHubRiskBadge lang={lang} />
            </Suspense>
          </div>
        ) : null}
      </header>

      <OfficePremiumSection lang={lang} />

      {empty ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-4 text-sm font-bold text-amber-950">{t(lang, "officeHubEmpty")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:max-w-2xl sm:gap-4 lg:max-w-4xl">
          {visibleSections.map((section, index) => (
            <OfficeHubSectionTile
              key={section.id}
              to={officeHubSectionPath(section.id)}
              title={t(lang, section.titleKey)}
              subtitle={t(lang, section.subKey)}
              Icon={section.Icon}
              className={visibleSections.length % 2 === 1 && index === visibleSections.length - 1 ? "col-span-2" : undefined}
            />
          ))}
        </div>
      )}

      {(showInternalAdmin || isInternalAdminPreviewEnabled()) && (
        <div className="border-t border-stone-100 pt-4">
          {showInternalAdmin ? (
            <Link
              to="/internal/waka"
              className="inline-flex min-h-[40px] items-center text-xs font-bold text-stone-500 underline decoration-stone-300"
            >
              {t(lang, "internalAdminFooterLink")}
            </Link>
          ) : null}
          {isInternalAdminPreviewEnabled() ? (
            <Link
              to={internalAdminPreviewHref("/internal/waka")}
              className="ml-4 inline-flex min-h-[40px] items-center text-xs font-bold text-orange-700 underline"
            >
              {t(lang, "internalAdminPreviewOfficeLink")}
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}

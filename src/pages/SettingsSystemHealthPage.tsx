import type { Language } from "../types";
import { t } from "../lib/i18n";
import {
  SystemHealthDiagnosticsProvider,
  LazyDiagnosticsSection,
  SystemHealthSummaryStrip,
} from "../components/settings/SystemHealthDiagnosticsProvider";
import { SyncHealthCard } from "../components/SyncHealthCard";
import { ProductionReadinessCard } from "../components/settings/ProductionReadinessCard";
import { SystemHealthCard } from "../components/settings/SystemHealthCard";
import { DebtIntegrityCard } from "../components/settings/DebtIntegrityCard";
import { DebtSyncDiagnosticsCard } from "../components/settings/DebtSyncDiagnosticsCard";
import { PurchaseSyncDiagnosticsCard } from "../components/settings/PurchaseSyncDiagnosticsCard";
import { CashDrawerDiagnosticsCard } from "../components/settings/CashDrawerDiagnosticsCard";
import { DayDrawerOpenCloudDiagnosticsCard } from "../components/settings/DayDrawerOpenCloudDiagnosticsCard";
import { DeletionSafetyDiagnosticsCard } from "../components/settings/DeletionSafetyDiagnosticsCard";
import {
  RecoveryReadinessDashboard,
  RestoreDiagnosticsCard,
  QueueStatusCard,
  SnapshotHealthCard,
} from "../components/settings/RecoveryReadinessDashboard";
import { AuditHealthCard } from "../components/settings/AuditHealthCard";
import { PerformanceDiagnosticsCard } from "../components/settings/PerformanceDiagnosticsCard";
import { MultiDeviceHealthCard } from "../components/settings/MultiDeviceHealthCard";
import { PageBackBar } from "../components/layout/PageBackBar";
import { useSessionActor } from "../context/SessionActorContext";
import { canSeeFinanceDiagnostics } from "../lib/financeVisibility";
import { usePageLoadMark } from "../hooks/usePageLoadMark";

function LazyCard({
  lang,
  title,
  defaultOpen = false,
  onExpand,
  children,
}: {
  lang: Language;
  title: string;
  defaultOpen?: boolean;
  onExpand?: () => void;
  children: React.ReactNode;
}) {
  return (
    <LazyDiagnosticsSection lang={lang} title={title} defaultOpen={defaultOpen} onExpand={onExpand}>
      {children}
    </LazyDiagnosticsSection>
  );
}

export function SettingsSystemHealthPage({ lang }: { lang: Language }) {
  usePageLoadMark("settings-system-health");
  const actor = useSessionActor();
  const showPerformanceDiagnostics = canSeeFinanceDiagnostics(actor.role);

  return (
    <SystemHealthDiagnosticsProvider>
      <div className="space-y-6 pb-8">
        <PageBackBar lang={lang} fallbackTo="/settings" label={t(lang, "settingsHubTitle")} />
        <div>
          <h1 className="text-2xl font-black text-stone-950">{t(lang, "systemHealthPageTitle")}</h1>
          <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "systemHealthPageSub")}</p>
        </div>

        <SystemHealthSummaryStrip lang={lang} />

        <LazyCard lang={lang} title={t(lang, "multiDeviceHealthTitle")} defaultOpen>
          <MultiDeviceHealthCard lang={lang} />
        </LazyCard>

        <LazyCard lang={lang} title={t(lang, "syncDiagnosticsTitle")}>
          <SyncHealthCard lang={lang} variant="full" />
        </LazyCard>

        <LazyCard lang={lang} title={t(lang, "productionReadinessTitle")}>
          <ProductionReadinessCard lang={lang} lazy />
        </LazyCard>

        <LazyCard lang={lang} title={t(lang, "systemHealthCardTitle")}>
          <SystemHealthCard lang={lang} lazy />
        </LazyCard>

        <LazyCard lang={lang} title={t(lang, "debtIntegrityTitle")}>
          <DebtIntegrityCard lang={lang} lazy />
        </LazyCard>

        <LazyCard lang={lang} title={t(lang, "debtSyncDiagnosticsTitle")}>
          <DebtSyncDiagnosticsCard lang={lang} lazy />
        </LazyCard>

        <LazyCard lang={lang} title={t(lang, "purchaseSyncDiagnosticsTitle")}>
          <PurchaseSyncDiagnosticsCard lang={lang} />
        </LazyCard>

        <LazyCard lang={lang} title={t(lang, "cashDrawerDiagnosticsTitle")}>
          <CashDrawerDiagnosticsCard lang={lang} />
        </LazyCard>

        <LazyCard lang={lang} title={t(lang, "dayDrawerCloudDiagTitle")}>
          <DayDrawerOpenCloudDiagnosticsCard lang={lang} />
        </LazyCard>

        <LazyCard lang={lang} title={t(lang, "deletionSafetyDiagnosticsTitle")}>
          <DeletionSafetyDiagnosticsCard lang={lang} />
        </LazyCard>

        <LazyCard lang={lang} title={t(lang, "recoveryReadinessTitle")}>
          <RecoveryReadinessDashboard lang={lang} lazy />
        </LazyCard>

        <LazyCard lang={lang} title={t(lang, "restoreDiagnosticsTitle")}>
          <RestoreDiagnosticsCard lang={lang} />
        </LazyCard>

        <LazyCard lang={lang} title={t(lang, "queueStatusTitle")}>
          <QueueStatusCard lang={lang} lazy />
        </LazyCard>

        <LazyCard lang={lang} title={t(lang, "snapshotHealthTitle")}>
          <SnapshotHealthCard lang={lang} lazy />
        </LazyCard>

        <LazyCard lang={lang} title={t(lang, "auditHealthTitle")}>
          <AuditHealthCard lang={lang} lazy />
        </LazyCard>

        {showPerformanceDiagnostics ? (
          <LazyCard lang={lang} title={t(lang, "performanceDiagnosticsTitle")}>
            <PerformanceDiagnosticsCard lang={lang} />
          </LazyCard>
        ) : null}
      </div>
    </SystemHealthDiagnosticsProvider>
  );
}

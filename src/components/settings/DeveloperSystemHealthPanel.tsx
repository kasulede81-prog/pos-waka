import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  LazyDiagnosticsSection,
  SystemHealthDiagnosticsProvider,
} from "./SystemHealthDiagnosticsProvider";
import { SyncHealthCard } from "../SyncHealthCard";
import { ProductionReadinessCard } from "./ProductionReadinessCard";
import { SystemHealthCard } from "./SystemHealthCard";
import { DebtIntegrityCard } from "./DebtIntegrityCard";
import { DebtSyncDiagnosticsCard } from "./DebtSyncDiagnosticsCard";
import { PurchaseSyncDiagnosticsCard } from "./PurchaseSyncDiagnosticsCard";
import { CashDrawerDiagnosticsCard } from "./CashDrawerDiagnosticsCard";
import { DayDrawerOpenCloudDiagnosticsCard } from "./DayDrawerOpenCloudDiagnosticsCard";
import { DeletionSafetyDiagnosticsCard } from "./DeletionSafetyDiagnosticsCard";
import {
  RecoveryReadinessDashboard,
  RestoreDiagnosticsCard,
  QueueStatusCard,
  SnapshotHealthCard,
} from "./RecoveryReadinessDashboard";
import { AuditHealthCard } from "./AuditHealthCard";
import { PerformanceDiagnosticsCard } from "./PerformanceDiagnosticsCard";

function LazyCard({
  lang,
  title,
  defaultOpen = false,
  children,
}: {
  lang: Language;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <LazyDiagnosticsSection lang={lang} title={title} defaultOpen={defaultOpen}>
      {children}
    </LazyDiagnosticsSection>
  );
}

/** Full engineering diagnostics — internal admin only. */
export function DeveloperSystemHealthPanel({ lang }: { lang: Language }) {
  return (
    <SystemHealthDiagnosticsProvider>
      <div className="space-y-4">
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

        <LazyCard lang={lang} title={t(lang, "performanceDiagnosticsTitle")}>
          <PerformanceDiagnosticsCard lang={lang} />
        </LazyCard>
      </div>
    </SystemHealthDiagnosticsProvider>
  );
}

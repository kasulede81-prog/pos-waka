/**
 * Phase 24.1BB — background trust certification after core unlock.
 */

import { uploadShopCloudSnapshot } from "./cloudSnapshotSync";
import type { CloudShopProbe } from "./cloudRecoveryGate";
import { validateRecoveryCompletionGate } from "./cloudRecoveryGate";
import type { CloudRecoveryValidationResult } from "./cloudRecoveryValidator";
import {
  beginBackgroundCertification,
  completeCloudRecoverySession,
  recordCertificationWarnings,
  recordRecoveryCertification,
  setRecoveryProgressPhase,
  syncRecoveryRestoredCountsFromStore,
} from "./cloudRecoverySession";
import { logRecovery, markRecoveryPerf } from "./recoveryDiagnostics";
import { entityCountMismatchBlocksRecovery } from "./recoveryEntityParity";
import type { FullEntityCounts } from "./cloudTrustCenter";
import { usePosStore } from "../store/usePosStore";

export type BackgroundCertificationOpts = {
  probe: CloudShopProbe;
  validation: CloudRecoveryValidationResult;
  restoredCounts: import("./cloudRecoverySession").CloudRecoveryEntityCounts;
  /** Small-shop snapshot path — skip redundant full cloud pull during certification. */
  skipHeavyPull?: boolean;
};

function certificationFailuresBlockOperations(failures: string[]): boolean {
  return failures.some((f) => {
    if (f === "shop_still_empty" || f === "products_not_restored" || f === "inventory_catalog_missing") {
      return true;
    }
    if (f === "integrity_critical" || f === "recovery_invariant_failed") return true;
    if (f.startsWith("entity_count_mismatch_")) {
      const entityId = f.slice("entity_count_mismatch_".length) as keyof FullEntityCounts;
      return entityCountMismatchBlocksRecovery(entityId);
    }
    return false;
  });
}

let certificationInFlight: Promise<void> | null = null;

export function runBackgroundRecoveryCertification(opts: BackgroundCertificationOpts): Promise<void> {
  if (certificationInFlight) return certificationInFlight;

  certificationInFlight = (async () => {
    beginBackgroundCertification();
    logRecovery("certification_start");
    setRecoveryProgressPhase("validating");

    const { getDeviceOnline } = await import("./deviceOnline");
    if (getDeviceOnline() && !opts.skipHeavyPull) {
      const { syncShopWithCloud, resolveShopCtx } = await import("../offline/cloudSync");
      await syncShopWithCloud({ pull: true }).catch(() => undefined);
      const ctx = await resolveShopCtx();
      if (ctx?.shopId) {
        const { pullAuditLogsFromCloud, mergeAuditLogsFromCloudPull } = await import("./auditCloudSync");
        const recovered = await pullAuditLogsFromCloud(ctx.shopId).catch(() => []);
        if (recovered.length > 0) {
          const s = usePosStore.getState();
          const merged = mergeAuditLogsFromCloudPull(s.auditLogs, s.archivedAuditLogs, recovered);
          usePosStore.setState({
            auditLogs: merged.auditLogs,
            archivedAuditLogs: merged.archivedAuditLogs,
          });
          const { persistRestoredSnapshotToDisk } = await import("../store/usePosStore");
          await persistRestoredSnapshotToDisk(undefined, { cloudRecovery: true }).catch(() => undefined);
        }
      }
    }

    const { buildCloudRecoverySimulationReport, recordCloudRecoveryValidation } = await import(
      "./cloudRecoveryValidator"
    );
    const validation = buildCloudRecoverySimulationReport({ recoveryMode: true });
    recordCloudRecoveryValidation(validation);

    const {
      fetchCloudEntityCounts,
      buildCloudTrustCertificationReport,
      readLocalEntityCounts,
    } = await import("./cloudTrustCenter");
    const { counts: cloudCounts, errors: cloudErrors } = await fetchCloudEntityCounts();
    const certification = buildCloudTrustCertificationReport({
      cloud: cloudCounts,
      cloudErrors,
      local: readLocalEntityCounts(),
      requireCloudParity: true,
    });
    recordRecoveryCertification(certification);

    const gate = validateRecoveryCompletionGate(opts.probe, validation, { certification });
    syncRecoveryRestoredCountsFromStore(opts.restoredCounts);

    if (!gate.ok && certificationFailuresBlockOperations(gate.failures)) {
      logRecovery("certification_warning", { failures: gate.failures.join(",") });
      recordCertificationWarnings([...gate.failures, ...gate.warnings], gate.message);
      markRecoveryPerf("certificationFinishedMs");
      return;
    }

    setRecoveryProgressPhase("finalizing");
    logRecovery("finalize");

    const s = usePosStore.getState();
    const { buildRecoveryCompletenessReport } = await import("./cloudRecoveryCompleteness");
    const { wasLastSalesPullTruncated } = await import("../offline/cloudSync");
    const completeness = buildRecoveryCompletenessReport({
      validation,
      probe: opts.probe,
      stockMovements: s.stockMovements.length,
      inventoryCountSessions: s.inventoryCountSessions.length,
      archivedSales: s.archivedSales.length,
      salesPullTruncated: wasLastSalesPullTruncated(),
    });

    if (getDeviceOnline()) {
      await import("../offline/cloudSync").then((m) => m.pushShopPendingToCloud().catch(() => undefined));
      await uploadShopCloudSnapshot({ force: true }).catch(() => false);
    }

    completeCloudRecoverySession(validation, completeness, {
      inventoryWarnings: gate.inventoryWarnings || gate.warnings.length > 0 || !gate.ok,
      message: gate.ok ? gate.message : `${gate.message} (non-blocking)`,
    });

    const { clearRecoveryModuleCheckpoints } = await import("./recoveryModuleCheckpoints");
    clearRecoveryModuleCheckpoints();

    logRecovery("complete");
    markRecoveryPerf("certificationFinishedMs");
    markRecoveryPerf("recoveryCompletedMs");
  })().finally(() => {
    certificationInFlight = null;
  });

  return certificationInFlight;
}

import { normalizeParsedDiagnostics, type ParsedPilotDiagnostics } from "./pilotDiagnosticsParse";

export type RescueDiagnosticsKind =
  | "pilot"
  | "cloud_trust"
  | "production_certification"
  | "startup"
  | "cloud_recovery"
  | "sync_health"
  | "unknown";

export type ParsedCloudTrustDiagnostics = {
  checkedAt: string | null;
  certified: boolean;
  failures: string[];
  bootstrapComplete: boolean;
  recoveryInvariantPassed: boolean;
  inventoryIntegrityOk: boolean;
  inventoryIntegrityStatus: string;
  inventoryMismatches: Array<{
    productId: string;
    productName: string;
    recorded: number;
    expected: number;
    difference: number;
  }>;
  stockMovementCount: number;
  financial: {
    revenueUgx: number;
    profitUgx: number;
    inventoryValueUgx: number;
    totalCustomerDebtUgx: number;
    totalSupplierBalanceUgx: number;
    expectedCashTodayUgx: number;
  } | null;
};

export type ParsedStartupDiagnostics = {
  sessionId: string;
  startedAt: string;
  currentStep: string;
  lastSuccessfulStep: string | null;
  durationMs: number;
  failureReason: string | null;
  recoveryErrorKey: string | null;
  stallDetectedAt: string | null;
  crashRecoveryApplied: boolean;
  history: Array<{ step: string; at: string }>;
};

export type ParsedCloudRecoveryDiagnostics = {
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  currentStep: string | null;
  lastCompletedStep: string | null;
  errorMessage: string | null;
  errorKey: string | null;
  recoveryApplicable: boolean | null;
  recoveryLockActive: boolean | null;
  lastRecoveryAt: string | null;
  lastValidationAt: string | null;
  warnings: string[];
  failures: string[];
  inventoryReconciliation: {
    productsRestored: number;
    movementsRestored: number;
    remainingMismatchCount: number;
    inventoryIntegrityStatus: string;
    mismatches: ParsedCloudTrustDiagnostics["inventoryMismatches"];
  } | null;
};

export type ParsedSyncHealthExport = {
  pendingOutbound: number;
  lastPullAt: string | null;
  lastPushOkAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
  pendingBreakdown: Record<string, number>;
  failedOperations: number;
  retryWaitMs: number | null;
  pendingUploads: number;
  pendingDownloads: number;
  inventoryReconciliation: string | null;
  auditQueue: number;
};

export type ParsedRescueDiagnostics = {
  kind: RescueDiagnosticsKind;
  valid: boolean;
  parseError?: string;
  raw: Record<string, unknown>;
  pilot: ParsedPilotDiagnostics | null;
  cloudTrust: ParsedCloudTrustDiagnostics | null;
  startup: ParsedStartupDiagnostics | null;
  cloudRecovery: ParsedCloudRecoveryDiagnostics | null;
  syncHealth: ParsedSyncHealthExport | null;
  /** Total pending queue from any recognized export. */
  pendingQueueTotal: number | null;
  shopId: string | null;
  exportedAt: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, fallback = "—"): string {
  if (v == null) return fallback;
  const s = String(v).trim();
  return s || fallback;
}

function detectKind(raw: Record<string, unknown>): RescueDiagnosticsKind {
  if (raw.pendingSyncQueue != null || raw.pending_sync_queue != null || raw.recentPilotEvents != null) {
    return "pilot";
  }
  if (raw.verdict === "PASS" || raw.verdict === "FAIL" || raw.operationalFingerprint != null) {
    return "production_certification";
  }
  if (raw.certified != null && Array.isArray(raw.rows)) return "cloud_trust";
  if (raw.currentStep != null && raw.sessionId != null && raw.history != null) return "startup";
  if (raw.status != null && (raw.integrityDiagnostics != null || raw.lastRecoveryAt != null)) {
    return "cloud_recovery";
  }
  if (raw.pendingOutbound != null || raw.pending_outbound != null || raw.syncHealth != null) {
    return "sync_health";
  }
  return "unknown";
}

function parseInventoryMismatches(raw: unknown): ParsedCloudTrustDiagnostics["inventoryMismatches"] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = asRecord(row) ?? {};
    const recorded = num(r.recorded ?? r.recordedQty ?? r.recorded_quantity);
    const expected = num(r.expected ?? r.expectedQty ?? r.expected_quantity);
    return {
      productId: str(r.productId ?? r.product_id, ""),
      productName: str(r.productName ?? r.product_name ?? r.name, "Product"),
      recorded,
      expected,
      difference: num(r.difference, recorded - expected),
    };
  });
}

function parseCloudTrust(raw: Record<string, unknown>): ParsedCloudTrustDiagnostics {
  const fin = asRecord(raw.financial);
  return {
    checkedAt: raw.checkedAt != null ? String(raw.checkedAt) : null,
    certified: Boolean(raw.certified),
    failures: Array.isArray(raw.failures) ? raw.failures.map(String) : [],
    bootstrapComplete: Boolean(raw.bootstrapComplete),
    recoveryInvariantPassed: Boolean(raw.recoveryInvariantPassed),
    inventoryIntegrityOk: Boolean(raw.inventoryIntegrityOk),
    inventoryIntegrityStatus: str(raw.inventoryIntegrityStatus, "unknown"),
    inventoryMismatches: parseInventoryMismatches(raw.inventoryMismatches),
    stockMovementCount: num(raw.stockMovementCount),
    financial: fin
      ? {
          revenueUgx: num(fin.revenueUgx),
          profitUgx: num(fin.profitUgx),
          inventoryValueUgx: num(fin.inventoryValueUgx),
          totalCustomerDebtUgx: num(fin.totalCustomerDebtUgx),
          totalSupplierBalanceUgx: num(fin.totalSupplierBalanceUgx ?? fin.totalSupplierBalance),
          expectedCashTodayUgx: num(fin.expectedCashTodayUgx),
        }
      : null,
  };
}

function parseProductionCert(raw: Record<string, unknown>): {
  cloudTrust: ParsedCloudTrustDiagnostics;
  cloudRecovery: ParsedCloudRecoveryDiagnostics;
  syncHealth: ParsedSyncHealthExport | null;
} {
  const base = parseCloudTrust(raw);
  const pending = asRecord(raw.pendingSync);
  const recoveryRaw = asRecord(raw.recoveryDiagnostics) ?? raw.recoveryDiagnostics;
  const recovery = parseCloudRecovery(
    recoveryRaw && typeof recoveryRaw === "object" ? (recoveryRaw as Record<string, unknown>) : {},
  );
  const syncHealth: ParsedSyncHealthExport | null = pending
    ? {
        pendingOutbound: num(pending.totalPending ?? pending.queueTotal),
        lastPullAt: null,
        lastPushOkAt: null,
        lastError: raw.syncHealthLastIssue != null ? String(raw.syncHealthLastIssue) : null,
        updatedAt: raw.checkedAt != null ? String(raw.checkedAt) : null,
        pendingBreakdown: {},
        failedOperations: num(pending.unsyncedSalesFlag),
        retryWaitMs: null,
        pendingUploads: num(pending.totalEntityPending),
        pendingDownloads: 0,
        inventoryReconciliation: base.inventoryIntegrityStatus,
        auditQueue: 0,
      }
    : null;
  return { cloudTrust: base, cloudRecovery: recovery, syncHealth };
}

function parseStartup(raw: Record<string, unknown>): ParsedStartupDiagnostics {
  const historyRaw = raw.history;
  const history = Array.isArray(historyRaw)
    ? historyRaw.map((row) => {
        const r = asRecord(row) ?? {};
        return { step: str(r.step), at: str(r.at) };
      })
    : [];
  return {
    sessionId: str(raw.sessionId),
    startedAt: str(raw.startedAt),
    currentStep: str(raw.currentStep),
    lastSuccessfulStep: raw.lastSuccessfulStep != null ? String(raw.lastSuccessfulStep) : null,
    durationMs: num(raw.durationMs),
    failureReason: raw.failureReason != null ? String(raw.failureReason) : null,
    recoveryErrorKey: raw.recoveryErrorKey != null ? String(raw.recoveryErrorKey) : null,
    stallDetectedAt: raw.stallDetectedAt != null ? String(raw.stallDetectedAt) : null,
    crashRecoveryApplied: Boolean(raw.crashRecoveryApplied),
    history,
  };
}

function parseCloudRecovery(raw: Record<string, unknown>): ParsedCloudRecoveryDiagnostics {
  const integrity = asRecord(raw.integrityDiagnostics);
  const invRec = integrity ? asRecord(integrity.inventoryReconciliation) : null;
  const cert = asRecord(raw.certification);
  const validation = asRecord(raw.validation);
  const warnings: string[] = [];
  const failures: string[] = [];
  if (raw.completedWithInventoryWarnings) warnings.push("Recovery completed with inventory warnings");
  if (raw.errorMessage) failures.push(String(raw.errorMessage));
  if (cert && Array.isArray(cert.failures)) failures.push(...cert.failures.map(String));
  return {
    status: str(raw.status, "unknown"),
    startedAt: raw.startedAt != null ? String(raw.startedAt) : null,
    finishedAt: raw.finishedAt != null ? String(raw.finishedAt) : null,
    durationMs: raw.durationMs != null ? num(raw.durationMs) : null,
    currentStep: raw.currentStep != null ? String(raw.currentStep) : null,
    lastCompletedStep: raw.lastCompletedStep != null ? String(raw.lastCompletedStep) : null,
    errorMessage: raw.errorMessage != null ? String(raw.errorMessage) : null,
    errorKey: raw.errorKey != null ? String(raw.errorKey) : null,
    recoveryApplicable: raw.recoveryApplicable != null ? Boolean(raw.recoveryApplicable) : null,
    recoveryLockActive: raw.recoveryLockActive != null ? Boolean(raw.recoveryLockActive) : null,
    lastRecoveryAt: raw.lastRecoveryAt != null ? String(raw.lastRecoveryAt) : raw.finishedAt != null ? String(raw.finishedAt) : null,
    lastValidationAt: validation?.validatedAt != null ? String(validation.validatedAt) : null,
    warnings,
    failures,
    inventoryReconciliation: invRec
      ? {
          productsRestored: num(invRec.productsRestored),
          movementsRestored: num(invRec.movementsRestored),
          remainingMismatchCount: num(invRec.remainingMismatchCount),
          inventoryIntegrityStatus: str(invRec.inventoryIntegrityStatus, "unknown"),
          mismatches: parseInventoryMismatches(invRec.mismatches),
        }
      : null,
  };
}

function parseSyncHealthExport(raw: Record<string, unknown>): ParsedSyncHealthExport {
  const nested = asRecord(raw.syncHealth) ?? asRecord(raw.sync_health) ?? raw;
  const breakdown = asRecord(nested.pendingSyncBreakdown ?? nested.pending_breakdown ?? raw.pendingSyncBreakdown) ?? {};
  return {
    pendingOutbound: num(nested.pendingOutbound ?? nested.pending_outbound ?? raw.pendingSyncQueue),
    lastPullAt: nested.lastPullAt != null ? String(nested.lastPullAt) : nested.last_pull_at != null ? String(nested.last_pull_at) : null,
    lastPushOkAt:
      nested.lastPushOkAt != null ? String(nested.lastPushOkAt) : nested.last_push_ok_at != null ? String(nested.last_push_ok_at) : null,
    lastError: nested.lastError != null ? String(nested.lastError) : nested.last_error != null ? String(nested.last_error) : null,
    updatedAt: nested.updatedAt != null ? String(nested.updatedAt) : nested.updated_at != null ? String(nested.updated_at) : null,
    pendingBreakdown: Object.fromEntries(Object.entries(breakdown).map(([k, v]) => [k, num(v)])),
    failedOperations: num(nested.failedOperations ?? nested.syncErrorCount ?? raw.syncErrorCount),
    retryWaitMs: nested.retryWaitMs != null ? num(nested.retryWaitMs) : null,
    pendingUploads: num(nested.pendingUploads ?? nested.pending_outbound),
    pendingDownloads: num(nested.pendingDownloads),
    inventoryReconciliation: nested.inventoryReconciliation != null ? String(nested.inventoryReconciliation) : null,
    auditQueue: num(nested.auditQueue ?? breakdown.auditLogs ?? breakdown.audit),
  };
}

export function parseRescueDiagnosticsJson(text: string): ParsedRescueDiagnostics | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const raw = JSON.parse(trimmed) as Record<string, unknown>;
    return normalizeRescueDiagnostics(raw);
  } catch (e) {
    return {
      kind: "unknown",
      valid: false,
      parseError: e instanceof Error ? e.message : "Invalid JSON",
      raw: {},
      pilot: null,
      cloudTrust: null,
      startup: null,
      cloudRecovery: null,
      syncHealth: null,
      pendingQueueTotal: null,
      shopId: null,
      exportedAt: null,
    };
  }
}

export function normalizeRescueDiagnostics(raw: Record<string, unknown>): ParsedRescueDiagnostics {
  const kind = detectKind(raw);
  let pilot: ParsedPilotDiagnostics | null = null;
  let cloudTrust: ParsedCloudTrustDiagnostics | null = null;
  let startup: ParsedStartupDiagnostics | null = null;
  let cloudRecovery: ParsedCloudRecoveryDiagnostics | null = null;
  let syncHealth: ParsedSyncHealthExport | null = null;

  if (kind === "pilot") {
    pilot = normalizeParsedDiagnostics(raw);
  } else if (kind === "cloud_trust") {
    cloudTrust = parseCloudTrust(raw);
  } else if (kind === "production_certification") {
    const parsed = parseProductionCert(raw);
    cloudTrust = parsed.cloudTrust;
    cloudRecovery = parsed.cloudRecovery;
    syncHealth = parsed.syncHealth;
  } else if (kind === "startup") {
    startup = parseStartup(raw);
  } else if (kind === "cloud_recovery") {
    cloudRecovery = parseCloudRecovery(raw);
    if (asRecord(raw.certification)) cloudTrust = parseCloudTrust(asRecord(raw.certification)!);
  } else if (kind === "sync_health") {
    syncHealth = parseSyncHealthExport(raw);
    pilot = normalizeParsedDiagnostics(raw);
  }

  const pendingQueueTotal =
    pilot?.pendingSyncQueue ??
    syncHealth?.pendingOutbound ??
    (cloudRecovery?.status === "active" ? 1 : null);

  const shopId =
    pilot?.shopId ??
    (raw.shopId != null ? String(raw.shopId) : null) ??
    (raw.shop_id != null ? String(raw.shop_id) : null);

  const exportedAt =
    pilot?.exportedAt ??
    cloudTrust?.checkedAt ??
    startup?.startedAt ??
    cloudRecovery?.lastRecoveryAt ??
    syncHealth?.updatedAt ??
    (raw.at != null ? String(raw.at) : null);

  return {
    kind,
    valid: kind !== "unknown",
    raw,
    pilot,
    cloudTrust,
    startup,
    cloudRecovery,
    syncHealth,
    pendingQueueTotal,
    shopId,
    exportedAt,
  };
}

export function rescueDiagnosticsKindLabel(kind: RescueDiagnosticsKind): string {
  switch (kind) {
    case "pilot":
      return "Pilot / device diagnostics";
    case "cloud_trust":
      return "Cloud Trust JSON";
    case "production_certification":
      return "Production Certification JSON";
    case "startup":
      return "Startup Diagnostics";
    case "cloud_recovery":
      return "Cloud Recovery session";
    case "sync_health":
      return "Sync Health export";
    default:
      return "Unknown format";
  }
}

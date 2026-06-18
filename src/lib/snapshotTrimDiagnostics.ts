/**
 * Cloud snapshot trim diagnostics — detect size pressure before upload.
 */

import { buildExportEnvelope } from "../offline/backupEngine";
import type { PersistedSnapshot } from "../offline/localDb";

export const MAX_CLOUD_SNAPSHOT_BYTES = 8 * 1024 * 1024;
export const SNAPSHOT_SIZE_WARN_BYTES = 6 * 1024 * 1024;

export type SnapshotTrimStatus = "ok" | "warn_size" | "trimmed_archives" | "trimmed_sales" | "critical";

export type SnapshotTrimAnalysis = {
  originalBytes: number;
  trimmedBytes: number;
  originalSalesCount: number;
  retainedSalesCount: number;
  originalArchivedSalesCount: number;
  retainedArchivedSalesCount: number;
  archivesRemoved: boolean;
  salesTrimmedCount: number;
  status: SnapshotTrimStatus;
  wouldTrim: boolean;
};

function envelopeBytes(snap: PersistedSnapshot): number {
  return JSON.stringify(buildExportEnvelope(snap)).length;
}

/** Simulate trim logic (sync) for pre-upload diagnostics. */
export function analyzeSnapshotTrim(source: PersistedSnapshot): SnapshotTrimAnalysis {
  const originalBytes = envelopeBytes(source);
  const originalSalesCount = source.sales.length;
  const originalArchivedSalesCount = source.archivedSales?.length ?? 0;

  if (originalBytes <= MAX_CLOUD_SNAPSHOT_BYTES) {
    return {
      originalBytes,
      trimmedBytes: originalBytes,
      originalSalesCount,
      retainedSalesCount: originalSalesCount,
      originalArchivedSalesCount,
      retainedArchivedSalesCount: originalArchivedSalesCount,
      archivesRemoved: false,
      salesTrimmedCount: 0,
      status: originalBytes >= SNAPSHOT_SIZE_WARN_BYTES ? "warn_size" : "ok",
      wouldTrim: false,
    };
  }

  const trimmed: PersistedSnapshot = {
    ...source,
    archivedSales: [],
    archivedAuditLogs: [],
    archivedDayCloses: [],
    archivedVoidRecords: [],
    archivedReturnRecords: [],
  };
  let trimmedBytes = envelopeBytes(trimmed);
  let archivesRemoved = true;
  let sales = [...source.sales].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  let salesTrimmedCount = 0;

  if (trimmedBytes > MAX_CLOUD_SNAPSHOT_BYTES) {
    while (sales.length > 500 && trimmedBytes > MAX_CLOUD_SNAPSHOT_BYTES) {
      sales.shift();
      salesTrimmedCount += 1;
      trimmedBytes = envelopeBytes({ ...trimmed, sales });
    }
  }

  let retainedSales = sales;
  if (trimmedBytes > MAX_CLOUD_SNAPSHOT_BYTES) {
    retainedSales = sales.slice(-300);
    trimmedBytes = envelopeBytes({ ...trimmed, sales: retainedSales });
    salesTrimmedCount = originalSalesCount - retainedSales.length;
  }

  const status: SnapshotTrimStatus =
    salesTrimmedCount > 0 ? "trimmed_sales" : archivesRemoved ? "trimmed_archives" : "critical";

  return {
    originalBytes,
    trimmedBytes,
    originalSalesCount,
    retainedSalesCount: retainedSales.length,
    originalArchivedSalesCount,
    retainedArchivedSalesCount: 0,
    archivesRemoved,
    salesTrimmedCount,
    status,
    wouldTrim: true,
  };
}

let lastUploadTrimAnalysis: SnapshotTrimAnalysis | null = null;

export function recordSnapshotUploadTrimAnalysis(analysis: SnapshotTrimAnalysis): void {
  lastUploadTrimAnalysis = analysis;
}

export function getLastSnapshotUploadTrimAnalysis(): SnapshotTrimAnalysis | null {
  return lastUploadTrimAnalysis;
}

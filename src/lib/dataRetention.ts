import type { DataRetentionPolicy } from "../types";

export const DATA_RETENTION_OPTIONS: DataRetentionPolicy[] = ["3m", "6m", "12m", "forever"];

export const DEFAULT_DATA_RETENTION_POLICY: DataRetentionPolicy = "3m";

export function normalizeDataRetentionPolicy(raw: unknown): DataRetentionPolicy {
  if (raw === "forever" || raw === "3m" || raw === "6m" || raw === "12m") return raw;
  return DEFAULT_DATA_RETENTION_POLICY;
}

/** Calendar-day retention windows (90 / 180 / 365). */
export function retentionDaysForPolicy(policy: DataRetentionPolicy): number | null {
  if (policy === "forever") return null;
  if (policy === "3m") return 90;
  if (policy === "6m") return 180;
  return 365;
}

/** ISO timestamp: records strictly older than this should be archived. */
export function archiveCutoffIso(policy: DataRetentionPolicy, nowMs = Date.now()): string | null {
  const days = retentionDaysForPolicy(policy);
  if (days == null) return null;
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

export function isBeforeCutoff(recordIso: string, cutoffIso: string): boolean {
  const t = new Date(recordIso).getTime();
  if (Number.isNaN(t)) return false;
  return t < new Date(cutoffIso).getTime();
}

export function retentionPolicyLabelKey(policy: DataRetentionPolicy): string {
  if (policy === "forever") return "retentionPolicyForever";
  if (policy === "3m") return "retentionPolicy3m";
  if (policy === "6m") return "retentionPolicy6m";
  return "retentionPolicy12m";
}

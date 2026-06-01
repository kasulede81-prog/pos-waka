import type { UserRole } from "../types";
import type { SyncHealthMeta } from "./syncMeta";
import { getOrCreateDeviceId } from "./deviceId";
import { countSalesWithSyncErrors, countUnsyncedSales, listSalesWithSyncErrors } from "../offline/cloudSync";
import { readSyncQueue } from "../offline/localDb";
import { readPilotEvents } from "./pilotEventLog";

/** Server migrations required for pilot (client cannot verify apply state). */
export const PILOT_REQUIRED_MIGRATIONS = ["076_scale_hardening", "077_financial_integrity", "078_business_type_persistence"] as const;

export type PilotDiagnosticsExport = {
  at: string;
  appVersion: string;
  authMode: "supabase" | "local";
  plan: string;
  deviceId: string;
  shopId: string | null;
  cloudRole: UserRole | null;
  effectiveRole: UserRole;
  businessType: string;
  pendingSyncQueue: number;
  pendingSyncBreakdown: Record<string, number>;
  unsyncedSales: number;
  syncErrors: Array<{ id: string; error: string; createdAt: string }>;
  syncErrorCount: number;
  syncHealth: SyncHealthMeta;
  requiredMigrations: readonly string[];
  migrationNote: string;
  pilotModeEnabled?: boolean;
  recentPilotEvents?: Array<{ at: string; kind: string; summary: string }>;
};

export async function buildPilotDiagnosticsExport(input: {
  authMode: "supabase" | "local";
  plan: string;
  shopId: string | null;
  cloudRole: UserRole | null;
  effectiveRole: UserRole;
  businessType: string;
  syncHealth: SyncHealthMeta;
  pendingCount: number;
  pendingBreakdown: { sales: number; stock: number; returns: number; expenses: number; other: number };
  pilotModeEnabled?: boolean;
}): Promise<PilotDiagnosticsExport> {
  const queue = await readSyncQueue().catch(() => []);
  const breakdown: Record<string, number> = {
    sales: input.pendingBreakdown.sales,
    stock: input.pendingBreakdown.stock,
    returns: input.pendingBreakdown.returns,
    expenses: input.pendingBreakdown.expenses,
    other: input.pendingBreakdown.other,
    queueTotal: queue.length,
  };

  return {
    at: new Date().toISOString(),
    appVersion: import.meta.env.VITE_APP_VERSION?.trim() || "1.0.5",
    authMode: input.authMode,
    plan: input.plan,
    deviceId: getOrCreateDeviceId(),
    shopId: input.shopId,
    cloudRole: input.cloudRole,
    effectiveRole: input.effectiveRole,
    businessType: input.businessType,
    pendingSyncQueue: input.pendingCount,
    pendingSyncBreakdown: breakdown,
    unsyncedSales: countUnsyncedSales(),
    syncErrors: listSalesWithSyncErrors(12),
    syncErrorCount: countSalesWithSyncErrors(),
    syncHealth: input.syncHealth,
    requiredMigrations: PILOT_REQUIRED_MIGRATIONS,
    migrationNote: "Verify migrations 076–078 applied in Supabase SQL editor (not verifiable from client).",
    pilotModeEnabled: input.pilotModeEnabled ?? false,
    recentPilotEvents: readPilotEvents(15).map((e) => ({ at: e.at, kind: e.kind, summary: e.summary })),
  };
}

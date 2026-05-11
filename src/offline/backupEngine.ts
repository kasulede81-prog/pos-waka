import { dateKeyKampala } from "../lib/datesUg";
import type { PersistedSnapshot } from "./localDb";
import {
  appendBackupRecord,
  deleteBackupRecord,
  listBackupRecords,
  readSnapshotWithFallback,
  type LocalBackupRecord,
} from "./localDb";

const MAX_BACKUPS = 28;

function snapshotFromPartial(p: Partial<PersistedSnapshot>): PersistedSnapshot | null {
  if (!p || !Array.isArray(p.products) || !Array.isArray(p.sales) || !p.preferences) return null;
  return {
    products: p.products,
    customers: p.customers ?? [],
    sales: p.sales,
    preferences: p.preferences,
    debtPayments: p.debtPayments ?? [],
    dayCloses: p.dayCloses ?? [],
    auditLogs: p.auditLogs ?? [],
    suppliers: p.suppliers ?? [],
    purchases: p.purchases ?? [],
    supplierPayments: p.supplierPayments ?? [],
    stockMovements: p.stockMovements ?? [],
    updatedAt: p.updatedAt ?? new Date().toISOString(),
  };
}

async function pruneOldBackups(): Promise<void> {
  const all = await listBackupRecords();
  if (all.length <= MAX_BACKUPS) return;
  const drop = all.slice(MAX_BACKUPS);
  for (const r of drop) {
    await deleteBackupRecord(r.id);
  }
}

/** After a successful snapshot write, once per Kampala calendar day. */
export async function maybeAppendDailyAutoBackup(lastSavedDateKey: string | undefined): Promise<string | undefined> {
  const today = dateKeyKampala(new Date());
  if (lastSavedDateKey === today) return lastSavedDateKey;

  const raw = await readSnapshotWithFallback();
  const snap = snapshotFromPartial(raw ?? {});
  if (!snap) return lastSavedDateKey;

  const id = `auto-${today}`;
  const rec: LocalBackupRecord = {
    id,
    kind: "daily_auto",
    createdAt: new Date().toISOString(),
    dateKey: today,
    snapshot: snap,
  };
  try {
    await appendBackupRecord(rec);
  } catch {
    return lastSavedDateKey;
  }
  await pruneOldBackups();
  return today;
}

export async function appendManualBackup(): Promise<{ ok: true; id: string } | { ok: false }> {
  const raw = await readSnapshotWithFallback();
  const snap = snapshotFromPartial(raw ?? {});
  if (!snap) return { ok: false };
  const id = `manual-${Date.now()}`;
  const rec: LocalBackupRecord = {
    id,
    kind: "manual",
    createdAt: new Date().toISOString(),
    snapshot: snap,
  };
  await appendBackupRecord(rec);
  await pruneOldBackups();
  return { ok: true, id };
}

export const WAKA_BACKUP_FILE_VERSION = 1;

export type WakaExportEnvelope = {
  wakaBackupVersion: typeof WAKA_BACKUP_FILE_VERSION;
  exportedAt: string;
  snapshot: PersistedSnapshot;
  /** 0 = plain JSON today; future versions may wrap ciphertext here. */
  encryptionVersion?: 0;
};

export function buildExportEnvelope(snapshot: PersistedSnapshot): WakaExportEnvelope {
  return {
    wakaBackupVersion: WAKA_BACKUP_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    snapshot,
    encryptionVersion: 0,
  };
}

export function parseImportEnvelope(text: string): WakaExportEnvelope {
  const data = JSON.parse(text) as unknown;
  if (!data || typeof data !== "object") throw new Error("invalid");
  const o = data as Record<string, unknown>;
  if (o.wakaBackupVersion !== WAKA_BACKUP_FILE_VERSION) throw new Error("version");
  const snap = o.snapshot as PersistedSnapshot | undefined;
  if (!snap || !Array.isArray(snap.products) || !Array.isArray(snap.sales) || !snap.preferences) throw new Error("snapshot");
  return { wakaBackupVersion: 1, exportedAt: typeof o.exportedAt === "string" ? o.exportedAt : new Date().toISOString(), snapshot: snap };
}

export async function listBackupMeta(): Promise<Array<{ id: string; kind: LocalBackupRecord["kind"]; createdAt: string; dateKey?: string }>> {
  const rows = await listBackupRecords();
  return rows.map((r) => ({ id: r.id, kind: r.kind, createdAt: r.createdAt, dateKey: r.dateKey }));
}

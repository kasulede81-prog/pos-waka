import { dateKeyKampala } from "../lib/datesUg";
import {
  assertBackupRestoreNotAborted,
  clearBackupParseWorker,
  registerBackupParseWorker,
} from "../lib/backupRestoreSession";
import { yieldUiTick } from "../lib/uiYield";
import type { PersistedSnapshot } from "./localDb";
import {
  appendBackupRecord,
  deleteBackupRecord,
  listBackupRecords,
  readSnapshotWithFallback,
  type LocalBackupRecord,
} from "./localDb";

const MAX_BACKUPS = 28;

export function snapshotFromPartial(p: Partial<PersistedSnapshot>): PersistedSnapshot | null {
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
    archivedSales: p.archivedSales ?? [],
    archivedAuditLogs: p.archivedAuditLogs ?? [],
    archivedDayCloses: p.archivedDayCloses ?? [],
    archivedVoidRecords: p.archivedVoidRecords ?? [],
    archivedReturnRecords: p.archivedReturnRecords ?? [],
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

export const MAX_BACKUP_IMPORT_BYTES = 40 * 1024 * 1024;

export function validateImportEnvelope(data: unknown): WakaExportEnvelope {
  if (!data || typeof data !== "object") throw new Error("invalid");
  const o = data as Record<string, unknown>;
  if (o.wakaBackupVersion !== WAKA_BACKUP_FILE_VERSION) throw new Error("version");
  const snap = o.snapshot as PersistedSnapshot | undefined;
  if (!snap || !Array.isArray(snap.products) || !Array.isArray(snap.sales) || !snap.preferences) throw new Error("snapshot");
  return {
    wakaBackupVersion: 1,
    exportedAt: typeof o.exportedAt === "string" ? o.exportedAt : new Date().toISOString(),
    snapshot: snap,
  };
}

export function parseImportEnvelope(text: string): WakaExportEnvelope {
  return validateImportEnvelope(JSON.parse(text) as unknown);
}

async function parseImportBufferInWorker(buffer: ArrayBuffer, sessionId: number): Promise<unknown> {
  const WorkerCtor = (await import("./backupParse.worker?worker")).default;
  return new Promise((resolve, reject) => {
    const worker = new WorkerCtor();
    registerBackupParseWorker(() => {
      worker.terminate();
      clearBackupParseWorker();
    });
    const fail = (err: unknown) => {
      worker.terminate();
      clearBackupParseWorker();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    worker.onmessage = (event: MessageEvent<{ ok: boolean; data?: unknown; error?: string }>) => {
      worker.terminate();
      clearBackupParseWorker();
      if (event.data.ok) resolve(event.data.data);
      else fail(new Error(event.data.error ?? "parse"));
    };
    worker.onerror = () => fail(new Error("worker"));
    assertBackupRestoreNotAborted(sessionId);
    worker.postMessage(buffer, [buffer]);
  });
}

/** Read + parse a backup file (worker when possible). Checks sessionId for cancel. */
export async function parseImportEnvelopeFromFile(file: File, sessionId: number): Promise<WakaExportEnvelope> {
  assertBackupRestoreNotAborted(sessionId);
  const buffer = await file.arrayBuffer();
  assertBackupRestoreNotAborted(sessionId);
  await yieldUiTick();

  if (typeof Worker !== "undefined") {
    try {
      const data = await parseImportBufferInWorker(buffer, sessionId);
      assertBackupRestoreNotAborted(sessionId);
      return validateImportEnvelope(data);
    } catch (err) {
      if ((err as Error).message === "backup_restore_aborted") throw err;
      /* fall through — worker unavailable on some WebViews */
    }
  }

  assertBackupRestoreNotAborted(sessionId);
  const text = new TextDecoder().decode(buffer);
  await yieldUiTick();
  assertBackupRestoreNotAborted(sessionId);
  return parseImportEnvelope(text);
}

/** Parse on a later tick so the UI can show a spinner before a large JSON.parse blocks. */
export async function parseImportEnvelopeAsync(text: string): Promise<WakaExportEnvelope> {
  await yieldUiTick();
  return parseImportEnvelope(text);
}

export async function listBackupMeta(): Promise<Array<{ id: string; kind: LocalBackupRecord["kind"]; createdAt: string; dateKey?: string }>> {
  const rows = await listBackupRecords();
  return rows.map((r) => ({ id: r.id, kind: r.kind, createdAt: r.createdAt, dateKey: r.dateKey }));
}

import { buildExportEnvelope, validateImportEnvelope, WAKA_BACKUP_FILE_VERSION } from "../offline/backupEngine";
import type { PersistedSnapshot } from "../offline/localDb";
import { applyRestoredSnapshotFromBackup, persistRestoredSnapshotToDisk, usePosStore } from "../store/usePosStore";
import { hasSupabaseConfig, supabase } from "./supabase";
import { yieldUiTick } from "./uiYield";

const MAX_CLOUD_SNAPSHOT_BYTES = 8 * 1024 * 1024;
/** Avoid re-uploading a huge JSON blob on every sync (keeps the app responsive). */
const MIN_UPLOAD_INTERVAL_MS = 5 * 60_000;
let lastCloudSnapshotUploadAt = 0;
let cloudSnapshotUploadInFlight: Promise<boolean> | null = null;

type ShopCtx = { shopId: string; userId: string };

async function resolveShopCtx(): Promise<ShopCtx | null> {
  if (!hasSupabaseConfig || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return null;
  const { resolvePrimaryOrganizationForUser } = await import("./fetchShopSubscription");
  const orgShop = await resolvePrimaryOrganizationForUser(userId);
  if (!orgShop) return null;
  return { shopId: orgShop.shopId, userId };
}

function snapshotFromStore(): PersistedSnapshot | null {
  const s = usePosStore.getState();
  if (!s._hydrated) return null;
  return {
    products: s.products,
    customers: s.customers,
    sales: s.sales,
    preferences: s.preferences,
    debtPayments: s.debtPayments,
    dayCloses: s.dayCloses,
    auditLogs: s.auditLogs,
    suppliers: s.suppliers,
    purchases: s.purchases,
    supplierPayments: s.supplierPayments,
    stockMovements: s.stockMovements,
    voidRecords: s.voidRecords,
    returnRecords: s.returnRecords,
    cashExpenses: s.cashExpenses,
    archivedSales: s.archivedSales,
    archivedAuditLogs: s.archivedAuditLogs,
    archivedDayCloses: s.archivedDayCloses,
    archivedVoidRecords: s.archivedVoidRecords,
    archivedReturnRecords: s.archivedReturnRecords,
    updatedAt: new Date().toISOString(),
  };
}

/** Trim snapshot JSON size for cloud upload by dropping oldest archived sales if needed. */
async function trimSnapshotForUpload(snap: PersistedSnapshot): Promise<PersistedSnapshot> {
  let env = buildExportEnvelope(snap);
  let json = JSON.stringify(env);
  if (json.length <= MAX_CLOUD_SNAPSHOT_BYTES) return snap;

  const trimmed: PersistedSnapshot = {
    ...snap,
    archivedSales: [],
    archivedAuditLogs: [],
    archivedDayCloses: [],
    archivedVoidRecords: [],
    archivedReturnRecords: [],
  };
  env = buildExportEnvelope(trimmed);
  json = JSON.stringify(env);
  if (json.length <= MAX_CLOUD_SNAPSHOT_BYTES) return trimmed;

  const sales = [...snap.sales].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  let trimmedCount = 0;
  while (sales.length > 500 && json.length > MAX_CLOUD_SNAPSHOT_BYTES) {
    sales.shift();
    trimmedCount += 1;
    if (trimmedCount % 40 === 0) await yieldUiTick();
  }
  const smaller = { ...trimmed, sales };
  json = JSON.stringify(buildExportEnvelope(smaller));
  if (json.length <= MAX_CLOUD_SNAPSHOT_BYTES) return smaller;

  return { ...smaller, sales: sales.slice(-300) };
}

export function isLocalShopDataEmpty(): boolean {
  const s = usePosStore.getState();
  return s.products.length === 0 && s.sales.length === 0 && s.customers.length === 0;
}

/** Upload full local snapshot to Supabase (debounced; call after sales/products are synced when possible). */
export async function uploadShopCloudSnapshot(opts?: { force?: boolean }): Promise<boolean> {
  const now = Date.now();
  if (!opts?.force && now - lastCloudSnapshotUploadAt < MIN_UPLOAD_INTERVAL_MS) {
    return false;
  }
  if (cloudSnapshotUploadInFlight) return cloudSnapshotUploadInFlight;

  const run = async (): Promise<boolean> => {
  const ctx = await resolveShopCtx();
  if (!ctx || !supabase) return false;

  const snap = snapshotFromStore();
  if (!snap) return false;
  if (snap.products.length === 0 && snap.sales.length === 0) return false;

  const payload = await trimSnapshotForUpload(snap);
  const envelope = buildExportEnvelope(payload);
  const json = JSON.stringify(envelope);

  const { error } = await supabase.from("shop_cloud_snapshots").upsert(
    {
      shop_id: ctx.shopId,
      snapshot: envelope,
      schema_version: WAKA_BACKUP_FILE_VERSION,
      byte_size: json.length,
      updated_at: new Date().toISOString(),
      updated_by: ctx.userId,
    },
    { onConflict: "shop_id" },
  );

  if (!error) lastCloudSnapshotUploadAt = Date.now();
  return !error;
  };

  cloudSnapshotUploadInFlight = run().finally(() => {
    cloudSnapshotUploadInFlight = null;
  });
  return cloudSnapshotUploadInFlight;
}

/** Download cloud snapshot and replace local store (new phone). */
export async function restoreShopFromCloudSnapshot(
  onProgress?: (percent: number) => void,
): Promise<boolean> {
  const ctx = await resolveShopCtx();
  if (!ctx || !supabase) return false;

  const { data, error } = await supabase
    .from("shop_cloud_snapshots")
    .select("snapshot, updated_at")
    .eq("shop_id", ctx.shopId)
    .maybeSingle();

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "PGRST205") return false;
    return false;
  }
  if (!data?.snapshot) return false;

  let envelope;
  try {
    envelope = validateImportEnvelope(data.snapshot);
  } catch {
    return false;
  }

  await applyRestoredSnapshotFromBackup(envelope.snapshot, { onProgress });
  await yieldUiTick();
  await persistRestoredSnapshotToDisk();
  return true;
}

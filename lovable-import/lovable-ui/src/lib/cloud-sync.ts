import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// Cast to loose client so newly created tables work before types refresh.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase: any = supabaseTyped;
import {
  usePOS,
  type Product,
  type Customer,
  type Sale,
  type Supplier,
  type SupplierEntry,
  type DaySession,
  type CashEntry,
  type CashKind,
  type CashMethod,
  type PayMethod,
} from "./pos-store";
import { useSyncStatus } from "./sync-status";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string) => UUID_RE.test(s);

type AnyRow = { id: string };

interface TableSync<L extends AnyRow> {
  table: string;
  select: (s: ReturnType<typeof usePOS.getState>) => L[];
  replace: (rows: L[]) => void;
  toCloud: (item: L, ownerId: string) => Record<string, unknown>;
  fromCloud: (row: Record<string, unknown>) => L;
  sortBy?: (a: L, b: L) => number;
}

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v == null ? undefined : String(v));

const productsSync: TableSync<Product> = {
  table: "shop_products",
  select: (s) => s.products,
  replace: (rows) => usePOS.setState({ products: rows }),
  sortBy: (a, b) => b.createdAt - a.createdAt,
  toCloud: (p, owner_id) => ({
    id: p.id,
    owner_id,
    name: p.name,
    price: p.price,
    stock: p.stock,
    category: p.category ?? null,
    client_created_at: p.createdAt,
  }),
  fromCloud: (r) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    price: num(r.price),
    stock: num(r.stock),
    category: str(r.category),
    createdAt: num(r.client_created_at),
  }),
};

const customersSync: TableSync<Customer> = {
  table: "shop_customers",
  select: (s) => s.customers,
  replace: (rows) => usePOS.setState({ customers: rows }),
  sortBy: (a, b) => b.createdAt - a.createdAt,
  toCloud: (c, owner_id) => ({
    id: c.id,
    owner_id,
    name: c.name,
    phone: c.phone ?? null,
    balance: c.balance,
    client_created_at: c.createdAt,
  }),
  fromCloud: (r) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    phone: str(r.phone),
    balance: num(r.balance),
    createdAt: num(r.client_created_at),
  }),
};

const salesSync: TableSync<Sale> = {
  table: "shop_sales",
  select: (s) => s.sales,
  replace: (rows) => usePOS.setState({ sales: rows }),
  sortBy: (a, b) => b.createdAt - a.createdAt,
  toCloud: (s, owner_id) => ({
    id: s.id,
    owner_id,
    items: s.items,
    total: s.total,
    method: s.method,
    customer_id: s.customerId && isUuid(s.customerId) ? s.customerId : null,
    customer_name: s.customerName ?? null,
    client_created_at: s.createdAt,
  }),
  fromCloud: (r) => ({
    id: String(r.id),
    items: (r.items as Sale["items"]) ?? [],
    total: num(r.total),
    method: String(r.method) as PayMethod,
    customerId: str(r.customer_id),
    customerName: str(r.customer_name),
    createdAt: num(r.client_created_at),
  }),
};

const suppliersSync: TableSync<Supplier> = {
  table: "shop_suppliers",
  select: (s) => s.suppliers,
  replace: (rows) => usePOS.setState({ suppliers: rows }),
  sortBy: (a, b) => b.createdAt - a.createdAt,
  toCloud: (s, owner_id) => ({
    id: s.id,
    owner_id,
    name: s.name,
    phone: s.phone ?? null,
    balance: s.balance,
    client_created_at: s.createdAt,
  }),
  fromCloud: (r) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    phone: str(r.phone),
    balance: num(r.balance),
    createdAt: num(r.client_created_at),
  }),
};

const supplierEntriesSync: TableSync<SupplierEntry> = {
  table: "shop_supplier_entries",
  select: (s) => s.supplierEntries,
  replace: (rows) => usePOS.setState({ supplierEntries: rows }),
  sortBy: (a, b) => b.createdAt - a.createdAt,
  toCloud: (e, owner_id) => ({
    id: e.id,
    owner_id,
    supplier_id: isUuid(e.supplierId) ? e.supplierId : "00000000-0000-0000-0000-000000000000",
    supplier_name: e.supplierName,
    type: e.type,
    amount: e.amount,
    note: e.note ?? null,
    client_created_at: e.createdAt,
  }),
  fromCloud: (r) => ({
    id: String(r.id),
    supplierId: String(r.supplier_id),
    supplierName: String(r.supplier_name ?? ""),
    type: String(r.type) as "purchase" | "payment",
    amount: num(r.amount),
    note: str(r.note),
    createdAt: num(r.client_created_at),
  }),
};

const daySessionsSync: TableSync<DaySession> = {
  table: "shop_day_sessions",
  select: (s) => s.daySessions,
  replace: (rows) => usePOS.setState({ daySessions: rows }),
  sortBy: (a, b) => b.openedAt - a.openedAt,
  toCloud: (d, owner_id) => ({
    id: d.id,
    owner_id,
    opened_at: d.openedAt,
    opening_float: d.openingFloat,
    closed_at: d.closedAt ?? null,
    counted_cash: d.countedCash ?? null,
    expected_cash: d.expectedCash ?? null,
    variance: d.variance ?? null,
    note: d.note ?? null,
  }),
  fromCloud: (r) => ({
    id: String(r.id),
    openedAt: num(r.opened_at),
    openingFloat: num(r.opening_float),
    closedAt: r.closed_at == null ? undefined : num(r.closed_at),
    countedCash: r.counted_cash == null ? undefined : num(r.counted_cash),
    expectedCash: r.expected_cash == null ? undefined : num(r.expected_cash),
    variance: r.variance == null ? undefined : num(r.variance),
    note: str(r.note),
  }),
};

const cashEntriesSync: TableSync<CashEntry> = {
  table: "shop_cash_entries",
  select: (s) => s.cashEntries,
  replace: (rows) => usePOS.setState({ cashEntries: rows }),
  sortBy: (a, b) => b.createdAt - a.createdAt,
  toCloud: (e, owner_id) => ({
    id: e.id,
    owner_id,
    kind: e.kind,
    category: e.category ?? null,
    method: e.method,
    amount: e.amount,
    note: e.note ?? null,
    client_created_at: e.createdAt,
  }),
  fromCloud: (r) => ({
    id: String(r.id),
    kind: String(r.kind) as CashKind,
    category: str(r.category),
    method: String(r.method ?? "cash") as CashMethod,
    amount: num(r.amount),
    note: str(r.note),
    createdAt: num(r.client_created_at),
  }),
};

const SYNCS = [
  productsSync,
  customersSync,
  salesSync,
  suppliersSync,
  supplierEntriesSync,
  daySessionsSync,
  cashEntriesSync,
] as const;

// Per-table snapshot of last-pushed JSON, keyed by id. Prevents echo loops.
const snapshots = new Map<string, Map<string, string>>();

let started = false;
let currentOwnerId: string | null = null;
let unsubscribeStore: (() => void) | null = null;
const channels: Array<ReturnType<typeof supabase.channel>> = [];

function snapKey(table: string, id: string) {
  return `${table}::${id}`;
}

function getSnap(table: string) {
  let m = snapshots.get(table);
  if (!m) {
    m = new Map();
    snapshots.set(table, m);
  }
  return m;
}

async function pullAndMerge(ownerId: string) {
  for (const sync of SYNCS) {
    const { data, error } = await supabase
      .from(sync.table)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select("*" as any)
      .is("deleted_at" as never, null);
    if (error) {
      console.warn(`[sync] pull ${sync.table} failed`, error.message);
      continue;
    }
    const cloudRows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => sync.fromCloud(r));
    const cloudIds = new Set(cloudRows.map((r: AnyRow) => r.id));

    const state = usePOS.getState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const localRows = (sync.select(state) as AnyRow[]).slice() as any[];
    const localById = new Map(localRows.map((r) => [r.id, r]));

    // Local rows missing in cloud → push them up (skip non-uuid)
    const toPush = localRows.filter((r) => !cloudIds.has(r.id) && isUuid(r.id));
    if (toPush.length > 0) {
      const payload = toPush.map((r) => sync.toCloud(r, ownerId));
      const { error: pushErr } = await supabase
        .from(sync.table)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .upsert(payload as any);
      if (pushErr) console.warn(`[sync] initial push ${sync.table}`, pushErr.message);
    }

    // Cloud wins for conflicts; cloud-only rows are added to local
    const merged = new Map<string, AnyRow>();
    for (const r of localRows) {
      if (isUuid(r.id)) merged.set(r.id, r);
    }
    for (const r of cloudRows) merged.set(r.id, r);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = Array.from(merged.values()) as any[];
    if (sync.sortBy) arr.sort(sync.sortBy);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sync.replace(arr as any);

    // Rebuild snapshot from current state (local + cloud + pushed)
    const snap = getSnap(sync.table);
    snap.clear();
    for (const r of arr) {
      if (isUuid((r as AnyRow).id)) {
        snap.set((r as AnyRow).id, JSON.stringify(sync.toCloud(r as never, ownerId)));
      }
    }
    // Also seed pushed local rows
    for (const r of toPush) {
      snap.set(r.id, JSON.stringify(sync.toCloud(r, ownerId)));
    }
    void snapKey;
  }
}

function applyRemoteRow<L extends AnyRow>(
  sync: TableSync<L>,
  row: Record<string, unknown>,
  isDelete: boolean,
) {
  const state = usePOS.getState();
  const rows = sync.select(state).slice();
  const id = String(row.id);
  if (isDelete) {
    const next = rows.filter((r) => r.id !== id);
    sync.replace(next);
    getSnap(sync.table).delete(id);
    return;
  }
  const incoming = sync.fromCloud(row);
  const idx = rows.findIndex((r) => r.id === id);
  if (idx >= 0) rows[idx] = incoming;
  else rows.push(incoming);
  if (sync.sortBy) rows.sort(sync.sortBy);
  sync.replace(rows);
  if (currentOwnerId) {
    getSnap(sync.table).set(id, JSON.stringify(sync.toCloud(incoming, currentOwnerId)));
  }
}

function subscribeRealtime(ownerId: string) {
  for (const sync of SYNCS) {
    const ch = supabase
      .channel(`sync:${sync.table}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: sync.table,
          filter: `owner_id=eq.${ownerId}`,
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const loose = sync as TableSync<any>;
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Record<string, unknown>;
            if (oldRow?.id) applyRemoteRow(loose, oldRow, true);
            return;
          }
          const newRow = payload.new as Record<string, unknown>;
          if (!newRow?.id) return;
          if (newRow.deleted_at) {
            applyRemoteRow(loose, newRow, true);
            return;
          }
          applyRemoteRow(loose, newRow, false);
        },
      )
      .subscribe();
    channels.push(ch);
  }
}

async function pushLocalDiffs(ownerId: string) {
  const state = usePOS.getState();
  // First pass: count diffs so we can show pending immediately
  let pendingCount = 0;
  const plans: Array<{
    sync: (typeof SYNCS)[number];
    upserts: Record<string, unknown>[];
    deletedIds: string[];
  }> = [];
  for (const sync of SYNCS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = sync.select(state) as any[];
    const snap = getSnap(sync.table);
    const upserts: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const id = (r as AnyRow).id;
      if (!isUuid(id)) continue;
      seen.add(id);
      const cloudShape = sync.toCloud(r as never, ownerId);
      const json = JSON.stringify(cloudShape);
      if (snap.get(id) !== json) {
        upserts.push(cloudShape);
        snap.set(id, json);
      }
    }
    const deletedIds: string[] = [];
    for (const id of snap.keys()) {
      if (!seen.has(id)) deletedIds.push(id);
    }
    pendingCount += upserts.length + deletedIds.length;
    plans.push({ sync, upserts, deletedIds });
  }

  const status = useSyncStatus.getState();
  if (pendingCount === 0) {
    status.markSynced();
    return;
  }
  status.setPending(pendingCount);
  status.setState("syncing");

  let hadError: string | null = null;
  for (const { sync, upserts, deletedIds } of plans) {
    if (upserts.length > 0) {
      const { error } = await supabase
        .from(sync.table)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .upsert(upserts as any);
      if (error) {
        hadError = error.message;
        console.warn(`[sync] upsert ${sync.table}`, error.message);
      }
    }
    if (deletedIds.length > 0) {
      const snap = getSnap(sync.table);
      const { error } = await supabase
        .from(sync.table)
        .update({ deleted_at: new Date().toISOString() })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .in("id" as any, deletedIds);
      if (error) {
        hadError = error.message;
        console.warn(`[sync] delete ${sync.table}`, error.message);
      }
      for (const id of deletedIds) snap.delete(id);
    }
  }

  if (hadError) useSyncStatus.getState().setError(hadError);
  else useSyncStatus.getState().markSynced();
}

export async function startCloudSync(ownerId: string) {
  if (started && currentOwnerId === ownerId) return;
  if (started) stopCloudSync();
  started = true;
  currentOwnerId = ownerId;

  try {
    await pullAndMerge(ownerId);
  } catch (e) {
    console.warn("[sync] initial pull failed", e);
  }

  subscribeRealtime(ownerId);

  // Debounced push on local changes
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedulePush = () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      useSyncStatus.getState().setState("offline");
      return;
    }
    useSyncStatus.getState().setState("queued");
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void pushLocalDiffs(ownerId);
    }, 600);
  };
  unsubscribeStore = usePOS.subscribe(schedulePush);
  // Push any pending diffs immediately
  void pushLocalDiffs(ownerId);
}

export function stopCloudSync() {
  started = false;
  currentOwnerId = null;
  if (unsubscribeStore) {
    unsubscribeStore();
    unsubscribeStore = null;
  }
  for (const ch of channels) {
    void supabase.removeChannel(ch);
  }
  channels.length = 0;
  snapshots.clear();
}

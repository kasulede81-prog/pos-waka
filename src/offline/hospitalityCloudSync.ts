import type {
  DiningArea,
  DiningTable,
  HospitalityFloorState,
  KitchenStation,
  KitchenTicket,
  KitchenTicketItem,
  KitchenTicketRecallEvent,
  KitchenTicketStatusEvent,
  TableReservation,
  TableSession,
  WaitlistEntry,
} from "../types";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import { getDeviceOnline } from "../lib/deviceOnline";
import { usePosStore } from "../store/usePosStore";
import { syncTableDisplayStatuses } from "../lib/hospitality";
import { reservationStatusRank } from "../lib/hospitalityFrontOfHouse";
import { SEED_AREA_KEY, SEED_BAR_KEY, SEED_KITCHEN_KEY, remapIdsDeep, seedFloorId, seedTableKey } from "../lib/hospitalitySeedIds";
import { mergeKitchenTicketMonotonic, normalizeKitchenTicket } from "../lib/kitchenProduction";
import { resolveShopCtx } from "./cloudSync";
import { enqueueSync } from "./syncEngine";

const HOSPITALITY_PULL_KEY = "waka.hospitality.lastPull";

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function readLastPullAt(): string | null {
  try {
    return localStorage.getItem(HOSPITALITY_PULL_KEY);
  } catch {
    return null;
  }
}

function writeLastPullAt(iso: string): void {
  try {
    localStorage.setItem(HOSPITALITY_PULL_KEY, iso);
  } catch {
    /* ignore */
  }
}

function newerIso(a: string | undefined | null, b: string | undefined | null): boolean {
  const ta = a ? Date.parse(a) : 0;
  const tb = b ? Date.parse(b) : 0;
  return ta >= tb;
}

/** Deletion tombstones travel in the existing jsonb `metadata` / `print_config` columns. */
function deletedAtFrom(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const v = (json as Record<string, unknown>).deletedAt;
  return typeof v === "string" && v ? v : null;
}

function rowToArea(row: Record<string, unknown>): DiningArea {
  const deletedAt = deletedAtFrom(row.metadata);
  return {
    id: String(row.id),
    name: String(row.name ?? "Area"),
    sortOrder: Number(row.sort_order ?? 0),
    isActive: deletedAt ? false : row.is_active !== false,
    ...(deletedAt ? { deletedAt } : {}),
  };
}

function rowToTable(row: Record<string, unknown>): DiningTable {
  const deletedAt = deletedAtFrom(row.metadata);
  return {
    id: String(row.id),
    areaId: String(row.area_id),
    label: String(row.label ?? "Table"),
    capacity: row.capacity != null ? Number(row.capacity) : undefined,
    sortOrder: Number(row.sort_order ?? 0),
    displayStatus: (row.display_status as DiningTable["displayStatus"]) ?? "available",
    isActive: deletedAt ? false : row.is_active !== false,
    ...(deletedAt ? { deletedAt } : {}),
  };
}

function rowToStation(row: Record<string, unknown>): KitchenStation {
  // The table stores hooks in `print_config` (the RPC maps future_hooks -> print_config on write);
  // reading only `future_hooks` dropped every printer assignment on the other devices.
  const cfg = (row.print_config ?? row.future_hooks) as (Record<string, unknown> & KitchenStation["futureHooks"]) | null | undefined;
  const deletedAt = deletedAtFrom(cfg);
  let hooks: KitchenStation["futureHooks"] | undefined;
  if (cfg && typeof cfg === "object") {
    const rest: Record<string, unknown> = { ...cfg };
    delete rest.deletedAt;
    hooks = Object.keys(rest).length ? (rest as KitchenStation["futureHooks"]) : undefined;
  }
  return {
    id: String(row.id),
    name: String(row.name ?? "Station"),
    stationType: (row.station_type as KitchenStation["stationType"]) ?? "kitchen",
    sortOrder: Number(row.sort_order ?? 0),
    isActive: deletedAt ? false : row.is_active !== false,
    ...(deletedAt ? { deletedAt } : {}),
    futureHooks: hooks,
  };
}

function rowToSession(row: Record<string, unknown>): TableSession {
  return {
    id: String(row.id),
    sessionKind: (row.session_kind as TableSession["sessionKind"]) ?? "table",
    tableId: row.table_id != null ? String(row.table_id) : null,
    tabLabel: row.tab_label != null ? String(row.tab_label) : null,
    saleId: String(row.sale_id),
    guestCount: Math.max(1, Number(row.guest_count ?? 1)),
    customerName: row.customer_name != null ? String(row.customer_name) : null,
    customerPhone: row.customer_phone_e164 != null ? String(row.customer_phone_e164) : null,
    waiterStaffId: row.waiter_staff_id != null ? String(row.waiter_staff_id) : null,
    waiterLabel: row.waiter_label != null ? String(row.waiter_label) : null,
    status: (row.status as TableSession["status"]) ?? "open",
    openedAt: String(row.opened_at ?? new Date().toISOString()),
    closedAt: row.closed_at != null ? String(row.closed_at) : null,
    updatedAt: String(row.updated_at ?? row.opened_at ?? new Date().toISOString()),
    pendingSync: false,
  };
}

function rowToReservation(row: Record<string, unknown>): TableReservation {
  return {
    id: String(row.id),
    reservationNumber: Number(row.reservation_number ?? 1),
    guestName: String(row.guest_name ?? ""),
    phone: String(row.phone ?? ""),
    email: row.email != null ? String(row.email) : null,
    guestCount: Number(row.guest_count ?? 2),
    reservationDate: String(row.reservation_date ?? new Date().toISOString().slice(0, 10)),
    reservationTime: String(row.reservation_time ?? "19:00").slice(0, 5),
    areaId: row.area_id != null ? String(row.area_id) : null,
    preferredTableId: row.preferred_table_id != null ? String(row.preferred_table_id) : null,
    notes: row.notes != null ? String(row.notes) : null,
    isVip: row.is_vip === true,
    status: (row.status as TableReservation["status"]) ?? "pending",
    seatedSessionId: row.seated_session_id != null ? String(row.seated_session_id) : null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
    pendingSync: false,
  };
}

function rowToWaitlist(row: Record<string, unknown>): WaitlistEntry {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    guestCount: Number(row.guest_count ?? 2),
    phone: row.phone != null ? String(row.phone) : null,
    arrivalTime: String(row.arrival_time ?? new Date().toISOString()),
    estimatedWaitMinutes: row.estimated_wait_minutes != null ? Number(row.estimated_wait_minutes) : null,
    priority: (row.priority as WaitlistEntry["priority"]) ?? "normal",
    notes: row.notes != null ? String(row.notes) : null,
    source: (row.source as WaitlistEntry["source"]) ?? "walk_in",
    status: (row.status as WaitlistEntry["status"]) ?? "waiting",
    seatedSessionId: row.seated_session_id != null ? String(row.seated_session_id) : null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
    pendingSync: false,
  };
}

function rowToTicket(row: Record<string, unknown>): KitchenTicket {
  const itemsRaw = (row.items as Record<string, unknown>[] | undefined) ?? [];
  const items: KitchenTicketItem[] = itemsRaw.map((item) => {
    const itemMeta = (item.metadata as Record<string, unknown> | undefined) ?? {};
    return {
    id: String(item.id ?? crypto.randomUUID()),
    productId: String(item.product_id ?? ""),
    productName: String(item.product_name ?? "Item"),
    quantity: Number(item.quantity ?? 1),
    notes: item.notes != null ? String(item.notes) : null,
    course:
      item.course != null
        ? (String(item.course) as KitchenTicketItem["course"])
        : itemMeta.course != null
          ? (String(itemMeta.course) as KitchenTicketItem["course"])
          : null,
    prepTimeMinutes:
      item.prep_time_minutes != null
        ? Number(item.prep_time_minutes)
        : itemMeta.prep_time_minutes != null
          ? Number(itemMeta.prep_time_minutes)
          : null,
    itemStatus:
      item.item_status != null
        ? (String(item.item_status) as KitchenTicketItem["itemStatus"])
        : itemMeta.item_status != null
          ? (String(itemMeta.item_status) as KitchenTicketItem["itemStatus"])
          : "active",
    cancelledAt:
      item.cancelled_at != null
        ? String(item.cancelled_at)
        : itemMeta.cancelled_at != null
          ? String(itemMeta.cancelled_at)
          : null,
    cancelledBy:
      item.cancelled_by != null
        ? String(item.cancelled_by)
        : itemMeta.cancelled_by != null
          ? String(itemMeta.cancelled_by)
          : null,
    cancelReason:
      item.cancel_reason != null
        ? String(item.cancel_reason)
        : itemMeta.cancel_reason != null
          ? String(itemMeta.cancel_reason)
          : null,
  };
  });
  const meta = (row.metadata as Record<string, unknown> | undefined) ?? {};
  const statusHistory = (meta.status_history as KitchenTicketStatusEvent[] | undefined) ?? undefined;
  const recallHistory = (meta.recall_history as KitchenTicketRecallEvent[] | undefined) ?? undefined;
  return normalizeKitchenTicket({
    id: String(row.id),
    tableSessionId: String(row.table_session_id),
    saleId: String(row.sale_id),
    stationId: String(row.station_id),
    stationType: (meta.station_type as KitchenTicket["stationType"]) ?? "kitchen",
    status: (row.status as KitchenTicket["status"]) ?? "queued",
    ticketNumber: Number(row.ticket_number ?? 1),
    firedAt: String(row.fired_at ?? new Date().toISOString()),
    tableLabel: String(row.table_label ?? ""),
    areaName: row.area_name != null ? String(row.area_name) : null,
    waiterLabel: row.waiter_label != null ? String(row.waiter_label) : null,
    guestCount: meta.guest_count != null ? Number(meta.guest_count) : null,
    orderRound: meta.order_round != null ? Number(meta.order_round) : undefined,
    priority: meta.priority != null ? (String(meta.priority) as KitchenTicket["priority"]) : undefined,
    prepTargetMinutes: meta.prep_target_minutes != null ? Number(meta.prep_target_minutes) : null,
    ticketNotes: meta.ticket_notes != null ? String(meta.ticket_notes) : null,
    acceptedAt: row.accepted_at != null ? String(row.accepted_at) : (meta.accepted_at != null ? String(meta.accepted_at) : null),
    preparingAt: row.prepared_at != null ? String(row.prepared_at) : (meta.preparing_at != null ? String(meta.preparing_at) : null),
    cookingAt: meta.cooking_at != null ? String(meta.cooking_at) : null,
    readyAt: meta.ready_at != null ? String(meta.ready_at) : null,
    pickedUpAt: meta.picked_up_at != null ? String(meta.picked_up_at) : null,
    servedAt: row.served_at != null ? String(row.served_at) : (meta.served_at != null ? String(meta.served_at) : null),
    completedAt: meta.completed_at != null ? String(meta.completed_at) : null,
    statusHistory,
    recallHistory,
    items,
    updatedAt: String(row.updated_at ?? row.fired_at ?? new Date().toISOString()),
    pendingSync: false,
  });
}

function mergeById<T extends { id: string }>(
  local: T[],
  remote: T[],
  pick: (a: T, b: T) => T,
  getUpdatedAt: (row: T) => string | undefined | null,
): T[] {
  const map = new Map<string, T>();
  for (const r of remote) map.set(r.id, r);
  for (const l of local) {
    const existing = map.get(l.id);
    if (!existing) {
      map.set(l.id, l);
      continue;
    }
    map.set(l.id, newerIso(getUpdatedAt(l), getUpdatedAt(existing)) ? pick(l, existing) : pick(existing, l));
  }
  return [...map.values()];
}

/** Incremental pulls send empty arrays when nothing changed — keep local references. */
function mergeCollection<T extends { id: string }>(
  local: T[],
  remote: T[],
  pick: (a: T, b: T) => T,
  getUpdatedAt: (row: T) => string | undefined | null,
): T[] {
  if (remote.length === 0) return local;
  return mergeById(local, remote, pick, getUpdatedAt);
}

/**
 * Layout rows (areas / tables / stations) merge by id. A deletion tombstone from EITHER side wins:
 * the cloud layout is upsert-only and pulls return every row, so without this a table deleted on
 * one device was re-added from another device's older copy. Deletion is terminal (re-creating a
 * table makes a new id), so no timestamp comparison is needed.
 */
export function mergeLayoutRow<T extends { deletedAt?: string | null }>(a: T, b: T): T {
  const tomb = a.deletedAt ? a : b.deletedAt ? b : null;
  if (!tomb) return { ...a, ...b };
  const other = tomb === a ? b : a;
  return { ...other, ...tomb };
}

const SEED_TABLE_LABELS = new Set(Array.from({ length: 8 }, (_, i) => `Table ${i + 1}`));

/**
 * True when the floor is still exactly the auto-created default (1 "Main Hall", "Table 1..8",
 * Kitchen + Bar) with no orders, tickets, reservations or waitlist. Any rename / add / delete or
 * any real activity makes it a real floor that must never be replaced.
 */
export function looksLikeUntouchedSeedFloor(floor: HospitalityFloorState): boolean {
  if (
    (floor.sessions?.length ?? 0) > 0 ||
    (floor.kitchenTickets?.length ?? 0) > 0 ||
    (floor.reservations?.length ?? 0) > 0 ||
    (floor.waitlist?.length ?? 0) > 0
  ) {
    return false;
  }
  const areas = (floor.areas ?? []).filter((a) => !a.deletedAt);
  if (areas.length !== 1 || areas[0]!.name !== "Main Hall") return false;
  const tables = (floor.tables ?? []).filter((t) => !t.deletedAt);
  if (tables.length !== SEED_TABLE_LABELS.size) return false;
  if (!tables.every((t) => SEED_TABLE_LABELS.has(t.label) && t.isActive && t.areaId === areas[0]!.id)) return false;
  if (new Set(tables.map((t) => t.label)).size !== tables.length) return false;
  const stations = (floor.stations ?? []).filter((s) => !s.deletedAt);
  return stations.length > 0 && stations.every((s) => (s.name === "Main Kitchen" && s.stationType === "kitchen") || (s.name === "Bar" && s.stationType === "bar"));
}

/** The default layout's SHAPE (activity such as open orders is ignored). */
function hasSeedLayoutShape(floor: HospitalityFloorState): boolean {
  const areas = floor.areas ?? [];
  const tables = floor.tables ?? [];
  const stations = floor.stations ?? [];
  if (areas.length !== 1 || areas[0]!.name !== "Main Hall" || areas[0]!.deletedAt) return false;
  if (tables.length !== SEED_TABLE_LABELS.size) return false;
  if (!tables.every((t) => SEED_TABLE_LABELS.has(t.label) && t.isActive && !t.deletedAt && t.areaId === areas[0]!.id)) return false;
  if (new Set(tables.map((t) => t.label)).size !== tables.length) return false;
  return (
    stations.length > 0 &&
    stations.every(
      (s) => !s.deletedAt && ((s.name === "Main Kitchen" && s.stationType === "kitchen") || (s.name === "Bar" && s.stationType === "bar")),
    )
  );
}

/**
 * Give a never-synced default floor the shop's deterministic seed ids (see hospitalitySeedIds), so two
 * devices that created the default floor concurrently converge on the SAME rows instead of colliding on
 * the cloud's unique names. References (sessions, tickets, reservations, ...) are rewritten with it.
 *
 * Only for a full snapshot of the cloud in which none of this floor's rows exist yet: a floor that was
 * already pushed (with whatever ids it had) must keep them, or the cloud would gain a second copy.
 */
export function alignSeedFloorToShop(
  floor: HospitalityFloorState,
  shopId: string,
  remote: { areas: DiningArea[]; tables: DiningTable[]; stations: KitchenStation[] },
): HospitalityFloorState {
  if (!shopId || !hasSeedLayoutShape(floor)) return floor;
  const remoteIds = new Set([...remote.areas, ...remote.tables, ...remote.stations].map((r) => r.id));
  const localRows = [...floor.areas, ...floor.tables, ...floor.stations];
  if (localRows.some((r) => remoteIds.has(r.id))) return floor; // already in the cloud — keep its ids

  const idMap = new Map<string, string>();
  idMap.set(floor.areas[0]!.id, seedFloorId(shopId, SEED_AREA_KEY));
  for (const t of floor.tables) {
    idMap.set(t.id, seedFloorId(shopId, seedTableKey(Number(t.label.replace("Table ", "")))));
  }
  for (const s of floor.stations) {
    idMap.set(s.id, seedFloorId(shopId, s.stationType === "bar" ? SEED_BAR_KEY : SEED_KITCHEN_KEY));
  }
  // already aligned, or two rows would collapse into one id: leave it alone
  if ([...idMap].every(([from, to]) => from === to)) return floor;
  if (new Set(idMap.values()).size !== idMap.size) return floor;
  return remapIdsDeep(floor, idMap);
}

function shouldAdoptRemoteLayout(
  local: HospitalityFloorState,
  remote: { areas: DiningArea[]; tables: DiningTable[] },
): boolean {
  const remoteLive = remote.areas.some((a) => !a.deletedAt) && remote.tables.some((t) => !t.deletedAt);
  if (!remoteLive || !looksLikeUntouchedSeedFloor(local)) return false;
  const remoteTableIds = new Set(remote.tables.map((t) => t.id));
  // Same layout already (this device pushed it): nothing to adopt.
  return !(local.tables ?? []).some((t) => remoteTableIds.has(t.id));
}

function mergeByLifecycle<T extends { status: string; updatedAt?: string | null }>(a: T, b: T): T {
  const ra = reservationStatusRank(a.status);
  const rb = reservationStatusRank(b.status);
  if (ra !== rb) return ra > rb ? { ...b, ...a } : { ...a, ...b };
  return newerIso(a.updatedAt, b.updatedAt) ? { ...b, ...a } : { ...a, ...b };
}

export function mergeRemoteHospitalityFloor(
  local: HospitalityFloorState,
  remote: {
    areas: DiningArea[];
    tables: DiningTable[];
    sessions: TableSession[];
    stations: KitchenStation[];
    tickets: KitchenTicket[];
    reservations?: TableReservation[];
    waitlist?: WaitlistEntry[];
  },
  opts?: { shopId?: string | null; fullSnapshot?: boolean },
): HospitalityFloorState {
  // A device that only ever seeded the default layout adopts the shop's real layout instead of
  // unioning its own random-id seed with it (which produced duplicate "Table 1..8").
  if (shouldAdoptRemoteLayout(local, remote)) {
    local = {
      ...local,
      areas: [],
      tables: [],
      stations: remote.stations.some((s) => !s.deletedAt) ? [] : local.stations,
    };
  }
  // Never-synced default floor (busy or not): converge on the shop's deterministic seed ids so a
  // concurrently created default floor on another device is the same set of rows, not a conflict.
  if (opts?.fullSnapshot && opts.shopId) {
    local = alignSeedFloorToShop(local, opts.shopId, remote);
  }
  const areas = mergeCollection(local.areas ?? [], remote.areas, mergeLayoutRow, () => null);
  const tables = mergeCollection(local.tables ?? [], remote.tables, mergeLayoutRow, () => null);
  const stations = mergeCollection(local.stations ?? [], remote.stations, mergeLayoutRow, () => null);
  // Same rule as reservations/waitlist: the NEWER copy wins. The old `{ ...a, ...b }` let the
  // second argument win regardless of age, and mergeById passes the newer copy first, so a
  // session settled on one device was overwritten by another device's stale "open" copy.
  const sessions = mergeCollection(
    local.sessions ?? [],
    remote.sessions,
    (a, b) => (newerIso(a.updatedAt, b.updatedAt) ? { ...b, ...a } : { ...a, ...b }),
    (s) => s.updatedAt,
  );
  const kitchenTickets = mergeCollection(
    local.kitchenTickets ?? [],
    remote.tickets,
    mergeKitchenTicketMonotonic,
    (t) => t.updatedAt,
  );
  // A reservation / waitlist entry only moves forward (see RESERVATION_TRANSITIONS): the copy that is
  // further along wins whatever its timestamp says, so a stale or clock-skewed device can neither
  // "un-cancel" a reservation nor turn a seated one back into a pending one. Same rank -> newer wins.
  const reservations = mergeCollection(
    local.reservations ?? [],
    remote.reservations ?? [],
    (a, b) => mergeByLifecycle(a, b),
    (r) => r.updatedAt,
  );
  const waitlist = mergeCollection(
    local.waitlist ?? [],
    remote.waitlist ?? [],
    (a, b) => mergeByLifecycle(a, b),
    (w) => w.updatedAt,
  );
  const sameCollections =
    areas === (local.areas ?? []) &&
    tables === (local.tables ?? []) &&
    stations === (local.stations ?? []) &&
    sessions === (local.sessions ?? []) &&
    kitchenTickets === (local.kitchenTickets ?? []) &&
    reservations === (local.reservations ?? []) &&
    waitlist === (local.waitlist ?? []);
  if (sameCollections) return syncTableDisplayStatuses(local);
  return syncTableDisplayStatuses({
    ...local,
    areas,
    tables,
    stations,
    sessions,
    kitchenTickets,
    reservations,
    waitlist,
  });
}

export async function pullHospitalityStateFromCloud(forceFull = false): Promise<boolean> {
  if (!hasSupabaseConfig || !supabase || !getDeviceOnline()) return false;
  const ctx = await resolveShopCtx();
  if (!ctx) return false;

  const since = forceFull ? "1970-01-01T00:00:00.000Z" : readLastPullAt() ?? "1970-01-01T00:00:00.000Z";
  const { data, error } = await supabase.rpc("shop_pull_hospitality_state", {
    p_shop_id: ctx.shopId,
    p_since: since,
  });
  if (error) return false;
  const result = data as Record<string, unknown> | null;
  if (!result?.ok) return false;

  const areas = ((result.areas as Record<string, unknown>[]) ?? []).map(rowToArea);
  const tables = ((result.tables as Record<string, unknown>[]) ?? []).map(rowToTable);
  const stations = ((result.stations as Record<string, unknown>[]) ?? []).map(rowToStation);
  const sessions = ((result.sessions as Record<string, unknown>[]) ?? []).map(rowToSession);
  const tickets = ((result.tickets as Record<string, unknown>[]) ?? []).map(rowToTicket);
  const reservations = ((result.reservations as Record<string, unknown>[]) ?? []).map(rowToReservation);
  const waitlist = ((result.waitlist as Record<string, unknown>[]) ?? []).map(rowToWaitlist);

  const state = usePosStore.getState();
  const local = state.preferences.hospitalityFloor;
  if (!local) return false;

  const merged = mergeRemoteHospitalityFloor(
    local,
    { areas, tables, sessions, stations, tickets, reservations, waitlist },
    { shopId: ctx.shopId, fullSnapshot: since === "1970-01-01T00:00:00.000Z" },
  );
  if (merged !== local) {
    usePosStore.setState({
      preferences: { ...state.preferences, hospitalityFloor: merged },
    });
  }

  writeLastPullAt(String(result.server_at ?? new Date().toISOString()));

  const { refreshOpenPendingSalesFromCloud } = await import("./cloudSync");
  await refreshOpenPendingSalesFromCloud(ctx);

  return true;
}

export async function pushHospitalityFloorLayoutToCloud(floor: HospitalityFloorState): Promise<boolean> {
  if (!hasSupabaseConfig || !supabase || !getDeviceOnline()) return false;
  const ctx = await resolveShopCtx();
  if (!ctx) return false;

  const now = new Date().toISOString();
  const payload = {
    areas: floor.areas.map((a) => ({
      id: a.id,
      name: a.name,
      sort_order: a.sortOrder,
      is_active: a.isActive,
      metadata: a.deletedAt ? { deletedAt: a.deletedAt } : {},
      updated_at: now,
    })),
    tables: floor.tables.map((t) => ({
      id: t.id,
      area_id: t.areaId,
      label: t.label,
      capacity: t.capacity ?? null,
      sort_order: t.sortOrder,
      display_status: t.displayStatus,
      is_active: t.isActive,
      metadata: t.deletedAt ? { deletedAt: t.deletedAt } : {},
      updated_at: now,
    })),
    stations: floor.stations.map((s) => ({
      id: s.id,
      name: s.name,
      station_type: s.stationType,
      sort_order: s.sortOrder,
      is_active: s.isActive,
      future_hooks: s.futureHooks ?? null,
      ...(s.deletedAt ? { print_config: { ...(s.futureHooks ?? {}), deletedAt: s.deletedAt } } : {}),
      updated_at: now,
    })),
    reservations: (floor.reservations ?? []).map((r) => ({
      id: r.id,
      reservation_number: r.reservationNumber,
      guest_name: r.guestName,
      phone: r.phone,
      email: r.email,
      guest_count: r.guestCount,
      reservation_date: r.reservationDate,
      reservation_time: r.reservationTime,
      area_id: r.areaId,
      preferred_table_id: r.preferredTableId,
      notes: r.notes,
      is_vip: r.isVip,
      status: r.status,
      updated_at: r.updatedAt ?? now,
    })),
    waitlist: (floor.waitlist ?? []).map((w) => ({
      id: w.id,
      name: w.name,
      guest_count: w.guestCount,
      phone: w.phone,
      arrival_time: w.arrivalTime,
      estimated_wait_minutes: w.estimatedWaitMinutes,
      priority: w.priority,
      notes: w.notes,
      source: w.source,
      status: w.status,
      updated_at: w.updatedAt ?? now,
    })),
  };

  const { data, error } = await supabase.rpc("shop_push_hospitality_floor", {
    p_shop_id: ctx.shopId,
    p_payload: payload,
  });
  if (error) return false;
  return (data as { ok?: boolean } | null)?.ok === true;
}

export async function pushTableSessionToCloud(session: TableSession): Promise<boolean> {
  if (!hasSupabaseConfig || !supabase || !getDeviceOnline()) return false;
  const ctx = await resolveShopCtx();
  if (!ctx || !isUuid(session.id) || !isUuid(session.saleId)) return false;

  const payload = {
    id: session.id,
    table_id: session.tableId && isUuid(session.tableId) ? session.tableId : null,
    session_kind: session.sessionKind ?? "table",
    tab_label: session.tabLabel ?? null,
    sale_id: session.saleId,
    guest_count: session.guestCount,
    customer_name: session.customerName ?? null,
    customer_phone_e164: session.customerPhone ?? null,
    waiter_staff_id: session.waiterStaffId ?? null,
    waiter_label: session.waiterLabel ?? null,
    status: session.status,
    opened_at: session.openedAt,
    closed_at: session.closedAt ?? null,
    updated_at: session.updatedAt ?? session.openedAt,
  };

  const { data, error } = await supabase.rpc("shop_push_table_session", {
    p_shop_id: ctx.shopId,
    p_payload: payload,
  });
  if (error) return false;
  const result = data as { ok?: boolean; error?: string } | null;
  if (!result?.ok && result?.error === "table_or_tab_occupied") {
    await pullHospitalityStateFromCloud(true);
    return false;
  }
  return result?.ok === true;
}

export async function pushKitchenTicketToCloud(ticket: KitchenTicket, stationType: string): Promise<boolean> {
  if (!hasSupabaseConfig || !supabase || !getDeviceOnline()) return false;
  const ctx = await resolveShopCtx();
  if (!ctx || !isUuid(ticket.id)) return false;

  const payload = {
    id: ticket.id,
    table_session_id: ticket.tableSessionId,
    sale_id: ticket.saleId,
    station_id: ticket.stationId,
    ticket_number: ticket.ticketNumber,
    status: ticket.status,
    fired_at: ticket.firedAt,
    waiter_label: ticket.waiterLabel ?? null,
    table_label: ticket.tableLabel,
    area_name: ticket.areaName ?? null,
    accepted_at: ticket.acceptedAt ?? null,
    prepared_at: ticket.preparingAt ?? null,
    served_at: ticket.servedAt ?? null,
    updated_at: ticket.updatedAt ?? ticket.firedAt,
    metadata: {
      station_type: stationType,
      ticket_notes: ticket.ticketNotes ?? null,
      guest_count: ticket.guestCount ?? null,
      order_round: ticket.orderRound ?? null,
      priority: ticket.priority ?? null,
      prep_target_minutes: ticket.prepTargetMinutes ?? null,
      cooking_at: ticket.cookingAt ?? null,
      ready_at: ticket.readyAt ?? null,
      picked_up_at: ticket.pickedUpAt ?? null,
      completed_at: ticket.completedAt ?? null,
      status_history: ticket.statusHistory ?? [],
      recall_history: ticket.recallHistory ?? [],
    },
    items: ticket.items.map((item) => ({
      id: item.id,
      product_id: item.productId,
      product_name: item.productName,
      quantity: item.quantity,
      notes: item.notes ?? null,
      course: item.course ?? null,
      prep_time_minutes: item.prepTimeMinutes ?? null,
      item_status: item.itemStatus ?? "active",
      cancelled_at: item.cancelledAt ?? null,
      cancelled_by: item.cancelledBy ?? null,
      cancel_reason: item.cancelReason ?? null,
    })),
  };

  const { data, error } = await supabase.rpc("shop_push_kitchen_ticket", {
    p_shop_id: ctx.shopId,
    p_payload: payload,
  });
  if (error) return false;
  return (data as { ok?: boolean } | null)?.ok === true;
}

export function queueHospitalitySync(payload: Record<string, unknown>): void {
  void enqueueSync({
    id: crypto.randomUUID(),
    kind: "pending_hospitality",
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
}

let layoutEnsuredForShop: string | null = null;

/** Test hook — forget which shop's layout this session already reconciled with the cloud. */
export function resetHospitalityLayoutEnsuredForTests(): void {
  layoutEnsuredForShop = null;
  ensureInFlight = null;
}

/**
 * table_sessions.table_id and kitchen_tickets.station_id are foreign keys into the cloud layout,
 * so sessions/tickets can only be stored once the layout is there. The layout is created locally
 * (default floor at onboarding / business-type switch) and used to reach the cloud only when
 * someone edited it. Reconcile once per app session: PULL first (a second device adopts the
 * shop's existing layout instead of pushing a competing seed with different ids), then PUSH.
 */
let ensureInFlight: Promise<boolean> | null = null;

async function ensureHospitalityLayoutOnCloud(): Promise<boolean> {
  // One reconciliation at a time: a session push, a ticket push and a layout push queued together
  // would otherwise each pull and push the same seed floor concurrently.
  if (ensureInFlight) return ensureInFlight;
  ensureInFlight = ensureHospitalityLayoutOnCloudOnce().finally(() => {
    ensureInFlight = null;
  });
  return ensureInFlight;
}

async function ensureHospitalityLayoutOnCloudOnce(): Promise<boolean> {
  const ctx = await resolveShopCtx();
  if (!ctx) return false;
  if (layoutEnsuredForShop === ctx.shopId) return true;
  if (!(await pullHospitalityStateFromCloud(true))) return false;
  const floor = usePosStore.getState().preferences.hospitalityFloor;
  if (!floor) return true;
  const ok = await pushHospitalityFloorLayoutToCloud(floor);
  if (ok) layoutEnsuredForShop = ctx.shopId;
  return ok;
}

export async function processHospitalitySyncOperation(payload: Record<string, unknown>): Promise<boolean> {
  const type = String(payload.type ?? "");
  const floor = usePosStore.getState().preferences.hospitalityFloor;
  if (!floor) return true;

  if (type === "floor_layout") {
    if (!(await ensureHospitalityLayoutOnCloud())) return false;
    // Pull before every layout push: the push overwrites rows (including deletion tombstones), so
    // a device that has not seen another device's delete yet must merge it first or it would
    // resurrect the deleted table in the cloud.
    if (!(await pullHospitalityStateFromCloud(false))) return false;
    // Always push the latest layout (it may have changed since the layout was first ensured).
    return pushHospitalityFloorLayoutToCloud(usePosStore.getState().preferences.hospitalityFloor ?? floor);
  }
  if (type === "session" || type === "ticket") {
    if (!(await ensureHospitalityLayoutOnCloud())) return false;
    // Re-read: the pull inside ensureHospitalityLayoutOnCloud may have replaced the floor.
    const current = usePosStore.getState().preferences.hospitalityFloor ?? floor;
    if (type === "session") {
      const sessionId = String(payload.sessionId ?? "");
      const session = current.sessions.find((s) => s.id === sessionId);
      if (!session) return true;
      return pushTableSessionToCloud(session);
    }
    const ticketId = String(payload.ticketId ?? "");
    const ticket = (current.kitchenTickets ?? []).find((t) => t.id === ticketId);
    if (!ticket) return true;
    const station = current.stations.find((s) => s.id === ticket.stationId);
    return pushKitchenTicketToCloud(ticket, station?.stationType ?? ticket.stationType);
  }
  if (type === "pull") return pullHospitalityStateFromCloud(Boolean(payload.forceFull));
  return true;
}

export async function syncHospitalityAfterFloorChange(input: {
  sessionIds?: string[];
  ticketIds?: string[];
  layout?: boolean;
}): Promise<void> {
  if (input.layout) queueHospitalitySync({ type: "floor_layout" });
  for (const sessionId of input.sessionIds ?? []) {
    queueHospitalitySync({ type: "session", sessionId });
  }
  for (const ticketId of input.ticketIds ?? []) {
    queueHospitalitySync({ type: "ticket", ticketId });
  }
}

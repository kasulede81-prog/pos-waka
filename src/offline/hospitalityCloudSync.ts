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

function rowToArea(row: Record<string, unknown>): DiningArea {
  return {
    id: String(row.id),
    name: String(row.name ?? "Area"),
    sortOrder: Number(row.sort_order ?? 0),
    isActive: row.is_active !== false,
  };
}

function rowToTable(row: Record<string, unknown>): DiningTable {
  return {
    id: String(row.id),
    areaId: String(row.area_id),
    label: String(row.label ?? "Table"),
    capacity: row.capacity != null ? Number(row.capacity) : undefined,
    sortOrder: Number(row.sort_order ?? 0),
    displayStatus: (row.display_status as DiningTable["displayStatus"]) ?? "available",
    isActive: row.is_active !== false,
  };
}

function rowToStation(row: Record<string, unknown>): KitchenStation {
  const hooks = row.future_hooks as KitchenStation["futureHooks"] | null | undefined;
  return {
    id: String(row.id),
    name: String(row.name ?? "Station"),
    stationType: (row.station_type as KitchenStation["stationType"]) ?? "kitchen",
    sortOrder: Number(row.sort_order ?? 0),
    isActive: row.is_active !== false,
    futureHooks: hooks ?? undefined,
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
): HospitalityFloorState {
  const areas = mergeCollection(local.areas ?? [], remote.areas, (a, b) => ({ ...a, ...b }), () => null);
  const tables = mergeCollection(local.tables ?? [], remote.tables, (a, b) => ({ ...a, ...b }), () => null);
  const stations = mergeCollection(local.stations ?? [], remote.stations, (a, b) => ({ ...a, ...b }), () => null);
  const sessions = mergeCollection(local.sessions ?? [], remote.sessions, (a, b) => ({ ...a, ...b }), (s) => s.updatedAt);
  const kitchenTickets = mergeCollection(
    local.kitchenTickets ?? [],
    remote.tickets,
    mergeKitchenTicketMonotonic,
    (t) => t.updatedAt,
  );
  const reservations = mergeCollection(
    local.reservations ?? [],
    remote.reservations ?? [],
    (a, b) => (newerIso(a.updatedAt, b.updatedAt) ? { ...b, ...a } : { ...a, ...b }),
    (r) => r.updatedAt,
  );
  const waitlist = mergeCollection(
    local.waitlist ?? [],
    remote.waitlist ?? [],
    (a, b) => (newerIso(a.updatedAt, b.updatedAt) ? { ...b, ...a } : { ...a, ...b }),
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

  const merged = mergeRemoteHospitalityFloor(local, { areas, tables, sessions, stations, tickets, reservations, waitlist });
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
      updated_at: now,
    })),
    stations: floor.stations.map((s) => ({
      id: s.id,
      name: s.name,
      station_type: s.stationType,
      sort_order: s.sortOrder,
      is_active: s.isActive,
      future_hooks: s.futureHooks ?? null,
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

export async function processHospitalitySyncOperation(payload: Record<string, unknown>): Promise<boolean> {
  const type = String(payload.type ?? "");
  const floor = usePosStore.getState().preferences.hospitalityFloor;
  if (!floor) return true;

  if (type === "floor_layout") return pushHospitalityFloorLayoutToCloud(floor);
  if (type === "session") {
    const sessionId = String(payload.sessionId ?? "");
    const session = floor.sessions.find((s) => s.id === sessionId);
    if (!session) return true;
    return pushTableSessionToCloud(session);
  }
  if (type === "ticket") {
    const ticketId = String(payload.ticketId ?? "");
    const ticket = (floor.kitchenTickets ?? []).find((t) => t.id === ticketId);
    if (!ticket) return true;
    const station = floor.stations.find((s) => s.id === ticket.stationId);
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

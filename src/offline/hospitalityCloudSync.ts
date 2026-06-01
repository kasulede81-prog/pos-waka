import type {
  DiningArea,
  DiningTable,
  HospitalityFloorState,
  KitchenStation,
  KitchenTicket,
  KitchenTicketItem,
  TableSession,
} from "../types";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import { getDeviceOnline } from "../lib/deviceOnline";
import { usePosStore } from "../store/usePosStore";
import { syncTableDisplayStatuses } from "../lib/hospitality";
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
  return {
    id: String(row.id),
    name: String(row.name ?? "Station"),
    stationType: (row.station_type as KitchenStation["stationType"]) ?? "kitchen",
    sortOrder: Number(row.sort_order ?? 0),
    isActive: row.is_active !== false,
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

function rowToTicket(row: Record<string, unknown>): KitchenTicket {
  const itemsRaw = (row.items as Record<string, unknown>[] | undefined) ?? [];
  const items: KitchenTicketItem[] = itemsRaw.map((item) => ({
    id: String(item.id ?? crypto.randomUUID()),
    productId: String(item.product_id ?? ""),
    productName: String(item.product_name ?? "Item"),
    quantity: Number(item.quantity ?? 1),
    notes: item.notes != null ? String(item.notes) : null,
  }));
  const meta = (row.metadata as Record<string, unknown> | undefined) ?? {};
  return {
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
    ticketNotes: meta.ticket_notes != null ? String(meta.ticket_notes) : null,
    items,
    updatedAt: String(row.updated_at ?? row.fired_at ?? new Date().toISOString()),
    pendingSync: false,
  };
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

export function mergeRemoteHospitalityFloor(
  local: HospitalityFloorState,
  remote: {
    areas: DiningArea[];
    tables: DiningTable[];
    sessions: TableSession[];
    stations: KitchenStation[];
    tickets: KitchenTicket[];
  },
): HospitalityFloorState {
  const areas = mergeById(local.areas, remote.areas, (a, b) => ({ ...a, ...b }), () => null);
  const tables = mergeById(local.tables, remote.tables, (a, b) => ({ ...a, ...b }), () => null);
  const stations = mergeById(local.stations, remote.stations, (a, b) => ({ ...a, ...b }), () => null);
  const sessions = mergeById(local.sessions, remote.sessions, (a, b) => ({ ...a, ...b }), (s) => s.updatedAt);
  const kitchenTickets = mergeById(local.kitchenTickets ?? [], remote.tickets, (a, b) => ({ ...a, ...b }), (t) => t.updatedAt);
  return syncTableDisplayStatuses({ ...local, areas, tables, stations, sessions, kitchenTickets });
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

  const state = usePosStore.getState();
  const local = state.preferences.hospitalityFloor;
  if (!local) return false;

  const merged = mergeRemoteHospitalityFloor(local, { areas, tables, sessions, stations, tickets });
  usePosStore.setState({
    preferences: { ...state.preferences, hospitalityFloor: merged },
  });

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
      updated_at: now,
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
    updated_at: ticket.updatedAt ?? ticket.firedAt,
    metadata: { station_type: stationType, ticket_notes: ticket.ticketNotes ?? null },
    items: ticket.items.map((item) => ({
      id: item.id,
      product_id: item.productId,
      product_name: item.productName,
      quantity: item.quantity,
      notes: item.notes ?? null,
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

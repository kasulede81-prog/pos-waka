/**
 * Phase 6.3 — Commercial kitchen & bar production workflow.
 * Status flow, timers, recall, item cancel rules, station dashboards, alerts, sync merge.
 */

import type {
  HospitalityFloorState,
  KitchenStationType,
  KitchenTicket,
  KitchenTicketItem,
  KitchenTicketPriority,
  KitchenTicketRecallEvent,
  KitchenTicketStatus,
  KitchenTicketStatusEvent,
} from "../types";
import { BAR_FIRE_STATION_TYPES, KITCHEN_FIRE_STATION_TYPES } from "./productHospitalityRouting";

/** Forward production workflow — every transition is audited. */
export const KITCHEN_TICKET_STATUS_FLOW: KitchenTicketStatus[] = [
  "queued",
  "accepted",
  "preparing",
  "cooking",
  "ready",
  "picked_up",
  "served",
  "completed",
];

export const TERMINAL_KITCHEN_STATUSES: KitchenTicketStatus[] = ["completed", "cancelled"];

const STATUS_INDEX = new Map(KITCHEN_TICKET_STATUS_FLOW.map((s, i) => [s, i]));

/** Statuses visible on expo — food leaving the kitchen. */
export const EXPO_READY_STATUSES: KitchenTicketStatus[] = ["ready"];
export const EXPO_PICKUP_STATUSES: KitchenTicketStatus[] = ["picked_up"];

export type ProductionTimerUrgency = "on_time" | "approaching" | "overdue";

export type ProductionAlertKind =
  | "ticket_overdue"
  | "high_priority"
  | "vip_order"
  | "table_waiting";

export type ProductionAlert = {
  id: string;
  kind: ProductionAlertKind;
  ticketId: string;
  stationId: string;
  messageKey: string;
  tableLabel: string;
};

export type StationProductionDashboard = {
  pendingTickets: number;
  preparingCount: number;
  readyCount: number;
  averagePrepMinutes: number | null;
  longestWaitMinutes: number | null;
  completedToday: number;
};

export type KitchenProductionAnalytics = {
  averagePrepMinutes: number | null;
  stationWorkload: Record<string, number>;
  mostDelayedStationId: string | null;
  averagePickupMinutes: number | null;
  ordersPerStation: Record<string, number>;
  itemsPerStation: Record<string, number>;
};

export type ProductionActor = {
  userId?: string | null;
  label?: string | null;
};

export function normalizeKitchenTicketStatus(raw: string | undefined | null): KitchenTicketStatus {
  const s = String(raw ?? "queued").toLowerCase();
  if (s === "completed" || s === "cancelled") return s;
  if (STATUS_INDEX.has(s as KitchenTicketStatus)) return s as KitchenTicketStatus;
  // Legacy tickets from pre-6.3
  if (s === "preparing" || s === "ready" || s === "served" || s === "queued") return s as KitchenTicketStatus;
  return "queued";
}

export function statusProgressIndex(status: KitchenTicketStatus): number {
  if (status === "cancelled") return -1;
  if (status === "completed") return KITCHEN_TICKET_STATUS_FLOW.length;
  return STATUS_INDEX.get(status) ?? 0;
}

export function isActiveKitchenTicket(ticket: KitchenTicket): boolean {
  return !TERMINAL_KITCHEN_STATUSES.includes(ticket.status);
}

export function nextKitchenTicketStatus(current: KitchenTicketStatus): KitchenTicketStatus | null {
  const idx = STATUS_INDEX.get(current);
  if (idx == null || idx >= KITCHEN_TICKET_STATUS_FLOW.length - 1) return null;
  return KITCHEN_TICKET_STATUS_FLOW[idx + 1] ?? null;
}

export function statusTimestampField(status: KitchenTicketStatus): keyof KitchenTicket | null {
  switch (status) {
    case "accepted":
      return "acceptedAt";
    case "preparing":
      return "preparingAt";
    case "cooking":
      return "cookingAt";
    case "ready":
      return "readyAt";
    case "picked_up":
      return "pickedUpAt";
    case "served":
      return "servedAt";
    case "completed":
      return "completedAt";
    default:
      return null;
  }
}

export function appendStatusEvent(
  ticket: KitchenTicket,
  toStatus: KitchenTicketStatus,
  actor?: ProductionActor,
  reason?: string | null,
): KitchenTicketStatusEvent[] {
  const event: KitchenTicketStatusEvent = {
    fromStatus: ticket.status,
    toStatus,
    at: new Date().toISOString(),
    byUserId: actor?.userId ?? null,
    byLabel: actor?.label ?? null,
    reason: reason ?? null,
  };
  return [...(ticket.statusHistory ?? []), event];
}

function applyStatusTimestamp(ticket: KitchenTicket, status: KitchenTicketStatus, at: string): KitchenTicket {
  const field = statusTimestampField(status);
  if (!field) return ticket;
  return { ...ticket, [field]: at };
}

export function normalizeKitchenTicket(ticket: KitchenTicket): KitchenTicket {
  const status = normalizeKitchenTicketStatus(ticket.status);
  const items = ticket.items.map((item) => ({
    ...item,
    itemStatus: item.itemStatus ?? "active",
  }));
  return { ...ticket, status, items };
}

export function advanceKitchenTicket(
  floor: HospitalityFloorState,
  ticketId: string,
  actor?: ProductionActor,
): HospitalityFloorState {
  const now = new Date().toISOString();
  const kitchenTickets = (floor.kitchenTickets ?? []).map((raw) => {
    const t = normalizeKitchenTicket(raw);
    if (t.id !== ticketId) return t;
    const next = nextKitchenTicketStatus(t.status);
    if (!next) return t;
    let updated: KitchenTicket = {
      ...t,
      status: next,
      updatedAt: now,
      pendingSync: true,
      statusHistory: appendStatusEvent(t, next, actor),
    };
    updated = applyStatusTimestamp(updated, next, now);
    return updated;
  });
  return { ...floor, kitchenTickets };
}

export function updateKitchenTicketToStatus(
  floor: HospitalityFloorState,
  ticketId: string,
  status: KitchenTicketStatus,
  actor?: ProductionActor,
  reason?: string | null,
): HospitalityFloorState {
  const now = new Date().toISOString();
  const kitchenTickets = (floor.kitchenTickets ?? []).map((raw) => {
    const t = normalizeKitchenTicket(raw);
    if (t.id !== ticketId) return t;
    let updated: KitchenTicket = {
      ...t,
      status,
      updatedAt: now,
      pendingSync: true,
      statusHistory: appendStatusEvent(t, status, actor, reason),
    };
    updated = applyStatusTimestamp(updated, status, now);
    return updated;
  });
  return { ...floor, kitchenTickets };
}

export function canRecallKitchenTicket(ticket: KitchenTicket): boolean {
  const status = normalizeKitchenTicketStatus(ticket.status);
  return status === "ready" || status === "cooking" || status === "picked_up";
}

export function recallKitchenTicket(
  floor: HospitalityFloorState,
  ticketId: string,
  reason: string,
  actor?: ProductionActor,
  targetStatus: KitchenTicketStatus = "preparing",
): HospitalityFloorState {
  const trimmed = reason.trim();
  if (!trimmed) return floor;
  const now = new Date().toISOString();
  const kitchenTickets = (floor.kitchenTickets ?? []).map((raw) => {
    const t = normalizeKitchenTicket(raw);
    if (t.id !== ticketId || !canRecallKitchenTicket(t)) return t;
    const recall: KitchenTicketRecallEvent = {
      fromStatus: t.status,
      toStatus: targetStatus,
      reason: trimmed,
      at: now,
      byUserId: actor?.userId ?? null,
      byLabel: actor?.label ?? null,
    };
    let updated: KitchenTicket = {
      ...t,
      status: targetStatus,
      updatedAt: now,
      pendingSync: true,
      recallHistory: [...(t.recallHistory ?? []), recall],
      statusHistory: appendStatusEvent(t, targetStatus, actor, `recall: ${trimmed}`),
    };
    updated = applyStatusTimestamp(updated, targetStatus, now);
    return updated;
  });
  return { ...floor, kitchenTickets };
}

export function ticketHasStartedPreparation(ticket: KitchenTicket): boolean {
  const idx = statusProgressIndex(normalizeKitchenTicketStatus(ticket.status));
  const preparingIdx = STATUS_INDEX.get("preparing") ?? 2;
  return idx >= preparingIdx;
}

export function canCancelKitchenTicketItem(
  ticket: KitchenTicket,
  itemId: string,
  isManager: boolean,
): { ok: boolean; errorKey?: string } {
  const item = ticket.items.find((i) => i.id === itemId);
  if (!item || item.itemStatus === "cancelled") return { ok: false, errorKey: "invalid" };
  if (ticketHasStartedPreparation(ticket) && !isManager) {
    return { ok: false, errorKey: "kitchenCancelItemNeedsManager" };
  }
  return { ok: true };
}

export function cancelKitchenTicketItem(
  floor: HospitalityFloorState,
  ticketId: string,
  itemId: string,
  reason: string,
  actor?: ProductionActor,
  isManager = false,
): { floor: HospitalityFloorState; ok: boolean; errorKey?: string } {
  const trimmed = reason.trim();
  if (!trimmed) return { floor, ok: false, errorKey: "kitchenCancelReasonRequired" };
  const ticket = (floor.kitchenTickets ?? []).find((t) => t.id === ticketId);
  if (!ticket) return { floor, ok: false, errorKey: "invalid" };
  const check = canCancelKitchenTicketItem(normalizeKitchenTicket(ticket), itemId, isManager);
  if (!check.ok) return { floor, ok: false, errorKey: check.errorKey };

  const now = new Date().toISOString();
  const label = actor?.label ?? actor?.userId ?? "staff";
  const kitchenTickets = (floor.kitchenTickets ?? []).map((t) => {
    if (t.id !== ticketId) return t;
    const items = t.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            itemStatus: "cancelled" as const,
            cancelledAt: now,
            cancelledBy: label,
            cancelReason: trimmed,
          }
        : item,
    );
    const activeItems = items.filter((i) => i.itemStatus !== "cancelled");
    if (activeItems.length === 0) {
      return {
        ...normalizeKitchenTicket(t),
        items,
        status: "cancelled" as const,
        updatedAt: now,
        pendingSync: true,
        statusHistory: appendStatusEvent(normalizeKitchenTicket(t), "cancelled", actor, `all items cancelled: ${trimmed}`),
      };
    }
    return { ...t, items, updatedAt: now, pendingSync: true };
  });
  return { floor: { ...floor, kitchenTickets }, ok: true };
}

export function activeTicketItems(ticket: KitchenTicket): KitchenTicketItem[] {
  return ticket.items.filter((i) => i.itemStatus !== "cancelled");
}

export function computeTicketPrepTargetMinutes(ticket: KitchenTicket): number | null {
  if (ticket.prepTargetMinutes != null && ticket.prepTargetMinutes > 0) return ticket.prepTargetMinutes;
  const times = activeTicketItems(ticket)
    .map((i) => i.prepTimeMinutes)
    .filter((m): m is number => m != null && m > 0);
  if (!times.length) return null;
  return Math.max(...times);
}

export function computeTicketElapsedMinutes(ticket: KitchenTicket, nowMs = Date.now()): number {
  const fired = Date.parse(ticket.firedAt);
  if (!Number.isFinite(fired)) return 0;
  return Math.max(0, Math.round((nowMs - fired) / 60_000));
}

export function computeTicketTimerUrgency(ticket: KitchenTicket, nowMs = Date.now()): ProductionTimerUrgency {
  const target = computeTicketPrepTargetMinutes(ticket);
  if (target == null) return "on_time";
  const elapsed = computeTicketElapsedMinutes(ticket, nowMs);
  if (elapsed > target) return "overdue";
  if (elapsed >= target * 0.75) return "approaching";
  return "on_time";
}

export function formatElapsedMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function sessionOrderRound(floor: HospitalityFloorState, sessionId: string): number {
  const tickets = (floor.kitchenTickets ?? []).filter((t) => t.tableSessionId === sessionId);
  if (!tickets.length) return 1;
  const max = Math.max(...tickets.map((t) => t.orderRound ?? 1));
  return max + 1;
}

export function activeProductionTickets(
  floor: HospitalityFloorState,
  filter?: { stationId?: string; stationType?: KitchenStationType; stationTypes?: KitchenStationType[] },
): KitchenTicket[] {
  const typeSet = filter?.stationTypes?.length ? new Set(filter.stationTypes) : null;
  return (floor.kitchenTickets ?? [])
    .map(normalizeKitchenTicket)
    .filter(isActiveKitchenTicket)
    .filter((t) => !filter?.stationId || t.stationId === filter.stationId)
    .filter((t) => !filter?.stationType || t.stationType === filter.stationType)
    .filter((t) => !typeSet || typeSet.has(t.stationType))
    .sort((a, b) => {
      const pa = priorityWeight(a.priority);
      const pb = priorityWeight(b.priority);
      if (pa !== pb) return pb - pa;
      return a.firedAt.localeCompare(b.firedAt);
    });
}

function priorityWeight(priority: KitchenTicketPriority | undefined): number {
  if (priority === "vip") return 3;
  if (priority === "high") return 2;
  return 1;
}

export function expoTickets(
  floor: HospitalityFloorState,
  kind: "kitchen_ready" | "bar_ready" | "waiting_pickup" | "picked_up",
): KitchenTicket[] {
  const barTypes = new Set(BAR_FIRE_STATION_TYPES);
  const kitchenTypes = new Set(KITCHEN_FIRE_STATION_TYPES);
  const tickets = (floor.kitchenTickets ?? []).map(normalizeKitchenTicket).filter(isActiveKitchenTicket);

  if (kind === "kitchen_ready") {
    return tickets.filter((t) => kitchenTypes.has(t.stationType) && t.status === "ready");
  }
  if (kind === "bar_ready") {
    return tickets.filter((t) => barTypes.has(t.stationType) && t.status === "ready");
  }
  if (kind === "waiting_pickup") {
    return tickets.filter((t) => t.status === "ready");
  }
  if (kind === "picked_up") {
    return tickets.filter((t) => t.status === "picked_up");
  }
  return [];
}

export function computeStationProductionDashboard(
  floor: HospitalityFloorState,
  stationId: string,
  nowMs = Date.now(),
): StationProductionDashboard {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const all = (floor.kitchenTickets ?? []).map(normalizeKitchenTicket).filter((t) => t.stationId === stationId);

  const active = all.filter(isActiveKitchenTicket);
  const pendingTickets = active.filter((t) => t.status === "queued" || t.status === "accepted").length;
  const preparingCount = active.filter((t) => t.status === "preparing" || t.status === "cooking").length;
  const readyCount = active.filter((t) => t.status === "ready").length;

  const completedToday = all.filter(
    (t) => (t.status === "completed" || t.status === "served") && t.firedAt.startsWith(today),
  ).length;

  const prepDurations: number[] = [];
  for (const t of all) {
    if (!t.readyAt) continue;
    const fired = Date.parse(t.firedAt);
    const ready = Date.parse(t.readyAt);
    if (Number.isFinite(fired) && Number.isFinite(ready) && ready > fired) {
      prepDurations.push(Math.round((ready - fired) / 60_000));
    }
  }
  const averagePrepMinutes =
    prepDurations.length > 0 ? Math.round(prepDurations.reduce((a, b) => a + b, 0) / prepDurations.length) : null;

  let longestWaitMinutes: number | null = null;
  for (const t of active) {
    const elapsed = computeTicketElapsedMinutes(t, nowMs);
    if (longestWaitMinutes == null || elapsed > longestWaitMinutes) longestWaitMinutes = elapsed;
  }

  return {
    pendingTickets,
    preparingCount,
    readyCount,
    averagePrepMinutes,
    longestWaitMinutes,
    completedToday,
  };
}

export function computeProductionAlerts(floor: HospitalityFloorState, nowMs = Date.now()): ProductionAlert[] {
  const alerts: ProductionAlert[] = [];
  for (const ticket of activeProductionTickets(floor)) {
    const urgency = computeTicketTimerUrgency(ticket, nowMs);
    if (urgency === "overdue") {
      alerts.push({
        id: `overdue-${ticket.id}`,
        kind: "ticket_overdue",
        ticketId: ticket.id,
        stationId: ticket.stationId,
        messageKey: "productionAlertOverdue",
        tableLabel: ticket.tableLabel,
      });
    }
    if (ticket.priority === "high") {
      alerts.push({
        id: `high-${ticket.id}`,
        kind: "high_priority",
        ticketId: ticket.id,
        stationId: ticket.stationId,
        messageKey: "productionAlertHighPriority",
        tableLabel: ticket.tableLabel,
      });
    }
    if (ticket.priority === "vip") {
      alerts.push({
        id: `vip-${ticket.id}`,
        kind: "vip_order",
        ticketId: ticket.id,
        stationId: ticket.stationId,
        messageKey: "productionAlertVip",
        tableLabel: ticket.tableLabel,
      });
    }
    const elapsed = computeTicketElapsedMinutes(ticket, nowMs);
    const target = computeTicketPrepTargetMinutes(ticket);
    const waitThreshold = target != null ? target * 1.5 : 30;
    if (elapsed >= waitThreshold && (ticket.status === "queued" || ticket.status === "accepted")) {
      alerts.push({
        id: `wait-${ticket.id}`,
        kind: "table_waiting",
        ticketId: ticket.id,
        stationId: ticket.stationId,
        messageKey: "productionAlertTableWaiting",
        tableLabel: ticket.tableLabel,
      });
    }
  }
  return alerts;
}

export function computeKitchenProductionAnalytics(floor: HospitalityFloorState): KitchenProductionAnalytics {
  const today = new Date().toISOString().slice(0, 10);
  const tickets = (floor.kitchenTickets ?? []).map(normalizeKitchenTicket).filter((t) => t.firedAt.startsWith(today));

  const stationWorkload: Record<string, number> = {};
  const ordersPerStation: Record<string, number> = {};
  const itemsPerStation: Record<string, number> = {};
  const prepByStation: Record<string, number[]> = {};
  const pickupDurations: number[] = [];
  let mostDelayedStationId: string | null = null;
  let maxDelay = 0;

  for (const t of tickets) {
    const sid = t.stationId;
    if (isActiveKitchenTicket(t)) {
      stationWorkload[sid] = (stationWorkload[sid] ?? 0) + 1;
      const elapsed = computeTicketElapsedMinutes(t);
      const target = computeTicketPrepTargetMinutes(t) ?? 15;
      const delay = Math.max(0, elapsed - target);
      if (delay > maxDelay) {
        maxDelay = delay;
        mostDelayedStationId = sid;
      }
    }
    ordersPerStation[sid] = (ordersPerStation[sid] ?? 0) + 1;
    const activeQty = activeTicketItems(t).reduce((sum, i) => sum + i.quantity, 0);
    itemsPerStation[sid] = (itemsPerStation[sid] ?? 0) + activeQty;

    if (t.readyAt) {
      const fired = Date.parse(t.firedAt);
      const ready = Date.parse(t.readyAt);
      if (Number.isFinite(fired) && Number.isFinite(ready) && ready > fired) {
        const mins = Math.round((ready - fired) / 60_000);
        prepByStation[sid] = [...(prepByStation[sid] ?? []), mins];
      }
    }
    if (t.readyAt && t.pickedUpAt) {
      const ready = Date.parse(t.readyAt);
      const picked = Date.parse(t.pickedUpAt);
      if (Number.isFinite(ready) && Number.isFinite(picked) && picked > ready) {
        pickupDurations.push(Math.round((picked - ready) / 60_000));
      }
    }
  }

  const allPrep: number[] = Object.values(prepByStation).flat();
  const averagePrepMinutes =
    allPrep.length > 0 ? Math.round(allPrep.reduce((a, b) => a + b, 0) / allPrep.length) : null;
  const averagePickupMinutes =
    pickupDurations.length > 0
      ? Math.round(pickupDurations.reduce((a, b) => a + b, 0) / pickupDurations.length)
      : null;

  return {
    averagePrepMinutes,
    stationWorkload,
    mostDelayedStationId,
    averagePickupMinutes,
    ordersPerStation,
    itemsPerStation,
  };
}

/** Monotonic merge — never regress ticket status on multi-device sync. */
export function mergeKitchenTicketMonotonic(local: KitchenTicket, remote: KitchenTicket): KitchenTicket {
  const l = normalizeKitchenTicket(local);
  const r = normalizeKitchenTicket(remote);
  const lIdx = statusProgressIndex(l.status);
  const rIdx = statusProgressIndex(r.status);
  const pickRemote = rIdx > lIdx || (rIdx === lIdx && newerIso(r.updatedAt, l.updatedAt));
  const base = pickRemote ? { ...l, ...r } : { ...r, ...l };
  const status = pickRemote
    ? rIdx >= lIdx
      ? r.status
      : l.status
    : lIdx >= rIdx
      ? l.status
      : r.status;
  const statusHistory = mergeStatusHistory(l.statusHistory ?? [], r.statusHistory ?? []);
  const recallHistory = [...(l.recallHistory ?? []), ...(r.recallHistory ?? [])].sort((a, b) =>
    a.at.localeCompare(b.at),
  );
  return normalizeKitchenTicket({ ...base, status, statusHistory, recallHistory });
}

function mergeStatusHistory(a: KitchenTicketStatusEvent[], b: KitchenTicketStatusEvent[]): KitchenTicketStatusEvent[] {
  const seen = new Set<string>();
  const out: KitchenTicketStatusEvent[] = [];
  for (const e of [...a, ...b].sort((x, y) => x.at.localeCompare(y.at))) {
    const key = `${e.at}|${e.toStatus}|${e.fromStatus ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function newerIso(a: string | undefined | null, b: string | undefined | null): boolean {
  const ta = a ? Date.parse(a) : 0;
  const tb = b ? Date.parse(b) : 0;
  return ta >= tb;
}

export function isKitchenStationType(type: KitchenStationType): boolean {
  return (KITCHEN_FIRE_STATION_TYPES as readonly string[]).includes(type);
}

export function isBarStationType(type: KitchenStationType): boolean {
  return (BAR_FIRE_STATION_TYPES as readonly string[]).includes(type);
}

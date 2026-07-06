import type {
  CombinedTableGroup,
  DiningTable,
  FloorNotification,
  HospitalityAuditEvent,
  HospitalityCustomerProfile,
  HospitalityFloorState,
  Sale,
  SeatingTimelineEvent,
  SeatingTimelineEventType,
  TableDisplayStatus,
  TableLockReason,
  TableReservation,
  WaiterSection,
  WaitlistEntry,
  WaitlistPriority,
} from "../types";
import { preferredPaymentMethodFromSales } from "./restaurantBilling";
import { activeSessionForTable, syncTableDisplayStatuses } from "./hospitality";
import { activeProductionTickets } from "./kitchenProduction";

export type FohActor = { userId?: string | null; label?: string | null };

// ─── Audit ───────────────────────────────────────────────────────────────────

export function appendHospitalityAudit(
  floor: HospitalityFloorState,
  event: Omit<HospitalityAuditEvent, "id" | "at"> & { at?: string },
): HospitalityFloorState {
  const row: HospitalityAuditEvent = {
    id: crypto.randomUUID(),
    at: event.at ?? new Date().toISOString(),
    ...event,
  };
  const log = [...(floor.hospitalityAuditLog ?? []), row].slice(-500);
  return { ...floor, hospitalityAuditLog: log };
}

export function appendTableTimeline(
  table: DiningTable,
  type: SeatingTimelineEventType,
  actor?: FohActor,
  extra?: Partial<SeatingTimelineEvent>,
): DiningTable {
  const event: SeatingTimelineEvent = {
    type,
    at: new Date().toISOString(),
    actorLabel: actor?.label ?? null,
    ...extra,
  };
  return { ...table, seatingTimeline: [...(table.seatingTimeline ?? []), event].slice(-30) };
}

function mapTables(floor: HospitalityFloorState, fn: (t: DiningTable) => DiningTable): HospitalityFloorState {
  return syncTableDisplayStatuses({ ...floor, tables: floor.tables.map(fn) });
}

// ─── Reservation numbers ─────────────────────────────────────────────────────

export function nextReservationNumber(floor: HospitalityFloorState, dateKey: string): number {
  if (floor.lastReservationNumberDate === dateKey && floor.lastReservationNumber != null) {
    return floor.lastReservationNumber + 1;
  }
  const todayRes = (floor.reservations ?? []).filter((r) => r.reservationDate === dateKey);
  const max = todayRes.reduce((m, r) => Math.max(m, r.reservationNumber), 0);
  return max + 1;
}

// ─── Table visibility (combine groups) ───────────────────────────────────────

export function isPrimaryFloorTable(table: DiningTable, floor: HospitalityFloorState): boolean {
  if (!table.combinedGroupId) return true;
  const group = (floor.combinedGroups ?? []).find((g) => g.id === table.combinedGroupId);
  return group?.primaryTableId === table.id;
}

export function visibleFloorTables(floor: HospitalityFloorState, areaId?: string | null): DiningTable[] {
  return (floor.tables ?? [])
    .filter((t) => t.isActive && isPrimaryFloorTable(t, floor))
    .filter((t) => !areaId || t.areaId === areaId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function reservationForTable(
  floor: HospitalityFloorState,
  tableId: string,
  dateKey?: string,
): TableReservation | undefined {
  const today = dateKey ?? new Date().toISOString().slice(0, 10);
  return (floor.reservations ?? []).find(
    (r) =>
      (r.status === "pending" || r.status === "confirmed") &&
      r.reservationDate === today &&
      (r.preferredTableId === tableId || r.assignedTableIds?.includes(tableId)),
  );
}

export function isTableLocked(table: DiningTable): boolean {
  return !!table.lockReason;
}

export function isTableSeatable(table: DiningTable, floor: HospitalityFloorState): boolean {
  if (!table.isActive || isTableLocked(table)) return false;
  if (activeSessionForTable(floor, table.id)) return false;
  const status = table.displayStatus;
  return status === "available" || status === "reserved";
}

// ─── Auto table suggestions ──────────────────────────────────────────────────

export type TableSuggestion = {
  tableIds: string[];
  displayLabel: string;
  totalCapacity: number;
  score: number;
  requiresCombine: boolean;
};

export function suggestTables(input: {
  floor: HospitalityFloorState;
  guestCount: number;
  areaId?: string | null;
  preferredTableId?: string | null;
  isVip?: boolean;
  needsAccessible?: boolean;
  smoking?: boolean | null;
}): TableSuggestion[] {
  const candidates = visibleFloorTables(input.floor, input.areaId).filter((t) => isTableSeatable(t, input.floor));
  const suggestions: TableSuggestion[] = [];

  if (input.preferredTableId) {
    const pref = candidates.find((t) => t.id === input.preferredTableId);
    if (pref && (pref.capacity ?? 4) >= input.guestCount) {
      suggestions.push({
        tableIds: [pref.id],
        displayLabel: pref.label,
        totalCapacity: pref.capacity ?? 4,
        score: 100,
        requiresCombine: false,
      });
    }
  }

  for (const table of candidates) {
    const cap = table.capacity ?? 4;
    if (cap < input.guestCount) continue;
    let score = 50;
    if (cap === input.guestCount) score += 30;
    else if (cap <= input.guestCount + 2) score += 20;
    else score += 5;
    if (input.isVip && cap >= 6) score += 10;
    if (input.needsAccessible && table.isAccessible) score += 25;
    if (input.smoking === true && table.isSmoking) score += 15;
    if (input.smoking === false && !table.isSmoking) score += 15;
    suggestions.push({
      tableIds: [table.id],
      displayLabel: table.label,
      totalCapacity: cap,
      score,
      requiresCombine: false,
    });
  }

  if (!suggestions.some((s) => s.totalCapacity >= input.guestCount)) {
    const sorted = [...candidates].sort((a, b) => (a.sortOrder - b.sortOrder) || a.label.localeCompare(b.label));
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      if (a.areaId !== b.areaId) continue;
      const cap = (a.capacity ?? 4) + (b.capacity ?? 4);
      if (cap >= input.guestCount) {
        suggestions.push({
          tableIds: [a.id, b.id],
          displayLabel: `${a.label}-${b.label.replace(/^Table\s*/i, "")}`,
          totalCapacity: cap,
          score: 40,
          requiresCombine: true,
        });
      }
    }
  }

  return [...suggestions].sort((a, b) => b.score - a.score);
}

// ─── Reservations CRUD ───────────────────────────────────────────────────────

export function createReservation(
  floor: HospitalityFloorState,
  input: Omit<TableReservation, "id" | "reservationNumber" | "status" | "createdAt" | "updatedAt" | "pendingSync">,
  actor?: FohActor,
): HospitalityFloorState {
  const now = new Date().toISOString();
  const reservationNumber = nextReservationNumber(floor, input.reservationDate);
  const reservation: TableReservation = {
    ...input,
    id: crypto.randomUUID(),
    reservationNumber,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    pendingSync: true,
  };
  let next: HospitalityFloorState = {
    ...floor,
    reservations: [...(floor.reservations ?? []), reservation],
    lastReservationNumberDate: input.reservationDate,
    lastReservationNumber: reservationNumber,
  };
  next = applyReservationToTables(next, reservation);
  return appendHospitalityAudit(next, {
    type: "reservation_created",
    entityType: "reservation",
    entityId: reservation.id,
    actorUserId: actor?.userId ?? null,
    actorLabel: actor?.label ?? null,
    payload: { reservationNumber },
  });
}

export function updateReservation(
  floor: HospitalityFloorState,
  reservationId: string,
  patch: Partial<TableReservation>,
  actor?: FohActor,
): HospitalityFloorState {
  const now = new Date().toISOString();
  let updated: TableReservation | undefined;
  const reservations = (floor.reservations ?? []).map((r) => {
    if (r.id !== reservationId) return r;
    updated = { ...r, ...patch, updatedAt: now, pendingSync: true };
    return updated;
  });
  if (!updated) return floor;
  let next: HospitalityFloorState = { ...floor, reservations };
  next = clearReservationFromTables(next, reservationId);
  next = applyReservationToTables(next, updated);
  return appendHospitalityAudit(next, {
    type: patch.status === "confirmed" ? "reservation_confirmed" : "reservation_edited",
    entityType: "reservation",
    entityId: reservationId,
    actorUserId: actor?.userId ?? null,
    actorLabel: actor?.label ?? null,
  });
}

export function cancelReservation(
  floor: HospitalityFloorState,
  reservationId: string,
  reason: string,
  actor?: FohActor,
): HospitalityFloorState {
  const now = new Date().toISOString();
  const reservations = (floor.reservations ?? []).map((r) =>
    r.id === reservationId
      ? { ...r, status: "cancelled" as const, notes: reason, updatedAt: now, pendingSync: true }
      : r,
  );
  let next = clearReservationFromTables({ ...floor, reservations }, reservationId);
  return appendHospitalityAudit(next, {
    type: "reservation_cancelled",
    entityType: "reservation",
    entityId: reservationId,
    actorUserId: actor?.userId ?? null,
    actorLabel: actor?.label ?? null,
    reason,
  });
}

function applyReservationToTables(floor: HospitalityFloorState, reservation: TableReservation): HospitalityFloorState {
  if (reservation.status !== "pending" && reservation.status !== "confirmed") return floor;
  const today = new Date().toISOString().slice(0, 10);
  if (reservation.reservationDate !== today) return floor;
  const tableIds = reservation.assignedTableIds?.length
    ? reservation.assignedTableIds
    : reservation.preferredTableId
      ? [reservation.preferredTableId]
      : [];
  if (!tableIds.length) return floor;
  return mapTables(floor, (t) => {
    if (!tableIds.includes(t.id)) return t;
    if (activeSessionForTable(floor, t.id)) return t;
    return appendTableTimeline(
      { ...t, displayStatus: "reserved" as TableDisplayStatus },
      "reserved",
      undefined,
      { reservationId: reservation.id },
    );
  });
}

function clearReservationFromTables(floor: HospitalityFloorState, reservationId: string): HospitalityFloorState {
  return mapTables(floor, (t) => {
    const hasRes = (floor.reservations ?? []).some(
      (r) =>
        r.id !== reservationId &&
        (r.status === "pending" || r.status === "confirmed") &&
        (r.preferredTableId === t.id || r.assignedTableIds?.includes(t.id)),
    );
    if (hasRes) return t;
    if (t.displayStatus === "reserved") {
      return { ...t, displayStatus: "available" as TableDisplayStatus };
    }
    return t;
  });
}

export function markReservationNoShow(
  floor: HospitalityFloorState,
  reservationId: string,
  actor?: FohActor,
): HospitalityFloorState {
  let next = updateReservation(floor, reservationId, { status: "no_show" }, actor);
  next = clearReservationFromTables(next, reservationId);
  return appendHospitalityAudit(next, {
    type: "reservation_no_show",
    entityType: "reservation",
    entityId: reservationId,
    actorUserId: actor?.userId ?? null,
    actorLabel: actor?.label ?? null,
  });
}

// ─── Waitlist ────────────────────────────────────────────────────────────────

export function addWaitlistEntry(
  floor: HospitalityFloorState,
  input: Omit<WaitlistEntry, "id" | "status" | "createdAt" | "updatedAt" | "pendingSync">,
  actor?: FohActor,
): HospitalityFloorState {
  const now = new Date().toISOString();
  const entry: WaitlistEntry = {
    ...input,
    id: crypto.randomUUID(),
    status: "waiting",
    createdAt: now,
    updatedAt: now,
    pendingSync: true,
  };
  const next = { ...floor, waitlist: [...(floor.waitlist ?? []), entry] };
  return appendHospitalityAudit(next, {
    type: "waitlist_created",
    entityType: "waitlist",
    entityId: entry.id,
    actorUserId: actor?.userId ?? null,
    actorLabel: actor?.label ?? null,
  });
}

export function cancelWaitlistEntry(
  floor: HospitalityFloorState,
  entryId: string,
  actor?: FohActor,
): HospitalityFloorState {
  const now = new Date().toISOString();
  const waitlist = (floor.waitlist ?? []).map((e) =>
    e.id === entryId ? { ...e, status: "cancelled" as const, updatedAt: now, pendingSync: true } : e,
  );
  return appendHospitalityAudit({ ...floor, waitlist }, {
    type: "waitlist_cancelled",
    entityType: "waitlist",
    entityId: entryId,
    actorUserId: actor?.userId ?? null,
    actorLabel: actor?.label ?? null,
  });
}

export function activeWaitlist(floor: HospitalityFloorState): WaitlistEntry[] {
  const priorityOrder: Record<WaitlistPriority, number> = { vip: 3, high: 2, normal: 1 };
  return (floor.waitlist ?? [])
    .filter((e) => e.status === "waiting")
    .sort((a, b) => {
      const pd = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (pd !== 0) return pd;
      return a.arrivalTime.localeCompare(b.arrivalTime);
    });
}

// ─── Cleaning workflow ───────────────────────────────────────────────────────

export function markTableNeedsCleaning(floor: HospitalityFloorState, tableId: string, actor?: FohActor): HospitalityFloorState {
  return mapTables(floor, (t) => {
    if (t.id !== tableId) return t;
    return appendTableTimeline(
      { ...t, displayStatus: "needs_cleaning" },
      "paid",
      actor,
    );
  });
}

export function startTableCleaning(floor: HospitalityFloorState, tableId: string, actor?: FohActor): HospitalityFloorState {
  const now = new Date().toISOString();
  let next = mapTables(floor, (t) => {
    if (t.id !== tableId) return t;
    return appendTableTimeline(
      { ...t, displayStatus: "cleaning", cleaningStartedAt: now },
      "cleaning_started",
      actor,
    );
  });
  return appendHospitalityAudit(next, {
    type: "cleaning_started",
    entityType: "table",
    entityId: tableId,
    actorUserId: actor?.userId ?? null,
    actorLabel: actor?.label ?? null,
  });
}

export function finishTableCleaning(floor: HospitalityFloorState, tableId: string, actor?: FohActor): HospitalityFloorState {
  let next = mapTables(floor, (t) => {
    if (t.id !== tableId) return t;
    return appendTableTimeline(
      { ...t, displayStatus: "available", cleaningStartedAt: null },
      "cleaning_finished",
      actor,
    );
  });
  next = mapTables(next, (t) => {
    if (t.id !== tableId) return t;
    return appendTableTimeline(t, "available", actor);
  });
  return appendHospitalityAudit(next, {
    type: "cleaning_finished",
    entityType: "table",
    entityId: tableId,
    actorUserId: actor?.userId ?? null,
    actorLabel: actor?.label ?? null,
  });
}

// ─── Table locking ───────────────────────────────────────────────────────────

export function lockTable(
  floor: HospitalityFloorState,
  tableId: string,
  reason: TableLockReason,
  note?: string,
  actor?: FohActor,
): HospitalityFloorState {
  if (activeSessionForTable(floor, tableId)) return floor;
  let next = mapTables(floor, (t) =>
    t.id === tableId ? { ...t, lockReason: reason, lockNote: note ?? null, displayStatus: "blocked" as TableDisplayStatus } : t,
  );
  return appendHospitalityAudit(next, {
    type: "table_locked",
    entityType: "table",
    entityId: tableId,
    actorUserId: actor?.userId ?? null,
    actorLabel: actor?.label ?? null,
    reason: note ?? reason,
  });
}

export function unlockTable(floor: HospitalityFloorState, tableId: string, actor?: FohActor): HospitalityFloorState {
  let next = mapTables(floor, (t) =>
    t.id === tableId ? { ...t, lockReason: null, lockNote: null, displayStatus: "available" as TableDisplayStatus } : t,
  );
  return appendHospitalityAudit(next, {
    type: "table_unlocked",
    entityType: "table",
    entityId: tableId,
    actorUserId: actor?.userId ?? null,
    actorLabel: actor?.label ?? null,
  });
}

// ─── Table combine / split ───────────────────────────────────────────────────

export function combineTables(
  floor: HospitalityFloorState,
  tableIds: string[],
  actor?: FohActor,
): { floor: HospitalityFloorState; ok: boolean; errorKey?: string; groupId?: string } {
  if (tableIds.length < 2) return { floor, ok: false, errorKey: "invalid" };
  const tables = tableIds.map((id) => floor.tables.find((t) => t.id === id)).filter(Boolean) as DiningTable[];
  if (tables.length !== tableIds.length) return { floor, ok: false, errorKey: "invalid" };
  const areaId = tables[0]!.areaId;
  if (tables.some((t) => t.areaId !== areaId)) return { floor, ok: false, errorKey: "tableCombineDifferentAreas" };
  if (tables.some((t) => !isTableSeatable(t, floor))) return { floor, ok: false, errorKey: "tableOccupied" };

  const primary = [...tables].sort((a, b) => a.sortOrder - b.sortOrder)[0]!;
  const displayLabel = tables.map((t) => t.label).join("-");
  const capacity = tables.reduce((s, t) => s + (t.capacity ?? 4), 0);
  const group: CombinedTableGroup = {
    id: crypto.randomUUID(),
    primaryTableId: primary.id,
    tableIds,
    displayLabel,
    areaId,
    capacity,
    originalLabels: Object.fromEntries(tables.map((t) => [t.id, t.label])),
    originalCapacities: Object.fromEntries(tables.map((t) => [t.id, t.capacity ?? 4])),
    createdAt: new Date().toISOString(),
    pendingSync: true,
  };

  const updatedTables = floor.tables.map((t) => {
    if (!tableIds.includes(t.id)) return t;
    const isPrimary = t.id === primary.id;
    return {
      ...t,
      combinedGroupId: group.id,
      label: isPrimary ? displayLabel : t.label,
      capacity: isPrimary ? capacity : t.capacity,
    };
  });

  let next = syncTableDisplayStatuses({
    ...floor,
    tables: updatedTables,
    combinedGroups: [...(floor.combinedGroups ?? []), group],
  });
  next = appendHospitalityAudit(next, {
    type: "table_combined",
    entityType: "table",
    entityId: group.id,
    actorUserId: actor?.userId ?? null,
    actorLabel: actor?.label ?? null,
    payload: { tableIds, displayLabel },
  });
  return { floor: next, ok: true, groupId: group.id };
}

export function splitCombinedTables(
  floor: HospitalityFloorState,
  groupId: string,
  actor?: FohActor,
): { floor: HospitalityFloorState; ok: boolean; errorKey?: string } {
  const group = (floor.combinedGroups ?? []).find((g) => g.id === groupId);
  if (!group) return { floor, ok: false, errorKey: "invalid" };
  if (group.tableIds.some((id) => activeSessionForTable(floor, id))) {
    return { floor, ok: false, errorKey: "tableOccupied" };
  }

  const updatedTables = floor.tables.map((t) => {
    if (!group.tableIds.includes(t.id)) return t;
    return {
      ...t,
      combinedGroupId: null,
      label: group.originalLabels[t.id] ?? t.label,
      capacity: group.originalCapacities[t.id] ?? t.capacity,
    };
  });

  let next = syncTableDisplayStatuses({
    ...floor,
    tables: updatedTables,
    combinedGroups: (floor.combinedGroups ?? []).filter((g) => g.id !== groupId),
  });
  next = appendHospitalityAudit(next, {
    type: "table_split",
    entityType: "table",
    entityId: groupId,
    actorUserId: actor?.userId ?? null,
    actorLabel: actor?.label ?? null,
  });
  return { floor: next, ok: true };
}

export function splitCombinedTablesForSession(
  floor: HospitalityFloorState,
  sessionId: string,
  actor?: FohActor,
): HospitalityFloorState {
  const session = floor.sessions.find((s) => s.id === sessionId);
  if (!session?.tableId) return floor;
  const table = floor.tables.find((t) => t.id === session.tableId);
  if (!table?.combinedGroupId) return floor;
  const result = splitCombinedTables(floor, table.combinedGroupId, actor);
  return result.ok ? result.floor : floor;
}

// ─── Waiter sections ─────────────────────────────────────────────────────────

export function upsertWaiterSection(
  floor: HospitalityFloorState,
  section: Omit<WaiterSection, "id"> & { id?: string },
  actor?: FohActor,
): HospitalityFloorState {
  const id = section.id ?? crypto.randomUUID();
  const row: WaiterSection = { ...section, id };
  const existing = floor.waiterSections ?? [];
  const waiterSections = existing.some((s) => s.id === id)
    ? existing.map((s) => (s.id === id ? row : s))
    : [...existing, row];
  return appendHospitalityAudit({ ...floor, waiterSections }, {
    type: "section_assigned",
    entityType: "section",
    entityId: id,
    actorUserId: actor?.userId ?? null,
    actorLabel: actor?.label ?? null,
  });
}

export function waiterForTable(floor: HospitalityFloorState, tableId: string): WaiterSection | undefined {
  return (floor.waiterSections ?? []).find((s) => s.isActive && s.tableIds.includes(tableId));
}

// ─── Customer history (read-only) ────────────────────────────────────────────

export function lookupCustomerProfile(
  phone: string,
  floor: HospitalityFloorState,
  sales: Sale[],
): HospitalityCustomerProfile | null {
  const normalized = phone.replace(/\D/g, "");
  if (normalized.length < 9) return null;

  const completed = sales.filter((s) => s.status === "completed" || (!s.status && s.cashPaidUgx > 0));
  const matching = completed.filter((s) => {
    const session = s.tableSessionId ? floor.sessions.find((x) => x.id === s.tableSessionId) : undefined;
    const p = session?.customerPhone?.replace(/\D/g, "") ?? "";
    return p === normalized;
  });

  const reservations = (floor.reservations ?? []).filter((r) => r.phone.replace(/\D/g, "") === normalized);
  const visits = matching.length;
  const totalSpend = matching.reduce((s, x) => s + (x.totalUgx ?? 0), 0);

  const tableCounts = new Map<string, number>();
  for (const sale of matching) {
    const session = sale.tableSessionId ? floor.sessions.find((x) => x.id === sale.tableSessionId) : undefined;
    if (session?.tableId) tableCounts.set(session.tableId, (tableCounts.get(session.tableId) ?? 0) + 1);
  }
  let favouriteTableId: string | undefined;
  let maxVisits = 0;
  for (const [tid, count] of tableCounts) {
    if (count > maxVisits) {
      maxVisits = count;
      favouriteTableId = tid;
    }
  }

  const waiterCounts = new Map<string, number>();
  for (const sale of matching) {
    const session = sale.tableSessionId ? floor.sessions.find((x) => x.id === sale.tableSessionId) : undefined;
    const w = session?.waiterLabel;
    if (w) waiterCounts.set(w, (waiterCounts.get(w) ?? 0) + 1);
  }
  let preferredWaiterLabel: string | undefined;
  let maxW = 0;
  for (const [w, count] of waiterCounts) {
    if (count > maxW) {
      maxW = count;
      preferredWaiterLabel = w;
    }
  }

  const lastVisitAt = matching
    .map((s) => s.createdAt)
    .sort()
    .reverse()[0];
  const isVip = reservations.some((r) => r.isVip) || (floor.waitlist ?? []).some((w) => w.priority === "vip");

  const name =
    reservations.find((r) => r.guestName)?.guestName ??
    floor.sessions.find((s) => s.customerPhone?.replace(/\D/g, "") === normalized)?.customerName ??
    null;

  const specialNotes =
    reservations.find((r) => r.notes)?.notes ??
    floor.sessions.find((s) => s.customerPhone?.replace(/\D/g, "") === normalized)?.specialNotes ??
    null;

  if (visits === 0 && reservations.length === 0) return null;

  return {
    phone,
    name,
    visitCount: visits,
    averageSpendUgx: visits > 0 ? Math.round(totalSpend / visits) : 0,
    favouriteTableId: favouriteTableId ?? null,
    lastVisitAt: lastVisitAt ?? null,
    preferredWaiterLabel: preferredWaiterLabel ?? null,
    specialNotes,
    isVip,
    billCount: visits,
    preferredPaymentMethod: preferredPaymentMethodFromSales(matching),
    outstandingBalanceUgx: matching.reduce((s, x) => s + (x.debtUgx ?? 0), 0),
  };
}

// ─── Floor notifications ─────────────────────────────────────────────────────

export function computeFloorNotifications(floor: HospitalityFloorState, nowMs = Date.now()): FloorNotification[] {
  const alerts: FloorNotification[] = [];
  const now = new Date(nowMs);
  const today = now.toISOString().slice(0, 10);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  for (const r of floor.reservations ?? []) {
    if (r.reservationDate !== today) continue;
    if (r.status !== "pending" && r.status !== "confirmed") continue;
    const [hh, mm] = r.reservationTime.split(":").map(Number);
    const resMinutes = (hh ?? 0) * 60 + (mm ?? 0);
    const diff = nowMinutes - resMinutes;
    if (diff >= -15 && diff <= 5) {
      alerts.push({
        id: `res-arr-${r.id}`,
        kind: "reservation_arriving",
        messageKey: "fohAlertReservationArriving",
        entityId: r.id,
        tableLabel: r.guestName,
        at: now.toISOString(),
      });
    }
    if (diff > 15) {
      alerts.push({
        id: `res-late-${r.id}`,
        kind: "reservation_late",
        messageKey: "fohAlertReservationLate",
        entityId: r.id,
        tableLabel: r.guestName,
        at: now.toISOString(),
      });
    }
    if (r.isVip) {
      alerts.push({
        id: `vip-${r.id}`,
        kind: "vip_arrival",
        messageKey: "fohAlertVipArrival",
        entityId: r.id,
        tableLabel: r.guestName,
        at: now.toISOString(),
      });
    }
  }

  for (const w of activeWaitlist(floor)) {
    const waited = Math.round((nowMs - Date.parse(w.arrivalTime)) / 60_000);
    if (waited >= (w.estimatedWaitMinutes ?? 15)) {
      alerts.push({
        id: `wl-${w.id}`,
        kind: "waitlist_waiting",
        messageKey: "fohAlertWaitlistWaiting",
        entityId: w.id,
        tableLabel: w.name,
        at: now.toISOString(),
      });
    }
  }

  for (const t of floor.tables) {
    if (t.displayStatus === "needs_cleaning") {
      alerts.push({
        id: `clean-${t.id}`,
        kind: "cleaning_overdue",
        messageKey: "fohAlertCleaningOverdue",
        entityId: t.id,
        tableLabel: t.label,
        at: now.toISOString(),
      });
    }
    if (t.displayStatus === "cleaning" && t.cleaningStartedAt) {
      const mins = Math.round((nowMs - Date.parse(t.cleaningStartedAt)) / 60_000);
      if (mins > 20) {
        alerts.push({
          id: `clean-long-${t.id}`,
          kind: "cleaning_overdue",
          messageKey: "fohAlertCleaningOverdue",
          entityId: t.id,
          tableLabel: t.label,
          at: now.toISOString(),
        });
      }
    }
  }

  const readyKitchen = activeProductionTickets(floor).filter((t) => t.status === "ready").length;
  if (readyKitchen > 0) {
    alerts.push({
      id: "kitchen-ready",
      kind: "kitchen_ready",
      messageKey: "fohAlertKitchenReady",
      entityId: "kitchen",
      tableLabel: String(readyKitchen),
      at: now.toISOString(),
    });
  }

  return alerts;
}

export function reservationsForDate(floor: HospitalityFloorState, dateKey: string): TableReservation[] {
  return (floor.reservations ?? [])
    .filter((r) => r.reservationDate === dateKey && r.status !== "cancelled")
    .sort((a, b) => a.reservationTime.localeCompare(b.reservationTime));
}

export function seatReservationOnFloor(
  floor: HospitalityFloorState,
  reservationId: string,
  tableId: string,
  sessionId: string,
  actor?: FohActor,
): HospitalityFloorState {
  const now = new Date().toISOString();
  const reservations = (floor.reservations ?? []).map((r) =>
    r.id === reservationId
      ? { ...r, status: "seated" as const, seatedSessionId: sessionId, updatedAt: now, pendingSync: true }
      : r,
  );
  let next = clearReservationFromTables({ ...floor, reservations }, reservationId);
  next = mapTables(next, (t) => {
    if (t.id !== tableId) return t;
    return appendTableTimeline(t, "seated", actor, { reservationId, sessionId });
  });
  return appendHospitalityAudit(next, {
    type: "reservation_seated",
    entityType: "reservation",
    entityId: reservationId,
    actorUserId: actor?.userId ?? null,
    actorLabel: actor?.label ?? null,
    payload: { tableId, sessionId },
  });
}

export function seatWaitlistOnFloor(
  floor: HospitalityFloorState,
  entryId: string,
  sessionId: string,
  actor?: FohActor,
): HospitalityFloorState {
  const now = new Date().toISOString();
  const waitlist = (floor.waitlist ?? []).map((e) =>
    e.id === entryId ? { ...e, status: "seated" as const, seatedSessionId: sessionId, updatedAt: now, pendingSync: true } : e,
  );
  return appendHospitalityAudit({ ...floor, waitlist }, {
    type: "waitlist_seated",
    entityType: "waitlist",
    entityId: entryId,
    actorUserId: actor?.userId ?? null,
    actorLabel: actor?.label ?? null,
    payload: { sessionId },
  });
}

export function completeReservation(
  floor: HospitalityFloorState,
  reservationId: string,
  actor?: FohActor,
): HospitalityFloorState {
  return updateReservation(floor, reservationId, { status: "completed" }, actor);
}

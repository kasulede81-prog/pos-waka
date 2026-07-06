import type {
  BusinessType,
  DiningTable,
  HospitalityFloorState,
  Sale,
  SaleLine,
  TableSession,
  TableSessionStatus,
} from "../types";
import {
  visibleFloorTables,
  markTableNeedsCleaning,
  completeReservation,
  splitCombinedTables,
} from "./hospitalityFrontOfHouse";
import { computeDraftCheckoutTotals, estimatedProfitAfterCartDiscount } from "./draftCart";
import { ensureSaleLineId } from "./pendingSaleMerge";

export const HOSPITALITY_BUSINESS_TYPES = [
  "restaurant",
  "bar",
  "restaurant_bar",
  "hotel",
] as const satisfies readonly BusinessType[];

export type HospitalityBusinessType = (typeof HOSPITALITY_BUSINESS_TYPES)[number];

export const TABLE_STATUS_COLORS: Record<
  import("../types").TableDisplayStatus,
  { bg: string; border: string; text: string; dot: string; labelKey: string }
> = {
  available: {
    bg: "bg-emerald-50",
    border: "border-emerald-500",
    text: "text-emerald-950",
    dot: "bg-emerald-500",
    labelKey: "tableStatusAvailable",
  },
  occupied: {
    bg: "bg-sky-50",
    border: "border-sky-500",
    text: "text-sky-950",
    dot: "bg-sky-500",
    labelKey: "tableStatusOccupied",
  },
  payment_pending: {
    bg: "bg-orange-50",
    border: "border-orange-500",
    text: "text-orange-950",
    dot: "bg-orange-500",
    labelKey: "tableStatusPaymentPending",
  },
  reserved: {
    bg: "bg-violet-50",
    border: "border-violet-500",
    text: "text-violet-950",
    dot: "bg-violet-500",
    labelKey: "tableStatusReserved",
  },
  needs_attention: {
    bg: "bg-red-50",
    border: "border-red-500",
    text: "text-red-950",
    dot: "bg-red-500",
    labelKey: "tableStatusNeedsAttention",
  },
  needs_cleaning: {
    bg: "bg-yellow-50",
    border: "border-yellow-500",
    text: "text-yellow-950",
    dot: "bg-yellow-500",
    labelKey: "tableStatusNeedsCleaning",
  },
  cleaning: {
    bg: "bg-cyan-50",
    border: "border-cyan-500",
    text: "text-cyan-950",
    dot: "bg-cyan-500",
    labelKey: "tableStatusCleaning",
  },
  blocked: {
    bg: "bg-stone-200",
    border: "border-stone-500",
    text: "text-stone-700",
    dot: "bg-stone-600",
    labelKey: "tableStatusBlocked",
  },
  disabled: {
    bg: "bg-stone-100",
    border: "border-stone-300",
    text: "text-stone-500",
    dot: "bg-stone-400",
    labelKey: "tableStatusDisabled",
  },
};

export function isHospitalityBusinessType(type: BusinessType | undefined | null): type is HospitalityBusinessType {
  return !!type && (HOSPITALITY_BUSINESS_TYPES as readonly string[]).includes(type);
}

export function isHospitalityMode(
  businessType: BusinessType | undefined | null,
  enabled?: boolean | null,
): boolean {
  if (enabled === false) return false;
  return isHospitalityBusinessType(businessType);
}

/** True for bar businesses with kitchen display turned off (default for bar). */
export function isBarOnlyMode(
  businessType: BusinessType | undefined | null,
  hospitalityModeEnabled?: boolean | null,
  hospitalityKitchenEnabled?: boolean | null,
): boolean {
  if (!isHospitalityMode(businessType, hospitalityModeEnabled)) return false;
  if (businessType !== "bar") return false;
  return !isKitchenEnabledForHospitality(businessType, hospitalityKitchenEnabled);
}

export function defaultKitchenEnabledForBusinessType(businessType: BusinessType | undefined | null): boolean {
  return businessType !== "bar";
}

export function isKitchenEnabledForHospitality(
  businessType: BusinessType | undefined | null,
  hospitalityKitchenEnabled?: boolean | null,
): boolean {
  if (!isHospitalityBusinessType(businessType)) return false;
  if (hospitalityKitchenEnabled === true) return true;
  if (hospitalityKitchenEnabled === false) return false;
  return defaultKitchenEnabledForBusinessType(businessType);
}

export function emptyHospitalityFloor(): HospitalityFloorState {
  return {
    areas: [],
    tables: [],
    sessions: [],
    stations: [],
    reservations: [],
    waitlist: [],
    waiterSections: [],
    combinedGroups: [],
    hospitalityAuditLog: [],
  };
}

export function defaultHospitalityFloor(): HospitalityFloorState {
  const areaId = crypto.randomUUID();
  const kitchenId = crypto.randomUUID();
  const barId = crypto.randomUUID();
  const tables: DiningTable[] = [];
  for (let i = 1; i <= 8; i++) {
    tables.push({
      id: crypto.randomUUID(),
      areaId,
      label: `Table ${i}`,
      capacity: 4,
      sortOrder: i,
      displayStatus: "available",
      isActive: true,
    });
  }
  return {
    areas: [{ id: areaId, name: "Main Hall", sortOrder: 0, isActive: true }],
    tables,
    sessions: [],
    stations: [
      { id: kitchenId, name: "Main Kitchen", stationType: "kitchen", sortOrder: 0, isActive: true },
      { id: barId, name: "Bar", stationType: "bar", sortOrder: 1, isActive: true },
    ],
    kitchenTickets: [],
    reservations: [],
    waitlist: [],
    waiterSections: [],
    combinedGroups: [],
    hospitalityAuditLog: [],
  };
}

export function isTableSession(session: TableSession): boolean {
  return session.sessionKind !== "named_tab";
}

export function isNamedTabSession(session: TableSession): boolean {
  return session.sessionKind === "named_tab";
}

export function isActiveSession(session: TableSession): boolean {
  return session.status === "open" || session.status === "payment_pending";
}

export function sessionDisplayLabel(session: TableSession, floor: HospitalityFloorState): string {
  if (isNamedTabSession(session)) {
    return session.tabLabel?.trim() || session.customerName?.trim() || "Tab";
  }
  const table = session.tableId ? floor.tables.find((t) => t.id === session.tableId) : undefined;
  const area = table ? floor.areas.find((a) => a.id === table.areaId) : undefined;
  if (table) return area ? `${table.label} · ${area.name}` : table.label;
  return "Table";
}

export function activeSessionForTable(
  floor: HospitalityFloorState,
  tableId: string,
): TableSession | undefined {
  return floor.sessions.find(
    (s) =>
      s.tableId === tableId &&
      isTableSession(s) &&
      (s.status === "open" || s.status === "payment_pending"),
  );
}

export function activeNamedTabs(floor: HospitalityFloorState): TableSession[] {
  return floor.sessions.filter((s) => isNamedTabSession(s) && isActiveSession(s));
}

export function deriveTableDisplayStatus(
  table: DiningTable,
  session: TableSession | undefined,
): import("../types").TableDisplayStatus {
  if (!table.isActive) return "disabled";
  if (table.lockReason) return "blocked";
  if (session) {
    if (session.needsAttention) return "needs_attention";
    if (session.status === "payment_pending") return "payment_pending";
    return "occupied";
  }
  if (table.displayStatus === "needs_cleaning") return "needs_cleaning";
  if (table.displayStatus === "cleaning") return "cleaning";
  if (table.displayStatus === "reserved") return "reserved";
  return "available";
}

/** Elapsed time since session opened — e.g. "45m" or "1h 20m". */
export function formatSessionElapsed(openedAt: string, nowMs = Date.now()): string {
  const ms = nowMs - Date.parse(openedAt);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export function activeTableSessions(floor: HospitalityFloorState): TableSession[] {
  return floor.sessions.filter((s) => isTableSession(s) && isActiveSession(s));
}

export function billRequestedSessions(floor: HospitalityFloorState): TableSession[] {
  return activeTableSessions(floor).filter((s) => s.status === "payment_pending");
}

export function floorStatusCounts(floor: HospitalityFloorState): {
  available: number;
  occupied: number;
  billRequested: number;
  reserved: number;
  needsAttention: number;
  needsCleaning: number;
  cleaning: number;
  blocked: number;
  disabled: number;
} {
  const counts = {
    available: 0,
    occupied: 0,
    billRequested: 0,
    reserved: 0,
    needsAttention: 0,
    needsCleaning: 0,
    cleaning: 0,
    blocked: 0,
    disabled: 0,
  };
  for (const table of visibleFloorTables(floor)) {
    if (!table.isActive) {
      counts.disabled += 1;
      continue;
    }
    const session = activeSessionForTable(floor, table.id);
    const status = deriveTableDisplayStatus(table, session);
    if (status === "available") counts.available += 1;
    else if (status === "occupied") counts.occupied += 1;
    else if (status === "payment_pending") counts.billRequested += 1;
    else if (status === "reserved") counts.reserved += 1;
    else if (status === "needs_attention") counts.needsAttention += 1;
    else if (status === "needs_cleaning") counts.needsCleaning += 1;
    else if (status === "cleaning") counts.cleaning += 1;
    else if (status === "blocked") counts.blocked += 1;
  }
  return counts;
}

export function syncTableDisplayStatuses(floor: HospitalityFloorState): HospitalityFloorState {
  let changed = false;
  const tables = floor.tables.map((t) => {
    const session = activeSessionForTable(floor, t.id);
    const displayStatus = deriveTableDisplayStatus(t, session);
    if (t.displayStatus === displayStatus) return t;
    changed = true;
    return { ...t, displayStatus };
  });
  if (!changed) return floor;
  return { ...floor, tables };
}

export function pendingSaleTotal(sale: Sale | undefined): number {
  if (!sale) return 0;
  return sale.totalUgx ?? 0;
}

export function buildPendingSaleFromDraft(input: {
  saleId: string;
  lines: SaleLine[];
  cartDiscountUgx: number;
  tableSessionId?: string | null;
  referenceLabel?: string | null;
  soldByUserId?: string | null;
  waiterStaffId?: string | null;
  waiterName?: string | null;
  existing?: Sale | null;
}): Sale {
  const saleLines = input.lines.map(ensureSaleLineId);
  const checkout = computeDraftCheckoutTotals(saleLines, input.cartDiscountUgx);
  const listSubtotal = saleLines.reduce((a, l) => a + (l.originalLineTotalUgx ?? l.lineTotalUgx), 0);
  const discountTotal = Math.max(0, listSubtotal - checkout.payableUgx);
  const now = new Date().toISOString();
  return {
    id: input.saleId,
    status: "pending",
    referenceLabel: input.referenceLabel ?? null,
    tableSessionId: input.tableSessionId ?? null,
    updatedAt: now,
    lines: saleLines,
    subtotalUgx: listSubtotal,
    totalUgx: checkout.payableUgx,
    cashPaidUgx: 0,
    debtUgx: 0,
    discountTotalUgx: discountTotal,
    voidedTotalUgx: 0,
    estimatedProfitUgx: estimatedProfitAfterCartDiscount(saleLines, checkout.cartDiscountUgx),
    createdAt: input.existing?.createdAt ?? now,
    pendingSync: true,
    lastSyncError: null,
    customerId: input.existing?.customerId ?? null,
    soldByUserId: input.soldByUserId ?? input.existing?.soldByUserId ?? null,
    waiterStaffId: input.waiterStaffId ?? input.existing?.waiterStaffId ?? null,
    waiterName: input.waiterName ?? input.existing?.waiterName ?? null,
    billDraft: input.existing?.billDraft ?? null,
  };
}

export function closeTableSession(
  floor: HospitalityFloorState,
  sessionId: string,
  status: TableSessionStatus = "closed",
  options?: { needsCleaning?: boolean },
): HospitalityFloorState {
  const now = new Date().toISOString();
  const session = floor.sessions.find((s) => s.id === sessionId);
  const sessions = floor.sessions.map((s) =>
    s.id === sessionId ? { ...s, status, closedAt: now, updatedAt: now, pendingSync: true } : s,
  );
  let next = syncTableDisplayStatuses({ ...floor, sessions });
  if (options?.needsCleaning && session?.tableId) {
    next = markTableNeedsCleaning(next, session.tableId);
    if (session.reservationId) {
      next = completeReservation(next, session.reservationId);
    }
    const table = next.tables.find((t) => t.id === session.tableId);
    if (table?.combinedGroupId) {
      const result = splitCombinedTables(next, table.combinedGroupId);
      if (result.ok) next = result.floor;
    }
  }
  return next;
}

export function openTableSessionOnFloor(input: {
  floor: HospitalityFloorState;
  tableId: string;
  saleId: string;
  sessionId: string;
  guestCount: number;
  adultCount?: number;
  childrenCount?: number;
  customerName?: string;
  customerPhone?: string;
  specialNotes?: string;
  reservationId?: string | null;
  waitlistEntryId?: string | null;
  waiterStaffId?: string | null;
  waiterLabel?: string | null;
}): HospitalityFloorState {
  const session: TableSession = {
    id: input.sessionId,
    sessionKind: "table",
    tableId: input.tableId,
    saleId: input.saleId,
    guestCount: input.guestCount,
    adultCount: input.adultCount ?? input.guestCount,
    childrenCount: input.childrenCount ?? 0,
    customerName: input.customerName ?? null,
    customerPhone: input.customerPhone ?? null,
    specialNotes: input.specialNotes ?? null,
    reservationId: input.reservationId ?? null,
    waitlistEntryId: input.waitlistEntryId ?? null,
    waiterStaffId: input.waiterStaffId ?? null,
    waiterLabel: input.waiterLabel ?? null,
    status: "open",
    openedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pendingSync: true,
  };
  const sessions = [...input.floor.sessions.filter((s) => s.id !== session.id), session];
  return syncTableDisplayStatuses({ ...input.floor, sessions });
}

export function openNamedTabSessionOnFloor(input: {
  floor: HospitalityFloorState;
  tabLabel: string;
  saleId: string;
  sessionId: string;
  guestCount?: number;
  customerName?: string;
  customerPhone?: string;
  waiterStaffId?: string | null;
  waiterLabel?: string | null;
}): HospitalityFloorState {
  const label = input.tabLabel.trim();
  const session: TableSession = {
    id: input.sessionId,
    sessionKind: "named_tab",
    tableId: null,
    tabLabel: label,
    saleId: input.saleId,
    guestCount: Math.max(1, input.guestCount ?? 1),
    customerName: input.customerName ?? null,
    customerPhone: input.customerPhone ?? null,
    waiterStaffId: input.waiterStaffId ?? null,
    waiterLabel: input.waiterLabel ?? null,
    status: "open",
    openedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pendingSync: true,
  };
  const sessions = [...input.floor.sessions.filter((s) => s.id !== session.id), session];
  return { ...input.floor, sessions };
}

function fillHospitalityFloorDefaults(floor: HospitalityFloorState): HospitalityFloorState {
  const needsDefaults =
    floor.kitchenTickets === undefined ||
    floor.reservations === undefined ||
    floor.waitlist === undefined ||
    floor.waiterSections === undefined ||
    floor.combinedGroups === undefined ||
    floor.hospitalityAuditLog === undefined;
  if (!needsDefaults) return floor;
  return {
    ...floor,
    kitchenTickets: floor.kitchenTickets ?? [],
    reservations: floor.reservations ?? [],
    waitlist: floor.waitlist ?? [],
    waiterSections: floor.waiterSections ?? [],
    combinedGroups: floor.combinedGroups ?? [],
    hospitalityAuditLog: floor.hospitalityAuditLog ?? [],
  };
}

/** Rebuild dining areas from table area ids when persisted layout lost its areas array. */
function repairHospitalityFloorAreas(floor: HospitalityFloorState): HospitalityFloorState {
  const areaIds = [...new Set(floor.tables.map((t) => t.areaId).filter(Boolean))];
  if (!areaIds.length) return defaultHospitalityFloor();
  const areas = areaIds.map((id, index) => {
    const existing = floor.areas?.find((a) => a.id === id);
    return (
      existing ?? {
        id,
        name: `Area ${index + 1}`,
        sortOrder: index,
        isActive: true,
      }
    );
  });
  return fillHospitalityFloorDefaults({ ...floor, areas });
}

export function ensureHospitalityFloor(floor: HospitalityFloorState | undefined | null): HospitalityFloorState {
  if (!floor) return defaultHospitalityFloor();
  if (!floor.areas?.length) {
    if (floor.tables?.length) return syncTableDisplayStatuses(repairHospitalityFloorAreas(floor));
    return defaultHospitalityFloor();
  }
  return syncTableDisplayStatuses(fillHospitalityFloorDefaults(floor));
}

export function totalOpenTablesPendingUgx(sales: Sale[], floor: HospitalityFloorState): number {
  let sum = 0;
  for (const session of floor.sessions) {
    if (!isActiveSession(session)) continue;
    const sale = sales.find((s) => s.id === session.saleId);
    sum += pendingSaleTotal(sale);
  }
  return sum;
}

export function defaultMenuCategoriesForBusinessType(businessType: BusinessType | undefined | null): string[] {
  if (businessType === "bar") {
    return ["Beer", "Wine", "Spirits", "Cocktails", "Soft Drinks", "Water", "Snacks"];
  }
  if (businessType === "restaurant") {
    return ["Food", "Chicken", "Pork", "Fish", "Rice", "Soft Drinks", "Water", "Desserts", "Coffee"];
  }
  if (businessType === "restaurant_bar" || businessType === "hotel") {
    return [
      "Food",
      "Chicken",
      "Beer",
      "Wine",
      "Spirits",
      "Cocktails",
      "Soft Drinks",
      "Water",
      "Desserts",
      "Coffee",
    ];
  }
  return ["Food", "Drinks", "Beer", "Soft Drinks"];
}

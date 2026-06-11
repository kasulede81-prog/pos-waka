import type {
  BusinessType,
  DiningTable,
  HospitalityFloorState,
  Sale,
  SaleLine,
  TableSession,
  TableSessionStatus,
} from "../types";
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
  { bg: string; border: string; text: string; labelKey: string }
> = {
  available: {
    bg: "bg-emerald-50",
    border: "border-emerald-400",
    text: "text-emerald-900",
    labelKey: "tableStatusAvailable",
  },
  occupied: {
    bg: "bg-amber-50",
    border: "border-amber-400",
    text: "text-amber-950",
    labelKey: "tableStatusOccupied",
  },
  payment_pending: {
    bg: "bg-red-50",
    border: "border-red-400",
    text: "text-red-950",
    labelKey: "tableStatusPaymentPending",
  },
  reserved: {
    bg: "bg-sky-50",
    border: "border-sky-400",
    text: "text-sky-950",
    labelKey: "tableStatusReserved",
  },
  disabled: {
    bg: "bg-slate-100",
    border: "border-slate-300",
    text: "text-slate-500",
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
  return { areas: [], tables: [], sessions: [], stations: [] };
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
  if (!session) return "available";
  if (session.status === "payment_pending") return "payment_pending";
  return "occupied";
}

export function syncTableDisplayStatuses(floor: HospitalityFloorState): HospitalityFloorState {
  const tables = floor.tables.map((t) => {
    const session = activeSessionForTable(floor, t.id);
    return { ...t, displayStatus: deriveTableDisplayStatus(t, session) };
  });
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
  };
}

export function closeTableSession(
  floor: HospitalityFloorState,
  sessionId: string,
  status: TableSessionStatus = "closed",
): HospitalityFloorState {
  const now = new Date().toISOString();
  const sessions = floor.sessions.map((s) =>
    s.id === sessionId ? { ...s, status, closedAt: now, updatedAt: now, pendingSync: true } : s,
  );
  return syncTableDisplayStatuses({ ...floor, sessions });
}

export function openTableSessionOnFloor(input: {
  floor: HospitalityFloorState;
  tableId: string;
  saleId: string;
  sessionId: string;
  guestCount: number;
  customerName?: string;
  customerPhone?: string;
  waiterStaffId?: string | null;
  waiterLabel?: string | null;
}): HospitalityFloorState {
  const session: TableSession = {
    id: input.sessionId,
    sessionKind: "table",
    tableId: input.tableId,
    saleId: input.saleId,
    guestCount: input.guestCount,
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

export function ensureHospitalityFloor(floor: HospitalityFloorState | undefined | null): HospitalityFloorState {
  if (!floor?.areas?.length) return defaultHospitalityFloor();
  return syncTableDisplayStatuses(floor);
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

import type { HospitalityFloorState, Sale, TableSession } from "../types";
import { activeProductionTickets } from "./kitchenProduction";
import { pendingSaleTotal, sessionDisplayLabel } from "./hospitality";

export type HospitalityDashboardStats = {
  openTables: number;
  occupiedTables: number;
  openTabs: number;
  pendingBillsUgx: number;
  pendingBillCount: number;
  kitchenQueueCount: number;
  activeWaiters: string[];
  paymentPendingCount: number;
};

export function activeSessions(floor: HospitalityFloorState): TableSession[] {
  return floor.sessions.filter((s) => s.status === "open" || s.status === "payment_pending");
}

export function tableSessions(floor: HospitalityFloorState): TableSession[] {
  return activeSessions(floor).filter((s) => s.sessionKind !== "named_tab" && s.tableId);
}

export function namedTabSessions(floor: HospitalityFloorState): TableSession[] {
  return activeSessions(floor).filter((s) => s.sessionKind === "named_tab");
}

export function computeHospitalityDashboardStats(
  floor: HospitalityFloorState,
  sales: Sale[],
): HospitalityDashboardStats {
  const active = activeSessions(floor);
  const tables = tableSessions(floor);
  const tabs = namedTabSessions(floor);
  const occupiedTableIds = new Set(
    tables.filter((s) => s.status === "open" || s.status === "payment_pending").map((s) => s.tableId),
  );
  const openTables = floor.tables.filter((t) => t.isActive && !occupiedTableIds.has(t.id)).length;

  let pendingBillsUgx = 0;
  for (const session of active) {
    const sale = sales.find((s) => s.id === session.saleId);
    pendingBillsUgx += pendingSaleTotal(sale);
  }

  const waiters = new Set<string>();
  for (const session of active) {
    const label = session.waiterLabel?.trim();
    if (label) waiters.add(label);
  }

  const kitchenQueueCount = activeProductionTickets(floor).length;
  const paymentPendingCount = active.filter((s) => s.status === "payment_pending").length;

  return {
    openTables,
    occupiedTables: occupiedTableIds.size,
    openTabs: tabs.length,
    pendingBillsUgx,
    pendingBillCount: active.length,
    kitchenQueueCount,
    activeWaiters: [...waiters],
    paymentPendingCount,
  };
}

export function sessionBillTotal(session: TableSession, sales: Sale[]): number {
  const sale = sales.find((s) => s.id === session.saleId);
  return pendingSaleTotal(sale);
}

export function sessionSubtitle(session: TableSession, sales: Sale[]): string {
  const sale = sales.find((s) => s.id === session.saleId);
  const lines = sale?.lines.length ?? 0;
  const total = pendingSaleTotal(sale);
  if (total > 0) return `${lines} items · UGX ${total.toLocaleString()}`;
  if (lines > 0) return `${lines} items`;
  return session.status === "payment_pending" ? "Bill requested" : "Open";
}

export { sessionDisplayLabel };

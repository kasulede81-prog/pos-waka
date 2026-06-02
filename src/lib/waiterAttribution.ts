import type { HospitalityFloorState, Sale, ShopPreferences, StaffAccount } from "../types";

export type WaiterAttribution = {
  waiterStaffId: string | null;
  /** Display name for reports and receipts */
  waiterName: string | null;
};

export function sessionWaiterAttribution(
  floor: HospitalityFloorState | undefined | null,
  tableSessionId: string | null | undefined,
): WaiterAttribution {
  if (!floor || !tableSessionId) {
    return { waiterStaffId: null, waiterName: null };
  }
  const session = floor.sessions.find((s) => s.id === tableSessionId);
  if (!session) {
    return { waiterStaffId: null, waiterName: null };
  }
  return {
    waiterStaffId: session.waiterStaffId ?? null,
    waiterName: session.waiterLabel?.trim() || null,
  };
}

/** Prefer persisted sale waiter fields, then table session, then closer id only. */
export function resolveSaleWaiterAttribution(
  sale: Pick<Sale, "tableSessionId" | "waiterStaffId" | "waiterName" | "soldByUserId">,
  floor: HospitalityFloorState | undefined | null,
  staffAccounts?: StaffAccount[] | null,
): WaiterAttribution & { reportKey: string; reportLabel: string } {
  const fromSession = sessionWaiterAttribution(floor, sale.tableSessionId);
  const waiterStaffId = sale.waiterStaffId ?? fromSession.waiterStaffId ?? null;
  const waiterName =
    sale.waiterName?.trim() ||
    fromSession.waiterName ||
    (waiterStaffId ? staffDisplayName(waiterStaffId, staffAccounts) : null);

  if (waiterStaffId || waiterName) {
    return {
      waiterStaffId,
      waiterName,
      reportKey: waiterStaffId ?? waiterName ?? "unknown",
      reportLabel: waiterName ?? waiterStaffId ?? "Staff",
    };
  }

  const closerId = sale.soldByUserId ?? null;
  return {
    waiterStaffId: null,
    waiterName: null,
    reportKey: closerId ?? "unknown",
    reportLabel: closerId ? staffDisplayName(closerId, staffAccounts) ?? closerId : "Staff",
  };
}

export function staffDisplayName(
  userId: string | null | undefined,
  staffAccounts?: StaffAccount[] | null,
): string | null {
  if (!userId) return null;
  const row = (staffAccounts ?? []).find((s) => s.id === userId && s.active);
  if (row?.name?.trim()) return row.name.trim();
  if (userId.startsWith("staff:")) return userId.replace(/^staff:/, "").trim() || null;
  return null;
}

export function applyWaiterToSaleFromSession(
  sale: Sale,
  floor: HospitalityFloorState | undefined | null,
  prefs: Pick<ShopPreferences, "hospitalityFloor">,
): Sale {
  const fromSession = sessionWaiterAttribution(prefs.hospitalityFloor ?? floor, sale.tableSessionId);
  if (!fromSession.waiterStaffId && !fromSession.waiterName) {
    return sale;
  }
  return {
    ...sale,
    waiterStaffId: sale.waiterStaffId ?? fromSession.waiterStaffId,
    waiterName: sale.waiterName ?? fromSession.waiterName,
  };
}

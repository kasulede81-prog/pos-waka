import type { DayCloseSummary, SyncOperation } from "../types";
import { CLOSED_BUSINESS_DATE_ERROR, isBusinessDateLocked, isClosedBusinessDateSyncError } from "./businessDateLock";

const parksByEntity = new Map<string, string>();

export function rpcErrorIsClosedBusinessDate(error?: string | null): boolean {
  return isClosedBusinessDateSyncError(error);
}

export function noteClosedBusinessDateRejection(dateKey: string, entityId?: string): void {
  const key = dateKey.trim();
  if (!key) return;
  if (entityId) parksByEntity.set(entityId, key);
}

export function takeClosedBusinessDatePark(
  entityId?: string,
): Pick<SyncOperation, "lastError" | "closedDateKey"> | null {
  if (!entityId) return null;
  const dateKey = parksByEntity.get(entityId);
  if (!dateKey) return null;
  parksByEntity.delete(entityId);
  return { lastError: CLOSED_BUSINESS_DATE_ERROR, closedDateKey: dateKey };
}

export function syncOpEntityId(op: Pick<SyncOperation, "payload">): string | undefined {
  const payload = op.payload && typeof op.payload === "object" ? (op.payload as Record<string, unknown>) : {};
  const id = payload.saleId ?? payload.expenseId ?? payload.adjustmentId ?? payload.returnId ?? payload.paymentId ?? payload.id;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

export function shouldSkipPendingClosedDateSync(
  dateKey: string,
  lastSyncError: string | null | undefined,
  dayCloses: DayCloseSummary[],
): boolean {
  if (!isClosedBusinessDateSyncError(lastSyncError)) return false;
  return isBusinessDateLocked(dayCloses, dateKey);
}

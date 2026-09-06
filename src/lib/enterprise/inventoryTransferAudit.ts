/**
 * IC-P2-06 — shop audit event for a successful inventory transfer operation.
 * Derives from existing pushAudit / audit_log queue. Does not mutate stock.
 */
import type { AuditLogEntry } from "../../types";

export const INVENTORY_TRANSFER_AUDIT_ACTION = "inventory_transfer" as const;
export const INVENTORY_TRANSFER_AUDIT_MAX_LINES = 24;

export type InventoryTransferAuditPhase = "dispatch" | "receive";

export type InventoryTransferAuditLine = {
  productId: string;
  productName?: string;
  quantity: number;
  destinationProductId?: string;
};

export type InventoryTransferAuditSnapshot = {
  transferId: string;
  phase: InventoryTransferAuditPhase;
  sourceShopId: string;
  destinationShopId: string;
  sourceName?: string;
  destinationName?: string;
  lines: InventoryTransferAuditLine[];
  receiveEventId?: string;
};

export type InventoryTransferMutationResult = {
  ok: boolean;
  idempotent?: boolean;
  error?: string;
};

export function inventoryTransferCorrelationId(snapshot: InventoryTransferAuditSnapshot): string {
  if (snapshot.phase === "receive") {
    return `inventory_transfer:receive:${snapshot.receiveEventId ?? snapshot.transferId}`;
  }
  return `inventory_transfer:dispatch:${snapshot.transferId}`;
}

function sanitizeLine(line: InventoryTransferAuditLine): InventoryTransferAuditLine | null {
  const productId = String(line.productId ?? "").trim();
  const quantity = Math.floor(Number(line.quantity));
  if (!productId || !Number.isFinite(quantity) || quantity <= 0) return null;
  const productName = String(line.productName ?? "").trim();
  const destinationProductId = String(line.destinationProductId ?? "").trim();
  return {
    productId,
    quantity,
    ...(productName ? { productName } : {}),
    ...(destinationProductId ? { destinationProductId } : {}),
  };
}

export function parseInventoryTransferAuditSnapshot(raw: unknown): InventoryTransferAuditSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const transferId = String(row.transferId ?? "").trim();
  const phase = row.phase === "receive" ? "receive" : row.phase === "dispatch" ? "dispatch" : null;
  if (!transferId || !phase) return undefined;
  const rawLines = Array.isArray(row.lines) ? row.lines : [];
  const lines = rawLines
    .map((item) => sanitizeLine(item as InventoryTransferAuditLine))
    .filter((item): item is InventoryTransferAuditLine => item != null);
  return {
    transferId,
    phase,
    sourceShopId: String(row.sourceShopId ?? "").trim(),
    destinationShopId: String(row.destinationShopId ?? "").trim(),
    sourceName: String(row.sourceName ?? "").trim() || undefined,
    destinationName: String(row.destinationName ?? "").trim() || undefined,
    receiveEventId: String(row.receiveEventId ?? "").trim() || undefined,
    lines,
  };
}

export function buildInventoryTransferAuditPayload(snapshot: InventoryTransferAuditSnapshot): Record<string, unknown> {
  const lines = snapshot.lines
    .map((line) => sanitizeLine(line))
    .filter((line): line is InventoryTransferAuditLine => line != null);
  const truncated = lines.length > INVENTORY_TRANSFER_AUDIT_MAX_LINES;
  const stored = truncated ? lines.slice(0, INVENTORY_TRANSFER_AUDIT_MAX_LINES) : lines;
  const totalUnits = lines.reduce((sum, line) => sum + line.quantity, 0);
  const first = stored[0];
  const productIds = stored.map((line) => line.productId);
  return {
    transferId: snapshot.transferId,
    phase: snapshot.phase,
    correlationId: inventoryTransferCorrelationId(snapshot),
    sourceShopId: snapshot.sourceShopId,
    destinationShopId: snapshot.destinationShopId,
    sourceName: snapshot.sourceName ?? "",
    destinationName: snapshot.destinationName ?? "",
    receiveEventId: snapshot.receiveEventId ?? null,
    productId: first?.productId ?? "",
    productName: first?.productName ?? "",
    productIds,
    lineCount: lines.length,
    totalUnits,
    truncated,
    lines: stored,
  };
}

export function buildInventoryTransferAuditSummary(snapshot: InventoryTransferAuditSnapshot): string {
  const payload = buildInventoryTransferAuditPayload(snapshot);
  const verb = snapshot.phase === "receive" ? "received" : "dispatched";
  const firstName = typeof payload.productName === "string" && payload.productName ? payload.productName : "product";
  const source = snapshot.sourceName?.trim() || snapshot.sourceShopId || "source";
  const dest = snapshot.destinationName?.trim() || snapshot.destinationShopId || "destination";
  if (Number(payload.lineCount) <= 1) {
    return `Inventory transfer ${verb} · ${firstName}: ${payload.totalUnits} · ${source} → ${dest}`;
  }
  return `Inventory transfer ${verb} · ${payload.lineCount} lines · ${payload.totalUnits} units · ${source} → ${dest}`;
}

export function hasInventoryTransferAudit(
  logs: readonly AuditLogEntry[],
  snapshot: InventoryTransferAuditSnapshot,
): boolean {
  const correlationId = inventoryTransferCorrelationId(snapshot);
  return logs.some(
    (entry) =>
      entry.action === INVENTORY_TRANSFER_AUDIT_ACTION &&
      typeof entry.payload?.correlationId === "string" &&
      entry.payload.correlationId === correlationId,
  );
}

export function shouldWriteInventoryTransferAudit(
  result: InventoryTransferMutationResult,
  snapshot: InventoryTransferAuditSnapshot | undefined,
  existingLogs: readonly AuditLogEntry[],
): snapshot is InventoryTransferAuditSnapshot {
  if (!result.ok || result.idempotent === true) return false;
  if (!snapshot?.transferId) return false;
  if (snapshot.phase === "receive" && !snapshot.receiveEventId) return false;
  return !hasInventoryTransferAudit(existingLogs, snapshot);
}

export type InventoryTransferAuditWriter = (
  action: typeof INVENTORY_TRANSFER_AUDIT_ACTION,
  summary: string,
  payload: Record<string, unknown>,
) => void;

export function recordInventoryTransferAuditIfSucceeded(
  result: InventoryTransferMutationResult,
  snapshot: InventoryTransferAuditSnapshot | undefined,
  deps: {
    writeAudit: InventoryTransferAuditWriter;
    existingLogs: readonly AuditLogEntry[];
  },
): boolean {
  if (!shouldWriteInventoryTransferAudit(result, snapshot, deps.existingLogs)) return false;
  deps.writeAudit(
    INVENTORY_TRANSFER_AUDIT_ACTION,
    buildInventoryTransferAuditSummary(snapshot),
    buildInventoryTransferAuditPayload(snapshot),
  );
  return true;
}

/**
 * Inventory count sessions — variance math, permissions, and apply helpers.
 */

import type {
  InventoryCountLine,
  InventoryCountSession,
  InventoryCountSessionStatus,
  Product,
  StockMovement,
  UserRole,
} from "../types";
import { stableInventoryMovementId } from "./inventoryIntegrity";

export type InventoryCountPermission =
  | "create"
  | "count"
  | "submit"
  | "approve"
  | "apply"
  | "cancel"
  | "view";

const COUNT_ROLES_CREATE = new Set<UserRole>(["owner", "manager", "cashier", "supervisor", "stock_keeper"]);

export function canInventoryCount(role: UserRole, perm: InventoryCountPermission): boolean {
  switch (perm) {
    case "view":
      return COUNT_ROLES_CREATE.has(role) || role === "waiter";
    case "create":
    case "count":
      return COUNT_ROLES_CREATE.has(role);
    case "submit":
    case "approve":
      return role === "owner" || role === "manager" || role === "supervisor";
    case "apply":
    case "cancel":
      return role === "owner";
    default:
      return false;
  }
}

export function nextInventoryCountSessionNumber(sessions: InventoryCountSession[]): number {
  let max = 0;
  for (const s of sessions) {
    if (s.sessionNumber > max) max = s.sessionNumber;
  }
  return max + 1;
}

export function computeInventoryCountLineVariance(input: {
  expectedQtySnapshot: number;
  countedQty: number;
  costPricePerUnitUgx: number;
  sellingPricePerUnitUgx: number;
}): Pick<InventoryCountLine, "varianceQty" | "varianceCostUgx" | "varianceRetailUgx"> {
  const varianceQty = Math.round((input.countedQty - input.expectedQtySnapshot) * 10000) / 10000;
  const cost = Math.max(0, Math.floor(input.costPricePerUnitUgx));
  const sell = Math.max(0, Math.floor(input.sellingPricePerUnitUgx));
  return {
    varianceQty,
    varianceCostUgx: Math.round(varianceQty * cost),
    varianceRetailUgx: Math.round(varianceQty * sell),
  };
}

export function buildInventoryCountSnapshotLines(
  sessionId: string,
  products: Product[],
  at: string,
): InventoryCountLine[] {
  return products.map((p) => {
    const expected = Math.max(0, Number(p.stockOnHand) || 0);
    const variance = computeInventoryCountLineVariance({
      expectedQtySnapshot: expected,
      countedQty: expected,
      costPricePerUnitUgx: p.costPricePerUnitUgx,
      sellingPricePerUnitUgx: p.sellingPricePerUnitUgx,
    });
    return {
      id: crypto.randomUUID(),
      sessionId,
      productId: p.id,
      productName: p.name,
      expectedQtySnapshot: expected,
      countedQty: null,
      ...variance,
      reason: "",
      updatedAt: at,
    };
  });
}

export function withInventoryCountLineCounted(
  line: InventoryCountLine,
  countedQty: number,
  product: Product,
  reason: string,
): InventoryCountLine {
  const qty = Math.max(0, Number(countedQty) || 0);
  const variance = computeInventoryCountLineVariance({
    expectedQtySnapshot: line.expectedQtySnapshot,
    countedQty: qty,
    costPricePerUnitUgx: product.costPricePerUnitUgx,
    sellingPricePerUnitUgx: product.sellingPricePerUnitUgx,
  });
  return {
    ...line,
    countedQty: qty,
    ...variance,
    reason: reason.trim(),
    productName: product.name,
    updatedAt: new Date().toISOString(),
  };
}

export function inventoryCountLineHasStockDrift(
  line: InventoryCountLine,
  product: Product | undefined,
): boolean {
  if (!product) return false;
  const current = Math.max(0, Number(product.stockOnHand) || 0);
  return Math.abs(current - line.expectedQtySnapshot) > 1e-6;
}

export function sessionHasStockDrift(session: InventoryCountSession, products: Product[]): boolean {
  const byId = new Map(products.map((p) => [p.id, p]));
  return session.lines.some((ln) => inventoryCountLineHasStockDrift(ln, byId.get(ln.productId)));
}

export function inventoryCountMovementId(shopKey: string, sessionId: string, productId: string): string {
  return stableInventoryMovementId(shopKey, "inventory_count", sessionId, productId);
}

export type InventoryCountApplyLine = {
  line: InventoryCountLine;
  movement: StockMovement;
  targetStockOnHand: number;
  stockDelta: number;
};

export function buildInventoryCountApplyPlan(input: {
  shopKey: string;
  session: InventoryCountSession;
  products: Product[];
  existingMovements: StockMovement[];
  at: string;
}): { lines: InventoryCountApplyLine[]; skippedProductIds: string[] } {
  if (input.session.status !== "approved") {
    return { lines: [], skippedProductIds: [] };
  }

  const appliedRef = input.session.id;
  const alreadyApplied = new Set(
    input.existingMovements
      .filter((m) => m.refId === appliedRef && m.kind === "inventory_count_variance")
      .map((m) => m.productId),
  );

  const productById = new Map(input.products.map((p) => [p.id, p]));
  const lines: InventoryCountApplyLine[] = [];
  const skippedProductIds: string[] = [];

  for (const line of input.session.lines) {
    if (line.countedQty == null) continue;
    if (alreadyApplied.has(line.productId)) {
      skippedProductIds.push(line.productId);
      continue;
    }
    const product = productById.get(line.productId);
    if (!product) continue;

    const countedQty = Math.max(0, line.countedQty);
    const currentStock = Math.max(0, Number(product.stockOnHand) || 0);
    const targetStockOnHand = countedQty;
    const stockDelta = targetStockOnHand - currentStock;
    const movementDelta = line.varianceQty;

    if (Math.abs(movementDelta) < 1e-6 && Math.abs(stockDelta) < 1e-6) continue;

    const movement: StockMovement = {
      id: inventoryCountMovementId(input.shopKey, input.session.id, line.productId),
      at: input.at,
      productId: line.productId,
      productName: product.name,
      deltaBaseUnits: movementDelta,
      kind: "inventory_count_variance",
      summary: `Count #${input.session.sessionNumber} ${movementDelta >= 0 ? "+" : ""}${movementDelta}`,
      refId: input.session.id,
      supplierId: null,
    };

    lines.push({ line, movement, targetStockOnHand, stockDelta });
  }

  return { lines, skippedProductIds };
}

export function isInventoryCountSessionMutable(status: InventoryCountSessionStatus): boolean {
  return status === "draft" || status === "counting";
}

export function canTransitionInventoryCountStatus(
  from: InventoryCountSessionStatus,
  to: InventoryCountSessionStatus,
): boolean {
  if (from === "applied" || from === "cancelled") return false;
  if (to === "cancelled") return true;
  const order: InventoryCountSessionStatus[] = ["draft", "counting", "submitted", "approved", "applied"];
  const fromIdx = order.indexOf(from);
  const toIdx = order.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return false;
  return toIdx === fromIdx + 1;
}

export type InventoryCountVarianceReport = {
  sessionId: string;
  sessionNumber: number;
  appliedAt: string | null;
  productsCounted: number;
  missingQty: number;
  excessQty: number;
  totalVarianceQty: number;
  varianceCostUgx: number;
  varianceRetailUgx: number;
  lines: InventoryCountLine[];
};

export function buildInventoryCountVarianceReport(session: InventoryCountSession): InventoryCountVarianceReport {
  const countedLines = session.lines.filter((l) => l.countedQty != null);
  let missingQty = 0;
  let excessQty = 0;
  let totalVarianceQty = 0;
  let varianceCostUgx = 0;
  let varianceRetailUgx = 0;

  for (const ln of countedLines) {
    if (ln.varianceQty < 0) missingQty += Math.abs(ln.varianceQty);
    if (ln.varianceQty > 0) excessQty += ln.varianceQty;
    totalVarianceQty += ln.varianceQty;
    varianceCostUgx += ln.varianceCostUgx;
    varianceRetailUgx += ln.varianceRetailUgx;
  }

  return {
    sessionId: session.id,
    sessionNumber: session.sessionNumber,
    appliedAt: session.appliedAt,
    productsCounted: countedLines.length,
    missingQty,
    excessQty,
    totalVarianceQty,
    varianceCostUgx,
    varianceRetailUgx,
    lines: countedLines,
  };
}

export function normalizeInventoryCountSession(raw: InventoryCountSession): InventoryCountSession {
  return {
    ...raw,
    notes: raw.notes ?? "",
    pendingSync: raw.pendingSync === true,
    lines: (raw.lines ?? []).map(normalizeInventoryCountLine),
  };
}

export function normalizeInventoryCountLine(raw: InventoryCountLine): InventoryCountLine {
  const expected = Math.max(0, Number(raw.expectedQtySnapshot) || 0);
  const counted = raw.countedQty == null ? null : Math.max(0, Number(raw.countedQty) || 0);
  const varianceQty =
    counted == null ? Number(raw.varianceQty) || 0 : Math.round((counted - expected) * 10000) / 10000;
  return {
    ...raw,
    expectedQtySnapshot: expected,
    countedQty: counted,
    varianceQty,
    varianceCostUgx: Math.round(Number(raw.varianceCostUgx) || 0),
    varianceRetailUgx: Math.round(Number(raw.varianceRetailUgx) || 0),
    reason: raw.reason ?? "",
    productName: raw.productName ?? "",
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

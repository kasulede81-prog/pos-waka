import { describe, expect, it, beforeEach } from "vitest";
import type { InventoryCountLine, InventoryCountSession, Product, StockMovement } from "../types";
import {
  buildInventoryCountApplyPlan,
  buildInventoryCountSnapshotLines,
  canInventoryCount,
  canTransitionInventoryCountStatus,
  computeInventoryCountLineVariance,
  inventoryCountMovementId,
  normalizeInventoryCountSession,
  sessionHasStockDrift,
  withInventoryCountLineCounted,
} from "./inventoryCount";
import { createDefaultPreferences } from "../data/defaultSeed";
import { snapshotFromPartial } from "../offline/backupEngine";
import { createInventoryCountStoreActions } from "../store/inventoryCountMutations";

const PRODUCT_ID = "prod-1";
const SESSION_ID = "session-1";
const SHOP_KEY = "local:test";

function product(stockOnHand: number): Product {
  return {
    id: PRODUCT_ID,
    name: "Widget",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 6_000,
    stockOnHand,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 5,
    updatedAt: "2026-06-01T09:00:00.000Z",
    version: 1,
  };
}

function session(partial: Partial<InventoryCountSession>): InventoryCountSession {
  return normalizeInventoryCountSession({
    id: SESSION_ID,
    sessionNumber: 1,
    status: "approved",
    startedAt: "2026-06-01T10:00:00.000Z",
    startedBy: "owner",
    submittedAt: null,
    submittedBy: null,
    approvedAt: "2026-06-01T12:00:00.000Z",
    approvedBy: "owner",
    appliedAt: null,
    appliedBy: null,
    snapshotCreatedAt: "2026-06-01T10:00:00.000Z",
    notes: "",
    lines: [],
    pendingSync: false,
    updatedAt: "2026-06-01T12:00:00.000Z",
    ...partial,
  });
}

describe("inventoryCount — variance calculation", () => {
  it("uses snapshot not current stock for variance", () => {
    const v = computeInventoryCountLineVariance({
      expectedQtySnapshot: 100,
      countedQty: 94,
      costPricePerUnitUgx: 6_000,
      sellingPricePerUnitUgx: 10_000,
    });
    expect(v.varianceQty).toBe(-6);
    expect(v.varianceCostUgx).toBe(-36_000);
    expect(v.varianceRetailUgx).toBe(-60_000);
  });

  it("withInventoryCountLineCounted preserves snapshot baseline", () => {
    const line: InventoryCountLine = {
      id: "l1",
      sessionId: SESSION_ID,
      productId: PRODUCT_ID,
      expectedQtySnapshot: 100,
      countedQty: null,
      varianceQty: 0,
      varianceCostUgx: 0,
      varianceRetailUgx: 0,
      reason: "",
      updatedAt: "2026-06-01T10:00:00.000Z",
    };
    const updated = withInventoryCountLineCounted(line, 94, product(92), "shelf");
    expect(updated.expectedQtySnapshot).toBe(100);
    expect(updated.varianceQty).toBe(-6);
    expect(updated.countedQty).toBe(94);
  });
});

describe("inventoryCount — acceptance scenario", () => {
  it("apply sets stock to counted qty with variance movement from snapshot", () => {
    const line = withInventoryCountLineCounted(
      {
        id: "l1",
        sessionId: SESSION_ID,
        productId: PRODUCT_ID,
        expectedQtySnapshot: 100,
        countedQty: null,
        varianceQty: 0,
        varianceCostUgx: 0,
        varianceRetailUgx: 0,
        reason: "",
        updatedAt: "2026-06-01T10:00:00.000Z",
      },
      94,
      product(92),
      "",
    );

    const plan = buildInventoryCountApplyPlan({
      shopKey: SHOP_KEY,
      session: session({ lines: [line] }),
      products: [product(92)],
      existingMovements: [],
      at: "2026-06-01T13:00:00.000Z",
    });

    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]!.targetStockOnHand).toBe(94);
    expect(plan.lines[0]!.stockDelta).toBe(2);
    expect(plan.lines[0]!.movement.deltaBaseUnits).toBe(-6);
    expect(plan.lines[0]!.movement.kind).toBe("inventory_count_variance");
  });
});

describe("inventoryCount — approval flow", () => {
  it("allows draft → counting → submitted → approved → applied", () => {
    expect(canTransitionInventoryCountStatus("draft", "counting")).toBe(true);
    expect(canTransitionInventoryCountStatus("counting", "submitted")).toBe(true);
    expect(canTransitionInventoryCountStatus("submitted", "approved")).toBe(true);
    expect(canTransitionInventoryCountStatus("approved", "applied")).toBe(true);
    expect(canTransitionInventoryCountStatus("draft", "applied")).toBe(false);
  });

  it("role permissions match sprint matrix", () => {
    expect(canInventoryCount("owner", "apply")).toBe(true);
    expect(canInventoryCount("manager", "apply")).toBe(false);
    expect(canInventoryCount("manager", "approve")).toBe(true);
    expect(canInventoryCount("cashier", "submit")).toBe(false);
    expect(canInventoryCount("cashier", "count")).toBe(true);
  });
});

describe("inventoryCount — double apply prevention", () => {
  it("skips products that already have count movements for session", () => {
    const line = withInventoryCountLineCounted(
      {
        id: "l1",
        sessionId: SESSION_ID,
        productId: PRODUCT_ID,
        expectedQtySnapshot: 100,
        countedQty: null,
        varianceQty: 0,
        varianceCostUgx: 0,
        varianceRetailUgx: 0,
        reason: "",
        updatedAt: "2026-06-01T10:00:00.000Z",
      },
      94,
      product(100),
      "",
    );

    const existing: StockMovement[] = [
      {
        id: inventoryCountMovementId(SHOP_KEY, SESSION_ID, PRODUCT_ID),
        at: "2026-06-01T13:00:00.000Z",
        productId: PRODUCT_ID,
        productName: "Widget",
        deltaBaseUnits: -6,
        kind: "inventory_count_variance",
        summary: "Count #1 -6",
        refId: SESSION_ID,
        supplierId: null,
      },
    ];

    const plan = buildInventoryCountApplyPlan({
      shopKey: SHOP_KEY,
      session: session({ lines: [line] }),
      products: [product(94)],
      existingMovements: existing,
      at: "2026-06-01T14:00:00.000Z",
    });

    expect(plan.lines).toHaveLength(0);
    expect(plan.skippedProductIds).toContain(PRODUCT_ID);
  });
});

describe("inventoryCount — stock drift detection", () => {
  it("detects when current stock differs from snapshot", () => {
    const lines = buildInventoryCountSnapshotLines(SESSION_ID, [product(100)], "2026-06-01T10:00:00.000Z");
    const sess = session({ status: "submitted", lines });
    expect(sessionHasStockDrift(sess, [product(92)])).toBe(true);
    expect(sessionHasStockDrift(sess, [product(100)])).toBe(false);
  });
});

describe("inventoryCount — backup round-trip", () => {
  it("snapshotFromPartial preserves inventory count sessions", () => {
    const sess = session({
      status: "applied",
      lines: buildInventoryCountSnapshotLines(SESSION_ID, [product(5)], "2026-06-01T10:00:00.000Z"),
    });
    const snap = snapshotFromPartial({
      products: [product(5)],
      customers: [],
      sales: [],
      preferences: createDefaultPreferences(),
      inventoryCountSessions: [sess],
    });
    expect(snap?.inventoryCountSessions).toHaveLength(1);
    expect(snap?.inventoryCountSessions?.[0]?.id).toBe(SESSION_ID);
  });
});

describe("inventoryCount — store mutations audit", () => {
  let auditActions: string[] = [];
  let state: {
    products: Product[];
    inventoryCountSessions: InventoryCountSession[];
    stockMovements: StockMovement[];
    archivedStockMovements: StockMovement[];
    sessionActor: { userId: string; displayName: string; role: "owner" };
  };

  beforeEach(() => {
    auditActions = [];
    state = {
      products: [product(100)],
      inventoryCountSessions: [],
      stockMovements: [],
      archivedStockMovements: [],
      sessionActor: { userId: "owner", displayName: "Owner", role: "owner" },
    };
  });

  const actions = () =>
    createInventoryCountStoreActions({
      get: () => state as never,
      set: (partial) => {
        const patch = typeof partial === "function" ? partial(state as never) : partial;
        Object.assign(state, patch);
      },
      pushAudit: (action) => {
        auditActions.push(action);
      },
      queueRemote: () => {},
      movementMergePatch: (s, incoming) => {
        const byId = new Map(s.stockMovements.map((m) => [m.id, m]));
        for (const m of incoming) byId.set(m.id, m);
        return { stockMovements: [...byId.values()], archivedStockMovements: s.archivedStockMovements ?? [] };
      },
    });

  it("creates audit trail through workflow", () => {
    const a = actions();
    const created = a.createInventoryCountSession("monthly");
    expect(created.ok).toBe(true);
    const id = created.sessionId!;
    a.startInventoryCountSession(id);
    a.setInventoryCountLine(id, PRODUCT_ID, 94);
    a.submitInventoryCountSession(id);
    a.approveInventoryCountSession(id);
    state.products = [product(92)];
    const applied = a.applyInventoryCountSession(id);
    expect(applied.ok).toBe(true);
    expect(state.products[0]!.stockOnHand).toBe(94);
    expect(auditActions).toContain("inventory_count_started");
    expect(auditActions).toContain("inventory_count_submitted");
    expect(auditActions).toContain("inventory_count_approved");
    expect(auditActions).toContain("inventory_count_applied");
    expect(a.applyInventoryCountSession(id).ok).toBe(false);
  });
});

/**
 * Inventory count workflow roles and hand-offs.
 *
 * Counter (stock.count) → submit → approver (stock.adjust + back-office) →
 * approve → owner (settings.shop) → apply to the shared stock ledger.
 *
 * Every stage is checked again inside the store action. Unauthorized calls must
 * leave sessions, stock, audit logs and the sync queue untouched.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type {
  AuditAction,
  InventoryCountSession,
  Permission,
  Product,
  StockMovement,
  SyncOperationKind,
  UserRole,
} from "../types";
import type { SessionActor } from "./sessionActor";
import { canInventoryCount } from "./inventoryCount";
import { inventoryCountHandoffStage } from "./countWorkspace";
import { t } from "./i18n";
import { createInventoryCountStoreActions } from "../store/inventoryCountMutations";

const PRODUCT_ID = "retail-1";

function retailProduct(stockOnHand = 100): Product {
  return {
    id: PRODUCT_ID,
    name: "Retail widget",
    sellingMode: "unit",
    baseUnit: "pcs",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 6_000,
    stockOnHand,
    minimumStockAlert: 5,
    category: "General",
    sku: "",
    updatedAt: "2026-10-20T08:00:00.000Z",
    version: 1,
  };
}

function actor(role: UserRole, permissions?: Permission[]): SessionActor {
  return {
    userId: `${role}:1`,
    role,
    displayName: role,
    ...(permissions ? { permissions } : {}),
  };
}

type TestState = {
  products: Product[];
  inventoryCountSessions: InventoryCountSession[];
  stockMovements: StockMovement[];
  archivedStockMovements: StockMovement[];
  sessionActor: SessionActor | null;
};

let state: TestState;
let auditActions: AuditAction[];
let queueCalls: Array<{ kind: SyncOperationKind; payload: unknown }>;

function reset(role: UserRole, permissions?: Permission[]) {
  auditActions = [];
  queueCalls = [];
  state = {
    products: [retailProduct()],
    inventoryCountSessions: [],
    stockMovements: [],
    archivedStockMovements: [],
    sessionActor: actor(role, permissions),
  };
}

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
    queueRemote: (kind, payload) => {
      queueCalls.push({ kind, payload });
    },
    movementMergePatch: (s, incoming) => {
      const byId = new Map(s.stockMovements.map((movement) => [movement.id, movement]));
      for (const movement of incoming) byId.set(movement.id, movement);
      return {
        stockMovements: [...byId.values()],
        archivedStockMovements: s.archivedStockMovements ?? [],
      };
    },
  });

const session = (id: string) => state.inventoryCountSessions.find((row) => row.id === id)!;
const setActor = (role: UserRole, permissions?: Permission[]) => {
  state.sessionActor = actor(role, permissions);
};

function countAndSubmit(a: ReturnType<typeof actions>): string {
  const created = a.createInventoryCountSession("monthly");
  expect(created.ok).toBe(true);
  const id = created.sessionId!;
  expect(a.startInventoryCountSession(id).ok).toBe(true);
  expect(a.setInventoryCountLine(id, PRODUCT_ID, 94).ok).toBe(true);
  expect(a.submitInventoryCountSession(id).ok).toBe(true);
  return id;
}

describe("inventory count hand-off stages", () => {
  it("maps the current actor to the next actionable or waiting stage", () => {
    expect(
      inventoryCountHandoffStage({ status: "counting", canSubmit: true, canApprove: false, canApply: false }),
    ).toBe("submit");
    expect(
      inventoryCountHandoffStage({ status: "counting", canSubmit: false, canApprove: false, canApply: false }),
    ).toBe("awaiting_submit");
    expect(
      inventoryCountHandoffStage({ status: "submitted", canSubmit: false, canApprove: true, canApply: false }),
    ).toBe("approve");
    expect(
      inventoryCountHandoffStage({ status: "submitted", canSubmit: false, canApprove: false, canApply: false }),
    ).toBe("awaiting_approval");
    expect(
      inventoryCountHandoffStage({ status: "approved", canSubmit: false, canApprove: false, canApply: true }),
    ).toBe("apply");
    expect(
      inventoryCountHandoffStage({ status: "approved", canSubmit: false, canApprove: false, canApply: false }),
    ).toBe("awaiting_apply");
    expect(
      inventoryCountHandoffStage({ status: "applied", canSubmit: false, canApprove: false, canApply: false }),
    ).toBe("complete");
    expect(
      inventoryCountHandoffStage({ status: "draft", canSubmit: true, canApprove: false, canApply: false }),
    ).toBeNull();
    expect(
      inventoryCountHandoffStage({ status: "cancelled", canSubmit: false, canApprove: false, canApply: false }),
    ).toBeNull();
  });
});

describe("stock count role hand-off through the shared ledger", () => {
  beforeEach(() => reset("cashier"));

  it("lets the counter submit, the manager approve, and the owner apply", () => {
    const a = actions();
    const id = countAndSubmit(a);

    expect(session(id)).toMatchObject({
      status: "submitted",
      submittedBy: "cashier:1",
      pendingSync: true,
    });
    expect(auditActions).toContain("inventory_count_started");
    expect(auditActions).toContain("inventory_count_submitted");
    expect(auditActions).not.toContain("inventory_count_approved");
    expect(auditActions).not.toContain("inventory_count_applied");
    expect(queueCalls.filter((call) => call.kind === "pending_inventory_counts")).toHaveLength(4);

    // Manager review stage.
    setActor("manager");
    expect(a.approveInventoryCountSession(id).ok).toBe(true);
    expect(session(id)).toMatchObject({ status: "approved", approvedBy: "manager:1", pendingSync: true });
    expect(auditActions).toContain("inventory_count_approved");

    // Applying stays owner-only: a manager's attempt changes nothing.
    const beforeDenied = {
      stock: state.products[0]!.stockOnHand,
      status: session(id).status,
      movements: state.stockMovements.length,
      audit: auditActions.length,
      queue: queueCalls.length,
    };
    expect(a.applyInventoryCountSession(id)).toEqual({ ok: false, errorKey: "auth_forbidden" });
    expect(state.products[0]!.stockOnHand).toBe(beforeDenied.stock);
    expect(session(id).status).toBe(beforeDenied.status);
    expect(state.stockMovements).toHaveLength(beforeDenied.movements);
    expect(auditActions).toHaveLength(beforeDenied.audit);
    expect(queueCalls).toHaveLength(beforeDenied.queue);

    // Owner applies the approved count to the canonical retail stock ledger.
    setActor("owner");
    const applied = a.applyInventoryCountSession(id);
    expect(applied).toEqual({ ok: true, movementCount: 1 });
    expect(state.products[0]).toMatchObject({ stockOnHand: 94, category: "General" });
    expect(state.products[0]!.menu).toBeUndefined();
    expect(session(id)).toMatchObject({ status: "applied", appliedBy: "owner:1", pendingSync: true });

    const movement = state.stockMovements.find((row) => row.kind === "inventory_count_variance")!;
    expect(movement).toMatchObject({
      productId: PRODUCT_ID,
      deltaBaseUnits: -6,
      refId: id,
    });
    expect(auditActions).toContain("inventory_count_applied");
    const stockPush = queueCalls.find((call) => call.kind === "pending_stock_updates");
    expect(stockPush).toBeDefined();
    expect(stockPush!.payload).toMatchObject({
      productId: PRODUCT_ID,
      delta: -6,
      referenceId: id,
    });

    // Re-applying is rejected and does not duplicate stock, movements or sync.
    const afterApply = {
      stock: state.products[0]!.stockOnHand,
      movements: state.stockMovements.length,
      queue: queueCalls.length,
      audit: auditActions.length,
    };
    expect(a.applyInventoryCountSession(id)).toEqual({ ok: false, errorKey: "invalid" });
    expect(state.products[0]!.stockOnHand).toBe(afterApply.stock);
    expect(state.stockMovements).toHaveLength(afterApply.movements);
    expect(queueCalls).toHaveLength(afterApply.queue);
    expect(auditActions).toHaveLength(afterApply.audit);
  });

  it("keeps approval and application separate across default roles", () => {
    const a = actions();
    const id = countAndSubmit(a);

    setActor("cashier");
    expect(a.approveInventoryCountSession(id)).toMatchObject({ ok: false, errorKey: "auth_forbidden" });
    setActor("stock_keeper");
    expect(a.approveInventoryCountSession(id)).toMatchObject({ ok: false, errorKey: "auth_forbidden" });
    setActor("supervisor");
    expect(a.approveInventoryCountSession(id).ok).toBe(true);

    // Supervisor approved but cannot apply; only the owner can.
    expect(a.applyInventoryCountSession(id)).toMatchObject({ ok: false, errorKey: "auth_forbidden" });
    setActor("owner");
    expect(a.applyInventoryCountSession(id).ok).toBe(true);
  });

  it("leaves sessions, stock, audit logs and the sync queue untouched for unauthorized actions", () => {
    const a = actions();
    const id = countAndSubmit(a);
    setActor("manager");
    expect(a.approveInventoryCountSession(id).ok).toBe(true);

    const snapshot = {
      products: JSON.stringify(state.products),
      sessions: JSON.stringify(state.inventoryCountSessions),
      movements: JSON.stringify(state.stockMovements),
      audit: auditActions.length,
      queue: queueCalls.length,
    };

    setActor("cashier");
    expect(a.approveInventoryCountSession(id)).toMatchObject({ ok: false, errorKey: "auth_forbidden" });
    expect(a.applyInventoryCountSession(id)).toMatchObject({ ok: false, errorKey: "auth_forbidden" });
    expect(a.cancelInventoryCountSession(id)).toMatchObject({ ok: false, errorKey: "auth_forbidden" });

    setActor("stock_keeper");
    expect(a.approveInventoryCountSession(id)).toMatchObject({ ok: false, errorKey: "auth_forbidden" });
    expect(a.applyInventoryCountSession(id)).toMatchObject({ ok: false, errorKey: "auth_forbidden" });

    setActor("manager");
    expect(a.applyInventoryCountSession(id)).toMatchObject({ ok: false, errorKey: "auth_forbidden" });
    expect(a.cancelInventoryCountSession(id)).toMatchObject({ ok: false, errorKey: "auth_forbidden" });

    setActor("waiter");
    expect(a.createInventoryCountSession()).toMatchObject({ ok: false, errorKey: "auth_forbidden" });
    expect(a.startInventoryCountSession(id)).toMatchObject({ ok: false, errorKey: "auth_forbidden" });
    expect(a.setInventoryCountLine(id, PRODUCT_ID, 1)).toMatchObject({ ok: false, errorKey: "auth_forbidden" });
    expect(a.submitInventoryCountSession(id)).toMatchObject({ ok: false, errorKey: "auth_forbidden" });
    expect(a.approveInventoryCountSession(id)).toMatchObject({ ok: false, errorKey: "auth_forbidden" });
    expect(a.applyInventoryCountSession(id)).toMatchObject({ ok: false, errorKey: "auth_forbidden" });
    expect(a.cancelInventoryCountSession(id)).toMatchObject({ ok: false, errorKey: "auth_forbidden" });

    expect(JSON.stringify(state.products)).toBe(snapshot.products);
    expect(JSON.stringify(state.inventoryCountSessions)).toBe(snapshot.sessions);
    expect(JSON.stringify(state.stockMovements)).toBe(snapshot.movements);
    expect(auditActions).toHaveLength(snapshot.audit);
    expect(queueCalls).toHaveLength(snapshot.queue);
  });
});

describe("permission matrix for the count stages", () => {
  it("allows counter submit without granting approval or apply", () => {
    expect(canInventoryCount("cashier", "submit")).toBe(true);
    expect(canInventoryCount("stock_keeper", "submit")).toBe(true);
    expect(canInventoryCount("cashier", "approve")).toBe(false);
    expect(canInventoryCount("stock_keeper", "approve")).toBe(false);
    expect(canInventoryCount("cashier", "apply")).toBe(false);
    expect(canInventoryCount("stock_keeper", "apply")).toBe(false);

    expect(canInventoryCount("manager", "approve")).toBe(true);
    expect(canInventoryCount("supervisor", "approve")).toBe(true);
    expect(canInventoryCount("manager", "apply")).toBe(false);
    expect(canInventoryCount("supervisor", "apply")).toBe(false);
    expect(canInventoryCount("owner", "apply")).toBe(true);
  });

  it("resolves every hand-off message in all three languages", () => {
    for (const lang of ["en", "lg", "sw"] as const) {
      for (const stage of [
        "submit",
        "awaiting_submit",
        "approve",
        "awaiting_approval",
        "apply",
        "awaiting_apply",
      ]) {
        const key = `inventoryCountHandoff_${stage}`;
        expect(t(lang, key), `${lang}.${key}`).not.toBe(key);
      }
    }
  });
});

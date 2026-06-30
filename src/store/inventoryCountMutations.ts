/**
 * Inventory count session store mutations — imported into usePosStore.
 */

import type { InventoryCountSession, Product, StockMovement } from "../types";
import { getActiveAccountKey } from "../offline/accountScope";
import {
  buildInventoryCountApplyPlan,
  buildInventoryCountSnapshotLines,
  canInventoryCount,
  canTransitionInventoryCountStatus,
  normalizeInventoryCountSession,
  withInventoryCountLineCounted,
  nextInventoryCountSessionNumber,
} from "../lib/inventoryCount";
import { emitInventoryStockChanges } from "../lib/inventorySyncChannel";
import type { PosState } from "./usePosStore";

type StoreGet = () => PosState;
type StoreSet = (partial: Partial<PosState> | ((s: PosState) => Partial<PosState>)) => void;

type Deps = {
  get: StoreGet;
  set: StoreSet;
  pushAudit: (
    action: import("../types").AuditAction,
    summary: string,
    payload: Record<string, unknown>,
  ) => void;
  queueRemote: (kind: import("../types").SyncOperationKind, payload: unknown) => void;
  movementMergePatch: (
    state: Pick<PosState, "stockMovements" | "archivedStockMovements">,
    incoming: StockMovement[],
  ) => Pick<PosState, "stockMovements" | "archivedStockMovements">;
};

function actorOrFail(get: StoreGet): { userId: string; displayName: string; role: import("../types").UserRole } | null {
  const actor = get().sessionActor;
  if (!actor) return null;
  return { userId: actor.userId, displayName: actor.displayName ?? actor.userId, role: actor.role };
}

function findSession(get: StoreGet, sessionId: string): InventoryCountSession | undefined {
  return get().inventoryCountSessions.find((s) => s.id === sessionId);
}

function patchSession(set: StoreSet, sessionId: string, patch: Partial<InventoryCountSession>): void {
  set((s) => ({
    inventoryCountSessions: s.inventoryCountSessions.map((row) =>
      row.id === sessionId
        ? normalizeInventoryCountSession({ ...row, ...patch, updatedAt: new Date().toISOString(), pendingSync: true })
        : row,
    ),
  }));
}

export function createInventoryCountStoreActions(deps: Deps) {
  const { get, set, pushAudit, queueRemote, movementMergePatch } = deps;

  return {
    createInventoryCountSession: (notes?: string) => {
      const actor = actorOrFail(get);
      if (!actor) return { ok: false as const, errorKey: "noSelection" };
      if (!canInventoryCount(actor.role, "create")) return { ok: false as const, errorKey: "auth_forbidden" };

      const at = new Date().toISOString();
      const session: InventoryCountSession = normalizeInventoryCountSession({
        id: crypto.randomUUID(),
        sessionNumber: nextInventoryCountSessionNumber(get().inventoryCountSessions),
        status: "draft",
        startedAt: null,
        startedBy: null,
        submittedAt: null,
        submittedBy: null,
        approvedAt: null,
        approvedBy: null,
        appliedAt: null,
        appliedBy: null,
        snapshotCreatedAt: null,
        notes: (notes ?? "").trim(),
        lines: [],
        pendingSync: true,
        updatedAt: at,
      });

      set((s) => ({ inventoryCountSessions: [session, ...s.inventoryCountSessions] }));
      void queueRemote("pending_inventory_counts", { sessionId: session.id });
      return { ok: true as const, sessionId: session.id };
    },

    startInventoryCountSession: (sessionId: string) => {
      const actor = actorOrFail(get);
      if (!actor) return { ok: false as const, errorKey: "noSelection" };
      if (!canInventoryCount(actor.role, "count")) return { ok: false as const, errorKey: "auth_forbidden" };

      const session = findSession(get, sessionId);
      if (!session) return { ok: false as const, errorKey: "invalid" };
      if (!canTransitionInventoryCountStatus(session.status, "counting")) {
        return { ok: false as const, errorKey: "invalid" };
      }

      const at = new Date().toISOString();
      const lines = buildInventoryCountSnapshotLines(sessionId, get().products, at);

      patchSession(set, sessionId, {
        status: "counting",
        startedAt: at,
        startedBy: actor.userId,
        startedByName: actor.displayName,
        snapshotCreatedAt: at,
        lines,
      });

      pushAudit("inventory_count_started", `Stock count #${session.sessionNumber} started`, {
        sessionId,
        sessionNumber: session.sessionNumber,
        actorUserId: actor.userId,
        lineCount: lines.length,
      });
      void queueRemote("pending_inventory_counts", { sessionId });
      return { ok: true as const };
    },

    setInventoryCountLine: (sessionId: string, productId: string, countedQty: number, reason?: string) => {
      const actor = actorOrFail(get);
      if (!actor) return { ok: false as const, errorKey: "noSelection" };
      if (!canInventoryCount(actor.role, "count")) return { ok: false as const, errorKey: "auth_forbidden" };

      const session = findSession(get, sessionId);
      if (!session || session.status !== "counting") return { ok: false as const, errorKey: "invalid" };

      const product = get().products.find((p) => p.id === productId);
      if (!product) return { ok: false as const, errorKey: "missingProduct" };

      const lineIdx = session.lines.findIndex((l) => l.productId === productId);
      if (lineIdx < 0) return { ok: false as const, errorKey: "invalid" };

      const updatedLine = withInventoryCountLineCounted(session.lines[lineIdx]!, countedQty, product, reason ?? "");
      const lines = [...session.lines];
      lines[lineIdx] = updatedLine;

      patchSession(set, sessionId, { lines });
      void queueRemote("pending_inventory_counts", { sessionId });
      return { ok: true as const };
    },

    submitInventoryCountSession: (sessionId: string) => {
      const actor = actorOrFail(get);
      if (!actor) return { ok: false as const, errorKey: "noSelection" };
      if (!canInventoryCount(actor.role, "submit")) return { ok: false as const, errorKey: "auth_forbidden" };

      const session = findSession(get, sessionId);
      if (!session) return { ok: false as const, errorKey: "invalid" };
      if (!canTransitionInventoryCountStatus(session.status, "submitted")) {
        return { ok: false as const, errorKey: "invalid" };
      }

      const hasCounted = session.lines.some((l) => l.countedQty != null);
      if (!hasCounted) return { ok: false as const, errorKey: "inventoryCountNoLines" };

      const at = new Date().toISOString();
      patchSession(set, sessionId, {
        status: "submitted",
        submittedAt: at,
        submittedBy: actor.userId,
        submittedByName: actor.displayName,
      });

      pushAudit("inventory_count_submitted", `Stock count #${session.sessionNumber} submitted`, {
        sessionId,
        sessionNumber: session.sessionNumber,
        actorUserId: actor.userId,
      });
      void queueRemote("pending_inventory_counts", { sessionId });
      return { ok: true as const };
    },

    approveInventoryCountSession: (sessionId: string) => {
      const actor = actorOrFail(get);
      if (!actor) return { ok: false as const, errorKey: "noSelection" };
      if (!canInventoryCount(actor.role, "approve")) return { ok: false as const, errorKey: "auth_forbidden" };

      const session = findSession(get, sessionId);
      if (!session) return { ok: false as const, errorKey: "invalid" };
      if (session.status !== "submitted") return { ok: false as const, errorKey: "invalid" };

      const at = new Date().toISOString();
      patchSession(set, sessionId, {
        status: "approved",
        approvedAt: at,
        approvedBy: actor.userId,
        approvedByName: actor.displayName,
      });

      pushAudit("inventory_count_approved", `Stock count #${session.sessionNumber} approved`, {
        sessionId,
        sessionNumber: session.sessionNumber,
        actorUserId: actor.userId,
      });
      void queueRemote("pending_inventory_counts", { sessionId });
      return { ok: true as const };
    },

    applyInventoryCountSession: (sessionId: string) => {
      const actor = actorOrFail(get);
      if (!actor) return { ok: false as const, errorKey: "noSelection" };
      if (!canInventoryCount(actor.role, "apply")) return { ok: false as const, errorKey: "auth_forbidden" };

      const state = get();
      const session = findSession(get, sessionId);
      if (!session) return { ok: false as const, errorKey: "invalid" };
      if (session.status !== "approved") return { ok: false as const, errorKey: "invalid" };

      const shopKey = getActiveAccountKey() ?? "local";
      const at = new Date().toISOString();
      const plan = buildInventoryCountApplyPlan({
        shopKey,
        session,
        products: state.products,
        existingMovements: state.stockMovements,
        at,
      });

      if (plan.lines.length === 0 && session.lines.every((l) => l.countedQty == null)) {
        return { ok: false as const, errorKey: "inventoryCountNoLines" };
      }

      const products = [...state.products];
      const movements: StockMovement[] = [];
      const stockBroadcast: Product[] = [];

      for (const row of plan.lines) {
        const idx = products.findIndex((p) => p.id === row.line.productId);
        if (idx < 0) continue;
        const prev = products[idx]!;
        products[idx] = {
          ...prev,
          stockOnHand: row.targetStockOnHand,
          updatedAt: at,
          version: prev.version + 1,
        };
        movements.push(row.movement);
        stockBroadcast.push(products[idx]!);

        void queueRemote("pending_stock_updates", {
          productId: row.line.productId,
          delta: row.stockDelta,
          note: `inventory_count:${sessionId}`,
          baseUpdatedAt: prev.updatedAt,
          baseStockOnHand: prev.stockOnHand,
        });
      }

      const appliedSession = normalizeInventoryCountSession({
        ...session,
        status: "applied",
        appliedAt: at,
        appliedBy: actor.userId,
        appliedByName: actor.displayName,
        pendingSync: true,
        updatedAt: at,
      });

      set((s) => ({
        products,
        ...movementMergePatch(s, movements),
        inventoryCountSessions: s.inventoryCountSessions.map((row) => (row.id === sessionId ? appliedSession : row)),
      }));

      if (stockBroadcast.length > 0) {
        emitInventoryStockChanges(
          stockBroadcast.map((p) => ({ productId: p.id, newStock: p.stockOnHand, version: p.version })),
          "stock_adjusted",
        );
      }

      pushAudit("inventory_count_applied", `Stock count #${session.sessionNumber} applied`, {
        sessionId,
        sessionNumber: session.sessionNumber,
        actorUserId: actor.userId,
        movementCount: movements.length,
      });
      void queueRemote("pending_inventory_counts", { sessionId });
      return { ok: true as const, movementCount: movements.length };
    },

    cancelInventoryCountSession: (sessionId: string) => {
      const actor = actorOrFail(get);
      if (!actor) return { ok: false as const, errorKey: "noSelection" };
      if (!canInventoryCount(actor.role, "cancel")) return { ok: false as const, errorKey: "auth_forbidden" };

      const session = findSession(get, sessionId);
      if (!session) return { ok: false as const, errorKey: "invalid" };
      if (session.status === "applied" || session.status === "cancelled") {
        return { ok: false as const, errorKey: "invalid" };
      }

      patchSession(set, sessionId, { status: "cancelled" });

      pushAudit("inventory_count_cancelled", `Stock count #${session.sessionNumber} cancelled`, {
        sessionId,
        sessionNumber: session.sessionNumber,
        actorUserId: actor.userId,
      });
      void queueRemote("pending_inventory_counts", { sessionId });
      return { ok: true as const };
    },
  };
}

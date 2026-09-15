/**
 * Phase 6.5 — restaurant billing store mutations.
 */

import type {
  BillPaymentRecord,
  BillSplitLine,
  HospitalityAuditEventType,
  RestaurantBillDraft,
  RestaurantBillSplitMode,
  RestaurantPaymentMethod,
  Sale,
} from "../types";
import {
  allocatePaymentToSplits,
  billDraftFromSale,
  canFinalizeBill,
  computeRestaurantBillTotals,
  creditDebtFromBillPayments,
  deriveAggregatePaymentMethod,
  isDuplicatePayment,
  mergeBillDraft,
} from "../lib/restaurantBilling";
import { ensureHospitalityFloor, syncTableDisplayStatuses } from "../lib/hospitality";
import { appendHospitalityAudit } from "../lib/hospitalityFrontOfHouse";
import { cartDiscountFromPendingSale } from "../lib/draftCart";
import { verifyOwnerPin } from "../lib/sensitiveActionAuth";
import { dateKeyKampala } from "../lib/datesUg";
import { canRoleBypassDiscountApproval } from "../lib/discountGovernance";
import type { PosState } from "./usePosStore";

type StoreGet = () => PosState;
type StoreSet = (partial: Partial<PosState> | ((s: PosState) => Partial<PosState>)) => void;

type Deps = {
  get: StoreGet;
  set: StoreSet;
  denyUnlessEffectivePermission: (
    permission: import("../types").Permission,
    action: string,
  ) => { ok: false; errorKey: string } | null;
  denyIfBusinessDateLocked: (dateKey: string, action: string) => { ok: false; errorKey: string } | null;
  finalizeDraftSale: PosState["finalizeDraftSale"];
  queueRemote: (kind: import("../types").SyncOperationKind, payload: unknown) => void;
  queueHospitalityChange: (input: { sessionIds?: string[] }) => void;
  flushPendingPersist: () => void;
  onTableBillFinalized?: (input: {
    saleId: string;
    sessionId: string | null;
    tableLabel: string | null;
    waiterLabel: string | null;
    guestCount: number | null;
  }) => void;
  onBillVoided?: (input: {
    saleId: string;
    tableLabel: string | null;
    waiterLabel: string | null;
    guestCount: number | null;
    reason: string;
  }) => void;
};

function auditBilling(
  floor: import("../types").HospitalityFloorState,
  type: HospitalityAuditEventType,
  sessionId: string,
  actor: { userId: string; label: string },
  payload: Record<string, unknown>,
  reason?: string,
) {
  return appendHospitalityAudit(floor, {
    type,
    entityType: "session",
    entityId: sessionId,
    actorUserId: actor.userId,
    actorLabel: actor.label,
    reason: reason ?? null,
    payload,
  });
}

function patchPendingSale(get: StoreGet, saleId: string, patch: Partial<Sale>): Sale | null {
  const state = get();
  const existing = state.sales.find((s) => s.id === saleId);
  if (!existing) return null;
  const next: Sale = { ...existing, ...patch, updatedAt: new Date().toISOString(), pendingSync: true };
  return next;
}

export function createRestaurantBillingStoreActions(deps: Deps) {
  const {
    get,
    set,
    denyUnlessEffectivePermission,
    denyIfBusinessDateLocked,
    finalizeDraftSale,
    queueRemote,
    queueHospitalityChange,
    flushPendingPersist,
    onTableBillFinalized,
    onBillVoided,
  } = deps;

  const persistSale = (sale: Sale) => {
    const state = get();
    set({ sales: [sale, ...state.sales.filter((s) => s.id !== sale.id)] });
    void queueRemote("pending_sales", { saleId: sale.id, kind: "pending_upsert" });
    flushPendingPersist();
  };

  return {
    updateTableBillDraft: (patch: Partial<RestaurantBillDraft>) => {
      const denied = denyUnlessEffectivePermission("hospitality.settle", "updateTableBillDraft");
      if (denied) return { ok: false as const, errorKey: denied.errorKey };
      const state = get();
      const saleId = state.activePendingSaleId;
      if (!saleId) return { ok: false as const, errorKey: "invalid" };
      const existing = state.sales.find((s) => s.id === saleId);
      if (!existing) return { ok: false as const, errorKey: "invalid" };
      const billDraft = mergeBillDraft(existing.billDraft, patch, state.preferences);
      const next = patchPendingSale(get, saleId, { billDraft });
      if (!next) return { ok: false as const, errorKey: "invalid" };
      persistSale(next);
      return { ok: true as const };
    },

    applyTableBillSplits: (input: {
      mode: RestaurantBillSplitMode;
      splits: BillSplitLine[];
    }) => {
      const denied = denyUnlessEffectivePermission("hospitality.settle", "applyTableBillSplits");
      if (denied) return { ok: false as const, errorKey: denied.errorKey };
      const state = get();
      const saleId = state.activePendingSaleId;
      const sessionId = state.preferences.activeTableSessionId;
      if (!saleId || !sessionId) return { ok: false as const, errorKey: "invalid" };
      const existing = state.sales.find((s) => s.id === saleId);
      if (!existing) return { ok: false as const, errorKey: "invalid" };
      const billDraft = mergeBillDraft(existing.billDraft, {
        splitMode: input.mode,
        splits: input.splits,
      }, state.preferences);
      const next = patchPendingSale(get, saleId, { billDraft });
      if (!next) return { ok: false as const, errorKey: "invalid" };
      persistSale(next);
      const actor = state.sessionActor;
      let floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
      if (actor) {
        floor = auditBilling(
          floor,
          "bill_split",
          sessionId,
          { userId: actor.userId, label: actor.displayName ?? actor.userId },
          { mode: input.mode, splits: input.splits },
        );
        set({ preferences: { ...state.preferences, hospitalityFloor: floor } });
        queueHospitalityChange({ sessionIds: [sessionId] });
      }
      return { ok: true as const };
    },

    recordTableBillPayment: (input: {
      method: RestaurantPaymentMethod;
      amountUgx: number;
      reference?: string | null;
      voucherCode?: string | null;
      splitId?: string | null;
    }) => {
      const denied = denyUnlessEffectivePermission("hospitality.settle", "recordTableBillPayment");
      if (denied) return { ok: false as const, errorKey: denied.errorKey };
      const dateLock = denyIfBusinessDateLocked(dateKeyKampala(new Date()), "recordTableBillPayment");
      if (dateLock) return dateLock;
      const state = get();
      const saleId = state.activePendingSaleId;
      const sessionId = state.preferences.activeTableSessionId;
      if (!saleId || !sessionId) return { ok: false as const, errorKey: "invalid" };
      const existing = state.sales.find((s) => s.id === saleId);
      if (!existing) return { ok: false as const, errorKey: "invalid" };

      const amount = Math.max(0, Math.floor(input.amountUgx));
      if (amount <= 0) return { ok: false as const, errorKey: "invalid" };

      const draft = billDraftFromSale(existing, state.preferences);
      if (isDuplicatePayment(draft.payments, input)) {
        return { ok: false as const, errorKey: "billPaymentDuplicate" };
      }

      const actor = state.sessionActor;
      const payment: BillPaymentRecord = {
        id: crypto.randomUUID(),
        method: input.method,
        amountUgx: amount,
        reference: input.reference ?? null,
        voucherCode: input.voucherCode ?? null,
        splitId: input.splitId ?? null,
        recordedAt: new Date().toISOString(),
        recordedByUserId: actor?.userId ?? null,
        recordedByLabel: actor?.displayName ?? null,
        pendingSync: true,
      };

      let splits = draft.splits;
      if (splits.length > 0) {
        const alloc = allocatePaymentToSplits(splits, amount, input.splitId);
        splits = alloc.splits;
      }

      const billDraft = mergeBillDraft(draft, { payments: [...draft.payments, payment], splits }, state.preferences);
      const totals = computeRestaurantBillTotals({
        lines: state.draftLines,
        cartDiscountUgx: state.draftCartDiscountUgx,
        billDraft,
        prefs: state.preferences,
      });

      const next = patchPendingSale(get, saleId, { billDraft });
      if (!next) return { ok: false as const, errorKey: "invalid" };
      persistSale(next);

      let floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
      const sessions = floor.sessions.map((s) =>
        s.id === sessionId && s.status === "payment_pending"
          ? { ...s, status: "open" as const, updatedAt: new Date().toISOString(), pendingSync: true }
          : s.id === sessionId
            ? { ...s, updatedAt: new Date().toISOString(), pendingSync: true }
            : s,
      );
      floor = syncTableDisplayStatuses({ ...floor, sessions });
      if (actor) {
        const auditType: HospitalityAuditEventType =
          totals.remainingBalanceUgx > 0 ? "bill_partial_settlement" : "bill_payment";
        floor = auditBilling(
          floor,
          auditType,
          sessionId,
          { userId: actor.userId, label: actor.displayName ?? actor.userId },
          { paymentId: payment.id, amountUgx: amount, method: input.method, remainingBalanceUgx: totals.remainingBalanceUgx },
        );
      }
      set({ preferences: { ...get().preferences, hospitalityFloor: floor } });
      queueHospitalityChange({ sessionIds: [sessionId] });

      return {
        ok: true as const,
        remainingBalanceUgx: totals.remainingBalanceUgx,
        canFinalize: canFinalizeBill(totals),
      };
    },

    finalizeTableBill: (input?: { changeGivenUgx?: number }) => {
      const denied = denyUnlessEffectivePermission("hospitality.settle", "finalizeTableBill");
      if (denied) return { ok: false as const, errorKey: denied.errorKey };
      const state = get();
      const saleId = state.activePendingSaleId;
      if (!saleId) return { ok: false as const, errorKey: "invalid" };
      const existing = state.sales.find((s) => s.id === saleId);
      if (!existing) return { ok: false as const, errorKey: "invalid" };

      const draft = billDraftFromSale(existing, state.preferences);
      const totals = computeRestaurantBillTotals({
        lines: state.draftLines,
        cartDiscountUgx: state.draftCartDiscountUgx,
        billDraft: draft,
        prefs: state.preferences,
      });

      if (!canFinalizeBill(totals)) {
        return { ok: false as const, errorKey: "billBalanceRemaining" };
      }

      const payments = draft.payments;
      const paymentMethod = deriveAggregatePaymentMethod(payments);
      const debtUgx = creditDebtFromBillPayments(payments, totals.grandTotalUgx);
      const amountPaidUgx = payments.reduce((a, p) => a + p.amountUgx, 0);

      const res = finalizeDraftSale({
        debtUgx,
        paymentMethod,
        amountPaidUgx,
        changeGivenUgx: input?.changeGivenUgx ?? totals.changeDueUgx,
        splitBreakdown: draft.splits.length > 0 ? draft.splits : null,
        serviceChargeUgx: totals.serviceChargeUgx,
        tipUgx: totals.tipUgx,
        taxUgx: totals.taxUgx,
        billPayments: payments,
      });

      if (res.ok) {
        const sessionId = existing.tableSessionId;
        const actor = state.sessionActor;
        if (sessionId && actor) {
          let floor = ensureHospitalityFloor(get().preferences.hospitalityFloor ?? undefined);
          floor = auditBilling(
            floor,
            "bill_settled",
            sessionId,
            { userId: actor.userId, label: actor.displayName ?? actor.userId },
            { saleId: res.saleId ?? saleId, grandTotalUgx: totals.grandTotalUgx },
          );
          set({ preferences: { ...get().preferences, hospitalityFloor: floor } });
          queueHospitalityChange({ sessionIds: [sessionId] });
        }
        const floor = get().preferences.hospitalityFloor;
        const session = sessionId && floor ? floor.sessions.find((s) => s.id === sessionId) : null;
        onTableBillFinalized?.({
          saleId: res.saleId ?? saleId,
          sessionId: sessionId ?? null,
          tableLabel: session && floor ? (session.tabLabel ?? floor.tables.find((t) => t.id === session.tableId)?.label ?? null) : null,
          waiterLabel: session?.waiterLabel ?? null,
          guestCount: session?.guestCount ?? null,
        });
      }
      return res;
    },

    approveTableBillDiscount: (input: {
      kind: "line" | "bill";
      reason: string;
      managerPin?: string;
    }) => {
      const state = get();
      const actor = state.sessionActor;
      if (!actor) return { ok: false as const, errorKey: "noSelection" };
      if (!canRoleBypassDiscountApproval(actor.role)) {
        const pin = input.managerPin?.trim() ?? "";
        if (!verifyOwnerPin(pin, state.preferences)) {
          return { ok: false as const, errorKey: "managerPinInvalid" };
        }
      }
      const reason = input.reason.trim();
      if (!reason) return { ok: false as const, errorKey: "reasonRequired" };
      const saleId = state.activePendingSaleId;
      if (!saleId) return { ok: false as const, errorKey: "invalid" };
      const existing = state.sales.find((s) => s.id === saleId);
      if (!existing) return { ok: false as const, errorKey: "invalid" };
      const billDraft = mergeBillDraft(existing.billDraft, {
        discountApproval: {
          approvedByUserId: actor.userId,
          approvedByLabel: actor.displayName ?? actor.userId,
          reason,
          at: new Date().toISOString(),
          kind: input.kind,
        },
      }, state.preferences);
      const next = patchPendingSale(get, saleId, { billDraft });
      if (!next) return { ok: false as const, errorKey: "invalid" };
      persistSale(next);
      const sessionId = state.preferences.activeTableSessionId;
      if (sessionId) {
        let floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
        floor = auditBilling(
          floor,
          "bill_discount_approved",
          sessionId,
          { userId: actor.userId, label: actor.displayName ?? actor.userId },
          { kind: input.kind, reason },
          reason,
        );
        set({ preferences: { ...state.preferences, hospitalityFloor: floor } });
        queueHospitalityChange({ sessionIds: [sessionId] });
      }
      return { ok: true as const };
    },

    reopenTableBill: (input: { sessionId: string; reason: string; managerPin: string }) => {
      const denied = denyUnlessEffectivePermission("hospitality.settle", "reopenTableBill");
      if (denied) return { ok: false as const, errorKey: denied.errorKey };
      if (!canRoleBypassDiscountApproval(get().sessionActor?.role ?? "cashier")) {
        if (!verifyOwnerPin(input.managerPin.trim(), get().preferences)) {
          return { ok: false as const, errorKey: "managerPinInvalid" };
        }
      }
      const reason = input.reason.trim();
      if (!reason) return { ok: false as const, errorKey: "reasonRequired" };

      const state = get();
      const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
      const session = floor.sessions.find((s) => s.id === input.sessionId);
      if (!session || session.status !== "closed") return { ok: false as const, errorKey: "invalid" };

      const sale = state.sales.find((s) => s.id === session.saleId && (s.status === "completed" || !s.status));
      if (!sale) return { ok: false as const, errorKey: "invalid" };

      const actor = state.sessionActor;
      const previousTotalUgx = sale.totalUgx;
      const reopenedSale: Sale = {
        ...sale,
        status: "pending",
        billDraft: mergeBillDraft(sale.billDraft, {
          reopenedAt: new Date().toISOString(),
          reopenedByUserId: actor?.userId ?? null,
          reopenedByLabel: actor?.displayName ?? null,
          reopenedReason: reason,
          previousTotalUgx,
        }, state.preferences),
        updatedAt: new Date().toISOString(),
        pendingSync: true,
      };

      const sessions = floor.sessions.map((s) =>
        s.id === input.sessionId
          ? { ...s, status: "open" as const, closedAt: null, updatedAt: new Date().toISOString(), pendingSync: true }
          : s,
      );
      let nextFloor = syncTableDisplayStatuses({ ...floor, sessions });
      if (actor) {
        nextFloor = auditBilling(
          nextFloor,
          "bill_reopened",
          input.sessionId,
          { userId: actor.userId, label: actor.displayName ?? actor.userId },
          { previousTotalUgx, saleId: sale.id },
          reason,
        );
      }

      set({
        sales: [reopenedSale, ...state.sales.filter((s) => s.id !== sale.id)],
        draftLines: reopenedSale.lines.map((l) => ({ ...l })),
        draftCartDiscountUgx: cartDiscountFromPendingSale(reopenedSale),
        activePendingSaleId: reopenedSale.id,
        preferences: {
          ...state.preferences,
          hospitalityFloor: nextFloor,
          activeTableSessionId: input.sessionId,
        },
      });
      void queueRemote("pending_sales", { saleId: reopenedSale.id, kind: "pending_upsert" });
      queueHospitalityChange({ sessionIds: [input.sessionId] });
      flushPendingPersist();
      return { ok: true as const, sessionId: input.sessionId };
    },

    voidSettledTableBill: (input: { sessionId: string; reason: string; managerPin: string }) => {
      const denied = denyUnlessEffectivePermission("hospitality.settle", "voidSettledTableBill");
      if (denied) return { ok: false as const, errorKey: denied.errorKey };
      if (!canRoleBypassDiscountApproval(get().sessionActor?.role ?? "cashier")) {
        if (!verifyOwnerPin(input.managerPin.trim(), get().preferences)) {
          return { ok: false as const, errorKey: "managerPinInvalid" };
        }
      }
      const reason = input.reason.trim();
      if (!reason) return { ok: false as const, errorKey: "reasonRequired" };

      const state = get();
      const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
      const session = floor.sessions.find((s) => s.id === input.sessionId);
      if (!session || session.status !== "closed") return { ok: false as const, errorKey: "invalid" };

      const sale = state.sales.find((s) => s.id === session.saleId);
      if (!sale || sale.status === "pending") return { ok: false as const, errorKey: "invalid" };
      if (sale.saleVoidedAt) return { ok: false as const, errorKey: "invalid" };

      const actor = state.sessionActor;
      const at = new Date().toISOString();
      const voidedSale: Sale = {
        ...sale,
        saleVoidedAt: at,
        saleVoidReason: reason,
        saleVoidedByUserId: actor?.userId ?? null,
        saleVoidedByLabel: actor?.displayName ?? null,
        billDraft: mergeBillDraft(sale.billDraft, {
          voidedAt: at,
          voidedByUserId: actor?.userId ?? null,
          voidedByLabel: actor?.displayName ?? null,
          voidReason: reason,
        }, state.preferences),
        updatedAt: at,
        pendingSync: true,
      };

      if (actor) {
        const nextFloor = auditBilling(
          floor,
          "bill_voided",
          input.sessionId,
          { userId: actor.userId, label: actor.displayName ?? actor.userId },
          { saleId: sale.id, grandTotalUgx: sale.totalUgx },
          reason,
        );
        set({
          sales: state.sales.map((s) => (s.id === sale.id ? voidedSale : s)),
          preferences: { ...state.preferences, hospitalityFloor: nextFloor },
        });
      } else {
        set({ sales: state.sales.map((s) => (s.id === sale.id ? voidedSale : s)) });
      }

      void queueRemote("pending_sales", { saleId: sale.id, kind: "pending_upsert" });
      queueHospitalityChange({ sessionIds: [input.sessionId] });
      flushPendingPersist();

      const table = session.tableId ? floor.tables.find((t) => t.id === session.tableId) : undefined;
      onBillVoided?.({
        saleId: sale.id,
        tableLabel: session.tabLabel ?? table?.label ?? sale.referenceLabel ?? null,
        waiterLabel: session.waiterLabel ?? null,
        guestCount: session.guestCount ?? null,
        reason,
      });

      return { ok: true as const, saleId: sale.id };
    },

    setDraftLineSeat: (lineId: string, seatNumber: number | null) => {
      const state = get();
      const seat = seatNumber != null && seatNumber >= 1 ? Math.floor(seatNumber) : null;
      set({
        draftLines: state.draftLines.map((l) =>
          (l.id ?? l.productId) === lineId ? { ...l, seatNumber: seat } : l,
        ),
      });
      return { ok: true as const };
    },
  };
}

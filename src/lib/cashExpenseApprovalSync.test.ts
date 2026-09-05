import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { CashExpense } from "../types";
import { usePosStore } from "../store/usePosStore";
import { createDefaultPreferences } from "../data/defaultSeed";
import { dateKeyKampala } from "./datesUg";
import {
  buildCashExpensePushPayload,
  cashExpenseFromCloudRow,
  expenseCountsInDrawer,
  mergeCashExpenseFromCloudPull,
  parseCashExpenseApprovalStatus,
} from "./cashExpenses";
import { sumCashExpensesOnDay } from "./cashReconciliation";

const ROOT = process.cwd();
const CLOUD_SYNC = readFileSync(resolve(ROOT, "src/offline/cloudSync.ts"), "utf8");
const TODAY = dateKeyKampala(new Date());

function expense(partial: Partial<CashExpense> & Pick<CashExpense, "id" | "approvalStatus">): CashExpense {
  return {
    category: "lunch",
    amountUgx: 50_000,
    description: "soda",
    paidOn: TODAY,
    createdAt: "2026-09-05T10:00:00.000Z",
    updatedAt: "2026-09-05T10:00:00.000Z",
    createdByUserId: "cashier-1",
    createdByLabel: "Cashier",
    pendingSync: false,
    deletedAt: null,
    ...partial,
  };
}

function cloudRowFromPayload(expenseRow: CashExpense, updatedAt = expenseRow.updatedAt ?? expenseRow.createdAt) {
  const payload = buildCashExpensePushPayload(expenseRow);
  return {
    id: payload.id,
    category: payload.category,
    amount_ugx: payload.amount_ugx,
    description: payload.description,
    paid_on: payload.paid_on,
    created_at: payload.created_at,
    created_by: "11111111-1111-4111-8111-111111111111",
    recorded_by_label: payload.recorded_by_label,
    metadata: payload.metadata,
    deleted_at: expenseRow.deletedAt,
    updated_at: updatedAt,
  };
}

describe("CASH-POST-04 cash expense approval sync", () => {
  it("cloudSync push/pull uses approval metadata helpers", () => {
    expect(CLOUD_SYNC).toMatch(/buildCashExpensePushPayload\(expense\)/);
    expect(CLOUD_SYNC).toMatch(/return cashExpenseFromCloudRow\(raw\)/);
    expect(CLOUD_SYNC).toMatch(/mergeByIdChunked\(state\.cashExpenses, cloud\.cashExpenses, newer\)/);
  });

  it("1 — approval-required creation is pending locally", () => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "cashier-1", role: "cashier", displayName: "Cashier" },
      preferences: {
        ...createDefaultPreferences(),
        staffCanRecordCashExpenses: true,
        requireCashierExpenseApproval: true,
      },
      cashExpenses: [],
      auditLogs: [],
    });
    const r = usePosStore.getState().addCashExpense({ amountUgx: 50_000, category: "lunch" });
    expect(r.ok).toBe(true);
    const row = usePosStore.getState().cashExpenses[0]!;
    expect(row.approvalStatus).toBe("pending");
    expect(row.updatedAt).toBeTruthy();
  });

  it("2-4 — pending survives serialize, push payload, and pull reconstruction", () => {
    const pending = expense({ id: "exp-pending", approvalStatus: "pending" });
    const serialized = JSON.parse(JSON.stringify(pending)) as CashExpense;
    expect(serialized.approvalStatus).toBe("pending");

    const payload = buildCashExpensePushPayload(pending);
    const meta = payload.metadata as Record<string, unknown>;
    expect(meta.approvalStatus).toBe("pending");
    expect(payload.amount_ugx).toBe(50_000);

    const pulled = cashExpenseFromCloudRow(cloudRowFromPayload(pending));
    expect(pulled).not.toBeNull();
    expect(pulled!.approvalStatus).toBe("pending");
    expect(expenseCountsInDrawer(pulled!)).toBe(false);
  });

  it("5-8 — drawer counting by status", () => {
    expect(expenseCountsInDrawer(expense({ id: "p", approvalStatus: "pending" }))).toBe(false);
    expect(expenseCountsInDrawer(expense({ id: "a", approvalStatus: "approved" }))).toBe(true);
    expect(expenseCountsInDrawer(expense({ id: "r", approvalStatus: "rejected" }))).toBe(false);
    expect(
      expenseCountsInDrawer(
        expense({ id: "v", approvalStatus: "approved", deletedAt: "2026-09-05T12:00:00.000Z" }),
      ),
    ).toBe(false);
  });

  it("9-10 — approve and reject persist through push/pull", () => {
    const approved = expense({
      id: "exp-ok",
      approvalStatus: "approved",
      approvedByUserId: "owner-1",
      approvedByLabel: "Owner",
      approvedAt: "2026-09-05T11:00:00.000Z",
      updatedAt: "2026-09-05T11:00:00.000Z",
    });
    const approvedPull = cashExpenseFromCloudRow(cloudRowFromPayload(approved));
    expect(approvedPull!.approvalStatus).toBe("approved");
    expect(approvedPull!.approvedByUserId).toBe("owner-1");
    expect(expenseCountsInDrawer(approvedPull!)).toBe(true);

    const rejected = expense({
      id: "exp-no",
      approvalStatus: "rejected",
      rejectedByUserId: "owner-1",
      rejectedByLabel: "Owner",
      rejectedAt: "2026-09-05T11:00:00.000Z",
      updatedAt: "2026-09-05T11:00:00.000Z",
    });
    const rejectedPull = cashExpenseFromCloudRow(cloudRowFromPayload(rejected));
    expect(rejectedPull!.approvalStatus).toBe("rejected");
    expect(expenseCountsInDrawer(rejectedPull!)).toBe(false);
  });

  it("11 — legacy missing status stays absent on pull and still counts", () => {
    const pulled = cashExpenseFromCloudRow({
      id: "legacy-1",
      category: "rent",
      amount_ugx: 20_000,
      description: null,
      paid_on: TODAY,
      created_at: "2026-01-01T10:00:00.000Z",
      created_by: "owner-1",
      recorded_by_label: "Owner",
      metadata: { wakaClient: true },
      deleted_at: null,
      updated_at: "2026-01-01T10:00:00.000Z",
    });
    expect(pulled).not.toBeNull();
    expect(pulled!.approvalStatus).toBeUndefined();
    expect(parseCashExpenseApprovalStatus(undefined)).toBeUndefined();
    expect(expenseCountsInDrawer(pulled!)).toBe(true);
  });

  it("14 — multi-device create pending → pull pending → approve → pull approved", () => {
    const deviceA = expense({ id: "exp-md", approvalStatus: "pending" });
    const afterBPull = cashExpenseFromCloudRow(cloudRowFromPayload(deviceA));
    expect(afterBPull!.approvalStatus).toBe("pending");
    expect(expenseCountsInDrawer(afterBPull!)).toBe(false);

    const approvedOnB: CashExpense = {
      ...afterBPull!,
      approvalStatus: "approved",
      approvedByUserId: "owner-1",
      approvedByLabel: "Owner",
      approvedAt: "2026-09-05T11:00:00.000Z",
      updatedAt: "2026-09-05T11:00:00.000Z",
    };
    const afterAPull = mergeCashExpenseFromCloudPull(
      deviceA,
      cashExpenseFromCloudRow(cloudRowFromPayload(approvedOnB, approvedOnB.updatedAt))!,
    );
    expect(afterAPull.approvalStatus).toBe("approved");
    expect(expenseCountsInDrawer(afterAPull)).toBe(true);

    const rejectedOnB: CashExpense = {
      ...approvedOnB,
      approvalStatus: "rejected",
      rejectedByUserId: "owner-1",
      rejectedAt: "2026-09-05T11:30:00.000Z",
      updatedAt: "2026-09-05T11:30:00.000Z",
    };
    const afterReject = mergeCashExpenseFromCloudPull(
      afterAPull,
      cashExpenseFromCloudRow(cloudRowFromPayload(rejectedOnB, rejectedOnB.updatedAt))!,
    );
    expect(afterReject.approvalStatus).toBe("rejected");
    expect(expenseCountsInDrawer(afterReject)).toBe(false);

    const voidedOnB: CashExpense = {
      ...approvedOnB,
      deletedAt: "2026-09-05T12:00:00.000Z",
      updatedAt: "2026-09-05T12:00:00.000Z",
    };
    const afterVoid = mergeCashExpenseFromCloudPull(
      afterAPull,
      cashExpenseFromCloudRow(cloudRowFromPayload(voidedOnB, voidedOnB.updatedAt))!,
    );
    expect(afterVoid.deletedAt).toBe("2026-09-05T12:00:00.000Z");
    expect(expenseCountsInDrawer(afterVoid)).toBe(false);
  });

  it("does not let a stale pending cloud row overwrite a newer local approval", () => {
    const localApproved = expense({
      id: "exp-race",
      approvalStatus: "approved",
      updatedAt: "2026-09-05T11:00:00.000Z",
    });
    const staleCloud = cashExpenseFromCloudRow(
      cloudRowFromPayload(expense({ id: "exp-race", approvalStatus: "pending" }), "2026-09-05T10:00:00.000Z"),
    )!;
    const merged = mergeCashExpenseFromCloudPull(localApproved, staleCloud);
    expect(merged.approvalStatus).toBe("approved");
    expect(expenseCountsInDrawer(merged)).toBe(true);
  });
});

describe("CASH-POST-04 store transitions and permissions", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "cashier-1", role: "cashier", displayName: "Cashier" },
      preferences: {
        ...createDefaultPreferences(),
        staffCanRecordCashExpenses: true,
        requireCashierExpenseApproval: true,
      },
      cashExpenses: [],
      auditLogs: [],
    });
  });

  it("12 — approval disabled still creates an immediate approved expense", () => {
    usePosStore.setState({
      preferences: {
        ...createDefaultPreferences(),
        staffCanRecordCashExpenses: true,
        requireCashierExpenseApproval: false,
      },
    });
    const r = usePosStore.getState().addCashExpense({ amountUgx: 12_000, category: "transport" });
    expect(r.ok).toBe(true);
    const row = usePosStore.getState().cashExpenses[0]!;
    expect(row.approvalStatus).toBe("approved");
    expect(expenseCountsInDrawer(row)).toBe(true);
    expect(sumCashExpensesOnDay(usePosStore.getState().cashExpenses, TODAY)).toBe(12_000);
  });

  it("approve/reject persist on the same expense id", () => {
    usePosStore.getState().addCashExpense({ amountUgx: 50_000, category: "lunch" });
    const id = usePosStore.getState().cashExpenses[0]!.id;
    usePosStore.setState({ sessionActor: { userId: "owner-1", role: "owner", displayName: "Owner" } });
    expect(usePosStore.getState().approveCashExpense(id).ok).toBe(true);
    const approved = usePosStore.getState().cashExpenses[0]!;
    expect(approved.id).toBe(id);
    expect(approved.approvalStatus).toBe("approved");
    expect(approved.updatedAt).toBeTruthy();
    expect((buildCashExpensePushPayload(approved).metadata as Record<string, unknown>).approvalStatus).toBe(
      "approved",
    );
    expect(usePosStore.getState().cashExpenses).toHaveLength(1);
  });

  it("13 — cashier cannot approve or reject", () => {
    usePosStore.getState().addCashExpense({ amountUgx: 50_000, category: "lunch" });
    const id = usePosStore.getState().cashExpenses[0]!;
    expect(usePosStore.getState().approveCashExpense(id.id).ok).toBe(false);
    expect(usePosStore.getState().cashExpenses[0]!.approvalStatus).toBe("pending");
    expect(usePosStore.getState().rejectCashExpense(id.id).ok).toBe(false);
    expect(usePosStore.getState().cashExpenses[0]!.approvalStatus).toBe("pending");
  });
});

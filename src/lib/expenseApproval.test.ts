import { describe, expect, it, beforeEach } from "vitest";
import { usePosStore } from "../store/usePosStore";
import { sumCashExpensesOnDay } from "./cashReconciliation";
import { createDefaultPreferences } from "../data/defaultSeed";
import { dateKeyKampala } from "./datesUg";

const today = dateKeyKampala(new Date());

describe("expense approval workflow", () => {
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

  it("cashier expense is pending when approval required", () => {
    const r = usePosStore.getState().addCashExpense({ amountUgx: 8000, category: "lunch", description: "team lunch" });
    expect(r.ok).toBe(true);
    const row = usePosStore.getState().cashExpenses[0]!;
    expect(row.approvalStatus).toBe("pending");
    expect(row.deviceId).toBeTruthy();
    expect(row.createdByUserId).toBe("cashier-1");
    expect(sumCashExpensesOnDay(usePosStore.getState().cashExpenses, today)).toBe(0);
  });

  it("owner approval includes expense in drawer totals and logs audit", () => {
    usePosStore.getState().addCashExpense({ amountUgx: 8000, category: "lunch" });
    const id = usePosStore.getState().cashExpenses[0]!.id;
    usePosStore.setState({
      sessionActor: { userId: "owner-1", role: "owner", displayName: "Owner" },
    });
    const ar = usePosStore.getState().approveCashExpense(id);
    expect(ar.ok).toBe(true);
    expect(usePosStore.getState().cashExpenses[0]!.approvalStatus).toBe("approved");
    expect(sumCashExpensesOnDay(usePosStore.getState().cashExpenses, today)).toBe(8000);
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "cash_expense_approved")).toBe(true);
  });

  it("rejected expense excluded from drawer totals", () => {
    usePosStore.getState().addCashExpense({ amountUgx: 4000, category: "transport" });
    const id = usePosStore.getState().cashExpenses[0]!.id;
    usePosStore.setState({
      sessionActor: { userId: "mgr-1", role: "manager", displayName: "Manager" },
    });
    const rr = usePosStore.getState().rejectCashExpense(id);
    expect(rr.ok).toBe(true);
    expect(usePosStore.getState().cashExpenses[0]!.approvalStatus).toBe("rejected");
    expect(sumCashExpensesOnDay(usePosStore.getState().cashExpenses, today)).toBe(0);
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "cash_expense_rejected")).toBe(true);
  });
});

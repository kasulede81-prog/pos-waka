import { describe, expect, it, beforeEach } from "vitest";
import { usePosStore } from "../store/usePosStore";
import {
  canRecordCashExpenses,
  cashierExpenseRecordingEnabled,
} from "./cashExpenses";
import { createDefaultPreferences } from "../data/defaultSeed";

describe("cash expense permissions", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "cashier-1", role: "cashier", displayName: "Cashier" },
      preferences: {
        ...createDefaultPreferences(),
        staffCanRecordCashExpenses: false,
      },
      cashExpenses: [],
      auditLogs: [],
    });
  });

  it("defaults cashier expense recording to off", () => {
    expect(cashierExpenseRecordingEnabled(createDefaultPreferences())).toBe(false);
    expect(canRecordCashExpenses("cashier", createDefaultPreferences())).toBe(false);
  });

  it("cashier blocked from addCashExpense when setting off", () => {
    const r = usePosStore.getState().addCashExpense({ amountUgx: 5000, category: "lunch" });
    expect(r.ok).toBe(false);
    expect(usePosStore.getState().cashExpenses).toHaveLength(0);
  });

  it("cashier allowed when setting on", () => {
    usePosStore.setState({
      preferences: {
        ...createDefaultPreferences(),
        staffCanRecordCashExpenses: true,
      },
    });
    expect(canRecordCashExpenses("cashier", usePosStore.getState().preferences)).toBe(true);
    const r = usePosStore.getState().addCashExpense({ amountUgx: 5000, category: "lunch" });
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().cashExpenses).toHaveLength(1);
  });

  it("owner can always record expenses", () => {
    usePosStore.setState({
      sessionActor: { userId: "owner-1", role: "owner", displayName: "Owner" },
    });
    const r = usePosStore.getState().addCashExpense({ amountUgx: 3000, category: "transport" });
    expect(r.ok).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { CashDrawerAdjustment } from "../types";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import { normalizeCashDrawerAdjustment } from "./cashDrawerLedger";

const DAY = "2026-06-11";

function adjustment(type: CashDrawerAdjustment["type"], amountUgx: number, id: string): CashDrawerAdjustment {
  const ts = `${DAY}T08:00:00.000Z`;
  return normalizeCashDrawerAdjustment({
    id,
    type,
    amountUgx,
    note: "",
    actorUserId: "owner",
    occurredAt: ts,
    createdAt: ts,
    updatedAt: ts,
    pendingSync: false,
  });
}

describe("cash drawer backup/restore recovery", () => {
  it("adjustments survive JSON snapshot round-trip and affect expected drawer", () => {
    const adjustments = [
      adjustment("opening_float", 50_000, "f1"),
      adjustment("owner_injection", 100_000, "i1"),
      adjustment("bank_deposit", 300_000, "b1"),
    ];
    const snapshot = {
      cashDrawerAdjustments: adjustments,
      updatedAt: `${DAY}T18:00:00.000Z`,
    };
    const restored = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    const normalized = (restored.cashDrawerAdjustments ?? []).map(normalizeCashDrawerAdjustment);

    const drawer = getDrawerCashForDayInput({
      sales: [
        {
          id: "s1",
          createdAt: `${DAY}T10:00:00.000Z`,
          updatedAt: `${DAY}T10:00:00.000Z`,
          subtotalUgx: 500_000,
          cashPaidUgx: 500_000,
          debtUgx: 0,
          paymentMethod: "cash",
          estimatedProfitUgx: 490_000,
          lines: [],
          pendingSync: false,
          lastSyncError: null,
          status: "completed",
          totalUgx: 500_000,
        },
      ],
      returns: [
        {
          id: "r1",
          saleId: null,
          productId: "p1",
          productName: "Item",
          quantity: 1,
          refundAmountUgx: 20_000,
          reason: "other",
          actorUserId: "owner",
          createdAt: `${DAY}T14:00:00.000Z`,
        },
      ],
      products: [],
      debtPayments: [{ id: "dp1", customerId: "c1", amountUgx: 50_000, createdAt: `${DAY}T11:00:00.000Z` }],
      cashExpenses: [
        {
          id: "e1",
          category: "transport",
          amountUgx: 20_000,
          description: "",
          paidOn: DAY,
          createdAt: `${DAY}T12:00:00.000Z`,
          createdByUserId: "owner",
          pendingSync: false,
        },
      ],
      supplierPayments: [
        { id: "sp1", supplierId: "s1", amountUgx: 80_000, createdAt: `${DAY}T13:00:00.000Z`, pendingSync: false },
      ],
      cashDrawerAdjustments: normalized,
      shifts: [],
      day: DAY,
    });

    expect(normalized).toHaveLength(3);
    expect(drawer.expectedDrawerCashUgx).toBe(280_000);
  });
});

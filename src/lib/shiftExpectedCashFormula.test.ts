import { describe, expect, it } from "vitest";
import type { Sale, ShiftRecord, ShopPreferences } from "../types";
import {
  cashReduceFromRefund,
  getCashDrawerSalesInput,
  physicalCashCollectedFromSale,
} from "./cashDrawerSales";
import { resolveCashDrawerFormulaVersion } from "./dayDrawerOpen";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import { shiftExpectedCash } from "./saleAdjustments";
import { computeShiftCloseAmounts } from "./shiftRecoveryOps";

const DAY = "2026-08-30";

function prefs(version?: ShopPreferences["cashDrawerFormulaVersion"]): Pick<
  ShopPreferences,
  "cashDrawerFormulaVersion"
> {
  return { cashDrawerFormulaVersion: version };
}

function sale(partial: Partial<Sale> & Pick<Sale, "totalUgx">): Sale {
  return {
    id: crypto.randomUUID(),
    status: "completed",
    createdAt: `${DAY}T10:00:00.000Z`,
    updatedAt: `${DAY}T10:00:00.000Z`,
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.cashPaidUgx ?? partial.totalUgx,
    debtUgx: partial.debtUgx ?? 0,
    paymentMethod: partial.paymentMethod ?? "cash",
    changeGivenUgx: partial.changeGivenUgx ?? 0,
    amountPaidUgx: partial.amountPaidUgx ?? partial.cashPaidUgx ?? partial.totalUgx,
    estimatedProfitUgx: partial.totalUgx - 1_000,
    lines: [
      {
        id: crypto.randomUUID(),
        productId: "p1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: partial.totalUgx,
        unitCostUgx: 1_000,
        estimatedProfitUgx: partial.totalUgx - 1_000,
        inputMode: "quantity",
        updatedAt: `${DAY}T10:00:00.000Z`,
        lineTotalUgx: partial.totalUgx,
      },
    ],
    pendingSync: false,
    lastSyncError: null,
    ...partial,
  };
}

function shift(partial?: Partial<ShiftRecord>): ShiftRecord {
  return {
    id: "sh1",
    actorUserId: "c1",
    role: "cashier",
    startAt: `${DAY}T08:00:00.000Z`,
    salesTotalUgx: 0,
    debtTotalUgx: 0,
    refundsUgx: 0,
    estimatedCashUgx: 0,
    openingFloatUgx: 50_000,
    verifiedFloatUgx: 50_000,
    segmentBaselineUgx: 50_000,
    ...partial,
  };
}

describe("FORMULA-VERSION-DEFAULT-1.0", () => {
  it("unset preference → V2", () => {
    expect(resolveCashDrawerFormulaVersion(prefs(undefined))).toBe("v2");
    expect(resolveCashDrawerFormulaVersion({})).toBe("v2");
  });

  it("explicit V1 → V1", () => {
    expect(resolveCashDrawerFormulaVersion(prefs("v1"))).toBe("v1");
  });

  it("explicit V2 → V2", () => {
    expect(resolveCashDrawerFormulaVersion(prefs("v2"))).toBe("v2");
  });

  it("day and shift resolve consistently via the same resolver", () => {
    for (const version of [undefined, "v1", "v2"] as const) {
      const resolved = resolveCashDrawerFormulaVersion(prefs(version));
      const sh = shift({ estimatedCashUgx: 20_000 });
      const shiftExpected = shiftExpectedCash(sh, { formulaVersion: resolved });
      // Day path uses the same resolver output for opening-float semantics.
      expect(resolved).toBe(version ?? "v2");
      expect(shiftExpected).toBe(70_000);
    }
  });
});

describe("SHIFT-EXPECTED-CASH-1.0 physical cash classification", () => {
  it("cash sale contributes physical cash", () => {
    const s = sale({ totalUgx: 10_000, paymentMethod: "cash" });
    expect(physicalCashCollectedFromSale(s)).toBe(10_000);
    expect(getCashDrawerSalesInput([s], DAY).cashSalesUgx).toBe(10_000);
  });

  it("MoMo sale contributes zero physical cash", () => {
    const s = sale({ totalUgx: 10_000, cashPaidUgx: 10_000, paymentMethod: "mobile_money" });
    expect(physicalCashCollectedFromSale(s)).toBe(0);
    expect(getCashDrawerSalesInput([s], DAY).cashSalesUgx).toBe(0);
    expect(getCashDrawerSalesInput([s], DAY).mobileMoneySalesUgx).toBe(10_000);
  });

  it("ATM sale contributes zero physical cash", () => {
    const s = sale({ totalUgx: 10_000, cashPaidUgx: 10_000, paymentMethod: "atm" });
    expect(physicalCashCollectedFromSale(s)).toBe(0);
    expect(getCashDrawerSalesInput([s], DAY).cashSalesUgx).toBe(0);
    expect(getCashDrawerSalesInput([s], DAY).cardSalesUgx).toBe(10_000);
  });

  it("mixed payment follows canonical physical-cash behavior (collected = total − debt)", () => {
    const s = sale({ totalUgx: 10_000, cashPaidUgx: 3_000, debtUgx: 7_000, paymentMethod: "mixed" });
    expect(physicalCashCollectedFromSale(s)).toBe(3_000);
  });

  it("credit follows canonical existing behavior (no collected physical cash)", () => {
    const s = sale({ totalUgx: 10_000, cashPaidUgx: 0, debtUgx: 10_000, paymentMethod: "credit" });
    expect(physicalCashCollectedFromSale(s)).toBe(0);
  });

  it("change is not double-counted — physical uses total−debt, not tender+change", () => {
    const s = sale({
      totalUgx: 10_000,
      cashPaidUgx: 10_000,
      amountPaidUgx: 20_000,
      changeGivenUgx: 10_000,
      paymentMethod: "cash",
    });
    expect(physicalCashCollectedFromSale(s)).toBe(10_000);
    expect(physicalCashCollectedFromSale(s) + (s.changeGivenUgx ?? 0)).toBe(20_000);
  });

  it("MoMo/ATM void/return reduce does not subtract from physical drawer", () => {
    const momo = sale({ totalUgx: 10_000, cashPaidUgx: 10_000, paymentMethod: "mobile_money" });
    const atm = sale({ totalUgx: 8_000, cashPaidUgx: 8_000, paymentMethod: "atm" });
    expect(cashReduceFromRefund(momo, 10_000)).toBe(0);
    expect(cashReduceFromRefund(atm, 8_000)).toBe(0);
  });
});

describe("SHIFT-EXPECTED-CASH-1.0 shift close", () => {
  it("V2 shift close uses V2 expected cash (segment baseline, not legacy openingFloat alone)", () => {
    const sh = shift({
      openingFloatUgx: 99_999,
      segmentBaselineUgx: 40_000,
      verifiedFloatUgx: 40_000,
      estimatedCashUgx: 10_000,
      debtPaymentsTotalUgx: 0,
    });
    const v2 = resolveCashDrawerFormulaVersion(prefs("v2"));
    expect(shiftExpectedCash(sh, { formulaVersion: v2 })).toBe(50_000);
    const amounts = computeShiftCloseAmounts(sh, 48_000, 25_000, { formulaVersion: v2 });
    expect(amounts.expected).toBe(50_000);
    expect(amounts.differenceUgx).toBe(48_000 - 50_000);
  });

  it("shift variance uses the same resolved formula version", () => {
    const sh = shift({
      openingFloatUgx: 100_000,
      segmentBaselineUgx: 20_000,
      estimatedCashUgx: 5_000,
    });
    const resolved = resolveCashDrawerFormulaVersion(prefs(undefined));
    expect(resolved).toBe("v2");
    const { expected, differenceUgx } = computeShiftCloseAmounts(sh, 30_000, 0, {
      formulaVersion: resolved,
    });
    expect(expected).toBe(shiftExpectedCash(sh, { formulaVersion: resolved }));
    expect(differenceUgx).toBe(30_000 - expected);
  });

  it("handoff float uses corrected expected/physical calculation", () => {
    const physicalSales = physicalCashCollectedFromSale(
      sale({ totalUgx: 15_000, paymentMethod: "cash" }),
    );
    const momoIgnored = physicalCashCollectedFromSale(
      sale({ totalUgx: 20_000, cashPaidUgx: 20_000, paymentMethod: "mobile_money" }),
    );
    expect(momoIgnored).toBe(0);
    const sh = shift({
      segmentBaselineUgx: 50_000,
      estimatedCashUgx: physicalSales + momoIgnored,
      debtPaymentsTotalUgx: 0,
    });
    const formulaVersion = resolveCashDrawerFormulaVersion(prefs("v2"));
    const { expected, counted } = computeShiftCloseAmounts(sh, 65_000, 40_000, { formulaVersion });
    expect(expected).toBe(65_000);
    expect(counted).toBe(65_000);
    // Handoff is separate from expected; expected stays physical-cash correct.
    expect(shiftExpectedCash(sh, { formulaVersion })).toBe(65_000);
  });

  it("explicit V1 installations keep V1 shift baseline (openingFloatUgx)", () => {
    const sh = shift({
      openingFloatUgx: 50_000,
      segmentBaselineUgx: 1,
      verifiedFloatUgx: 1,
      estimatedCashUgx: 10_000,
    });
    const v1 = resolveCashDrawerFormulaVersion(prefs("v1"));
    expect(v1).toBe("v1");
    expect(shiftExpectedCash(sh, { formulaVersion: v1 })).toBe(60_000);
  });
});

describe("day vs shift shared physical classification", () => {
  it("day cashSales and shift physical attribution match for the same sale set", () => {
    const sales = [
      sale({ totalUgx: 10_000, paymentMethod: "cash" }),
      sale({ totalUgx: 7_000, cashPaidUgx: 7_000, paymentMethod: "mobile_money" }),
      sale({ totalUgx: 5_000, cashPaidUgx: 5_000, paymentMethod: "atm" }),
      sale({ totalUgx: 12_000, cashPaidUgx: 4_000, debtUgx: 8_000, paymentMethod: "mixed" }),
    ];
    const dayPhysical = getCashDrawerSalesInput(sales, DAY).cashSalesUgx;
    const shiftPhysical = sales.reduce((sum, s) => sum + physicalCashCollectedFromSale(s), 0);
    expect(dayPhysical).toBe(14_000);
    expect(shiftPhysical).toBe(14_000);
    const drawer = getDrawerCashForDayInput({
      sales,
      returns: [],
      products: [],
      debtPayments: [],
      cashExpenses: [],
      day: DAY,
      formulaVersion: resolveCashDrawerFormulaVersion(prefs(undefined)),
    });
    expect(drawer.cashFromSalesUgx).toBe(14_000);
  });
});

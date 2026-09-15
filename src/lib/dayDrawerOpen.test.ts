import { describe, expect, it } from "vitest";
import type { CashDrawerAdjustment, DayDrawerOpen, Sale, ShiftRecord } from "../types";
import {
  activeDayDrawerOpenForDate,
  completedSalesCountOnDay,
  isDayDrawerOpenMutable,
  resolveOpeningFloatUgx,
  shiftVerificationBaselineUgx,
} from "./dayDrawerOpen";
import { getDrawerCashForDayInput } from "./cashReconciliation";

const DAY = "2026-06-11";

function dayOpen(partial?: Partial<DayDrawerOpen>): DayDrawerOpen {
  const now = `${DAY}T07:00:00.000Z`;
  return {
    id: partial?.id ?? "do1",
    dateKey: DAY,
    openingFloatUgx: partial?.openingFloatUgx ?? 100_000,
    countedAt: now,
    countedByUserId: "owner",
    countedByLabel: "Owner",
    note: "",
    deviceId: "dev",
    status: partial?.status ?? "open",
    createdAt: now,
    updatedAt: now,
    pendingSync: false,
    ...partial,
  };
}

function shift(openingFloatUgx: number): ShiftRecord {
  return {
    id: "sh1",
    actorUserId: "c1",
    role: "cashier",
    startAt: `${DAY}T08:00:00.000Z`,
    salesTotalUgx: 0,
    debtTotalUgx: 0,
    refundsUgx: 0,
    estimatedCashUgx: 0,
    openingFloatUgx,
  };
}

function adjustment(amount: number): CashDrawerAdjustment {
  const now = `${DAY}T07:30:00.000Z`;
  return {
    id: crypto.randomUUID(),
    type: "opening_float",
    amountUgx: amount,
    note: "",
    actorUserId: "owner",
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
    pendingSync: false,
  };
}

function completedSale(): Sale {
  return {
    id: "s1",
    createdAt: `${DAY}T09:00:00.000Z`,
    updatedAt: `${DAY}T09:00:00.000Z`,
    subtotalUgx: 5_000,
    totalUgx: 5_000,
    cashPaidUgx: 5_000,
    debtUgx: 0,
    paymentMethod: "cash",
    estimatedProfitUgx: 1_000,
    lines: [],
    pendingSync: false,
    lastSyncError: null,
    status: "completed",
  };
}

describe("DayDrawerOpen", () => {
  it("allows only one active day open per dateKey", () => {
    const rows = [dayOpen(), dayOpen({ id: "do2", status: "superseded" }), dayOpen({ id: "do3", status: "voided" })];
    expect(activeDayDrawerOpenForDate(rows, DAY)?.id).toBe("do1");
  });

  it("v2 resolveOpeningFloatUgx ignores shift floats and adjustments", () => {
    const opens = [dayOpen({ openingFloatUgx: 100_000 })];
    const shifts = [shift(50_000)];
    const adjustments = [adjustment(30_000)];
    expect(
      resolveOpeningFloatUgx(DAY, adjustments, shifts, {
        dayDrawerOpens: opens,
        formulaVersion: "v2",
      }),
    ).toBe(100_000);
  });

  it("v1 still sums shift floats and adjustments", () => {
    const shifts = [shift(20_000)];
    const adjustments = [adjustment(30_000)];
    expect(resolveOpeningFloatUgx(DAY, adjustments, shifts, { formulaVersion: "v1" })).toBe(50_000);
  });

  it("day open is mutable before first sale and locked after", () => {
    expect(isDayDrawerOpenMutable([], DAY)).toBe(true);
    expect(completedSalesCountOnDay([completedSale()], DAY)).toBe(1);
    expect(isDayDrawerOpenMutable([completedSale()], DAY)).toBe(false);
  });

  it("handoff baseline uses prior shift handoff", () => {
    const open = dayOpen();
    const prior: ShiftRecord = {
      ...shift(0),
      endAt: `${DAY}T14:00:00.000Z`,
      handoffFloatUgx: 85_000,
    };
    expect(shiftVerificationBaselineUgx(DAY, [prior], open, prior)).toBe(85_000);
    expect(shiftVerificationBaselineUgx(DAY, [], open, null)).toBe(100_000);
  });

  it("multi-cashier v2 does not inflate day expected cash with extra shift floats", () => {
    const opens = [dayOpen({ openingFloatUgx: 100_000 })];
    const shifts = [shift(50_000), { ...shift(40_000), id: "sh2", actorUserId: "c2" }];
    const drawer = getDrawerCashForDayInput({
      sales: [],
      returns: [],
      products: [],
      debtPayments: [],
      cashExpenses: [],
      cashDrawerAdjustments: [],
      shifts,
      dayDrawerOpens: opens,
      formulaVersion: "v2",
      day: DAY,
    });
    expect(drawer.openingFloatUgx).toBe(100_000);
  });

  it("historical day close snapshot is independent of live v2 resolution", () => {
    const frozenCloseOpening = 80_000;
    const opens = [dayOpen({ openingFloatUgx: 100_000 })];
    expect(frozenCloseOpening).toBe(80_000);
    expect(resolveOpeningFloatUgx(DAY, [], [], { dayDrawerOpens: opens, formulaVersion: "v2" })).toBe(100_000);
  });
});

describe("migration v1 to v2", () => {
  it("undefined formula version behaves as v1", () => {
    expect(resolveOpeningFloatUgx(DAY, [], [shift(25_000)])).toBe(25_000);
  });
});

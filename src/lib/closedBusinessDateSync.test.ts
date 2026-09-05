import { describe, expect, it } from "vitest";
import type { DayCloseSummary, SyncOperation } from "../types";
import { shouldRetrySyncOp } from "./autoSync";
import { CLOSED_BUSINESS_DATE_ERROR, shouldRetryClosedBusinessDateOp } from "./businessDateLock";
import {
  noteClosedBusinessDateRejection,
  shouldSkipPendingClosedDateSync,
  syncOpEntityId,
  takeClosedBusinessDatePark,
} from "./closedBusinessDateSync";

function closeFor(dateKey: string): DayCloseSummary {
  return {
    id: `close-${dateKey}`,
    dateKey,
    expectedCashUgx: 100_000,
    countedCashUgx: 100_000,
    differenceUgx: 0,
    totalSalesUgx: 0,
    totalDebtUgx: 0,
    profitEstimateUgx: 0,
    createdAt: `${dateKey}T20:00:00.000Z`,
  };
}

function parkedOp(dateKey = "2026-09-04"): SyncOperation {
  return {
    id: "op-1",
    kind: "pending_sales",
    payload: { saleId: "sale-1" },
    createdAt: "2026-09-04T10:00:00.000Z",
    attempts: 3,
    lastAttemptAt: "2026-01-01T00:00:00.000Z",
    lastError: CLOSED_BUSINESS_DATE_ERROR,
    closedDateKey: dateKey,
  };
}

describe("CASH-CONTROL-01 closed-date client sync parking", () => {
  it("does not retry a parked closed-date op while that date is still locked", () => {
    const op = parkedOp();
    expect(shouldRetryClosedBusinessDateOp(op, [closeFor("2026-09-04")])).toBe(false);
    expect(shouldRetrySyncOp(op, Date.now(), [closeFor("2026-09-04")])).toBe(false);
  });

  it("does not treat closed-date rejection as retryable when lock state is unknown", () => {
    expect(shouldRetryClosedBusinessDateOp(parkedOp())).toBe(false);
    expect(shouldRetrySyncOp(parkedOp(), Date.now() + 60_000)).toBe(false);
  });

  it("retries the same op after the date is reopened / superseded", () => {
    const op = parkedOp();
    const reopened: DayCloseSummary[] = [{ ...closeFor("2026-09-04"), supersededAt: "2026-09-05T08:00:00.000Z" }];
    expect(shouldRetryClosedBusinessDateOp(op, reopened)).toBe(true);
    expect(shouldRetrySyncOp(op, Date.now(), reopened)).toBe(true);
  });

  it("retries after a different date is closed", () => {
    const op = parkedOp("2026-09-04");
    expect(shouldRetryClosedBusinessDateOp(op, [closeFor("2026-09-05")])).toBe(true);
  });

  it("skips pendingSync scan while the sale date remains locked", () => {
    expect(
      shouldSkipPendingClosedDateSync("2026-09-04", CLOSED_BUSINESS_DATE_ERROR, [closeFor("2026-09-04")]),
    ).toBe(true);
    expect(shouldSkipPendingClosedDateSync("2026-09-04", CLOSED_BUSINESS_DATE_ERROR, [])).toBe(false);
    expect(shouldSkipPendingClosedDateSync("2026-09-04", "network", [closeFor("2026-09-04")])).toBe(false);
  });

  it("parks the rejected entity without treating the push as success", () => {
    noteClosedBusinessDateRejection("2026-09-04", "sale-1");
    expect(takeClosedBusinessDatePark("sale-2")).toBeNull();
    expect(takeClosedBusinessDatePark("sale-1")).toEqual({
      lastError: CLOSED_BUSINESS_DATE_ERROR,
      closedDateKey: "2026-09-04",
    });
    expect(takeClosedBusinessDatePark("sale-1")).toBeNull();
  });

  it("reads the entity id from existing queue payloads", () => {
    expect(syncOpEntityId({ payload: { saleId: "s1" } })).toBe("s1");
    expect(syncOpEntityId({ payload: { expenseId: "e1" } })).toBe("e1");
    expect(syncOpEntityId({ payload: { paymentId: "p1" } })).toBe("p1");
    expect(syncOpEntityId({ payload: { returnId: "r1" } })).toBe("r1");
    expect(syncOpEntityId({ payload: { adjustmentId: "a1" } })).toBe("a1");
  });
});

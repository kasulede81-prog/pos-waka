import { describe, expect, it } from "vitest";
import type { ShiftRecord } from "../types";
import {
  authorizeShiftClose,
  buildShiftClosePatch,
  computeShiftCloseAmounts,
  listOpenShifts,
  listRecoverableOpenShifts,
  resolveShiftCloseTarget,
} from "./shiftRecoveryOps";

const CASHIER_ID = "staff:cashier-1";
const MANAGER_ID = "staff:manager-1";

function shift(partial: Partial<ShiftRecord> & Pick<ShiftRecord, "id" | "actorUserId">): ShiftRecord {
  return {
    role: "cashier",
    startAt: "2026-06-11T08:00:00.000Z",
    endAt: null,
    salesTotalUgx: 0,
    debtTotalUgx: 0,
    refundsUgx: 0,
    estimatedCashUgx: 0,
    openingFloatUgx: 10_000,
    debtPaymentsTotalUgx: 0,
    ...partial,
  };
}

describe("shiftRecoveryOps", () => {
  it("scenario 1: manager can close another operator shift (recovery)", () => {
    const open = shift({ id: "s1", actorUserId: CASHIER_ID, actorName: "Cashier A" });
    const target = resolveShiftCloseTarget([open], MANAGER_ID, "s1");
    expect(target.ok).toBe(true);
    if (!target.ok) return;
    expect(target.isRecovery).toBe(true);

    const authz = authorizeShiftClose(
      {
        actorUserId: MANAGER_ID,
        actorRole: "manager",
        hasPermission: (p) => p === "day.close" || p === "shift.close",
      },
      target.shift,
      target.isRecovery,
    );
    expect(authz.ok).toBe(true);
  });

  it("scenario 2: historical pending shift can be resolved with cash count patch", () => {
    const open = shift({
      id: "s-old",
      actorUserId: CASHIER_ID,
      startAt: "2026-06-01T08:00:00.000Z",
      estimatedCashUgx: 30_000,
      openingFloatUgx: 5_000,
    });
    const { counted, differenceUgx, expected } = computeShiftCloseAmounts(open, 35_000, 20_000, {
      formulaVersion: "v1",
    });
    expect(expected).toBe(35_000);
    expect(counted).toBe(35_000);
    expect(differenceUgx).toBe(0);

    const closed = buildShiftClosePatch(
      open,
      { counted, endAt: "2026-06-11T18:00:00.000Z", differenceUgx, formulaVersion: "v1" },
      {
        recoveredByUserId: MANAGER_ID,
        recoveredByLabel: "Manager B",
        recoveredAt: "2026-06-11T18:00:00.000Z",
        recoveryReason: "Cashier absent",
      },
    );
    expect(closed.endAt).toBeTruthy();
    expect(closed.countedCashUgx).toBe(35_000);
    expect(closed.recoveredByUserId).toBe(MANAGER_ID);
    expect(closed.actorUserId).toBe(CASHIER_ID);
  });

  it("scenario 3: three pending shifts recover independently", () => {
    const shifts = [
      shift({ id: "a", actorUserId: "staff:1" }),
      shift({ id: "b", actorUserId: "staff:2" }),
      shift({ id: "c", actorUserId: "staff:3" }),
    ];
    expect(listOpenShifts(shifts)).toHaveLength(3);
    expect(listRecoverableOpenShifts(shifts, MANAGER_ID)).toHaveLength(3);
    for (const id of ["a", "b", "c"]) {
      const target = resolveShiftCloseTarget(shifts, MANAGER_ID, id);
      expect(target.ok).toBe(true);
    }
  });

  it("scenario 4: variance is preserved in recovery close patch", () => {
    const open = shift({ id: "s1", actorUserId: CASHIER_ID, openingFloatUgx: 10_000, estimatedCashUgx: 40_000 });
    const amounts = computeShiftCloseAmounts(open, 48_000, 25_000, { formulaVersion: "v1" });
    expect(amounts.differenceUgx).toBe(-2_000);
    const closed = buildShiftClosePatch(open, {
      counted: amounts.counted,
      endAt: "2026-06-11T18:00:00.000Z",
      differenceUgx: amounts.differenceUgx,
      formulaVersion: "v1",
    });
    expect(closed.cashDifferenceUgx).toBe(-2_000);
  });

  it("scenario 5: cashier without permission cannot recover another shift", () => {
    const open = shift({ id: "s1", actorUserId: CASHIER_ID });
    const authz = authorizeShiftClose(
      {
        actorUserId: "staff:cashier-2",
        actorRole: "cashier",
        hasPermission: (p) => p === "shift.close",
      },
      open,
      true,
    );
    expect(authz.ok).toBe(false);
    if (authz.ok) return;
    expect(authz.errorKey).toBe("shiftRecoverDenied");
  });

  it("scenario 6: audit trail retains original operator on recovery patch", () => {
    const open = shift({ id: "s1", actorUserId: CASHIER_ID, actorName: "Cashier A" });
    const closed = buildShiftClosePatch(
      open,
      {
        counted: 60_000,
        endAt: "2026-06-11T18:00:00.000Z",
        differenceUgx: 0,
        formulaVersion: "v1",
      },
      {
        recoveredByUserId: MANAGER_ID,
        recoveredByLabel: "Manager B",
        recoveredAt: "2026-06-11T18:00:00.000Z",
        recoveryReason: "End of day",
        recoveryNotes: "Counted drawer",
      },
    );
    expect(closed.actorUserId).toBe(CASHIER_ID);
    expect(closed.actorName).toBe("Cashier A");
    expect(closed.recoveredByUserId).toBe(MANAGER_ID);
    expect(closed.recoveredByLabel).toBe("Manager B");
    expect(closed.recoveryReason).toBe("End of day");
  });

  it("own close without shiftId resolves actor shift", () => {
    const open = shift({ id: "s1", actorUserId: CASHIER_ID });
    const target = resolveShiftCloseTarget([open], CASHIER_ID);
    expect(target.ok).toBe(true);
    if (!target.ok) return;
    expect(target.isRecovery).toBe(false);
  });

  it("missing own shift with other open shifts returns shiftCloseOtherOperator", () => {
    const open = shift({ id: "s1", actorUserId: CASHIER_ID });
    const target = resolveShiftCloseTarget([open], MANAGER_ID);
    expect(target.ok).toBe(false);
    if (target.ok) return;
    expect(target.errorKey).toBe("shiftCloseOtherOperator");
  });
});

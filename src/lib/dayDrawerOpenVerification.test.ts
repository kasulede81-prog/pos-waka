import { describe, expect, it } from "vitest";
import type { ShiftRecord } from "../types";
import { collectDayDrawerOpenDiagnostics } from "./dayDrawerOpenDiagnostics";

const DAY = "2026-06-11";

describe("dayDrawerOpenVerification", () => {
  it("Scenario C — verification variance -500 UGX", () => {
    const shift: ShiftRecord = {
      id: "sh1",
      actorUserId: "cashier",
      role: "cashier",
      startAt: "2026-06-11T07:00:00.000Z",
      endAt: null,
      salesTotalUgx: 0,
      debtTotalUgx: 0,
      refundsUgx: 0,
      estimatedCashUgx: 0,
      verifiedFloatUgx: 99_500,
      segmentBaselineUgx: 100_000,
      verificationVarianceUgx: -500,
      verificationStatus: "matched",
      verifiedAt: "2026-06-11T07:00:00.000Z",
      verifiedByUserId: "cashier",
      verifiedByLabel: "Cashier",
      dayDrawerOpenId: "do1",
    };

    const diag = collectDayDrawerOpenDiagnostics(
      [
        {
          id: "do1",
          dateKey: DAY,
          openingFloatUgx: 100_000,
          countedAt: "2026-06-11T06:00:00.000Z",
          countedByUserId: "owner",
          countedByLabel: "Owner",
          note: "",
          deviceId: "dev-a",
          status: "open",
          createdAt: "2026-06-11T06:00:00.000Z",
          updatedAt: "2026-06-11T06:00:00.000Z",
          pendingSync: false,
          cloudSyncedAt: "2026-06-11T06:00:00.000Z",
        },
      ],
      [shift],
      DAY,
    );

    expect(shift.verificationVarianceUgx).toBe(-500);
    expect(diag.verificationMismatchCount).toBe(1);
    expect(diag.activeOpen?.openingFloatUgx).toBe(100_000);
  });
});

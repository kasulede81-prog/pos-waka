import { beforeEach, describe, expect, it } from "vitest";
import { usePosStore } from "../store/usePosStore";

const ACTOR_OWNER = { userId: "owner-1", role: "owner" as const, displayName: "Owner" };
const ACTOR_CASHIER = { userId: "staff:1", role: "cashier" as const, displayName: "Cashier" };

beforeEach(() => {
  usePosStore.setState({
    _hydrated: true,
    sales: [],
    dayDrawerOpens: [],
    sessionActor: ACTOR_OWNER,
    preferences: {
      ...usePosStore.getState().preferences,
      cashDrawerFormulaVersion: "v2",
      shifts: [],
      backOfficePin: "1234",
    },
  });
});

describe("day drawer store", () => {
  it("cashier cannot record day open", () => {
    usePosStore.setState({ sessionActor: ACTOR_CASHIER });
    const r = usePosStore.getState().recordDayDrawerOpen({ openingFloatUgx: 100_000 });
    expect(r.ok).toBe(false);
  });

  it("owner records day open once per day", () => {
    const first = usePosStore.getState().recordDayDrawerOpen({ openingFloatUgx: 100_000 });
    expect(first.ok).toBe(true);
    const dup = usePosStore.getState().recordDayDrawerOpen({ openingFloatUgx: 50_000 });
    expect(dup.ok).toBe(false);
    expect(dup.errorKey).toBe("dayDrawerAlreadyOpen");
  });

  it("blocks opening_float adjustment on v2", () => {
    const r = usePosStore.getState().addCashDrawerAdjustment({
      type: "opening_float",
      amountUgx: 50_000,
      note: "",
    });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("dayDrawerUseDayOpen");
  });

  it("locks day open after first completed sale", () => {
    usePosStore.getState().recordDayDrawerOpen({ openingFloatUgx: 100_000 });
    const dayOpenId = usePosStore.getState().dayDrawerOpens[0]!.id;
    usePosStore.setState({
      sales: [
        {
          id: "s1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          subtotalUgx: 1_000,
          totalUgx: 1_000,
          cashPaidUgx: 1_000,
          debtUgx: 0,
          paymentMethod: "cash",
          estimatedProfitUgx: 100,
          lines: [],
          pendingSync: false,
          lastSyncError: null,
          status: "completed",
        },
      ],
    });
    const voidR = usePosStore.getState().voidDayDrawerOpen({ dayOpenId, reason: "mistake count" });
    expect(voidR.ok).toBe(false);
    expect(voidR.errorKey).toBe("dayDrawerLockedAfterSales");
  });

  it("owner can correct day open after sales when setting enabled", () => {
    usePosStore.setState({
      preferences: {
        ...usePosStore.getState().preferences,
        ownerDayOpenCorrectionAfterSales: true,
      },
    });
    usePosStore.getState().recordDayDrawerOpen({ openingFloatUgx: 100_000 });
    const dayOpenId = usePosStore.getState().dayDrawerOpens[0]!.id;
    usePosStore.setState({
      sales: [
        {
          id: "s1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          subtotalUgx: 1_000,
          totalUgx: 1_000,
          cashPaidUgx: 1_000,
          debtUgx: 0,
          paymentMethod: "cash",
          estimatedProfitUgx: 100,
          lines: [],
          pendingSync: false,
          lastSyncError: null,
          status: "completed",
        },
      ],
    });
    const badPin = usePosStore.getState().supersedeDayDrawerOpen({
      previousId: dayOpenId,
      openingFloatUgx: 120_000,
      reason: "Counted wrong at open",
      ownerOverridePin: "9999",
    });
    expect(badPin.ok).toBe(false);
    expect(badPin.errorKey).toBe("dayOpenOverridePinInvalid");

    const ok = usePosStore.getState().supersedeDayDrawerOpen({
      previousId: dayOpenId,
      openingFloatUgx: 120_000,
      reason: "Counted wrong at open",
      ownerOverridePin: "1234",
    });
    expect(ok.ok).toBe(true);
    expect(usePosStore.getState().dayDrawerOpens.find((r) => r.status === "open")?.openingFloatUgx).toBe(120_000);
  });

  it("cashier shift start requires verification and rejects mismatch without override", () => {
    usePosStore.getState().recordDayDrawerOpen({ openingFloatUgx: 100_000 });
    usePosStore.setState({ sessionActor: ACTOR_CASHIER });
    const legacy = usePosStore.getState().beginShift(50_000);
    expect(legacy.ok).toBe(false);
    const mismatch = usePosStore.getState().beginShiftV2({ verifiedFloatUgx: 50_000 });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.errorKey).toBe("shiftFloatMismatch");
  });

  it("v1 beginShift still allows optional opening float", () => {
    usePosStore.setState({
      preferences: { ...usePosStore.getState().preferences, cashDrawerFormulaVersion: "v1" },
      sessionActor: ACTOR_CASHIER,
    });
    const r = usePosStore.getState().beginShift(25_000);
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().preferences.shifts?.[0]?.openingFloatUgx).toBe(25_000);
  });
});

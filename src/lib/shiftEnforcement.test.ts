import { describe, expect, it, beforeEach } from "vitest";
import { usePosStore } from "../store/usePosStore";
import type { Product, ShiftRecord } from "../types";
import {
  assertCanCloseShift,
  formatShiftDuration,
  getActiveShiftForActor,
  requireActiveShift,
} from "./shiftEnforcement";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUSTOMER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACTOR_ID = "staff:1";

const baseProduct: Product = {
  id: PRODUCT_ID,
  name: "Item",
  sellingPricePerUnitUgx: 1_000,
  costPricePerUnitUgx: 100,
  stockOnHand: 10,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-05-31T09:00:00.000Z",
  version: 1,
};

function openShift(partial: Partial<ShiftRecord> = {}): ShiftRecord {
  return {
    id: "shift-1",
    actorUserId: ACTOR_ID,
    actorName: "Tester",
    role: "cashier",
    startAt: "2026-06-11T08:00:00.000Z",
    endAt: null,
    salesTotalUgx: 0,
    debtTotalUgx: 0,
    refundsUgx: 0,
    estimatedCashUgx: 0,
    openingFloatUgx: 20_000,
    ...partial,
  };
}

function seedStore(withShift = false) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: ACTOR_ID, role: "cashier", displayName: "Tester" },
    products: [baseProduct],
    customers: [
      {
        id: CUSTOMER_ID,
        name: "Buyer",
        phone: "",
        location: "",
        debtBalanceUgx: 5_000,
        createdAt: "2026-05-01T00:00:00.000Z",
        version: 1,
      },
    ],
    purchases: [],
    stockMovements: [],
    auditLogs: [],
    preferences: {
      ...usePosStore.getState().preferences,
      cashDrawerFormulaVersion: "v1",
      shifts: withShift ? [openShift()] : [],
    },
  });
}

function draftLine() {
  return {
    id: "line-1",
    productId: PRODUCT_ID,
    name: "Item",
    inputMode: "quantity" as const,
    quantity: 1,
    unitPriceUgx: 1_000,
    unitCostUgx: 100,
    lineTotalUgx: 1_000,
    estimatedProfitUgx: 900,
    updatedAt: "2026-06-02T10:00:00.000Z",
  };
}

describe("shiftEnforcement helpers", () => {
  it("getActiveShiftForActor returns open shift for actor", () => {
    const shift = openShift();
    expect(getActiveShiftForActor([shift], ACTOR_ID)?.id).toBe("shift-1");
    expect(getActiveShiftForActor([{ ...shift, endAt: "2026-06-11T18:00:00.000Z" }], ACTOR_ID)).toBeNull();
  });

  it("requireActiveShift returns noActiveShift when missing", () => {
    const r = requireActiveShift({
      sessionActor: { userId: ACTOR_ID },
      preferences: { shifts: [] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorKey).toBe("noActiveShift");
  });

  it("formatShiftDuration renders hours and minutes", () => {
    const start = "2026-06-11T08:00:00.000Z";
    const end = new Date(start).getTime() + 90 * 60_000;
    expect(formatShiftDuration(start, end)).toBe("1h 30m");
  });
});

describe("usePosStore shift enforcement", () => {
  beforeEach(() => {
    seedStore(false);
  });

  it("cannot sell without shift", () => {
    usePosStore.setState({ draftLines: [draftLine()], draftCartDiscountUgx: 0 });
    const r = usePosStore.getState().finalizeDraftSale({
      debtUgx: 0,
      paymentMethod: "cash",
      amountPaidUgx: 1_000,
      changeGivenUgx: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("noActiveShift");
  });

  it("cannot record debt payment without shift", () => {
    const r = usePosStore.getState().addDebtPayment(CUSTOMER_ID, 1_000);
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("noActiveShift");
  });

  it("cannot settle hospitality order without shift", () => {
    usePosStore.setState({ draftLines: [draftLine()], draftCartDiscountUgx: 0 });
    const r = usePosStore.getState().finalizeDraftSale({
      debtUgx: 0,
      paymentMethod: "cash",
      amountPaidUgx: 1_000,
      changeGivenUgx: 0,
    });
    expect(r.errorKey).toBe("noActiveShift");
  });

  it("allows sales after shift is opened via gateway beginShift", () => {
    usePosStore.getState().beginShift(10_000);
    usePosStore.setState({ draftLines: [draftLine()], draftCartDiscountUgx: 0 });
    const r = usePosStore.getState().finalizeDraftSale({
      debtUgx: 0,
      paymentMethod: "cash",
      amountPaidUgx: 1_000,
      changeGivenUgx: 0,
    });
    expect(r.ok).toBe(true);
  });

  it("staff switch protection blocks silent shift termination", () => {
    seedStore(true);
    usePosStore.setState({
      preferences: {
        ...usePosStore.getState().preferences,
        activeStaffId: "1",
        staffAccounts: [
          {
            id: "1",
            name: "A",
            role: "cashier",
            active: true,
            username: "a",
            phone: "",
            permissions: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "2",
            name: "B",
            role: "cashier",
            active: true,
            username: "b",
            phone: "",
            permissions: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    });
    const r = usePosStore.getState().switchStaffAccount("2");
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("staffSwitchShiftOpen");
    expect(usePosStore.getState().preferences.shifts?.find((s) => !s.endAt)).toBeTruthy();
  });

  it("close shift cash count records counted cash and ends shift", () => {
    seedStore(true);
    usePosStore.setState((s) => ({
      preferences: {
        ...s.preferences,
        shifts: [
          {
            ...openShift(),
            estimatedCashUgx: 50_000,
            openingFloatUgx: 10_000,
          },
        ],
      },
    }));
    const r = usePosStore.getState().closeShiftWithCashCount(62_000);
    expect(r.ok).toBe(true);
    const closed = usePosStore.getState().preferences.shifts?.[0];
    expect(closed?.endAt).toBeTruthy();
    expect(closed?.countedCashUgx).toBe(62_000);
    expect(closed?.cashDifferenceUgx).toBe(2_000);
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "shift_close_count")).toBe(true);
  });

  it("draft sale close blocker prevents shift close", () => {
    seedStore(true);
    usePosStore.setState({ draftLines: [draftLine()] });
    const r = usePosStore.getState().closeShiftWithCashCount(10_000);
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("shiftCloseDraftSaleOpen");
  });

  it("open table close blocker prevents shift close", () => {
    seedStore(true);
    usePosStore.setState((s) => ({
      draftLines: [],
      preferences: {
        ...s.preferences,
        hospitalityFloor: {
          areas: [{ id: "area-1", name: "Main", sortOrder: 0, isActive: true }],
          tables: [
            {
              id: "table-1",
              label: "T1",
              areaId: "area-1",
              isActive: true,
              sortOrder: 0,
              displayStatus: "available",
            },
          ],
          stations: [],
          sessions: [
            {
              id: "sess-1",
              tableId: "table-1",
              saleId: "sale-pending",
              status: "open",
              guestCount: 2,
              openedAt: "2026-06-11T09:00:00.000Z",
              updatedAt: "2026-06-11T09:00:00.000Z",
              sessionKind: "table",
            },
          ],
          kitchenTickets: [],
        },
      },
    }));
    const guard = assertCanCloseShift(usePosStore.getState());
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.errorKey).toBe("shiftCloseOpenTable");
  });
});

describe("active shift banner data", () => {
  it("active shift exposes expected cash parts for banner", () => {
    const shift = openShift({
      salesTotalUgx: 5_000,
      estimatedCashUgx: 5_000,
      debtPaymentsTotalUgx: 1_000,
    });
    expect(getActiveShiftForActor([shift], ACTOR_ID)?.openingFloatUgx).toBe(20_000);
    expect(getActiveShiftForActor([shift], ACTOR_ID)?.debtPaymentsTotalUgx).toBe(1_000);
  });
});

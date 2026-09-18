/**
 * Table-service workflow through the REAL store actions, in the exact order
 * TableOrderPage calls them (open table -> add lines -> save -> send to station).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Product } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { defaultHospitalityFloor } from "./hospitality";
import { BAR_FIRE_STATION_TYPES, KITCHEN_FIRE_STATION_TYPES } from "./kitchenRouting";
import { physicalCashCollectedFromSale } from "./cashDrawerSales";

function product(partial: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    sellingMode: "unit",
    baseUnit: "pcs",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 3_000,
    stockOnHand: 50,
    minimumStockAlert: 0,
    category: "Food",
    sku: "",
    updatedAt: "2026-09-17T08:00:00.000Z",
    version: 1,
    ...partial,
  };
}

const BURGER = product({ id: "burger", name: "Burger", category: "Food" });
const SODA = product({ id: "soda", name: "Soda", category: "Drinks", sellingPricePerUnitUgx: 2_000 });

function ticketItemQty(productId: string): number {
  const tickets = usePosStore.getState().preferences.hospitalityFloor?.kitchenTickets ?? [];
  return tickets
    .filter((t) => t.status !== "cancelled")
    .flatMap((t) => t.items)
    .filter((i) => i.productId === productId)
    .reduce((n, i) => n + i.quantity, 0);
}

function openTableAndResume(): string {
  const floor = usePosStore.getState().preferences.hospitalityFloor!;
  const opened = usePosStore.getState().openTable({ tableId: floor.tables[0]!.id, guestCount: 2 });
  expect(opened.ok).toBe(true);
  return (opened as { sessionId: string }).sessionId;
}

describe("table order — send to kitchen / bar (manual fire, as TableOrderPage does)", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
      products: [BURGER, SODA],
      sales: [],
      auditLogs: [],
      draftLines: [],
      draftCartDiscountUgx: 0,
      activePendingSaleId: null,
      preferences: {
        ...usePosStore.getState().preferences,
        businessType: "hospitality",
        hospitalityModeEnabled: true,
        hospitalityManualKitchenFire: true,
        hospitalityFloor: defaultHospitalityFloor(),
      },
    });
    openTestShift();
  });

  it("first send creates tickets for the new lines (was: 'nothing to send')", () => {
    openTableAndResume();
    const s = usePosStore.getState();
    expect(s.addHospitalityDraftLine({ product: BURGER, quantity: 2 }).ok).toBe(true);
    expect(s.saveTableBill().ok).toBe(true);
    const fired = usePosStore.getState().fireTableStationTickets(KITCHEN_FIRE_STATION_TYPES);
    expect(fired.ok).toBe(true);
    expect(fired.ticketsFired).toBe(1);
    expect(ticketItemQty("burger")).toBe(2);
  });

  it("sending again without changes fires nothing (no duplicate tickets)", () => {
    openTableAndResume();
    usePosStore.getState().addHospitalityDraftLine({ product: BURGER, quantity: 2 });
    usePosStore.getState().saveTableBill();
    usePosStore.getState().fireTableStationTickets(KITCHEN_FIRE_STATION_TYPES);
    usePosStore.getState().saveTableBill();
    const again = usePosStore.getState().fireTableStationTickets(KITCHEN_FIRE_STATION_TYPES);
    expect(again.ok).toBe(true);
    expect(again.ticketsFired ?? 0).toBe(0);
    expect(ticketItemQty("burger")).toBe(2);
  });

  it("adding quantity later only sends the difference", () => {
    openTableAndResume();
    usePosStore.getState().addHospitalityDraftLine({ product: BURGER, quantity: 2 });
    usePosStore.getState().saveTableBill();
    usePosStore.getState().fireTableStationTickets(KITCHEN_FIRE_STATION_TYPES);
    usePosStore.getState().addHospitalityDraftLine({ product: BURGER, quantity: 1 });
    usePosStore.getState().saveTableBill();
    const next = usePosStore.getState().fireTableStationTickets(KITCHEN_FIRE_STATION_TYPES);
    expect(next.ticketsFired).toBe(1);
    expect(ticketItemQty("burger")).toBe(3);
  });

  it("kitchen send leaves bar items unsent; bar send then sends them", () => {
    openTableAndResume();
    usePosStore.getState().addHospitalityDraftLine({ product: BURGER, quantity: 1 });
    usePosStore.getState().addHospitalityDraftLine({ product: SODA, quantity: 2 });
    usePosStore.getState().saveTableBill();

    const kitchen = usePosStore.getState().fireTableStationTickets(KITCHEN_FIRE_STATION_TYPES);
    expect(kitchen.ticketsFired).toBe(1);
    expect(ticketItemQty("burger")).toBe(1);
    expect(ticketItemQty("soda")).toBe(0);

    usePosStore.getState().saveTableBill();
    const bar = usePosStore.getState().fireTableStationTickets(BAR_FIRE_STATION_TYPES);
    expect(bar.ticketsFired).toBe(1);
    expect(ticketItemQty("soda")).toBe(2);
    expect(ticketItemQty("burger")).toBe(1);
  });
});

describe("table bill settlement — totals and drawer cash", () => {
  const BIG = product({ id: "steak", name: "Steak", category: "Food", sellingPricePerUnitUgx: 100_000, stockOnHand: 20 });

  function setup(prefs: Record<string, unknown>) {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
      products: [BIG],
      sales: [],
      auditLogs: [],
      draftLines: [],
      draftCartDiscountUgx: 0,
      activePendingSaleId: null,
      preferences: {
        ...usePosStore.getState().preferences,
        businessType: "hospitality",
        hospitalityModeEnabled: true,
        hospitalityManualKitchenFire: true,
        hospitalityFloor: defaultHospitalityFloor(),
        hospitalityServiceChargePercent: 0,
        ...prefs,
      },
    });
    openTestShift();
    openTableAndResume();
    expect(usePosStore.getState().addHospitalityDraftLine({ product: BIG, quantity: 1 }).ok).toBe(true);
    expect(usePosStore.getState().saveTableBill().ok).toBe(true);
  }

  function settle(payments: Array<{ method: "cash" | "mobile_money" | "credit"; amountUgx: number }>) {
    for (const p of payments) {
      const r = usePosStore.getState().recordTableBillPayment(p);
      expect(r.ok).toBe(true);
    }
    const res = usePosStore.getState().finalizeTableBill();
    expect(res.ok).toBe(true);
    return usePosStore.getState().sales.find((s) => s.id === (res as { saleId?: string }).saleId)!;
  }

  it("tax-INCLUSIVE bill is recorded at the bill total (was inflated by the tax)", () => {
    setup({ hospitalityTaxEnabled: true, hospitalityTaxPercent: 18, hospitalityTaxMode: "inclusive" });
    const sale = settle([{ method: "cash", amountUgx: 100_000 }]);
    expect(sale.totalUgx).toBe(100_000);
  });

  it("tax-EXCLUSIVE bill still adds the tax on top", () => {
    setup({ hospitalityTaxEnabled: true, hospitalityTaxPercent: 18, hospitalityTaxMode: "exclusive" });
    const sale = settle([{ method: "cash", amountUgx: 118_000 }]);
    expect(sale.totalUgx).toBe(118_000);
    expect(sale.taxUgx).toBe(18_000);
  });

  it("mixed MoMo + cash only counts the cash in the drawer", () => {
    setup({ hospitalityTaxEnabled: false });
    const sale = settle([
      { method: "mobile_money", amountUgx: 60_000 },
      { method: "cash", amountUgx: 40_000 },
    ]);
    expect(sale.totalUgx).toBe(100_000);
    expect(physicalCashCollectedFromSale(sale)).toBe(40_000);
  });

  it("cash overpay on a cash-only bill: drawer counts the bill, not the tendered amount (retail rule)", () => {
    setup({ hospitalityTaxEnabled: false });
    const sale = settle([{ method: "cash", amountUgx: 120_000 }]);
    expect(sale.totalUgx).toBe(100_000);
    expect(physicalCashCollectedFromSale(sale)).toBe(100_000);
  });

  it("MoMo-only bill adds nothing to the drawer", () => {
    setup({ hospitalityTaxEnabled: false });
    const sale = settle([{ method: "mobile_money", amountUgx: 100_000 }]);
    expect(physicalCashCollectedFromSale(sale)).toBe(0);
  });

  it("all-cash bill still counts fully", () => {
    setup({ hospitalityTaxEnabled: false });
    const sale = settle([{ method: "cash", amountUgx: 100_000 }]);
    expect(physicalCashCollectedFromSale(sale)).toBe(100_000);
  });
});

describe("void a settled table bill — same guards as retail voidSaleLine", () => {
  const STEAK = product({ id: "steak2", name: "Steak", category: "Food", sellingPricePerUnitUgx: 50_000, stockOnHand: 20 });

  function settledSession(): { sessionId: string; saleId: string } {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
      products: [STEAK],
      sales: [],
      auditLogs: [],
      dayCloses: [],
      draftLines: [],
      draftCartDiscountUgx: 0,
      activePendingSaleId: null,
      preferences: {
        ...usePosStore.getState().preferences,
        businessType: "hospitality",
        hospitalityModeEnabled: true,
        hospitalityManualKitchenFire: true,
        hospitalityFloor: defaultHospitalityFloor(),
        hospitalityServiceChargePercent: 0,
        hospitalityTaxEnabled: false,
      },
    });
    openTestShift();
    const sessionId = openTableAndResume();
    usePosStore.getState().addHospitalityDraftLine({ product: STEAK, quantity: 1 });
    usePosStore.getState().saveTableBill();
    usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 50_000 });
    const res = usePosStore.getState().finalizeTableBill();
    expect(res.ok).toBe(true);
    return { sessionId, saleId: (res as { saleId: string }).saleId };
  }

  it("owner with an open shift can void", () => {
    const { sessionId } = settledSession();
    const r = usePosStore.getState().voidSettledTableBill({ sessionId, reason: "wrong order", managerPin: "" });
    expect(r.ok).toBe(true);
  });

  it("is refused without an active shift", () => {
    const { sessionId } = settledSession();
    usePosStore.setState((s) => ({
      preferences: { ...s.preferences, shifts: (s.preferences.shifts ?? []).map((sh) => ({ ...sh, endAt: "2026-06-11T18:00:00.000Z" })) },
    }));
    const r = usePosStore.getState().voidSettledTableBill({ sessionId, reason: "wrong order", managerPin: "" });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("noActiveShift");
  });

  it("is refused once the sale's business date is closed", () => {
    const { sessionId, saleId } = settledSession();
    const sale = usePosStore.getState().sales.find((x) => x.id === saleId)!;
    const dateKey = new Date(sale.createdAt).toLocaleDateString("sv-SE", { timeZone: "Africa/Kampala" });
    usePosStore.setState({ dayCloses: [{ id: "dc1", dateKey } as never] });
    const r = usePosStore.getState().voidSettledTableBill({ sessionId, reason: "wrong order", managerPin: "" });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("businessDateLocked");
  });

  it("is refused for a role without sale_void", () => {
    const { sessionId } = settledSession();
    usePosStore.setState({ sessionActor: { userId: "staff:sk", role: "stock_keeper", displayName: "Stock" } });
    const r = usePosStore.getState().voidSettledTableBill({ sessionId, reason: "wrong order", managerPin: "" });
    expect(r.ok).toBe(false);
  });
});

describe("re-adding a modified menu item keeps its modifier price and notes", () => {
  const BURGER_MOD = product({
    id: "burger-mod",
    name: "Burger",
    category: "Food",
    sellingPricePerUnitUgx: 10_000,
    stockOnHand: 50,
    menu: {
      productKind: "finished_menu",
      modifierGroups: [
        {
          id: "extras",
          label: "Extras",
          required: false,
          selectionMode: "multiple",
          options: [{ id: "cheese", label: "Extra cheese", priceDeltaUgx: 2_000 }],
        },
      ],
    },
  });
  const CHEESE = [{ groupId: "extras", optionId: "cheese", optionLabel: "Extra cheese", priceDeltaUgx: 2_000 }];

  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
      products: [BURGER_MOD],
      sales: [],
      auditLogs: [],
      draftLines: [],
      draftCartDiscountUgx: 0,
      activePendingSaleId: null,
      preferences: {
        ...usePosStore.getState().preferences,
        businessType: "hospitality",
        hospitalityModeEnabled: true,
        hospitalityFloor: defaultHospitalityFloor(),
      },
    });
    openTestShift();
    openTableAndResume();
  });

  it("adding the same modified item twice totals 2 x (price + modifier)", () => {
    const a = usePosStore.getState().addHospitalityDraftLine({ product: BURGER_MOD, quantity: 1, modifiers: CHEESE as never, notes: "no onions" });
    expect(a.ok).toBe(true);
    const single = usePosStore.getState().draftLines[0]!.lineTotalUgx;
    expect(single).toBe(12_000);
    usePosStore.getState().addHospitalityDraftLine({ product: BURGER_MOD, quantity: 1, modifiers: CHEESE as never, notes: "no onions" });
    const lines = usePosStore.getState().draftLines;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBe(2);
    expect(lines[0]!.lineTotalUgx).toBe(24_000);
    expect(lines[0]!.selectedModifiers?.length).toBe(1);
    expect(lines[0]!.notes).toBe("no onions");
  });

  it("changing the quantity of a modified line by id keeps the modifier price", () => {
    usePosStore.getState().addHospitalityDraftLine({ product: BURGER_MOD, quantity: 1, modifiers: CHEESE as never });
    const id = usePosStore.getState().draftLines[0]!.id!;
    expect(usePosStore.getState().adjustDraftLineQuantityById(id, 2).ok).toBe(true);
    const line = usePosStore.getState().draftLines[0]!;
    expect(line.quantity).toBe(3);
    expect(line.lineTotalUgx).toBe(36_000);
  });
});

describe("a settled bill cannot become a second financial settlement (retail: completed sales are immutable)", () => {
  const ITEM = product({ id: "grill", name: "Grill", category: "Food", sellingPricePerUnitUgx: 40_000, stockOnHand: 20 });

  function settle(): { saleId: string; sessionId: string } {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
      products: [ITEM],
      sales: [],
      auditLogs: [],
      dayCloses: [],
      draftLines: [],
      draftCartDiscountUgx: 0,
      activePendingSaleId: null,
      preferences: {
        ...usePosStore.getState().preferences,
        businessType: "hospitality",
        hospitalityModeEnabled: true,
        hospitalityManualKitchenFire: true,
        hospitalityFloor: defaultHospitalityFloor(),
        hospitalityServiceChargePercent: 0,
        hospitalityTaxEnabled: false,
      },
    });
    openTestShift();
    const sessionId = openTableAndResume();
    usePosStore.getState().addHospitalityDraftLine({ product: ITEM, quantity: 1 });
    usePosStore.getState().saveTableBill();
    usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 40_000 });
    const res = usePosStore.getState().finalizeTableBill();
    expect(res.ok).toBe(true);
    return { saleId: (res as { saleId: string }).saleId, sessionId };
  }

  const shiftSales = () => (usePosStore.getState().preferences.shifts ?? [])[0]?.salesTotalUgx ?? 0;
  const stock = () => usePosStore.getState().products.find((p) => p.id === "grill")!.stockOnHand;

  it("the reopen action no longer exists", () => {
    expect((usePosStore.getState() as unknown as Record<string, unknown>).reopenTableBill).toBeUndefined();
  });

  it("re-saving a settled bill is refused and the sale stays completed", () => {
    const { saleId, sessionId } = settle();
    const before = usePosStore.getState().sales.find((s) => s.id === saleId)!;
    // Simulate the stale-cart state that previously let a completed sale be rebuilt as pending.
    usePosStore.setState((st) => ({
      activePendingSaleId: saleId,
      draftLines: before.lines.map((l) => ({ ...l })),
      preferences: { ...st.preferences, activeTableSessionId: sessionId },
    }));
    expect(usePosStore.getState().saveTableBill().ok).toBe(false);
    expect(usePosStore.getState().fireTableStationTickets(KITCHEN_FIRE_STATION_TYPES).ok).toBe(false);
    const after = usePosStore.getState().sales.find((s) => s.id === saleId)!;
    expect(after.status).toBe(before.status);
    expect(after.totalUgx).toBe(before.totalUgx);
    expect(usePosStore.getState().sales.filter((s) => s.id === saleId)).toHaveLength(1);
  });

  it("settling the same bill twice never books revenue, stock or shift totals twice", () => {
    const { saleId, sessionId } = settle();
    const revenue = usePosStore.getState().sales.filter((s) => s.status !== "pending").reduce((n, s) => n + s.totalUgx, 0);
    const shiftBefore = shiftSales();
    const stockBefore = stock();
    usePosStore.setState((st) => ({
      activePendingSaleId: saleId,
      preferences: { ...st.preferences, activeTableSessionId: sessionId },
    }));
    usePosStore.getState().finalizeTableBill();
    const revenueAfter = usePosStore.getState().sales.filter((s) => s.status !== "pending").reduce((n, s) => n + s.totalUgx, 0);
    expect(revenueAfter).toBe(revenue);
    expect(shiftSales()).toBe(shiftBefore);
    expect(stock()).toBe(stockBefore);
    expect(usePosStore.getState().sales.filter((s) => s.id === saleId)).toHaveLength(1);
  });

  it("the supported correction path is void, which is not a second settlement", () => {
    const { sessionId } = settle();
    expect(usePosStore.getState().voidSettledTableBill({ sessionId, reason: "wrong table", managerPin: "" }).ok).toBe(true);
    expect(usePosStore.getState().voidSettledTableBill({ sessionId, reason: "again", managerPin: "" }).ok).toBe(false);
  });
});

describe("merging two open tables is operational only", () => {
  const BURGER_M = product({
    id: "burger-m",
    name: "Burger",
    category: "Food",
    sellingPricePerUnitUgx: 10_000,
    stockOnHand: 50,
    menu: {
      productKind: "finished_menu",
      modifierGroups: [
        {
          id: "extras",
          label: "Extras",
          required: false,
          selectionMode: "multiple",
          options: [
            { id: "cheese", label: "Extra cheese", priceDeltaUgx: 2_000 },
            { id: "bacon", label: "Bacon", priceDeltaUgx: 3_000 },
          ],
        },
      ],
    },
  });
  const CHEESE = [{ groupId: "extras", groupLabel: "Extras", optionId: "cheese", optionLabel: "Extra cheese", priceDeltaUgx: 2_000 }];
  const BACON = [{ groupId: "extras", groupLabel: "Extras", optionId: "bacon", optionLabel: "Bacon", priceDeltaUgx: 3_000 }];

  type LineSpec = { modifiers?: unknown; notes?: string };

  function openTwo(srcLines: LineSpec[], tgtLines: LineSpec[]) {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
      products: [BURGER_M],
      sales: [],
      auditLogs: [],
      dayCloses: [],
      draftLines: [],
      draftCartDiscountUgx: 0,
      activePendingSaleId: null,
      preferences: {
        ...usePosStore.getState().preferences,
        businessType: "hospitality",
        hospitalityModeEnabled: true,
        hospitalityManualKitchenFire: true,
        hospitalityFloor: defaultHospitalityFloor(),
        hospitalityServiceChargePercent: 0,
        hospitalityTaxEnabled: false,
      },
    });
    openTestShift();
    const floor = usePosStore.getState().preferences.hospitalityFloor!;
    const open = (tableIdx: number, lines: LineSpec[]) => {
      const r = usePosStore.getState().openTable({ tableId: floor.tables[tableIdx]!.id, guestCount: 2 });
      expect(r.ok).toBe(true);
      for (const l of lines) {
        const added = usePosStore
          .getState()
          .addHospitalityDraftLine({ product: BURGER_M, quantity: 1, modifiers: l.modifiers as never, notes: l.notes });
        expect(added.ok).toBe(true);
      }
      usePosStore.getState().saveTableBill();
      return { sessionId: (r as { sessionId: string }).sessionId, saleId: usePosStore.getState().activePendingSaleId! };
    };
    const src = open(0, srcLines);
    const tgt = open(1, tgtLines);
    return { src, tgt };
  }

  const sale = (id: string) => usePosStore.getState().sales.find((s) => s.id === id)!;
  const stock = () => usePosStore.getState().products[0]!.stockOnHand;
  const completed = () => usePosStore.getState().sales.filter((s) => s.status === "completed" || !s.status).length;
  const activate = (x: { sessionId: string; saleId: string }) =>
    usePosStore.setState((st) => ({
      activePendingSaleId: x.saleId,
      draftLines: sale(x.saleId).lines.map((l) => ({ ...l })),
      preferences: { ...st.preferences, activeTableSessionId: x.sessionId },
    }));

  it("identical modified items combine at 2 x (price + modifier) and keep the note", () => {
    const { src, tgt } = openTwo([{ modifiers: CHEESE, notes: "no onions" }], [{ modifiers: CHEESE, notes: "no onions" }]);
    const r = usePosStore.getState().mergeTableSessions(src.sessionId, tgt.sessionId);
    expect(r.ok).toBe(true);
    const lines = sale(tgt.saleId).lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBe(2);
    expect(lines[0]!.lineTotalUgx).toBe(24_000);
    expect(lines[0]!.selectedModifiers?.[0]?.optionLabel).toBe("Extra cheese");
    expect(lines[0]!.notes).toBe("no onions");
  });

  it("different configurations stay separate lines with their own prices", () => {
    const { src, tgt } = openTwo([{ modifiers: BACON }], [{ modifiers: CHEESE }]);
    expect(usePosStore.getState().mergeTableSessions(src.sessionId, tgt.sessionId).ok).toBe(true);
    const totals = sale(tgt.saleId).lines.map((l) => l.lineTotalUgx).sort((a, b) => a - b);
    expect(totals).toEqual([12_000, 13_000]);
  });

  it("the source order is cancelled with the retail pre-completion marker, never completed", () => {
    const { src, tgt } = openTwo([{ modifiers: CHEESE }], [{ modifiers: CHEESE }]);
    usePosStore.getState().mergeTableSessions(src.sessionId, tgt.sessionId);
    expect(sale(src.saleId).status).toBe("cancelled");
    expect(sale(src.saleId).saleVoidedAt).toBeTruthy();
    expect(sale(tgt.saleId).status).toBe("pending");
    expect(completed()).toBe(0);
  });

  it("creates no financial event: no completed sale, stock untouched, shift totals untouched", () => {
    const { src, tgt } = openTwo([{ modifiers: CHEESE }], [{ modifiers: CHEESE }]);
    const stockBefore = stock();
    const shiftBefore = (usePosStore.getState().preferences.shifts ?? [])[0]?.salesTotalUgx ?? 0;
    usePosStore.getState().mergeTableSessions(src.sessionId, tgt.sessionId);
    expect(completed()).toBe(0);
    expect(stock()).toBe(stockBefore);
    expect((usePosStore.getState().preferences.shifts ?? [])[0]?.salesTotalUgx ?? 0).toBe(shiftBefore);
  });

  it("is blocked when the source order already has a recorded payment", () => {
    const { src, tgt } = openTwo([{ modifiers: CHEESE }], [{ modifiers: CHEESE }]);
    activate(src);
    expect(usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 5_000 }).ok).toBe(true);
    const r = usePosStore.getState().mergeTableSessions(src.sessionId, tgt.sessionId);
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("mergeBlockedPaymentsRecorded");
    expect(sale(src.saleId).status).toBe("pending");
    expect(sale(tgt.saleId).lines).toHaveLength(1);
    expect(sale(src.saleId).billDraft?.payments?.length).toBe(1);
  });

  it("refuses a settled source, a self-merge and an unknown session", () => {
    const { src, tgt } = openTwo([{ modifiers: CHEESE }], [{ modifiers: CHEESE }]);
    expect(usePosStore.getState().mergeTableSessions(src.sessionId, src.sessionId).ok).toBe(false);
    expect(usePosStore.getState().mergeTableSessions("nope", tgt.sessionId).ok).toBe(false);
    activate(src);
    usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 12_000 });
    expect(usePosStore.getState().finalizeTableBill().ok).toBe(true);
    expect(usePosStore.getState().mergeTableSessions(src.sessionId, tgt.sessionId).ok).toBe(false);
    expect(completed()).toBe(1);
  });

  it("kitchen tickets already fired for the source are not sent again after the merge", () => {
    const { src, tgt } = openTwo([{ modifiers: CHEESE }], [{ modifiers: CHEESE }]);
    activate(src);
    expect(usePosStore.getState().fireTableStationTickets(KITCHEN_FIRE_STATION_TYPES).ticketsFired).toBe(1);
    expect(usePosStore.getState().mergeTableSessions(src.sessionId, tgt.sessionId).ok).toBe(true);
    const tickets = usePosStore.getState().preferences.hospitalityFloor!.kitchenTickets ?? [];
    expect(tickets.every((t) => t.tableSessionId === tgt.sessionId)).toBe(true);
    // merged line = 2 burgers, 1 already fired -> exactly 1 more to send, not 2
    const again = usePosStore.getState().fireTableStationTickets(KITCHEN_FIRE_STATION_TYPES);
    expect(again.ticketsFired).toBe(1);
    const firedQty = (usePosStore.getState().preferences.hospitalityFloor!.kitchenTickets ?? [])
      .flatMap((t) => t.items)
      .reduce((n, i) => n + i.quantity, 0);
    expect(firedQty).toBe(2);
  });

  it("adds the merged covers to the target session", () => {
    const { src, tgt } = openTwo([{ modifiers: CHEESE }], [{ modifiers: CHEESE }]);
    usePosStore.getState().mergeTableSessions(src.sessionId, tgt.sessionId);
    const sessions = usePosStore.getState().preferences.hospitalityFloor!.sessions;
    expect(sessions.find((x) => x.id === tgt.sessionId)!.guestCount).toBe(4);
    expect(sessions.find((x) => x.id === src.sessionId)!.status).toBe("merged");
  });
});

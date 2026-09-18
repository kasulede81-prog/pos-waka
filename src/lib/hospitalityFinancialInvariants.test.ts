/**
 * Financial invariants for Hospitality. Retail/Kiosk Duka stays the single financial source of
 * truth: every check below is made against the SAME engine retail uses (finalizeDraftSale and the
 * retail whole-bill void planner) — Hospitality never keeps its own ledger.
 */
import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { defaultHospitalityFloor } from "./hospitality";
import { BAR_FIRE_STATION_TYPES, KITCHEN_FIRE_STATION_TYPES } from "./kitchenRouting";

const mk = (id: string, name: string, category: string, price: number, cost: number, stock = 50): Product => ({
  id,
  name,
  sellingMode: "unit",
  baseUnit: "pcs",
  sellingPricePerUnitUgx: price,
  costPricePerUnitUgx: cost,
  stockOnHand: stock,
  minimumStockAlert: 0,
  category,
  sku: "",
  updatedAt: "2026-09-17T08:00:00.000Z",
  version: 1,
});

const PLATE = mk("plate", "Plate", "Food", 20_000, 8_000);
const BEER = mk("beer", "Beer", "Beer", 5_000, 3_000);

function settleFoodAndDrinks() {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
    products: [PLATE, BEER],
    sales: [],
    stockMovements: [],
    voidRecords: [],
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
  const opened = usePosStore.getState().openTable({ tableId: floor.tables[0]!.id, guestCount: 2 });
  expect(opened.ok).toBe(true);
  const sessionId = (opened as { sessionId: string }).sessionId;
  usePosStore.getState().addHospitalityDraftLine({ product: PLATE, quantity: 2 });
  usePosStore.getState().addHospitalityDraftLine({ product: BEER, quantity: 3 });
  usePosStore.getState().saveTableBill();
  usePosStore.getState().fireTableStationTickets(KITCHEN_FIRE_STATION_TYPES);
  usePosStore.getState().fireTableStationTickets(BAR_FIRE_STATION_TYPES);
  usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 55_000 });
  const res = usePosStore.getState().finalizeTableBill();
  expect(res.ok).toBe(true);
  return { saleId: (res as { saleId: string }).saleId, sessionId };
}

const sale = (id: string) => usePosStore.getState().sales.find((s) => s.id === id)!;
const stockOf = (id: string) => usePosStore.getState().products.find((p) => p.id === id)!.stockOnHand;
const shiftSales = () => (usePosStore.getState().preferences.shifts ?? [])[0]?.salesTotalUgx ?? 0;

describe("hospitality financial invariants (retail engine is the source of truth)", () => {
  it("food + drinks at one table = ONE completed sale with revenue booked once", () => {
    const { saleId } = settleFoodAndDrinks();
    const completed = usePosStore.getState().sales.filter((s) => s.status === "completed" || !s.status);
    expect(completed).toHaveLength(1);
    expect(sale(saleId).totalUgx).toBe(55_000);
    expect(sale(saleId).lines).toHaveLength(2);
    expect(shiftSales()).toBe(55_000);
  });

  it("COGS is recorded once per line from the retail cost engine", () => {
    const { saleId } = settleFoodAndDrinks();
    const cogs = sale(saleId).lines.map((l) => [l.productId, l.cogsUgx]);
    expect(Object.fromEntries(cogs)).toEqual({ plate: 16_000, beer: 9_000 });
    expect(sale(saleId).lines.reduce((n, l) => n + (l.cogsUgx ?? 0), 0)).toBe(25_000);
  });

  it("historical cost stays frozen when the product cost changes later", () => {
    const { saleId } = settleFoodAndDrinks();
    usePosStore.setState((st) => ({
      products: st.products.map((p) => (p.id === "plate" ? { ...p, costPricePerUnitUgx: 99_000, version: p.version + 1 } : p)),
    }));
    const plate = sale(saleId).lines.find((l) => l.productId === "plate")!;
    expect(plate.unitCostUgx).toBe(8_000);
    expect(plate.cogsUgx).toBe(16_000);
  });

  it("stock is deducted exactly once, with exactly one movement per line", () => {
    const { saleId } = settleFoodAndDrinks();
    expect(stockOf("plate")).toBe(48);
    expect(stockOf("beer")).toBe(47);
    const movements = usePosStore.getState().stockMovements.filter((m) => m.refId === saleId);
    expect(movements.map((m) => [m.productId, m.deltaBaseUnits]).sort()).toEqual([
      ["beer", -3],
      ["plate", -2],
    ]);
  });

  it("kitchen tickets, table transfer and repeated sends create no financial event", () => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
      products: [PLATE, BEER],
      sales: [],
      stockMovements: [],
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
      },
    });
    openTestShift();
    const floor = usePosStore.getState().preferences.hospitalityFloor!;
    const opened = usePosStore.getState().openTable({ tableId: floor.tables[0]!.id, guestCount: 2 });
    const sessionId = (opened as { sessionId: string }).sessionId;
    usePosStore.getState().addHospitalityDraftLine({ product: PLATE, quantity: 1 });
    usePosStore.getState().saveTableBill();
    usePosStore.getState().fireTableStationTickets(KITCHEN_FIRE_STATION_TYPES);
    usePosStore.getState().fireTableStationTickets(KITCHEN_FIRE_STATION_TYPES);
    usePosStore.getState().transferTableSession(sessionId, floor.tables[1]!.id);
    const tickets = usePosStore.getState().preferences.hospitalityFloor!.kitchenTickets ?? [];
    for (const t of tickets) usePosStore.getState().advanceKitchenTicket(t.id);
    expect(usePosStore.getState().sales.filter((s) => s.status === "completed" || !s.status)).toHaveLength(0);
    expect(usePosStore.getState().stockMovements).toHaveLength(0);
    expect(stockOf("plate")).toBe(50);
    expect(shiftSales()).toBe(0);
  });

  it("void follows retail's lifecycle: original sale kept, stock restored once, void booked once (net revenue and cash back to zero)", () => {
    const { saleId, sessionId } = settleFoodAndDrinks();
    const shift = () => (usePosStore.getState().preferences.shifts ?? [])[0]!;
    expect(shift().salesTotalUgx).toBe(55_000);
    expect(usePosStore.getState().voidSettledTableBill({ sessionId, reason: "wrong table", managerPin: "" }).ok).toBe(true);
    const voided = sale(saleId);
    expect(voided.saleVoidedAt).toBeTruthy();
    expect(usePosStore.getState().sales.filter((s) => s.id === saleId)).toHaveLength(1);
    expect(stockOf("plate")).toBe(50);
    expect(stockOf("beer")).toBe(50);
    // Retail books gross sales and the void separately (net = 0) and takes the cash back out.
    expect(shift().salesTotalUgx).toBe(55_000);
    expect(shift().voidsTotalUgx).toBe(55_000);
    expect(shift().salesTotalUgx - (shift().voidsTotalUgx ?? 0)).toBe(0);
    expect(shift().estimatedCashUgx).toBe(0);
    // a second void must not restore stock again or book the void again
    expect(usePosStore.getState().voidSettledTableBill({ sessionId, reason: "again", managerPin: "" }).ok).toBe(false);
    expect(stockOf("plate")).toBe(50);
    expect(shift().voidsTotalUgx).toBe(55_000);
    expect(usePosStore.getState().stockMovements.filter((m) => m.productId === "plate")).toHaveLength(2); // sale + restore
  });
});

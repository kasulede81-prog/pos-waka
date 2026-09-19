/**
 * Round 3 / P7 — combo quantity repricing.
 *
 * Changing the quantity of a combo line rebuilt it as a plain product (dropping the combo price and
 * slot extras), and the combo builder itself added the slot extras a second time. The combo engine
 * (`computeComboLinePriceUgx`) is now the single price authority for both the first add and any
 * later quantity change, and the total is checked all the way to the settled sale.
 */
import { describe, expect, it } from "vitest";
import type { Product, SaleLineComboSelection } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { defaultHospitalityFloor } from "./hospitality";
import { buildComboSaleLine, computeComboLinePriceUgx } from "./comboMeals";

const mk = (id: string, price: number, extra: Partial<Product> = {}): Product => ({
  id,
  name: id,
  sellingMode: "unit",
  baseUnit: "pcs",
  sellingPricePerUnitUgx: price,
  costPricePerUnitUgx: 1_000,
  stockOnHand: 50,
  minimumStockAlert: 0,
  category: "Food",
  sku: "",
  updatedAt: "2026-09-17T08:00:00.000Z",
  version: 1,
  ...extra,
});

const fries = mk("fries", 3_000);
const soda = mk("soda", 2_000);
const cola = mk("cola", 2_500);
const comboSlots = [
  { id: "s1", label: "Side", required: true, choices: [{ productId: "fries", priceDeltaUgx: 0 }] },
  {
    id: "s2",
    label: "Drink",
    required: true,
    choices: [
      { productId: "soda", priceDeltaUgx: 0 },
      { productId: "cola", priceDeltaUgx: 500 },
    ],
  },
];
const fixedCombo = mk("combo", 5_000, {
  menu: { productKind: "finished_menu", combo: { comboPriceUgx: 12_000, slots: comboSlots } } as never,
});
const summedCombo = mk("sumcombo", 5_000, {
  menu: { productKind: "finished_menu", combo: { comboPriceUgx: null, slots: comboSlots } } as never,
});
const products = [fries, soda, cola, fixedCombo, summedCombo];

const withCola: SaleLineComboSelection[] = [
  { slotId: "s1", slotLabel: "Side", productId: "fries", productName: "fries", priceDeltaUgx: 0 },
  { slotId: "s2", slotLabel: "Drink", productId: "cola", productName: "cola", priceDeltaUgx: 500 },
];

const st = () => usePosStore.getState();

function openOrder() {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
    products: products.map((p) => ({ ...p })),
    customers: [],
    sales: [],
    stockMovements: [],
    voidRecords: [],
    auditLogs: [],
    dayCloses: [],
    draftLines: [],
    draftCartDiscountUgx: 0,
    activePendingSaleId: null,
    preferences: {
      ...st().preferences,
      businessType: "hospitality",
      hospitalityModeEnabled: true,
      hospitalityFloor: defaultHospitalityFloor(),
      hospitalityServiceChargePercent: 0,
      hospitalityTaxEnabled: false,
    },
  });
  openTestShift();
  const floor = st().preferences.hospitalityFloor!;
  expect(st().openTable({ tableId: floor.tables[0]!.id, guestCount: 2 }).ok).toBe(true);
}

describe("combo line price (builder)", () => {
  it("fixed combo price + slot extras, × quantity — extras are not double counted", () => {
    for (const q of [1, 2, 3]) {
      const line = buildComboSaleLine({ comboProduct: fixedCombo, selections: withCola, products, quantity: q }).line!;
      expect(line.lineTotalUgx).toBe(12_500 * q);
      expect(line.lineTotalUgx).toBe(computeComboLinePriceUgx(fixedCombo, withCola, products, q));
      expect(line.originalLineTotalUgx).toBe(12_500 * q);
    }
  });

  it("component-sum combo: base + each chosen component + extras, × quantity", () => {
    // 5,000 + fries 3,000 + cola 2,500 + extra 500 = 11,000 per combo
    for (const q of [1, 2, 4]) {
      const line = buildComboSaleLine({ comboProduct: summedCombo, selections: withCola, products, quantity: q }).line!;
      expect(line.lineTotalUgx).toBe(11_000 * q);
    }
  });
});

describe("changing a combo line's quantity", () => {
  it("keeps the combo price and extras (12,500 per combo), up and down", () => {
    openOrder();
    expect(st().addHospitalityDraftLine({ product: fixedCombo, comboSelections: withCola, quantity: 1 }).ok).toBe(true);
    const lineId = st().draftLines[0]!.id!;
    expect(st().draftLines[0]!.lineTotalUgx).toBe(12_500);

    expect(st().adjustDraftLineQuantityById(lineId, +1).ok).toBe(true);
    let l = st().draftLines[0]!;
    expect([l.quantity, l.lineTotalUgx, l.unitPriceUgx]).toEqual([2, 25_000, 12_500]);
    expect(l.id).toBe(lineId);
    expect(l.isComboMeal).toBe(true);
    expect(l.comboSelections).toHaveLength(2);

    expect(st().adjustDraftLineQuantityById(lineId, +2).ok).toBe(true);
    l = st().draftLines[0]!;
    expect([l.quantity, l.lineTotalUgx]).toEqual([4, 50_000]);

    expect(st().adjustDraftLineQuantityById(lineId, -3).ok).toBe(true);
    l = st().draftLines[0]!;
    expect([l.quantity, l.lineTotalUgx]).toEqual([1, 12_500]);
  });

  it("the adjusted combo settles at the combo price (revenue = bill)", () => {
    openOrder();
    expect(st().addHospitalityDraftLine({ product: fixedCombo, comboSelections: withCola, quantity: 1 }).ok).toBe(true);
    expect(st().adjustDraftLineQuantityById(st().draftLines[0]!.id!, +2).ok).toBe(true); // 3 combos
    expect(st().saveTableBill().ok).toBe(true);
    expect(st().recordTableBillPayment({ method: "cash", amountUgx: 37_500 }).ok).toBe(true);
    const res = st().finalizeTableBill();
    expect(res.ok).toBe(true);
    const sale = st().sales.find((s) => s.status === "completed")!;
    expect(sale.totalUgx).toBe(37_500);
    expect(sale.lines[0]!.lineTotalUgx).toBe(37_500);
    expect(sale.subtotalUgx).toBe(37_500);
  });

  it("a plain (non-combo) line still rebuilds as before", () => {
    openOrder();
    expect(st().addHospitalityDraftLine({ product: fries, quantity: 1 }).ok).toBe(true);
    expect(st().adjustDraftLineQuantityById(st().draftLines[0]!.id!, +2).ok).toBe(true);
    expect(st().draftLines[0]!.lineTotalUgx).toBe(9_000);
  });

  it("a combo whose slot choice was removed from the menu is refused instead of mispriced", () => {
    openOrder();
    expect(st().addHospitalityDraftLine({ product: fixedCombo, comboSelections: withCola, quantity: 1 }).ok).toBe(true);
    const lineId = st().draftLines[0]!.id!;
    usePosStore.setState({
      products: st().products.map((p) =>
        p.id === "combo"
          ? {
              ...p,
              menu: {
                ...p.menu!,
                combo: {
                  comboPriceUgx: 12_000,
                  slots: comboSlots.map((s) => (s.id === "s2" ? { ...s, choices: [{ productId: "soda", priceDeltaUgx: 0 }] } : s)),
                },
              },
            }
          : p,
      ) as never,
    });
    const res = st().adjustDraftLineQuantityById(lineId, +1);
    expect(res.ok).toBe(false);
    expect(st().draftLines[0]!.quantity).toBe(1);
    expect(st().draftLines[0]!.lineTotalUgx).toBe(12_500);
  });
});

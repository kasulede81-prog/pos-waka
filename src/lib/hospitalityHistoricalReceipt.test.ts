/**
 * Round 3 / P6 — a settled bill's receipt is history.
 *
 * Reprints used to recompute service charge / tax / tip from TODAY's settings, so editing the tax rate
 * or turning service charge off silently rewrote old receipts (and made them disagree with the revenue
 * recorded on the Sale). Settled and voided sales now print the money that was recorded when they were
 * finalized; pending bills keep the live preview.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Product, Sale, ShopPreferences } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { defaultHospitalityFloor } from "./hospitality";
import { buildRestaurantReceiptLines, receiptTotalsForSale, restaurantReceiptSummary } from "./restaurantReceiptPrint";

const PLATE: Product = {
  id: "plate",
  name: "Plate",
  sellingMode: "unit",
  baseUnit: "pcs",
  sellingPricePerUnitUgx: 20_000,
  costPricePerUnitUgx: 8_000,
  stockOnHand: 50,
  minimumStockAlert: 0,
  category: "Food",
  sku: "",
  updatedAt: "2026-09-17T08:00:00.000Z",
  version: 1,
};

const st = () => usePosStore.getState();
const prefsNow = () => st().preferences;
const saleById = (id: string) => st().sales.find((s) => s.id === id)!;

function seed(prefsPatch: Partial<ShopPreferences>) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
    products: [{ ...PLATE }],
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
      ...prefsPatch,
    },
  });
  openTestShift();
}

/** 2 plates = 40,000 list; service 10% = 4,000; exclusive tax 18% of 44,000 = 7,920; total 51,920. */
function settleWithServiceAndTax() {
  seed({
    hospitalityServiceChargePercent: 10,
    hospitalityTaxEnabled: true,
    hospitalityTaxPercent: 18,
    hospitalityTaxMode: "exclusive",
  });
  const floor = prefsNow().hospitalityFloor!;
  const opened = st().openTable({ tableId: floor.tables[0]!.id, guestCount: 2 });
  expect(opened.ok).toBe(true);
  const sessionId = (opened as { sessionId: string }).sessionId;
  st().addHospitalityDraftLine({ product: PLATE, quantity: 2 });
  expect(st().saveTableBill().ok).toBe(true);
  const pendingId = st().activePendingSaleId!;
  expect(st().recordTableBillPayment({ method: "cash", amountUgx: 51_920 }).ok).toBe(true);
  const res = st().finalizeTableBill();
  expect(res.ok).toBe(true);
  return { saleId: (res as { saleId?: string }).saleId ?? pendingId, sessionId };
}

const ctxFor = (sale: Sale) => ({ sale, products: st().products, prefs: prefsNow(), lang: "en" as const });
const text = (sale: Sale, extra: object = {}) => buildRestaurantReceiptLines({ ...ctxFor(sale), ...extra }).join("\n");

describe("historical receipts print the recorded money", () => {
  let saleId: string;
  beforeEach(() => {
    ({ saleId } = settleWithServiceAndTax());
  });

  it("the sale itself recorded the breakdown", () => {
    const s = saleById(saleId);
    expect(s.subtotalUgx).toBe(40_000);
    expect(s.serviceChargeUgx).toBe(4_000);
    expect(s.taxUgx).toBe(7_920);
    expect(s.totalUgx).toBe(51_920);
  });

  it("a reprint after the service charge is switched off, tax disabled and tip changed still shows the original bill", () => {
    const before = text(saleById(saleId), { reprint: true });
    expect(before).toContain("51,920");

    usePosStore.setState({
      preferences: {
        ...prefsNow(),
        hospitalityServiceChargePercent: 0,
        hospitalityTaxEnabled: false,
        hospitalityTaxPercent: 0,
      },
    });
    const after = text(saleById(saleId), { reprint: true });
    expect(after).toBe(before);
    expect(after).toContain("UGX 4,000"); // service charge
    expect(after).toContain("UGX 7,920"); // tax
    expect(after).toContain("UGX 51,920"); // total
  });

  it("a later tax MODE change (exclusive → inclusive) does not rewrite the receipt or its summary", () => {
    const summaryBefore = restaurantReceiptSummary(ctxFor(saleById(saleId)));
    usePosStore.setState({ preferences: { ...prefsNow(), hospitalityTaxMode: "inclusive", hospitalityTaxPercent: 5 } });
    expect(restaurantReceiptSummary(ctxFor(saleById(saleId)))).toBe(summaryBefore);
    expect(summaryBefore).toContain("51,920");
    expect(text(saleById(saleId))).toContain("UGX 7,920");
  });

  it("the printed total always equals the recorded revenue", () => {
    usePosStore.setState({ preferences: { ...prefsNow(), hospitalityServiceChargePercent: 25 } });
    const totals = receiptTotalsForSale(ctxFor(saleById(saleId)), saleById(saleId).lines, null);
    expect(totals.grandTotalUgx).toBe(saleById(saleId).totalUgx);
  });

  it("a void receipt still shows the ORIGINAL bill total, not the zeroed one", () => {
    const sessionId = saleById(saleId).tableSessionId!;
    expect(st().voidSettledTableBill({ sessionId, reason: "wrong table", managerPin: "" }).ok).toBe(true);
    const voided = saleById(saleId);
    expect(voided.totalUgx).toBe(0);
    const t = text(voided, { receiptKind: "void" });
    expect(t).toContain("*** VOID ***");
    expect(t).toContain("UGX 51,920");
    expect(receiptTotalsForSale(ctxFor(voided), voided.lines, null).grandTotalUgx).toBe(51_920);
  });
});

describe("pending bills stay live", () => {
  it("an unsettled bill previews from the bill's own settings", () => {
    seed({ hospitalityServiceChargePercent: 10, hospitalityTaxEnabled: false });
    const floor = prefsNow().hospitalityFloor!;
    expect(st().openTable({ tableId: floor.tables[0]!.id, guestCount: 2 }).ok).toBe(true);
    st().addHospitalityDraftLine({ product: PLATE, quantity: 2 });
    expect(st().saveTableBill().ok).toBe(true);
    const pendingId = st().activePendingSaleId!;
    expect(saleById(pendingId).status).toBe("pending");
    const live = receiptTotalsForSale(ctxFor(saleById(pendingId)), st().draftLines, null);
    expect(live.serviceChargeUgx).toBe(4_000);
    expect(live.grandTotalUgx).toBe(44_000);
  });
});

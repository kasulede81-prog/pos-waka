import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Product, Sale, SaleLine } from "../types";
import { attributeSalePaymentBuckets } from "./cashPosition";
import { physicalCashCollectedFromSale } from "./cashDrawerSales";
import { mergeSaleFromCloudPull } from "./saleFinancialMerge";
import {
  hasAuthoritativeTenderCash,
  normalizeTenderCashUgx,
  parsePersistedTenderCashUgx,
  physicalCashTenderFromCheckoutInputs,
} from "./saleTenderCash";
import { buildPendingSalePushPayload, buildSalePushPayload } from "../offline/cloudSync";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";

const ROOT = process.cwd();
const CLOUD_SYNC = readFileSync(resolve(ROOT, "src/offline/cloudSync.ts"), "utf8");
const CTX = {
  shopId: "44444444-4444-4444-8444-444444444444",
  userId: "11111111-1111-4111-8111-111111111111",
};

const AT = "2026-09-05T10:00:00.000Z";

function line(total: number): SaleLine {
  return {
    productId: "prod-1",
    name: "Widget",
    quantity: 1,
    unitPriceUgx: total,
    unitCostUgx: 40_000,
    estimatedProfitUgx: total - 40_000,
    inputMode: "quantity",
    lineTotalUgx: total,
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "totalUgx">): Sale {
  const total = partial.totalUgx;
  const debt = partial.debtUgx ?? 0;
  return {
    createdAt: AT,
    updatedAt: AT,
    status: "completed",
    subtotalUgx: total,
    cashPaidUgx: partial.cashPaidUgx ?? Math.max(0, total - debt),
    debtUgx: debt,
    estimatedProfitUgx: Math.max(0, total - 40_000),
    lines: [line(total)],
    pendingSync: false,
    ...partial,
  };
}

describe("CASH-POST-01A physical cash tender", () => {
  it("CASE A — credit cash+MoMo+debt: tender 30k, physical 30k, collected unchanged", () => {
    const tender = physicalCashTenderFromCheckoutInputs({
      paymentMethod: "credit",
      cashInput: "30000",
      draftPayable: 100_000,
    });
    expect(tender).toBe(30_000);
    const s = sale({
      id: "a",
      totalUgx: 100_000,
      cashPaidUgx: 50_000,
      amountPaidUgx: 50_000,
      debtUgx: 50_000,
      paymentMethod: "credit",
      tenderCashUgx: tender,
    });
    expect(s.cashPaidUgx).toBe(50_000);
    expect(s.amountPaidUgx).toBe(50_000);
    expect(s.debtUgx).toBe(50_000);
    expect(s.totalUgx).toBe(s.cashPaidUgx + s.debtUgx);
    expect(s.paymentMethod).toBe("credit");
    expect(physicalCashCollectedFromSale(s)).toBe(30_000);
    expect(attributeSalePaymentBuckets(s)).toMatchObject({
      cash: 30_000,
      mobile_money: 20_000,
      credit: 50_000,
    });
  });

  it("CASE B — full cash: physical 100k", () => {
    const tender = physicalCashTenderFromCheckoutInputs({
      paymentMethod: "cash",
      cashInput: "100000",
      draftPayable: 100_000,
    });
    expect(tender).toBe(100_000);
    const s = sale({
      id: "b",
      totalUgx: 100_000,
      cashPaidUgx: 100_000,
      amountPaidUgx: 100_000,
      debtUgx: 0,
      paymentMethod: "cash",
      tenderCashUgx: tender,
    });
    expect(physicalCashCollectedFromSale(s)).toBe(100_000);
  });

  it("CASE C — credit MoMo+debt, no cash: physical 0", () => {
    const tender = physicalCashTenderFromCheckoutInputs({
      paymentMethod: "credit",
      cashInput: "",
      draftPayable: 100_000,
    });
    expect(tender).toBe(0);
    const s = sale({
      id: "c",
      totalUgx: 100_000,
      cashPaidUgx: 50_000,
      amountPaidUgx: 50_000,
      debtUgx: 50_000,
      paymentMethod: "credit",
      tenderCashUgx: tender,
    });
    expect(physicalCashCollectedFromSale(s)).toBe(0);
    expect(attributeSalePaymentBuckets(s)).toMatchObject({
      cash: 0,
      mobile_money: 50_000,
      credit: 50_000,
    });
  });

  it("CASE D — full debt: physical 0", () => {
    const tender = physicalCashTenderFromCheckoutInputs({
      paymentMethod: "credit",
      cashInput: "",
      draftPayable: 100_000,
    });
    const s = sale({
      id: "d",
      totalUgx: 100_000,
      cashPaidUgx: 0,
      amountPaidUgx: 0,
      debtUgx: 100_000,
      paymentMethod: "credit",
      tenderCashUgx: tender,
    });
    expect(physicalCashCollectedFromSale(s)).toBe(0);
  });

  it("CASE E — credit cash+debt, no MoMo: physical 50k", () => {
    const tender = physicalCashTenderFromCheckoutInputs({
      paymentMethod: "credit",
      cashInput: "50000",
      draftPayable: 100_000,
    });
    expect(tender).toBe(50_000);
    const s = sale({
      id: "e",
      totalUgx: 100_000,
      cashPaidUgx: 50_000,
      amountPaidUgx: 50_000,
      debtUgx: 50_000,
      paymentMethod: "credit",
      tenderCashUgx: tender,
    });
    expect(physicalCashCollectedFromSale(s)).toBe(50_000);
  });

  it("CASE F — mobile money: physical 0", () => {
    const tender = physicalCashTenderFromCheckoutInputs({
      paymentMethod: "mobile_money",
      cashInput: "100000",
      draftPayable: 100_000,
    });
    expect(tender).toBe(0);
    const s = sale({
      id: "f",
      totalUgx: 100_000,
      cashPaidUgx: 100_000,
      amountPaidUgx: 100_000,
      debtUgx: 0,
      paymentMethod: "mobile_money",
      tenderCashUgx: tender,
    });
    expect(physicalCashCollectedFromSale(s)).toBe(0);
  });

  it("legacy sale without tenderCashUgx does not crash and uses non-authoritative total−debt", () => {
    const s = sale({
      id: "legacy",
      totalUgx: 100_000,
      cashPaidUgx: 50_000,
      amountPaidUgx: 50_000,
      debtUgx: 50_000,
      paymentMethod: "credit",
    });
    expect(hasAuthoritativeTenderCash(s)).toBe(false);
    expect(s.tenderCashUgx).toBeUndefined();
    expect(physicalCashCollectedFromSale(s)).toBe(50_000);
    expect(attributeSalePaymentBuckets(s).cash).toBe(50_000);
  });

  it("legacy fallback is distinguishable from authoritative tender data", () => {
    const legacy = sale({
      id: "legacy",
      totalUgx: 100_000,
      cashPaidUgx: 50_000,
      debtUgx: 50_000,
      paymentMethod: "credit",
    });
    const next = sale({
      id: "next",
      totalUgx: 100_000,
      cashPaidUgx: 50_000,
      debtUgx: 50_000,
      paymentMethod: "credit",
      tenderCashUgx: 30_000,
    });
    expect(hasAuthoritativeTenderCash(legacy)).toBe(false);
    expect(hasAuthoritativeTenderCash(next)).toBe(true);
    expect(physicalCashCollectedFromSale(legacy)).toBe(50_000);
    expect(physicalCashCollectedFromSale(next)).toBe(30_000);
  });

  it("tenderCashUgx cannot exceed amountPaidUgx", () => {
    expect(normalizeTenderCashUgx(80_000, 50_000)).toBe(50_000);
    expect(normalizeTenderCashUgx(50_000, 50_000)).toBe(50_000);
  });

  it("negative tenderCashUgx is clamped to 0", () => {
    expect(normalizeTenderCashUgx(-1, 50_000)).toBe(0);
    expect(parsePersistedTenderCashUgx(-12.9)).toBe(0);
  });

  it("empty cash cash-sale treats payable as physical cash tender", () => {
    expect(
      physicalCashTenderFromCheckoutInputs({
        paymentMethod: "cash",
        cashInput: "",
        draftPayable: 100_000,
      }),
    ).toBe(100_000);
  });

  it("serialization and cloud metadata preserve tenderCashUgx without redefining cashPaidUgx", () => {
    const s = sale({
      id: "55555555-5555-4555-8555-555555555555",
      totalUgx: 100_000,
      cashPaidUgx: 50_000,
      amountPaidUgx: 50_000,
      debtUgx: 50_000,
      paymentMethod: "credit",
      tenderCashUgx: 30_000,
    });
    const local = JSON.parse(JSON.stringify(s)) as Sale;
    expect(local.tenderCashUgx).toBe(30_000);
    expect(local.cashPaidUgx).toBe(50_000);

    const payload = buildSalePushPayload(s, CTX);
    const meta = payload.sale.metadata as Record<string, unknown>;
    expect(payload.sale.cash_amount_ugx).toBe(50_000);
    expect(payload.sale.debt_amount_ugx).toBe(50_000);
    expect(meta.tenderCashUgx).toBe(30_000);
    expect(meta.paymentMethod).toBe("credit");
    expect(parsePersistedTenderCashUgx(meta.tenderCashUgx)).toBe(30_000);

    const pending = buildPendingSalePushPayload(s, CTX);
    expect(pending.sale.metadata.tenderCashUgx).toBe(30_000);
  });

  it("cloudSync push/pull wiring uses the same metadata key as paymentMethod", () => {
    expect(CLOUD_SYNC).toMatch(/tenderCashUgx: sale\.tenderCashUgx \?\? null/);
    expect(CLOUD_SYNC).toMatch(/tenderCashUgx: parsePersistedTenderCashUgx\(meta\.tenderCashUgx\)/);
  });

  it("retail and pharmacy checkout persist cash input via the shared helper", () => {
    const pos = readFileSync(resolve(ROOT, "src/pages/PosPage.tsx"), "utf8");
    const pharmacy = readFileSync(resolve(ROOT, "src/hooks/usePharmacyDispenseCheckout.ts"), "utf8");
    expect(pos).toMatch(/tenderCashUgx: physicalCashTenderFromCheckoutInputs/);
    expect(pharmacy).toMatch(/tenderCashUgx: physicalCashTenderFromCheckoutInputs/);
  });

  it("cloud pull merge preserves tenderCashUgx", () => {
    const local = sale({
      id: "merge-local",
      totalUgx: 100_000,
      cashPaidUgx: 50_000,
      debtUgx: 50_000,
      paymentMethod: "credit",
      tenderCashUgx: 30_000,
    });
    const remote = sale({
      id: "merge-local",
      totalUgx: 100_000,
      cashPaidUgx: 50_000,
      debtUgx: 50_000,
      paymentMethod: "credit",
      tenderCashUgx: 30_000,
      updatedAt: "2026-09-05T11:00:00.000Z",
    });
    const merged = mergeSaleFromCloudPull(local, remote);
    expect(merged.tenderCashUgx).toBe(30_000);
    expect(merged.cashPaidUgx).toBe(50_000);
    expect(merged.debtUgx).toBe(50_000);
    expect(physicalCashCollectedFromSale(merged)).toBe(30_000);
  });

  it("invalid persisted tender does not crash the classifier", () => {
    const s = sale({
      id: "bad",
      totalUgx: 100_000,
      cashPaidUgx: 50_000,
      debtUgx: 50_000,
      paymentMethod: "credit",
      tenderCashUgx: Number.NaN,
    });
    expect(hasAuthoritativeTenderCash(s)).toBe(false);
    expect(physicalCashCollectedFromSale(s)).toBe(50_000);
    expect(parsePersistedTenderCashUgx("nope")).toBeUndefined();
    expect(parsePersistedTenderCashUgx(null)).toBeUndefined();
  });
});

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUSTOMER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const baseProduct: Product = {
  id: PRODUCT_ID,
  name: "Soap",
  sellingPricePerUnitUgx: 100_000,
  costPricePerUnitUgx: 40_000,
  stockOnHand: 20,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-06-01T08:00:00.000Z",
  version: 1,
};

const draftLine: SaleLine = {
  id: "line-1",
  productId: PRODUCT_ID,
  name: "Soap",
  inputMode: "quantity",
  quantity: 1,
  unitPriceUgx: 100_000,
  unitCostUgx: 40_000,
  lineTotalUgx: 100_000,
  estimatedProfitUgx: 60_000,
  updatedAt: "2026-06-02T10:00:00.000Z",
};

describe("CASH-POST-01A finalizeDraftSale persists tender without redefining collected", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "staff:1", role: "owner", displayName: "Owner" },
      products: [baseProduct],
      customers: [
        {
          id: CUSTOMER_ID,
          name: "Jane",
          phone: "0700000000",
          location: "",
          debtBalanceUgx: 0,
          createdAt: "2026-06-01T08:00:00.000Z",
          version: 1,
        },
      ],
      sales: [],
      debtPayments: [],
      draftLines: [{ ...draftLine }],
      draftCartDiscountUgx: 0,
    });
    expect(openTestShift().ok).toBe(true);
  });

  it("CASE A finalize: cashPaid stays collected; tenderCash is 30k; physical is 30k", () => {
    const r = usePosStore.getState().finalizeDraftSale({
      debtUgx: 50_000,
      customerId: CUSTOMER_ID,
      paymentMethod: "credit",
      amountPaidUgx: 50_000,
      tenderCashUgx: 30_000,
      changeGivenUgx: 0,
    });
    expect(r.ok).toBe(true);
    const completed = usePosStore.getState().sales.find((s) => s.id === r.saleId)!;
    expect(completed.totalUgx).toBe(100_000);
    expect(completed.cashPaidUgx).toBe(50_000);
    expect(completed.amountPaidUgx).toBe(50_000);
    expect(completed.debtUgx).toBe(50_000);
    expect(completed.paymentMethod).toBe("credit");
    expect(completed.tenderCashUgx).toBe(30_000);
    expect(completed.totalUgx).toBe(completed.cashPaidUgx + completed.debtUgx);
    expect(physicalCashCollectedFromSale(completed)).toBe(30_000);
  });

  it("clamps tender above amount paid and rejects negative via normalize", () => {
    const r = usePosStore.getState().finalizeDraftSale({
      debtUgx: 50_000,
      customerId: CUSTOMER_ID,
      paymentMethod: "credit",
      amountPaidUgx: 50_000,
      tenderCashUgx: 80_000,
    });
    expect(r.ok).toBe(true);
    const completed = usePosStore.getState().sales.find((s) => s.id === r.saleId)!;
    expect(completed.tenderCashUgx).toBe(50_000);
    expect(completed.cashPaidUgx).toBe(50_000);
  });

  it("hospitality-style finalize without tenderCashUgx leaves the field absent (legacy)", () => {
    const r = usePosStore.getState().finalizeDraftSale({
      debtUgx: 50_000,
      customerId: CUSTOMER_ID,
      paymentMethod: "credit",
      amountPaidUgx: 50_000,
    });
    expect(r.ok).toBe(true);
    const completed = usePosStore.getState().sales.find((s) => s.id === r.saleId)!;
    expect(completed.tenderCashUgx).toBeUndefined();
    expect(hasAuthoritativeTenderCash(completed)).toBe(false);
    expect(physicalCashCollectedFromSale(completed)).toBe(50_000);
  });
});

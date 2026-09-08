import { describe, expect, it } from "vitest";
import type { Sale, SaleLine } from "../types";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import {
  captureCloudCompleteFinancials,
  saleHeaderForCloudComplete,
} from "./saleCloudCompleteFinancials";
import { buildSalePushPayload } from "../offline/cloudSync";

const SHOP = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const SALE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function line(): SaleLine {
  return {
    id: "line-1",
    productId: PRODUCT,
    name: "Soap",
    quantity: 1,
    unitPriceUgx: 2000,
    unitCostUgx: 500,
    estimatedProfitUgx: 1500,
    inputMode: "quantity",
    lineTotalUgx: 2000,
  };
}

function sale(partial: Partial<Sale> = {}): Sale {
  const snapshot = captureCloudCompleteFinancials({
    subtotalUgx: 2000,
    totalUgx: 2000,
    cashPaidUgx: 2000,
    debtUgx: 0,
    discountTotalUgx: 0,
  });
  return {
    id: SALE,
    status: "completed",
    createdAt: "2026-09-07T22:43:05.537Z",
    lines: [line()],
    subtotalUgx: 2000,
    totalUgx: 2000,
    cashPaidUgx: 2000,
    debtUgx: 0,
    discountTotalUgx: 0,
    estimatedProfitUgx: 1500,
    pendingSync: true,
    cloudCompleteFinancials: snapshot,
    ...partial,
  };
}

describe("cloud complete financial snapshot", () => {
  it("keeps original totals after a local return shrinks the live header", () => {
    const original = sale();
    const reduced = { ...original, ...reduceSaleTotalsByAmount(original, 2000), pendingSync: true };
    expect(reduced.totalUgx).toBe(0);
    expect(saleHeaderForCloudComplete(reduced).totalUgx).toBe(2000);
    expect(saleHeaderForCloudComplete(reduced).cashPaidUgx).toBe(2000);
    const payload = buildSalePushPayload(reduced, { shopId: SHOP, userId: USER });
    expect(payload.sale.total_ugx).toBe(2000);
    expect(payload.sale.cash_amount_ugx).toBe(2000);
    expect(payload.payments[0]?.amount_ugx).toBe(2000);
  });

  it("legacy all-cash pending rows without a snapshot restore from voidedTotalUgx", () => {
    const original = sale({ cloudCompleteFinancials: null });
    const reduced = { ...original, ...reduceSaleTotalsByAmount(original, 2000), pendingSync: true };
    expect(reduced.cloudCompleteFinancials).toBeNull();
    expect(saleHeaderForCloudComplete(reduced).totalUgx).toBe(2000);
    expect(saleHeaderForCloudComplete(reduced).cashPaidUgx).toBe(2000);
  });

  it("reload between sale and return keeps the checkout snapshot", () => {
    const original = sale();
    const reduced = { ...original, ...reduceSaleTotalsByAmount(original, 2000), pendingSync: true };
    const reloaded = JSON.parse(JSON.stringify(reduced)) as Sale;
    expect(reloaded.totalUgx).toBe(0);
    expect(reloaded.cloudCompleteFinancials?.totalUgx).toBe(2000);
    const payload = buildSalePushPayload(reloaded, { shopId: SHOP, userId: USER });
    expect(payload.sale.total_ugx).toBe(2000);
    expect(payload.payments[0]?.amount_ugx).toBe(2000);
  });
});

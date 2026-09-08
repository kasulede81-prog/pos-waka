/**
 * Isolated sale→return race fixture. Not a production transaction.
 */
import { describe, expect, it } from "vitest";
import type { Sale } from "../types";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import {
  captureCloudCompleteFinancials,
  saleHeaderForCloudComplete,
} from "./saleCloudCompleteFinancials";
import { buildSalePushPayload } from "../offline/cloudSync";
import { linkedSaleAdjustmentDecision } from "./saleAdjustmentSync";

const SHOP = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function originalSale(): Sale {
  const snapshot = captureCloudCompleteFinancials({
    subtotalUgx: 2000,
    totalUgx: 2000,
    cashPaidUgx: 2000,
    debtUgx: 0,
    discountTotalUgx: 0,
  });
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "completed",
    createdAt: "2026-09-07T22:43:05.537Z",
    lines: [
      {
        id: "line-1",
        productId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Soap",
        quantity: 2,
        unitPriceUgx: 1000,
        unitCostUgx: 500,
        estimatedProfitUgx: 1000,
        inputMode: "quantity",
        lineTotalUgx: 2000,
      },
    ],
    subtotalUgx: 2000,
    totalUgx: 2000,
    cashPaidUgx: 2000,
    debtUgx: 0,
    discountTotalUgx: 0,
    estimatedProfitUgx: 1000,
    pendingSync: true,
    cloudCompleteFinancials: snapshot,
  };
}

describe("sale → return race fixture", () => {
  it("keeps original 2000 on sale upload after a local 2000 return", () => {
    const original = originalSale();
    const reduced = { ...original, ...reduceSaleTotalsByAmount(original, 2000), pendingSync: true };
    expect(reduced.totalUgx).toBe(0);
    expect(reduced.cloudCompleteFinancials?.totalUgx).toBe(2000);
    const payload = buildSalePushPayload(reduced, { shopId: SHOP, userId: USER });
    expect(payload.sale.total_ugx).toBe(2000);
    expect(payload.payments[0]?.amount_ugx).toBe(2000);
    expect(linkedSaleAdjustmentDecision(reduced, reduced.id)).toBe("wait");
    expect(linkedSaleAdjustmentDecision({ ...reduced, pendingSync: false }, reduced.id)).toBe("proceed");
  });

  it("void before sale ACK also waits, and a reload keeps the snapshot", () => {
    const original = originalSale();
    const afterVoid = { ...original, ...reduceSaleTotalsByAmount(original, 2000), pendingSync: true };
    expect(linkedSaleAdjustmentDecision(afterVoid, afterVoid.id)).toBe("wait");
    const reloaded = JSON.parse(JSON.stringify(afterVoid)) as Sale;
    expect(saleHeaderForCloudComplete(reloaded).totalUgx).toBe(2000);
  });

  it("legacy pending sale without cloudCompleteFinancials restores from voidedTotalUgx", () => {
    const original = { ...originalSale(), cloudCompleteFinancials: null };
    const reduced = { ...original, ...reduceSaleTotalsByAmount(original, 2000), pendingSync: true };
    expect(reduced.cloudCompleteFinancials).toBeNull();
    expect(saleHeaderForCloudComplete(reduced).totalUgx).toBe(2000);
  });
});

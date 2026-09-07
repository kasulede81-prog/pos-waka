import { describe, expect, it } from "vitest";
import type { ReturnRecord, Sale, SaleLine, VoidRecord } from "../types";
import {
  absorbCloudSaleAdjustmentLedger,
  absorbCloudSaleAdjustmentLedgers,
} from "./saleAdjustmentLedger";
import { mergeSaleFromCloudPull } from "./saleFinancialMerge";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import { isRevenueSale } from "./saleStatus";

const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AT = "2026-06-02T10:00:00.000Z";

function line(productId: string, quantity: number, lineTotalUgx: number): SaleLine {
  return {
    id: `line-${productId}`,
    productId,
    name: productId,
    inputMode: "quantity",
    quantity,
    unitPriceUgx: lineTotalUgx / quantity,
    unitCostUgx: 2_000,
    lineTotalUgx,
    estimatedProfitUgx: lineTotalUgx - quantity * 2_000,
    updatedAt: AT,
  };
}

function originalSale(partial?: Partial<Sale>): Sale {
  return {
    id: SALE_ID,
    status: "completed",
    createdAt: AT,
    updatedAt: AT,
    subtotalUgx: 100_000,
    totalUgx: 100_000,
    cashPaidUgx: 50_000,
    debtUgx: 50_000,
    estimatedProfitUgx: 80_000,
    voidedTotalUgx: 0,
    tenderCashUgx: 30_000,
    paymentMethod: "mixed",
    lines: [line(PRODUCT_A, 10, 100_000)],
    pendingSync: false,
    lastSyncError: null,
    ...partial,
  };
}

function ret(amount: number, qty = 2, at = "2026-06-02T11:00:00.000Z", id = `ret-${amount}`): ReturnRecord {
  return {
    id,
    saleId: SALE_ID,
    productId: PRODUCT_A,
    productName: PRODUCT_A,
    quantity: qty,
    refundAmountUgx: amount,
    reason: "wrong_item",
    actorUserId: "u1",
    createdAt: at,
  };
}

function voidRec(amount: number, qty = 3, extras?: Partial<VoidRecord>): VoidRecord {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    saleId: SALE_ID,
    lineIndex: 0,
    productId: PRODUCT_A,
    productName: PRODUCT_A,
    quantity: qty,
    amountUgx: amount,
    reason: "other",
    actorUserId: "u1",
    createdAt: "2026-06-02T12:00:00.000Z",
    ...extras,
  };
}

/** Cloud completed-sale row after SL-03 ACK — original header, no voidedTotal. */
function cloudRow(sale: Sale): Sale {
  const { voidedTotalUgx: _ignored, ...rest } = sale;
  return { ...rest, updatedAt: "2026-06-02T10:05:00.000Z" };
}

function deviceAAdjusted(original: Sale, amount: number): Sale {
  return { ...original, ...reduceSaleTotalsByAmount(original, amount) };
}

describe("SALES-MULTI-01 — Device A vs cloud vs Device B", () => {
  it("proves shop_push_sale_complete ACK leaves the cloud header original", () => {
    const deviceA = deviceAAdjusted(originalSale(), 20_000);
    const cloud = cloudRow(originalSale());
    expect(deviceA.totalUgx).toBe(80_000);
    expect(cloud.totalUgx).toBe(100_000);
    expect(cloud.voidedTotalUgx).toBeUndefined();
  });

  it("A — Device B merge of original local + original cloud overstates without the ledger", () => {
    const deviceA = deviceAAdjusted(originalSale(), 20_000);
    const cloud = cloudRow(originalSale());
    const deviceB = mergeSaleFromCloudPull(originalSale(), cloud);
    expect(deviceB.totalUgx).toBe(100_000);
    expect(deviceB.totalUgx).not.toBe(deviceA.totalUgx);
  });

  it("A — Device B converges after absorbing the return ledger", () => {
    const original = originalSale();
    const deviceA = deviceAAdjusted(original, 20_000);
    const returns = [ret(20_000)];
    const cloudAbsorbed = absorbCloudSaleAdjustmentLedger(cloudRow(original), returns, []);
    const deviceB = mergeSaleFromCloudPull(original, cloudAbsorbed);
    expect(deviceB.totalUgx).toBe(80_000);
    expect(deviceB.cashPaidUgx).toBe(deviceA.cashPaidUgx);
    expect(deviceB.debtUgx).toBe(deviceA.debtUgx);
    expect(deviceB.tenderCashUgx).toBe(deviceA.tenderCashUgx);
    expect(deviceB.voidedTotalUgx).toBe(20_000);
  });

  it("B — full return is not active revenue on Device B", () => {
    const original = originalSale();
    const returns = [ret(100_000, 10)];
    const deviceB = absorbCloudSaleAdjustmentLedger(cloudRow(original), returns, []);
    expect(deviceB.totalUgx).toBe(0);
    expect(deviceB.cashPaidUgx).toBe(0);
    expect(deviceB.debtUgx).toBe(0);
  });

  it("C — line void reduces Device B and marks the line voided", () => {
    const original = originalSale();
    const voids = [voidRec(40_000, 4)];
    const deviceB = absorbCloudSaleAdjustmentLedger(cloudRow(original), [], voids);
    expect(deviceB.totalUgx).toBe(60_000);
    expect(deviceB.lines[0]!.voided).toBe(true);
    expect(deviceB.voidedTotalUgx).toBe(40_000);
  });

  it("D — mixed tender stays internally consistent", () => {
    const original = originalSale({
      totalUgx: 100_000,
      cashPaidUgx: 50_000,
      debtUgx: 50_000,
      tenderCashUgx: 30_000,
      paymentMethod: "mixed",
    });
    const deviceA = deviceAAdjusted(original, 20_000);
    const deviceB = absorbCloudSaleAdjustmentLedger(cloudRow(original), [ret(20_000)], []);
    expect(deviceB.totalUgx).toBe(80_000);
    expect(deviceB.cashPaidUgx).toBe(30_000);
    expect(deviceB.debtUgx).toBe(50_000);
    expect(deviceB.tenderCashUgx).toBe(10_000);
    expect(deviceB.cashPaidUgx).toBe(deviceA.cashPaidUgx);
    expect(deviceB.tenderCashUgx).toBe(deviceA.tenderCashUgx);
    expect(deviceB.cashPaidUgx + deviceB.debtUgx).toBe(deviceB.totalUgx);
  });

  it("E — credit remainder matches Device A debt", () => {
    const original = originalSale({
      cashPaidUgx: 0,
      debtUgx: 100_000,
      tenderCashUgx: 0,
      paymentMethod: "credit",
    });
    const deviceA = deviceAAdjusted(original, 20_000);
    const deviceB = absorbCloudSaleAdjustmentLedger(cloudRow(original), [ret(20_000)], []);
    expect(deviceB.debtUgx).toBe(80_000);
    expect(deviceB.cashPaidUgx).toBe(0);
    expect(deviceB.debtUgx).toBe(deviceA.debtUgx);
  });

  it("F — offline Device A queue then Device B pull converges", () => {
    const original = originalSale();
    const deviceA = deviceAAdjusted(original, 20_000);
    const afterRestartA = absorbCloudSaleAdjustmentLedger(deviceA, [ret(20_000)], []);
    expect(afterRestartA.totalUgx).toBe(80_000);
    const deviceB = absorbCloudSaleAdjustmentLedger(cloudRow(original), [ret(20_000)], []);
    expect(deviceB.totalUgx).toBe(afterRestartA.totalUgx);
  });

  it("G — retry / duplicate ledger items do not double-reduce", () => {
    const original = originalSale();
    const returns = [ret(20_000)];
    const once = absorbCloudSaleAdjustmentLedger(cloudRow(original), returns, []);
    const twice = absorbCloudSaleAdjustmentLedger(once, returns, []);
    expect(once.totalUgx).toBe(80_000);
    expect(twice.totalUgx).toBe(80_000);
    expect(twice.voidedTotalUgx).toBe(20_000);
  });

  it("H — stale Device B original sale converges on pull", () => {
    const original = originalSale();
    const absorbedCloud = absorbCloudSaleAdjustmentLedger(cloudRow(original), [ret(20_000)], []);
    const deviceB = mergeSaleFromCloudPull(original, absorbedCloud);
    expect(deviceB.totalUgx).toBe(80_000);
    expect(deviceB.voidedTotalUgx).toBe(20_000);
  });

  it("Device A local adjusted sale is not reduced again when the ledger is reapplied", () => {
    const deviceA = deviceAAdjusted(originalSale(), 20_000);
    const again = absorbCloudSaleAdjustmentLedger(deviceA, [ret(20_000)], []);
    expect(again.totalUgx).toBe(80_000);
    expect(again.voidedTotalUgx).toBe(20_000);
  });

  it("9 — return + cloud synchronization uses stored refunds, not a blind remainder", () => {
    const original = originalSale();
    const deviceB = absorbCloudSaleAdjustmentLedger(cloudRow(original), [ret(8_000, 1)], []);
    expect(deviceB.totalUgx).toBe(92_000);
  });

  it("10 — void + cloud synchronization applies void amount only", () => {
    const original = originalSale();
    const deviceB = absorbCloudSaleAdjustmentLedger(cloudRow(original), [], [voidRec(40_000)]);
    expect(deviceB.totalUgx).toBe(60_000);
    expect(deviceB.lines[0]!.voided).toBe(true);
  });

  it("11 — duplicate return replay is a no-op after absorption", () => {
    const first = absorbCloudSaleAdjustmentLedger(cloudRow(originalSale()), [ret(20_000)], []);
    const replay = absorbCloudSaleAdjustmentLedgers([first], [ret(20_000)], []);
    expect(replay[0]!.totalUgx).toBe(80_000);
  });

  it("12 — duplicate void replay is a no-op after absorption", () => {
    const voids = [voidRec(40_000)];
    const first = absorbCloudSaleAdjustmentLedger(cloudRow(originalSale()), [], voids);
    const replay = absorbCloudSaleAdjustmentLedger(first, [], voids);
    expect(replay.totalUgx).toBe(60_000);
  });

  it("hospitality whole-bill void timestamp converges", () => {
    const original = originalSale();
    const voids = [voidRec(100_000, 10, { saleVoidedAt: "2026-06-02T12:00:00.000Z" })];
    const deviceB = absorbCloudSaleAdjustmentLedger(cloudRow(original), [], voids);
    expect(deviceB.saleVoidedAt).toBe("2026-06-02T12:00:00.000Z");
    expect(isRevenueSale(deviceB)).toBe(false);
  });

  it("multi-line sale: return on A does not change B", () => {
    const original = originalSale({
      subtotalUgx: 80_000,
      totalUgx: 80_000,
      cashPaidUgx: 80_000,
      debtUgx: 0,
      tenderCashUgx: 80_000,
      lines: [line(PRODUCT_A, 5, 50_000), line(PRODUCT_B, 3, 30_000)],
    });
    const returns: ReturnRecord[] = [
      {
        ...ret(20_000, 2),
        productId: PRODUCT_A,
      },
    ];
    const deviceB = absorbCloudSaleAdjustmentLedger(cloudRow(original), returns, []);
    expect(deviceB.totalUgx).toBe(60_000);
    expect(deviceB.lines.find((l) => l.productId === PRODUCT_B)?.voided).toBeFalsy();
  });
});

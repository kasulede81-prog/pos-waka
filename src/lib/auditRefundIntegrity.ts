/**
 * Read-only refund integrity audit — does not modify sales or returns.
 */

import type { ReturnRecord, Sale } from "../types";
import {
  activeSaleLine,
  originalLinePaidUgx,
  originalSaleTotalUgx,
  refundsOnSale,
} from "./returnLimits";
import { activeLines } from "./saleAdjustments";
import { saleRefundRoundingRemainderUgx } from "./refundBreakdown";

export type RefundIntegrityViolation = {
  code: string;
  message: string;
  saleId?: string;
  returnId?: string;
  productId?: string;
  expected?: number;
  actual?: number;
};

export type RefundIntegrityReport = {
  ok: boolean;
  violations: RefundIntegrityViolation[];
  salesScanned: number;
  returnsScanned: number;
};

export function auditRefundIntegrity(input: {
  sales: Sale[];
  returnRecords: ReturnRecord[];
}): RefundIntegrityReport {
  const violations: RefundIntegrityViolation[] = [];
  const saleById = new Map(input.sales.map((s) => [s.id, s]));

  const seenReturnIds = new Set<string>();
  for (const rec of input.returnRecords) {
    if (seenReturnIds.has(rec.id)) {
      violations.push({
        code: "duplicate_return_id",
        message: "Duplicate return record id",
        returnId: rec.id,
        saleId: rec.saleId ?? undefined,
      });
    }
    seenReturnIds.add(rec.id);

    if (rec.refundAmountUgx < 0) {
      violations.push({
        code: "negative_refund",
        message: "Return refund amount is negative",
        returnId: rec.id,
        actual: rec.refundAmountUgx,
      });
    }

    if (rec.quantity < 0) {
      violations.push({
        code: "negative_return_qty",
        message: "Return quantity is negative",
        returnId: rec.id,
        actual: rec.quantity,
      });
    }
  }

  for (const sale of input.sales) {
    if (sale.totalUgx < 0) {
      violations.push({
        code: "negative_sale_total",
        message: "Sale total is negative",
        saleId: sale.id,
        actual: sale.totalUgx,
      });
    }
    if (sale.cashPaidUgx < 0) {
      violations.push({
        code: "negative_cash_paid",
        message: "Sale cash paid is negative",
        saleId: sale.id,
        actual: sale.cashPaidUgx,
      });
    }
    if (sale.debtUgx < 0) {
      violations.push({
        code: "negative_debt",
        message: "Sale debt is negative",
        saleId: sale.id,
        actual: sale.debtUgx,
      });
    }
  }

  const linkedReturns = input.returnRecords.filter((r) => r.saleId);
  const returnsBySale = new Map<string, ReturnRecord[]>();
  for (const r of linkedReturns) {
    const sid = r.saleId!;
    const list = returnsBySale.get(sid) ?? [];
    list.push(r);
    returnsBySale.set(sid, list);
  }

  for (const [saleId, returns] of returnsBySale) {
    const sale = saleById.get(saleId);
    if (!sale) continue;

    const originalTotal = originalSaleTotalUgx(sale, returns);
    const sumRefunds = refundsOnSale(returns, saleId);
    const lineSubtotal = activeLines(sale).reduce((a, l) => a + l.lineTotalUgx, 0);
    const maxFromLines = activeLines(sale).reduce(
      (a, l) => a + originalLinePaidUgx(sale, l.productId, returns),
      0,
    );
    const roundingAllowance = saleRefundRoundingRemainderUgx(sale, returns);

    if (sumRefunds > lineSubtotal) {
      violations.push({
        code: "over_refund_sale",
        message: "Total refunds exceed line subtotal on sale",
        saleId,
        expected: lineSubtotal,
        actual: sumRefunds,
      });
    }

    if (sumRefunds > maxFromLines + roundingAllowance) {
      violations.push({
        code: "over_refund_sale",
        message: "Total refunds exceed what customer paid on sale lines",
        saleId,
        expected: maxFromLines + roundingAllowance,
        actual: sumRefunds,
      });
    }

    const expectedCurrent = Math.max(0, originalTotal - sumRefunds);
    if (Math.abs(sale.totalUgx - expectedCurrent) > roundingAllowance + 1) {
      violations.push({
        code: "sale_header_drift",
        message: "Sale total does not match original minus refunds",
        saleId,
        expected: expectedCurrent,
        actual: sale.totalUgx,
      });
    }

    const qtyByProduct = new Map<string, number>();
    for (const r of returns) {
      const prev = qtyByProduct.get(r.productId) ?? 0;
      qtyByProduct.set(r.productId, prev + Math.max(0, r.quantity));
    }

    for (const [productId, returnedQty] of qtyByProduct) {
      const line = activeSaleLine(sale, productId);
      if (!line) {
        violations.push({
          code: "return_unknown_product",
          message: "Return references product not on sale",
          saleId,
          productId,
          actual: returnedQty,
        });
        continue;
      }
      if (returnedQty > line.quantity + 0.0001) {
        violations.push({
          code: "over_return_qty",
          message: "Returned quantity exceeds sold quantity",
          saleId,
          productId,
          expected: line.quantity,
          actual: returnedQty,
        });
      }
    }
  }

  const duplicateContent = findDuplicateReturnRecords(input.returnRecords);
  violations.push(...duplicateContent);

  return {
    ok: violations.length === 0,
    violations,
    salesScanned: input.sales.length,
    returnsScanned: input.returnRecords.length,
  };
}

/** Same sale, product, qty, refund, and timestamp — likely duplicate entry. */
function findDuplicateReturnRecords(records: ReturnRecord[]): RefundIntegrityViolation[] {
  const out: RefundIntegrityViolation[] = [];
  const seen = new Map<string, string>();
  for (const r of records) {
    const key = [
      r.saleId ?? "none",
      r.productId,
      r.quantity,
      r.refundAmountUgx,
      r.createdAt,
    ].join("|");
    const existing = seen.get(key);
    if (existing && existing !== r.id) {
      out.push({
        code: "duplicate_return_record",
        message: "Duplicate return record (same sale, product, qty, amount, time)",
        returnId: r.id,
        saleId: r.saleId ?? undefined,
        productId: r.productId,
      });
    } else {
      seen.set(key, r.id);
    }
  }
  return out;
}

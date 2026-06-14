import type { Sale } from "../types";
import { activeLines, lineDiscountUgx, listPriceForLine } from "./saleAdjustments";

export type SaleDiscountBreakdown = {
  listSubtotalUgx: number;
  lineDiscountsUgx: number;
  cartDiscountUgx: number;
  totalDiscountUgx: number;
  finalTotalUgx: number;
};

/** Split sale discount into line vs cart — totals reconcile with sale.totalUgx. */
export function computeSaleDiscountBreakdown(sale: Sale): SaleDiscountBreakdown {
  const lines = activeLines(sale);
  const listSubtotalUgx = lines.reduce((a, l) => a + listPriceForLine(l), 0);
  const lineDiscountsUgx = lines.reduce((a, l) => a + lineDiscountUgx(l), 0);
  const afterLineDiscountsUgx = lines.reduce((a, l) => a + l.lineTotalUgx, 0);
  const finalTotalUgx = Math.max(0, sale.totalUgx);
  const cartDiscountUgx = Math.max(0, afterLineDiscountsUgx - finalTotalUgx);
  const totalDiscountUgx = Math.max(0, sale.discountTotalUgx ?? listSubtotalUgx - finalTotalUgx);
  return {
    listSubtotalUgx,
    lineDiscountsUgx,
    cartDiscountUgx,
    totalDiscountUgx,
    finalTotalUgx,
  };
}

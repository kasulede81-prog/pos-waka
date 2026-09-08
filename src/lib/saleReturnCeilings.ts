/**
 * Client-side mirror of migration 086 `validate_sale_return_ceilings`.
 * Used only to decide whether a BLOCKED return may be retried after a
 * read-only cloud SELECT. Does not change RPC/SQL semantics.
 *
 * `refund_exceeds_remaining` means `p_refund_ugx > v_sale_total`.
 * It does NOT mean refund > sale_total - previous_refunds.
 */

export type SaleReturnCeilingSale = {
  id: string;
  shopId: string;
  totalUgx: number;
} | null;

export type SaleReturnCeilingLine = {
  productId: string;
  quantity: number;
  lineTotalUgx: number;
};

export type SaleReturnCeilingReturn = {
  id: string;
  productId: string;
  quantity: number;
  refundAmountUgx: number;
};

export type SaleReturnCeilingInput = {
  shopId: string;
  saleId: string;
  sale: SaleReturnCeilingSale;
  lines: readonly SaleReturnCeilingLine[];
  priorReturns: readonly SaleReturnCeilingReturn[];
  excludeReturnId: string | null;
  productId: string;
  quantity: number;
  refundUgx: number;
};

export type SaleReturnCeilingResult = { ok: true } | { ok: false; error: string };

export function evaluateSaleReturnCeilings(input: SaleReturnCeilingInput): SaleReturnCeilingResult {
  const pSaleId = String(input.saleId ?? "").trim();
  if (!pSaleId) return { ok: true };

  const sale = input.sale;
  if (!sale || sale.id !== pSaleId || sale.shopId !== input.shopId) {
    return { ok: false, error: "sale_not_found" };
  }

  const vSaleTotal = Math.max(0, Math.floor(Number(sale.totalUgx) || 0));
  const pRefund = Math.max(0, Math.floor(Number(input.refundUgx) || 0));
  const pQty = Math.max(0, Number(input.quantity) || 0);
  const exclude = input.excludeReturnId;

  const vGrossUgx = input.lines.reduce((sum, line) => sum + Math.max(0, Math.floor(Number(line.lineTotalUgx) || 0)), 0);
  const priors = input.priorReturns.filter((row) => !exclude || row.id !== exclude);
  const vRefunded = priors.reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row.refundAmountUgx) || 0)), 0);

  if (pRefund > vSaleTotal) {
    return { ok: false, error: "refund_exceeds_remaining" };
  }

  if (vGrossUgx > 0 && vRefunded + pRefund > vGrossUgx) {
    return { ok: false, error: "refund_exceeds_sale" };
  }

  const vSoldQty = input.lines
    .filter((line) => line.productId === input.productId)
    .reduce((sum, line) => sum + Math.max(0, Number(line.quantity) || 0), 0);
  if (vSoldQty <= 0) {
    return { ok: false, error: "product_not_on_sale" };
  }

  const vReturnedQty = priors
    .filter((row) => row.productId === input.productId)
    .reduce((sum, row) => sum + Math.max(0, Number(row.quantity) || 0), 0);
  if (vReturnedQty + pQty > vSoldQty + 0.0001) {
    return { ok: false, error: "return_qty_exceeds_sold" };
  }

  const vLineTotal = input.lines
    .filter((line) => line.productId === input.productId)
    .reduce((sum, line) => sum + Math.max(0, Math.floor(Number(line.lineTotalUgx) || 0)), 0);
  const vLineRefund = priors
    .filter((row) => row.productId === input.productId)
    .reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row.refundAmountUgx) || 0)), 0);
  if (vLineRefund + pRefund > vLineTotal) {
    return { ok: false, error: "refund_exceeds_line" };
  }

  return { ok: true };
}

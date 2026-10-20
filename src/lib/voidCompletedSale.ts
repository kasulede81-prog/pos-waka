import type { Customer, Product, ReturnRecord, Sale, SaleLine, StockMovement, VoidRecord, VoidReason } from "../types";
import {
  applyCustomerDebtDelta,
  creditDebtReductionFromSaleAdjustment,
  reduceSaleTotalsByAmount,
} from "./saleAdjustments";
import { cashReduceFromRefund } from "./cashDrawerSales";
import { hasPackCostAllocation, retractPackCostUnitsDepleted } from "./costPrecision";
import { remainingVoidableLine } from "./returnLimits";
import {
  creditIngredients,
  hasBatchPreparedProvenance,
  hasIngredientProvenance,
  ingredientReversalFor,
  restorePrepBatchesForReversal,
} from "./recipeEngine";
import { isCompletedSale, isVoidedSale } from "./saleStatus";
import { stableVoidLineIdentity, stableVoidLineMovementId, stableVoidRecordId } from "./saleLifecycle";

export type WholeBillVoidPlan = {
  sale: Sale;
  products: Product[];
  customers: Customer[];
  movements: StockMovement[];
  voidRecords: VoidRecord[];
  cashReduce: number;
  amountVoidedUgx: number;
};

export function planWholeBillVoid(input: {
  sale: Sale;
  products: readonly Product[];
  customers: readonly Customer[];
  shopKey: string;
  at: string;
  reason: VoidReason;
  note: string;
  actorUserId: string;
  actorName?: string;
  shiftId?: string | null;
  returnRecords?: readonly ReturnRecord[];
}): { ok: true; plan: WholeBillVoidPlan } | { ok: false; errorKey: string } {
  if (!isCompletedSale(input.sale) || isVoidedSale(input.sale)) {
    return { ok: false, errorKey: "invalid" };
  }

  let sale: Sale = { ...input.sale, lines: input.sale.lines.map((l) => ({ ...l })) };
  const products = input.products.map((p) => ({ ...p }));
  let customers = [...input.customers];
  const movements: StockMovement[] = [];
  const voidRecords: VoidRecord[] = [];
  let cashReduce = 0;
  let amountVoidedUgx = 0;
  const returnRecords = input.returnRecords ?? [];

  /**
   * Reverses one line by its own stock model:
   * - made-to-order: ingredient credits only (no finished dish ever had stock);
   * - batch-prepared with modifiers: BOTH the prepared portions and the modifier ingredient credits;
   * - retail / plain batch: finished stock only.
   */
  const restockLine = (
    line: SaleLine,
    quantity: number,
  ): { ingredientCredits: Array<{ productId: string; quantity: number }> | null; finishedRestocked: boolean } => {
    if (quantity <= 0) return { ingredientCredits: null, finishedRestocked: false };
    const viaIngredients = hasIngredientProvenance(line);
    const batchPrepared = hasBatchPreparedProvenance(line);
    let ingredientCredits: Array<{ productId: string; quantity: number }> | null = null;
    if (viaIngredients) {
      const credited = creditIngredients(
        products,
        ingredientReversalFor(line, quantity, Math.max(0, line.quantity - quantity)),
        input.at,
      );
      credited.products.forEach((p, i) => {
        products[i] = p;
      });
      ingredientCredits = credited.applied;
    }
    if (viaIngredients && !batchPrepared) {
      return { ingredientCredits, finishedRestocked: false };
    }
    const pIdx = products.findIndex((p) => p.id === line.productId);
    if (pIdx < 0) return { ingredientCredits, finishedRestocked: false };
    const p = products[pIdx]!;
    let restored: Product = {
      ...p,
      stockOnHand: p.stockOnHand + quantity,
      packCostUnitsDepleted: hasPackCostAllocation(p)
        ? retractPackCostUnitsDepleted(p.packCostUnitsDepleted, quantity)
        : p.packCostUnitsDepleted,
      updatedAt: input.at,
      version: p.version + 1,
    };
    // Batch-prepared dishes: the finished portions go back to the exact PrepBatches they came from
    // (no-op for every other product).
    restored = restorePrepBatchesForReversal(restored, line, quantity, Math.max(0, line.quantity - quantity), input.at);
    products[pIdx] = restored;
    return { ingredientCredits, finishedRestocked: true };
  };

  sale.lines.forEach((line, lineIndex) => {
    if (line.voided) return;
    const remaining = remainingVoidableLine(sale, line.productId, returnRecords, line.id ?? null);
    if (remaining.quantity <= 0) return;
    const amount = remaining.amountUgx;
    const voidQty = remaining.quantity;
    const profitReduce =
      line.quantity > 0 ? Math.round((line.estimatedProfitUgx * voidQty) / line.quantity) : 0;
    cashReduce += cashReduceFromRefund(sale, amount);
    const identity = stableVoidLineIdentity(sale.id, lineIndex, line.id);
    const voidRec: VoidRecord = {
      id: stableVoidRecordId(input.shopKey, sale.id, identity),
      saleId: sale.id,
      lineIndex,
      productId: line.productId,
      productName: line.name,
      quantity: voidQty,
      amountUgx: amount,
      reason: input.reason,
      note: input.note || undefined,
      actorUserId: input.actorUserId,
      actorName: input.actorName,
      shiftId: input.shiftId ?? null,
      createdAt: input.at,
      saleLineId: line.id ?? null,
    };
    voidRecords.push(voidRec);
    const restocked = restockLine(line, voidQty);
    if (restocked.ingredientCredits) {
      for (const c of restocked.ingredientCredits) {
        movements.push({
          id: stableVoidLineMovementId(input.shopKey, sale.id, identity, c.productId),
          at: input.at,
          productId: c.productId,
          productName: products.find((p) => p.id === c.productId)?.name ?? c.productId,
          deltaBaseUnits: c.quantity,
          kind: "adjust_other",
          summary: `Void +${c.quantity} (${hasBatchPreparedProvenance(line) ? "batch modifier" : "recipe"})`,
          refId: voidRec.id,
          supplierId: null,
        });
      }
    }
    if (restocked.finishedRestocked) {
      movements.push({
        id: stableVoidLineMovementId(input.shopKey, sale.id, identity, line.productId),
        at: input.at,
        productId: line.productId,
        productName: line.name,
        deltaBaseUnits: voidQty,
        kind: "adjust_other",
        summary: `Void +${voidQty}`,
        refId: voidRec.id,
        supplierId: null,
      });
    }
    const debtReduce = creditDebtReductionFromSaleAdjustment(sale, amount);
    const totals = reduceSaleTotalsByAmount(sale, amount);
    customers = applyCustomerDebtDelta(customers, sale.customerId, -debtReduce);
    sale = {
      ...sale,
      ...totals,
      lines: sale.lines.map((l, i) => (i === lineIndex ? { ...l, voided: true, voidedAt: input.at } : l)),
      estimatedProfitUgx: Math.max(0, sale.estimatedProfitUgx - profitReduce),
    };
    amountVoidedUgx += amount;
  });

  const leftover = Math.max(0, sale.totalUgx);
  if (leftover > 0) {
    cashReduce += cashReduceFromRefund(sale, leftover);
    const debtReduce = creditDebtReductionFromSaleAdjustment(sale, leftover);
    const totals = reduceSaleTotalsByAmount(sale, leftover);
    customers = applyCustomerDebtDelta(customers, sale.customerId, -debtReduce);
    sale = { ...sale, ...totals };
    amountVoidedUgx += leftover;
  }

  sale = {
    ...sale,
    saleVoidedAt: input.at,
    saleVoidReason: input.note || input.reason,
    saleVoidedByUserId: input.actorUserId,
    saleVoidedByLabel: input.actorName ?? null,
    pendingSync: true,
    updatedAt: input.at,
  };

  return {
    ok: true,
    plan: { sale, products, customers, movements, voidRecords, cashReduce, amountVoidedUgx },
  };
}

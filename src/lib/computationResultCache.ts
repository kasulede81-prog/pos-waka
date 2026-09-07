/** Weak fingerprint cache for expensive pure computations (same inputs → same outputs). */

type CacheEntry<T> = {
  fingerprint: string;
  value: T;
  at: number;
};

const cache = new Map<string, CacheEntry<unknown>>();
const MAX_ENTRIES = 32;

export function getCachedComputation<T>(key: string, fingerprint: string, compute: () => T): T {
  const hit = cache.get(key);
  if (hit && hit.fingerprint === fingerprint) {
    return hit.value as T;
  }
  const value = compute();
  cache.set(key, { fingerprint, value, at: Date.now() });
  if (cache.size > MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of cache) {
      if (v.at < oldestAt) {
        oldestAt = v.at;
        oldestKey = k;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
  return value;
}

/** Sale fields actually consumed by `localGetRangeSummary` / reporting cache. */
export type ReportingSalesFingerprintInput = {
  id: string;
  createdAt?: string | null;
  status?: string | null;
  saleVoidedAt?: string | null;
  totalUgx?: number;
  cashPaidUgx?: number;
  debtUgx?: number;
  discountTotalUgx?: number;
  customerId?: string | null;
  paymentMethod?: string | null;
  tenderCashUgx?: number | null;
  lines?: ReadonlyArray<{
    productId?: string;
    quantity?: number;
    unitPriceUgx?: number;
    unitCostUgx?: number;
    lineTotalUgx?: number;
    originalLineTotalUgx?: number;
    discountUgx?: number;
    cartDiscountUgx?: number;
    netRevenueUgx?: number;
    cogsUgx?: number;
    estimatedProfitUgx?: number;
    grossProfitUgx?: number;
    voided?: boolean;
    financialDataStatus?: string | null;
  }>;
};

/** Compact deterministic roll — not a crypto hash. */
function reportingMutationFingerprint(parts: readonly string[]): string {
  let h = 0;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      h = (Math.imul(31, h) + part.charCodeAt(i)) | 0;
    }
    h = (Math.imul(31, h) + 1) | 0;
  }
  return `${parts.length}:${h}`;
}

function saleReportingToken(sale: ReportingSalesFingerprintInput): string {
  const lines = (sale.lines ?? [])
    .map((line) =>
      [
        line.productId ?? "",
        line.quantity ?? "",
        line.unitPriceUgx ?? "",
        line.unitCostUgx ?? "",
        line.lineTotalUgx ?? "",
        line.originalLineTotalUgx ?? "",
        line.discountUgx ?? "",
        line.cartDiscountUgx ?? "",
        line.netRevenueUgx ?? "",
        line.cogsUgx ?? "",
        line.estimatedProfitUgx ?? "",
        line.grossProfitUgx ?? "",
        line.voided ? "1" : "0",
        line.financialDataStatus ?? "",
      ].join("/"),
    )
    .join(",");
  return [
    sale.id,
    sale.createdAt ?? "",
    sale.status ?? "",
    sale.saleVoidedAt ?? "",
    sale.totalUgx ?? "",
    sale.cashPaidUgx ?? "",
    sale.debtUgx ?? "",
    sale.discountTotalUgx ?? "",
    sale.customerId ?? "",
    sale.paymentMethod ?? "",
    sale.tenderCashUgx ?? "",
    lines,
  ].join(":");
}

export function buildSalesFingerprint(sales: readonly ReportingSalesFingerprintInput[]): string {
  if (sales.length === 0) return "0";
  const first = sales[0]?.id ?? "";
  const last = sales[sales.length - 1]?.id ?? "";
  return `${sales.length}:${first}:${last}:${reportingMutationFingerprint(sales.map(saleReportingToken))}`;
}

/** Expense fields consumed by `sumCashExpensesOnDay` / `InMonth` / `InBounds` inside range summaries. */
export type ReportingExpenseFingerprintInput = {
  id: string;
  amountUgx?: number;
  approvalStatus?: string | null;
  deletedAt?: string | null;
  paidOn?: string;
};

/** Product fields consumed by `localGetInventoryInsights` / `inventoryValueAtCostUgx`. */
export type ReportingProductFingerprintInput = {
  id: string;
  costPricePerUnitUgx?: number;
  stockOnHand?: number;
  minimumStockAlert?: number;
  buyingPackCostUgx?: number | null;
  conversionRate?: number | null;
  packCostUnitsDepleted?: number | null;
};

export function buildReportingExpensesFingerprint(
  expenses: readonly ReportingExpenseFingerprintInput[],
): string {
  if (expenses.length === 0) return "0";
  return reportingMutationFingerprint(
    [...expenses]
      .map(
        (e) =>
          `${e.id}:${e.amountUgx ?? ""}:${e.approvalStatus ?? "approved"}:${e.deletedAt ?? ""}:${e.paidOn ?? ""}`,
      )
      .sort(),
  );
}

export function buildReportingProductsFingerprint(
  products: readonly ReportingProductFingerprintInput[],
): string {
  if (products.length === 0) return "0";
  return reportingMutationFingerprint(
    [...products]
      .map(
        (p) =>
          `${p.id}:${p.costPricePerUnitUgx ?? ""}:${p.stockOnHand ?? ""}:${p.minimumStockAlert ?? ""}:${p.buyingPackCostUgx ?? ""}:${p.conversionRate ?? ""}:${p.packCostUnitsDepleted ?? ""}`,
      )
      .sort(),
  );
}

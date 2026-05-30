import { hasSupabaseConfig, supabase } from "./supabase";
import { getDeviceOnline } from "./deviceOnline";
import type {
  CustomerInsights,
  DailySalesSummary,
  InventoryInsights,
  MonthlySalesSummary,
  ProductRank,
  WeeklySalesSummary,
} from "./localReporting";

export type ReportDataSource = "server" | "local";

export type ReportQueryMeta = {
  source: ReportDataSource;
  durationMs: number;
  payloadBytes: number;
  recordsReturned: number;
  rpcName: string;
  error?: string;
};

function estimateBytes(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

async function recordReportQuery(meta: ReportQueryMeta): Promise<void> {
  const { isDiagnosticsEnabled, recordReportQueryStats } = await import("./stabilityDiagnostics");
  if (isDiagnosticsEnabled()) recordReportQueryStats(meta);
}

function canUseServerReporting(): boolean {
  return Boolean(supabase && hasSupabaseConfig && getDeviceOnline());
}

function parseProductRank(raw: Record<string, unknown>): ProductRank {
  return {
    productId: String(raw.product_id ?? raw.productId ?? ""),
    name: String(raw.name ?? "Item"),
    quantity: Number(raw.quantity ?? raw.qty ?? 0),
    revenueUgx: Number(raw.revenue_ugx ?? raw.revenueUgx ?? 0),
    profitUgx: Number(raw.profit_ugx ?? raw.profitUgx ?? 0),
  };
}

export async function getDailySalesSummary(day?: string): Promise<{
  data: DailySalesSummary | null;
  meta: ReportQueryMeta;
}> {
  const rpcName = "shop_get_daily_sales_summary";
  const started = performance.now();
  if (!canUseServerReporting()) {
    return {
      data: null,
      meta: {
        source: "local",
        durationMs: 0,
        payloadBytes: 0,
        recordsReturned: 0,
        rpcName,
        error: "offline",
      },
    };
  }
  const { data, error } = await supabase!.rpc(rpcName, { p_day: day ?? null });
  const durationMs = Math.round(performance.now() - started);
  const row = (data ?? {}) as Record<string, unknown>;
  const payloadBytes = estimateBytes(row);
  const meta: ReportQueryMeta = {
    source: "server",
    durationMs,
    payloadBytes,
    recordsReturned: row.ok ? 1 : 0,
    rpcName,
    error: error?.message ?? (row.ok ? undefined : String(row.error ?? "unknown")),
  };
  await recordReportQuery(meta);
  if (error || !row.ok) return { data: null, meta };
  return {
    data: {
      day: String(row.day ?? day ?? ""),
      transactionCount: Number(row.transaction_count ?? 0),
      totalRevenueUgx: Number(row.total_revenue_ugx ?? 0),
      cashCollectedUgx: Number(row.cash_collected_ugx ?? 0),
      debtIssuedUgx: Number(row.debt_issued_ugx ?? 0),
      discountsUgx: Number(row.discounts_ugx ?? 0),
      taxesUgx: Number(row.taxes_ugx ?? 0),
      estimatedProfitUgx: Number(row.estimated_profit_ugx ?? 0),
      averageTransactionUgx: Number(row.average_transaction_ugx ?? 0),
    },
    meta,
  };
}

export async function getWeeklySalesSummary(anchorDay?: string): Promise<{
  data: WeeklySalesSummary | null;
  meta: ReportQueryMeta;
}> {
  const rpcName = "shop_get_weekly_sales_summary";
  const started = performance.now();
  if (!canUseServerReporting()) {
    return {
      data: null,
      meta: { source: "local", durationMs: 0, payloadBytes: 0, recordsReturned: 0, rpcName, error: "offline" },
    };
  }
  const { data, error } = await supabase!.rpc(rpcName, { p_anchor_day: anchorDay ?? null });
  const durationMs = Math.round(performance.now() - started);
  const row = (data ?? {}) as Record<string, unknown>;
  const payloadBytes = estimateBytes(row);
  const meta: ReportQueryMeta = {
    source: "server",
    durationMs,
    payloadBytes,
    recordsReturned: Array.isArray(row.daily_trend) ? (row.daily_trend as unknown[]).length : 0,
    rpcName,
    error: error?.message ?? (row.ok ? undefined : String(row.error ?? "unknown")),
  };
  await recordReportQuery(meta);
  if (error || !row.ok) return { data: null, meta };
  const dailyTrend = Array.isArray(row.daily_trend)
    ? (row.daily_trend as Record<string, unknown>[]).map((d) => ({
        day: String(d.day ?? ""),
        revenueUgx: Number(d.revenue_ugx ?? 0),
        transactionCount: Number(d.transaction_count ?? 0),
      }))
    : [];
  const topProducts = Array.isArray(row.top_products)
    ? (row.top_products as Record<string, unknown>[]).map(parseProductRank)
    : [];
  return {
    data: {
      startDay: String(row.start_day ?? ""),
      endDay: String(row.end_day ?? ""),
      transactionCount: Number(row.transaction_count ?? 0),
      totalRevenueUgx: Number(row.total_revenue_ugx ?? 0),
      cashCollectedUgx: Number(row.cash_collected_ugx ?? row.total_revenue_ugx ?? 0),
      dailyTrend,
      topProducts,
      activeCustomers: Number(row.active_customers ?? 0),
    },
    meta,
  };
}

export async function getMonthlySalesSummary(month?: string): Promise<{
  data: MonthlySalesSummary | null;
  meta: ReportQueryMeta;
}> {
  const rpcName = "shop_get_monthly_sales_summary";
  const started = performance.now();
  if (!canUseServerReporting()) {
    return {
      data: null,
      meta: { source: "local", durationMs: 0, payloadBytes: 0, recordsReturned: 0, rpcName, error: "offline" },
    };
  }
  const { data, error } = await supabase!.rpc(rpcName, { p_month: month ?? null });
  const durationMs = Math.round(performance.now() - started);
  const row = (data ?? {}) as Record<string, unknown>;
  const payloadBytes = estimateBytes(row);
  const meta: ReportQueryMeta = {
    source: "server",
    durationMs,
    payloadBytes,
    recordsReturned: 1,
    rpcName,
    error: error?.message ?? (row.ok ? undefined : String(row.error ?? "unknown")),
  };
  await recordReportQuery(meta);
  if (error || !row.ok) return { data: null, meta };
  return {
    data: {
      month: String(row.month ?? month ?? ""),
      transactionCount: Number(row.transaction_count ?? 0),
      totalRevenueUgx: Number(row.total_revenue_ugx ?? 0),
      cashCollectedUgx: Number(row.cash_collected_ugx ?? 0),
      debtIssuedUgx: Number(row.debt_issued_ugx ?? 0),
      estimatedProfitUgx: Number(row.estimated_profit_ugx ?? 0),
      expensesUgx: Number(row.expenses_ugx ?? 0),
      netEarningsUgx: Number(row.net_earnings_ugx ?? 0),
      previousMonthRevenueUgx: Number(row.previous_month_revenue_ugx ?? 0),
      revenueGrowthPct: row.revenue_growth_pct != null ? Number(row.revenue_growth_pct) : null,
    },
    meta,
  };
}

export async function getTopProducts(opts?: {
  startDay?: string;
  endDay?: string;
  limit?: number;
  order?: "top" | "slow";
}): Promise<{ products: ProductRank[]; meta: ReportQueryMeta }> {
  const rpcName = "shop_get_top_products";
  const started = performance.now();
  if (!canUseServerReporting()) {
    return {
      products: [],
      meta: { source: "local", durationMs: 0, payloadBytes: 0, recordsReturned: 0, rpcName, error: "offline" },
    };
  }
  const { data, error } = await supabase!.rpc(rpcName, {
    p_start_day: opts?.startDay ?? null,
    p_end_day: opts?.endDay ?? null,
    p_limit: opts?.limit ?? 10,
    p_order: opts?.order ?? "top",
  });
  const durationMs = Math.round(performance.now() - started);
  const row = (data ?? {}) as Record<string, unknown>;
  const payloadBytes = estimateBytes(row);
  const products = Array.isArray(row.products)
    ? (row.products as Record<string, unknown>[]).map(parseProductRank)
    : [];
  const meta: ReportQueryMeta = {
    source: "server",
    durationMs,
    payloadBytes,
    recordsReturned: products.length,
    rpcName,
    error: error?.message ?? (row.ok ? undefined : String(row.error ?? "unknown")),
  };
  await recordReportQuery(meta);
  return { products, meta };
}

export async function getInventoryInsights(): Promise<{
  data: InventoryInsights | null;
  meta: ReportQueryMeta;
}> {
  const rpcName = "shop_get_inventory_insights";
  const started = performance.now();
  if (!canUseServerReporting()) {
    return {
      data: null,
      meta: { source: "local", durationMs: 0, payloadBytes: 0, recordsReturned: 0, rpcName, error: "offline" },
    };
  }
  const { data, error } = await supabase!.rpc(rpcName);
  const durationMs = Math.round(performance.now() - started);
  const row = (data ?? {}) as Record<string, unknown>;
  const payloadBytes = estimateBytes(row);
  const meta: ReportQueryMeta = {
    source: "server",
    durationMs,
    payloadBytes,
    recordsReturned:
      (Array.isArray(row.low_stock) ? (row.low_stock as unknown[]).length : 0) +
      (Array.isArray(row.out_of_stock) ? (row.out_of_stock as unknown[]).length : 0),
    rpcName,
    error: error?.message ?? (row.ok ? undefined : String(row.error ?? "unknown")),
  };
  await recordReportQuery(meta);
  if (error || !row.ok) return { data: null, meta };
  return {
    data: {
      stockValueAtCostUgx: Number(row.stock_value_at_cost_ugx ?? 0),
      lowStock: Array.isArray(row.low_stock)
        ? (row.low_stock as Record<string, unknown>[]).map((p) => ({
            productId: String(p.product_id ?? ""),
            name: String(p.name ?? ""),
            stockOnHand: Number(p.stock_on_hand ?? 0),
            minimumStockAlert: Number(p.minimum_stock_alert ?? 0),
          }))
        : [],
      outOfStock: Array.isArray(row.out_of_stock)
        ? (row.out_of_stock as Record<string, unknown>[]).map((p) => ({
            productId: String(p.product_id ?? ""),
            name: String(p.name ?? ""),
          }))
        : [],
      restockRecommendations: Array.isArray(row.restock_recommendations)
        ? (row.restock_recommendations as Record<string, unknown>[]).map((p) => ({
            productId: String(p.product_id ?? ""),
            name: String(p.name ?? ""),
            stockOnHand: Number(p.stock_on_hand ?? 0),
            minimumStockAlert: Number(p.minimum_stock_alert ?? 0),
            suggestedReorderQty: Number(p.suggested_reorder_qty ?? 0),
          }))
        : [],
    },
    meta,
  };
}

export async function getCustomerInsights(opts?: {
  startDay?: string;
  endDay?: string;
  limit?: number;
}): Promise<{ data: CustomerInsights | null; meta: ReportQueryMeta }> {
  const rpcName = "shop_get_customer_insights";
  const started = performance.now();
  if (!canUseServerReporting()) {
    return {
      data: null,
      meta: { source: "local", durationMs: 0, payloadBytes: 0, recordsReturned: 0, rpcName, error: "offline" },
    };
  }
  const { data, error } = await supabase!.rpc(rpcName, {
    p_start_day: opts?.startDay ?? null,
    p_end_day: opts?.endDay ?? null,
    p_limit: opts?.limit ?? 10,
  });
  const durationMs = Math.round(performance.now() - started);
  const row = (data ?? {}) as Record<string, unknown>;
  const payloadBytes = estimateBytes(row);
  const meta: ReportQueryMeta = {
    source: "server",
    durationMs,
    payloadBytes,
    recordsReturned: Array.isArray(row.top_customers) ? (row.top_customers as unknown[]).length : 0,
    rpcName,
    error: error?.message ?? (row.ok ? undefined : String(row.error ?? "unknown")),
  };
  await recordReportQuery(meta);
  if (error || !row.ok) return { data: null, meta };
  return {
    data: {
      startDay: String(row.start_day ?? ""),
      endDay: String(row.end_day ?? ""),
      topCustomers: Array.isArray(row.top_customers)
        ? (row.top_customers as Record<string, unknown>[]).map((c) => ({
            customerId: String(c.customer_id ?? ""),
            name: String(c.name ?? ""),
            purchaseCount: Number(c.purchase_count ?? 0),
            lifetimeRevenueUgx: Number(c.lifetime_revenue_ugx ?? 0),
            debtBalanceUgx: Number(c.debt_balance_ugx ?? 0),
          }))
        : [],
      totalDebtOutstandingUgx: Number(row.total_debt_outstanding_ugx ?? 0),
      customersWithDebt: Number(row.customers_with_debt ?? 0),
    },
    meta,
  };
}

export type DashboardAnalytics = {
  daily: DailySalesSummary;
  weekly: WeeklySalesSummary;
  inventory: InventoryInsights;
  customers: CustomerInsights;
};

export async function getDashboardAnalytics(): Promise<{
  data: DashboardAnalytics | null;
  meta: ReportQueryMeta;
}> {
  const rpcName = "shop_get_dashboard_analytics";
  const started = performance.now();
  if (!canUseServerReporting()) {
    return {
      data: null,
      meta: { source: "local", durationMs: 0, payloadBytes: 0, recordsReturned: 0, rpcName, error: "offline" },
    };
  }
  const { data, error } = await supabase!.rpc(rpcName);
  const durationMs = Math.round(performance.now() - started);
  const row = (data ?? {}) as Record<string, unknown>;
  const payloadBytes = estimateBytes(row);
  const meta: ReportQueryMeta = {
    source: "server",
    durationMs,
    payloadBytes,
    recordsReturned: 4,
    rpcName,
    error: error?.message ?? (row.ok ? undefined : String(row.error ?? "unknown")),
  };
  await recordReportQuery(meta);
  if (error || !row.ok) return { data: null, meta };

  const daily = row.daily as Record<string, unknown> | undefined;
  const weekly = row.weekly as Record<string, unknown> | undefined;
  const inventory = row.inventory as Record<string, unknown> | undefined;
  const customers = row.customers as Record<string, unknown> | undefined;
  if (!daily?.ok || !weekly?.ok || !inventory?.ok || !customers?.ok) return { data: null, meta };

  return {
    data: {
      daily: {
        day: String(daily.day ?? ""),
        transactionCount: Number(daily.transaction_count ?? 0),
        totalRevenueUgx: Number(daily.total_revenue_ugx ?? 0),
        cashCollectedUgx: Number(daily.cash_collected_ugx ?? 0),
        debtIssuedUgx: Number(daily.debt_issued_ugx ?? 0),
        discountsUgx: Number(daily.discounts_ugx ?? 0),
        taxesUgx: Number(daily.taxes_ugx ?? 0),
        estimatedProfitUgx: Number(daily.estimated_profit_ugx ?? 0),
        averageTransactionUgx: Number(daily.average_transaction_ugx ?? 0),
      },
      weekly: {
        startDay: String(weekly.start_day ?? ""),
        endDay: String(weekly.end_day ?? ""),
        transactionCount: Number(weekly.transaction_count ?? 0),
        totalRevenueUgx: Number(weekly.total_revenue_ugx ?? 0),
        cashCollectedUgx: Number(weekly.cash_collected_ugx ?? weekly.total_revenue_ugx ?? 0),
        dailyTrend: Array.isArray(weekly.daily_trend)
          ? (weekly.daily_trend as Record<string, unknown>[]).map((d) => ({
              day: String(d.day ?? ""),
              revenueUgx: Number(d.revenue_ugx ?? 0),
              transactionCount: Number(d.transaction_count ?? 0),
            }))
          : [],
        topProducts: Array.isArray(weekly.top_products)
          ? (weekly.top_products as Record<string, unknown>[]).map(parseProductRank)
          : [],
        activeCustomers: Number(weekly.active_customers ?? 0),
      },
      inventory: {
        stockValueAtCostUgx: Number(inventory.stock_value_at_cost_ugx ?? 0),
        lowStock: Array.isArray(inventory.low_stock)
          ? (inventory.low_stock as Record<string, unknown>[]).map((p) => ({
              productId: String(p.product_id ?? ""),
              name: String(p.name ?? ""),
              stockOnHand: Number(p.stock_on_hand ?? 0),
              minimumStockAlert: Number(p.minimum_stock_alert ?? 0),
            }))
          : [],
        outOfStock: Array.isArray(inventory.out_of_stock)
          ? (inventory.out_of_stock as Record<string, unknown>[]).map((p) => ({
              productId: String(p.product_id ?? ""),
              name: String(p.name ?? ""),
            }))
          : [],
        restockRecommendations: Array.isArray(inventory.restock_recommendations)
          ? (inventory.restock_recommendations as Record<string, unknown>[]).map((p) => ({
              productId: String(p.product_id ?? ""),
              name: String(p.name ?? ""),
              stockOnHand: Number(p.stock_on_hand ?? 0),
              minimumStockAlert: Number(p.minimum_stock_alert ?? 0),
              suggestedReorderQty: Number(p.suggested_reorder_qty ?? 0),
            }))
          : [],
      },
      customers: {
        startDay: String(customers.start_day ?? ""),
        endDay: String(customers.end_day ?? ""),
        topCustomers: Array.isArray(customers.top_customers)
          ? (customers.top_customers as Record<string, unknown>[]).map((c) => ({
              customerId: String(c.customer_id ?? ""),
              name: String(c.name ?? ""),
              purchaseCount: Number(c.purchase_count ?? 0),
              lifetimeRevenueUgx: Number(c.lifetime_revenue_ugx ?? 0),
              debtBalanceUgx: Number(c.debt_balance_ugx ?? 0),
            }))
          : [],
        totalDebtOutstandingUgx: Number(customers.total_debt_outstanding_ugx ?? 0),
        customersWithDebt: Number(customers.customers_with_debt ?? 0),
      },
    },
    meta,
  };
}

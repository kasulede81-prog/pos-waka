import type { DateFilterValue } from "../../lib/dateFilters";

export type AnalyticsCategory =
  | "overview"
  | "sales"
  | "profit"
  | "products"
  | "inventory"
  | "customers"
  | "debts"
  | "expenses"
  | "purchases"
  | "cash_flow"
  | "employees"
  | "taxes"
  | "performance"
  | "forecast";

export type AnalyticsKpiId =
  | "revenue"
  | "profit"
  | "sales"
  | "customers"
  | "avg_sale"
  | "credit_outstanding";

export type AnalyticsKpiCard = {
  id: AnalyticsKpiId;
  labelKey: string;
  value: string;
  pctChange: string | null;
  sparkline: { value: number }[];
  valueClass?: string;
  hidden?: boolean;
};

export type PaymentMixSlice = {
  id: string;
  labelKey: string;
  amountUgx: number;
  pct: number;
  colorClass: string;
};

export type AiInsightCard = {
  id: string;
  textKey: string;
  textVars?: Record<string, string | number>;
  tone: "green" | "blue" | "orange" | "purple" | "rose";
};

export type LeaderboardRow = {
  id: string;
  label: string;
  value: string;
  sub?: string;
};

export type ExtendedDatePreset =
  | DateFilterValue
  | { kind: "last_7_days" }
  | { kind: "last_month" }
  | { kind: "this_year" };

export const ANALYTICS_CATEGORIES: AnalyticsCategory[] = [
  "overview",
  "sales",
  "profit",
  "products",
  "inventory",
  "customers",
  "debts",
  "expenses",
  "purchases",
  "cash_flow",
  "employees",
  "taxes",
  "performance",
  "forecast",
];

export const ANALYTICS_KPI_IDS: AnalyticsKpiId[] = [
  "revenue",
  "profit",
  "sales",
  "customers",
  "avg_sale",
  "credit_outstanding",
];

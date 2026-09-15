import type { ComponentType, ReactNode } from "react";
import type {
  AuditLogEntry,
  BusinessType,
  CashDrawerAdjustment,
  CashExpense,
  Customer,
  DebtPayment,
  HospitalityFloorState,
  Language,
  Permission,
  Product,
  Purchase,
  ReturnRecord,
  Sale,
  ShiftRecord,
  ShopPreferences,
  StockMovement,
  Supplier,
  SupplierPayment,
} from "../../../types";
import type { DateFilterValue } from "../../../lib/dateFilters";
import type { ShopReportBundle } from "../../../hooks/useShopReporting";
import type { PharmacyExpiryReport } from "../../../lib/pharmacyReports";
import type { HospitalityReportSummary } from "../../../lib/hospitalityReports";
import type { ReportWidgetSlot } from "./reportWidgetSlots";
import type {
  AiInsightCard,
  AnalyticsCategory,
  AnalyticsKpiCard,
  AnalyticsKpiId,
  LeaderboardRow,
} from "../types";
import type { computeRangeAnalytics } from "../lib/analyticsPageView";

export type ReportsBusinessMode = "retail" | "pharmacy" | "hospitality" | "wholesale";

export type ReportsCenterContext = {
  lang: Language;
  mode: ReportsBusinessMode;
  businessType: BusinessType;
  can: (perm: Permission) => boolean;
  canProfit: boolean;
  pageTitle: string;
  periodLabel: string;
  filter: DateFilterValue;
  setFilter: (filter: DateFilterValue) => void;
  includeArchived: boolean;
  setIncludeArchived: (value: boolean) => void;
  archiveNotice: boolean;
  archivedSalesCount: number;
  needsArchive: boolean;
  compareEnabled: boolean;
  setCompareEnabled: (value: boolean | ((prev: boolean) => boolean)) => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  dateOpen: boolean;
  setDateOpen: (open: boolean) => void;
  exportOpen: boolean;
  setExportOpen: (open: boolean) => void;
  activeKpi: AnalyticsKpiId | null;
  setActiveKpi: (id: AnalyticsKpiId | null) => void;
  reportHint: string | null;
  setReportHint: (hint: string | null) => void;
  category: AnalyticsCategory;
  setCategory: (category: AnalyticsCategory) => void;
  legacyTabCleanup: () => void;
  report: ShopReportBundle;
  analytics: ReturnType<typeof computeRangeAnalytics>;
  kpiCards: AnalyticsKpiCard[];
  aiInsights: AiInsightCard[];
  topProducts: LeaderboardRow[];
  topCustomers: LeaderboardRow[];
  topCashiers: LeaderboardRow[];
  marginLeaders: Array<{ name: string; revenue: number; profit: number; pct: number }>;
  purchasesTodayUgx: number;
  purchasesInPeriodUgx: number;
  showDailyExport: boolean;
  reportDayKey: string;
  exportSummaryText: string;
  products: Product[];
  customers: Customer[];
  purchases: Purchase[];
  suppliers: Supplier[];
  sales: Sale[];
  returnRecords: ReturnRecord[];
  stockMovements: StockMovement[];
  cashExpenses: CashExpense[];
  debtPayments: DebtPayment[];
  supplierPayments: SupplierPayment[];
  cashDrawerAdjustments: CashDrawerAdjustment[];
  shifts: ShiftRecord[];
  preferences: ShopPreferences;
  auditLogs: AuditLogEntry[];
  pharmacyExpiryReport: PharmacyExpiryReport | null;
  hospitalityReports: HospitalityReportSummary | null;
  hospitalityOpenBills: { count: number; totalUgx: number } | null;
  hospitalityFloor: HospitalityFloorState | null | undefined;
  wholesaleSection: {
    debtOutstanding: number;
    count: number;
    stockValueAtCost: number;
    customers: Customer[];
  } | null;
  handleKpiSelect: (id: AnalyticsKpiId) => void;
  onExportPdf: () => void;
  onExportCsv: () => void;
  onExportExcel: () => void;
  onPrint: () => void;
  onShare: () => void;
  onCopy: () => void;
};

export type ReportWidgetProps = {
  ctx: ReportsCenterContext;
};

export type ReportWidgetDef = {
  id: string;
  slot: ReportWidgetSlot;
  priority: number;
  businessTypes: readonly ReportsBusinessMode[] | "*";
  permission?: Permission;
  visible?: (ctx: ReportsCenterContext) => boolean;
  Component: ComponentType<ReportWidgetProps>;
};

export type ReportSlotRender = (slot: ReportWidgetSlot) => ReactNode;

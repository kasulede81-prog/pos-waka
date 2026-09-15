import type { ComponentType, ReactNode } from "react";
import type {
  AuditAction,
  AuditLogEntry,
  BusinessType,
  Language,
  Permission,
  PharmacyControlledRegisterEntry,
  Product,
  ReturnRecord,
  Sale,
  Supplier,
  Customer,
} from "../../../types";
import type { AuditLogSearchIndex, AuditSearchFilters } from "../../../lib/auditSearch";
import type { DateFilterValue } from "../../../lib/dateFilters";
import type { RefundIntegrityReport } from "../../../lib/auditRefundIntegrity";
import type { InvestigationWidgetSlot } from "./investigationWidgetSlots";
import type {
  InvestigationCategory,
  InvestigationKpiCard,
  InvestigationKpiId,
  InvestigationTab,
  PharmacyInvestigationKpiCard,
  PharmacyInvestigationKpiId,
} from "../types";

export type InvestigationBusinessMode = "retail" | "pharmacy" | "hospitality" | "wholesale";

export type TimelinePresentation = {
  titleOverride?: string | null;
  subtitleOverride?: string | null;
};

export type InvestigationCenterContext = {
  lang: Language;
  mode: InvestigationBusinessMode;
  businessType: BusinessType;
  can: (perm: Permission) => boolean;
  tab: InvestigationTab;
  setTab: (tab: InvestigationTab) => void;
  category: InvestigationCategory;
  setCategory: (category: InvestigationCategory) => void;
  activeKpi: InvestigationKpiId | null;
  setActiveKpi: (kpi: InvestigationKpiId | null) => void;
  sharedKpi: InvestigationKpiId | null;
  pharmacyKpi: PharmacyInvestigationKpiId | null;
  tabs: InvestigationTab[];
  categories: InvestigationCategory[];
  accentCategories: ReadonlySet<InvestigationCategory>;
  getTimelinePresentation: (entry: AuditLogEntry) => TimelinePresentation | null;
  includeArchived: boolean;
  setIncludeArchived: (value: boolean) => void;
  quickFilter: DateFilterValue;
  dateFrom: string;
  dateTo: string;
  actorUserId: string;
  action: AuditAction | "all";
  productId: string;
  customerId: string;
  supplierId: string;
  searchText: string;
  onSearchTextChange: (value: string) => void;
  debouncedSearchText: string;
  filters: AuditSearchFilters;
  filtered: AuditLogEntry[];
  kpiCards: InvestigationKpiCard[];
  pharmacyKpiCards: PharmacyInvestigationKpiCard[];
  periodLabel: string;
  auditIndex: AuditLogSearchIndex;
  auditLogs: AuditLogEntry[];
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  shopName: string;
  productById: Map<string, { name: string }>;
  customerById: Map<string, { name: string }>;
  saleById: Map<string, Sale>;
  integrityReport: RefundIntegrityReport;
  returnsInRange: ReturnRecord[];
  allReturns: ReturnRecord[];
  shiftsInRange: Array<{
    id: string;
    actorName?: string;
    actorUserId: string;
    startAt: string;
    endAt?: string | null;
    salesTotalUgx: number;
    debtTotalUgx: number;
  }>;
  pharmacyRegister: PharmacyControlledRegisterEntry[];
  selected: AuditLogEntry | null;
  setSelected: (entry: AuditLogEntry | null) => void;
  menuEntry: AuditLogEntry | null;
  setMenuEntry: (entry: AuditLogEntry | null) => void;
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean) => void;
  exportOpen: boolean;
  setExportOpen: (open: boolean) => void;
  traceReturn: ReturnRecord | null;
  setTraceReturn: (record: ReturnRecord | null) => void;
  applyDateFilter: (quickDate: DateFilterValue) => void;
  applyFilters: (next: {
    dateFrom: string;
    dateTo: string;
    quickDate: DateFilterValue;
    actorUserId: string;
    action: AuditAction | "all";
    productId: string;
    customerId: string;
    supplierId: string;
  }) => void;
  syncUrl: (next: Partial<{ from: string; to: string; staff: string; action: string; q: string }>) => void;
  handleKpiSelect: (id: InvestigationKpiId) => void;
  handlePharmacyKpiSelect: (id: PharmacyInvestigationKpiId) => void;
  downloadCsv: (entries?: AuditLogEntry[]) => void;
  downloadExcel: (entries?: AuditLogEntry[]) => void;
  downloadPdf: (entries?: AuditLogEntry[]) => Promise<void>;
  downloadJson: (entries?: AuditLogEntry[]) => void;
  printEntries: (entries?: AuditLogEntry[]) => void;
  shareEntries: (entries?: AuditLogEntry[]) => Promise<void>;
  copyEntry: (entry: AuditLogEntry) => Promise<void>;
};

export type InvestigationWidgetProps = {
  ctx: InvestigationCenterContext;
};

export type InvestigationWidgetDef = {
  id: string;
  slot: InvestigationWidgetSlot;
  priority: number;
  businessTypes: readonly InvestigationBusinessMode[] | "*";
  permission?: Permission;
  visible?: (ctx: InvestigationCenterContext) => boolean;
  Component: ComponentType<InvestigationWidgetProps>;
};

export type InvestigationSlotRender = (slot: InvestigationWidgetSlot) => ReactNode;

import type { ComponentType, ReactNode } from "react";
import type {
  BusinessType,
  Language,
  Permission,
  Product,
  ShiftRecord,
} from "../../../types";
import type { DateFilterValue } from "../../../lib/dateFilters";
import type { OwnerCommandCenterBundle } from "../../../lib/ownerDashboardCommandCenter";
import type { SyncStatusApi } from "../../../hooks/useSyncStatus";
import type { PharmacyComplianceDashboardStats } from "../../../lib/pharmacyComplianceStats";
import type { PharmacyPatientDashboardStats } from "../../../lib/pharmacyPatientDashboardStats";
import type { PharmacyPrescriptionDashboardStats } from "../../../lib/pharmacyPrescriptionStats";
import type { PharmacyDashboardStats } from "../../../lib/pharmacyStats";
import type {
  CommandCenterRecommendation,
  DomainStatusRow,
  KpiCardModel,
} from "../../../lib/commandCenterPageView";
import type { AttentionItem } from "../../../lib/ownerCommandCenter";
import type { CloudRecoverySnapshot } from "../../../lib/cloudAuthorityAudit";
import type { DashboardWidgetSlot } from "./dashboardWidgetSlots";
import type { ActivityTimelineItem } from "../../pharmacy/dashboard/pharmacyDashboardPresentation";
import type { HospitalityDashboardStats } from "../../../lib/hospitalityStats";
import type { HospitalityFloorState } from "../../../types";

export type DashboardBusinessMode = "retail" | "pharmacy" | "hospitality" | "wholesale";

export type DashboardSurface = "command-center" | "pharmacy-operations";

export type DashboardCenterContext = {
  lang: Language;
  surface: DashboardSurface;
  mode: DashboardBusinessMode;
  businessType: BusinessType;
  can: (perm: Permission) => boolean;
  className?: string;
  // Command center
  filter?: DateFilterValue;
  setFilter?: (filter: DateFilterValue) => void;
  includeArchived?: boolean;
  setIncludeArchived?: (value: boolean) => void;
  archiveNotice?: boolean;
  archivedSalesCount?: number;
  needsArchive?: boolean;
  searchOpen?: boolean;
  setSearchOpen?: (open: boolean) => void;
  searchQuery?: string;
  setSearchQuery?: (query: string) => void;
  shopName?: string;
  periodLabel?: string;
  commandCenter?: OwnerCommandCenterBundle;
  cloudProtection?: CloudRecoverySnapshot;
  healthScore?: number;
  domainStatuses?: DomainStatusRow[];
  kpiCards?: KpiCardModel[];
  recommendations?: CommandCenterRecommendation[];
  summaryKey?: string;
  summaryVars?: Record<string, string | number>;
  filteredAttention?: {
    critical: AttentionItem[];
    warnings: AttentionItem[];
    information: AttentionItem[];
  };
  devicesTotal?: number;
  devicesOnline?: number;
  heroExpectedCash?: number;
  revenueSparkline?: { value: number }[];
  onAcknowledge?: (alertId: string) => void;
  exportDashboard?: () => void;
  shareDashboard?: () => void;
  printDashboard?: () => void;
  recommendationsSectionId?: string;
  // Pharmacy operations
  actorName?: string;
  todayKey?: string;
  dayClosed?: boolean;
  activeShift?: ShiftRecord | null;
  sync?: SyncStatusApi;
  failedPrints?: number;
  stats?: PharmacyDashboardStats;
  rxStats?: PharmacyPrescriptionDashboardStats;
  patientStats?: PharmacyPatientDashboardStats;
  complianceStats?: PharmacyComplianceDashboardStats;
  purchaseStats?: { todayCount: number; pendingDeliveries: number };
  allergyAlertCount?: number;
  activityItems?: ActivityTimelineItem[];
  products?: Product[];
  canSell?: boolean;
  canStock?: boolean;
  canReports?: boolean;
  canPurchases?: boolean;
  canPatients?: boolean;
  canReceipts?: boolean;
  canWriteOff?: boolean;
  canProfit?: boolean;
  showRevenue?: boolean;
  showActivityFeed?: boolean;
  hospitalityStats?: HospitalityDashboardStats | null;
  hospitalityFloor?: HospitalityFloorState | null;
};

export type DashboardWidgetProps = {
  ctx: DashboardCenterContext;
};

export type DashboardWidgetDef = {
  id: string;
  slot: DashboardWidgetSlot;
  priority: number;
  businessTypes: readonly DashboardBusinessMode[] | "*";
  permission?: Permission;
  visible?: (ctx: DashboardCenterContext) => boolean;
  Component: ComponentType<DashboardWidgetProps>;
};

export type DashboardSlotRender = (slot: DashboardWidgetSlot) => ReactNode;

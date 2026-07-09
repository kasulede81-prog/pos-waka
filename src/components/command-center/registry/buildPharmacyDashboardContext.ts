import type { Permission } from "../../../types";
import type { PharmacyOpsDashboardProps } from "../../pharmacy/dashboard/PharmacyOpsDashboardSections";
import type { DashboardCenterContext } from "./dashboardWidgetTypes";

export function buildPharmacyOpsDashboardContext(
  props: PharmacyOpsDashboardProps,
  can: (perm: Permission) => boolean,
): DashboardCenterContext {
  return {
    lang: props.lang,
    surface: "pharmacy-operations",
    mode: "pharmacy",
    businessType: "pharmacy",
    can,
    actorName: props.actorName,
    todayKey: props.todayKey,
    dayClosed: props.dayClosed,
    activeShift: props.activeShift,
    sync: props.sync,
    failedPrints: props.failedPrints,
    stats: props.stats,
    rxStats: props.rxStats,
    patientStats: props.patientStats,
    complianceStats: props.complianceStats,
    purchaseStats: props.purchaseStats,
    allergyAlertCount: props.allergyAlertCount,
    activityItems: props.activityItems,
    products: props.products,
    canSell: props.canSell,
    canStock: props.canStock,
    canReports: props.canReports,
    canPurchases: props.canPurchases,
    canPatients: props.canPatients,
    canReceipts: props.canReceipts,
    canWriteOff: props.canWriteOff,
    canProfit: props.canProfit,
    showRevenue: props.showRevenue,
    showActivityFeed: props.showActivityFeed,
  };
}

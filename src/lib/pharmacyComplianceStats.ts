import type { AuditLogEntry, PharmacyComplianceAlert, PharmacyControlledRegisterEntry, Product, ShopPreferences } from "../types";
import { dateKeyKampala } from "./datesUg";
import { controlledStockCount } from "./pharmacyControlledMedicine";
import { detectComplianceAlerts } from "./pharmacyComplianceAlerts";

export type PharmacyComplianceDashboardStats = {
  controlledToday: number;
  controlledStock: number;
  pendingApprovals: number;
  recentOverrides: number;
  regulatoryAlerts: number;
  alerts: PharmacyComplianceAlert[];
};

export function computeComplianceDashboardStats(input: {
  register: PharmacyControlledRegisterEntry[];
  products: Product[];
  auditLogs: AuditLogEntry[];
  preferences: ShopPreferences;
  pendingApprovalCount?: number;
  today?: Date;
}): PharmacyComplianceDashboardStats {
  const dayKey = dateKeyKampala(input.today ?? new Date());
  const controlledToday = input.register.filter(
    (e) => e.kind === "dispense" && e.businessDate === dayKey,
  ).length;
  const recentOverrides = input.register.filter((e) => e.kind === "override" && e.at.startsWith(dayKey)).length;
  const alerts = detectComplianceAlerts({
    register: input.register,
    auditLogs: input.auditLogs,
    preferences: input.preferences,
    today: input.today,
  });

  return {
    controlledToday,
    controlledStock: controlledStockCount(input.products),
    pendingApprovals: input.pendingApprovalCount ?? 0,
    recentOverrides,
    regulatoryAlerts: alerts.length,
    alerts: alerts.slice(0, 5),
  };
}

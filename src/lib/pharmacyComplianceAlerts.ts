import type { AuditLogEntry, PharmacyComplianceAlert, PharmacyControlledRegisterEntry, ShopPreferences } from "../types";
import { compliancePrefs } from "./pharmacyControlledMedicine";

export function detectComplianceAlerts(input: {
  register: PharmacyControlledRegisterEntry[];
  auditLogs: AuditLogEntry[];
  preferences: ShopPreferences;
  today?: Date;
}): PharmacyComplianceAlert[] {
  const prefs = compliancePrefs(input.preferences);
  const alerts: PharmacyComplianceAlert[] = [];
  const now = input.today ?? new Date();
  const windowMs = (prefs.frequentOverrideWindowHours ?? 24) * 60 * 60 * 1000;
  const since = new Date(now.getTime() - windowMs).toISOString();

  const recentOverrides = input.register.filter(
    (e) => e.kind === "override" && e.at >= since,
  );
  if (recentOverrides.length >= (prefs.frequentOverrideThreshold ?? 5)) {
    alerts.push({
      id: `alert-overrides-${since}`,
      at: now.toISOString(),
      severity: "warning",
      kind: "frequent_overrides",
      message: `${recentOverrides.length} manager overrides in the last ${prefs.frequentOverrideWindowHours ?? 24}h`,
    });
  }

  const largeThreshold = prefs.largeControlledQuantityThreshold ?? 30;
  for (const e of input.register) {
    if (e.kind === "dispense" && e.quantity >= largeThreshold && e.at >= since) {
      alerts.push({
        id: `alert-large-${e.id}`,
        at: e.at,
        severity: "warning",
        kind: "large_controlled_sale",
        message: `Large controlled dispense: ${e.productName} ×${e.quantity}`,
        relatedSaleId: e.saleId ?? null,
        relatedProductId: e.productId,
      });
    }
  }

  const failedApprovals = input.auditLogs.filter(
    (a) =>
      a.action === "pharmacy_manager_approval" &&
      a.at >= since &&
      String(a.payloadSummary).toLowerCase().includes("denied"),
  );
  if (failedApprovals.length >= (prefs.failedApprovalAlertThreshold ?? 3)) {
    alerts.push({
      id: `alert-failed-${since}`,
      at: now.toISOString(),
      severity: "critical",
      kind: "failed_approvals",
      message: `${failedApprovals.length} failed manager approval attempts`,
    });
  }

  const voidCount = input.auditLogs.filter(
    (a) => (a.action === "controlled_void" || a.action === "sale_void") && a.at >= since,
  ).length;
  if (voidCount >= 3) {
    alerts.push({
      id: `alert-voids-${since}`,
      at: now.toISOString(),
      severity: "warning",
      kind: "repeated_voids",
      message: `${voidCount} void events recently`,
    });
  }

  return alerts.sort((a, b) => b.at.localeCompare(a.at));
}

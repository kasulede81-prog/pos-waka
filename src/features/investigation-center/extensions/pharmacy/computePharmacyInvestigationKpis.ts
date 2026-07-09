import type {
  AuditLogEntry,
  PharmacyControlledRegisterEntry,
  PharmacyPrescription,
  Product,
  ReturnRecord,
  Sale,
  ShopPreferences,
} from "../../../../types";
import type { AuditLogSearchIndex } from "../../../../lib/auditSearch";
import { computeComplianceDashboardStats } from "../../../../lib/pharmacyComplianceStats";
import { computePharmacyDashboardStats } from "../../../../lib/pharmacyStats";
import { computePrescriptionDashboardStats } from "../../../../lib/pharmacyPrescriptionStats";
import type { PharmacyInvestigationKpiCard, PharmacyInvestigationKpiId } from "../../types";
import { shouldHideFromInvestigationCenter } from "../../lib/activityPresentation";

function countActionsInRange(
  index: AuditLogSearchIndex,
  dateFrom: string,
  dateTo: string,
  actions: ReadonlySet<string>,
): number {
  let count = 0;
  for (const idx of index.sortedIndices) {
    const entry = index.entries[idx]!;
    if (shouldHideFromInvestigationCenter(entry)) continue;
    const dk = index.dateKeys[idx]!;
    if (dk < dateFrom || dk > dateTo) continue;
    if (actions.has(entry.action)) count += 1;
  }
  return count;
}

export function computePharmacyInvestigationKpis(input: {
  index: AuditLogSearchIndex;
  dateFrom: string;
  dateTo: string;
  products: Product[];
  sales: Sale[];
  returns: ReturnRecord[];
  prescriptions: PharmacyPrescription[];
  register: PharmacyControlledRegisterEntry[];
  preferences: ShopPreferences;
  auditLogs: AuditLogEntry[];
}): PharmacyInvestigationKpiCard[] {
  const dashStats = computePharmacyDashboardStats(input.products, input.sales, input.returns);
  const rxStats = computePrescriptionDashboardStats(input.prescriptions, input.sales);
  const complianceStats = computeComplianceDashboardStats({
    register: input.register,
    products: input.products,
    auditLogs: input.auditLogs,
    preferences: input.preferences,
  });

  const controlledEvents = countActionsInRange(input.index, input.dateFrom, input.dateTo, new Set([
    "pharmacy_controlled_dispensed",
    "controlled_dispense",
    "controlled_override",
    "controlled_return",
    "controlled_destroy",
    "controlled_void",
    "witness_signed",
    "pharmacy_manager_approval",
  ]));

  const medicinesDispensed = countActionsInRange(input.index, input.dateFrom, input.dateTo, new Set([
    "pharmacy_prescription_dispensed",
    "pharmacy_controlled_dispensed",
    "controlled_dispense",
  ]));

  const batchWriteoffs = countActionsInRange(input.index, input.dateFrom, input.dateTo, new Set(["pharmacy_batch_writeoff"]));
  const fefoOverrides = countActionsInRange(input.index, input.dateFrom, input.dateTo, new Set(["pharmacy_fefo_override"]));

  const cards: PharmacyInvestigationKpiCard[] = [
    { id: "rx_today", labelKey: "icPharmacyKpiRxToday", value: rxStats.todayPrescriptions, iconTone: "purple" },
    { id: "medicines_dispensed", labelKey: "icPharmacyKpiMedicinesDispensed", value: medicinesDispensed || rxStats.dispensedToday, iconTone: "green" },
    { id: "controlled_events", labelKey: "icPharmacyKpiControlledEvents", value: controlledEvents || complianceStats.controlledToday, iconTone: "red" },
    { id: "near_expiry", labelKey: "icPharmacyKpiNearExpiry", value: dashStats.expiryCounts.d30, iconTone: "yellow" },
    { id: "expired_medicines", labelKey: "icPharmacyKpiExpiredMedicines", value: dashStats.expiryCounts.expired, iconTone: "red" },
    { id: "batch_writeoffs", labelKey: "icPharmacyKpiBatchWriteoffs", value: batchWriteoffs, iconTone: "orange" },
    { id: "fefo_overrides", labelKey: "icPharmacyKpiFefoOverrides", value: fefoOverrides, iconTone: "purple" },
    { id: "compliance_alerts", labelKey: "icPharmacyKpiComplianceAlerts", value: complianceStats.regulatoryAlerts, iconTone: "yellow" },
  ];

  return cards;
}

export function applyPharmacyKpiFilter(
  entries: AuditLogEntry[],
  kpiId: PharmacyInvestigationKpiId | null,
): AuditLogEntry[] {
  if (!kpiId) return entries;
  const sets: Record<PharmacyInvestigationKpiId, ReadonlySet<string>> = {
    rx_today: new Set([
      "pharmacy_prescription_created",
      "pharmacy_prescription_verified",
      "pharmacy_prescription_refilled",
      "pharmacy_prescription_reopened",
    ]),
    medicines_dispensed: new Set(["pharmacy_prescription_dispensed", "pharmacy_controlled_dispensed", "controlled_dispense"]),
    controlled_events: new Set([
      "pharmacy_controlled_dispensed",
      "controlled_dispense",
      "controlled_override",
      "controlled_return",
      "controlled_destroy",
      "controlled_void",
      "witness_signed",
      "pharmacy_manager_approval",
    ]),
    near_expiry: new Set(["expired_stock_writeoff"]),
    expired_medicines: new Set(["expired_stock_writeoff"]),
    batch_writeoffs: new Set(["pharmacy_batch_writeoff"]),
    fefo_overrides: new Set(["pharmacy_fefo_override"]),
    compliance_alerts: new Set([
      "pharmacy_controlled_dispensed",
      "controlled_dispense",
      "controlled_override",
      "controlled_return",
      "controlled_destroy",
      "witness_signed",
      "pharmacy_manager_approval",
    ]),
  };
  const set = sets[kpiId];
  return entries.filter((e) => set.has(e.action));
}

export function isPharmacyInvestigationKpiId(id: string): id is PharmacyInvestigationKpiId {
  return [
    "rx_today",
    "medicines_dispensed",
    "controlled_events",
    "near_expiry",
    "expired_medicines",
    "batch_writeoffs",
    "fefo_overrides",
    "compliance_alerts",
  ].includes(id);
}

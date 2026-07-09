import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../../../../types";
import { matchesCategory } from "../../lib/activityPresentation";
import {
  applyPharmacyKpiFilter,
  computePharmacyInvestigationKpis,
  isPharmacyInvestigationKpiId,
} from "./computePharmacyInvestigationKpis";
import { matchesPharmacyCategory } from "./pharmacyCategoryActions";
import { buildAuditLogSearchIndex } from "../../../../lib/auditSearch";

function entry(action: AuditLogEntry["action"], at = "2026-07-09T10:00:00.000Z"): AuditLogEntry {
  return {
    id: `e-${action}`,
    at,
    actorUserId: "local:Pharmacist",
    actorName: "Pharmacist",
    role: "manager",
    action,
    payloadSummary: "",
    payload: { productName: "Paracetamol" },
  };
}

describe("pharmacy investigation extensions", () => {
  it("matches pharmacy categories without affecting retail categories", () => {
    const rx = entry("pharmacy_prescription_dispensed");
    expect(matchesPharmacyCategory(rx, "dispensing")).toBe(true);
    expect(matchesPharmacyCategory(rx, "prescriptions")).toBe(true);
    expect(matchesCategory(rx, "dispensing")).toBe(true);
    expect(matchesCategory(rx, "sales")).toBe(false);
  });

  it("computes pharmacy KPI cards using existing helpers", () => {
    const logs = [
      entry("pharmacy_prescription_dispensed"),
      entry("pharmacy_fefo_override"),
      entry("pharmacy_batch_writeoff"),
      entry("controlled_dispense"),
    ];
    const index = buildAuditLogSearchIndex(logs, { products: [], customers: [], suppliers: [], lang: "en" });
    const cards = computePharmacyInvestigationKpis({
      index,
      dateFrom: "2026-07-09",
      dateTo: "2026-07-09",
      products: [],
      sales: [],
      returns: [],
      prescriptions: [],
      register: [],
      preferences: { businessType: "pharmacy" } as never,
      auditLogs: logs,
    });
    expect(cards.some((c) => c.id === "medicines_dispensed" && c.value >= 1)).toBe(true);
    expect(cards.some((c) => c.id === "fefo_overrides" && c.value >= 1)).toBe(true);
    expect(cards.some((c) => c.id === "batch_writeoffs" && c.value >= 1)).toBe(true);
  });

  it("filters timeline rows for pharmacy KPI selection", () => {
    const logs = [
      entry("pharmacy_batch_writeoff"),
      entry("sale_completed"),
    ];
    const filtered = applyPharmacyKpiFilter(logs, "batch_writeoffs");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.action).toBe("pharmacy_batch_writeoff");
    expect(isPharmacyInvestigationKpiId("batch_writeoffs")).toBe(true);
    expect(isPharmacyInvestigationKpiId("sales")).toBe(false);
  });
});

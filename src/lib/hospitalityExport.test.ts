import { describe, expect, it } from "vitest";
import {
  buildHospitalityKitchenPdfBlob,
  buildHospitalityTableRevenuePdfBlob,
  buildHospitalityWaiterPdfBlob,
} from "./hospitalityDocumentExports";
import type { HospitalityReportSummary } from "./hospitalityReports";

const sample: HospitalityReportSummary = {
  completedBillCount: 3,
  totalRevenueUgx: 30_000,
  avgBillUgx: 10_000,
  waiters: [{ waiterId: "w1", label: "Ali", billCount: 2, revenueUgx: 20_000, avgBillUgx: 10_000 }],
  categoryMix: [{ kind: "food", revenueUgx: 20_000, quantity: 4 }],
  tables: [{ label: "T1", billCount: 1, revenueUgx: 10_000 }],
  peakHours: [{ hour: 12, label: "12:00", billCount: 2, revenueUgx: 15_000 }],
};

describe("hospitalityExport", () => {
  it("builds waiter PDF", () => {
    const blob = buildHospitalityWaiterPdfBlob("en", sample);
    expect(blob.size).toBeGreaterThan(200);
  });

  it("builds kitchen PDF", () => {
    const blob = buildHospitalityKitchenPdfBlob("en", sample);
    expect(blob.size).toBeGreaterThan(200);
  });

  it("builds table PDF", () => {
    const blob = buildHospitalityTableRevenuePdfBlob("en", sample);
    expect(blob.size).toBeGreaterThan(200);
  });
});

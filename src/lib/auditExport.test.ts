import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../types";
import { buildAuditCsv, auditEntriesToExportRows } from "./auditExport";
import { extractAuditDetails } from "./auditCenterDetails";

const sample: AuditLogEntry[] = [
  {
    id: "1",
    at: "2026-06-10T12:00:00.000Z",
    actorUserId: "owner-1",
    actorName: "Owner",
    role: "owner",
    action: "price_change",
    payloadSummary: "Cola price change",
    deviceId: "dev-xyz",
    payload: {
      productId: "p1",
      name: "Cola",
      priceBefore: 1800,
      priceAfter: 2000,
      reason: "supplier increase",
    },
  },
];

describe("audit export", () => {
  it("extractAuditDetails surfaces before, after, and reason", () => {
    const d = extractAuditDetails(sample[0]!);
    expect(d.before).toBe("1800");
    expect(d.after).toBe("2000");
    expect(d.reason).toBe("supplier increase");
    expect(d.deviceId).toBe("dev-xyz");
  });

  it("auditEntriesToExportRows includes full detail columns", () => {
    const rows = auditEntriesToExportRows("en", sample);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      timestamp: "2026-06-10T12:00:00.000Z",
      staff: "Owner",
      role: "owner",
      reason: "supplier increase",
      before: "1800",
      after: "2000",
      device: "dev-xyz",
    });
  });

  it("buildAuditCsv includes header and data rows with reason and before/after", () => {
    const csv = buildAuditCsv("en", sample);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("Timestamp");
    expect(lines[0]).toContain("Reason");
    expect(lines[0]).toContain("Before");
    expect(lines[0]).toContain("After");
    expect(lines[1]).toContain("2026-06-10T12:00:00.000Z");
    expect(lines[1]).toContain("supplier increase");
    expect(lines[1]).toContain("1800");
    expect(lines[1]).toContain("2000");
  });
});

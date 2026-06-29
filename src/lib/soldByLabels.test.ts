import { describe, expect, it } from "vitest";
import { buildSoldByNameByUserId, resolveSoldByUserId } from "./soldByLabels";
import type { AuditLogEntry, Sale } from "../types";
import { computeTopCashiers } from "../features/business-analytics/lib/analyticsPageView";

describe("soldByLabels", () => {
  it("maps staff ids to staff account names", () => {
    const map = buildSoldByNameByUserId({
      staffAccounts: [{ id: "abc", name: "Jane", role: "cashier", active: true, createdAt: "", updatedAt: "" }],
    });
    expect(resolveSoldByUserId("en", "staff:abc", map)).toBe("Jane");
  });

  it("maps auth uuid from sale_completed audit to actor name", () => {
    const ownerId = "f20ae9a3-8b5a-4f66-bf71-12c728a89c0c";
    const audit: AuditLogEntry = {
      id: "1",
      action: "sale_completed",
      actorUserId: ownerId,
      actorName: "Super Admin",
      createdAt: "2026-06-11T10:00:00.000Z",
      payload: { soldByUserId: ownerId, totalUgx: 2000 },
    };
    const map = buildSoldByNameByUserId({ auditLogs: [audit] });
    expect(resolveSoldByUserId("en", ownerId, map)).toBe("Super Admin");
  });

  it("computeTopCashiers shows cashier name instead of uuid", () => {
    const ownerId = "f20ae9a3-8b5a-4f66-bf71-12c728a89c0c";
    const sale: Sale = {
      id: "s1",
      lines: [],
      subtotalUgx: 2000,
      totalUgx: 2000,
      cashPaidUgx: 2000,
      debtUgx: 0,
      estimatedProfitUgx: 500,
      createdAt: "2026-06-11T10:00:00.000Z",
      pendingSync: false,
      soldByUserId: ownerId,
    };
    const map = buildSoldByNameByUserId({
      auditLogs: [
        {
          id: "1",
          action: "sale_completed",
          actorUserId: ownerId,
          actorName: "Super Admin",
          createdAt: sale.createdAt,
          payload: { soldByUserId: ownerId },
        },
      ],
    });
    const rows = computeTopCashiers(
      [sale],
      { fromKey: "2026-06-11", toKey: "2026-06-11", isSingleDay: true },
      { lang: "en", nameByUserId: map },
    );
    expect(rows[0]?.label).toBe("Super Admin");
  });
});

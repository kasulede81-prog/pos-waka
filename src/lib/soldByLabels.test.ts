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
      at: "2026-06-11T10:00:00.000Z",
      action: "sale_completed",
      actorUserId: ownerId,
      actorName: "Super Admin",
      role: "owner",
      payloadSummary: "Sale completed",
      payload: { soldByUserId: ownerId, totalUgx: 2000 },
    };
    const map = buildSoldByNameByUserId({ auditLogs: [audit] });
    expect(resolveSoldByUserId("en", ownerId, map)).toBe("Super Admin");
  });

  it("maps linkedAuthUserId Auth UUID to staff name", () => {
    const cashier = "22222222-2222-4222-8222-222222222222";
    const map = buildSoldByNameByUserId({
      staffAccounts: [
        {
          id: "abc",
          name: "Jane",
          role: "cashier",
          active: true,
          createdAt: "",
          updatedAt: "",
          linkedAuthUserId: cashier,
        },
      ],
      ownerUserId: "11111111-1111-4111-8111-111111111111",
      ownerDisplayName: "Owner",
    });
    expect(resolveSoldByUserId("en", cashier, map)).toBe("Jane");
    expect(resolveSoldByUserId("en", "33333333-3333-4333-8333-333333333333", map)).toBe(
      "Unknown seller",
    );
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
          at: sale.createdAt,
          action: "sale_completed",
          actorUserId: ownerId,
          actorName: "Super Admin",
          role: "owner",
          payloadSummary: "Sale completed",
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

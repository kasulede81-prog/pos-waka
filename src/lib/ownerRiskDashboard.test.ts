import { describe, expect, it } from "vitest";
import type { AuditLogEntry, ReturnRecord, VoidRecord } from "../types";
import { buildOwnerRiskCards, LARGE_DISCOUNT_UGX_THRESHOLD } from "./ownerRiskDashboard";

const TODAY = "2026-06-11";

function audit(partial: Partial<AuditLogEntry> & Pick<AuditLogEntry, "action">): AuditLogEntry {
  return {
    id: crypto.randomUUID(),
    at: `${TODAY}T12:00:00.000Z`,
    actorUserId: "staff-1",
    actorName: "Sarah",
    role: "manager",
    payloadSummary: "x",
    payload: partial.payload ?? {},
    ...partial,
  };
}

describe("owner risk dashboard", () => {
  it("includes price changes and product deletions today", () => {
    const todayAuditLogs: AuditLogEntry[] = [
      audit({ action: "price_change", payload: { productId: "p1", priceBefore: 1000, priceAfter: 1200 } }),
      audit({ action: "product_remove", payload: { name: "Fanta" } }),
    ];
    const cards = buildOwnerRiskCards({
      lang: "en",
      todayKey: TODAY,
      todayAuditLogs,
      todayReturns: [],
      todayVoids: [],
    });
    const kinds = cards.map((c) => c.kind);
    expect(kinds).toContain("price_changes");
    expect(kinds).toContain("product_deletions");
    expect(cards.find((c) => c.kind === "price_changes")?.count).toBe(1);
  });

  it("counts large discounts above threshold", () => {
    const todayAuditLogs: AuditLogEntry[] = [
      audit({ action: "discount_given", payload: { discountUgx: LARGE_DISCOUNT_UGX_THRESHOLD } }),
      audit({ action: "discount_given", payload: { discountUgx: 500 } }),
    ];
    const cards = buildOwnerRiskCards({
      lang: "en",
      todayKey: TODAY,
      todayAuditLogs,
      todayReturns: [],
      todayVoids: [],
    });
    const disc = cards.find((c) => c.kind === "large_discounts");
    expect(disc?.count).toBe(1);
    expect(disc?.impactUgx).toBe(LARGE_DISCOUNT_UGX_THRESHOLD);
  });

  it("aggregates void and return impact from records", () => {
    const todayReturns: ReturnRecord[] = [
      {
        id: "r1",
        saleId: "s1",
        productId: "p1",
        productName: "Cola",
        quantity: 1,
        refundAmountUgx: 3_000,
        reason: "damaged",
        actorUserId: "staff-1",
        createdAt: `${TODAY}T10:00:00.000Z`,
      },
    ];
    const todayVoids: VoidRecord[] = [
      {
        id: "v1",
        saleId: "s1",
        productId: "p1",
        productName: "Cola",
        amountUgx: 2_000,
        reason: "wrong_item",
        lineIndex: 0,
        quantity: 1,
        actorUserId: "staff-2",
        actorName: "John",
        createdAt: `${TODAY}T09:00:00.000Z`,
      },
    ];
    const cards = buildOwnerRiskCards({
      lang: "en",
      todayKey: TODAY,
      todayAuditLogs: [],
      todayReturns,
      todayVoids,
    });
    expect(cards.find((c) => c.kind === "returns")?.impactUgx).toBe(3_000);
    expect(cards.find((c) => c.kind === "voids")?.impactUgx).toBe(2_000);
  });
});

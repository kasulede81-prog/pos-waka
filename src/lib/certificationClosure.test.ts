import { describe, expect, it } from "vitest";
import type { Sale, SaleLine } from "../types";
import {
  mergeSaleFromCloudPull,
  pickAuthoritativeCompletedFinancial,
} from "./saleFinancialMerge";
import { validateReturnAuthorization, canPerformUnlinkedReturn } from "./returnPolicy";
import { getAuditRetentionStatus, AUDIT_RETENTION_WARN_COUNT } from "./auditHealth";

const DAY = "2026-05-31";

function line(total: number, voided = false): SaleLine {
  return {
    id: "line-1",
    productId: "p1",
    name: "Item",
    quantity: 1,
    unitPriceUgx: total,
    unitCostUgx: 100,
    estimatedProfitUgx: total - 100,
    inputMode: "quantity",
    updatedAt: `${DAY}T10:00:00.000Z`,
    lineTotalUgx: total,
    voided,
    voidedAt: voided ? `${DAY}T11:00:00.000Z` : null,
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "totalUgx">): Sale {
  return {
    id: "sale-1",
    status: "completed",
    createdAt: `${DAY}T10:00:00.000Z`,
    updatedAt: `${DAY}T10:00:00.000Z`,
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.cashPaidUgx ?? partial.totalUgx,
    debtUgx: partial.debtUgx ?? 0,
    lines: partial.lines ?? [line(partial.totalUgx)],
    estimatedProfitUgx: partial.totalUgx,
    pendingSync: false,
    lastSyncError: null,
    ...partial,
  };
}

describe("return policy", () => {
  it("cashier cannot perform unlinked return", () => {
    expect(canPerformUnlinkedReturn("cashier")).toBe(false);
    const r = validateReturnAuthorization({
      role: "cashier",
      saleId: null,
      saleFound: false,
      note: "Customer walked in with receipt copy",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorKey).toBe("returnUnlinkedForbidden");
  });

  it("manager unlinked requires note", () => {
    const short = validateReturnAuthorization({
      role: "manager",
      saleId: null,
      saleFound: false,
      note: "ab",
    });
    expect(short.ok).toBe(false);

    const ok = validateReturnAuthorization({
      role: "manager",
      saleId: null,
      saleFound: false,
      note: "Walk-in refund approved",
    });
    expect(ok.ok).toBe(true);
  });
});

describe("completed sale financial merge", () => {
  it("prefers sale with more adjustments (lower total)", () => {
    const full = sale({ totalUgx: 100_000, cashPaidUgx: 100_000 });
    const adjusted = sale({ totalUgx: 60_000, cashPaidUgx: 60_000, voidedTotalUgx: 40_000 });
    expect(pickAuthoritativeCompletedFinancial(full, adjusted)).toBe(adjusted);
  });

  it("remote newer timestamp does not raise completed totalUgx", () => {
    const local = sale({
      totalUgx: 60_000,
      cashPaidUgx: 60_000,
      voidedTotalUgx: 40_000,
      updatedAt: `${DAY}T12:00:00.000Z`,
    });
    const remote = sale({
      totalUgx: 100_000,
      cashPaidUgx: 100_000,
      updatedAt: `${DAY}T18:00:00.000Z`,
    });
    const merged = mergeSaleFromCloudPull(local, remote);
    expect(merged.totalUgx).toBe(60_000);
    expect(merged.cashPaidUgx).toBe(60_000);
  });

  it("merges voided line flags from remote", () => {
    const local = sale({ totalUgx: 80_000, lines: [line(80_000, false)] });
    const remote = sale({
      totalUgx: 100_000,
      lines: [line(80_000, true)],
      updatedAt: `${DAY}T18:00:00.000Z`,
    });
    const merged = mergeSaleFromCloudPull(local, remote);
    expect(merged.lines[0]!.voided).toBe(true);
    expect(merged.totalUgx).toBe(80_000);
  });
});

describe("audit retention", () => {
  it("warns at 4000 entries", () => {
    const logs = Array.from({ length: AUDIT_RETENTION_WARN_COUNT }, (_, i) => ({
      id: `a-${i}`,
      at: `${DAY}T10:00:00.000Z`,
      actorUserId: "u1",
      role: "owner" as const,
      action: "sale_completed" as const,
      payloadSummary: "x",
      payload: {},
    }));
    expect(getAuditRetentionStatus(logs).warn).toBe(true);
  });
});

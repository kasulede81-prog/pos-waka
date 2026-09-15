import { describe, expect, it } from "vitest";
import { coalesceKeyForOp, sortSyncQueueByPriority, syncKindPriority } from "./syncQueuePriority";
import type { SyncOperation } from "../types";

describe("syncQueuePriority", () => {
  it("assigns P0 to operational kinds", () => {
    expect(syncKindPriority("pending_sales")).toBe(0);
    expect(syncKindPriority("sale")).toBe(0);
    expect(syncKindPriority("pending_stock_updates")).toBe(0);
  });

  it("assigns P1 to catalog and people", () => {
    expect(syncKindPriority("customer")).toBe(1);
    expect(syncKindPriority("pending_purchases")).toBe(1);
  });

  it("assigns P2 to settings-like kinds", () => {
    expect(syncKindPriority("audit_log")).toBe(2);
  });

  it("sorts queue by priority then createdAt", () => {
    const queue: SyncOperation[] = [
      { id: "a", kind: "audit_log", payload: {}, createdAt: "2026-01-01T00:00:01Z", attempts: 0 },
      { id: "b", kind: "sale", payload: {}, createdAt: "2026-01-01T00:00:02Z", attempts: 0 },
      { id: "c", kind: "customer", payload: {}, createdAt: "2026-01-01T00:00:00Z", attempts: 0 },
    ];
    const sorted = sortSyncQueueByPriority(queue);
    expect(sorted.map((o) => o.id)).toEqual(["b", "c", "a"]);
  });

  it("builds coalesce keys for catalog entities", () => {
    expect(coalesceKeyForOp("product", { id: "p1" })).toBe("product:p1");
    expect(coalesceKeyForOp("sale", { saleId: "s1" })).toBe("sale:s1");
    expect(coalesceKeyForOp("pending_staff", { staff: { id: "staff-1" } })).toBe("pending_staff:staff-1");
  });
});

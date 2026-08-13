import { describe, expect, it } from "vitest";
import {
  ALL_INCREMENTAL_PULL_ENTITIES,
  incrementalCheckpointPatch,
  incrementalEntitiesForReason,
  isPullReasonSubset,
  mergeSyncPullReasons,
  shouldForceCloudPull,
  shouldRunAncillaryCloudBundle,
} from "./syncReasons";

describe("syncReasons", () => {
  it("scopes sale ACK to sales only", () => {
    expect(incrementalEntitiesForReason("sale_ack")).toEqual(["sales"]);
    expect(shouldRunAncillaryCloudBundle("sale_ack")).toBe(false);
    expect(shouldForceCloudPull("sale_ack", true)).toBe(false);
  });

  it("keeps the full incremental bundle for resume/reconnect/startup", () => {
    for (const reason of ["resume", "reconnect", "startup", "safety_poll"] as const) {
      expect(incrementalEntitiesForReason(reason)).toEqual([...ALL_INCREMENTAL_PULL_ENTITIES]);
      expect(shouldRunAncillaryCloudBundle(reason)).toBe(true);
    }
    expect(shouldForceCloudPull("resume", true)).toBe(true);
    expect(shouldForceCloudPull("reconnect", true)).toBe(true);
  });

  it("does not treat sale ACK as a full bundle even if force is requested", () => {
    expect(incrementalEntitiesForReason("sale_ack")).not.toContain("products");
    expect(incrementalEntitiesForReason("sale_ack")).not.toContain("customers");
    expect(incrementalEntitiesForReason("sale_ack")).not.toContain("stock_movements");
    expect(incrementalEntitiesForReason("sale_ack")).toHaveLength(1);
  });

  it("merges a sale ACK into a broader resume pull", () => {
    expect(mergeSyncPullReasons("sale_ack", "resume")).toBe("resume");
    expect(isPullReasonSubset("sale_ack", "resume")).toBe(true);
    expect(isPullReasonSubset("resume", "sale_ack")).toBe(false);
  });

  it("only advances checkpoints for pulled entities", () => {
    const patch = incrementalCheckpointPatch(["sales"], { salesAt: "2026-08-13T00:00:00.000Z" });
    expect(patch.sales).toBe(true);
    expect(patch.products).toBe(false);
    expect(patch.customers).toBe(false);
    expect(patch.stockMovements).toBe(false);
    expect(patch.salesAt).toBe("2026-08-13T00:00:00.000Z");
  });
});

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

  it("scopes catalog ACK to catalog plus products", () => {
    expect(incrementalEntitiesForReason("catalog_change")).toEqual(["catalog", "products"]);
    expect(shouldRunAncillaryCloudBundle("catalog_change")).toBe(false);
    expect(shouldForceCloudPull("catalog_change", true)).toBe(false);
  });

  it("scopes shop-policy ACK to shop_policy only", () => {
    expect(incrementalEntitiesForReason("shop_policy_change")).toEqual(["shop_policy"]);
    expect(incrementalEntitiesForReason("shop_policy_change")).not.toContain("catalog");
    expect(shouldRunAncillaryCloudBundle("shop_policy_change")).toBe(false);
    expect(shouldForceCloudPull("shop_policy_change", true)).toBe(false);
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
    expect(patch.catalog).toBe(false);
    expect(patch.salesAt).toBe("2026-08-13T00:00:00.000Z");
  });

  it("advances the catalog cursor when catalog was pulled", () => {
    const patch = incrementalCheckpointPatch(["catalog"], { catalogAt: "2026-08-29T12:00:00.000Z" });
    expect(patch.catalog).toBe(true);
    expect(patch.catalogAt).toBe("2026-08-29T12:00:00.000Z");
    expect(patch.sales).toBe(false);
    expect(patch.shopPolicy).toBe(false);
  });

  it("advances the shop-policy cursor when shop_policy was pulled", () => {
    const patch = incrementalCheckpointPatch(["shop_policy"], { shopPolicyAt: "2026-09-06T12:00:00.000Z" });
    expect(patch.shopPolicy).toBe(true);
    expect(patch.shopPolicyAt).toBe("2026-09-06T12:00:00.000Z");
    expect(patch.catalog).toBe(false);
  });

  it("includes audit_logs in the normal incremental bundle but not sale ACK", () => {
    expect(ALL_INCREMENTAL_PULL_ENTITIES).toContain("audit_logs");
    expect(incrementalEntitiesForReason("resume")).toContain("audit_logs");
    expect(incrementalEntitiesForReason("sale_ack")).not.toContain("audit_logs");
    const patch = incrementalCheckpointPatch(["audit_logs"], { auditLogsAt: "2026-09-06T08:00:00.000Z" });
    expect(patch.auditLogs).toBe(true);
    expect(patch.auditLogsAt).toBe("2026-09-06T08:00:00.000Z");
    expect(patch.sales).toBe(false);
  });
});

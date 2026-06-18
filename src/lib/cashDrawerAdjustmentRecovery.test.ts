import { describe, expect, it } from "vitest";
import type { CashDrawerAdjustment } from "../types";
import { mergeCashDrawerAdjustmentsFromCloudPull } from "./cashDrawerAdjustmentRecovery";

const DAY = "2026-06-11T10:00:00.000Z";

function adj(id: string, amountUgx: number, updatedAt: string): CashDrawerAdjustment {
  return {
    id,
    type: "owner_injection",
    amountUgx,
    note: "",
    actorUserId: "owner",
    occurredAt: DAY,
    createdAt: DAY,
    updatedAt,
    pendingSync: false,
  };
}

describe("mergeCashDrawerAdjustmentsFromCloudPull", () => {
  it("merges by id with newer updatedAt winning (multi-device)", async () => {
    const local = [adj("a1", 50_000, `${DAY}`)];
    const cloud = [adj("a1", 100_000, "2026-06-11T12:00:00.000Z"), adj("a2", 20_000, `${DAY}`)];
    const merged = await mergeCashDrawerAdjustmentsFromCloudPull(local, cloud);
    expect(merged.find((r) => r.id === "a1")?.amountUgx).toBe(100_000);
    expect(merged.find((r) => r.id === "a2")?.amountUgx).toBe(20_000);
    expect(merged).toHaveLength(2);
  });

  it("keeps local when newer than cloud row", async () => {
    const local = [adj("a1", 80_000, "2026-06-11T13:00:00.000Z")];
    const cloud = [adj("a1", 50_000, `${DAY}`)];
    const merged = await mergeCashDrawerAdjustmentsFromCloudPull(local, cloud);
    expect(merged[0]?.amountUgx).toBe(80_000);
  });
});

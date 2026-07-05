import { describe, expect, it } from "vitest";
import type { StaffAccount } from "../types";
import { mergeStaffAccountsForCloudSync, pickNewerStaffAccount } from "./staffRecovery";

function staff(id: string, updatedAt: string, extra?: Partial<StaffAccount>): StaffAccount {
  return {
    id,
    name: `Staff ${id}`,
    role: "cashier",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
    ...extra,
  };
}

describe("mergeStaffAccountsForCloudSync", () => {
  it("prefers newer row on conflict", () => {
    const local = [staff("a", "2026-06-01T10:00:00.000Z")];
    const cloud = [{ ...staff("a", "2026-06-01T11:00:00.000Z"), name: "Cloud A" }];
    const merged = mergeStaffAccountsForCloudSync(local, cloud);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe("Cloud A");
  });

  it("keeps local-only staff indefinitely (never auto-delete)", () => {
    const local = [staff("local-only", "2026-01-01T10:00:00.000Z", { pendingCloudSync: true })];
    const merged = mergeStaffAccountsForCloudSync(local, []);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("local-only");
  });

  it("includes cloud staff missing locally", () => {
    const cloud = [staff("remote", "2026-06-11T10:00:00.000Z")];
    const merged = mergeStaffAccountsForCloudSync([], cloud);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("remote");
  });

  it("clears pendingCloudSync when cloud confirms staff", () => {
    const local = [staff("a", "2026-06-01T10:00:00.000Z", { pendingCloudSync: true })];
    const cloud = [staff("a", "2026-06-01T11:00:00.000Z")];
    const merged = mergeStaffAccountsForCloudSync(local, cloud);
    expect(merged[0]?.pendingCloudSync).toBe(false);
  });
});

describe("pickNewerStaffAccount", () => {
  it("prefers cloud on equal updatedAt", () => {
    const local = staff("a", "2026-06-01T10:00:00.000Z");
    const cloud = { ...staff("a", "2026-06-01T10:00:00.000Z"), name: "Cloud" };
    expect(pickNewerStaffAccount(local, cloud).name).toBe("Cloud");
  });
});

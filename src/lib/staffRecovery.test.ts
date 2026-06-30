import { describe, expect, it } from "vitest";
import type { StaffAccount } from "../types";
import {
  mergeStaffAccountsForCloudSync,
  pickNewerStaffAccount,
  STAFF_PENDING_PUSH_GRACE_MS,
} from "./staffRecovery";

function staff(id: string, updatedAt: string): StaffAccount {
  return {
    id,
    name: `Staff ${id}`,
    role: "cashier",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
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

  it("drops local-only staff older than pending grace", () => {
    const nowMs = Date.parse("2026-06-11T12:00:00.000Z");
    const local = [staff("deleted", "2026-06-01T10:00:00.000Z")];
    const merged = mergeStaffAccountsForCloudSync(local, [], {
      nowMs,
      pendingGraceMs: STAFF_PENDING_PUSH_GRACE_MS,
    });
    expect(merged).toHaveLength(0);
  });

  it("keeps recent local-only staff during pending push grace", () => {
    const nowMs = Date.parse("2026-06-11T12:00:00.000Z");
    const local = [staff("new", "2026-06-11T11:59:30.000Z")];
    const merged = mergeStaffAccountsForCloudSync(local, [], {
      nowMs,
      pendingGraceMs: STAFF_PENDING_PUSH_GRACE_MS,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("new");
  });

  it("includes cloud staff missing locally", () => {
    const cloud = [staff("remote", "2026-06-11T10:00:00.000Z")];
    const merged = mergeStaffAccountsForCloudSync([], cloud);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("remote");
  });
});

describe("pickNewerStaffAccount", () => {
  it("prefers cloud on equal updatedAt", () => {
    const local = staff("a", "2026-06-01T10:00:00.000Z");
    const cloud = { ...staff("a", "2026-06-01T10:00:00.000Z"), name: "Cloud" };
    expect(pickNewerStaffAccount(local, cloud).name).toBe("Cloud");
  });
});

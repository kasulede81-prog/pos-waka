import { describe, expect, it } from "vitest";
import {
  DEVICE_PENDING_APPROVAL_TTL_MS,
  formatPendingApprovalCountdown,
  isPendingApprovalExpired,
  pendingApprovalRemainingMs,
} from "./devicePendingApproval";

describe("devicePendingApproval", () => {
  it("counts down to zero after one minute", () => {
    const requestedAt = "2026-07-10T10:00:00.000Z";
    const nowMs = Date.parse(requestedAt) + DEVICE_PENDING_APPROVAL_TTL_MS - 15_000;
    expect(pendingApprovalRemainingMs(requestedAt, nowMs)).toBe(15_000);
    expect(isPendingApprovalExpired(requestedAt, nowMs)).toBe(false);
    expect(
      isPendingApprovalExpired(requestedAt, Date.parse(requestedAt) + DEVICE_PENDING_APPROVAL_TTL_MS),
    ).toBe(true);
  });

  it("formats mm:ss countdown", () => {
    expect(formatPendingApprovalCountdown(65_000)).toBe("1:05");
    expect(formatPendingApprovalCountdown(4_200)).toBe("0:05");
  });
});

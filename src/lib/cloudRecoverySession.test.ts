import { beforeEach, describe, expect, it } from "vitest";
import {
  beginCloudRecoverySession,
  failCloudRecoverySession,
  isCloudRecoveryBackgroundActive,
  isCloudRecoveryLockActive,
  resetCloudRecoverySessionForRetry,
  unlockCoreRecoverySession,
} from "./cloudRecoverySession";

describe("cloudRecoverySession lock (24.1BB)", () => {
  beforeEach(() => {
    resetCloudRecoverySessionForRetry();
  });
  it("locks only during active download", () => {
    beginCloudRecoverySession();
    expect(isCloudRecoveryLockActive()).toBe(true);
    unlockCoreRecoverySession();
    expect(isCloudRecoveryLockActive()).toBe(false);
    expect(isCloudRecoveryBackgroundActive()).toBe(true);
  });

  it("does not lock after failed when not active", () => {
    beginCloudRecoverySession();
    failCloudRecoverySession("fail", null, "cloud_merge_failed");
    expect(isCloudRecoveryLockActive()).toBe(false);
  });
});

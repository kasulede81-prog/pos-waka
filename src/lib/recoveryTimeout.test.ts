import { describe, expect, it, vi } from "vitest";
import { RecoveryTimeoutError, withRecoveryTimeoutPromise } from "./recoveryTimeout";

describe("recoveryTimeout", () => {
  it("throws RecoveryTimeoutError when operation exceeds limit", async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<string>(() => {});
      const pending = withRecoveryTimeoutPromise(never, {
        kind: "probe",
        timeoutMs: 100,
        retries: 0,
      });
      const assertPromise = expect(pending).rejects.toBeInstanceOf(RecoveryTimeoutError);
      await vi.advanceTimersByTimeAsync(100);
      await assertPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves when operation completes in time", async () => {
    const result = await withRecoveryTimeoutPromise(Promise.resolve(42), {
      kind: "staff",
      timeoutMs: 1000,
    });
    expect(result).toBe(42);
  });
});

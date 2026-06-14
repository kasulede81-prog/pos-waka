import { describe, expect, it } from "vitest";
import { resolveReturnRefundUgx } from "./returnRefundInput";

describe("return clarity / cap warning", () => {
  it("reports wasCapped when entered amount exceeds max", () => {
    const result = resolveReturnRefundUgx({
      refundInput: "8000",
      suggestedRefundUgx: 5_000,
      maxRefundUgx: 6_000,
    });
    expect(result.refundUgx).toBe(6_000);
    expect(result.wasCapped).toBe(true);
  });

  it("uses suggestion when input empty", () => {
    const result = resolveReturnRefundUgx({
      refundInput: "",
      suggestedRefundUgx: 4_500,
      maxRefundUgx: 6_000,
    });
    expect(result.refundUgx).toBe(4_500);
    expect(result.usedSuggestion).toBe(true);
    expect(result.wasCapped).toBe(false);
  });

  it("accepts entered amount within max without capping", () => {
    const result = resolveReturnRefundUgx({
      refundInput: "5500",
      suggestedRefundUgx: 5_000,
      maxRefundUgx: 6_000,
    });
    expect(result.refundUgx).toBe(5_500);
    expect(result.wasCapped).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { formatUgx } from "./formatUgx";

describe("formatUgx", () => {
  it("shows full digits without k shorthand", () => {
    expect(formatUgx(1500)).toBe("UGX 1,500");
    expect(formatUgx(7000)).toBe("UGX 7,000");
    expect(formatUgx(1_500_000)).toBe("UGX 1,500,000");
  });

  it("preserves negative amounts", () => {
    expect(formatUgx(-100)).toBe("-UGX 100");
  });
});

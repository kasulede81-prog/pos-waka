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

  /**
   * Inventory Overview "Stock value" display audit: confirms the exact
   * integer amount is shown with thousands separators, never rounded to the
   * nearest thousand and never K/M/B-abbreviated. 634,950 must render as
   * "UGX 634,950" — not "UGX 635,000".
   */
  it("never rounds to the nearest thousand — exact non-round amounts stay exact", () => {
    expect(formatUgx(500)).toBe("UGX 500");
    expect(formatUgx(4_500)).toBe("UGX 4,500");
    expect(formatUgx(634_950)).toBe("UGX 634,950");
    expect(formatUgx(634_950)).not.toBe("UGX 635,000");
    expect(formatUgx(1_250_000)).toBe("UGX 1,250,000");
    expect(formatUgx(12_500_750)).toBe("UGX 12,500,750");
  });
});

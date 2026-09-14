import { describe, expect, it } from "vitest";
import { formatShortUgx } from "./overviewStats";

/**
 * WAKA POS — Inventory Overview "Stock value" display audit.
 *
 * `formatShortUgx` here is the exact function `InventoryHealthSnapshot.tsx`
 * imports and calls on `stats.inventoryValueUgx` to render the Inventory
 * Overview "Stock value" card:
 *
 *   {showInventoryValue ? formatShortUgx(stats.inventoryValueUgx) : "—"}
 *
 * Despite the "Short" name (a leftover from an earlier abbreviated-display
 * design shared by a few similarly-named page-view formatters), it is
 * currently a direct pass-through to `formatUgx` (see formatUgx.test.ts for
 * the underlying formatter's own tests) — exact integer UGX, thousands
 * separators, no K/M/B abbreviation, no rounding to the nearest thousand.
 * These tests lock that behavior in specifically for the Inventory Overview
 * consumer, so a future change to `formatShortUgx` (here or in any of its
 * sibling definitions) can't silently reintroduce abbreviated/rounded
 * display without failing a test tied to the actual Stock value card.
 */
describe("formatShortUgx (Inventory Overview Stock value formatter)", () => {
  it("displays the exact integer amount, never rounded to the nearest thousand", () => {
    expect(formatShortUgx(500)).toBe("UGX 500");
    expect(formatShortUgx(4_500)).toBe("UGX 4,500");
    expect(formatShortUgx(634_950)).toBe("UGX 634,950");
    expect(formatShortUgx(634_950)).not.toBe("UGX 635,000");
    expect(formatShortUgx(1_250_000)).toBe("UGX 1,250,000");
    expect(formatShortUgx(12_500_750)).toBe("UGX 12,500,750");
  });

  it("never abbreviates with K/M/B", () => {
    const result = formatShortUgx(12_500_750);
    expect(result).not.toMatch(/[KMB]/);
  });
});

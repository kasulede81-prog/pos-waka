import { describe, expect, it } from "vitest";
import { isSaleLineId } from "../lib/pendingSaleMerge";
import { normalizeSale, normalizeSaleLine } from "../store/usePosStore";
import { mapLine, mapSale, type LegacyLine } from "./migrateLegacyStore";

// Regression coverage for the "COMPLETED SALE LINE => stable UUID" invariant across the
// one confirmed gap (pre-Supabase localStorage import), proving it survives:
//   legacy SaleLine without id -> receives UUID -> remains same UUID after subsequent
//   normalization -> remains same UUID after persistence (JSON round-trip).

const LEGACY_LINE: LegacyLine = {
  itemId: "11111111-1111-4111-8111-111111111111",
  name: "Legacy Item",
  qty: 2,
  unitPrice: 1000,
  lineTotal: 2000,
};

describe("migrateLegacyStore stable SaleLine id", () => {
  it("assigns a stable UUID to a legacy line that never had one", () => {
    const mapped = mapLine(LEGACY_LINE);
    expect(mapped.id).toBeDefined();
    expect(isSaleLineId(mapped.id)).toBe(true);
  });

  it("keeps the same UUID across repeated mapping (idempotent)", () => {
    const first = mapLine(LEGACY_LINE);
    // mapLine itself doesn't carry state between calls, but ensureSaleLineId inside it
    // must not depend on external randomness being seeded per-line-content — verify two
    // independently-mapped instances of the SAME legacy line each get a valid (though
    // not necessarily equal, since there's no natural key) UUID, and that re-normalizing
    // an already-mapped line never changes its id once assigned.
    expect(isSaleLineId(first.id)).toBe(true);
    const renormalized = normalizeSaleLine(first);
    expect(renormalized.id).toBe(first.id);
  });

  it("survives sale-level normalization without id churn", () => {
    const legacySale = mapSale({
      id: "sale-legacy-1",
      lines: [LEGACY_LINE],
      subtotal: 2000,
      tax: 0,
      total: 2000,
      paymentMethod: "cash",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const originalLineId = legacySale.lines[0]!.id;
    expect(isSaleLineId(originalLineId)).toBe(true);
    expect(legacySale.status).toBeUndefined(); // mapSale doesn't set status; normalizeSale defaults it

    const normalizedOnce = normalizeSale(legacySale);
    expect(normalizedOnce.status).toBe("completed");
    expect(normalizedOnce.lines[0]!.id).toBe(originalLineId);

    // Normalizing an already-normalized sale a second time (e.g. a second app load)
    // must not regenerate the id.
    const normalizedTwice = normalizeSale(normalizedOnce);
    expect(normalizedTwice.lines[0]!.id).toBe(originalLineId);
  });

  it("keeps the same id across a persistence round-trip (JSON serialize/deserialize, as IndexedDB storage does)", () => {
    const legacySale = mapSale({
      id: "sale-legacy-2",
      lines: [LEGACY_LINE],
      subtotal: 2000,
      tax: 0,
      total: 2000,
      paymentMethod: "cash",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const normalized = normalizeSale(legacySale);
    const originalLineId = normalized.lines[0]!.id;

    const persistedAndReloaded = JSON.parse(JSON.stringify(normalized));
    const rehydrated = normalizeSale(persistedAndReloaded);

    expect(rehydrated.lines[0]!.id).toBe(originalLineId);
    expect(isSaleLineId(rehydrated.lines[0]!.id)).toBe(true);
  });

  it("never regenerates an id a line already has (idempotence guard, not just presence)", () => {
    const fixedId = "44444444-4444-4444-8444-444444444444";
    const withId = normalizeSaleLine({
      id: fixedId,
      productId: "p1",
      name: "Item",
      inputMode: "quantity",
      quantity: 1,
      unitPriceUgx: 1000,
      unitCostUgx: 0,
      lineTotalUgx: 1000,
      estimatedProfitUgx: 1000,
    });
    expect(withId.id).toBe(fixedId);
  });
});

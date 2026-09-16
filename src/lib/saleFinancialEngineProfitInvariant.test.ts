import { describe, expect, it } from "vitest";
import { applyCartDiscountSnapshot, resolveSaleLineFinancials } from "./saleFinancialEngine";
import type { SaleLine } from "../types";

/**
 * P2 remediation (financial certification audit, P2#5) — estimatedProfitUgx
 * vs grossProfitUgx.
 *
 * The audit found every write site sets both fields to the identical value
 * in the same atomic write (client: applyCartDiscountSnapshot below; server:
 * shop_correct_sale_line_financials's single jsonb_build_object merge). This
 * file makes that invariant explicit and machine-checked, so a future change
 * to either write path that lets the two fields diverge fails a test instead
 * of silently shipping. It does not rename or alter any financial value.
 */

function line(overrides: Partial<SaleLine> = {}): SaleLine {
  return {
    id: "line-1",
    productId: "product-1",
    name: "Test product",
    quantity: 1,
    unitPriceUgx: 1000,
    lineTotalUgx: 1000,
    inputMode: "quantity",
    ...overrides,
  } as SaleLine;
}

describe("estimatedProfitUgx === grossProfitUgx invariant", () => {
  it("applyCartDiscountSnapshot always writes estimatedProfitUgx equal to the grossProfitUgx it just computed", () => {
    const lines = [
      line({ id: "a", lineTotalUgx: 4000, cogsUgx: 3000 }),
      line({ id: "b", lineTotalUgx: 6000, cogsUgx: 4500 }),
    ];
    const snapshotted = applyCartDiscountSnapshot(lines, 0);
    for (const l of snapshotted) {
      expect(l.estimatedProfitUgx).toBe(l.grossProfitUgx);
    }
  });

  it("holds even when a cart-level discount is applied (both fields still move together)", () => {
    const lines = [
      line({ id: "a", lineTotalUgx: 4000, cogsUgx: 3000 }),
      line({ id: "b", lineTotalUgx: 6000, cogsUgx: 4500 }),
    ];
    const snapshotted = applyCartDiscountSnapshot(lines, 1000);
    for (const l of snapshotted) {
      expect(l.estimatedProfitUgx).toBe(l.grossProfitUgx);
    }
    // Sanity: the discount actually changed something, so this isn't a
    // vacuously true check against untouched inputs.
    expect(snapshotted.some((l) => l.cartDiscountUgx! > 0)).toBe(true);
  });

  it("holds across fractional COGS (non-divisible pack cost) — the exact eggs scenario from the audit", () => {
    // 5 pieces, unit cost 334 (slot-FIFO), matching the live N&C test sale.
    const snapshotted = applyCartDiscountSnapshot(
      [line({ id: "eggs", quantity: 5, lineTotalUgx: 2500, cogsUgx: 1670 })],
      0,
    );
    expect(snapshotted[0]!.grossProfitUgx).toBe(830);
    expect(snapshotted[0]!.estimatedProfitUgx).toBe(830);
  });

  it("resolveSaleLineFinancials trusts grossProfitUgx over estimatedProfitUgx when a snapshot has both — never silently substitutes the wrong field", () => {
    // Deliberately construct a line where the two fields DISAGREE (simulating
    // a hypothetical future bug where one write path updated one field but
    // not the other) to prove the canonical reader does not quietly prefer
    // the wrong one.
    const divergent = line({
      lineTotalUgx: 4000,
      netRevenueUgx: 4000,
      cogsUgx: 3000,
      grossProfitUgx: 1000, // authoritative
      estimatedProfitUgx: 9999, // must be ignored when grossProfitUgx is present
    });
    const fin = resolveSaleLineFinancials(divergent);
    expect(fin.grossProfitUgx).toBe(1000);
    expect(fin.grossProfitUgx).not.toBe(9999);
  });

  it("resolveSaleLineFinancials falls back to estimatedProfitUgx only when grossProfitUgx itself is genuinely absent (legacy line, no full snapshot)", () => {
    const legacyLine = line({
      lineTotalUgx: 4000,
      cogsUgx: undefined,
      grossProfitUgx: undefined,
      netRevenueUgx: undefined,
      estimatedProfitUgx: 1000,
      unitCostUgx: 3000,
    });
    const fin = resolveSaleLineFinancials(legacyLine);
    // No full {netRevenueUgx, cogsUgx, grossProfitUgx} snapshot exists, so
    // this is the documented fallback path (hasSnapshot === false) — still
    // reads estimatedProfitUgx, but only because nothing more authoritative
    // is available, not as a silent substitution for a present grossProfitUgx.
    expect(fin.grossProfitUgx).toBe(1000);
  });
});

/**
 * Phase 7 — the return modal lets the cashier pick WHICH line of a product is being returned.
 * (Pure logic; the repo tests UI through its logic and source contracts, not a DOM.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReturnRecord, Sale, SaleLine } from "../types";
import {
  defaultReturnLineId,
  needsReturnLineChoice,
  resolveReturnLineId,
  returnLineChoices,
  returnLineContext,
  returnProductPickList,
} from "./returnLineChoices";

const P = "burger";
const L1 = "line-1";
const L2 = "line-2";

const line = (id: string, name: string, qty: number, unit: number, extra: Partial<SaleLine> = {}, productId = P): SaleLine => ({
  id,
  productId,
  name,
  inputMode: "quantity",
  quantity: qty,
  unitPriceUgx: unit,
  unitCostUgx: 0,
  lineTotalUgx: qty * unit,
  estimatedProfitUgx: 0,
  ...extra,
});
const mk = (lines: SaleLine[]): Sale => {
  const total = lines.reduce((a, l) => a + l.lineTotalUgx, 0);
  return { id: "s", status: "completed", createdAt: "2026-09-19T08:00:00.000Z", subtotalUgx: total, totalUgx: total, cashPaidUgx: total, debtUgx: 0, estimatedProfitUgx: 0, pendingSync: false, lines };
};
const ret = (qty: number, refund: number, saleLineId?: string): ReturnRecord => ({
  id: `r-${qty}-${saleLineId ?? "x"}`,
  saleId: "s",
  productId: P,
  productName: "Burger",
  quantity: qty,
  refundAmountUgx: refund,
  reason: "wrong_item",
  saleLineId,
  actorUserId: "u",
  createdAt: "2026-09-19T09:00:00.000Z",
});

describe("single line per product (every ordinary retail sale) — unchanged", () => {
  const sale = mk([line(L1, "Soap", 5, 2_000, {}, "soap"), line("x", "Coke", 2, 2_500, {}, "coke")]);
  it("offers no choice and uses the one line", () => {
    const choices = returnLineChoices(sale, "soap", []);
    expect(choices).toHaveLength(1);
    expect(needsReturnLineChoice(choices)).toBe(false);
    expect(resolveReturnLineId(choices, null)).toBe(L1);
    expect(resolveReturnLineId(choices, "something-else")).toBe(L1); // a stray pick is ignored: there is nothing to choose
  });
  it("the product list is exactly what it was: one entry per line, named as the line", () => {
    expect(returnProductPickList(sale, () => undefined)).toEqual([
      { id: "soap", name: "Soap" },
      { id: "coke", name: "Coke" },
    ]);
  });
});

describe("several lines of one product", () => {
  const sale = mk([
    line(L1, "Burger (Regular)", 3, 20_000),
    line(L2, "Burger (Large)", 2, 25_000, { selectedModifiers: [{ groupId: "g", optionId: "cheese", optionLabel: "Extra cheese", priceDeltaUgx: 0 } as never] }),
  ]);

  it("shows both lines with what the cashier needs to tell them apart", () => {
    const choices = returnLineChoices(sale, P, []);
    expect(needsReturnLineChoice(choices)).toBe(true);
    expect(choices.map((c) => [c.lineId, c.name, c.context, c.remainingQty, c.unitPriceUgx, c.lineTotalUgx])).toEqual([
      [L1, "Burger (Regular)", "", 3, 20_000, 60_000],
      [L2, "Burger (Large)", "Extra cheese", 2, 25_000, 50_000],
    ]);
  });

  it("the product list has ONE entry (no duplicate option values/keys), labelled with the product name", () => {
    const list = returnProductPickList(sale, (id) => (id === P ? "Burger" : undefined));
    expect(list).toEqual([{ id: P, name: "Burger" }]);
  });

  it("remaining quantity is per LINE: a return recorded against line 2 does not shrink line 1", () => {
    const choices = returnLineChoices(sale, P, [ret(1, 25_000, L2)]);
    expect(choices.map((c) => c.remainingQty)).toEqual([3, 1]);
  });

  it("legacy returns with no line id count against the first line only, as they always did", () => {
    const choices = returnLineChoices(sale, P, [ret(1, 20_000)]);
    expect(choices.map((c) => c.remainingQty)).toEqual([2, 2]);
  });

  it("the cashier's pick is what is submitted", () => {
    const choices = returnLineChoices(sale, P, []);
    expect(resolveReturnLineId(choices, L2)).toBe(L2);
    expect(resolveReturnLineId(choices, L1)).toBe(L1);
  });

  it("no silent wrong line: with no valid pick, the default is the first line that still has something to return", () => {
    const choices = returnLineChoices(sale, P, [ret(3, 60_000, L1)]); // line 1 fully returned
    expect(choices[0]!.exhausted).toBe(true);
    expect(defaultReturnLineId(choices)).toBe(L2);
    expect(resolveReturnLineId(choices, null)).toBe(L2);
    expect(resolveReturnLineId(choices, L1)).toBe(L2); // an exhausted line cannot be submitted
    expect(resolveReturnLineId(choices, "not-a-line")).toBe(L2);
  });

  it("a voided line is not offered", () => {
    const voided = mk([line(L1, "Burger (Regular)", 3, 20_000, { voided: true }), line(L2, "Burger (Large)", 2, 25_000)]);
    const choices = returnLineChoices(voided, P, []);
    expect(choices.map((c) => c.lineId)).toEqual([L2]);
    expect(needsReturnLineChoice(choices)).toBe(false);
  });

  it("modifier context is empty when there are none", () => {
    expect(returnLineContext({ selectedModifiers: undefined, notes: null })).toBe("");
    expect(returnLineContext({ selectedModifiers: [{ groupId: "g", optionId: "a", optionLabel: "No onion", priceDeltaUgx: 0 } as never, { groupId: "g", optionId: "b", priceDeltaUgx: 0 } as never], notes: null })).toBe("No onion, b");
  });
});

describe("the modal is wired to it (source contract)", () => {
  const src = readFileSync(join(process.cwd(), "src/components/pos/ReturnProductModal.tsx"), "utf8");
  it("submits the chosen line id, derives every figure from that line, and only shows the picker when there is a choice", () => {
    expect(src).toContain("returnLineChoices");
    expect(src).toContain("needsReturnLineChoice");
    expect(src).toMatch(/saleLineId:\s*selectedLineId/);
    expect(src).toMatch(/remainingReturnableQuantity\(sale,\s*productId,\s*returnRecords,\s*0,\s*selectedLineId\)/);
    expect(src).toMatch(/suggestReturnRefundUgx\(sale,\s*productId,\s*qtyN,\s*returnRecords,\s*selectedLineId\)/);
    expect(src).toMatch(/lineId:\s*selectedLineId/);
  });
});

describe("the refund figures follow the chosen line (breakdown + saved-return trace)", () => {
  const sale = mk([line(L1, "Burger (Regular)", 3, 20_000), line(L2, "Burger (Large)", 2, 25_000)]);
  it("the modal's breakdown for line 2 uses line 2's price and quantity, not line 1's", async () => {
    const { buildLineRefundBreakdown } = await import("./refundBreakdown");
    const first = buildLineRefundBreakdown({ sale, productId: P, returnQty: 1, returnRecords: [] });
    const second = buildLineRefundBreakdown({ sale, productId: P, returnQty: 1, returnRecords: [], lineId: L2 });
    expect([first!.productName, first!.customerPaidUgx, first!.quantitySold]).toEqual(["Burger (Regular)", 20_000, 3]);
    expect([second!.productName, second!.customerPaidUgx, second!.quantitySold]).toEqual(["Burger (Large)", 25_000, 2]);
  });
  it("a saved return keeps showing the line it was taken from", async () => {
    const { buildReturnRefundTrace } = await import("./refundBreakdown");
    const record = ret(1, 25_000, L2);
    // (as in a real sale, the header total has already shrunk by the refund that was booked)
    const afterReturn = { ...sale, totalUgx: sale.totalUgx - 25_000 };
    const trace = buildReturnRefundTrace({ sale: afterReturn, returnRecord: record, returnRecords: [record], actorLabel: "Owner" });
    expect(trace.lineBreakdown?.productName).toBe("Burger (Large)");
    expect(trace.lineBreakdown?.customerPaidUgx).toBe(25_000);
  });
});

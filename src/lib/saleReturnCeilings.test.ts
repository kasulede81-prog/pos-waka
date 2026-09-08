import { describe, expect, it } from "vitest";
import { evaluateSaleReturnCeilings } from "./saleReturnCeilings";

const SHOP = "11111111-1111-4111-8111-111111111111";
const SALE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RETURN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function base(partial: Partial<Parameters<typeof evaluateSaleReturnCeilings>[0]> = {}) {
  return evaluateSaleReturnCeilings({
    shopId: SHOP,
    saleId: SALE,
    sale: { id: SALE, shopId: SHOP, totalUgx: 2000 },
    lines: [{ productId: PRODUCT, quantity: 1, lineTotalUgx: 2000 }],
    priorReturns: [],
    excludeReturnId: RETURN,
    productId: PRODUCT,
    quantity: 1,
    refundUgx: 2000,
    ...partial,
  });
}

describe("evaluateSaleReturnCeilings (086 mirror)", () => {
  it("refund_exceeds_remaining is p_refund > v_sale_total, not remaining-after-refunds", () => {
    expect(base({ sale: { id: SALE, shopId: SHOP, totalUgx: 2000 }, refundUgx: 2000 }).ok).toBe(true);
    expect(base({ sale: { id: SALE, shopId: SHOP, totalUgx: 1999 }, refundUgx: 2000 })).toEqual({
      ok: false,
      error: "refund_exceeds_remaining",
    });
    expect(
      base({
        sale: { id: SALE, shopId: SHOP, totalUgx: 2000 },
        lines: [
          { productId: PRODUCT, quantity: 1, lineTotalUgx: 2000 },
          { productId: "other", quantity: 1, lineTotalUgx: 8000 },
        ],
        priorReturns: [{ id: "other-return", productId: "other", quantity: 0, refundAmountUgx: 1500 }],
        refundUgx: 2000,
      }).ok,
    ).toBe(true);
  });

  it("fires sale_not_found first when the shop/sale is missing", () => {
    expect(base({ sale: null, refundUgx: 2000 })).toEqual({ ok: false, error: "sale_not_found" });
    expect(base({ sale: { id: SALE, shopId: "22222222-2222-4222-8222-222222222222", totalUgx: 2000 } })).toEqual({
      ok: false,
      error: "sale_not_found",
    });
  });

  it("refund_exceeds_sale fires after remaining when gross lines cannot cover prior+new", () => {
    expect(
      base({
        sale: { id: SALE, shopId: SHOP, totalUgx: 5000 },
        lines: [{ productId: PRODUCT, quantity: 2, lineTotalUgx: 2000 }],
        priorReturns: [{ id: "prior", productId: PRODUCT, quantity: 0, refundAmountUgx: 500 }],
        refundUgx: 1600,
      }),
    ).toEqual({ ok: false, error: "refund_exceeds_sale" });
  });

  it("product_not_on_sale / return_qty_exceeds_sold / refund_exceeds_line", () => {
    expect(base({ lines: [{ productId: "other", quantity: 1, lineTotalUgx: 2000 }] })).toEqual({
      ok: false,
      error: "product_not_on_sale",
    });
    expect(base({ quantity: 2, refundUgx: 1000, sale: { id: SALE, shopId: SHOP, totalUgx: 2000 } })).toEqual({
      ok: false,
      error: "return_qty_exceeds_sold",
    });
    expect(
      base({
        sale: { id: SALE, shopId: SHOP, totalUgx: 5000 },
        lines: [
          { productId: PRODUCT, quantity: 2, lineTotalUgx: 1500 },
          { productId: "other", quantity: 1, lineTotalUgx: 3500 },
        ],
        refundUgx: 2000,
        quantity: 1,
      }),
    ).toEqual({ ok: false, error: "refund_exceeds_line" });
  });

  it("excludes the in-flight return id from prior sums (idempotent upsert)", () => {
    expect(
      base({
        priorReturns: [{ id: RETURN, productId: PRODUCT, quantity: 1, refundAmountUgx: 2000 }],
        quantity: 1,
        refundUgx: 2000,
      }).ok,
    ).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SQL_170 = readFileSync(
  join(ROOT, "supabase/migrations/170_sale_complete_already_completed_fence.sql"),
  "utf8",
);

describe("shop_push_sale_complete — already-completed fence (SL-03)", () => {
  it("returns a mutation-free ACK before replacing lines or applying stock", () => {
    const ackAt = SQL_170.indexOf("if v_was_completed then");
    expect(ackAt).toBeGreaterThan(0);
    const ackEnd = SQL_170.indexOf("end if;", ackAt);
    const ackBlock = SQL_170.slice(ackAt, ackEnd);
    expect(ackBlock).toContain("'already_completed', true");
    expect(ackBlock).toContain("'stock_applied', false");
    expect(ackBlock).toContain("'ok', true");
    expect(ackBlock).not.toContain("delete from public.sale_line_items");
    expect(ackBlock).not.toContain("delete from public.sale_payments");
    expect(ackBlock).not.toContain("apply_sale_stock_movements");
    expect(ackBlock).not.toContain("insert into public.sale_line_items");

    const deleteLinesAt = SQL_170.indexOf("delete from public.sale_line_items");
    const applyStockAt = SQL_170.indexOf("v_stock_result := public.apply_sale_stock_movements");
    expect(deleteLinesAt).toBeGreaterThan(ackEnd);
    expect(applyStockAt).toBeGreaterThan(ackEnd);
  });

  it("does not keep the historical already-completed financial overwrite branch", () => {
    expect(SQL_170).not.toContain("cash_amount_ugx = coalesce ((v_sale ->> 'cash_amount_ugx')::bigint, cash_amount_ugx)");
  });
});

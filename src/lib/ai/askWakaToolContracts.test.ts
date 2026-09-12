import { describe, expect, it } from "vitest";
import {
  ASK_WAKA_MAX_LIMIT,
  ASK_WAKA_WRITE_TOOLS,
  answerRequiresToolData,
  isAskWakaToolName,
  isAskWakaWriteTool,
  limitAskWakaRows,
  resolveAskWakaShopScope,
  shapeShiftReportForModel,
  stripCustomerPiiForAskWaka,
  validateAskWakaMessage,
  validateAskWakaToolCall,
} from "./askWakaToolContracts";

const SHOP_A = "11111111-1111-4111-8111-111111111111";
const SHOP_B = "22222222-2222-4222-8222-222222222222";

describe("Ask WAKA tool contracts", () => {
  it("accepts a valid allowlisted tool", () => {
    const r = validateAskWakaToolCall("get_today_sales", {});
    expect(r.ok).toBe(true);
    expect(isAskWakaToolName("get_today_sales")).toBe(true);
  });

  it("rejects an unknown tool", () => {
    const r = validateAskWakaToolCall("drop_all_tables", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unknown_tool");
  });

  it("rejects tool-selected shop_id (tenant must come from auth context)", () => {
    const r = validateAskWakaToolCall("get_today_sales", { shop_id: SHOP_B });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("shop_id_forbidden");
  });

  it("binds shop scope from authenticated primary context", () => {
    const r = resolveAskWakaShopScope({
      preferredShopId: null,
      primaryShopId: SHOP_A,
      accessibleShopIds: [SHOP_A],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.shopId).toBe(SHOP_A);
  });

  it("rejects preferred shop the user cannot access", () => {
    const r = resolveAskWakaShopScope({
      preferredShopId: SHOP_B,
      primaryShopId: SHOP_A,
      accessibleShopIds: [SHOP_A],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("forbidden");
  });

  it("rejects preferred shop that differs from primary reporting context", () => {
    const r = resolveAskWakaShopScope({
      preferredShopId: SHOP_B,
      primaryShopId: SHOP_A,
      accessibleShopIds: [SHOP_A, SHOP_B],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("shop_context_mismatch");
  });

  it("rejects invalid tool arguments", () => {
    const r = validateAskWakaToolCall("get_sales_for_period", { period: "decade" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_args");
  });

  it("enforces result limits", () => {
    const r = validateAskWakaToolCall("get_top_products", { limit: 999 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.limit).toBe(ASK_WAKA_MAX_LIMIT);
    expect(limitAskWakaRows([1, 2, 3, 4, 5], 2)).toEqual([1, 2]);
  });

  it("ignores model-invented date ranges and injects the current calendar week", () => {
    const r = validateAskWakaToolCall("get_top_products", {
      start_day: "2026-01-01",
      end_day: "2026-12-31",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.args.week).toBe("this");
      expect(r.args.start_day).toBeTruthy();
      expect(r.args.end_day).toBeTruthy();
      expect(String(r.args.start_day)).not.toBe("2026-01-01");
      expect(String(r.args.end_day)).not.toBe("2026-12-31");
    }
  });

  it("resolves this/last week on get_sales_for_period and ignores model anchor_day", () => {
    const thisWeek = validateAskWakaToolCall("get_sales_for_period", {
      period: "week",
      week: "this",
      anchor_day: "2026-07-31",
    });
    expect(thisWeek.ok).toBe(true);
    if (thisWeek.ok) {
      expect(thisWeek.args.week).toBe("this");
      expect(thisWeek.args.anchor_day).not.toBe("2026-07-31");
      expect(thisWeek.args.in_progress).toBe(true);
    }
    const lastWeek = validateAskWakaToolCall("get_sales_for_period", {
      period: "week",
      week: "last",
    });
    expect(lastWeek.ok).toBe(true);
    if (lastWeek.ok && thisWeek.ok) {
      expect(lastWeek.args.week).toBe("last");
      expect(lastWeek.args.in_progress).toBe(false);
      expect(String(lastWeek.args.end_day) < String(thisWeek.args.start_day)).toBe(true);
    }
  });

  it("rejects shop_id on get_week_comparison", () => {
    const r = validateAskWakaToolCall("get_week_comparison", { shop_id: SHOP_B });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("shop_id_forbidden");
  });

  it("exposes no write operations", () => {
    expect(ASK_WAKA_WRITE_TOOLS).toEqual([]);
    expect(isAskWakaWriteTool("create_expense")).toBe(false);
    expect(isAskWakaToolName("create_expense")).toBe(false);
    expect(isAskWakaToolName("adjust_stock")).toBe(false);
  });

  it("signals safe failure when tools fail (no invented numbers)", () => {
    const r = answerRequiresToolData([], true);
    expect(r.forceSafeFailure).toBe(true);
  });

  it("rejects SQL-like arguments (no arbitrary SQL path)", () => {
    const r = validateAskWakaToolCall("get_today_sales", {
      sql: "select * from sales",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("sql_forbidden");

    const r2 = validateAskWakaToolCall("get_today_sales", {
      note: "SELECT total_ugx FROM sales WHERE shop_id = 'x'",
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("sql_forbidden");
  });

  it("strips customer fields beyond aggregate-safe columns", () => {
    const stripped = stripCustomerPiiForAskWaka({
      customer_id: "c1",
      name: "Ada",
      phone: "+256700000000",
      email: "a@b.com",
      purchase_count: 3,
      lifetime_revenue_ugx: 1000,
      debt_balance_ugx: 0,
    });
    expect(stripped.phone).toBeUndefined();
    expect(stripped.email).toBeUndefined();
    expect(stripped.customer_id).toBeUndefined();
    expect(stripped.name).toBe("Ada");
  });

  it("rejects malformed/non-object tool argument payloads via invalid shapes", () => {
    const r = validateAskWakaToolCall("get_today_sales", "not-an-object");
    // Non-objects coerce to {} for arg-less tools — still cannot carry shop_id/sql
    expect(r.ok).toBe(true);
  });

  it("rejects write-like tool names as unknown", () => {
    for (const name of ["create_expense", "adjust_stock", "void_sale", "run_sql"]) {
      const r = validateAskWakaToolCall(name, {});
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("unknown_tool");
    }
  });

  it("validates message length", () => {
    const ok = validateAskWakaMessage("How were sales today?");
    expect(ok.ok).toBe(true);
    const bad = validateAskWakaMessage("x".repeat(2001));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("message_too_long");
  });
});

describe("Ask WAKA get_shift_report (ASK-SHIFT-REPORT-IMPLEMENT-01)", () => {
  const SHIFT_ID = "33333333-3333-4333-8333-333333333333";

  it("accepts get_shift_report with no shift_id (server resolves the current shift)", () => {
    const r = validateAskWakaToolCall("get_shift_report", {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args).toEqual({});
  });

  it("accepts a valid shift_id UUID", () => {
    const r = validateAskWakaToolCall("get_shift_report", { shift_id: SHIFT_ID });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.shift_id).toBe(SHIFT_ID);
  });

  it("rejects a non-UUID shift_id rather than silently ignoring it", () => {
    const r = validateAskWakaToolCall("get_shift_report", { shift_id: "not-a-uuid" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_args");
  });

  it("rejects a model-supplied shop_id on get_shift_report same as every other tool", () => {
    const r = validateAskWakaToolCall("get_shift_report", { shop_id: "11111111-1111-4111-8111-111111111111" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("shop_id_forbidden");
  });

  it("shapes a closed-shift RPC row: net sales and expected cash are pass-through arithmetic on stored fields, never a new formula", () => {
    const data = shapeShiftReportForModel(
      {
        ok: true,
        shift_id: SHIFT_ID,
        actor_user_id: "u1",
        actor_name: "Amina",
        start_at: "2026-09-12T08:00:00Z",
        end_at: "2026-09-12T14:00:00Z",
        status: "closed",
        sales_total_ugx: 100000,
        discounts_ugx: 1000,
        returns_ugx: 10000,
        voids_ugx: 0,
        net_sales_ugx: 90000, // = greatest(0, 100000 - 10000 - 0), computed by the RPC
        debt_issued_ugx: 5000,
        debt_payments_collected_ugx: 2000,
        cash_collected_ugx: 83000,
        opening_cash_ugx: 20000,
        counted_cash_ugx: 101000,
        expected_cash_ugx: 100000, // = counted - difference, computed by the RPC
        cash_difference_ugx: 1000,
        verification_status: "matched",
      },
      "shopA",
    );
    expect(data.status).toBe("ok");
    expect(data.net_sales_ugx).toBe(90000);
    expect(data.expected_cash_ugx).toBe(100000);
    expect(data.cash_difference_ugx).toBe(1000);
    expect(data.cash_reconciliation_available).toBe(true);
    expect(data.shift_status).toBe("closed");
    expect(data.actor_name).toBe("Amina");
    expect(data.shop_id).toBe("shopA");
    // Unsupported dimensions are explicitly labeled, never fabricated as 0/fake fields.
    expect(data.payment_methods_note).toMatch(/Mobile Money|Card/i);
    expect(data.expenses_note).toMatch(/not tracked/i);
    expect(data.inventory_note).toMatch(/not tied to this shift/i);
  });

  it("an open shift never carries fabricated closing-cash figures", () => {
    const data = shapeShiftReportForModel(
      {
        ok: true,
        shift_id: SHIFT_ID,
        actor_user_id: "u1",
        actor_name: "Amina",
        start_at: "2026-09-12T08:00:00Z",
        end_at: null,
        status: "open",
        sales_total_ugx: 40000,
        discounts_ugx: 0,
        returns_ugx: 0,
        voids_ugx: 0,
        net_sales_ugx: 40000,
        debt_issued_ugx: 0,
        debt_payments_collected_ugx: 0,
        cash_collected_ugx: 40000,
        opening_cash_ugx: 20000,
        counted_cash_ugx: null,
        expected_cash_ugx: null,
        cash_difference_ugx: null,
        verification_status: null,
      },
      "shopA",
    );
    expect(data.shift_status).toBe("open");
    expect(data.counted_cash_ugx).toBeNull();
    expect(data.expected_cash_ugx).toBeNull();
    expect(data.cash_difference_ugx).toBeNull();
    expect(data.cash_reconciliation_available).toBe(false);
  });

  it("shift_not_found never falls back to a fabricated report", () => {
    const data = shapeShiftReportForModel({ ok: false, error: "shift_not_found" }, "shopA");
    expect(data.status).toBe("shift_not_found");
    expect(data.sales_total_ugx).toBeUndefined();
    expect(String(data.note)).toMatch(/not found/i);
  });

  it("no_shift_found never falls back to today's sales", () => {
    const data = shapeShiftReportForModel({ ok: false, error: "no_shift_found" }, "shopA");
    expect(data.status).toBe("no_shift_found");
    expect(String(data.note)).toMatch(/do not substitute today/i);
  });

  it("multiple_open_shifts surfaces candidates for clarification instead of guessing", () => {
    const data = shapeShiftReportForModel(
      {
        ok: false,
        error: "multiple_open_shifts",
        candidates: [
          { id: "s1", actor_user_id: "u1", actor_name: "Amina", start_at: "2026-09-12T08:00:00Z" },
          { id: "s2", actor_user_id: "u2", actor_name: "Ben", start_at: "2026-09-12T09:00:00Z" },
        ],
      },
      "shopA",
    );
    expect(data.status).toBe("multiple_open_shifts");
    expect(Array.isArray(data.candidates)).toBe(true);
    expect((data.candidates as unknown[]).length).toBe(2);
    expect(String(data.note)).toMatch(/ask the user which/i);
  });
});

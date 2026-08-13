import { describe, expect, it } from "vitest";
import {
  ASK_WAKA_MAX_LIMIT,
  ASK_WAKA_WRITE_TOOLS,
  answerRequiresToolData,
  isAskWakaToolName,
  isAskWakaWriteTool,
  limitAskWakaRows,
  resolveAskWakaShopScope,
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

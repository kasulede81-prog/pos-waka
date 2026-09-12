import { describe, expect, it } from "vitest";
import {
  ASK_WAKA_MAX_LIMIT,
  ASK_WAKA_WRITE_TOOLS,
  answerRequiresToolData,
  createAskWakaToolRunner,
  isAskWakaToolName,
  isAskWakaWriteTool,
  limitAskWakaRows,
  resolveAskWakaShopScope,
  shapeCreditSalesForModel,
  shapeInventoryMovementsForModel,
  shapeNotableSalesForModel,
  shapePaymentMethodSummaryForModel,
  shapeProductsForModel,
  shapeShiftReportForModel,
  shapeShiftSalesForModel,
  stripCustomerPiiForAskWaka,
  toolCacheKey,
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

describe("Ask WAKA Phase 2 intelligence layer (ASK-INTEL-3)", () => {
  const SHIFT_ID = "33333333-3333-4333-8333-333333333333";

  it("2A: get_top_products/get_slow_products accept day='today' as well as week", () => {
    const dayCall = validateAskWakaToolCall("get_top_products", { day: "today" });
    expect(dayCall.ok).toBe(true);
    if (dayCall.ok) {
      expect(dayCall.args.scope).toBe("day");
      expect(dayCall.args.start_day).toBe(dayCall.args.end_day);
    }
    const weekCall = validateAskWakaToolCall("get_slow_products", { week: "last" });
    expect(weekCall.ok).toBe(true);
    if (weekCall.ok) expect(weekCall.args.scope).toBe("week");
    const bad = validateAskWakaToolCall("get_top_products", { day: "yesterday" });
    expect(bad.ok).toBe(false);
  });

  it("2A: shapeProductsForModel reports today's sold items with an explicit scope", () => {
    const data = shapeProductsForModel(
      {
        ok: true,
        order: "top",
        products: [
          { name: "Product A", quantity: 15, revenue_ugx: 75000 },
          { name: "Product B", quantity: 8, revenue_ugx: 64000 },
        ],
      },
      { scope: "day", start_day: "2026-09-12", end_day: "2026-09-12" },
      10,
    );
    expect(data.scope).toBe("day");
    expect((data.products as unknown[]).length).toBe(2);
    expect(data.empty_confirmed).toBe(false);
  });

  it("2B: get_payment_method_summary validates day/week and rejects a model-supplied shop_id", () => {
    const ok = validateAskWakaToolCall("get_payment_method_summary", { day: "today" });
    expect(ok.ok).toBe(true);
    const badWeek = validateAskWakaToolCall("get_payment_method_summary", { week: "next" });
    expect(badWeek.ok).toBe(false);
    const noShop = validateAskWakaToolCall("get_payment_method_summary", { shop_id: "x" });
    expect(noShop.ok).toBe(false);
    if (!noShop.ok) expect(noShop.code).toBe("shop_id_forbidden");
  });

  it("2B: shapePaymentMethodSummaryForModel never reports debt as a payment method", () => {
    const data = shapePaymentMethodSummaryForModel(
      { ok: true, methods: [{ method: "cash", amount_ugx: 12000 }, { method: "mtn_momo", amount_ugx: 7500 }], total_ugx: 19500 },
      { scope: "day", start_day: "2026-09-12", end_day: "2026-09-12" },
    );
    expect(data.total_ugx).toBe(19500);
    expect((data.methods as Record<string, unknown>[]).map((m) => m.method)).toEqual(["cash", "mtn_momo"]);
    expect(String(data.note)).toMatch(/debt.*credit sales/i);
  });

  it("2C: get_notable_sales enforces the <=20 limit and day/week scope", () => {
    const r = validateAskWakaToolCall("get_notable_sales", { day: "today", limit: 999 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.limit).toBe(20);
  });

  it("2C: shapeNotableSalesForModel never includes customer identity", () => {
    const data = shapeNotableSalesForModel(
      {
        ok: true,
        sales: [
          { sale_id: "s1", completed_at: "2026-09-12T10:00:00Z", total_ugx: 19500, item_count: 4, payment_methods: [{ method: "cash", amount_ugx: 19500 }] },
        ],
      },
      { scope: "day", start_day: "2026-09-12", end_day: "2026-09-12" },
    );
    const sale = (data.sales as Record<string, unknown>[])[0];
    expect(sale.total_ugx).toBe(19500);
    expect(Object.keys(sale)).not.toContain("customer_name");
    expect(Object.keys(sale)).not.toContain("customer_id");
  });

  it("2D: get_unsold_products validates week scope and a bounded limit", () => {
    const r = validateAskWakaToolCall("get_unsold_products", { week: "this", limit: 500 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.limit).toBe(ASK_WAKA_MAX_LIMIT);
    const bad = validateAskWakaToolCall("get_unsold_products", { week: "next" });
    expect(bad.ok).toBe(false);
  });

  it("2E: get_credit_sales validates an optional day and rejects a bad date", () => {
    const ok = validateAskWakaToolCall("get_credit_sales", {});
    expect(ok.ok).toBe(true);
    const bad = validateAskWakaToolCall("get_credit_sales", { day: "not-a-date" });
    expect(bad.ok).toBe(false);
  });

  it("2E: shapeCreditSalesForModel distinguishes debt CREATED today from outstanding balance", () => {
    const data = shapeCreditSalesForModel({
      ok: true,
      day: "2026-09-12",
      credit_sales: [{ customer_name: "John Buyer", sale_total_ugx: 8000, debt_amount_ugx: 8000, completed_at: "2026-09-12T10:00:00Z" }],
      total_debt_created_ugx: 8000,
    });
    expect(data.total_debt_created_ugx).toBe(8000);
    expect(String(data.note)).toMatch(/not the customer's total outstanding balance/i);
  });

  it("2F: get_staff_sales_summary tool contract is unchanged (still just week/limit)", () => {
    const r = validateAskWakaToolCall("get_staff_sales_summary", { week: "this", limit: 5 });
    expect(r.ok).toBe(true);
  });

  it("2G: get_sales_for_period contract is unchanged by the day/week net-earnings backport", () => {
    const r = validateAskWakaToolCall("get_sales_for_period", { period: "week", week: "this" });
    expect(r.ok).toBe(true);
  });

  it("2H: get_shift_sales accepts an optional shift_id like get_shift_report and rejects shop_id", () => {
    const ok = validateAskWakaToolCall("get_shift_sales", {});
    expect(ok.ok).toBe(true);
    const withId = validateAskWakaToolCall("get_shift_sales", { shift_id: SHIFT_ID });
    expect(withId.ok).toBe(true);
    const badId = validateAskWakaToolCall("get_shift_sales", { shift_id: "nope" });
    expect(badId.ok).toBe(false);
    const noShop = validateAskWakaToolCall("get_shift_sales", { shop_id: "x" });
    expect(noShop.ok).toBe(false);
    if (!noShop.ok) expect(noShop.code).toBe("shop_id_forbidden");
  });

  it("2H: shapeShiftSalesForModel — ok status includes item-level products and an honesty mismatch note", () => {
    const data = shapeShiftSalesForModel(
      {
        ok: true,
        shift_id: SHIFT_ID,
        start_at: "2026-09-12T08:00:00Z",
        end_at: null,
        transaction_count: 2,
        products: [{ name: "Sugar 1kg", quantity: 3, revenue_ugx: 10500 }],
        mismatched_seller_sales_count: 1,
      },
      "shopA",
    );
    expect(data.status).toBe("ok");
    expect((data.products as unknown[]).length).toBe(1);
    expect(String(data.mismatch_note)).toMatch(/different logged seller/i);
  });

  it("2H: shapeShiftSalesForModel — shift_sales_not_supported is never silently substituted", () => {
    const data = shapeShiftSalesForModel(
      { ok: true, shift_id: SHIFT_ID, status: "shift_sales_not_supported", note: "PIN-only staff, no linked Auth identity." },
      "shopA",
    );
    expect(data.status).toBe("shift_sales_not_supported");
    expect(data.products).toBeUndefined();
  });

  it("2H: shapeShiftSalesForModel — no_shift_found and multiple_open_shifts never fall back to today's sales", () => {
    const noShift = shapeShiftSalesForModel({ ok: false, error: "no_shift_found" }, "shopA");
    expect(noShift.status).toBe("no_shift_found");
    expect(String(noShift.note)).toMatch(/do not substitute today/i);

    const multi = shapeShiftSalesForModel(
      { ok: false, error: "multiple_open_shifts", candidates: [{ id: "s1" }] },
      "shopA",
    );
    expect(multi.status).toBe("multiple_open_shifts");
    expect((multi.candidates as unknown[]).length).toBe(1);
  });

  it("2I: get_inventory_movements validates day/week/reason and rejects an unknown reason", () => {
    const ok = validateAskWakaToolCall("get_inventory_movements", { day: "today", reason: "adjustment" });
    expect(ok.ok).toBe(true);
    const bad = validateAskWakaToolCall("get_inventory_movements", { reason: "theft" });
    expect(bad.ok).toBe(false);
  });

  it("2I: shapeInventoryMovementsForModel shapes movement history with a reason filter echoed back", () => {
    const data = shapeInventoryMovementsForModel(
      {
        ok: true,
        reason_filter: "adjustment",
        movements: [{ name: "Sugar 1kg", quantity_delta: -2, reason: "adjustment", occurred_at: "2026-09-12T09:00:00Z" }],
      },
      { scope: "day", start_day: "2026-09-12", end_day: "2026-09-12" },
    );
    expect(data.reason_filter).toBe("adjustment");
    expect((data.movements as unknown[]).length).toBe(1);
    expect(data.empty_confirmed).toBe(false);
  });

  it("SECURITY: every new tool rejects a model-supplied shop_id, same as existing tools", () => {
    for (const tool of [
      "get_payment_method_summary",
      "get_notable_sales",
      "get_unsold_products",
      "get_credit_sales",
      "get_shift_sales",
      "get_inventory_movements",
    ] as const) {
      const r = validateAskWakaToolCall(tool, { shop_id: "11111111-1111-4111-8111-111111111111" });
      expect(r.ok, tool).toBe(false);
      if (!r.ok) expect(r.code).toBe("shop_id_forbidden");
    }
  });
});

type FakeToolResult = { ok: true; tool: string; data: Record<string, unknown> } | { ok: false; tool: string; code: string; reason: string };

function budgetExhausted(toolName: string): FakeToolResult {
  return { ok: false, tool: toolName, code: "tool_budget_exhausted", reason: "Tool call budget exceeded for this request" };
}

describe("ASK-4A tool-call runner (dedup + total budget)", () => {
  it("toolCacheKey is stable regardless of argument key order", () => {
    expect(toolCacheKey("get_today_sales", { day: "today", week: null })).toBe(
      toolCacheKey("get_today_sales", { week: null, day: "today" }),
    );
    expect(toolCacheKey("get_today_sales", { day: "today" })).not.toBe(
      toolCacheKey("get_today_sales", { day: "yesterday" }),
    );
    expect(toolCacheKey("get_today_sales", {})).not.toBe(toolCacheKey("get_top_products", {}));
  });

  it("17 — an identical (tool + arguments) call executes only once; the second call reuses the cached result", async () => {
    let executions = 0;
    const runner = createAskWakaToolRunner<FakeToolResult>({
      execute: async (toolName, rawArgs) => {
        executions += 1;
        return { ok: true, tool: toolName, data: { call: executions, args: rawArgs as Record<string, unknown> } };
      },
      budgetExhaustedResult: budgetExhausted,
    });

    const first = await runner.run("get_today_sales", { day: "today" });
    const second = await runner.run("get_today_sales", { day: "today" });

    expect(executions).toBe(1);
    expect(second).toEqual(first);
    expect(runner.totalCalls).toBe(1);

    // A genuinely different call still executes.
    const third = await runner.run("get_today_sales", { day: "yesterday" });
    expect(executions).toBe(2);
    expect(third).not.toEqual(first);
  });

  it("18 — no more than the configured total tool calls ever execute in one request", async () => {
    let executions = 0;
    const runner = createAskWakaToolRunner<FakeToolResult>({
      execute: async (toolName) => {
        executions += 1;
        return { ok: true, tool: toolName, data: { n: executions } };
      },
      maxTotalCalls: 6,
      budgetExhaustedResult: budgetExhausted,
    });

    // Ask for 10 distinct tool calls — well past the budget.
    const results: FakeToolResult[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(await runner.run("get_today_sales", { call: i }));
    }

    expect(executions).toBe(6);
    expect(runner.totalCalls).toBe(6);
    expect(runner.isBudgetExhausted()).toBe(true);
    const succeeded = results.filter((r) => r.ok);
    const exhausted = results.filter((r) => !r.ok && (r as { code: string }).code === "tool_budget_exhausted");
    expect(succeeded).toHaveLength(6);
    expect(exhausted).toHaveLength(4);
    // Never fabricates data for the calls it refused to run.
    for (const r of exhausted) {
      expect((r as { ok: false }).ok).toBe(false);
    }
  });

  it("a repeated call after the budget is exhausted still hits the cache, not the budget check, if seen before", async () => {
    let executions = 0;
    const runner = createAskWakaToolRunner<FakeToolResult>({
      execute: async (toolName) => {
        executions += 1;
        return { ok: true, tool: toolName, data: { n: executions } };
      },
      maxTotalCalls: 2,
      budgetExhaustedResult: budgetExhausted,
    });

    const a = await runner.run("get_today_sales", {});
    await runner.run("get_top_products", {});
    // Budget now exhausted for any NEW call...
    const blocked = await runner.run("get_slow_products", {});
    expect(blocked.ok).toBe(false);
    // ...but re-asking for the FIRST call reuses its cached result, no new execution.
    const aAgain = await runner.run("get_today_sales", {});
    expect(aAgain).toEqual(a);
    expect(executions).toBe(2);
  });
});

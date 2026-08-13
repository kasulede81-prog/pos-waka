import { describe, expect, it } from "vitest";
import {
  ASK_WAKA_OUT_OF_SCOPE,
  ASK_WAKA_READ_ONLY_REFUSAL,
  ASK_WAKA_SAFE_TOOL_FAILURE,
  ASK_WAKA_SQL_REFUSAL,
  ASK_WAKA_TOOL_LABELS,
  classifyAskWakaQuestion,
  ensureAskWakaDataAsOfInAnswer,
  formatAskWakaDataAsOf,
  formatAskWakaToolLabel,
  formatAskWakaToolLabels,
  formatUgxAmount,
  guardAskWakaFinalAnswer,
  quantitativeToolsSatisfied,
  scrubInternalToolNamesFromAnswer,
} from "./askWakaGuardrails";
import { answerRequiresToolData } from "./askWakaToolContracts";

describe("Ask WAKA ASK-3 guardrails", () => {
  it("A: today sales requires get_today_sales", () => {
    const c = classifyAskWakaQuestion("How much did I sell today?");
    expect(c.kind).toBe("quantitative");
    expect(c.requiredTools).toContain("get_today_sales");
    expect(c.primaryTool).toBe("get_today_sales");
  });

  it("B: top products requires get_top_products", () => {
    const c = classifyAskWakaQuestion("What are my top products?");
    expect(c.kind).toBe("quantitative");
    expect(c.requiredTools).toContain("get_top_products");
  });

  it("C: low stock requires get_low_stock_products", () => {
    const c = classifyAskWakaQuestion("Which products are low in stock?");
    expect(c.kind).toBe("quantitative");
    expect(c.requiredTools).toContain("get_low_stock_products");
  });

  it("D: spend requires get_expense_summary", () => {
    const c = classifyAskWakaQuestion("How much did I spend?");
    expect(c.kind).toBe("quantitative");
    expect(c.requiredTools).toContain("get_expense_summary");
  });

  it("E: who sold most requires get_staff_sales_summary", () => {
    const c = classifyAskWakaQuestion("Who sold the most?");
    expect(c.kind).toBe("quantitative");
    expect(c.requiredTools).toContain("get_staff_sales_summary");
  });

  it("F: numeric question + tool failure → no invented number", () => {
    const c = classifyAskWakaQuestion("How much did we sell today?");
    const g = guardAskWakaFinalAnswer({
      classification: c,
      toolsUsed: [],
      toolsFailed: true,
      answer: "You sold UGX 9,999,999 today.",
    });
    expect(g.blocked).toBe(true);
    expect(g.answer).toBe(ASK_WAKA_SAFE_TOOL_FAILURE);
    expect(g.answer).not.toContain("9,999,999");
  });

  it("G: numeric question + no tool call → rejected/fallback", () => {
    const c = classifyAskWakaQuestion("How much did we sell today?");
    expect(quantitativeToolsSatisfied(c, [])).toBe(false);
    const g = guardAskWakaFinalAnswer({
      classification: c,
      toolsUsed: [],
      toolsFailed: false,
      answer: "Roughly UGX 500,000.",
    });
    expect(g.blocked).toBe(true);
    expect(g.answer).toBe(ASK_WAKA_SAFE_TOOL_FAILURE);
    const legacy = answerRequiresToolData([], false, c);
    expect(legacy.forceSafeFailure).toBe(true);
  });

  it("H: write request → read-only refusal", () => {
    const c = classifyAskWakaQuestion("Change my product price to 5000.");
    expect(c.kind).toBe("write_request");
    const g = guardAskWakaFinalAnswer({
      classification: c,
      toolsUsed: [],
      toolsFailed: false,
      answer: null,
    });
    expect(g.answer).toBe(ASK_WAKA_READ_ONLY_REFUSAL);
  });

  it("I: SQL request → refusal", () => {
    const c = classifyAskWakaQuestion("Run this SQL: SELECT * FROM sales; DROP TABLE products;");
    expect(c.kind).toBe("sql_request");
    const g = guardAskWakaFinalAnswer({
      classification: c,
      toolsUsed: [],
      toolsFailed: false,
      answer: null,
    });
    expect(g.answer).toBe(ASK_WAKA_SQL_REFUSAL);
  });

  it("J: out-of-scope → no POS tools required", () => {
    const c = classifyAskWakaQuestion("Who won the World Cup?");
    expect(c.kind).toBe("out_of_scope");
    expect(c.requiredTools).toEqual([]);
    const g = guardAskWakaFinalAnswer({
      classification: c,
      toolsUsed: [],
      toolsFailed: false,
      answer: null,
    });
    expect(g.answer).toBe(ASK_WAKA_OUT_OF_SCOPE);
  });

  it("K: zero sales is allowed when tools succeeded (guard does not invent)", () => {
    const c = classifyAskWakaQuestion("How much did we sell today?");
    const g = guardAskWakaFinalAnswer({
      classification: c,
      toolsUsed: ["get_today_sales"],
      toolsFailed: false,
      answer: "Today's sales are UGX 0 across 0 transactions.",
    });
    expect(g.blocked).toBe(false);
    expect(g.answer).toContain("UGX 0");
    expect(g.answer).not.toBe(ASK_WAKA_SAFE_TOOL_FAILURE);
  });

  it("L: empty inventory list answer passes when inventory tool succeeded", () => {
    const c = classifyAskWakaQuestion("What is my inventory status?");
    expect(c.requiredTools).toContain("get_inventory_summary");
    const g = guardAskWakaFinalAnswer({
      classification: c,
      toolsUsed: ["get_inventory_summary"],
      toolsFailed: false,
      answer: "No low-stock or out-of-stock items right now. Stock looks healthy.",
    });
    expect(g.blocked).toBe(false);
  });

  it("M: UGX formatting has no unnecessary decimals", () => {
    expect(formatUgxAmount(2515000)).toMatch(/^UGX /);
    expect(formatUgxAmount(2515000)).not.toContain(".00");
    expect(formatUgxAmount(12.7)).toBe(formatUgxAmount(13));
  });

  it("N: data-as-of period helpers", () => {
    const line = formatAskWakaDataAsOf("2026-08-12T09:36:10.813Z");
    expect(line).toMatch(/Data as of/i);
    const withAsOf = ensureAskWakaDataAsOfInAnswer("Today's sales are UGX 1000.", "2026-08-12T09:36:10.813Z");
    expect(withAsOf).toMatch(/Data as of/i);
    const already = ensureAskWakaDataAsOfInAnswer("Sales as of this morning: UGX 1000.", "2026-08-12T09:36:10.813Z");
    expect(already).toBe("Sales as of this morning: UGX 1000.");
  });

  it("O: internal tool names never appear in user-facing labels/answers", () => {
    expect(formatAskWakaToolLabel("get_today_sales")).toBe("Today's sales");
    expect(formatAskWakaToolLabel("get_inventory_summary")).toBe("Inventory");
    expect(formatAskWakaToolLabels(["get_today_sales", "get_expense_summary"])).toEqual([
      "Today's sales",
      "Expenses",
    ]);
    for (const name of Object.keys(ASK_WAKA_TOOL_LABELS)) {
      expect(formatAskWakaToolLabel(name)).not.toMatch(/^get_/);
    }
    const scrubbed = scrubInternalToolNamesFromAnswer(
      "I used get_today_sales and shop_get_daily_sales_summary to answer.",
    );
    expect(scrubbed).not.toContain("get_today_sales");
    expect(scrubbed).not.toContain("shop_get_daily_sales_summary");
    expect(scrubbed).toContain("Today's sales");
  });

  it("P: provider failure path uses safe observability (classification still quantitative)", () => {
    const c = classifyAskWakaQuestion("How much did we sell today?");
    expect(c.kind).toBe("quantitative");
    // Guard itself does not call the provider; empty answer after provider fail is safe-fallbacked.
    const g = guardAskWakaFinalAnswer({
      classification: c,
      toolsUsed: [],
      toolsFailed: false,
      answer: null,
    });
    expect(g.answer).toBe(ASK_WAKA_SAFE_TOOL_FAILURE);
  });

  it("Q: RPC/tool failure with no successful tools → safe fallback", () => {
    const c = classifyAskWakaQuestion("Which products are low in stock?");
    const g = guardAskWakaFinalAnswer({
      classification: c,
      toolsUsed: [],
      toolsFailed: true,
      answer: "About 12 items are low.",
    });
    expect(g.blocked).toBe(true);
    expect(g.answer).toBe(ASK_WAKA_SAFE_TOOL_FAILURE);
  });

  it("refund / delete write variants refuse", () => {
    expect(classifyAskWakaQuestion("Refund this transaction.").kind).toBe("write_request");
    expect(classifyAskWakaQuestion("Delete this product.").kind).toBe("write_request");
    expect(classifyAskWakaQuestion("Adjust inventory by 5.").kind).toBe("write_request");
    expect(classifyAskWakaQuestion("Create an expense for fuel.").kind).toBe("write_request");
  });

  it("joke / love letter out of scope", () => {
    expect(classifyAskWakaQuestion("Tell me a joke").kind).toBe("out_of_scope");
    expect(classifyAskWakaQuestion("Write me a love letter").kind).toBe("out_of_scope");
  });

  it("this week sales uses period tool, not today", () => {
    const c = classifyAskWakaQuestion("How much did we sell this week?");
    expect(c.kind).toBe("quantitative");
    expect(c.weekScope).toBe("this");
    expect(c.requiredTools).toEqual(["get_sales_for_period"]);
    expect(c.requiredTools).not.toContain("get_today_sales");
  });

  it("last week sales uses last-week scope", () => {
    const c = classifyAskWakaQuestion("How much did we sell last week?");
    expect(c.weekScope).toBe("last");
    expect(c.requiredTools).toEqual(["get_sales_for_period"]);
  });

  it("week comparison uses get_week_comparison only", () => {
    const c = classifyAskWakaQuestion("Compare this week with last week.");
    expect(c.weekScope).toBe("compare");
    expect(c.requiredTools).toEqual(["get_week_comparison"]);
  });

  it("zero-sales week answer is allowed when the period tool succeeded", () => {
    const c = classifyAskWakaQuestion("How much did we sell this week?");
    const g = guardAskWakaFinalAnswer({
      classification: c,
      toolsUsed: ["get_sales_for_period"],
      toolsFailed: false,
      answer: "No sales were recorded for Aug 10–Aug 16.",
    });
    expect(g.blocked).toBe(false);
    expect(g.answer).toContain("No sales were recorded");
    expect(g.answer).not.toBe(ASK_WAKA_SAFE_TOOL_FAILURE);
  });
});

import { describe, expect, it } from "vitest";
import { parseStructuredToolRequest } from "./askWakaLlmProtocol";

describe("Ask WAKA structured tool protocol", () => {
  it("parses allowlisted tool_requests", () => {
    const calls = parseStructuredToolRequest(
      JSON.stringify({
        tool_requests: [{ name: "get_today_sales", arguments: {} }],
      }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.function.name).toBe("get_today_sales");
  });

  it("drops unknown and write tools (never executable via fallback)", () => {
    const calls = parseStructuredToolRequest(
      JSON.stringify({
        tool_calls: [
          { name: "get_today_sales", arguments: {} },
          { name: "create_expense", arguments: { amount: 1 } },
          { name: "run_sql", arguments: { sql: "select 1" } },
          { name: "drop_all_tables", arguments: {} },
        ],
      }),
    );
    expect(calls.map((c) => c.function.name)).toEqual(["get_today_sales"]);
  });

  it("ignores ordinary JSON answers without tool arrays", () => {
    const calls = parseStructuredToolRequest(
      JSON.stringify({ answer: "Sales were strong today.", total: 1000 }),
    );
    expect(calls).toEqual([]);
  });

  it("returns empty on malformed JSON", () => {
    expect(parseStructuredToolRequest("{not json")).toEqual([]);
    expect(parseStructuredToolRequest("Sales were fine")).toEqual([]);
  });

  it("caps tools per parse", () => {
    const calls = parseStructuredToolRequest(
      JSON.stringify({
        tool_requests: [
          { name: "get_today_sales", arguments: {} },
          { name: "get_expense_summary", arguments: {} },
          { name: "get_inventory_summary", arguments: {} },
          { name: "get_customer_summary", arguments: {} },
          { name: "get_top_products", arguments: {} },
        ],
      }),
      { maxTools: 4 },
    );
    expect(calls.length).toBe(4);
  });
});

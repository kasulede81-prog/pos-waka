import { describe, expect, it } from "vitest";
import { parseStructuredToolRequest } from "./askWakaLlmProtocol";
import { ASK_WAKA_MAX_TOOL_ROUNDS } from "./askWakaToolContracts";
import {
  assertOllamaBaseUrl,
  decideEmptyContentAction,
  mapOllamaErrorToSafeCode,
  nextSequentialTool,
  normalizeOllamaProviderOutput,
  normalizeOllamaToolCalls,
  OLLAMA_FINAL_ANSWER_INSTRUCTION,
  resolveOllamaAssistantText,
  resolveOllamaPublicContent,
  shouldTerminateToolLoop,
} from "./ollamaProtocol";

describe("ASK-4.1 Ollama/Qwen hardening", () => {
  // A. Qwen native tool call → normalized tool call
  it("A: normalizes native Qwen tool call", () => {
    const calls = normalizeOllamaToolCalls([
      { id: "tc1", function: { name: "get_today_sales", arguments: {} } },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      id: "tc1",
      type: "function",
      function: { name: "get_today_sales", arguments: "{}" },
    });
  });

  // B. Tool call + empty content → continue safely
  it("B: empty content with tool call continues tool loop (no thinking)", () => {
    const out = normalizeOllamaProviderOutput({
      content: "",
      thinking: "I should call get_today_sales because...",
      tool_calls: [{ id: "1", function: { name: "get_today_sales", arguments: {} } }],
    });
    expect(out.toolCalls.map((c) => c.function.name)).toEqual(["get_today_sales"]);
    expect(out.content).toBeNull();
    expect(out.discardedThinking).toBe(true);

    const decision = decideEmptyContentAction({
      message: {
        content: "",
        thinking: "secret reasoning",
        tool_calls: [{ function: { name: "get_today_sales", arguments: {} } }],
      },
      hasToolResultsInConversation: false,
      alreadyRetriedFinalAnswer: false,
    });
    expect(decision.action).toBe("continue_tools");
  });

  // C. Final content → returned normally
  it("C: final content returned normally", () => {
    const out = normalizeOllamaProviderOutput({
      content: "Today you sold UGX 2,515,000.",
      thinking: "internal math",
    });
    expect(out.content).toBe("Today you sold UGX 2,515,000.");
    expect(out.toolCalls).toEqual([]);
  });

  it("C2: JSON answer wrapper unwraps to public content", () => {
    expect(
      resolveOllamaPublicContent({
        content: '{"answer":"Today you sold UGX 2,515,000."}',
        thinking: "secret",
      }),
    ).toBe("Today you sold UGX 2,515,000.");
  });

  // D. Empty content + thinking → thinking NEVER reaches user
  it("D: empty content + thinking never exposes thinking", () => {
    expect(
      resolveOllamaPublicContent({
        content: "",
        thinking: "The shop sold 100 units which means...",
      }),
    ).toBeNull();
    expect(
      resolveOllamaAssistantText(
        { content: "", thinking: "chain of thought that must not leak", reasoning: "also secret" },
        false,
      ),
    ).toBeNull();

    const out = normalizeOllamaProviderOutput({
      content: "",
      thinking: "MUST_NOT_LEAK_THINKING_TOKEN_xyz",
    });
    expect(out.content).toBeNull();
    expect(JSON.stringify(out)).not.toContain("MUST_NOT_LEAK");
    expect(out.discardedThinking).toBe(true);
  });

  // E. Empty content + no tool → safe fallback
  it("E: empty content + no tool → safe fallback", () => {
    const decision = decideEmptyContentAction({
      message: { content: "", thinking: "I am unsure" },
      hasToolResultsInConversation: false,
      alreadyRetriedFinalAnswer: false,
    });
    expect(decision).toEqual({ action: "safe_fallback" });
  });

  // F. Tool result → final answer → only final content
  it("F: after tool results, empty content schedules final-answer retry then fallback", () => {
    const retry = decideEmptyContentAction({
      message: { content: "", thinking: "analysis of tool JSON..." },
      hasToolResultsInConversation: true,
      alreadyRetriedFinalAnswer: false,
    });
    expect(retry).toEqual({ action: "final_answer_retry" });
    expect(OLLAMA_FINAL_ANSWER_INSTRUCTION).toMatch(/final answer/i);
    expect(OLLAMA_FINAL_ANSWER_INSTRUCTION).not.toMatch(/thinking/i);

    const afterRetry = decideEmptyContentAction({
      message: { content: "", thinking: "still thinking" },
      hasToolResultsInConversation: true,
      alreadyRetriedFinalAnswer: true,
    });
    expect(afterRetry).toEqual({ action: "safe_fallback" });
  });

  // G. Multiple required tools → sequential execution
  it("G: sequential multi-tool picks one required tool at a time", () => {
    const required = ["get_today_sales", "get_top_products", "get_expense_summary"];
    const used: string[] = [];
    const first = nextSequentialTool(required, used);
    expect(first).toBe("get_today_sales");
    used.push(first!);
    const second = nextSequentialTool(required, used);
    expect(second).toBe("get_top_products");
    used.push(second!);
    const third = nextSequentialTool(required, used);
    expect(third).toBe("get_expense_summary");
    used.push(third!);
    expect(nextSequentialTool(required, used)).toBeNull();
  });

  // H. Simultaneous multi-tool → normalized safely (cap 1 by default)
  it("H: simultaneous multi-tool response capped to one tool", () => {
    const calls = normalizeOllamaToolCalls(
      [
        { id: "a", function: { name: "get_today_sales", arguments: {} } },
        { id: "b", function: { name: "get_top_products", arguments: { limit: 5 } } },
        { id: "c", function: { name: "get_expense_summary", arguments: {} } },
      ],
      1,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe("get_today_sales");

    const wider = normalizeOllamaToolCalls(
      [
        { function: { name: "get_today_sales", arguments: {} } },
        { function: { name: "get_top_products", arguments: {} } },
      ],
      2,
    );
    expect(wider.map((c) => c.function.name)).toEqual(["get_today_sales", "get_top_products"]);
  });

  // I. Unknown tool → rejected
  it("I: unknown tool rejected", () => {
    const calls = normalizeOllamaToolCalls([
      { function: { name: "hack_database", arguments: { q: "select 1" } } },
      { function: { name: "run_sql", arguments: {} } },
    ]);
    expect(calls).toEqual([]);
  });

  // J. Write tool → rejected
  it("J: write tools rejected", () => {
    const calls = normalizeOllamaToolCalls([
      { function: { name: "delete_sale", arguments: "{}" } },
      { function: { name: "refund_sale", arguments: {} } },
      { function: { name: "adjust_inventory", arguments: {} } },
      { function: { name: "create_expense", arguments: {} } },
      { function: { name: "get_inventory_summary", arguments: {} } },
    ]);
    expect(calls.map((c) => c.function.name)).toEqual(["get_inventory_summary"]);
  });

  // K. Infinite tool loop → terminated
  it("K: infinite tool loop terminated by max rounds", () => {
    expect(ASK_WAKA_MAX_TOOL_ROUNDS).toBeGreaterThan(0);
    expect(shouldTerminateToolLoop(0, ASK_WAKA_MAX_TOOL_ROUNDS)).toBe(false);
    expect(shouldTerminateToolLoop(ASK_WAKA_MAX_TOOL_ROUNDS - 1, ASK_WAKA_MAX_TOOL_ROUNDS)).toBe(
      false,
    );
    expect(shouldTerminateToolLoop(ASK_WAKA_MAX_TOOL_ROUNDS, ASK_WAKA_MAX_TOOL_ROUNDS)).toBe(true);
    expect(shouldTerminateToolLoop(99, ASK_WAKA_MAX_TOOL_ROUNDS)).toBe(true);
  });

  // L. Provider timeout → safe error
  it("L: provider timeout maps to safe error code", () => {
    expect(mapOllamaErrorToSafeCode(new Error("ollama_timeout"))).toBe("ollama_timeout");
    expect(mapOllamaErrorToSafeCode(new Error("The operation was aborted"))).toBe("ollama_timeout");
  });

  // M. Malformed Ollama response → safe error
  it("M: malformed Ollama response maps to safe error", () => {
    expect(mapOllamaErrorToSafeCode(new Error("ollama_malformed_response"))).toBe(
      "ollama_malformed_response",
    );
    expect(mapOllamaErrorToSafeCode(new Error("unexpected"))).toBe("ollama_provider_failed");
  });

  it("validates base URL / localhost gate", () => {
    expect(assertOllamaBaseUrl("https://ollama.example.com", false)).toBe("https://ollama.example.com");
    expect(() => assertOllamaBaseUrl("http://127.0.0.1:11434", false)).toThrow(
      /ollama_localhost_not_reachable_from_edge/,
    );
    expect(assertOllamaBaseUrl("http://127.0.0.1:11434", true)).toBe("http://127.0.0.1:11434");
  });

  it("structured JSON fallback remains allowlist-only", () => {
    const out = normalizeOllamaProviderOutput({
      content: JSON.stringify({
        tool_requests: [
          { name: "drop_table", arguments: {} },
          { name: "get_top_products", arguments: { limit: 5 } },
        ],
      }),
    });
    expect(out.toolCalls.map((c) => c.function.name)).toEqual(["get_top_products"]);
    expect(out.content).toBeNull();

    const viaShared = parseStructuredToolRequest(
      '{"tool_requests":[{"name":"get_today_sales","arguments":{}}]}',
    );
    expect(viaShared[0]?.function.name).toBe("get_today_sales");
  });
});

/**
 * Structured tool-request fallback parser (testable mirror of edge llmProvider).
 * NEVER executes tools — only parses names/args for later allowlist validation.
 */

import { ASK_WAKA_MAX_TOOLS_PER_ROUND, isAskWakaToolName } from "./askWakaToolContracts";

export type ParsedAskWakaToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/**
 * Parse a strict JSON tool-request envelope from model content.
 * Unknown / non-allowlisted tool names are dropped (never executed).
 */
export function parseStructuredToolRequest(
  content: string,
  opts?: { allowOnlyAllowlisted?: boolean; maxTools?: number },
): ParsedAskWakaToolCall[] {
  const allowOnlyAllowlisted = opts?.allowOnlyAllowlisted !== false;
  const maxTools = Math.max(1, Math.min(ASK_WAKA_MAX_TOOLS_PER_ROUND, opts?.maxTools ?? ASK_WAKA_MAX_TOOLS_PER_ROUND));

  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const obj = parsed as Record<string, unknown>;

  // Do not treat ordinary JSON answers as tool requests.
  if (typeof obj.answer === "string" && !obj.tool_requests && !obj.tool_calls) {
    return [];
  }

  const list = Array.isArray(obj.tool_requests)
    ? obj.tool_requests
    : Array.isArray(obj.tool_calls)
      ? obj.tool_calls
      : null;
  if (!list) return [];

  const out: ParsedAskWakaToolCall[] = [];
  for (const item of list) {
    if (out.length >= maxTools) break;
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = String(row.name ?? (row.function as { name?: string } | undefined)?.name ?? "").trim();
    if (!name) continue;
    if (allowOnlyAllowlisted && !isAskWakaToolName(name)) continue;
    const args = row.arguments ?? row.args ?? {};
    out.push({
      id: String(row.id ?? `structured_${out.length + 1}`),
      type: "function",
      function: {
        name,
        arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
      },
    });
  }
  return out;
}

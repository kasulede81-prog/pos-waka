/**
 * Testable Ollama/Qwen protocol helpers (mirror of edge ollamaClient normalization).
 * ASK-4.1: never expose thinking/reasoning as user-facing content.
 * Does not call the network.
 */

import { ASK_WAKA_MAX_TOOLS_PER_ROUND, isAskWakaToolName } from "./askWakaToolContracts";

export const OLLAMA_FINAL_ANSWER_INSTRUCTION =
  "Return only the concise final answer for the user. Do not provide reasoning or analysis. Do not mention tools or internal names.";

export const OLLAMA_INCOMPLETE_CONTENT_ERROR = "ollama_incomplete_content";

export const OLLAMA_ANSWER_JSON_FORMAT = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
} as const;

export type NormalizedOllamaToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OllamaMessageLike = {
  content?: string | null;
  thinking?: string | null;
  reasoning?: string | null;
  tool_calls?: unknown;
};

/** Cap defaults to 1 for sequential Qwen behavior (ASK-4.1). */
export function normalizeOllamaToolCalls(
  raw: unknown,
  maxTools = 1,
): NormalizedOllamaToolCall[] {
  const limit = Math.max(1, Math.min(ASK_WAKA_MAX_TOOLS_PER_ROUND, Math.floor(maxTools)));
  if (!Array.isArray(raw)) return [];
  const out: NormalizedOllamaToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      id?: string;
      function?: { name?: string; arguments?: unknown };
    };
    const name = String(row.function?.name ?? "").trim();
    if (!name || !isAskWakaToolName(name)) continue;
    const args = row.function?.arguments;
    const argStr =
      typeof args === "string"
        ? args
        : JSON.stringify(args && typeof args === "object" ? args : {});
    out.push({
      id: String(row.id ?? `ollama_${out.length + 1}`),
      type: "function",
      function: { name, arguments: argStr || "{}" },
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * If content is `{"answer":"..."}` (final-answer JSON mode), return the answer string.
 * NEVER returns thinking/reasoning.
 */
export function extractOllamaAnswerContent(rawContent: string | null | undefined): string | null {
  const content = typeof rawContent === "string" ? rawContent.trim() : "";
  if (!content) return null;
  if (content.startsWith("{")) {
    try {
      const parsed = JSON.parse(content) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const answer = (parsed as { answer?: unknown }).answer;
        if (typeof answer === "string" && answer.trim()) return answer.trim();
      }
    } catch {
      /* fall through */
    }
  }
  return content;
}

/**
 * Public assistant text = message.content only (unwrap {"answer":...} when present).
 * NEVER returns thinking/reasoning.
 */
export function resolveOllamaPublicContent(message: OllamaMessageLike): string | null {
  return extractOllamaAnswerContent(message.content);
}

/**
 * @deprecated Use resolveOllamaPublicContent. Kept for call-site clarity in tests:
 * thinking must never become user-facing text.
 */
export function resolveOllamaAssistantText(
  message: OllamaMessageLike,
  _hasToolCalls: boolean,
): string | null {
  return resolveOllamaPublicContent(message);
}

export type NormalizedOllamaResult = {
  content: string | null;
  toolCalls: NormalizedOllamaToolCall[];
  /** True when thinking existed but was intentionally discarded. */
  discardedThinking: boolean;
};

/**
 * Normalize an Ollama message into provider-facing output only:
 * toolCalls and/or final content. Never includes thinking.
 */
export function normalizeOllamaProviderOutput(
  message: OllamaMessageLike,
  opts?: { maxToolsPerResponse?: number; toolsEnabled?: boolean },
): NormalizedOllamaResult {
  const maxTools = opts?.maxToolsPerResponse ?? 1;
  const toolsEnabled = opts?.toolsEnabled !== false;
  const thinking =
    (typeof message.thinking === "string" && message.thinking.trim()) ||
    (typeof message.reasoning === "string" && message.reasoning.trim()) ||
    "";
  const discardedThinking = Boolean(thinking);
  const toolCalls = toolsEnabled
    ? normalizeOllamaToolCalls(message.tool_calls, maxTools)
    : [];
  const content = resolveOllamaPublicContent(message);

  if (toolCalls.length > 0) {
    return { content, toolCalls, discardedThinking };
  }

  if (toolsEnabled && content) {
    const structured = parseAllowlistedStructuredToolRequest(content, maxTools);
    if (structured.length > 0) {
      return { content: null, toolCalls: structured, discardedThinking };
    }
  }

  return { content, toolCalls: [], discardedThinking };
}

/** Decide next step when content is empty (ASK-4.1). */
export type EmptyContentAction =
  | { action: "continue_tools"; toolCalls: NormalizedOllamaToolCall[] }
  | { action: "final_answer_retry" }
  | { action: "safe_fallback" };

export function decideEmptyContentAction(params: {
  message: OllamaMessageLike;
  hasToolResultsInConversation: boolean;
  alreadyRetriedFinalAnswer: boolean;
  maxToolsPerResponse?: number;
}): EmptyContentAction {
  const normalized = normalizeOllamaProviderOutput(params.message, {
    maxToolsPerResponse: params.maxToolsPerResponse ?? 1,
    toolsEnabled: true,
  });
  if (normalized.toolCalls.length > 0) {
    return { action: "continue_tools", toolCalls: normalized.toolCalls };
  }
  if (normalized.content) {
    // Should not be called with non-empty content; treat as success path elsewhere.
    return { action: "safe_fallback" };
  }
  if (params.hasToolResultsInConversation && !params.alreadyRetriedFinalAnswer) {
    return { action: "final_answer_retry" };
  }
  return { action: "safe_fallback" };
}

/** Simulate sequential multi-tool: take first required tool each round. */
export function nextSequentialTool(
  requiredTools: string[],
  alreadyUsed: string[],
): string | null {
  for (const name of requiredTools) {
    if (!isAskWakaToolName(name)) continue;
    if (alreadyUsed.includes(name)) continue;
    return name;
  }
  return null;
}

/** Terminate tool loop when rounds exhausted (infinite-loop guard). */
export function shouldTerminateToolLoop(round: number, maxRounds: number): boolean {
  return round >= maxRounds;
}

export function mapOllamaErrorToSafeCode(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/timeout|abort/i.test(msg)) return "ollama_timeout";
  if (/malformed/i.test(msg)) return "ollama_malformed_response";
  if (/unavailable|fetch/i.test(msg)) return "ollama_unavailable";
  return "ollama_provider_failed";
}

export function assertOllamaBaseUrl(raw: string, allowLocalhost: boolean): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("ollama_base_url_required");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("ollama_invalid_base_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("ollama_invalid_base_url_protocol");
  }
  const host = url.hostname.toLowerCase();
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
  if (isLocal && !allowLocalhost) {
    throw new Error("ollama_localhost_not_reachable_from_edge");
  }
  return trimmed;
}

function parseAllowlistedStructuredToolRequest(
  content: string,
  maxTools: number,
): NormalizedOllamaToolCall[] {
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
  if (typeof obj.answer === "string" && !obj.tool_requests && !obj.tool_calls) return [];
  const list = Array.isArray(obj.tool_requests)
    ? obj.tool_requests
    : Array.isArray(obj.tool_calls)
      ? obj.tool_calls
      : null;
  if (!list) return [];
  const out: NormalizedOllamaToolCall[] = [];
  const limit = Math.max(1, Math.min(ASK_WAKA_MAX_TOOLS_PER_ROUND, maxTools));
  for (const item of list) {
    if (out.length >= limit) break;
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = String(
      row.name ?? (row.function as { name?: string } | undefined)?.name ?? "",
    ).trim();
    if (!name || !isAskWakaToolName(name)) continue;
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

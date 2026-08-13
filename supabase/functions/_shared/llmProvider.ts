/**
 * Minimal LLM chat provider abstraction for Ask WAKA.
 * DeepSeek (default) + Ollama/Qwen adapter. Tool layer does not depend on a specific provider.
 */

import { ASK_WAKA_MAX_TOOLS_PER_ROUND, isAskWakaToolName, type AskWakaToolDef } from "./askWakaTools.ts";
import { createOllamaChatProvider } from "./ollamaClient.ts";

export type LlmProviderName = "deepseek" | "ollama" | "openai" | "gemini" | "claude";

export type LlmChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string | null; tool_calls?: LlmToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type LlmToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type LlmChatRequest = {
  model: string;
  messages: LlmChatMessage[];
  tools?: AskWakaToolDef[];
  temperature?: number;
  maxTokens?: number;
};

export type LlmChatResult = {
  content: string | null;
  toolCalls: LlmToolCall[];
  tokensIn: number;
  tokensOut: number;
  provider: LlmProviderName;
  /** true when provider returned native tool_calls; false when structured JSON fallback used */
  usedNativeTools: boolean;
};

export interface LlmChatProvider {
  readonly name: LlmProviderName;
  chat(req: LlmChatRequest): Promise<LlmChatResult>;
}

type DeepSeekMessage = {
  role: string;
  content?: string | null;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

/**
 * DeepSeek OpenAI-compatible chat provider with tools.
 * Docs advertise function calling; this implementation validates tool names server-side
 * after the model responds.
 */
export class DeepSeekChatProvider implements LlmChatProvider {
  readonly name: LlmProviderName = "deepseek";

  constructor(private readonly apiKey: string) {}

  async chat(req: LlmChatRequest): Promise<LlmChatResult> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxTokens ?? 1200,
    };
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
      body.tool_choice = "auto";
    }

    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`deepseek_http_${res.status}:${errText.slice(0, 200)}`);
    }

    const payload = await res.json() as {
      choices?: { message?: DeepSeekMessage }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const message = payload.choices?.[0]?.message ?? {};
    const toolsEnabled = Boolean(req.tools && req.tools.length > 0);
    const nativeCalls = filterAllowlistedToolCalls(normalizeToolCalls(message.tool_calls));
    if (toolsEnabled && nativeCalls.length > 0) {
      return {
        content: message.content ?? null,
        toolCalls: nativeCalls.slice(0, ASK_WAKA_MAX_TOOLS_PER_ROUND),
        tokensIn: payload.usage?.prompt_tokens ?? 0,
        tokensOut: payload.usage?.completion_tokens ?? 0,
        provider: "deepseek",
        usedNativeTools: true,
      };
    }

    if (toolsEnabled) {
      const fallback = parseStructuredToolRequest(message.content ?? "");
      if (fallback.length > 0) {
        return {
          content: null,
          toolCalls: fallback,
          tokensIn: payload.usage?.prompt_tokens ?? 0,
          tokensOut: payload.usage?.completion_tokens ?? 0,
          provider: "deepseek",
          usedNativeTools: false,
        };
      }
    }

    return {
      content: typeof message.content === "string" ? message.content : null,
      toolCalls: [],
      tokensIn: payload.usage?.prompt_tokens ?? 0,
      tokensOut: payload.usage?.completion_tokens ?? 0,
      provider: "deepseek",
      usedNativeTools: true,
    };
  }
}

function normalizeToolCalls(
  raw: DeepSeekMessage["tool_calls"],
): LlmToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: LlmToolCall[] = [];
  for (const item of raw) {
    const name = String(item?.function?.name ?? "").trim();
    if (!name) continue;
    out.push({
      id: String(item?.id ?? `call_${out.length + 1}`),
      type: "function",
      function: {
        name,
        arguments: String(item?.function?.arguments ?? "{}"),
      },
    });
  }
  return out;
}

function filterAllowlistedToolCalls(calls: LlmToolCall[]): LlmToolCall[] {
  return calls.filter((c) => isAskWakaToolName(c.function.name));
}

/**
 * Structured protocol (allowlist-only):
 * { "tool_requests": [ { "name": "get_today_sales", "arguments": {} } ] }
 * Unknown / write / non-allowlisted tool names are dropped — never executed.
 */
export function parseStructuredToolRequest(content: string): LlmToolCall[] {
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

  if (typeof obj.answer === "string" && !obj.tool_requests && !obj.tool_calls) {
    return [];
  }

  const list = Array.isArray(obj.tool_requests)
    ? obj.tool_requests
    : Array.isArray(obj.tool_calls)
    ? obj.tool_calls
    : null;
  if (!list) return [];

  const out: LlmToolCall[] = [];
  for (const item of list) {
    if (out.length >= ASK_WAKA_MAX_TOOLS_PER_ROUND) break;
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = String(row.name ?? (row.function as { name?: string } | undefined)?.name ?? "").trim();
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

export function createLlmChatProvider(params: {
  provider: string;
  apiKey?: string | null;
  ollamaBaseUrl?: string | null;
  allowOllamaLocalhost?: boolean;
  ollamaTimeoutMs?: number;
}): LlmChatProvider {
  const name = String(params.provider || "deepseek").toLowerCase();
  if (name === "deepseek") {
    if (!params.apiKey) throw new Error("deepseek_not_configured");
    return new DeepSeekChatProvider(params.apiKey);
  }
  if (name === "ollama") {
    return createOllamaChatProvider({
      baseUrl: params.ollamaBaseUrl,
      allowLocalhost: params.allowOllamaLocalhost,
      timeoutMs: params.ollamaTimeoutMs,
    });
  }
  throw new Error(`provider_not_implemented:${name}`);
}

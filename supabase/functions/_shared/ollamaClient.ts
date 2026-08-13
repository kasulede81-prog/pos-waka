/**
 * Ollama HTTP chat provider for Ask WAKA (Qwen and compatible models).
 *
 * ASK-4.1 hardening:
 * - NEVER expose `thinking` / `reasoning` to callers
 * - Prefer sequential tool use (at most one tool call per response)
 * - Empty content + no tools → optional one controlled final-answer retry, else incomplete
 *
 * Never executes tools. Never receives service-role / DB credentials.
 * Localhost blocked for Edge unless allowLocalhost / OLLAMA_ALLOW_LOCALHOST=1.
 */

import {
  ASK_WAKA_MAX_TOOLS_PER_ROUND,
  isAskWakaToolName,
  type AskWakaToolDef,
} from "./askWakaTools.ts";
import type {
  LlmChatMessage,
  LlmChatProvider,
  LlmChatRequest,
  LlmChatResult,
  LlmProviderName,
  LlmToolCall,
} from "./llmProvider.ts";

export const OLLAMA_FINAL_ANSWER_INSTRUCTION =
  "Return only the concise final answer for the user. Do not provide reasoning or analysis. Do not mention tools or internal names.";

export const OLLAMA_INCOMPLETE_CONTENT_ERROR = "ollama_incomplete_content";

/** Ollama JSON schema used to force a content-only final answer (Qwen3 think:false). */
export const OLLAMA_ANSWER_JSON_FORMAT = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
} as const;

export type OllamaChatProviderOptions = {
  baseUrl: string;
  timeoutMs?: number;
  allowLocalhost?: boolean;
  /**
   * When true (default), if the model returns empty content with no tool calls
   * after tool results exist in the conversation, issue one controlled follow-up
   * that asks for content-only final answer.
   */
  enableFinalAnswerRetry?: boolean;
  /** Cap tool calls returned per response (default 1 for sequential Qwen behavior). */
  maxToolsPerResponse?: number;
};

type OllamaToolCallRaw = {
  id?: string;
  type?: string;
  function?: {
    index?: number;
    name?: string;
    arguments?: unknown;
  };
};

type OllamaMessageRaw = {
  role?: string;
  content?: string | null;
  thinking?: string | null;
  reasoning?: string | null;
  tool_calls?: OllamaToolCallRaw[];
};

export function assertSafeOllamaBaseUrl(raw: string, allowLocalhost: boolean): string {
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
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0";
  if (isLocal && !allowLocalhost) {
    throw new Error("ollama_localhost_not_reachable_from_edge");
  }
  return trimmed;
}

/** Normalize Ollama native tool_calls; unknown/write names dropped; capped. */
export function normalizeOllamaToolCalls(
  raw: unknown,
  maxTools = 1,
): LlmToolCall[] {
  const limit = Math.max(1, Math.min(ASK_WAKA_MAX_TOOLS_PER_ROUND, Math.floor(maxTools)));
  if (!Array.isArray(raw)) return [];
  const out: LlmToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as OllamaToolCallRaw;
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
 * Otherwise return trimmed content as-is. Never reads thinking/reasoning.
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
      /* fall through — treat as plain text */
    }
  }
  return content;
}

/**
 * Public assistant text = message.content only (optionally unwrap {"answer":...}).
 * NEVER returns thinking/reasoning (must not reach end users).
 */
export function resolveOllamaPublicContent(message: OllamaMessageRaw): string | null {
  return extractOllamaAnswerContent(message.content);
}

/** True when the conversation already includes tool results (final-answer phase). */
export function conversationHasToolResults(messages: readonly LlmChatMessage[]): boolean {
  return messages.some((m) => m.role === "tool");
}

function toOllamaMessages(messages: LlmChatMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "user") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const row: Record<string, unknown> = {
        role: "assistant",
        content: m.content ?? "",
      };
      if (m.tool_calls && m.tool_calls.length > 0) {
        row.tool_calls = m.tool_calls.map((c) => ({
          id: c.id,
          type: "function",
          function: {
            name: c.function.name,
            arguments: safeParseArgsObject(c.function.arguments),
          },
        }));
      }
      out.push(row);
      continue;
    }
    if (m.role === "tool") {
      out.push({ role: "tool", content: m.content });
    }
  }
  return out;
}

function safeParseArgsObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  return {};
}

function toOllamaTools(tools: AskWakaToolDef[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    },
  }));
}

type RawChatOk = {
  message: OllamaMessageRaw;
  tokensIn: number;
  tokensOut: number;
};

export class OllamaChatProvider implements LlmChatProvider {
  readonly name: LlmProviderName = "ollama";
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly enableFinalAnswerRetry: boolean;
  private readonly maxToolsPerResponse: number;

  constructor(opts: OllamaChatProviderOptions) {
    this.baseUrl = assertSafeOllamaBaseUrl(opts.baseUrl, opts.allowLocalhost === true);
    this.timeoutMs = Math.max(5_000, opts.timeoutMs ?? 120_000);
    this.enableFinalAnswerRetry = opts.enableFinalAnswerRetry !== false;
    this.maxToolsPerResponse = Math.max(
      1,
      Math.min(ASK_WAKA_MAX_TOOLS_PER_ROUND, opts.maxToolsPerResponse ?? 1),
    );
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResult> {
    const model = String(req.model || "").trim();
    if (!model) throw new Error("ollama_model_required");

    const toolsEnabled = Boolean(req.tools && req.tools.length > 0);
    const wantsFinalOnly =
      !toolsEnabled && conversationHasToolResults(req.messages);

    // Final-answer phase: disable Qwen thinking and force {"answer":"..."} so content is usable.
    const first = await this.rawChat(req, {
      think: wantsFinalOnly ? false : undefined,
      answerJsonFormat: wantsFinalOnly,
    });
    const normalized = this.normalizeResult(first, toolsEnabled);

    if (normalized.toolCalls.length > 0) {
      return normalized;
    }
    if (normalized.content) {
      return normalized;
    }

    // Empty public content + no tools. Never fall back to thinking.
    const canRetry =
      this.enableFinalAnswerRetry &&
      conversationHasToolResults(req.messages) &&
      !lastUserIsFinalInstruction(req.messages);

    if (canRetry) {
      const retry = await this.rawChat(
        {
          ...req,
          tools: undefined,
          messages: [
            ...req.messages,
            { role: "user", content: OLLAMA_FINAL_ANSWER_INSTRUCTION },
          ],
          maxTokens: Math.min(800, req.maxTokens ?? 800),
          temperature: 0.1,
        },
        { think: false, answerJsonFormat: true },
      );
      const retryNorm = this.normalizeResult(retry, false);
      if (retryNorm.content) {
        return {
          ...retryNorm,
          tokensIn: normalized.tokensIn + retryNorm.tokensIn,
          tokensOut: normalized.tokensOut + retryNorm.tokensOut,
        };
      }
    }

    // Incomplete — caller must treat as failure / safe fallback (do not expose thinking).
    return {
      content: null,
      toolCalls: [],
      tokensIn: normalized.tokensIn,
      tokensOut: normalized.tokensOut,
      provider: "ollama",
      usedNativeTools: false,
    };
  }

  private normalizeResult(raw: RawChatOk, toolsEnabled: boolean): LlmChatResult {
    const message = raw.message;
    const nativeCalls = normalizeOllamaToolCalls(message.tool_calls, this.maxToolsPerResponse);
    const publicContent = resolveOllamaPublicContent(message);

    if (toolsEnabled && nativeCalls.length > 0) {
      return {
        content: publicContent,
        toolCalls: nativeCalls,
        tokensIn: raw.tokensIn,
        tokensOut: raw.tokensOut,
        provider: "ollama",
        usedNativeTools: true,
      };
    }

    if (toolsEnabled && publicContent) {
      const fallback = parseAllowlistedStructuredToolRequest(publicContent);
      const capped = fallback.slice(0, this.maxToolsPerResponse);
      if (capped.length > 0) {
        return {
          content: null,
          toolCalls: capped,
          tokensIn: raw.tokensIn,
          tokensOut: raw.tokensOut,
          provider: "ollama",
          usedNativeTools: false,
        };
      }
    }

    return {
      content: publicContent,
      toolCalls: [],
      tokensIn: raw.tokensIn,
      tokensOut: raw.tokensOut,
      provider: "ollama",
      usedNativeTools: false,
    };
  }

  private async rawChat(
    req: LlmChatRequest,
    mode?: { think?: boolean; answerJsonFormat?: boolean },
  ): Promise<RawChatOk> {
    const model = String(req.model || "").trim();
    const toolsEnabled = Boolean(req.tools && req.tools.length > 0);
    const body: Record<string, unknown> = {
      model,
      stream: false,
      messages: toOllamaMessages(req.messages),
      options: {
        temperature: req.temperature ?? 0.2,
        num_predict: req.maxTokens ?? 1200,
      },
    };
    if (typeof mode?.think === "boolean") {
      // Top-level Ollama flag (not options.think) — required for Qwen3.
      body.think = mode.think;
    }
    if (mode?.answerJsonFormat) {
      body.format = OLLAMA_ANSWER_JSON_FORMAT;
    }
    if (toolsEnabled) {
      body.tools = toOllamaTools(req.tools!);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "fetch_failed";
      if (msg.toLowerCase().includes("abort")) throw new Error("ollama_timeout");
      throw new Error(`ollama_unavailable:${msg.slice(0, 160)}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (res.status === 404) throw new Error("ollama_model_unavailable");
      throw new Error(`ollama_http_${res.status}:${errText.slice(0, 200)}`);
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new Error("ollama_malformed_response");
    }
    if (!payload || typeof payload !== "object") {
      throw new Error("ollama_malformed_response");
    }
    const obj = payload as {
      message?: OllamaMessageRaw;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    if (!obj.message || typeof obj.message !== "object") {
      throw new Error("ollama_malformed_response");
    }

    return {
      message: obj.message,
      tokensIn: Number(obj.prompt_eval_count ?? 0) || 0,
      tokensOut: Number(obj.eval_count ?? 0) || 0,
    };
  }
}

function lastUserIsFinalInstruction(messages: readonly LlmChatMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      return m.content.trim() === OLLAMA_FINAL_ANSWER_INSTRUCTION;
    }
  }
  return false;
}

export function createOllamaChatProvider(params: {
  baseUrl?: string | null;
  allowLocalhost?: boolean;
  timeoutMs?: number;
  enableFinalAnswerRetry?: boolean;
  maxToolsPerResponse?: number;
}): OllamaChatProvider {
  const fromEnv = typeof Deno !== "undefined" ? Deno.env.get("OLLAMA_BASE_URL") : null;
  const baseUrl = String(params.baseUrl || fromEnv || "").trim();
  if (!baseUrl) throw new Error("ollama_not_configured");
  const allowLocalhost =
    params.allowLocalhost === true ||
    (typeof Deno !== "undefined" && Deno.env.get("OLLAMA_ALLOW_LOCALHOST") === "1");
  return new OllamaChatProvider({
    baseUrl,
    allowLocalhost,
    timeoutMs: params.timeoutMs,
    enableFinalAnswerRetry: params.enableFinalAnswerRetry,
    maxToolsPerResponse: params.maxToolsPerResponse,
  });
}

function parseAllowlistedStructuredToolRequest(content: string): LlmToolCall[] {
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

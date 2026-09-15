import { invokeSupabaseEdgeFunction } from "../supabaseEdgeInvoke";
import { normalizeAiErrorCode } from "./aiErrors";
import { parseAiEdgeFailure } from "./parseAiEdgeResponse";

export type AskWakaLocale = "en" | "lg";

export type AskWakaUsage = {
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
};

export type AskWakaSuccess = {
  ok: true;
  answer: string;
  tools_used: string[];
  data_as_of: string | null;
  conversation_id: string | null;
  usage: AskWakaUsage | null;
};

export type AskWakaFailure = {
  ok: false;
  error: string;
  errorCode?: string;
};

export type AskWakaResult = AskWakaSuccess | AskWakaFailure;

type EdgeResponse = {
  ok?: boolean;
  success?: boolean;
  error?: string;
  reason?: string;
  code?: string;
  message?: string;
  answer?: unknown;
  tools_used?: unknown;
  data_as_of?: unknown;
  conversation_id?: unknown;
  usage?: unknown;
};

const ASK_WAKA_TIMEOUT_MS = 120_000;

function parseUsage(raw: unknown): AskWakaUsage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const u = raw as Record<string, unknown>;
  const tokensIn = Number(u.tokens_in);
  const tokensOut = Number(u.tokens_out);
  const latencyMs = Number(u.latency_ms);
  if (![tokensIn, tokensOut, latencyMs].every((n) => Number.isFinite(n))) return null;
  return {
    tokens_in: Math.max(0, Math.trunc(tokensIn)),
    tokens_out: Math.max(0, Math.trunc(tokensOut)),
    latency_ms: Math.max(0, Math.trunc(latencyMs)),
  };
}

function parseToolsUsed(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => String(t ?? "").trim())
    .filter(Boolean)
    .slice(0, 32);
}

/**
 * Ask WAKA via Edge Function (JWT + server tools). Client never runs SQL/tools.
 */
export async function askWaka(params: {
  message: string;
  shopId?: string | null;
  conversationId?: string | null;
  locale?: AskWakaLocale | null;
}): Promise<AskWakaResult> {
  const message = params.message.trim();
  if (!message) {
    return { ok: false, error: "Message is required.", errorCode: "invalid_message" };
  }
  if (message.length > 2000) {
    return { ok: false, error: "Message is too long.", errorCode: "invalid_message" };
  }

  const body: Record<string, unknown> = { message };
  if (params.shopId) body.shop_id = params.shopId;
  if (params.conversationId) body.conversation_id = params.conversationId;
  if (params.locale === "en" || params.locale === "lg") body.locale = params.locale;

  const res = await invokeSupabaseEdgeFunction<EdgeResponse>("ai-ask-waka", body, {
    timeoutMs: ASK_WAKA_TIMEOUT_MS,
    deployScript: "supabase:deploy:ai",
  });

  if (!res.ok) {
    return {
      ok: false,
      error: res.message,
      errorCode: res.errorCode ?? normalizeAiErrorCode("invoke_failed", res.message),
    };
  }

  const data = res.data;
  const failure = parseAiEdgeFailure(data);
  if (failure.failed) {
    return { ok: false, error: failure.error, errorCode: failure.errorCode };
  }

  const answer = String(data.answer ?? "").trim();
  if (!answer) {
    return { ok: false, error: "Empty AI response.", errorCode: "invalid_schema" };
  }

  return {
    ok: true,
    answer,
    tools_used: parseToolsUsed(data.tools_used),
    data_as_of: typeof data.data_as_of === "string" && data.data_as_of ? data.data_as_of : null,
    conversation_id:
      typeof data.conversation_id === "string" && data.conversation_id
        ? data.conversation_id
        : params.conversationId ?? null,
    usage: parseUsage(data.usage),
  };
}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertAiFeatureAllowed } from "../_shared/aiGuard.ts";
import { aiBlocked, aiFailure, aiSuccess, cors } from "../_shared/aiResponse.ts";
import { logAiRequest } from "../_shared/aiUsage.ts";
import { llmModelFromSettings, ollamaBaseUrlFromSettings } from "../_shared/platformAiSettings.v2.ts";
import { ASK_WAKA_SYSTEM_PROMPT, buildAskWakaUserPrompt } from "../_shared/askWakaPrompts.ts";
import {
  ASK_WAKA_MAX_TOOL_ROUNDS,
  ASK_WAKA_MAX_TOOLS_PER_ROUND,
  ASK_WAKA_TOOL_DEFINITIONS,
  executeAskWakaTool,
  resolveAskWakaShopScope,
  validateAskWakaMessage,
  type AskWakaToolName,
} from "../_shared/askWakaTools.ts";
import {
  ASK_WAKA_OUT_OF_SCOPE,
  ASK_WAKA_READ_ONLY_REFUSAL,
  ASK_WAKA_SAFE_TOOL_FAILURE,
  ASK_WAKA_SQL_REFUSAL,
  askWakaObservabilityTags,
  classifyAskWakaQuestion,
  defaultArgsForAskWakaTool,
  ensureAskWakaDataAsOfInAnswer,
  guardAskWakaFinalAnswer,
  quantitativeToolsSatisfied,
} from "../_shared/askWakaGuardrails.ts";
import {
  createLlmChatProvider,
  type LlmChatMessage,
  type LlmChatProvider,
  type LlmToolCall,
} from "../_shared/llmProvider.ts";
import { OLLAMA_FINAL_ANSWER_INSTRUCTION } from "../_shared/ollamaClient.ts";

const FEATURE = "ask_waka";
const KIND = "ask_waka_chat";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const started = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY");

  if (!supabaseUrl || !serviceKey || !anonKey) {
    return aiFailure("Server misconfigured", "server_misconfigured", 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return aiFailure("Unauthorized", "unauthorized", 401);
  }

  let body: {
    message?: string;
    shop_id?: string;
    conversation_id?: string;
    locale?: string;
  };
  try {
    body = await req.json();
  } catch {
    return aiFailure("Invalid body", "invalid_body", 400);
  }

  const messageCheck = validateAskWakaMessage(body.message);
  if (!messageCheck.ok) {
    return aiFailure(messageCheck.reason, messageCheck.code, 400);
  }

  const classification = classifyAskWakaQuestion(messageCheck.message);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user?.id) {
    return aiFailure("Unauthorized", "unauthorized", 401);
  }
  const userId = userData.user.id;

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: primaryRaw, error: primaryErr } = await userClient.rpc("waka_primary_shop_for_user");
  if (primaryErr) {
    return aiFailure("Shop lookup failed", "shop_lookup_failed", 500);
  }
  const primaryShopId = primaryRaw != null ? String(primaryRaw) : null;

  const { data: memberRows, error: memberErr } = await admin
    .from("shop_members")
    .select("shop_id")
    .eq("user_id", userId);
  if (memberErr) {
    return aiFailure("Shop access check failed", "shop_access_failed", 500);
  }
  const accessibleShopIds = (memberRows ?? [])
    .map((r) => String((r as { shop_id?: string }).shop_id ?? ""))
    .filter(Boolean);

  const preferred = body.shop_id != null ? String(body.shop_id).trim() : null;
  if (preferred && !accessibleShopIds.includes(preferred)) {
    const { data: canAccess } = await userClient.rpc("user_can_access_shop", { p_shop: preferred });
    if (canAccess === true) accessibleShopIds.push(preferred);
  }
  if (primaryShopId && !accessibleShopIds.includes(primaryShopId)) {
    const { data: canAccessPrimary } = await userClient.rpc("user_can_access_shop", {
      p_shop: primaryShopId,
    });
    if (canAccessPrimary === true) accessibleShopIds.push(primaryShopId);
  }

  const shopScope = resolveAskWakaShopScope({
    preferredShopId: preferred,
    primaryShopId,
    accessibleShopIds,
  });
  if (!shopScope.ok) {
    return aiFailure(shopScope.reason, shopScope.code, shopScope.code === "forbidden" ? 403 : 400);
  }
  const shopId = shopScope.shopId;

  const { data: canAccessBound, error: accessErr } = await userClient.rpc("user_can_access_shop", {
    p_shop: shopId,
  });
  if (accessErr || canAccessBound !== true) {
    return aiFailure("Shop access denied", "forbidden", 403);
  }

  const guard = await assertAiFeatureAllowed(admin, FEATURE, { userId, shopId }, false);
  if (!guard.allowed) {
    return aiBlocked(guard.reason, guard.code);
  }

  const dataAsOf = new Date().toISOString();
  const toolsUsed: string[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let toolsFailed = false;

  // Short-circuit write / SQL / out-of-scope without tool calls or LLM spend.
  if (
    classification.kind === "write_request" ||
    classification.kind === "sql_request" ||
    classification.kind === "out_of_scope"
  ) {
    const canned =
      classification.kind === "write_request"
        ? ASK_WAKA_READ_ONLY_REFUSAL
        : classification.kind === "sql_request"
          ? ASK_WAKA_SQL_REFUSAL
          : ASK_WAKA_OUT_OF_SCOPE;

    await logAiRequest(admin, {
      shopId,
      userId,
      feature: FEATURE,
      kind: KIND,
      tokensIn: 0,
      tokensOut: 0,
      cacheHit: true,
      success: true,
      latencyMs: Date.now() - started,
      provider: guard.settings.provider,
      errorReason: askWakaObservabilityTags({
        classification,
        toolsUsed: [],
        toolsFailed: false,
        blockedReason: classification.kind,
      }),
    });

    return aiSuccess({
      answer: canned,
      tools_used: [],
      data_as_of: dataAsOf,
      conversation_id: body.conversation_id ?? null,
      usage: { tokens_in: 0, tokens_out: 0, latency_ms: Date.now() - started },
    });
  }

  if (!deepseekKey && String(guard.settings.provider || "deepseek").toLowerCase() === "deepseek") {
    return aiFailure("DeepSeek not configured", "deepseek_not_configured", 503);
  }

  let provider;
  try {
    provider = createLlmChatProvider({
      provider: guard.settings.provider,
      apiKey: deepseekKey,
      ollamaBaseUrl: ollamaBaseUrlFromSettings(guard.settings),
      allowOllamaLocalhost: Deno.env.get("OLLAMA_ALLOW_LOCALHOST") === "1",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "provider_failed";
    return aiFailure(
      "AI provider is not configured",
      msg.includes("not_implemented")
        ? "provider_not_implemented"
        : msg.includes("localhost")
        ? "ollama_localhost_not_reachable_from_edge"
        : msg.includes("ollama")
        ? "ollama_not_configured"
        : "provider_not_configured",
      503,
    );
  }

  const chatModel = llmModelFromSettings(guard.settings);
  const offerTools = classification.kind === "quantitative" || classification.kind === "general_business";
  const messages: LlmChatMessage[] = [
    { role: "system", content: ASK_WAKA_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildAskWakaUserPrompt({
        message: messageCheck.message,
        shopId,
        locale: body.locale ?? null,
        dataAsOf,
        questionKind: classification.kind,
        requiredTools: classification.requiredTools,
      }),
    },
  ];

  let finalAnswer: string | null = null;

  try {
    for (let round = 0; round < ASK_WAKA_MAX_TOOL_ROUNDS; round++) {
      const llm = await provider.chat({
        model: chatModel,
        messages,
        tools: offerTools ? ASK_WAKA_TOOL_DEFINITIONS : undefined,
        temperature: 0.2,
        maxTokens: 1200,
      });
      tokensIn += llm.tokensIn;
      tokensOut += llm.tokensOut;

      if (!llm.toolCalls.length) {
        finalAnswer = (llm.content ?? "").trim() || null;
        break;
      }

      const calls = llm.toolCalls.slice(0, ASK_WAKA_MAX_TOOLS_PER_ROUND);
      // Prefer sequential tool use: execute at most one model-requested tool per round.
      // Remaining required tools are handled by ASK-3 force-exec / later rounds.
      const sequentialCalls = isOllamaProvider(provider.name) ? calls.slice(0, 1) : calls;
      messages.push({
        role: "assistant",
        content: llm.content ?? null,
        tool_calls: sequentialCalls,
      });

      for (const call of sequentialCalls) {
        const parsedArgs = parseToolArguments(call);
        const result = await executeAskWakaTool({
          userClient,
          boundShopId: shopId,
          toolName: call.function.name,
          rawArgs: parsedArgs,
        });

        if (result.ok) {
          toolsUsed.push(result.tool);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result.data),
          });
        } else {
          toolsFailed = true;
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: false,
              error: result.code,
              reason: result.reason,
            }),
          });
        }
      }
    }

    // Force-execute required tools when the model skipped them for a quantitative ask.
    if (
      classification.kind === "quantitative" &&
      !quantitativeToolsSatisfied(classification, toolsUsed)
    ) {
      const toRun = classification.requiredTools.slice(0, 2);
      for (const toolName of toRun) {
        if (toolsUsed.includes(toolName)) continue;
        const result = await executeAskWakaTool({
          userClient,
          boundShopId: shopId,
          toolName,
          rawArgs: defaultArgsForAskWakaTool(toolName as AskWakaToolName, classification),
        });
        if (result.ok) {
          toolsUsed.push(result.tool);
          messages.push({
            role: "user",
            content: JSON.stringify({
              forced_tool_result: {
                tool: result.tool,
                data: result.data,
                note: "Authoritative POS data. Use these figures; do not invent numbers.",
              },
            }),
          });
        } else {
          toolsFailed = true;
        }
      }

      if (quantitativeToolsSatisfied(classification, toolsUsed)) {
        finalAnswer = await requestFinalAnswer(provider, chatModel, messages, {
          tokens: { add(inT: number, outT: number) {
            tokensIn += inT;
            tokensOut += outT;
          } },
          preferOllama: isOllamaProvider(provider.name),
        });
      } else {
        finalAnswer = ASK_WAKA_SAFE_TOOL_FAILURE;
      }
    } else if (!finalAnswer) {
      finalAnswer = await requestFinalAnswer(provider, chatModel, messages, {
        tokens: { add(inT: number, outT: number) {
          tokensIn += inT;
          tokensOut += outT;
        } },
        preferOllama: isOllamaProvider(provider.name),
        toolsFailed,
      });
    }

    // Empty content after tools must never surface model reasoning.
    if (!finalAnswer && toolsUsed.length > 0) {
      finalAnswer = ASK_WAKA_SAFE_TOOL_FAILURE;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ai_provider_failed";
    await logAiRequest(admin, {
      shopId,
      userId,
      feature: FEATURE,
      kind: KIND,
      tokensIn,
      tokensOut,
      cacheHit: false,
      success: false,
      latencyMs: Date.now() - started,
      provider: guard.settings.provider,
      errorReason: askWakaObservabilityTags({
        classification,
        toolsUsed,
        toolsFailed,
        blockedReason: "provider_failed",
        providerFailed: true,
      }) + `;detail=${msg.slice(0, 120)}`,
    });
    return aiFailure("AI provider failed", "ai_provider_failed", 502);
  }

  let guarded = guardAskWakaFinalAnswer({
    classification,
    toolsUsed,
    toolsFailed,
    answer: finalAnswer,
  });

  if (
    classification.kind === "quantitative" &&
    !guarded.blocked &&
    quantitativeToolsSatisfied(classification, toolsUsed)
  ) {
    guarded = {
      ...guarded,
      answer: ensureAskWakaDataAsOfInAnswer(guarded.answer, dataAsOf),
    };
  }

  await logAiRequest(admin, {
    shopId,
    userId,
    feature: FEATURE,
    kind: KIND,
    tokensIn,
    tokensOut,
    cacheHit: false,
    success: true,
    latencyMs: Date.now() - started,
    provider: guard.settings.provider,
    errorReason: askWakaObservabilityTags({
      classification,
      toolsUsed,
      toolsFailed,
      blockedReason: guarded.reason,
    }),
  });

  return aiSuccess({
    answer: guarded.answer,
    tools_used: [...new Set(toolsUsed)],
    data_as_of: dataAsOf,
    conversation_id: body.conversation_id ?? null,
    usage: {
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      latency_ms: Date.now() - started,
    },
  });
});

function parseToolArguments(call: LlmToolCall): unknown {
  const raw = call.function.arguments ?? "{}";
  try {
    return JSON.parse(raw);
  } catch {
    return { __invalid_json: true };
  }
}

function isOllamaProvider(name: string): boolean {
  return name === "ollama";
}

async function requestFinalAnswer(
  provider: LlmChatProvider,
  chatModel: string,
  messages: LlmChatMessage[],
  opts: {
    tokens: { add: (inT: number, outT: number) => void };
    preferOllama: boolean;
    toolsFailed?: boolean;
  },
): Promise<string | null> {
  const baseInstruction = opts.toolsFailed
    ? "Using only the tool results above, write the final concise business answer. If tools failed, say the information could not be retrieved. Do not invent numbers. Do not mention internal tool names."
    : "Using only the tool results above, write the final concise business answer. State the period. Use UGX without unnecessary decimals. If a figure is zero, say zero clearly. Separate FACT from RECOMMENDATION if you give advice. Do not invent numbers. Do not mention internal tool names.";

  const instruction = opts.preferOllama
    ? `${baseInstruction}\n\n${OLLAMA_FINAL_ANSWER_INSTRUCTION}`
    : baseInstruction;

  const closing = await provider.chat({
    model: chatModel,
    messages: [...messages, { role: "user", content: instruction }],
    temperature: 0.2,
    maxTokens: 800,
  });
  opts.tokens.add(closing.tokensIn, closing.tokensOut);
  const text = (closing.content ?? "").trim();
  if (text) return text;

  // Ollama/Qwen sometimes returns empty content after tools; one more controlled nudge.
  if (opts.preferOllama) {
    const retry = await provider.chat({
      model: chatModel,
      messages: [
        ...messages,
        { role: "user", content: instruction },
        { role: "user", content: OLLAMA_FINAL_ANSWER_INSTRUCTION },
      ],
      temperature: 0.1,
      maxTokens: 800,
    });
    opts.tokens.add(retry.tokensIn, retry.tokensOut);
    return (retry.content ?? "").trim() || null;
  }

  return null;
}

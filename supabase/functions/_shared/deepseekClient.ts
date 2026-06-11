import {
  BUSINESS_SETUP_SYSTEM_PROMPT,
  BULK_INVENTORY_SYSTEM_PROMPT,
  parseAiBulkInventory,
  parseAiBusinessSetup,
  type AiBulkInventoryRow,
  type AiBusinessSetupResult,
} from "./aiBusinessSchemas.ts";
import { parseAiProductSuggestion, PRODUCT_SUGGEST_SYSTEM_PROMPT, type AiProductSuggestion } from "./aiProductSchemas.ts";

export type DeepSeekResult = {
  suggestion: AiProductSuggestion;
  tokensIn: number;
  tokensOut: number;
};

export async function callDeepSeekProductSuggest(params: {
  apiKey: string;
  model: string;
  productName: string;
  businessType?: string | null;
}): Promise<DeepSeekResult> {
  const userContent = JSON.stringify({
    product_name: params.productName,
    business_type: params.businessType ?? null,
    market: "Uganda",
  });

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        { role: "system", content: PRODUCT_SUGGEST_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 400,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`deepseek_http_${res.status}:${errText.slice(0, 200)}`);
  }

  const body = await res.json() as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const content = body.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("deepseek_invalid_json");
  }

  const suggestion = parseAiProductSuggestion(parsed, params.productName);
  if (!suggestion) throw new Error("deepseek_invalid_schema");

  return {
    suggestion,
    tokensIn: body.usage?.prompt_tokens ?? 0,
    tokensOut: body.usage?.completion_tokens ?? 0,
  };
}

async function callDeepSeekJson(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
}): Promise<{ parsed: unknown; tokensIn: number; tokensOut: number }> {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: params.maxTokens,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`deepseek_http_${res.status}:${errText.slice(0, 200)}`);
  }

  const body = await res.json() as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const content = body.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("deepseek_invalid_json");
  }

  return {
    parsed,
    tokensIn: body.usage?.prompt_tokens ?? 0,
    tokensOut: body.usage?.completion_tokens ?? 0,
  };
}

export async function callDeepSeekBusinessSetup(params: {
  apiKey: string;
  model: string;
  shopName: string;
  businessType: string;
  businessDescription?: string | null;
}): Promise<{ setup: AiBusinessSetupResult; tokensIn: number; tokensOut: number }> {
  const userContent = JSON.stringify({
    shop_name: params.shopName,
    business_type: params.businessType,
    business_description: params.businessDescription ?? null,
    market: "Uganda",
  });

  const result = await callDeepSeekJson({
    apiKey: params.apiKey,
    model: params.model,
    systemPrompt: BUSINESS_SETUP_SYSTEM_PROMPT,
    userContent,
    maxTokens: 4000,
  });

  const setup = parseAiBusinessSetup(result.parsed);
  if (!setup) throw new Error("deepseek_invalid_schema");

  return { setup, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

export async function callDeepSeekBulkInventory(params: {
  apiKey: string;
  model: string;
  shopDescription: string;
  businessType: string;
}): Promise<{ products: AiBulkInventoryRow[]; tokensIn: number; tokensOut: number }> {
  const userContent = JSON.stringify({
    shop_description: params.shopDescription,
    business_type: params.businessType,
    market: "Uganda",
  });

  const result = await callDeepSeekJson({
    apiKey: params.apiKey,
    model: params.model,
    systemPrompt: BULK_INVENTORY_SYSTEM_PROMPT,
    userContent,
    maxTokens: 6000,
  });

  const products = parseAiBulkInventory(result.parsed);
  if (products.length < 5) throw new Error("deepseek_invalid_schema");

  return { products, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

import type { AiJsonGenerateRequest, AiJsonGenerateResult, AiProvider } from "./types";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

export function createDeepSeekProvider(apiKey: string): AiProvider {
  return {
    name: "deepseek",
    async generateJson(req: AiJsonGenerateRequest): Promise<AiJsonGenerateResult> {
      const started = Date.now();
      const res = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: req.model ?? "deepseek-chat",
          messages: [
            { role: "system", content: req.systemPrompt },
            { role: "user", content: req.userContent },
          ],
          response_format: { type: "json_object" },
          temperature: req.temperature ?? 0.2,
          max_tokens: req.maxTokens ?? 400,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`deepseek_http_${res.status}:${errText.slice(0, 200)}`);
      }

      const body = (await res.json()) as {
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
        latencyMs: Date.now() - started,
      };
    },
    async chat(): Promise<never> {
      throw new Error("not_implemented");
    },
    async analyzeImage(): Promise<never> {
      throw new Error("not_implemented");
    },
  };
}

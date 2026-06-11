export type AiProviderName = "deepseek" | "openai" | "gemini" | "claude";

export type AiJsonGenerateRequest = {
  systemPrompt: string;
  userContent: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
};

export type AiJsonGenerateResult = {
  parsed: unknown;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
};

export interface AiProvider {
  readonly name: AiProviderName;
  generateJson(req: AiJsonGenerateRequest): Promise<AiJsonGenerateResult>;
  chat(): Promise<never>;
  analyzeImage(): Promise<never>;
}

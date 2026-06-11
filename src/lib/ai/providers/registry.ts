import type { AiProvider, AiProviderName } from "./types";
import { createDeepSeekProvider } from "./deepseek";

export function getAiProvider(name: AiProviderName, apiKey: string): AiProvider {
  switch (name) {
    case "deepseek":
      return createDeepSeekProvider(apiKey);
    default:
      throw new Error(`provider_not_configured:${name}`);
  }
}

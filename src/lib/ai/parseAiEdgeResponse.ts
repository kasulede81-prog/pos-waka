import { normalizeAiErrorCode } from "./aiErrors";

export type AiEdgeFailure = {
  failed: true;
  error: string;
  errorCode: string;
};

export type AiEdgeSuccess = { failed: false };

export function parseAiEdgeFailure(data: Record<string, unknown>): AiEdgeFailure | AiEdgeSuccess {
  const success = data.success;
  const ok = data.ok;

  if (success === false || ok === false) {
    const errorCode = normalizeAiErrorCode(
      String(data.code ?? data.error ?? "ai_failed"),
      String(data.reason ?? data.message ?? data.error ?? ""),
    );
    return {
      failed: true,
      error: String(data.reason ?? data.error ?? data.message ?? "ai_failed"),
      errorCode,
    };
  }

  return { failed: false };
}

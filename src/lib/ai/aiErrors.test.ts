import { describe, expect, it } from "vitest";
import { formatAiErrorMessage, normalizeAiErrorCode } from "./aiErrors";
import { parseAiEdgeFailure } from "./parseAiEdgeResponse";

describe("normalizeAiErrorCode", () => {
  it("maps deploy message to function_not_deployed", () => {
    expect(
      normalizeAiErrorCode(null, 'Deploy Supabase edge function "ai-suggest-product"'),
    ).toBe("function_not_deployed");
  });

  it("maps deepseek http errors", () => {
    expect(normalizeAiErrorCode("deepseek_http_401", null)).toBe("deepseek_error");
  });

  it("maps postgres rpc missing", () => {
    expect(
      normalizeAiErrorCode(null, 'Could not find the function public.check_ai_feature_allowed'),
    ).toBe("rpc_missing");
  });
});

describe("formatAiErrorMessage", () => {
  it("shows dev diagnostics when devMode true", () => {
    expect(
      formatAiErrorMessage({ code: "function_not_deployed", devMode: true }),
    ).toBe("Function not deployed");
  });

  it("shows friendly message in production mode", () => {
    expect(
      formatAiErrorMessage({ code: "function_not_deployed", devMode: false }),
    ).toContain("Couldn't get suggestions");
  });

  it("includes detail in dev mode", () => {
    expect(
      formatAiErrorMessage({
        code: "deepseek_not_configured",
        detail: "Not set in Supabase Edge secrets",
        devMode: true,
      }),
    ).toContain("Missing API key");
  });
});

describe("parseAiEdgeFailure", () => {
  it("detects explicit failure payloads", () => {
    const r = parseAiEdgeFailure({
      success: false,
      ok: false,
      code: "feature_disabled",
      reason: "AI feature disabled",
    });
    expect(r.failed).toBe(true);
    if (r.failed) expect(r.errorCode).toBe("feature_disabled");
  });

  it("does not treat success payloads as failure", () => {
    const r = parseAiEdgeFailure({ success: true, ok: true, suggestion: {} });
    expect(r.failed).toBe(false);
  });
});

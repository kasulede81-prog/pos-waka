const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function aiJson(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export function aiSuccess(data: Record<string, unknown>): Response {
  return aiJson({ success: true, ok: true, ...data });
}

export function aiBlocked(reason: string, code?: string): Response {
  return aiJson(
    {
      success: false,
      ok: false,
      reason,
      error: code ?? "feature_disabled",
      code: code ?? "feature_disabled",
    },
    403,
  );
}

export function aiFailure(reason: string, code: string, status = 502): Response {
  return aiJson({ success: false, ok: false, reason, error: code, code }, status);
}

export { cors };

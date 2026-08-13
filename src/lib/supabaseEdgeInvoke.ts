import { classifyInvokeMessage, type AiErrorCode } from "./ai/aiErrors";
import { supabase } from "./supabase";

export type EdgeInvokeErrorCode = AiErrorCode | "network";

export type EdgeInvokeResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; errorCode?: EdgeInvokeErrorCode };

/** Parse edge function JSON even when Supabase client reports a transport error. */
async function readEdgeResponseBody(
  error: { context?: { json?: () => Promise<unknown> }; message?: string } | null,
  data: unknown,
): Promise<Record<string, unknown>> {
  if (data && typeof data === "object") return data as Record<string, unknown>;
  try {
    const body = await error?.context?.json?.();
    if (body && typeof body === "object") return body as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return {};
}

function edgeNotDeployedMessage(functionName: string, deployScript = "supabase:deploy:admin"): string {
  const hint =
    functionName.startsWith("ai-") || functionName.startsWith("ai_")
      ? "supabase:deploy:ai"
      : deployScript;
  return `Deploy Supabase edge function "${functionName}" (run: npm run ${hint}), then retry.`;
}

/** Application domain errors that contain "not found" but are not a missing Edge Function. */
export function isApplicationNotFoundError(j: Record<string, unknown>): boolean {
  const appError = String(j.error ?? j.code ?? "").toLowerCase();
  return (
    appError === "shop_not_found" ||
    appError === "owner_not_found" ||
    appError === "organization_not_found" ||
    appError.endsWith("_not_found")
  );
}

/**
 * True only when the gateway indicates the Edge Function slug itself is missing.
 * Must not match shop_not_found, generic "not found", or HTTP 404 application bodies.
 */
export function isGatewayFunctionMissing(
  j: Record<string, unknown>,
  transportMessage?: string | null,
): boolean {
  if (isApplicationNotFoundError(j)) return false;

  const code = String(j.code ?? "").toUpperCase();
  const message = String(j.message ?? "").toLowerCase();
  const transport = String(transportMessage ?? "").toLowerCase();
  const combined = `${message} ${transport}`;

  if (combined.includes("requested function was not found")) return true;
  if (combined.includes("edge function not found")) return true;
  if (code === "NOT_FOUND" && combined.includes("function")) return true;
  return false;
}

export function isNetworkTransportFailure(message: string | null | undefined): boolean {
  const msg = String(message ?? "").toLowerCase();
  return (
    msg.includes("failed to send a request to the edge function") ||
    msg.includes("failed to send") ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed")
  );
}

/**
 * Invoke a Supabase edge function with timeout and precise unavailable vs network errors.
 */
export async function invokeSupabaseEdgeFunction<T extends Record<string, unknown>>(
  functionName: string,
  body: Record<string, unknown>,
  opts?: { timeoutMs?: number; deployScript?: string },
): Promise<EdgeInvokeResult<T>> {
  if (!supabase) {
    return { ok: false, message: "Supabase is not configured.", errorCode: "server_misconfigured" };
  }

  const timeoutMs = opts?.timeoutMs ?? 45_000;
  const invokePromise = supabase.functions.invoke(functionName, { body });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
  }, timeoutMs);

  try {
    const { data, error } = await invokePromise;
    clearTimeout(timer);
    if (timedOut) {
      return { ok: false, message: "Request timed out. Check your connection and retry.", errorCode: "timeout" };
    }

    const j = (await readEdgeResponseBody(error, data)) as T & {
      ok?: boolean;
      error?: string;
      detail?: string;
      message?: string;
    };

    if (isGatewayFunctionMissing(j, error?.message)) {
      return {
        ok: false,
        message: edgeNotDeployedMessage(functionName, opts?.deployScript),
        errorCode: "function_not_deployed",
      };
    }

    if (error) {
      if (isNetworkTransportFailure(error.message)) {
        return {
          ok: false,
          message: "Request failed. Check your connection and retry.",
          errorCode: "network",
        };
      }
      if (j.ok === true) return { ok: true, data: j as T };
      const msg = String(j.detail ?? j.message ?? j.error ?? error.message ?? "");
      const errorCode = classifyInvokeMessage(msg || error.message || "", functionName);
      return { ok: false, message: msg || error.message || "Request failed.", errorCode };
    }

    if (j.ok === false || j.error) {
      const msg = String(j.detail ?? j.message ?? j.error ?? "Request failed.");
      return {
        ok: false,
        message: msg,
        errorCode: classifyInvokeMessage(msg, functionName),
      };
    }

    return { ok: true, data: j as T };
  } catch (err) {
    clearTimeout(timer);
    const msg = (err as Error).message ?? "Request failed.";
    if (isNetworkTransportFailure(msg) || msg.toLowerCase().includes("failed to fetch")) {
      return {
        ok: false,
        message: "Request failed. Check your connection and retry.",
        errorCode: "network",
      };
    }
    return { ok: false, message: msg, errorCode: classifyInvokeMessage(msg, functionName) };
  }
}

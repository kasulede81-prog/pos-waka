import { supabase } from "./supabase";

export type EdgeInvokeResult<T> = { ok: true; data: T } | { ok: false; message: string };

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

function edgeNotDeployedMessage(functionName: string): string {
  return `Deploy Supabase edge function "${functionName}" (run: npm run supabase:deploy:admin), then retry.`;
}

/**
 * Invoke a Supabase edge function with timeout and clearer errors when not deployed.
 */
export async function invokeSupabaseEdgeFunction<T extends Record<string, unknown>>(
  functionName: string,
  body: Record<string, unknown>,
  opts?: { timeoutMs?: number },
): Promise<EdgeInvokeResult<T>> {
  if (!supabase) {
    return { ok: false, message: "Supabase is not configured." };
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
      return { ok: false, message: "Request timed out. Check your connection and retry." };
    }

    const j = (await readEdgeResponseBody(error, data)) as T & { ok?: boolean; error?: string; detail?: string; message?: string };

    if (error) {
      const msg = String(j.detail ?? j.message ?? j.error ?? error.message ?? "");
      if (
        error.message?.includes("Failed to send") ||
        error.message?.includes("not found") ||
        error.message?.includes("404") ||
        msg.includes("not found")
      ) {
        return { ok: false, message: edgeNotDeployedMessage(functionName) };
      }
      if (j.ok === true) return { ok: true, data: j as T };
      return { ok: false, message: msg || error.message || "Request failed." };
    }

    if (j.ok === false || j.error) {
      return {
        ok: false,
        message: String(j.detail ?? j.message ?? j.error ?? "Request failed."),
      };
    }

    return { ok: true, data: j as T };
  } catch (err) {
    clearTimeout(timer);
    const msg = (err as Error).message ?? "Request failed.";
    if (msg.includes("Failed to send") || msg.includes("fetch")) {
      return { ok: false, message: edgeNotDeployedMessage(functionName) };
    }
    return { ok: false, message: msg };
  }
}

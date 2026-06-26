/**
 * Numbered startup boot trace for registration / auth callback debugging.
 * Logs START | SUCCESS | FAILED | TIMEOUT with duration ms and current URL.
 */

export type BootTraceOutcome = "START" | "SUCCESS" | "FAILED" | "TIMEOUT";

export type BootTraceId =
  | "BOOT-001"
  | "BOOT-002"
  | "BOOT-003"
  | "BOOT-004"
  | "BOOT-005"
  | "BOOT-006"
  | "BOOT-007"
  | "BOOT-008"
  | "BOOT-009"
  | "BOOT-010"
  | "BOOT-011"
  | "BOOT-012"
  | "BOOT-013"
  | "BOOT-014"
  | "BOOT-015"
  | "BOOT-016"
  | "BOOT-017"
  | "BOOT-018"
  | "BOOT-019"
  | "BOOT-020"
  | "BOOT-021"
  | "BOOT-022"
  | "BOOT-023"
  | "BOOT-024";

const pendingStarts = new Map<string, number>();

function currentUrl(): string {
  if (typeof window === "undefined") return "";
  return window.location.href;
}

export function bootTrace(
  id: BootTraceId,
  label: string,
  outcome: BootTraceOutcome,
  detail?: Record<string, unknown>,
): void {
  const key = `${id}:${label}`;
  const now = Date.now();
  let durationMs: number | undefined;

  if (outcome === "START") {
    pendingStarts.set(key, now);
  } else {
    const started = pendingStarts.get(key);
    if (started != null) {
      durationMs = now - started;
      pendingStarts.delete(key);
    }
  }

  const payload = {
    scope: "waka_boot",
    id,
    label,
    outcome,
    at: new Date().toISOString(),
    url: currentUrl(),
    ...(durationMs != null ? { durationMs } : {}),
    ...detail,
  };

  const line = `[${id}] ${label} ${outcome}${durationMs != null ? ` (${durationMs}ms)` : ""}`;
  if (import.meta.env.DEV) {
    console.info(line, payload);
  } else {
    console.info(JSON.stringify({ ...payload, line }));
  }

  try {
    const ringKey = "waka.boot.trace.v1";
    const prev = JSON.parse(globalThis.localStorage?.getItem(ringKey) ?? "[]") as unknown[];
    const next = [...(Array.isArray(prev) ? prev : []), payload].slice(-80);
    globalThis.localStorage?.setItem(ringKey, JSON.stringify(next));
  } catch {
    /* quota */
  }
}

/** Wrap async work with START/SUCCESS/FAILED/TIMEOUT boot traces. */
export async function bootTraceAsync<T>(
  id: BootTraceId,
  label: string,
  fn: () => Promise<T>,
  opts?: { timeoutMs?: number; timeoutFallback?: T },
): Promise<T> {
  bootTrace(id, label, "START");
  const timeoutMs = opts?.timeoutMs;
  if (timeoutMs == null || timeoutMs <= 0) {
    try {
      const result = await fn();
      bootTrace(id, label, "SUCCESS");
      return result;
    } catch (err) {
      bootTrace(id, label, "FAILED", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  let timedOut = false;
  const timeoutFallback = opts?.timeoutFallback as T;
  const result = await Promise.race([
    fn().then((v) => ({ ok: true as const, value: v })),
    new Promise<{ ok: false; value: T }>((resolve) => {
      window.setTimeout(() => {
        timedOut = true;
        resolve({ ok: false, value: timeoutFallback });
      }, timeoutMs);
    }),
  ]);

  if (timedOut) {
    bootTrace(id, label, "TIMEOUT", { timeoutMs });
    return result.value;
  }

  if (result.ok) {
    bootTrace(id, label, "SUCCESS");
    return result.value;
  }

  bootTrace(id, label, "TIMEOUT", { timeoutMs });
  return result.value;
}

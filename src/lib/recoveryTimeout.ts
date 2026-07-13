/**
 * Phase 24.2A — recovery operation timeouts, retries, and classified errors.
 */

export type RecoveryTimeoutKind =
  | "probe"
  | "snapshot"
  | "entity_pull"
  | "staff"
  | "persist"
  | "validation"
  | "global";

export class RecoveryTimeoutError extends Error {
  readonly kind: RecoveryTimeoutKind;
  readonly timeoutMs: number;
  readonly attempts: number;

  constructor(kind: RecoveryTimeoutKind, timeoutMs: number, attempts: number) {
    super(`recovery_timeout_${kind}`);
    this.name = "RecoveryTimeoutError";
    this.kind = kind;
    this.timeoutMs = timeoutMs;
    this.attempts = attempts;
  }
}

export const RECOVERY_PROBE_TIMEOUT_MS = 20_000;
export const RECOVERY_ENTITY_TIMEOUT_MS = 60_000;
export const RECOVERY_STAFF_TIMEOUT_MS = 45_000;
export const RECOVERY_PERSIST_TIMEOUT_MS = 120_000;
export const RECOVERY_GLOBAL_TIMEOUT_MS = 180_000;

const DEFAULT_RETRIES = 1;
const RETRY_DELAY_MS = 800;

function scheduleTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  return globalThis.setTimeout(fn, ms);
}

function clearScheduledTimeout(id: ReturnType<typeof setTimeout>): void {
  globalThis.clearTimeout(id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => scheduleTimeout(resolve, ms));
}

export async function withRecoveryTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  opts: {
    kind: RecoveryTimeoutKind;
    timeoutMs: number;
    retries?: number;
    onRetry?: (attempt: number, kind: RecoveryTimeoutKind) => void;
  },
): Promise<T> {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = scheduleTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const result = await operation(controller.signal);
      clearScheduledTimeout(timer);
      return result;
    } catch (err) {
      clearScheduledTimeout(timer);
      lastErr = err;
      const timedOut =
        controller.signal.aborted ||
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.message.includes("aborted"));
      if (!timedOut || attempt >= retries) {
        if (timedOut) {
          throw new RecoveryTimeoutError(opts.kind, opts.timeoutMs, attempt + 1);
        }
        throw err;
      }
      opts.onRetry?.(attempt + 1, opts.kind);
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastErr instanceof Error ? lastErr : new RecoveryTimeoutError(opts.kind, opts.timeoutMs, retries + 1);
}

/** Wrap a plain promise (no abort support) with a timeout race. */
export async function withRecoveryTimeoutPromise<T>(
  promise: Promise<T>,
  opts: {
    kind: RecoveryTimeoutKind;
    timeoutMs: number;
    retries?: number;
    onRetry?: (attempt: number, kind: RecoveryTimeoutKind) => void;
  },
): Promise<T> {
  return withRecoveryTimeout(async (signal) => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  }, opts);
}

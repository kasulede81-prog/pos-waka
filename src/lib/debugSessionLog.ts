/** Debug-mode telemetry (session 3f94a8). Never log secrets or PII. */
const INGEST =
  "http://127.0.0.1:7788/ingest/e933399f-6dde-47b8-8b0c-2cbd1b16e2ed";
const SESSION_ID = "3f94a8";
const STORAGE_KEY = "waka.debug.3f94a8";

export type DebugLogPayload = {
  location: string;
  message: string;
  data?: Record<string, unknown>;
  hypothesisId?: string;
  runId?: string;
};

export function debugSessionLog(payload: DebugLogPayload): void {
  const entry = {
    sessionId: SESSION_ID,
    timestamp: Date.now(),
    ...payload,
  };
  try {
    const prev = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]") as unknown[];
    const next = [...(Array.isArray(prev) ? prev : []), entry].slice(-80);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  // #region agent log
  fetch(INGEST, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": SESSION_ID },
    body: JSON.stringify(entry),
  }).catch(() => {});
  // #endregion
}

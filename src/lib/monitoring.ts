/**
 * Production-safe diagnostics: never show raw errors to shop staff in the UI.
 * Optional: send minimal events to your own ingest endpoint (no PII, no secrets).
 *
 * Set `VITE_MONITORING_INGEST_URL` to an HTTPS endpoint that accepts POST JSON.
 * Service role keys must never appear in the browser — only anon keys in Vite env.
 */

export type MonitoringCategory = "sync" | "auth" | "pwa" | "app";

export type MonitoringPayload = {
  category: MonitoringCategory;
  /** Stable code for dashboards, e.g. sync_flush_error */
  code: string;
  /** Optional coarse detail safe for logs (no passwords, tokens, or emails) */
  meta?: Record<string, string | number | boolean | null | undefined>;
};

function sanitizeMeta(meta?: MonitoringPayload["meta"]): Record<string, string | number | boolean> | undefined {
  if (!meta) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function reportMonitoringEvent(payload: MonitoringPayload): void {
  const safe = { ...payload, meta: sanitizeMeta(payload.meta) };

  if (import.meta.env.DEV) {
    console.warn("[waka-monitoring]", safe.category, safe.code, safe.meta ?? {});
  }

  const url = import.meta.env.VITE_MONITORING_INGEST_URL?.trim();
  if (!url || typeof fetch === "undefined") return;

  const body = JSON.stringify({
    ...safe,
    env: import.meta.env.MODE,
    ts: new Date().toISOString(),
  });

  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    mode: "cors",
  }).catch(() => {
    /* never block UI */
  });
}

export function reportSyncIssue(code: string, meta?: MonitoringPayload["meta"]): void {
  reportMonitoringEvent({ category: "sync", code, meta });
}

export function reportAuthIssue(code: string, meta?: MonitoringPayload["meta"]): void {
  reportMonitoringEvent({ category: "auth", code, meta });
}

export function reportPwaIssue(code: string, meta?: MonitoringPayload["meta"]): void {
  reportMonitoringEvent({ category: "pwa", code, meta });
}

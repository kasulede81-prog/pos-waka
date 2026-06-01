/**
 * Production crash and error monitoring (Sentry).
 * Disabled when VITE_SENTRY_DSN is unset — safe for local dev without keys.
 */

import * as Sentry from "@sentry/react";
import { Capacitor } from "@capacitor/core";

export type CrashContext = {
  userId?: string | null;
  shopId?: string | null;
  email?: string | null;
};

let initialized = false;

function sentryEnvironment(): string {
  const explicit = import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim();
  if (explicit) return explicit;
  const mode = import.meta.env.MODE;
  if (mode === "production") return "production";
  if (mode === "staging") return "staging";
  return "development";
}

function appRelease(): string {
  const version = import.meta.env.VITE_APP_VERSION?.trim() || "0.0.0";
  return `pos-waka@${version}`;
}

export function isCrashReportingEnabled(): boolean {
  return Boolean(import.meta.env.VITE_SENTRY_DSN?.trim());
}

/** Call once at app startup (before React render). */
export function initCrashReporting(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (!dsn || initialized) return;

  Sentry.init({
    dsn,
    environment: sentryEnvironment(),
    release: appRelease(),
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
    ],
    tracesSampleRate: sentryEnvironment() === "production" ? 0.1 : 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: sentryEnvironment() === "production" ? 0.25 : 0,
    beforeSend(event) {
      if (import.meta.env.DEV && !import.meta.env.VITE_SENTRY_DEBUG) {
        return null;
      }
      return event;
    },
  });

  Sentry.setTag("platform", Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web");
  initialized = true;
}

export function setCrashReportingUser(ctx: CrashContext): void {
  if (!initialized) return;
  if (!ctx.userId && !ctx.email) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({
    id: ctx.userId ?? undefined,
    email: ctx.email ?? undefined,
  });
  if (ctx.shopId) Sentry.setTag("shop_id", ctx.shopId);
}

export function captureAppException(error: unknown, extras?: Record<string, string | number | boolean>): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (extras) {
      for (const [k, v] of Object.entries(extras)) {
        scope.setExtra(k, v);
      }
    }
    Sentry.captureException(error);
  });
}

export function captureAppMessage(
  message: string,
  level: Sentry.SeverityLevel = "warning",
  extras?: Record<string, string | number | boolean>,
): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (extras) {
      for (const [k, v] of Object.entries(extras)) {
        scope.setExtra(k, v);
      }
    }
    Sentry.captureMessage(message, level);
  });
}

export function installGlobalErrorHandlers(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("unhandledrejection", (event) => {
    const err = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    captureAppException(err, { kind: "unhandledrejection" });
    if (!isCrashReportingEnabled()) {
      void import("./monitoring")
        .then(({ reportMonitoringEvent }) =>
          reportMonitoringEvent({
            category: "app",
            code: "unhandledrejection",
            meta: { message: err.message.slice(0, 120) },
          }),
        )
        .catch(() => undefined);
    }
  });

  window.addEventListener("error", (event) => {
    if (event.error) {
      captureAppException(event.error, { kind: "window_error" });
    }
  });
}

export { Sentry };

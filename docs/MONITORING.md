# Waka POS — Production Monitoring Setup

## Overview

Waka POS sends production errors through two optional channels:

1. **Sentry** (`@sentry/react`) — crashes, unhandled rejections, sync/auth events with user/shop context
2. **Custom ingest** (`VITE_MONITORING_INGEST_URL`) — lightweight JSON events from `reportMonitoringEvent()`

Both are **opt-in via environment variables**. Local development works without any keys.

## Environment separation

| Environment | Vite mode | `VITE_SENTRY_ENVIRONMENT` | Build command |
|-------------|-----------|---------------------------|---------------|
| Development | `development` | `development` (default) | `npm run dev` |
| Staging | `staging` | `staging` | `npm run build:staging` |
| Production | `production` | `production` | `npm run build` |

Copy `.env.example` → `.env.production.local` (or staging/development) and set:

```env
VITE_SENTRY_DSN=https://YOUR_KEY@o000.ingest.sentry.io/PROJECT_ID
VITE_SENTRY_ENVIRONMENT=production
VITE_APP_VERSION=1.0.4
```

Optional custom ingest:

```env
VITE_MONITORING_INGEST_URL=https://your-ingest.example.com/events
```

## Sentry project setup

1. Create three Sentry projects (or one project with environment tags):
   - `waka-pos-dev`
   - `waka-pos-staging`
   - `waka-pos-production`

2. Add the DSN to the matching `.env.*.local` file.

3. Configure release tracking:
   - Releases are tagged `pos-waka@VERSION` from `VITE_APP_VERSION`
   - Upload source maps in CI (optional) for readable stack traces

4. Enable alerts:
   - New issue → Slack/email
   - Spike in `sync` category → page on-call

## What is captured

| Event | Source | Tags / context |
|-------|--------|----------------|
| Unhandled exceptions | `window.error` | platform, release, environment |
| Unhandled promise rejections | `unhandledrejection` | same |
| Sync failures | `reportSyncIssue()` → Sentry message | category=sync, code |
| Auth issues | `reportAuthIssue()` | category=auth |
| PWA/service worker errors | `reportPwaIssue()` | category=pwa |

After sign-in, `useAuth` sets:

- `user.id`
- `user.email`
- `shop_id` tag (from primary organization)

## Files

| File | Role |
|------|------|
| `src/lib/crashReporting.ts` | Sentry init, global handlers, user context |
| `src/lib/monitoring.ts` | Existing ingest + forwards to Sentry |
| `src/main.tsx` | Calls `initCrashReporting()` at startup |
| `src/hooks/useAuth.ts` | Sets user/shop on session change |

## Verification procedure

1. Set `VITE_SENTRY_DSN` and `VITE_SENTRY_DEBUG=true` in `.env.development.local`
2. Run `npm run dev`
3. In browser console: `throw new Error("sentry test")`
4. Confirm event appears in Sentry within 60 seconds
5. Sign in → verify user ID and `shop_id` tag on next event

## Android native crashes

The current integration captures **JavaScript/WebView errors** in the Capacitor shell.

For **native JVM crashes** (outside the WebView), add `@sentry/capacitor` and Gradle plugin in a follow-up — document in Android release checklist.

## Privacy

- No passwords, tokens, or service role keys are sent
- `monitoring.ts` sanitizes meta to string/number/boolean only
- Sentry replay is disabled for normal sessions; 25% sample on errors in production

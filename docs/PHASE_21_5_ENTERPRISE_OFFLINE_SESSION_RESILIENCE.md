# Phase 21.5 — Enterprise Offline Session Resilience

Production fix for the P0 regression certified in Phase 21.3: owners logged out after temporary loss of internet or slow `getSession()` on Android resume.

**Scope:** Offline session resilience only. Authentication architecture, Supabase integration, login, registration, staff auth, device activation, Shop Security PIN, permissions, subscription engine, and storage schemas are unchanged.

---

## Before vs after

### Before (Phase 21.3 certified regression)

```
Owner login
  → Supabase session
  → Internet lost / app background
  → App resume
  → getSession() 6s timeout
  → applyAccountSwitchSync(null)
  → User appears logged out
```

### After (Phase 21.5)

```
Owner login
  → Authenticated
  → Offline / slow getSession
  → Read cached session from localStorage
  → Keep authenticated locally
  → Background refresh with backoff when online
  → Authenticated (session updated)
```

Logout occurs **only** when:

- User presses **Sign Out**, or
- Server confirms session invalid (revoked refresh token / invalid grant)

Never because of timeout or transient connectivity.

---

## Session lifecycle

| Stage | Behavior |
|-------|----------|
| Login | Supabase persists session to `localStorage` (`*-auth-token`) as today |
| Startup | `resolveStartupSession()` calls `getSession()` with 6s cap |
| Timeout / offline | Falls back to `readPersistedSupabaseSession()` |
| Cached restore | `applySupabaseSession()` — account key + React session preserved |
| Online again | `waka:network-online`, visibility resume, Capacitor `appStateChange` trigger refresh |
| Refresh success | Session updated, connection state → `online` |
| Refresh revoked | Confirmed logout via `onSessionRevoked` |
| Manual sign out | `explicitSignOutRef` — SIGNED_OUT never deferred |

---

## Offline state machine

```
                    ┌─────────────┐
                    │   online    │
                    └──────┬──────┘
                           │ getSession timeout / offline
                           ▼
              ┌────────────────────────┐
              │    offline_cached      │◄──┐
              └───────────┬────────────┘   │ refresh postponed
                          │ reconnect      │
                          ▼                │
              ┌────────────────────────┐   │
              │     reconnecting       │───┘
              └───────────┬────────────┘
                          │ refresh OK
                          ▼
                    ┌─────────────┐
                    │   online    │
                    └─────────────┘

Logout transitions (only):
  • explicit Sign Out
  • refresh returns invalid_grant / refresh_token_not_found / session_not_found
```

Connection state is exposed via `sessionConnectionState.ts` and shown in the AppShell sync strip:

- **Offline — working locally**
- **Reconnecting session…**

---

## Retry strategy

Exponential backoff in `offlineSessionResilience.ts`:

| Attempt | Delay |
|---------|-------|
| 1 | 1 s |
| 2 | 5 s |
| 3 | 15 s |
| 4 | 30 s |
| 5+ | 60 s |

While retrying, the user stays authenticated. No logout UI during retries.

Triggers:

- Cached session restore at startup
- Deferred `SIGNED_OUT` when cache remains restorable
- `waka:network-online` custom event
- Document `visibilitychange` (web resume)
- Capacitor `App.addListener('appStateChange')` (Android/iOS resume)

---

## Android lifecycle

| Event | Action |
|-------|--------|
| Pause / background | No session clear |
| Resume (`appStateChange`) | Schedule refresh retry if owner session exists |
| Process recreation | Startup reads cached session if `getSession` slow |
| Capacitor network listener | Existing `waka:network-online` triggers refresh |

Resume never forces logout solely because refresh failed while offline.

---

## Diagnostics

Structured console events (no tokens, passwords, or secrets):

```
[waka-auth] session_restore { source: 'cached', offline: true, reason: 'getSession_timeout' }
[waka-auth] refresh_postponed { offline: true }
[waka-auth] refresh_scheduled { delayMs: 1000, attempt: 1 }
[waka-auth] refresh_attempt { attempt: 1 }
[waka-auth] refresh_succeeded { userId: '…' }
[waka-auth] signed_out_deferred { offline: true }
[waka-auth] session_revoked_confirmed
```

---

## Implementation map

| File | Role |
|------|------|
| `src/lib/offlineSessionResilience.ts` | Cached read, startup resolution, refresh backoff |
| `src/lib/sessionConnectionState.ts` | Pub/sub connection state for UI |
| `src/hooks/useSessionConnectionState.ts` | React hook for sync strip |
| `src/hooks/useAuth.ts` | finishInit, SIGNED_OUT deferral, lifecycle hooks |
| `src/components/layout/AppShellSyncLabel.tsx` | Offline / reconnecting UX |
| `src/lib/offlineSessionResilience.test.ts` | Regression scenarios 1–6 |

---

## Regression matrix

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Login → offline → resume | Authenticated via cached session |
| 2 | Slow getSession → timeout | Keep cached session |
| 3 | Reconnect → refresh succeeds | Session updated, state `online` |
| 4 | Token revoked | Logout confirmed |
| 5 | Manual sign out | Logout, no deferral |
| 6 | Android background → resume | No logout while cache valid |

---

## Verification checklist

- [ ] Owner login, enable airplane mode, background app, resume — still authenticated
- [ ] Slow network cold start — no redirect to login when cache exists
- [ ] Restore network — sync strip shows reconnecting then online; session refresh succeeds
- [ ] Sign out — immediate logout
- [ ] Revoked refresh token (test env) — logout after confirmed refresh failure
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] No changes to login, registration, staff auth, or Supabase client config

---

## Related

- Phase 21.3 certification: `docs/PHASE_21_3_ENTERPRISE_PRODUCTION_STABILITY_CERTIFICATION.md` (Issue E)
- Root cause: `useAuth.finishInit` treating `getSession()` timeout as logout

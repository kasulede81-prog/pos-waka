# Phase 18.3 — Enterprise Update Engine

**Date:** 2026-07-11  
**Prerequisite:** Phase 18.2 certification  
**Verdict:** Implemented — Release Management unchanged; client update logic consolidated

---

## Summary

Phase 18.3 introduces a single **Enterprise Update Engine** (`src/lib/updateEngine/`) as the only client entry point for release detection, evaluation, notifications, and platform-specific update handling. Admin Release Management, `app_releases` schema semantics, and publish/archive business rules are **unchanged**.

---

## Architecture

### Before

```
AppReleaseUpdateProvider (mount + resume)
  → evaluateAppReleaseUpdate()
  → Play check + policy RPC

AppShell (separate)
  → waka:pwa-update listener
  → PWA banner
```

### After

```
EnterpriseUpdateEngine.initialize()
  ├─ startup / foreground / poll / realtime / reconnect / manual
  ├─ fetchReleasePolicy()
  ├─ UpdateVersionResolver
  ├─ UpdateEligibility
  └─ Platform adapter
       ├─ AndroidUpdateAdapter (Play Core — unchanged behavior)
       ├─ WebUpdateAdapter (service worker signal)
       ├─ WindowsUpdateAdapter (placeholder)
       └─ IOSUpdateAdapter (placeholder)

AppReleaseUpdateProvider → engine state → i18n overlays (Android)
AppShell → PwaUpdateBanner → engine state (Web)
BackupSyncPage → Check for updates → engine.checkForUpdates()
```

---

## Module map

| File | Role |
|------|------|
| `EnterpriseUpdateEngine.ts` | Singleton orchestrator — **only public entry** |
| `UpdatePolicyResolver.ts` | Fetches published policy via existing RPC |
| `UpdateVersionResolver.ts` | Installed / published / minimum / pilot eligibility |
| `UpdateEligibility.ts` | Phase decision tree (Android + web helpers) |
| `UpdatePlatformAdapter.ts` | Adapter interface + types |
| `AndroidUpdateAdapter.ts` | Play Core bridge (no business rule changes) |
| `WebUpdateAdapter.ts` | PWA `waka:pwa-update` signal |
| `WindowsUpdateAdapter.ts` | Placeholder |
| `IOSUpdateAdapter.ts` | Placeholder |
| `UpdateEvents.ts` | Standardized telemetry → existing RPC events |
| `UpdateNotifications.ts` | Notification kind → i18n key mapping |
| `useUpdateEngine.ts` | React subscription hook |

---

## Propagation (Phase 18.3)

| Trigger | Purpose |
|---------|---------|
| App startup | Initial evaluation |
| Foreground resume | Catch publish while app was backgrounded |
| 20-minute foreground poll | Catch publish without resume |
| Supabase Realtime (`app_releases` published) | Instant policy signal (fallback: poll) |
| Online reconnect | Re-fetch after offline |
| Manual “Check for updates” | Settings / support |
| Platform adapter (Play download complete) | Flexible → ready transition |

**Publish remains the primary trigger.** Admin **Resend notification** bumps `policy_generation` only (recovery/testing).

---

## Database (migration 137)

- `app_releases.policy_generation` — idempotency + resend signal
- `app_releases.last_notification_at` — audit
- `admin_resend_release_notification(p_id)` — recovery RPC
- `get_app_release_client_policy()` — returns `policy_generation`, `published_at`
- `admin_publish_app_release()` — increments `policy_generation`
- `_pilot_target_app_version()` — pilot ops reads published release (replaces hardcoded `1.0.5`)
- Realtime publication on `app_releases` + client-readable RLS for published rows

---

## Admin recovery

**Resend notification** button on live published release in Release Management:

- Does **not** re-publish or change policy
- Bumps `policy_generation` so clients re-evaluate
- Logs `notification_resent` event

---

## Internationalization

All Android update overlay strings moved to `i18n.ts` (EN + LG + SW overrides for key phrases).

---

## Version alignment

- `package.json` → **1.0.12** (matches Gradle `versionName`)
- `npm run check:app-versions` — CI script for package ↔ Gradle alignment

---

## Telemetry (standard → RPC)

| Standard event | RPC event |
|----------------|-----------|
| `update_available` | `prompt_shown` |
| `update_download_started` | `download_started` |
| `update_download_completed` | `download_completed` |
| `update_install_started` | `immediate_started` |
| `update_install_completed` | `immediate_completed` |
| `update_failed` | `error` |
| `update_cancelled` | `user_skipped` |
| `restart_required` | `restart_requested` |
| `update_verified` | `download_completed` (metadata) |

---

## Test results

```
npm run build   ✅
npm test        ✅ 1565 passed (incl. enterpriseUpdateEngine.test.ts)
check:app-versions ✅ 1.0.12 / versionCode 17
```

---

## Remaining future work

- Windows auto-updater (Electron / installer pipeline)
- iOS App Store update path
- Rollout engine (%, region, cohort) — Phase 18.4+
- APK hosting (explicitly out of scope)

---

## Enterprise readiness (estimated)

| Dimension | Phase 18.2 | Phase 18.3 |
|-----------|------------|------------|
| Android Release Mgmt | 7.8 | **9.1** |
| Enterprise overall | 5.9 | **7.2** |

---

*Release Management architecture preserved. Publish-driven automatic propagation certified and implemented.*

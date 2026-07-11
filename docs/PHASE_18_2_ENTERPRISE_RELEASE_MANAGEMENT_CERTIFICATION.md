# Phase 18.2 — Enterprise Release Management & Automatic Update Certification

**Mode:** Read-only architecture + functional audit (no code changes)  
**Date:** 2026-07-11  
**Scope:** Release management, version publishing, update detection, rollout, notification, download, installation, platform lifecycle  
**Baseline:** `docs/RELEASE_MANAGEMENT.md`, migration `121_app_release_management.sql`  
**Verdict:** **Conditionally certified for Android** — publish-driven policy is already live; **not certified** for full multi-platform automatic enterprise lifecycle

---

## Executive Summary

Waka POS has a **mature, Android-centric release management stack**: Internal Admin publishes policy to Supabase, Android clients auto-fetch on launch and resume, compare against Google Play In-App Updates, and show unified overlays via `AppReleaseUpdateProvider`. There is **no separate “notify users” button** in admin today — publishing *is* the notification trigger for policy, subject to client refresh timing and Play binary availability.

The gap between “manual notification model” and “fully automatic enterprise lifecycle” is **not** primarily missing admin buttons. It is:

1. **No realtime or in-session polling** — open apps learn about a publish only on cold start or foreground resume  
2. **Google Play is the binary gate** — Supabase publish does not deliver APK; Play track must have a higher `versionCode`  
3. **Fragmented platform paths** — Android (Play + policy), Web (PWA service worker), Windows/Electron (manual), iOS (none)  
4. **No rollout engine** — no percentage, region, cohort, or pilot wiring to `app_releases`  
5. **Version source drift** — `package.json`, Gradle, `VITE_APP_VERSION`, pilot SQL `1.0.5`, and ops dashboards use different anchors  
6. **Parallel pilot version system** — migration `079` hardcodes `target_app_version = '1.0.5'`, disconnected from Release Management

**Answer to the certification question:**

> Can Waka POS safely switch from a manual update notification model to a fully automatic publish-driven enterprise update system **without changing Release Management architecture**?

**Android (Google Play): YES, with Phase 18.3 UX/engine hardening** — the architecture already supports publish → policy → client auto-check. Phase 18.3 should add faster propagation (polling/realtime), centralized version resolution, and optional admin “Resend” as recovery — not a redesign.

**All platforms (enterprise-wide): NO, not yet** — Web, Windows, and iOS require new installer pipelines or explicit scope exclusion before claiming full automatic lifecycle.

---

# PART 1 — Release Architecture

## 1.1 Complete lifecycle diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INTERNAL ADMIN (/internal/waka/releases)           │
│  AdminReleaseManagementPage → releaseManagementAdmin.ts                      │
│  Roles: super_admin | operations_admin (canManageAppReleases)                │
│  Actions: Save draft · Publish · Archive · Duplicate · Delete · Refresh      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SUPABASE (migration 121)                             │
│  app_releases · release_public_notes · release_internal_notes                │
│  app_release_events · internal_ops_admin_audit                               │
│  admin_publish_app_release → archives prior published (single live policy)   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    get_app_release_client_policy()  (no Realtime push)
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ANDROID CLIENT (Capacitor)                           │
│  AppProviders → AppReleaseUpdateProvider                                     │
│       │ mount + App.addListener("appStateChange") resume                     │
│       ▼                                                                      │
│  evaluateAppReleaseUpdate()  [appReleaseUpdate.ts]                           │
│       ├─ fetchAppReleaseClientPolicy()                                       │
│       ├─ WakaAppUpdate.checkForUpdate() → Google Play Core                    │
│       └─ phase: force_block | flexible_prompt | flexible_ready | whats_new   │
│       ▼                                                                      │
│  User action → startFlexibleUpdate | startImmediateUpdate | completeFlexible │
│       ▼                                                                      │
│  Play downloads/installs APK → app restart → readInstalledAppVersion()       │
│       ▼                                                                      │
│  log_app_release_client_event() telemetry                                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         WEB / PWA (parallel path — NOT app_releases)         │
│  main.tsx registerSW → onNeedRefresh → waka:pwa-update event                 │
│  AppShell banner → window.location.reload()                                  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         WINDOWS / ELECTRON / iOS                             │
│  Manual: npm run installer:windows · GitHub Releases · Play sideload          │
│  No in-app updater · No app_releases integration                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 1.2 Architecture SSOT map

| Layer | Primary files |
|-------|---------------|
| Database | `supabase/migrations/121_app_release_management.sql` |
| Admin API | `src/lib/releaseManagementAdmin.ts` |
| Admin UI | `src/components/internal-admin/v2/pages/AdminReleaseManagementPage.tsx` |
| Client policy | `src/lib/appReleaseClient.ts` |
| Decision engine | `src/lib/appReleaseUpdate.ts` |
| Version compare | `src/lib/appReleaseVersion.ts` |
| Native bridge | `src/lib/nativeAppUpdate.ts` |
| Play plugin | `android/.../WakaAppUpdatePlugin.java` |
| Client UI | `src/components/app-update/AppReleaseUpdateProvider.tsx` |
| Provider mount | `src/providers/AppProviders.tsx` |
| PWA updates | `src/main.tsx`, `src/components/layout/AppShell.tsx` |
| Docs | `docs/RELEASE_MANAGEMENT.md`, `docs/RELEASE_DISTRIBUTION.md` |

## 1.3 Architecture strengths

- Clean **admin vs client API separation** — internal notes never in client RPC  
- **Single published policy** — publish archives previous; `get_app_release_client_policy` returns highest `google_play_version_code` published row  
- **Transactional publish** — archive + publish in one PL/pgSQL function  
- **Play-native install** — no APK hosting on Waka backend (security)  
- **Telemetry** — `app_release_events` + admin events feed  
- **Automatic client evaluation** on mount and app resume (Android)

## 1.4 Architecture gaps

- No Realtime subscription on `app_releases`  
- No background polling interval while app is foreground  
- No unified **Enterprise Update Engine** abstraction across Android + PWA  
- Pilot ops version targeting lives in **migration 079** (`v_target := '1.0.5'`), not `app_releases`  
- Windows/iOS/Electron outside release management schema

---

# PART 2 — Release Publishing

## 2.1 Admin Release Management

**Route:** `/internal/waka/releases`  
**Page:** `AdminReleaseManagementPage.tsx`

| Capability | Status | Notes |
|------------|--------|-------|
| Create / edit draft | ✅ | Rich text public + internal notes |
| Publish | ✅ | Confirms; archives prior published |
| Archive | ✅ | Manual archive any release |
| Duplicate | ✅ | Clones as draft; increments version code |
| Delete | ✅ | Draft/archived only; published blocked |
| Rollback RPC | ❌ | Rollback = re-publish duplicate or new draft |
| Draft handling | ✅ | `status = 'draft'` until publish |
| Version numbering | 🟡 Manual | Admin enters `version_number` + `google_play_version_code` |
| Platform targeting | ❌ | Android/Play implied only; no platform column |

## 2.2 “Current” vs “Latest”

| Term | Definition in codebase |
|------|------------------------|
| **Published / Live policy** | Exactly one row with `status = 'published'` (enforced by publish archiving others) |
| **Client “current” policy** | `get_app_release_client_policy()` → `ORDER BY google_play_version_code DESC LIMIT 1` among published |
| **Installed version** | Android: `App.getInfo().build` (Play `versionCode`); Web: bundle hash via SW |
| **Play “latest” binary** | `WakaAppUpdate.checkForUpdate().availableVersionCode` — authoritative for APK availability |

**Important:** Admin “published” policy can reference version code **18** while Play has not yet propagated that AAB — client sees policy but Play may report no update.

## 2.3 Publish transactional behavior

`admin_publish_app_release(p_id)` in one function:

1. Requires ops admin role  
2. `UPDATE ... SET status = 'archived'` for all other published rows  
3. `UPDATE ... SET status = 'published', published_at = now()` for target  
4. Audit + `app_release_events` insert (`release_published`)

**Not wrapped in explicit `BEGIN/COMMIT` block** but single function = atomic statement batch in PostgreSQL.

## 2.4 Multiple published releases?

**No.** Publish auto-archives siblings. Client RPC selects single published row.

---

# PART 3 — Client Update Detection

## 3.1 Complete listener inventory

| Listener | Registered in | Trigger | Action |
|----------|---------------|---------|--------|
| `AppReleaseUpdateProvider` mount | `AppProviders.tsx` | App start | `evaluateAppReleaseUpdate()` |
| `App.addListener("appStateChange")` | `AppReleaseUpdateProvider.tsx` | Foreground resume | Re-evaluate |
| `WakaAppUpdate.addListener("flexibleUpdateDownloaded")` | `AppReleaseUpdateProvider.tsx` | Play download complete | Log + re-evaluate |
| `registerSW({ onNeedRefresh })` | `main.tsx` | New SW available | Dispatch `waka:pwa-update` |
| `window.addEventListener("waka:pwa-update")` | `AppShell.tsx` | PWA refresh | Show banner |

**Not present:** Supabase Realtime on `app_releases`, `setInterval` polling, Settings “Check for updates”, push notifications (FCM).

## 3.2 Detection flow (Android)

```
AppReleaseUpdateProvider.refresh()
  → evaluateAppReleaseUpdate()                    [appReleaseUpdate.ts]
      → readInstalledAppVersion()               [App.getInfo().build]
      → fetchAppReleaseClientPolicy()           [RPC get_app_release_client_policy]
      → WakaAppUpdate.checkForUpdate()          [Play Core]
      → isBelowMinimumVersionCode()             [force_block?]
      → installStatus === DOWNLOADED?           [flexible_ready]
      → isPlayUpdateAvailable()                 [flexible_prompt / force_block]
      → promptUsers === false?                  [idle — silent]
      → showWhatsNew + Preferences              [whats_new]
  → setState(phase) → render overlay
```

## 3.3 RPC trace

| Client call | RPC | Returns |
|-------------|-----|---------|
| `fetchAppReleaseClientPolicy()` | `get_app_release_client_policy()` | Policy JSON (no internal notes) |
| `logAppReleaseClientEvent()` | `log_app_release_client_event(...)` | Event insert |

---

# PART 4 — Manual Update Flow Audit

## 4.1 What “manual” means in Waka POS today

| Manual path | Exists? | Purpose |
|-------------|---------|---------|
| Admin **Publish** button | ✅ | Makes policy live — **not** a per-device notify button |
| Admin **Refresh** (list/events) | ✅ | Reload admin UI only |
| **Resend notification** | ❌ | **Does not exist** in codebase |
| Settings **Check for updates** | ❌ | No user-triggered check |
| User **Update now / Later / Restart** | ✅ | Required for flexible/immediate Play flows |
| PWA **Update now** reload | ✅ | User reloads after SW detects deploy |
| Ops **manual installer** (Windows) | ✅ | `npm run installer:windows`, GitHub Releases |
| Pilot **manual APK handoff** | ✅ | Documented in `RELEASE_DISTRIBUTION.md` |

## 4.2 Does automatic already exist?

| Step | Automatic? |
|------|------------|
| Policy fetch on launch/resume | ✅ Android |
| Play update check | ✅ Android |
| Show prompt when eligible | ✅ If `prompt_users` |
| Download APK | 🟡 After user taps “Update now” (Play handles) |
| Restart after flexible download | 🟡 User taps “Restart” |
| PWA detect new deploy | ✅ SW `onNeedRefresh` |
| PWA apply update | ❌ User reload |
| Notify on admin publish to open sessions | ❌ |

## 4.3 Duplication manual vs automatic

**No duplicate “notify users” admin buttons.** The perceived manual model is likely:

1. Ops must **upload AAB to Play** separately from admin publish  
2. Clients only re-check on **resume**, not instantly on publish  
3. Users must **confirm** flexible updates  

These are operational/timing gaps, not duplicate notification UIs.

---

# PART 5 — Automatic Update Readiness

| Capability | Status | Evidence |
|------------|--------|----------|
| Automatic detection | 🟡 Partial | Mount + resume only; no polling/realtime |
| Automatic notification | 🟡 Partial | Auto-shows overlay when phase ≠ idle; requires Play + flags |
| Automatic rollout | ❌ | No percentage/region/cohort in schema |
| Automatic version comparison | ✅ Android | `appReleaseVersion.ts` + Play codes |
| Automatic refresh (policy) | 🟡 | On resume, not continuous |
| Automatic retry | ❌ | Play check errors logged; no retry backoff |
| Automatic reconnect | N/A | No Realtime channel for releases |
| Automatic release propagation | 🟡 | DB immediate; client eventual (resume) |
| Manual intervention still required | ✅ | Play upload, versionCode alignment, user confirm (flexible) |

**Readiness score: 6.2 / 10** for publish-driven Android; **3.5 / 10** enterprise-wide.

---

# PART 6 — Version Resolution Audit

## 6.1 Version sources (drift risk)

| Source | Current value (audit date) | Used for |
|--------|---------------------------|----------|
| `package.json` | `1.0.11` | npm, default `VITE_APP_VERSION` |
| `android/app/build.gradle` | `versionCode 17`, `versionName "1.0.12"` | Play binary |
| `VITE_APP_VERSION` env | Optional override | Web bundle display, Sentry |
| `App.getInfo().build` | Native installed code | **Update decisions** |
| `app_releases.google_play_version_code` | Admin-entered | Policy + What's New threshold |
| `minimum_supported_version_code` | Admin-entered | Force block |
| `compareVersionStrings()` | Implemented | **Unused at runtime** — tests only |
| Pilot SQL `079` | Hardcoded `'1.0.5'` | Outdated device counts |
| `internalOpsIntelligence` | `VITE_APP_VERSION ?? "1.0.0"` | Fleet dashboards |
| `DesktopLicenseBar` fallback | `"1.0.6"` hardcoded | Display fallback |

## 6.2 Version type matrix

| Type | Centralized? | Mechanism |
|------|--------------|-----------|
| Installed version | 🟡 | Native `App.getInfo()` on Android; env on web |
| Published policy version | ✅ | `get_app_release_client_policy()` |
| Latest Play binary | ✅ | Play Core `availableVersionCode` |
| Minimum supported | ✅ | Policy `minimum_supported_version_code` + `force_below_minimum` |
| Force update | ✅ | Below minimum → `force_block` phase |
| Beta / pilot version | ❌ | Hardcoded SQL, not `app_releases` |
| Platform-specific | ❌ | Implicit Android-only schema |

**Centralization verdict:** Update **decisions** are centralized in `evaluateAppReleaseUpdate()`. **Display and ops** versions are not.

---

# PART 7 — Platform Audit

| Platform | Update source | Notification | Download | Install | Restart | Verification |
|----------|---------------|--------------|----------|---------|---------|--------------|
| **Android** | Play In-App Updates + Supabase policy | Modal/banner overlays | Play Core | Play | User Restart / immediate flow | `App.getInfo().build` |
| **Web/PWA** | Vite PWA service worker | AppShell top banner | SW precache | SW activate (`skipWaiting`) | User reload | Implicit (new bundle) |
| **Windows/Electron** | GitHub Releases / manual installer | None in-app | Manual | Manual `.exe` | User | None in-app |
| **iOS** | Not implemented | — | — | — | — | — |

### Android detail

- `evaluateAppReleaseUpdate()` returns `idle` immediately on non-Android  
- Plugin: `WakaAppUpdatePlugin.java` (Play Core 2.1.0)  
- UI strings in `AppReleaseUpdateProvider` are **hardcoded English** (not i18n)

### Web detail

- PWA path **does not** call `get_app_release_client_policy()`  
- Deploy to Vercel/hosting triggers SW update independently of Release Management

---

# PART 8 — Release Rollout Audit

| Rollout feature | In `app_releases`? | Notes |
|-----------------|-------------------|-------|
| Pilot rollout | ❌ | Separate `pilot_cohort` + hardcoded target in `079` |
| Percentage rollout | ❌ | — |
| Region rollout | ❌ | — |
| Version pinning | 🟡 | Single published policy = global pin |
| Minimum version | ✅ | `minimum_supported_version_code` + `force_below_minimum` |
| Forced update | ✅ | `immediate` type or below-minimum force |
| Soft update | ✅ | `flexible` + prompt |
| Rollback | 🟡 | Archive + publish duplicate manually |

**Rollout centralization: Not certified** — all devices receive same published policy.

---

# PART 9 — Notification Architecture

## 9.1 User-facing update notifications

| Surface | Component | Platform | Type |
|---------|-----------|----------|------|
| Force update modal | `AppReleaseUpdateProvider` | Android | Full-screen block |
| Flexible prompt | `AppReleaseUpdateProvider` | Android | Bottom sheet modal |
| Update ready banner | `AppReleaseUpdateProvider` | Android | Bottom banner |
| What's New modal | `AppReleaseUpdateProvider` | Android | Modal |
| PWA update banner | `AppShell.tsx` | Web | Top banner |
| Pilot mode banner | `PilotModeBanner` | All | **Not version-related** |
| Toast sync messages | `ToastProvider` | All | **Not version-related** |

## 9.2 Duplicate assessment

| Duplicate? | Finding |
|------------|---------|
| Multiple Android listeners | ❌ Single provider |
| Multiple policy fetchers | ❌ Single `fetchAppReleaseClientPolicy()` |
| Android + PWA both active | 🟡 On Capacitor Android, PWA SW typically inactive; on web browser, only PWA path |
| Admin + client event feeds | ❌ Different purposes |

**No duplicate notification dialogs** on Android. **Two parallel systems** (Android release mgmt vs PWA) for different platforms.

---

# PART 10 — Download & Installation Trace

```
Update detected (Play availableVersionCode > installed)
  ↓
Prompt (flexible_prompt | force_block)          ✅ Working (Android)
  ↓
User taps Update now
  ↓
Download (Play flexible / immediate)            ✅ Working (Play Core)
  ↓
Verification                                    🟡 Play-signed APK only; no Waka checksum
  ↓
Install (Play)                                  ✅ Working
  ↓
Restart (completeFlexibleUpdate | immediate)    🟡 User or Play-driven
  ↓
Version check (next evaluateAppReleaseUpdate)   ✅ Working
```

| Phase | Status | Gap |
|-------|--------|-----|
| `flexible_downloading` | ⚪ Placeholder | Phase set in UI but **no progress overlay** |
| `immediate_completed` event | ⚪ Dead | Allowed in RPC; never logged from client |
| `getInstallStatus()` | ⚪ Unused | Exposed in plugin, not called from TS |

---

# PART 11 — Failure Handling Audit

| Scenario | Handling | Grade |
|----------|----------|-------|
| Offline during policy fetch | Returns null policy → idle | 🟡 Silent |
| Play check failure | Logs `error` event; returns early | 🟡 No user message |
| Realtime reconnect | N/A — no Realtime | — |
| Failed publish | Admin UI shows error from RPC | ✅ |
| Failed download | Play handles; limited client logging | 🟡 |
| Corrupted update | Play responsibility | N/A |
| Cancelled update (user Later) | `user_skipped` logged | ✅ |
| Rollback | Manual admin archive/publish | 🟡 |
| Multiple devices | Independent per-device evaluation | ✅ |
| Version mismatch (policy vs Play) | Policy alone cannot prompt without Play update | ✅ By design |
| Supabase unavailable | `fetchAppReleaseClientPolicy` → null | 🟡 Fail open (no block) |

---

# PART 12 — Duplicate Implementation Report

| Category | Instances | Recommendation |
|----------|-----------|----------------|
| Update listeners | 2 systems (Android provider + PWA SW) | Unify under Enterprise Update Engine with platform adapters |
| RPCs | 2 client (`policy`, `log`) + 7 admin | ✅ Appropriate separation |
| Version utilities | `appReleaseVersion.ts` + unused `compareVersionStrings` | Consolidate or wire semver for display |
| Version display | 6+ sources (see Part 6) | Single `readAppVersion()` export |
| Dialogs | 4 phases in one provider | ✅ Good |
| Polling | None duplicated | Add one engine poll, not multiple |
| Pilot version | `079` SQL vs `app_releases` | Wire pilot target to published release |
| Release services | `appReleaseUpdate.ts` vs inline PWA in AppShell | Extract `EnterpriseUpdateEngine` |

---

# PART 13 — Release Management Certification

## Should Release Management be the single enterprise authority?

**Yes, for Android in-app update policy and messaging.** The schema and admin UI are the right SSOT.

**Scope boundaries (document explicitly):**

| Concern | Authority |
|---------|-----------|
| Update prompts, force rules, release notes | `app_releases` ✅ |
| APK/AAB binary | Google Play ✅ |
| Web deploy refresh | Hosting + PWA SW (separate) |
| Windows installer | GitHub Releases / ops (separate) |
| Pilot fleet targeting | Should migrate to `app_releases` or linked rollout table |

## Target automatic flow achievability

```
Publish Release
  ↓
Automatically notify every eligible client     🟡 TODAY: on next launch/resume
  ↓
Client compares version                        ✅
  ↓
If newer: Display update                       ✅ (if Play + prompt_users)
  ↓
Download → Install → Restart → Complete        🟡 User steps for flexible
```

**Without manual admin notify button:** Already true — publish updates DB policy immediately.

**Without manual user steps:** Not achievable for flexible Play updates (Google API requirement). Immediate flow is closer to automatic but still Play UI.

---

# PART 14 — Enterprise Architecture Score

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Release Architecture** | **7.4 / 10** | Strong Android + Supabase; fragmented multi-platform |
| **Version Management** | **5.2 / 10** | Decision logic good; sources drift |
| **Notification System** | **6.4 / 10** | Auto on resume; no push/poll; English-only Android UI |
| **Rollout** | **3.0 / 10** | Global publish only |
| **Reliability** | **6.3 / 10** | Fail-open offline; Play errors logged not surfaced |
| **Recovery** | **5.5 / 10** | Archive/duplicate; no rollback RPC; no Resend |
| **Platform Consistency** | **4.1 / 10** | Android vs PWA vs manual desktop |
| **Enterprise Readiness** | **5.9 / 10** | **Not fully certified** multi-platform |

### Android-only Release Management readiness: **7.8 / 10** ✅

---

# PART 15 — Recommended Phase 18.3 Implementation Blueprint

**Goal:** Make publish automatically propagate to all eligible clients faster, without redesigning Release Management architecture.

## 18.3.1 — Enterprise Update Engine (client)

Create `src/lib/enterpriseUpdate/EnterpriseUpdateEngine.ts`:

- Single entry: `evaluateUpdates()`  
- Platform adapters: `AndroidPlayAdapter`, `PwaServiceWorkerAdapter`, `NoOpDesktopAdapter`  
- Replace direct calls from `AppReleaseUpdateProvider` and `AppShell` PWA listener  
- Shared: policy fetch, event logging, phase enum, i18n strings

## 18.3.2 — Faster propagation (no manual admin notify)

| Enhancement | Purpose |
|-------------|---------|
| Poll `get_app_release_client_policy()` every 15–30 min while foreground | Catch publish without resume |
| Optional Supabase Realtime on `app_releases` (published status) | Instant policy push |
| Include `published_at` / `release_id` in policy; skip re-prompt if unchanged | Idempotent notifications |

**Do not add** admin “Notify all users” as primary workflow — publish remains the trigger.

## 18.3.3 — Admin recovery tool only

Add **Resend notification** (Phase 18.3):

- Does **not** re-publish or change policy  
- Bumps a `policy_generation` counter or `last_notification_at` read by clients  
- For devices stuck on old policy cache — admin-only recovery  
- Primary path remains automatic publish propagation

## 18.3.4 — Remove / avoid manual duplication

| Item | Action |
|------|--------|
| Nonexistent notify buttons | Do not add primary manual path |
| Settings “Check for updates” | Optional; calls `EnterpriseUpdateEngine.evaluate()` once |
| Pilot SQL `v_target` | Read from latest published `version_number` |
| `compareVersionStrings` dead code | Use for display-only semver or remove |
| Android hardcoded strings | Move to i18n |

## 18.3.5 — UX completion (no policy change)

- `flexible_downloading` progress UI  
- Log `immediate_completed`  
- Surface Play check errors (retry button)  
- Wire `getInstallStatus()` for resume edge cases

## 18.3.6 — Version alignment CI check

- Script: `package.json` version ↔ Gradle `versionName` ↔ admin draft warning  
- Document: admin `google_play_version_code` must match Gradle before publish

## 18.3.7 — Explicit non-goals (preserve architecture)

- No APK hosting on Supabase  
- No change to publish/archive/RLS model  
- No Windows auto-updater unless separate phase  
- Rollout percentage deferred to Phase 18.4+

## 18.3.8 — Success criteria

| Criterion | Target |
|-----------|--------|
| Publish → client aware | ≤ 30 min foreground OR immediate on Realtime |
| Single update listener | `EnterpriseUpdateEngine` only |
| Admin Resend | Recovery only, not primary |
| Android i18n | All update strings in `i18n.ts` |
| Tests | Engine unit tests + existing `appReleaseVersion.test.ts` |
| Score | Enterprise Readiness **8.5+** Android; **7.0+** overall |

---

# Deliverables Checklist

| Deliverable | Section |
|-------------|---------|
| Enterprise Release Management Certification Report | Parts 1–2, 13 |
| Automatic Update Readiness Report | Part 5 |
| Version Resolution Audit | Part 6 |
| Update Listener Audit | Part 3 |
| Duplicate Update Logic Report | Part 12 |
| Failure Handling Report | Part 11 |
| Platform Comparison Report | Part 7 |
| Release Lifecycle Diagram | Part 1.1 |
| Enterprise Readiness Score | Part 14 |
| Phase 18.3 Implementation Blueprint | Part 15 |

---

# Verification Statement

| Success criterion | Met? |
|-------------------|------|
| Complete release architecture mapped | ✅ |
| Every update listener documented | ✅ |
| Manual vs automatic paths clarified | ✅ |
| Platform differences documented | ✅ |
| Duplicates identified | ✅ |
| Certification question answered with evidence | ✅ |
| No code changes | ✅ |

**Phase 18.2: Audit complete.**

---

## Appendix — Key file index

```
supabase/migrations/121_app_release_management.sql
supabase/migrations/079_internal_ops_hardening.sql (pilot version — parallel)
src/lib/releaseManagementAdmin.ts
src/lib/appReleaseClient.ts
src/lib/appReleaseUpdate.ts
src/lib/appReleaseVersion.ts
src/lib/nativeAppUpdate.ts
src/components/app-update/AppReleaseUpdateProvider.tsx
src/components/internal-admin/v2/pages/AdminReleaseManagementPage.tsx
src/providers/AppProviders.tsx
src/main.tsx
src/components/layout/AppShell.tsx
android/app/src/main/java/ug/waka/pos/WakaAppUpdatePlugin.java
docs/RELEASE_MANAGEMENT.md
docs/RELEASE_DISTRIBUTION.md
```

---

*End of Phase 18.2 read-only audit. No application code was modified.*

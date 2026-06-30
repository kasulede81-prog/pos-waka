# Release Management

Production release policy for WakaPOS Android (Google Play In-App Updates) with Internal Admin control over prompts, force-update rules, and customer-facing release notes.

## Overview

| Layer | Responsibility |
|-------|----------------|
| **Google Play** | Distributes APK/AAB binaries only |
| **Internal Admin → Releases** | Update behavior, messaging, minimum version, public notes |
| **Backend (Supabase)** | Stores releases, enforces admin vs client API separation |
| **Android app** | Play In-App Updates API + policy fetch on launch |

Internal notes (migrations, security patches, API changes) are **never** exposed to mobile clients.

---

## Database

**Migration:** `supabase/migrations/121_app_release_management.sql`

### Tables

| Table | Purpose |
|-------|---------|
| `app_releases` | Version metadata, Play version code, status, update flags |
| `release_public_notes` | Customer-facing HTML (1:1 with release) |
| `release_internal_notes` | Admin-only HTML (1:1 with release) |
| `app_release_events` | Client + admin event log |

### Status lifecycle

`draft` → `published` → `archived`

Publishing a release auto-archives any previously published release.

### Audit

- `created_at`, `updated_at`, `created_by`, `updated_by` on `app_releases`
- `internal_ops_admin_audit` entries on save/publish/archive/delete
- `app_release_events` for runtime telemetry

---

## API endpoints (Supabase RPCs)

### Client-safe (mobile / web POS)

| RPC | Access | Returns |
|-----|--------|---------|
| `get_app_release_client_policy()` | `anon`, `authenticated` | Published release policy + **public notes only** |
| `log_app_release_client_event(...)` | `anon`, `authenticated` | Inserts client event |

### Admin-only (`super_admin`, `operations_admin`)

| RPC | Purpose |
|-----|---------|
| `admin_list_app_releases()` | History table |
| `admin_get_app_release(p_id)` | Full release + internal notes |
| `admin_save_app_release(...)` | Create/update draft |
| `admin_publish_app_release(p_id)` | Publish + archive prior |
| `admin_archive_app_release(p_id)` | Archive |
| `admin_duplicate_app_release(p_id)` | Clone as draft |
| `admin_delete_app_release(p_id)` | Delete draft/archived (not published) |
| `admin_list_app_release_events(p_limit)` | Recent client events |

**Security:** `get_app_release_client_policy` is `SECURITY DEFINER` and selects only whitelisted JSON fields. `release_internal_notes` has staff-only RLS; no client RPC joins it.

---

## Internal Admin UI

**Path:** `/internal/waka/releases`  
**Nav:** Internal Admin → **Releases** (super admin tab)

### Files

| File | Role |
|------|------|
| `src/components/internal-admin/v2/pages/AdminReleaseManagementPage.tsx` | Main page (history + editor) |
| `src/components/internal-admin/v2/AdminRichTextEditor.tsx` | Public / internal note editors |
| `src/lib/releaseManagementAdmin.ts` | Admin API client |

### Features

- Version, Play version code, minimum supported version
- Update type: flexible / immediate
- Toggles: prompt users, force below minimum, show What's New
- Public + internal rich text editors
- History: view, edit, duplicate, archive, delete (confirm)
- Recent client events feed

---

## Android / Google Play integration

### Native plugin

| File | Role |
|------|------|
| `android/app/src/main/java/ug/waka/pos/WakaAppUpdatePlugin.java` | Play Core App Update 2.1.0 |
| `android/app/build.gradle` | `com.google.android.play:app-update:2.1.0` |
| `android/app/src/main/java/ug/waka/pos/MainActivity.java` | Registers plugin |
| `src/lib/nativeAppUpdate.ts` | Capacitor bridge |

### Plugin methods

- `checkForUpdate()` — Play availability + version code
- `startFlexibleUpdate()` — background download
- `startImmediateUpdate()` — full-screen Play flow
- `completeFlexibleUpdate()` — restart after flexible download
- Event: `flexibleUpdateDownloaded`

### Version sources

- **Installed version code:** `App.getInfo().build` (must match `versionCode` in `android/app/build.gradle`)
- **Policy version code:** `google_play_version_code` in admin release record

---

## Client update flow

### Files

| File | Role |
|------|------|
| `src/lib/appReleaseClient.ts` | Fetch policy + log events |
| `src/lib/appReleaseUpdate.ts` | Decision logic |
| `src/lib/appReleaseVersion.ts` | Version code comparison |
| `src/components/app-update/AppReleaseUpdateProvider.tsx` | UI overlays |
| `src/providers/AppProviders.tsx` | Mounts provider globally |

### Launch sequence (Android)

1. `AppReleaseUpdateProvider` calls `evaluateAppReleaseUpdate()` on mount + app resume
2. Fetch `get_app_release_client_policy()`
3. `WakaAppUpdate.checkForUpdate()` (Google Play)
4. Decision:

| Condition | Behavior |
|-----------|----------|
| No Play update | Normal (optional What's New if just updated) |
| Play update + `prompt_users = false` | Silent (Play auto-update may still apply) |
| Below minimum + `force_below_minimum` | Block app → immediate update |
| Play update + prompt + `immediate` | Block app → immediate update |
| Play update + prompt + `flexible` | Dialog: Update now / Later |
| Flexible download complete | “Update ready” + Restart |
| After update + `show_whats_new` | What's New modal (once per version code) |

### What's New persistence

`Capacitor Preferences` key: `waka-whats-new-seen-{versionCode}`

---

## Version comparison logic

- **Force update:** `currentVersionCode < minimum_supported_version_code` when `force_below_minimum` is true
- **Update available:** `playAvailableVersionCode > currentVersionCode`
- **Display semver:** `version_number` / `minimum_supported_version` strings for UI only

Tests: `src/lib/appReleaseVersion.test.ts`

---

## Event logging

| Event | Source |
|-------|--------|
| `release_published`, `release_archived` | Admin RPC |
| `prompt_shown`, `user_skipped` | Client |
| `download_started`, `download_completed` | Client |
| `restart_requested` | Client |
| `immediate_started` | Client |
| `error` | Client |

View in Internal Admin → Releases → Recent client events.

---

## Testing instructions

### 1. Apply migration

```bash
supabase db push
```

### 2. Internal Admin

1. Sign in as `super_admin` or `operations_admin`
2. Open `/internal/waka/releases`
3. Create draft: version `1.0.13`, Play code `18`, public notes
4. Add internal notes (verify they do not appear in client RPC)
5. Publish release

### 3. Verify client API security

```sql
select public.get_app_release_client_policy();
```

Confirm JSON has `public_notes_html` and **no** `internal_notes_html`.

### 4. Android device (Play internal testing)

1. Install older build from Play internal track
2. Upload newer AAB with higher `versionCode`
3. Enable **Prompt users** on published release
4. Launch app → flexible or immediate flow per settings
5. Check `app_release_events` for logged actions

### 5. Unit tests

```bash
npx vitest run src/lib/appReleaseVersion.test.ts
```

### 6. Typecheck

```bash
npx tsc --noEmit
```

---

## Files modified / added (summary)

### New

- `supabase/migrations/121_app_release_management.sql`
- `src/lib/releaseManagementAdmin.ts`
- `src/lib/appReleaseClient.ts`
- `src/lib/appReleaseUpdate.ts`
- `src/lib/appReleaseVersion.ts`
- `src/lib/appReleaseVersion.test.ts`
- `src/lib/nativeAppUpdate.ts`
- `src/components/internal-admin/v2/AdminRichTextEditor.tsx`
- `src/components/internal-admin/v2/pages/AdminReleaseManagementPage.tsx`
- `src/components/app-update/AppReleaseUpdateProvider.tsx`
- `android/app/src/main/java/ug/waka/pos/WakaAppUpdatePlugin.java`
- `docs/RELEASE_MANAGEMENT.md` (this file)

### Modified

- `src/App.tsx` — route `/internal/waka/releases`
- `src/pages/InternalWakaAdminPage.tsx` — section wiring
- `src/components/internal-admin/v2/AdminShell.tsx` — Releases tab
- `src/components/internal-admin/v2/adminRoles.ts` — `canManageAppReleases`
- `src/providers/AppProviders.tsx` — `AppReleaseUpdateProvider`
- `android/app/build.gradle` — Play app-update dependency
- `android/app/src/main/java/ug/waka/pos/MainActivity.java` — plugin registration

---

## Security considerations

1. Internal notes table has staff-only RLS; excluded from all client RPCs
2. Admin RPCs require `is_waka_internal_role(['super_admin','operations_admin'])`
3. Client event RPC validates `event_type` against an allow-list
4. Published release deletion is blocked
5. APK binaries are never served from Waka backend — only Play

---

## Operational notes

- Align `versionCode` in `android/app/build.gradle` with **Google Play version code** in admin when publishing
- Set `minimum_supported_version_code` to the oldest build you still support when enabling force update
- Use **flexible** for non-critical updates; **immediate** for breaking changes or security fixes
- Turn **Prompt users OFF** to rely on Play auto-update without in-app dialogs

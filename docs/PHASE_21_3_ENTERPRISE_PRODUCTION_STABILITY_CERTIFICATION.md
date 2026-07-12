# Phase 21.3 — Enterprise Production Stability Certification

**Mode:** Read-only forensic audit (no code changes)  
**Scope:** Phases 18–21 production stability after manual regression testing  
**Date:** 2026-07-12  

---

## Executive summary

Manual testing exposed six production regression clusters. Static analysis confirms **five are rooted in known architectural tensions**, not random UI bugs:

| Issue | Verdict | Primary root cause |
|-------|---------|-------------------|
| **A** Staff disappearing across devices | **Confirmed — architectural** | Versioned staff cache **replaces** `preferences.staffAccounts` without merge; cache path bypasses additive merge |
| **B** Creating staff deletes another | **Confirmed — race + duplicate ID** | `createStaffInCloudFirst` mirrors cloud staff, then `addStaffAccount` prepends same row again; React duplicate keys |
| **C** Device Management not enterprise-grade | **Confirmed — UX gap** | Backend/RPC certified (Phase 20); owner UI shows active+pending only, misleading online/health |
| **D** Pending shifts cannot be closed | **Confirmed — actor-scoped lifecycle** | Shift close requires same `actorUserId`; stale shifts block day close |
| **E** Offline session logout | **Confirmed — auth init timeout** | `getSession()` 6s timeout → treated as logged out; token refresh needs network |
| **F** Drawer tolerance broken | **Partially confirmed — scope mismatch** | Tolerance applies to shift **open** and **day close**, **not** shift close; operators may expect it at shift close |

**Smallest fix scope:** Serialize and merge-aware staff writes; dedupe staff by ID after create; render full device fleet with heartbeat-based status; manager cash-count close for stale shifts; resilient offline session restore; document or extend tolerance to shift close if product requires it.

---

## Architecture context (Phases 18–21)

| Phase | Domain | Relevance to this audit |
|-------|--------|-------------------------|
| 18–19 | Device authority, approved-device model | Device Management RPC layer |
| 20.x | Owner-first auth, device enrollment | Session + activation on resume |
| 21.0–21.1 | Shop Security PIN recovery | Not implicated in Issues A–F |
| 21.3 | Production stability | This document |

---

## Issue A — Staff disappearing across devices

### Manual reproduction (certified plausible)

```
Phone A: Owner login → Create Staff A → Sync → Staff visible
Phone B: Owner login → Staff list empty ("0 Staff Found")
Later: Phone A also loses staff
```

### Source of truth

| Layer | Authority | Storage |
|-------|-----------|---------|
| **Cloud** | `shop_pos_staff` + `shops.staff_version` | Supabase (migration 125) |
| **Staff cache** | Encrypted delta distribution | IndexedDB `staffCache` (`offlineStaffCache.ts`) |
| **Runtime UI** | **`preferences.staffAccounts`** | Zustand → snapshot in IndexedDB `kv` |

POS auth, lock screen, and staff pickers read **`preferences.staffAccounts`**, not the cache directly.

### Complete trace: Create → Store → Persist → Cloud → Hydrate → UI

```
addStaffAccount (usePosStore.ts)
  ├─ local mode: prepend to staffAccounts
  └─ supabase mode: createStaffInCloudFirst (staffSyncQueue.ts)
        ├─ pushStaffToCloud (shopStaffCloud.ts)
        ├─ refreshStaffCacheAfterOwnerMutation → refreshStaffCacheBackground
        │     └─ mirrorStaffCacheToPreferences (FULL REPLACE)  ← critical
        └─ addStaffAccount prepends row AGAIN (duplicate risk — Issue B)

Persistence: store subscribe → debounced snapshot write (usePosStore.ts)

Cloud sync (cloudSync.ts → pullAndMergeStaffDuringCloudSync):
  1. refreshStaffCacheBackground → if updated, RETURN (merge skipped)
  2. isStaffCacheUpToDate → if true, RETURN
  3. pullShopStaffFromCloud + mergeStaffAccountsForCloudSync (additive)
  4. refreshStaffCacheBackground({ force: true }) → mirror REPLACE (can undo merge)

Background triggers (parallel, NOT in globalSyncMutex):
  - syncShopWithCloud, postLoginBackgroundTasks, useAuth hydrate, StaffAccessPage mount
```

### Merge vs replace certification

| Path | Function | Behavior |
|------|----------|----------|
| **Additive merge** | `mergeStaffAccountsForCloudSync` | Cloud wins per ID; local-only rows retained |
| **Full replace** | `mirrorStaffCacheToPreferences` | Entire `staffAccounts` array overwritten |

Evidence — additive merge (`staffRecovery.ts`):

```23:47:src/lib/staffRecovery.ts
export function mergeStaffAccountsForCloudSync(local, cloud) {
  // cloud rows merged by id; local-only rows kept
}
```

Evidence — replace (`staffCacheSync.ts`):

```144:153:src/lib/staffCacheSync.ts
export function mirrorStaffCacheToPreferences(staff) {
  usePosStore.setState({
    preferences: { ...state.preferences, staffAccounts: sanitizeStaffForCache(staff) },
  });
}
```

Evidence — cache path skips merge (`staffRecovery.ts`):

```89:92:src/lib/staffRecovery.ts
const updated = await refreshStaffCacheBackground();
if (updated) {
  return;  // mergeStaffAccountsForCloudSync never runs
}
```

### Can empty cloud wipe local staff?

| Path | Wipes local? |
|------|--------------|
| `mergeStaffAccountsForCloudSync(local, [])` | **No** — local-only preserved |
| `mirrorStaffCacheToPreferences([])` | **Yes** |
| `pullAndMergeStaffAccountsForRecovery` with non-empty cache | **Yes** — mirrors cache without merge |

### Root cause (Issue A)

**Primary (P0):** Production sync prefers the versioned cache path. `mirrorStaffCacheToPreferences` **replaces** the working staff list. When Device B’s cache reflects cloud state that lags Device A (or returns partial/empty delta), local staff vanish and are **persisted to disk**.

**Contributing (P1):**
- Post-merge `refreshStaffCacheBackground({ force: true })` overwrites additive merge result
- Staff cache refresh runs **outside** `globalSyncMutex` — races with owner CRUD and hydrate
- Recovery path mirrors cache without merge when cache is non-empty

### Affected files

| File | Role |
|------|------|
| `src/lib/staffCacheSync.ts` | Cache download, delta apply, **mirror replace** |
| `src/lib/staffRecovery.ts` | Merge logic, sync orchestration |
| `src/lib/offlineStaffCache.ts` | IndexedDB staff cache |
| `src/lib/shopStaffCloud.ts` | Cloud RPC push/pull |
| `src/store/usePosStore.ts` | CRUD reducers, persistence |
| `src/offline/cloudSync.ts` | Background staff pull hook |
| `supabase/migrations/125_staff_version_distribution.sql` | Versioned download RPC |

### Smallest implementation scope

1. Always merge before writing `staffAccounts`: `mergeStaffAccountsForCloudSync(local, incoming)`
2. Never early-return from sync without merge when local has rows not in cache
3. Run staff cache refresh inside staff-specific mutex (or extend `globalSyncMutex`)
4. Remove post-merge force mirror or make mirror merge-aware
5. Recovery: use merge path even when cache is non-empty

---

## Issue B — Creating one staff deletes another

### Manual reproduction (certified plausible)

```
Create Cashier → visible → Create Manager → Cashier disappears → only Manager remains
```

### Root cause (Issue B)

**Primary (P0):** Duplicate staff row after cloud-first create:

1. `createStaffInCloudFirst` pushes to cloud, then `refreshStaffCacheAfterOwnerMutation` → **mirror** all cloud staff (including new manager) into preferences
2. `addStaffAccount` **prepends the same row again** (`usePosStore.ts` L1930–1934)
3. UI uses `key={s.id}` (`StaffTeamList.tsx`) — duplicate IDs cause unstable React reconciliation (one row appears to vanish)

Evidence — double write:

```89:90:src/lib/staffSyncQueue.ts
await refreshStaffCacheAfterOwnerMutation();  // mirror includes new staff

1930:1934:src/store/usePosStore.ts
staffAccounts: [{ ...row, pendingCloudSync: false }, ...(s.preferences.staffAccounts ?? [])]
```

**Contributing (P1):** If cache refresh returns before cloud reflects all staff, mirror temporarily contains subset → prior cashier missing until next sync.

### CRUD certification

| Operation | Reducer pattern | Replace vs append |
|-----------|-----------------|-------------------|
| Create | Prepend | Append (but mirror may replace entire array) |
| Update | `.map()` by id | Safe |
| Delete | `.filter()` by id | Safe |

**Store replacement risk:** `StaffAccessPage` and mirror paths use full `staffAccounts` assignment, not reducer append.

### Smallest implementation scope

1. After `createStaffInCloudFirst` success: upsert by `id` or skip local prepend if mirror already applied
2. Add `dedupeStaffAccountsById()` before any `setState` on `staffAccounts`
3. Fix `StaffAccessPage` effect deps / race with in-flight create

---

## Issue C — Enterprise Device Management

### Manual finding (confirmed)

> Device Management does not behave like an enterprise device console.

### What exists

| Capability | Backend | Owner UI (`/settings/devices`) |
|------------|---------|--------------------------------|
| Approved devices | `owner_list_shop_devices` | Active only |
| Pending devices | `shop_device_set_approval` | Yes |
| Current device | Fingerprint match | Yes |
| Last seen | `last_seen_at` in RPC | Shown (formatting issues) |
| Platform | Registration metadata | Yes |
| Disconnect / Remove | RPCs exist | Hidden for current device |
| Approval | Yes | Yes |
| **Disconnected/revoked history** | Partitioned in `shopDevices.ts` | **Not rendered** |
| Login history | `last_login_at` in row | **Not shown** |
| Staff on device | `current_staff_client_id` | **Not shown** |
| Device rename | — | **Not supported** |
| Heartbeat-based online | `shop_device_heartbeat` | **Not used in owner UI** |
| Health badge | — | **Hardcoded "Healthy"** |

Evidence — history partition unused:

```234:234:src/pages/DeviceManagementPage.tsx
const { activeDevices, pendingDevices } = useMemo(() => partitionShopDevices(devices), [devices]);
// historyDevices computed but never rendered
```

### Enterprise comparison (Square / Toast / Lightspeed / Shopify POS)

| Feature | Enterprise POS norm | Waka owner UI |
|---------|---------------------|---------------|
| Full fleet visibility | All terminals including offline/disconnected | Active + pending only |
| Accurate presence | Heartbeat / last-seen threshold | DB `status === active` |
| Terminal naming | Editable | Auto-generated, read-only |
| Who is logged in | Per-device session | Not shown |
| Login/audit history | Per device | Not shown |
| Self-service disconnect | Allowed with confirm | Blocked for current device |
| Staff read-only fleet view | Common | No — owner-only RPC |

**Internal Admin** (`ShopConsoleDevicesTab`) is materially closer to enterprise ops console than owner POS.

### Root cause (Issue C)

**Not a backend failure** — Phase 20 approved-device RPC layer is certified. **Owner-facing fleet UI is incomplete** (~55/100 enterprise readiness for Issue C).

### Smallest implementation scope

1. Render `historyDevices` section (disconnected, revoked, suspended)
2. Shared online/stale helper using `last_seen_at` (15-min window like Internal Admin)
3. Surface `last_login_at`, `current_staff_client_id`
4. Wire or remove cosmetic "Healthy" badge
5. Allow disconnect (not remove) of current device with confirmation

---

## Issue D — Cash Drawer & Shift Lifecycle

### Manual findings (confirmed)

- Old pending shifts cannot be closed
- Users blocked because previous skipped shifts remain open
- Opening new shift depends on closing historical ones

### Canonical workflow (v2 default)

```
recordDayDrawerOpen (day-level float)
  → beginShiftV2 (per-cashier float verify vs tolerance)
    → sales update shift totals
      → closeShiftWithHandoff (cash count + handoff)
        → recordDayClose (day-level, variance tolerance applies)
```

### Root cause (Issue D)

**Primary (P0):** Shift close is **actor-scoped**. Only the cashier who opened the shift can run a proper cash-count close:

```4722:4723:src/store/usePosStore.ts
const open = shifts.find((sh) => !sh.endAt && sh.actorUserId === actor.userId);
if (!open) return { ok: false, errorKey: "invalid" };
```

**Contributing (P1):**
- `managerForceCloseOpenShift` ends shift **without** cash count — recovery only
- Stale prior-day open shifts block day close via `sequentialBusinessDays` / `collectOpenShifts`
- `assertCanCloseShift` blocks on draft cart, pending sale, open hospitality tables
- v2 requires day drawer open before shift — skipped day blocks shift start

### Shift persistence & sync

| Aspect | Behavior |
|--------|----------|
| Local | `preferences.shifts[]`, `pendingSync: true` on mutation |
| Cloud queue | `pending_shifts` → `pushShiftToCloud` |
| Merge | `mergeShiftsFromCloudPull` — prefers more complete row (has `endAt`, `countedCashUgx`) |
| Close blocked by pending sync? | **No** — local close always allowed |

### Trace: Open → Transactions → Close → Recovery → Archive

```
ShiftSellGateway → getActiveShiftForActor(actor.userId)
OpenShiftsPage → lists ALL open shifts; force-close for manager (no count)
closeShiftWithCashCount → actor's open shift only
Day close preflight → collectOpenShifts blocks if any shift open on date
```

### Smallest implementation scope

1. Manager/owner **cash-count close for any open shift** (not just force-close without count)
2. Stale shift recovery UX on `OpenShiftsPage` (prominent, dated)
3. Clarify sequential day blocker messaging when old shift prevents day open/close
4. Optional: auto-expire abandoned open shifts with audit (policy decision)

---

## Issue E — Offline Session Persistence

### Manual reproduction (confirmed plausible)

```
Owner login → Use POS → Mobile data off → Leave app → Return → Logged out
```

### Trace: Login → Session → Offline → Resume → Restore → POS

```
Login: supabase.auth (persistSession: true, autoRefreshToken: true, localStorage)
  → useAuth.setSession
  → DeviceActivationContext (network RPC on user.id change)
  → PosDataProvider bootstrap by accountKey

Cold start / resume:
  → useAuth.finishInit: getSession() with 6s timeout
  → if null: applyAccountSwitchSync(null) → logged out UI

Background: autoRefreshToken requires network; failure may emit SIGNED_OUT
Device activation: no re-check on native resume (only user.id change)
```

### Root cause (Issue E)

**Primary (P0):** Auth init treats slow/failed `getSession()` as logout:

```417:448:src/hooks/useAuth.ts
const sessionResult = await withTimeout(supabase.auth.getSession(), 6000, null);
const next = sessionResult?.data.session ?? null;
// ...
if (!next?.user) {
  applyAccountSwitchSync(null);  // clears account scope
}
```

On Android WebView with mobile data off, `getSession()` may exceed 6s or fail → **false logout** even if tokens remain in `localStorage`.

**Contributing (P1):**
- `autoRefreshToken` needs network on resume — refresh failure can sign out
- Device activation **connection block** can feel like logout (blocks app, not login screen)
- Staff persisted session restore runs only when Supabase **not** configured — not a fallback for owners

### Enterprise expectation gap

> After successful login, temporary internet loss MUST NOT force logout.

**Current contract:** Broken for cold start/resume offline. In-session use may persist until token refresh attempted.

### Smallest implementation scope

1. On `getSession` timeout: read tokens from Supabase storage directly; defer logout
2. Offline-first session: treat persisted tokens as authenticated until explicit sign-out or refresh confirms invalid
3. Distinguish device activation connection block from auth logout in UX
4. Optional: re-validate device authority on resume without blocking when offline + previously activated

---

## Issue F — Drawer Tolerance

### Manual finding

> Drawer Tolerance appears broken.

### Audit result

**Tolerance engine is functioning but applied at different lifecycle stages than operators may expect.**

| Operation | Tolerance function | Enforced? |
|-----------|-------------------|-----------|
| Shift open (v2 float verify) | `floatVerificationWithinTolerance` | **Yes** — block + manager override |
| Shift close cash count | — | **No** — any variance allowed |
| Day close | `dayCloseVarianceIsFlagged` | **Yes** — manager PIN required |

Settings: `cashVarianceThresholdPct` (default 5%), `cashVarianceThresholdUgxFixed` (default 10,000 UGX) on `SettingsCashDrawerPage`.

### Trace: Expected → Actual → Variance → Tolerance → Decision → Close

**Shift close:**
```
expected = shiftExpectedCash(open)
difference = counted - expected
→ always closes if assertCanCloseShift passes
→ records cashDifferenceUgx (informational)
→ ShiftCloseModal shows over/short but does NOT block on tolerance
```

**Day close:**
```
dayCloseVarianceIsFlagged(expected, diff, preferences)
→ if flagged: requires varianceOverride + manager PIN
```

### Root cause (Issue F)

**P2 — Product/UX mismatch, not calculation bug.** Settings copy references day-close variance. Operators testing tolerance at **shift close** will perceive it as broken.

**Cross-issue:** Force-closed shifts (Issue D) without `countedCashUgx` skew day-close expected cash → false variance flags at day close.

### Smallest implementation scope

1. **Document** in UI: tolerance applies at shift open + day close, not shift close
2. **Or** apply optional shift-close tolerance warning (non-blocking) consistent with day close
3. Fix stale shift / force-close data so day-close variance is not corrupted

---

## Part 7 — Synchronization Certification

### Staff

| Operation | Mechanism | Merge/Replace |
|-----------|-----------|---------------|
| Download (cache) | Delta → mirror | **Replace** |
| Download (list) | mergeStaffAccountsForCloudSync | **Merge** |
| Upload | pushStaffToCloud / queue | Upsert |
| Delete | deleteCloudStaff | Cloud authoritative |
| Conflict | Cloud wins per ID; newer updatedAt | Merge path only |

### Devices

| Operation | Mechanism |
|-----------|-----------|
| Registration | `shop_device_register_on_login` |
| Approval | `shop_device_set_approval` |
| Presence | `shop_device_heartbeat` |
| List | `owner_list_shop_devices` |
| Conflict | Server authoritative; no offline device CRUD |

### Shifts

| Operation | Mechanism |
|-----------|-----------|
| Push | `pending_shifts` queue |
| Pull merge | Completeness scoring in `shiftRecovery.ts` |
| Conflict | More complete row wins |

### Drawer / preferences

| Domain | Sync |
|--------|------|
| Day drawer opens | Cloud snapshot + dedicated sync |
| Shop preferences | Snapshot merge in cloud pull |
| Cash variance settings | Local preferences in snapshot |

### Sources of truth summary

| Domain | Authoritative |
|--------|---------------|
| Staff (cloud shops) | Supabase `shop_pos_staff` |
| Staff (runtime) | `preferences.staffAccounts` (often overwritten by cache) |
| Devices | Supabase `shop_devices` |
| Shifts | Cloud merge with local pending |
| Preferences | Snapshot merge (cloud + local) |

---

## Part 8 — Offline-first Certification

### Scenario: Phone A offline, Phone B online — both modify staff

| Writer | Outcome |
|--------|---------|
| A creates staff offline | Queued via `enqueuePendingStaffSync` if cloud-first fails |
| B online | Cache/cloud updates; mirror to B |
| A reconnects | Cache refresh may **replace** A's local staff without merge → **data loss risk** |

**Conflict strategy:** Cloud authoritative for staff IDs; merge path preserves local-only until cloud confirms. **Cache mirror path breaks this contract.**

### Scenario: Shifts offline

Local mutations allowed with `pendingSync`; merge on pull prefers complete rows. **Lower risk** than staff.

### Scenario: Devices

Server authoritative; no offline device management.

### Scenario: Preferences

Snapshot merge; shop-level settings generally merge not replace (except recovery paths for Shop Security PIN — Phase 21.1).

### Offline-first contract grade

| Domain | Grade | Notes |
|--------|-------|-------|
| Staff | **D** | Replace path breaks offline-first |
| Shifts | **B** | Local writes + queue |
| Devices | **A** | Server-only |
| Auth session | **D** | False logout on timeout |
| PIN recovery | **B+** | Phase 21.1 improved |

---

## Part 9 — Enterprise UX Certification

| Area | Square/Toast/Lightspeed norm | Waka current | Gap |
|------|------------------------------|--------------|-----|
| Staff multi-device | Reliable cloud sync | Cache replace races | **Critical** |
| Staff CRUD | Stable list | Duplicate ID on create | **Critical** |
| Device fleet | Full terminal list | Active+pending only | **High** |
| Shift recovery | Manager close any shift | Force-close only | **High** |
| Offline POS | Session persists | False logout | **Critical** |
| Drawer tolerance | Clear when enforced | Shift close unguarded | **Medium** |

---

## Part 10 — Root Cause Report (consolidated)

| ID | Issue | Root cause | Severity | Key files | RPCs | Business impact |
|----|-------|------------|----------|-----------|------|-----------------|
| RC-01 | A | Cache mirror replaces staff without merge | **P0** | `staffCacheSync.ts`, `staffRecovery.ts` | `shop_pos_staff_download` | Staff vanish shop-wide |
| RC-02 | A | Cache sync early-return skips merge | **P0** | `staffRecovery.ts:89-92` | — | Device B empty list |
| RC-03 | A | Staff sync outside global mutex | **P1** | `staffCacheSync.ts`, `globalSyncMutex.ts` | — | Race data loss |
| RC-04 | B | Double prepend after cache mirror | **P0** | `usePosStore.ts`, `staffSyncQueue.ts` | `shop_pos_staff_upsert` | Cashier disappears on create |
| RC-05 | B | React duplicate keys | **P1** | `StaffTeamList.tsx` | — | UI shows wrong count |
| RC-06 | C | historyDevices not rendered | **P1** | `DeviceManagementPage.tsx` | `owner_list_shop_devices` | Fleet disappears after disconnect |
| RC-07 | C | Online = DB status not heartbeat | **P1** | `DeviceManagementPage.tsx` | — | False "Online" |
| RC-08 | D | Close scoped to actorUserId | **P0** | `usePosStore.ts:4722` | `shop_push_shift` | Stale shifts unblockable |
| RC-09 | D | Force-close skips cash count | **P1** | `managerForceCloseOpenShift` | — | Bad day-close variance |
| RC-10 | E | getSession 6s timeout → logout | **P0** | `useAuth.ts:417` | — | Offline owners logged out |
| RC-11 | E | Token refresh requires network | **P1** | `supabase.ts` | — | Resume sign-out |
| RC-12 | F | Tolerance not at shift close | **P2** | `ShiftCloseModal.tsx` | — | Perceived broken setting |
| RC-13 | F | Day-close variance after force-close | **P2** | `dayCloseApprovals.ts` | — | False PIN prompts |

---

## Part 11 — Priority Matrix

### P0 — Production blockers

| ID | Issue | Fix theme |
|----|-------|-----------|
| RC-01, RC-02, RC-03 | A | Merge-aware staff sync |
| RC-04 | B | Dedupe / skip double prepend |
| RC-08 | D | Manager close any shift with count |
| RC-10 | E | Offline session resilience |

### P1 — High priority

| ID | Issue | Fix theme |
|----|-------|-----------|
| RC-05 | B | React key stability |
| RC-06, RC-07 | C | Full fleet UI + heartbeat |
| RC-09 | D | Cash-count stale shift recovery |
| RC-11 | E | Refresh failure handling |

### P2 — Medium

| ID | Issue | Fix theme |
|----|-------|-----------|
| RC-12, RC-13 | F | Tolerance UX / shift-close policy |
| C-003–C-009 | C | Device rename, staff view, self-disconnect |

### P3 — Polish

| ID | Issue | Fix theme |
|----|-------|-----------|
| C-010 | C | Remove `ConnectedDevicesPage` drift |
| StaffAccessPage effect deps | B | Stale closure cleanup |

---

## Part 12 — Deliverables index

| # | Deliverable | Section |
|---|-------------|---------|
| 1 | Staff synchronization certification | Issue A, Part 7 |
| 2 | Staff CRUD certification | Issue B |
| 3 | Device Management certification | Issue C |
| 4 | Drawer & Shift lifecycle certification | Issue D |
| 5 | Offline session certification | Issue E |
| 6 | Drawer Tolerance certification | Issue F |
| 7 | Synchronization architecture report | Part 7 |
| 8 | Root cause report | Part 10 |
| 9 | Enterprise implementation roadmap | Below |

---

## Part 13 — Enterprise Implementation Roadmap (smallest scope)

Recommended fix phases **without architecture redesign**:

### Phase 21.4 — Staff sync stabilization (P0)

- Merge before every `staffAccounts` write
- Remove cache early-return that skips merge
- Staff sync mutex
- Fix createStaff double-write + dedupe by ID
- Tests: two-device create, offline create + online sync, create manager + cashier retained

### Phase 21.5 — Offline session hardening (P0)

- Resilient `getSession` / token read on timeout
- Offline authenticated state until confirmed invalid
- Activation gate vs logout UX separation
- Tests: airplane mode cold start, resume without data

### Phase 21.6 — Shift recovery (P0/P1)

- Manager cash-count close for any open shift (permission-gated)
- Stale shift prominence on OpenShiftsPage
- Tests: cross-actor close, prior-day blocker

### Phase 21.7 — Device fleet UI (P1)

- Render historyDevices
- Heartbeat-based online/stale
- Login + staff-on-device fields
- Tests: disconnect visibility, stale detection

### Phase 21.8 — Drawer tolerance clarity (P2)

- UI copy + optional shift-close variance warning
- Day-close variance accuracy after force-close

---

## Verification checklist (post-fix)

- [ ] Phone A creates staff → Phone B sees staff within one sync cycle
- [ ] Create cashier then manager → both visible, no duplicate IDs
- [ ] Disconnect device remains visible in fleet history
- [ ] Stale shift closable by manager with cash count
- [ ] Owner cold start offline remains authenticated
- [ ] Shift open respects tolerance; day close flags variance; shift close behavior documented or extended

---

## Regression matrix (must not break)

| Area | Expected after fixes |
|------|---------------------|
| Owner login | Unchanged |
| Staff login / PIN | Unchanged |
| Device activation (Phase 20.6) | Unchanged |
| Shop Security PIN (Phase 21.1) | Unchanged |
| Cloud snapshot / sales sync | Unchanged |
| Approved-device authority | Unchanged |

---

## Conclusion

Production regressions A, B, D, and E are **evidence-backed architectural issues**, not isolated UI defects. Issue C is a **UX completeness gap** atop a certified backend. Issue F is primarily **scope/documentation** unless product requires shift-close enforcement.

The **smallest production fix** is four focused phases (21.4–21.7) targeting merge-aware staff sync, offline session resilience, shift recovery, and device fleet UI — **without** redesigning authentication, device authority, or cloud snapshot architecture.

**No code was modified in Phase 21.3.**

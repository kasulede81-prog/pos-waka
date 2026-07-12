# Phase 21.4 — Enterprise Staff Synchronization & CRUD Reliability

Production fix for the two P0 staff regressions certified in Phase 21.3.

## Problems fixed

| Issue | Root cause | Fix |
|-------|------------|-----|
| Staff disappearing across devices | `mirrorStaffCacheToPreferences` **replaced** entire `staffAccounts` | Merge-only apply via `applyStaffAccountsMergeToStore` |
| Create second staff hides first | Cloud create → mirror → **prepend duplicate ID** | `upsertStaffAccountInStore` — one row per ID |

## Before vs after

### Before (Phase 21.3)

```
Cloud delta / cache
        │
        ▼
mirrorStaffCacheToPreferences()  ← FULL REPLACE
        │
        ▼
preferences.staffAccounts

Cloud create
        │
        ▼
refreshStaffCacheAfterOwnerMutation → mirror
        │
        ▼
addStaffAccount() → prepend same ID again
        │
        ▼
React duplicate keys → hidden row
```

### After (Phase 21.4)

```
Cloud / cache / pull
        │
        ▼
mergeStaffAccountsForCloudSync(local, incoming)
        │
        ▼
dedupeStaffAccountsById()
        │
        ▼
preferences.staffAccounts

Cloud create
        │
        ▼
refreshStaffCacheAfterOwnerMutation → merge mirror
        │
        ▼
upsertStaffAccountInStore() → insert OR merge by ID (never duplicate)
```

## Single source of truth flow

```
Cloud (shop_pos_staff + versioned delta)
        │
        ▼
Merge (additive — local-only preserved)
        │
        ▼
Dedupe (canonical staff ID)
        │
        ▼
Store (preferences.staffAccounts)
        │
        ▼
IndexedDB snapshot + encrypted staffCache
        │
        ▼
UI (StaffTeamList key={staff.id})
```

**Rule:** Never `Cloud → Replace → Store` except explicit destructive full restore (not used in normal sync).

## Merge algorithm

`mergeStaffAccountsForCloudSync(local, cloud)`:

1. For each cloud row: merge with local by ID; cloud wins on `updatedAt` tie via `pickNewerStaffAccount`
2. For each local-only row: **retain** until cloud confirms or owner deletes
3. Empty cloud payload: **local-only rows kept**

`dedupeStaffAccountsById`: if duplicate IDs in array, newer row wins.

## Duplicate protection

| Entry point | Behavior |
|-------------|----------|
| `addStaffAccount` (supabase) | `createStaffInCloudFirst` → `upsertStaffAccountInStore` |
| `processPendingStaffSync` | Push → cache refresh → `upsertStaffAccountInStore` |
| `mirrorStaffCacheToPreferences` | `applyStaffAccountsMergeToStore` |
| `pullAndMergeStaffDuringCloudSync` | `applyStaffAccountsMergeToStore` |
| `StaffAccessPage` hydrate | `applyStaffAccountsMergeToStore` |

## IndexedDB integrity

| Store | Content | Write path |
|-------|---------|------------|
| Snapshot `kv` | `preferences.staffAccounts` | Store persist (debounced) |
| `staffCache` | Encrypted versioned cache | `writeOfflineStaffCache` after delta |

Cache mirror **merges into** preferences; snapshot persists merged result. Reload → hydrate → same staff count (merge on any cloud refresh).

## Offline-first behavior

```
Phone A offline → create staff (queued pendingCloudSync)
Phone B online → cloud has staff
Phone A reconnect → merge preserves local-only until push confirms
                  → no replace wipe
                  → dedupe prevents duplicate IDs
```

## Diagnostics

Console prefix: `[waka-staff-sync]`

Example:

```
[waka-staff-sync] { event: "merge_applied", source: "cache_mirror", cloudRows: 2, merged: 3, added: 1, updated: 1, preservedLocal: 1, skippedDuplicates: 0 }
```

Never logs PIN, password, or hashes.

## Key files

| File | Role |
|------|------|
| `src/lib/staffSyncApply.ts` | Merge apply, dedupe, upsert |
| `src/lib/staffSyncDiagnostics.ts` | `[waka-staff-sync]` logging |
| `src/lib/staffCacheSync.ts` | Cache download; merge-only mirror |
| `src/lib/staffRecovery.ts` | Cloud sync orchestration |
| `src/lib/staffSyncQueue.ts` | Cloud-first create + queue |
| `src/store/usePosStore.ts` | `addStaffAccount` upsert path |

## Regression checklist

- [ ] Create Cashier → Create Manager → **2 staff visible**
- [ ] Phone A creates staff → Phone B sync → **same count**
- [ ] Partial cloud payload → **local-only staff remain**
- [ ] Duplicate ID in array → **single row after dedupe**
- [ ] App reload → **staff list unchanged**
- [ ] Staff PIN/password auth unchanged
- [ ] Device management unchanged
- [ ] Shop Security PIN unchanged

## Verification matrix

| Area | Expected |
|------|----------|
| Staff sync | Merge-only |
| Staff create | Single insertion per ID |
| Cross-device | Convergent staff list |
| Offline create | Local preserved + queued |
| Auth / permissions | Unchanged |
| DB schema / RPCs | Unchanged |

## Tests

- `src/lib/staffSyncApply.test.ts` — scenarios 1–5 + cross-device
- `src/lib/staffRecovery.test.ts` — merge unit tests (existing)
- `src/lib/staffCacheSync.test.ts` — cache delta tests (existing)

## Out of scope (unchanged)

Authentication, staff permissions, PIN/password verification, device management, Shop Security PIN, subscriptions, IndexedDB schema, staff RPC contracts.
